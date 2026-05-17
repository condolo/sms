/* ============================================================
   InnoLearn — /api/report-cards
   Academic report card engine.

   Endpoints:
     POST /generate              — compute live report for preview (not persisted)
     POST /publish               — snapshot + rank whole class (admin only)
     GET  /                      — list snapshots (filter by classId/termId/studentId)
     GET  /:id                   — get one snapshot
     PUT  /:id/comments          — save teacher/principal comments
     GET  /:id/pdf               — stream PDF (checks financial block)

   Data flow:
     grades collection (continuous assessment, by assessmentType)
     + exam_results collection (exam scores, via exams.type mapping to assessmentType)
     × academic_config.assessmentWeights (weights sum to 100)
     → finalScore per subject → resolveGrade() → snapshot

   Plan: standard | RBAC: grades:{read,create,update}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }    = require('../middleware/auth');
const { rbac }              = require('../middleware/rbac');
const { planGate }          = require('../middleware/plan');
const { _model }            = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject } = require('../utils/ranking');
const { resolveGrade, mergeConfig }  = require('./academic-config');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Helpers ────────────────────────────────────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** Load school academic config (merged with defaults) */
async function _loadConfig(schoolId) {
  const saved = await _model('academic_config').findOne({ schoolId }).lean();
  return mergeConfig(saved);
}

/**
 * Aggregate grades (continuous assessment) for students in a class/term.
 * Returns: { [studentId]: { [subjectId]: { [assessmentType]: avgPercentage } } }
 */
async function _aggregateGrades(schoolId, classId, termId, academicYearId) {
  const filter = { schoolId, classId, isPublished: true };
  if (termId)         filter.termId         = termId;
  if (academicYearId) filter.academicYearId = academicYearId;

  const grades = await _model('grades').find(filter).lean();

  const grouped = {};
  for (const g of grades) {
    const { studentId, subjectId, assessmentType } = g;
    const pct = g.percentage ?? (g.maxScore > 0 ? _round((g.score / g.maxScore) * 100) : null);
    if (pct === null) continue;
    grouped[studentId]               ??= {};
    grouped[studentId][subjectId]    ??= {};
    grouped[studentId][subjectId][assessmentType] ??= [];
    grouped[studentId][subjectId][assessmentType].push(pct);
  }

  // Average within each assessmentType bucket
  const result = {};
  for (const [sid, subjects] of Object.entries(grouped)) {
    result[sid] = {};
    for (const [sub, types] of Object.entries(subjects)) {
      result[sid][sub] = {};
      for (const [type, pcts] of Object.entries(types)) {
        result[sid][sub][type] = _round(pcts.reduce((s, n) => s + n, 0) / pcts.length);
      }
    }
  }
  return result;
}

/**
 * Aggregate exam results for students in a class/term.
 * Maps exam.type (e.g. 'midterm', 'final') to assessment weights.
 * Returns same shape as _aggregateGrades.
 */
async function _aggregateExamResults(schoolId, classId, termId, academicYearId) {
  const examsFilter = {
    schoolId, classId,
    status: { $in: ['completed', 'moderated', 'approved', 'locked', 'published', 'archived'] }
  };
  if (termId)         examsFilter.termId         = termId;
  if (academicYearId) examsFilter.academicYearId = academicYearId;

  const exams = await _model('exams').find(examsFilter).lean();
  if (!exams.length) return {};

  const examMap = Object.fromEntries(exams.map(e => [e.id, e]));
  const examIds = exams.map(e => e.id);

  // Only include results with valid scores (not absent/missing/exempted)
  const results = await _model('exam_results').find({
    schoolId,
    examId: { $in: examIds },
    markState: { $in: ['present', null] },
    absent: { $ne: true }
  }).lean();

  const grouped = {};
  for (const r of results) {
    const exam = examMap[r.examId];
    if (!exam || r.score == null) continue;
    const { studentId } = r;
    const subjectId = exam.subjectId;
    const type      = exam.type; // maps to assessmentType in weights
    const pct       = exam.maxScore > 0 ? _round((r.score / exam.maxScore) * 100) : null;
    if (pct === null || !subjectId) continue;

    grouped[studentId]             ??= {};
    grouped[studentId][subjectId]  ??= {};
    grouped[studentId][subjectId][type] ??= [];
    grouped[studentId][subjectId][type].push(pct);
  }

  const result = {};
  for (const [sid, subjects] of Object.entries(grouped)) {
    result[sid] = {};
    for (const [sub, types] of Object.entries(subjects)) {
      result[sid][sub] = {};
      for (const [type, pcts] of Object.entries(types)) {
        result[sid][sub][type] = _round(pcts.reduce((s, n) => s + n, 0) / pcts.length);
      }
    }
  }
  return result;
}

/**
 * Compute final score per student per subject using assessment weights.
 * Normalises if not all weight categories are present for a student.
 */
function _computeFinalScores(gradesData, examData, assessmentWeights, gradingSchema) {
  const weightMap  = Object.fromEntries(assessmentWeights.map(w => [w.assessmentType, w.weight]));
  const allStudents = new Set([...Object.keys(gradesData), ...Object.keys(examData)]);

  const studentReports = {};

  for (const sid of allStudents) {
    const allSubjects = new Set([
      ...Object.keys(gradesData[sid] || {}),
      ...Object.keys(examData[sid]   || {}),
    ]);

    const subjects = {};
    let totalScore  = 0;
    let totalPoints = 0;
    let subjectCount = 0;

    for (const sub of allSubjects) {
      const gradeTypes = gradesData[sid]?.[sub] || {};
      const examTypes  = examData[sid]?.[sub]   || {};
      const allTypes   = { ...gradeTypes, ...examTypes };

      let weightedSum     = 0;
      let totalWeightUsed = 0;

      for (const [type, avg] of Object.entries(allTypes)) {
        const w = weightMap[type] ?? 0;
        if (w === 0) continue; // unweighted type — skip
        weightedSum     += avg * w;
        totalWeightUsed += w;
      }

      if (totalWeightUsed === 0) continue; // no weighted data for this subject

      // Normalise: scale to full 100 if only partial weight types present
      const finalScore = _round(weightedSum / totalWeightUsed);
      const gradeInfo  = resolveGrade(finalScore, gradingSchema);

      subjects[sub] = {
        finalScore,
        grade:      gradeInfo.grade,
        points:     gradeInfo.points,
        descriptor: gradeInfo.descriptor,
        remarks:    gradeInfo.remarks,
        breakdown:  allTypes,   // { classwork: 72, midterm: 68, final: 74 }
      };

      totalScore  += finalScore;
      totalPoints += gradeInfo.points ?? 0;
      subjectCount++;
    }

    const averageScore = subjectCount > 0 ? _round(totalScore / subjectCount) : 0;
    const gpa          = subjectCount > 0 ? _round(totalPoints / subjectCount) : 0;

    studentReports[sid] = { studentId: sid, subjects, totalScore: _round(totalScore), averageScore, gpa, subjectCount };
  }

  return studentReports;
}

/** Fetch attendance summary for a student in a class/term */
async function _attendanceSummary(schoolId, studentId, classId, termId, academicYearId) {
  const filter = { schoolId, studentId };
  if (classId)        filter.classId        = classId;
  if (termId)         filter.termId         = termId;
  if (academicYearId) filter.academicYearId = academicYearId;

  const Att = _model('attendance');
  const [present, absent, total] = await Promise.all([
    Att.countDocuments({ ...filter, status: 'present' }),
    Att.countDocuments({ ...filter, status: 'absent'  }),
    Att.countDocuments(filter),
  ]);
  return { daysPresent: present, daysAbsent: absent, totalSchoolDays: total,
           percentage: total > 0 ? _round((present / total) * 100) : null };
}

/* ── Validation ─────────────────────────────────────────────── */
const GenerateSchema = z.object({
  classId:        z.string().min(1),
  termId:         z.string().optional(),
  academicYearId: z.string().optional(),
  studentId:      z.string().optional(), // if omitted: whole class
});

const PublishSchema = z.object({
  classId:        z.string().min(1),
  termId:         z.string().optional(),
  academicYearId: z.string().optional(),
  // Optional metadata to embed in snapshots
  className:      z.string().max(100).optional(),
  termName:       z.string().max(100).optional(),
  academicYear:   z.string().max(50).optional(),
  schoolName:     z.string().max(200).optional(),
});

const CommentSchema = z.object({
  // Subject-level teacher comments: { [subjectId]: string }
  subjectComments: z.record(z.string().max(500)).optional(),
  classTeacherRemark: z.string().max(1000).optional(),
  principalRemark:    z.string().max(1000).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   POST /api/report-cards/generate  — live preview (no persist)
   ══════════════════════════════════════════════════════════════ */
router.post('/generate', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { data, error } = _validate(GenerateSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, termId, academicYearId, studentId } = data;
    const config = await _loadConfig(schoolId);

    const [gradesData, examData] = await Promise.all([
      _aggregateGrades(schoolId, classId, termId, academicYearId),
      _aggregateExamResults(schoolId, classId, termId, academicYearId),
    ]);

    const allReports = _computeFinalScores(gradesData, examData, config.assessmentWeights, config.gradingSchema);

    // Compute provisional class rankings (all students, so single student sees rank)
    const classInput = Object.values(allReports).map(r => ({ studentId: r.studentId, totalScore: r.totalScore }));
    const classRanks = rankStudents(classInput, config.rankingMethod);

    // If a single studentId was requested, filter to just that student
    const targets = studentId
      ? (allReports[studentId] ? { [studentId]: allReports[studentId] } : {})
      : allReports;

    const response = Object.values(targets || {}).map(r => ({
      ...r,
      rankings: config.rankingEnabled
        ? mergeRankings(r.studentId, { class: classRanks })
        : {},
    }));

    return ok(res, {
      generated: response.length,
      config: {
        gradingType:       config.gradingType,
        passMark:          config.passMark,
        weightingEnabled:  config.weightingEnabled,
        assessmentWeights: config.assessmentWeights,
        rankingEnabled:    config.rankingEnabled,
      },
      students: response,
    });
  } catch (err) { console.error('[report-cards/generate]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/report-cards/publish  — snapshot whole class (admin)
   ══════════════════════════════════════════════════════════════ */
router.post('/publish', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'superadmin'].includes(role)) {
      return E.forbidden(res, 'Only admins can publish report cards');
    }

    const { data, error } = _validate(PublishSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, termId, academicYearId, className, termName, academicYear, schoolName } = data;
    const config = await _loadConfig(schoolId);
    const now    = new Date().toISOString();

    // Aggregate all data for the class
    const [gradesData, examData] = await Promise.all([
      _aggregateGrades(schoolId, classId, termId, academicYearId),
      _aggregateExamResults(schoolId, classId, termId, academicYearId),
    ]);

    const allReports = _computeFinalScores(gradesData, examData, config.assessmentWeights, config.gradingSchema);

    if (Object.keys(allReports).length === 0) {
      return E.badRequest(res, 'No graded results found for this class/term — nothing to publish');
    }

    // Compute rankings per enabled scope
    const classInput   = Object.values(allReports).map(r => ({ studentId: r.studentId, totalScore: r.totalScore }));
    const classRanks   = rankStudents(classInput, config.rankingMethod);

    // Best per subject
    const subjectBest  = config.showBestPerSubject
      ? bestPerSubject(Object.values(allReports).map(r => ({ studentId: r.studentId, subjects: r.subjects })))
      : {};

    // Load existing comments for this class/term (so publish preserves them)
    const existingSnaps = await _model('report_card_snapshots').find({
      schoolId, classId, termId: termId || null, academicYearId: academicYearId || null
    }).lean();
    const commentMap = Object.fromEntries(existingSnaps.map(s => [s.studentId, s.comments || {}]));

    // Fetch student info for denormalization
    const studentIds = Object.keys(allReports);
    const students   = await _model('students').find({
      schoolId,
      $or: [
        { id: { $in: studentIds } },
        { _id: { $in: studentIds.filter(s => s.match(/^[0-9a-f]{24}$/)) } }
      ]
    }).lean();
    const studentMap = Object.fromEntries(students.map(s => [s.id || s._id.toString(), s]));

    // Build snapshots
    const snapshots = Object.values(allReports).map(r => {
      const stu = studentMap[r.studentId] || {};
      const rankings = config.rankingEnabled
        ? mergeRankings(r.studentId, { class: classRanks })
        : {};

      return {
        id:             uuidv4(),
        schoolId,
        studentId:      r.studentId,
        studentName:    [stu.firstName, stu.lastName].filter(Boolean).join(' ') || r.studentId,
        admissionNo:    stu.admissionNumber || stu.admissionNo || '',
        classId,
        className:      className || '',
        termId:         termId         || null,
        termName:       termName       || '',
        academicYearId: academicYearId || null,
        academicYear:   academicYear   || '',
        schoolName:     schoolName     || '',

        // Snapshot of school config at publish time (immutable)
        gradingSchema:      config.gradingSchema,
        assessmentWeights:  config.assessmentWeights,
        passMark:           config.passMark,
        gradingType:        config.gradingType,

        // Results
        subjects:     r.subjects,
        totalScore:   r.totalScore,
        averageScore: r.averageScore,
        gpa:          r.gpa,
        subjectCount: r.subjectCount,

        // Rankings (snapshot of class at publish time)
        rankings,

        // Best in subject flags
        subjectBest: Object.fromEntries(
          Object.entries(subjectBest).map(([sub, winnerId]) => [sub, winnerId === r.studentId])
        ),

        // Comments — preserved from previous snapshot or empty
        comments: commentMap[r.studentId] || {
          subjectComments:    {},
          classTeacherRemark: '',
          principalRemark:    '',
        },

        // Attendance — loaded lazily; populated on first PDF request or separately
        attendanceSummary: null,

        status:      'published',
        publishedAt: now,
        publishedBy: userId,
        updatedAt:   now,
        updatedBy:   userId,
      };
    });

    // Upsert all snapshots (overwrite if already published for this student/class/term)
    const Snaps = _model('report_card_snapshots');
    const ops   = snapshots.map(snap => ({
      replaceOne: {
        filter:      { schoolId, studentId: snap.studentId, classId, termId: termId || null, academicYearId: academicYearId || null },
        replacement: snap,
        upsert:      true,
      }
    }));

    const result = await Snaps.bulkWrite(ops, { ordered: false });

    console.log(`[REPORT-CARDS] Published ${snapshots.length} report cards for class ${classId} by ${userId}`);
    return ok(res, {
      published:  snapshots.length,
      upserted:   result.upsertedCount,
      modified:   result.modifiedCount,
      classId,
      termId,
      publishedAt: now,
    }, null, 201);
  } catch (err) { console.error('[report-cards/publish]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/report-cards  — list snapshots
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.status)         filter.status         = req.query.status;

    const Snaps = _model('report_card_snapshots');
    const [docs, total] = await Promise.all([
      Snaps.find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip).limit(limit)
        .select('-gradingSchema -assessmentWeights -subjects -__v')
        .lean(),
      Snaps.countDocuments(filter),
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[report-cards GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/report-cards/:id  — get one snapshot (full detail)
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('report_card_snapshots')
      .findOne({ id: req.params.id, schoolId })
      .select('-__v').lean();
    if (!doc) return E.notFound(res, 'Report card snapshot not found');
    return ok(res, doc);
  } catch (err) { console.error('[report-cards GET/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   PUT /api/report-cards/:id/comments  — save comments
   ══════════════════════════════════════════════════════════════ */
router.put('/:id/comments', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(CommentSchema, req.body);
    if (error) return E.validation(res, error);

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    const now = new Date().toISOString();
    const existing = snap.comments || {};

    // Merge: teachers can only update subjectComments; admin can update all
    const merged = { ...existing };

    if (data.subjectComments) {
      merged.subjectComments = { ...(existing.subjectComments || {}), ...data.subjectComments };
    }
    if (data.classTeacherRemark != null) {
      if (!['admin', 'superadmin'].includes(role)) {
        // Class teachers can set their own remark
        merged.classTeacherRemark = data.classTeacherRemark;
        merged.classTeacherCommentBy = userId;
        merged.classTeacherCommentAt = now;
      } else {
        merged.classTeacherRemark   = data.classTeacherRemark;
      }
    }
    if (data.principalRemark != null) {
      if (!['admin', 'superadmin'].includes(role)) {
        return E.forbidden(res, 'Only admins can set the principal remark');
      }
      merged.principalRemark   = data.principalRemark;
      merged.principalRemarkBy = userId;
      merged.principalRemarkAt = now;
    }

    const doc = await _model('report_card_snapshots').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { comments: merged, updatedBy: userId, updatedAt: now } },
      { new: true, runValidators: false }
    ).lean();

    return ok(res, { id: req.params.id, comments: doc.comments });
  } catch (err) { console.error('[report-cards/:id/comments PUT]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/report-cards/:id/pdf  — generate PDF
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/pdf', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    // Financial block check — admin can bypass with ?force=1
    if (snap.financialBlock && req.query.force !== '1' && !['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({
        error: 'Report card download is blocked — outstanding fee balance. Contact the school office.',
        financialBlock: true
      });
    }

    // Lazy-load attendance if not already in snapshot
    let attendance = snap.attendanceSummary;
    if (!attendance) {
      attendance = await _attendanceSummary(
        schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId
      );
    }

    // Load academic config for report display settings
    const config = await _loadConfig(schoolId);

    // ── Build PDF ───────────────────────────────────────────────
    let PDFDocument;
    try {
      PDFDocument = require('pdfkit');
    } catch {
      return res.status(501).json({ error: 'PDF generation is not available — pdfkit is not installed. Run: npm install pdfkit' });
    }

    const doc     = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="report-card-${snap.studentId}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    const PAGE_WIDTH = doc.page.width  - 80; // margins
    const COL_GAP    = 6;
    const GRAY       = '#555555';
    const DARK       = '#1a1a2e';
    const ACCENT     = '#2563eb';
    const LIGHT_GRAY = '#f3f4f6';
    const BORDER     = '#d1d5db';

    /* ── HEADER ── */
    doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold')
       .text(snap.schoolName || 'School Management System', 50, 52, { width: PAGE_WIDTH - 20 });
    doc.fontSize(10).font('Helvetica')
       .text('ACADEMIC REPORT CARD', 50, 75, { width: PAGE_WIDTH - 20 });
    doc.fillColor(DARK);
    doc.moveDown(0.5);

    /* ── STUDENT INFO BOX ── */
    const infoTop = 115;
    doc.rect(40, infoTop, PAGE_WIDTH, 70).fill(LIGHT_GRAY).stroke(BORDER);

    const col1 = 50, col2 = 280;
    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('STUDENT NAME', col1, infoTop + 8);
    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
       .text(snap.studentName || '—', col1, infoTop + 19, { width: 200 });

    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ADMISSION NO.', col2, infoTop + 8);
    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
       .text(snap.admissionNo || '—', col2, infoTop + 19);

    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('CLASS', col1, infoTop + 42);
    doc.fillColor(DARK).fontSize(10).font('Helvetica')
       .text(snap.className || '—', col1, infoTop + 52);

    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('TERM / ACADEMIC YEAR', col2, infoTop + 42);
    doc.fillColor(DARK).fontSize(10).font('Helvetica')
       .text([snap.termName, snap.academicYear].filter(Boolean).join(' — ') || '—', col2, infoTop + 52);

    /* ── RESULTS TABLE ── */
    const tableTop   = infoTop + 85;
    const colWidths  = [180, 55, 55, 60, 40, 50, 85]; // Subject | CA | Mid | Final | Score | Grade | Remarks
    const colLabels  = ['Subject', 'Classwork\n(%)', 'Mid-Term\n(%)', 'End-Term\n(%)', 'Score', 'Grade', 'Remarks'];
    const colX       = [];
    let cx = 40;
    for (const w of colWidths) { colX.push(cx); cx += w + COL_GAP; }

    // Table header
    doc.rect(40, tableTop, PAGE_WIDTH, 22).fill(ACCENT);
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
    colLabels.forEach((label, i) => {
      doc.text(label, colX[i] + 3, tableTop + 5, { width: colWidths[i] - 3, align: 'center' });
    });

    // Find assessment type keys for breakdown columns
    const weights   = snap.assessmentWeights || config.assessmentWeights;
    const caTypes   = weights.filter(w => !['midterm', 'final'].includes(w.assessmentType)).map(w => w.assessmentType);
    const midTypes  = ['midterm'];
    const finalTypes = ['final'];

    function _pickBreakdown(breakdown, types) {
      const values = types.map(t => breakdown?.[t]).filter(v => v != null);
      if (!values.length) return '—';
      return _round(values.reduce((s, n) => s + n, 0) / values.length).toFixed(1);
    }

    // Rows
    let rowY = tableTop + 22;
    const subjectEntries = Object.entries(snap.subjects || {});
    const passMark = snap.passMark ?? config.passMark ?? 40;

    subjectEntries.forEach(([subjectId, sub], idx) => {
      const rowBg = idx % 2 === 0 ? 'white' : LIGHT_GRAY;
      const rowH  = 18;
      doc.rect(40, rowY, PAGE_WIDTH, rowH).fill(rowBg);

      const failed = sub.finalScore != null && sub.finalScore < passMark;
      doc.fillColor(failed ? '#dc2626' : DARK).fontSize(8.5).font('Helvetica');

      const isBest = snap.subjectBest?.[subjectId];
      // Subject name (subjectId is used if name not available)
      doc.text((isBest ? '★ ' : '') + subjectId, colX[0] + 3, rowY + 5, { width: colWidths[0] - 3 });
      doc.text(_pickBreakdown(sub.breakdown, caTypes),    colX[1] + 3, rowY + 5, { width: colWidths[1] - 3, align: 'center' });
      doc.text(_pickBreakdown(sub.breakdown, midTypes),   colX[2] + 3, rowY + 5, { width: colWidths[2] - 3, align: 'center' });
      doc.text(_pickBreakdown(sub.breakdown, finalTypes), colX[3] + 3, rowY + 5, { width: colWidths[3] - 3, align: 'center' });
      doc.text(sub.finalScore?.toFixed(1) ?? '—',         colX[4] + 3, rowY + 5, { width: colWidths[4] - 3, align: 'center' });

      doc.font('Helvetica-Bold')
         .fillColor(sub.grade ? (failed ? '#dc2626' : ACCENT) : GRAY)
         .text(sub.grade || '—', colX[5] + 3, rowY + 5, { width: colWidths[5] - 3, align: 'center' });

      doc.font('Helvetica').fillColor(GRAY).fontSize(7.5)
         .text(sub.remarks || sub.descriptor || '', colX[6] + 3, rowY + 5, { width: colWidths[6] - 3 });

      rowY += rowH;
    });

    // Table border
    doc.rect(40, tableTop, PAGE_WIDTH, rowY - tableTop).stroke(BORDER);

    /* ── SUMMARY ROW ── */
    rowY += 8;
    doc.rect(40, rowY, PAGE_WIDTH, 28).fill('#eff6ff').stroke(BORDER);
    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
    doc.text(`Total Score: ${snap.totalScore?.toFixed(1) ?? '—'}`, 50, rowY + 5);
    doc.text(`Average: ${snap.averageScore?.toFixed(1) ?? '—'}%`, 160, rowY + 5);
    if (config.showGPA) doc.text(`GPA: ${snap.gpa?.toFixed(2) ?? '—'}`, 260, rowY + 5);

    if (config.rankingEnabled && snap.rankings?.class) {
      const r = snap.rankings.class;
      doc.fillColor(ACCENT).text(`Class Rank: ${r.rank} / ${r.outOf}`, 350, rowY + 5);
    }
    rowY += 28;

    /* ── ATTENDANCE ── */
    if (config.showAttendanceSummary && attendance) {
      rowY += 10;
      doc.rect(40, rowY, PAGE_WIDTH, 26).fill(LIGHT_GRAY).stroke(BORDER);
      doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ATTENDANCE', 50, rowY + 4);
      doc.fillColor(DARK).fontSize(9).font('Helvetica')
         .text(
           `Days Present: ${attendance.daysPresent}   Days Absent: ${attendance.daysAbsent}   ` +
           `Total School Days: ${attendance.totalSchoolDays}   ` +
           (attendance.percentage != null ? `Attendance: ${attendance.percentage}%` : ''),
           50, rowY + 14, { width: PAGE_WIDTH - 20 }
         );
      rowY += 26;
    }

    /* ── COMMENTS ── */
    const comments = snap.comments || {};
    rowY += 14;
    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("CLASS TEACHER'S REMARK:", 40, rowY);
    rowY += 12;
    doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(comments.classTeacherRemark || '— No remark entered —', 46, rowY + 9, { width: PAGE_WIDTH - 12 });
    rowY += 38;

    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("PRINCIPAL'S COMMENT:", 40, rowY);
    rowY += 12;
    doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(comments.principalRemark || '— No comment entered —', 46, rowY + 9, { width: PAGE_WIDTH - 12 });
    rowY += 42;

    /* ── SIGNATURES ── */
    const sigY = rowY + 10;
    const sigW = (PAGE_WIDTH - 20) / 2;
    doc.moveTo(40, sigY + 20).lineTo(40 + sigW - 10, sigY + 20).stroke(DARK);
    doc.moveTo(40 + sigW + 10, sigY + 20).lineTo(40 + PAGE_WIDTH, sigY + 20).stroke(DARK);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica')
       .text(config.classTeacherSignatureLabel || 'Class Teacher', 40, sigY + 24, { width: sigW })
       .text(config.principalSignatureLabel || 'Principal', 40 + sigW + 10, sigY + 24, { width: sigW });

    /* ── FOOTER ── */
    const footerY = doc.page.height - 55;
    doc.rect(40, footerY, PAGE_WIDTH, 0.5).fill(BORDER);
    doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
       .text(config.footerNote || 'This report card is computer-generated.', 40, footerY + 6, {
         width: PAGE_WIDTH, align: 'center'
       });
    doc.text(`Generated: ${new Date().toUTCString()}`, 40, footerY + 18, {
      width: PAGE_WIDTH, align: 'center'
    });

    doc.end();
  } catch (err) { console.error('[report-cards/:id/pdf]', err); return E.serverError(res); }
});

module.exports = router;
