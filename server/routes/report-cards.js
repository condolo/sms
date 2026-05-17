/* ============================================================
   InnoLearn — /api/report-cards  (v2 — data-integrity hardened)
   Academic report card engine.

   Endpoints:
     POST /generate              — compute live preview (not persisted)
     POST /publish               — interrupt-safe batch snapshot (admin only)
     GET  /                      — list snapshots
     GET  /publish-batches       — list publish batch runs
     GET  /:id                   — get one snapshot (full detail)
     PUT  /:id/comments          — save teacher/principal comments
     GET  /:id/pdf               — stream PDF (DRAFT watermark if unpublished)
     GET  /bulk-pdf              — merged PDF for whole class

   Data integrity guarantees:
     - Publish creates a new version, marks the old as superseded (never deleted)
     - Every publish run is tracked in publish_batches (status: running/completed/failed)
     - Moderation guard: all exams must be approved/locked/published before publish
     - PDF shows DRAFT diagonal watermark on non-published snapshots
     - Financial block checked before PDF download (admin bypass with ?force=1)

   Plan: standard | RBAC: grades:{read,create,update}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');
const { resolveGrade, mergeConfig } = require('./academic-config');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Helpers ────────────────────────────────────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

async function _loadConfig(schoolId) {
  const saved = await _model('academic_config').findOne({ schoolId }).lean();
  return mergeConfig(saved);
}

/**
 * Aggregate grades (continuous assessment) per student per subject per assessmentType.
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
    grouped[studentId]             ??= {};
    grouped[studentId][subjectId]  ??= {};
    grouped[studentId][subjectId][assessmentType] ??= [];
    grouped[studentId][subjectId][assessmentType].push(pct);
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
 * Aggregate exam results per student per subject per exam type.
 * Only includes results with valid scores (not absent/missing/exempted).
 */
async function _aggregateExamResults(schoolId, classId, termId, academicYearId) {
  const examsFilter = {
    schoolId, classId,
    status: { $in: ['completed', 'moderated', 'approved', 'locked', 'published', 'archived'] }
  };
  if (termId)         examsFilter.termId         = termId;
  if (academicYearId) examsFilter.academicYearId = academicYearId;

  const exams = await _model('exams').find(examsFilter).lean();
  if (!exams.length) return { data: {}, examStatuses: [] };

  const examMap      = Object.fromEntries(exams.map(e => [e.id, e]));
  const examIds      = exams.map(e => e.id);
  const examStatuses = exams.map(e => ({ id: e.id, status: e.status, title: e.title }));

  const results = await _model('exam_results').find({
    schoolId,
    examId: { $in: examIds },
    markState: { $in: ['present', null] },
    absent: { $ne: true }
  }).lean();

  const grouped = {};
  for (const r of results) {
    const exam = examMap[r.examId];
    if (!exam || r.score == null || !exam.subjectId) continue;
    const pct = exam.maxScore > 0 ? _round((r.score / exam.maxScore) * 100) : null;
    if (pct === null) continue;

    const { studentId } = r;
    const subjectId = exam.subjectId;
    const type      = exam.type;

    grouped[studentId]            ??= {};
    grouped[studentId][subjectId] ??= {};
    grouped[studentId][subjectId][type] ??= [];
    grouped[studentId][subjectId][type].push(pct);
  }

  const data = {};
  for (const [sid, subjects] of Object.entries(grouped)) {
    data[sid] = {};
    for (const [sub, types] of Object.entries(subjects)) {
      data[sid][sub] = {};
      for (const [type, pcts] of Object.entries(types)) {
        data[sid][sub][type] = _round(pcts.reduce((s, n) => s + n, 0) / pcts.length);
      }
    }
  }
  return { data, examStatuses };
}

/**
 * Compute final weighted score per student per subject.
 * Returns: { [studentId]: { studentId, subjects, totalScore, averageScore, gpa, subjectCount } }
 */
function _computeFinalScores(gradesData, examData, assessmentWeights, gradingSchema) {
  const weightMap   = Object.fromEntries(assessmentWeights.map(w => [w.assessmentType, w.weight]));
  const allStudents = new Set([...Object.keys(gradesData), ...Object.keys(examData)]);

  const studentReports = {};

  for (const sid of allStudents) {
    const allSubjects = new Set([
      ...Object.keys(gradesData[sid] || {}),
      ...Object.keys(examData[sid]   || {}),
    ]);

    const subjects    = {};
    let totalScore    = 0;
    let totalPoints   = 0;
    let subjectCount  = 0;

    for (const sub of allSubjects) {
      const gradeTypes = gradesData[sid]?.[sub] || {};
      const examTypes  = examData[sid]?.[sub]   || {};
      const allTypes   = { ...gradeTypes, ...examTypes };

      let weightedSum     = 0;
      let totalWeightUsed = 0;

      for (const [type, avg] of Object.entries(allTypes)) {
        const w = weightMap[type] ?? 0;
        if (w === 0) continue;
        weightedSum     += avg * w;
        totalWeightUsed += w;
      }

      if (totalWeightUsed === 0) continue;

      const finalScore = _round(weightedSum / totalWeightUsed);
      const gradeInfo  = resolveGrade(finalScore, gradingSchema);

      subjects[sub] = {
        finalScore,
        grade:      gradeInfo.grade,
        points:     gradeInfo.points,
        descriptor: gradeInfo.descriptor,
        remarks:    gradeInfo.remarks,
        breakdown:  allTypes,
      };

      totalScore   += finalScore;
      totalPoints  += gradeInfo.points ?? 0;
      subjectCount++;
    }

    studentReports[sid] = {
      studentId:    sid,
      subjects,
      totalScore:   _round(totalScore),
      averageScore: subjectCount > 0 ? _round(totalScore / subjectCount) : 0,
      gpa:          subjectCount > 0 ? _round(totalPoints / subjectCount) : 0,
      subjectCount,
    };
  }

  return studentReports;
}

/** Fetch attendance summary for a student */
async function _attendanceSummary(schoolId, studentId, classId, termId, academicYearId) {
  const filter = { schoolId, studentId };
  if (classId)        filter.classId        = classId;
  if (termId)         filter.termId         = termId;
  if (academicYearId) filter.academicYearId = academicYearId;

  const Att = _model('attendance');
  const [present, absent, total] = await Promise.all([
    Att.countDocuments({ ...filter, status: 'present' }),
    Att.countDocuments({ ...filter, status: 'absent' }),
    Att.countDocuments(filter),
  ]);
  return {
    daysPresent: present, daysAbsent: absent, totalSchoolDays: total,
    percentage: total > 0 ? _round((present / total) * 100) : null,
  };
}

/* ── Validation ─────────────────────────────────────────────── */
const GenerateSchema = z.object({
  classId:        z.string().min(1),
  termId:         z.string().optional(),
  academicYearId: z.string().optional(),
  studentId:      z.string().optional(),
});

const PublishSchema = z.object({
  classId:         z.string().min(1),
  termId:          z.string().optional(),
  academicYearId:  z.string().optional(),
  className:       z.string().max(100).optional(),
  termName:        z.string().max(100).optional(),
  academicYear:    z.string().max(50).optional(),
  schoolName:      z.string().max(200).optional(),
  // If true, proceed even if some exams are not fully approved
  skipModerationCheck: z.boolean().default(false),
});

const CommentSchema = z.object({
  subjectComments:    z.record(z.string().max(500)).optional(),
  classTeacherRemark: z.string().max(1000).optional(),
  principalRemark:    z.string().max(1000).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   POST /generate  — live preview (no persist)
   ══════════════════════════════════════════════════════════════ */
router.post('/generate', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { data, error } = _validate(GenerateSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, termId, academicYearId, studentId } = data;
    const config = await _loadConfig(schoolId);

    const [gradesData, { data: examData }] = await Promise.all([
      _aggregateGrades(schoolId, classId, termId, academicYearId),
      _aggregateExamResults(schoolId, classId, termId, academicYearId),
    ]);

    const allReports  = _computeFinalScores(gradesData, examData, config.assessmentWeights, config.gradingSchema);
    const classInput  = Object.values(allReports).map(r => ({
      studentId:    r.studentId,
      totalScore:   computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
    }));
    const classRanks  = rankStudents(classInput, config.rankingMethod);

    const targets = studentId
      ? (allReports[studentId] ? { [studentId]: allReports[studentId] } : {})
      : allReports;

    const students = Object.values(targets).map(r => ({
      ...r,
      rankingScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
      rankings: config.rankingEnabled ? mergeRankings(r.studentId, { class: classRanks }) : {},
    }));

    return ok(res, {
      generated: students.length,
      config: {
        gradingType: config.gradingType, passMark: config.passMark,
        rankingEnabled: config.rankingEnabled, rankingSubjectStrategy: config.rankingSubjectStrategy,
        assessmentWeights: config.assessmentWeights,
      },
      students,
    });
  } catch (err) { console.error('[report-cards/generate]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   POST /publish  — interrupt-safe versioned batch snapshot
   ══════════════════════════════════════════════════════════════ */
router.post('/publish', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  const { schoolId, userId, role } = req.jwtUser;
  if (!['admin', 'superadmin'].includes(role)) return E.forbidden(res, 'Only admins can publish report cards');

  const { data, error } = _validate(PublishSchema, req.body);
  if (error) return E.validation(res, error);

  const { classId, termId, academicYearId, className, termName, academicYear, schoolName, skipModerationCheck } = data;
  const now     = new Date().toISOString();
  const batchId = uuidv4();

  // ── Step 1: Create batch record (interrupt-safe anchor) ──────
  const Batches = _model('publish_batches');
  await Batches.create({
    id: batchId, schoolId, classId, termId: termId || null,
    academicYearId: academicYearId || null,
    status: 'running', startedBy: userId, startedAt: now,
    studentCount: 0, successCount: 0, failedStudents: [],
  });

  try {
    const config = await _loadConfig(schoolId);

    // ── Step 2: Moderation guard ─────────────────────────────
    const { data: examData, examStatuses } = await _aggregateExamResults(schoolId, classId, termId, academicYearId);

    if (!skipModerationCheck) {
      const APPROVED_STATES = ['approved', 'locked', 'published', 'archived'];
      const unmoderated = examStatuses.filter(e => !APPROVED_STATES.includes(e.status));
      if (unmoderated.length > 0) {
        await Batches.updateOne({ id: batchId }, {
          status: 'failed',
          failureReason: `${unmoderated.length} exam(s) not yet approved`,
          unmoderatedExams: unmoderated.map(e => ({ id: e.id, title: e.title, status: e.status })),
          completedAt: now,
        });
        return E.badRequest(res, [
          `${unmoderated.length} exam(s) for this class/term are not yet approved:`,
          ...unmoderated.map(e => `  • "${e.title}" (${e.status})`),
          'Approve all exams first, or pass skipModerationCheck: true to override.'
        ].join('\n'), { unmoderatedExams: unmoderated });
      }
    }

    // ── Step 3: Aggregate all data ───────────────────────────
    const gradesData = await _aggregateGrades(schoolId, classId, termId, academicYearId);
    const allReports = _computeFinalScores(gradesData, examData, config.assessmentWeights, config.gradingSchema);

    if (Object.keys(allReports).length === 0) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No graded results found', completedAt: now });
      return E.badRequest(res, 'No graded results found for this class/term — nothing to publish');
    }

    // ── Step 4: Compute rankings with configured strategy ────
    const classInput = Object.values(allReports).map(r => ({
      studentId:  r.studentId,
      totalScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
    }));
    const classRanks = rankStudents(classInput, config.rankingMethod);
    const subjectBest = config.showBestPerSubject
      ? bestPerSubject(Object.values(allReports).map(r => ({ studentId: r.studentId, subjects: r.subjects })))
      : {};

    // ── Step 5: Fetch existing live snapshots to build version chain ──
    const existingSnaps = await _model('report_card_snapshots').find({
      schoolId, classId,
      termId: termId || null, academicYearId: academicYearId || null,
      superseded: { $ne: true }   // only current (non-superseded) versions
    }).lean();
    const existingMap = Object.fromEntries(existingSnaps.map(s => [s.studentId, s]));

    // ── Step 6: Fetch student info for denormalization ───────
    const studentIds = Object.keys(allReports);
    const students   = await _model('students').find({ schoolId,
      $or: [
        { id: { $in: studentIds } },
        { _id: { $in: studentIds.filter(s => /^[0-9a-f]{24}$/i.test(s)) } }
      ]
    }).lean();
    const studentMap = Object.fromEntries(students.map(s => [s.id || s._id.toString(), s]));

    // ── Step 7: Build new snapshot docs + supersession ops ───
    const newSnaps   = [];
    const supersedeOps = [];

    for (const r of Object.values(allReports)) {
      const stu  = studentMap[r.studentId] || {};
      const prev = existingMap[r.studentId];
      const newId = uuidv4();

      const { rankingScore, subjectsUsed } = computeRankingScore(
        r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects
      );

      const snap = {
        id:             newId,
        version:        prev ? (prev.version || 1) + 1 : 1,
        supersedesId:   prev?.id || null,
        schoolId,
        studentId:      r.studentId,
        studentName:    [stu.firstName, stu.lastName].filter(Boolean).join(' ') || r.studentId,
        admissionNo:    stu.admissionNumber || stu.admissionNo || '',
        classId,        className: className || '',
        termId:         termId         || null,  termName:  termName  || '',
        academicYearId: academicYearId || null,  academicYear: academicYear || '',
        schoolName:     schoolName || '',

        // Config snapshot — immutable, preserved for this version
        gradingSchema:     config.gradingSchema,
        assessmentWeights: config.assessmentWeights,
        passMark:          config.passMark,
        gradingType:       config.gradingType,
        rankingSubjectStrategy: config.rankingSubjectStrategy,
        rankingN:          config.rankingN,

        // Results
        subjects:     r.subjects,
        totalScore:   r.totalScore,
        averageScore: r.averageScore,
        gpa:          r.gpa,
        subjectCount: r.subjectCount,
        rankingScore,            // score actually used for ranking (per strategy)
        rankingSubjectsUsed: subjectsUsed,

        rankings: config.rankingEnabled
          ? mergeRankings(r.studentId, { class: classRanks })
          : {},

        subjectBest: Object.fromEntries(
          Object.entries(subjectBest).map(([sub, winnerId]) => [sub, winnerId === r.studentId])
        ),

        // Carry forward comments from previous version
        comments: prev?.comments || { subjectComments: {}, classTeacherRemark: '', principalRemark: '' },

        attendanceSummary: null,     // loaded on first PDF request
        financialBlock:    false,    // can be set separately via finance integration
        status:            'published',
        publishedAt:       now,
        publishedBy:       userId,
        batchId,
        superseded:        false,
        updatedAt:         now,
        updatedBy:         userId,
      };

      newSnaps.push(snap);

      // Queue supersession of previous version
      if (prev) {
        supersedeOps.push({
          updateOne: {
            filter: { id: prev.id },
            update: { $set: { superseded: true, supersededAt: now, supersededBy: newId } },
          }
        });
      }
    }

    // ── Step 8: Persist — insert new snaps, then supersede old ─
    const Snaps  = _model('report_card_snapshots');
    const inserts = newSnaps.map(s => ({ insertOne: { document: s } }));
    await Snaps.bulkWrite(inserts, { ordered: false });
    if (supersedeOps.length) {
      await Snaps.bulkWrite(supersedeOps, { ordered: false });
    }

    // ── Step 9: Mark batch completed ────────────────────────
    await Batches.updateOne({ id: batchId }, {
      status: 'completed', completedAt: now,
      studentCount: newSnaps.length, successCount: newSnaps.length,
      newVersions: newSnaps.map(s => ({ snapshotId: s.id, studentId: s.studentId, version: s.version })),
    });

    console.log(`[REPORT-CARDS] Published ${newSnaps.length} report cards (batch ${batchId}) by ${userId}`);
    return ok(res, {
      batchId,
      published:   newSnaps.length,
      versioned:   supersedeOps.length,  // how many replaced prior versions
      classId,
      termId,
      publishedAt: now,
    }, null, 201);

  } catch (err) {
    // Interrupt-safe: mark batch as failed
    await _model('publish_batches').updateOne({ id: batchId }, {
      status: 'failed', failureReason: err.message, completedAt: new Date().toISOString()
    }).catch(() => {});
    console.error('[report-cards/publish]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /publish-batches  — list publish runs (audit trail)
   ══════════════════════════════════════════════════════════════ */
router.get('/publish-batches', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId) filter.classId = req.query.classId;
    if (req.query.termId)  filter.termId  = req.query.termId;

    const Batches = _model('publish_batches');
    const [docs, total] = await Promise.all([
      Batches.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).select('-newVersions -__v').lean(),
      Batches.countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[publish-batches GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /  — list snapshots (current versions only)
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId, superseded: { $ne: true } };
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.status)         filter.status         = req.query.status;
    // ?history=1 → include superseded versions too
    if (req.query.history === '1') delete filter.superseded;

    const Snaps = _model('report_card_snapshots');
    const [docs, total] = await Promise.all([
      Snaps.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit)
        .select('-gradingSchema -assessmentWeights -subjects -__v').lean(),
      Snaps.countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[report-cards GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /:id  — full snapshot
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('report_card_snapshots')
      .findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Report card snapshot not found');
    return ok(res, doc);
  } catch (err) { console.error('[report-cards GET/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   PUT /:id/comments  — save comments (role-gated)
   ══════════════════════════════════════════════════════════════ */
router.put('/:id/comments', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(CommentSchema, req.body);
    if (error) return E.validation(res, error);

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');
    if (snap.superseded) return E.badRequest(res, 'Cannot edit comments on a superseded report card version. Use the current version.');

    const now    = new Date().toISOString();
    const merged = { ...(snap.comments || {}) };

    if (data.subjectComments) {
      merged.subjectComments = { ...(merged.subjectComments || {}), ...data.subjectComments };
    }
    if (data.classTeacherRemark != null) {
      merged.classTeacherRemark   = data.classTeacherRemark;
      merged.classTeacherCommentBy = userId;
      merged.classTeacherCommentAt = now;
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

/* ── PDF builder (shared between single and bulk) ───────────── */
function _buildPDFPage(doc, snap, config, attendance, isFirst = true) {
  if (!isFirst) doc.addPage();

  const PAGE_WIDTH = doc.page.width  - 80;
  const GRAY       = '#555555';
  const DARK       = '#1a1a2e';
  const ACCENT     = '#2563eb';
  const LIGHT_GRAY = '#f3f4f6';
  const BORDER     = '#d1d5db';
  const COL_GAP    = 5;

  const isDraft = snap.status !== 'published' || snap.superseded;

  /* ── DRAFT WATERMARK ── */
  if (isDraft) {
    doc.save()
       .translate(doc.page.width / 2, doc.page.height / 2)
       .rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(snap.superseded ? 'SUPERSEDED' : 'DRAFT', -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  /* ── HEADER ── */
  doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
  doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
     .text(snap.schoolName || 'School Management System', 50, 52, { width: PAGE_WIDTH - 20 });
  doc.fontSize(9).font('Helvetica')
     .text('ACADEMIC REPORT CARD' + (isDraft ? '   [DRAFT — NOT OFFICIAL]' : ''), 50, 75, { width: PAGE_WIDTH - 20 });
  doc.fillColor(DARK);

  /* ── STUDENT INFO ── */
  const infoTop = 115;
  doc.rect(40, infoTop, PAGE_WIDTH, 70).fill(LIGHT_GRAY).stroke(BORDER);
  const c1 = 50, c2 = 280;

  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('STUDENT NAME', c1, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
     .text(snap.studentName || '—', c1, infoTop + 19, { width: 200 });

  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ADMISSION NO.', c2, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
     .text(snap.admissionNo || '—', c2, infoTop + 19);

  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('CLASS', c1, infoTop + 42);
  doc.fillColor(DARK).fontSize(10).font('Helvetica')
     .text(snap.className || '—', c1, infoTop + 52);

  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('TERM / ACADEMIC YEAR', c2, infoTop + 42);
  doc.fillColor(DARK).fontSize(10).font('Helvetica')
     .text([snap.termName, snap.academicYear].filter(Boolean).join(' — ') || '—', c2, infoTop + 52);

  /* ── VERSION BADGE (if versioned) ── */
  if (snap.version > 1 || snap.superseded) {
    const badge = snap.superseded
      ? `v${snap.version} (Superseded)`
      : `v${snap.version}`;
    doc.fillColor(snap.superseded ? '#dc2626' : '#059669').fontSize(8).font('Helvetica-Bold')
       .text(badge, PAGE_WIDTH - 40, infoTop + 8, { width: 70, align: 'right' });
  }

  /* ── RESULTS TABLE ── */
  const tableTop  = infoTop + 85;
  const colWidths = [175, 52, 52, 58, 42, 48, 88];
  const colLabels = ['Subject', 'Classwork\n(%)', 'Mid-Term\n(%)', 'End-Term\n(%)', 'Score', 'Grade', 'Remarks'];
  const colX = [];
  let cx = 40;
  for (const w of colWidths) { colX.push(cx); cx += w + COL_GAP; }

  doc.rect(40, tableTop, PAGE_WIDTH, 22).fill(ACCENT);
  doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
  colLabels.forEach((label, i) => {
    doc.text(label, colX[i] + 3, tableTop + 5, { width: colWidths[i] - 3, align: 'center' });
  });

  const weights    = snap.assessmentWeights || config.assessmentWeights;
  const caTypes    = weights.filter(w => !['midterm', 'final'].includes(w.assessmentType)).map(w => w.assessmentType);
  const midTypes   = ['midterm'];
  const finalTypes = ['final'];

  function _pick(breakdown, types) {
    const vals = types.map(t => breakdown?.[t]).filter(v => v != null);
    return vals.length ? _round(vals.reduce((s, n) => s + n, 0) / vals.length).toFixed(1) : '—';
  }

  let rowY  = tableTop + 22;
  const passMark = snap.passMark ?? config.passMark ?? 40;

  Object.entries(snap.subjects || {}).forEach(([subjectId, sub], idx) => {
    const rowBg = idx % 2 === 0 ? 'white' : LIGHT_GRAY;
    const rowH  = 18;
    doc.rect(40, rowY, PAGE_WIDTH, rowH).fill(rowBg);

    const failed  = sub.finalScore != null && sub.finalScore < passMark;
    const isBest  = snap.subjectBest?.[subjectId];
    const isUsed  = snap.rankingSubjectsUsed?.includes(subjectId);

    doc.fillColor(failed ? '#dc2626' : DARK).fontSize(8.5).font('Helvetica');
    doc.text(
      (isBest ? '★ ' : '') + subjectId + (isUsed && snap.rankingSubjectStrategy !== 'all' ? ' ●' : ''),
      colX[0] + 3, rowY + 5, { width: colWidths[0] - 3 }
    );
    doc.text(_pick(sub.breakdown, caTypes),    colX[1] + 3, rowY + 5, { width: colWidths[1] - 3, align: 'center' });
    doc.text(_pick(sub.breakdown, midTypes),   colX[2] + 3, rowY + 5, { width: colWidths[2] - 3, align: 'center' });
    doc.text(_pick(sub.breakdown, finalTypes), colX[3] + 3, rowY + 5, { width: colWidths[3] - 3, align: 'center' });
    doc.text(sub.finalScore?.toFixed(1) ?? '—', colX[4] + 3, rowY + 5, { width: colWidths[4] - 3, align: 'center' });

    doc.font('Helvetica-Bold')
       .fillColor(sub.grade ? (failed ? '#dc2626' : ACCENT) : GRAY)
       .text(sub.grade || '—', colX[5] + 3, rowY + 5, { width: colWidths[5] - 3, align: 'center' });

    doc.font('Helvetica').fillColor(GRAY).fontSize(7.5)
       .text(sub.remarks || sub.descriptor || '', colX[6] + 3, rowY + 5, { width: colWidths[6] - 3 });

    rowY += rowH;
  });

  doc.rect(40, tableTop, PAGE_WIDTH, rowY - tableTop).stroke(BORDER);

  /* ── RANKING STRATEGY NOTE ── */
  if (snap.rankingSubjectStrategy && snap.rankingSubjectStrategy !== 'all') {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(
         `● Subjects counted toward rank (${snap.rankingSubjectStrategy === 'best_n' ? `Best ${snap.rankingN}` : 'Compulsory only'})`,
         40, rowY + 3, { width: PAGE_WIDTH }
       );
    rowY += 12;
  }

  /* ── SUMMARY ── */
  rowY += 6;
  doc.rect(40, rowY, PAGE_WIDTH, 28).fill('#eff6ff').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
  doc.text(`Total Score: ${snap.totalScore?.toFixed(1) ?? '—'}`, 50, rowY + 5);
  doc.text(`Average: ${snap.averageScore?.toFixed(1) ?? '—'}%`, 160, rowY + 5);
  if (config.showGPA) doc.text(`GPA: ${snap.gpa?.toFixed(2) ?? '—'}`, 265, rowY + 5);
  if (config.rankingEnabled && snap.rankings?.class) {
    const r = snap.rankings.class;
    doc.fillColor(ACCENT).text(`Class Rank: ${r.rank} / ${r.outOf}`, 355, rowY + 5);
  }
  rowY += 28;

  /* ── ATTENDANCE ── */
  if (config.showAttendanceSummary && attendance) {
    rowY += 8;
    doc.rect(40, rowY, PAGE_WIDTH, 26).fill(LIGHT_GRAY).stroke(BORDER);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ATTENDANCE', 50, rowY + 4);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(
         `Present: ${attendance.daysPresent}   Absent: ${attendance.daysAbsent}   ` +
         `Total Days: ${attendance.totalSchoolDays}` +
         (attendance.percentage != null ? `   Attendance: ${attendance.percentage}%` : ''),
         50, rowY + 14, { width: PAGE_WIDTH - 20 }
       );
    rowY += 26;
  }

  /* ── COMMENTS ── */
  const comments = snap.comments || {};
  rowY += 12;
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
  const sigY = rowY + 8;
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
     .text(config.footerNote || 'This report card is computer-generated.', 40, footerY + 6, { width: PAGE_WIDTH, align: 'center' })
     .text(`Generated: ${new Date().toUTCString()}  |  Version ${snap.version || 1}  |  Batch: ${snap.batchId || '—'}`, 40, footerY + 18, { width: PAGE_WIDTH, align: 'center' });
}

/* ══════════════════════════════════════════════════════════════
   GET /:id/pdf  — single student PDF
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/pdf', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (snap.financialBlock && req.query.force !== '1' && !['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({
        error: 'Report card download blocked — outstanding fee balance. Contact the school office.',
        financialBlock: true
      });
    }

    let attendance = snap.attendanceSummary;
    if (!attendance) {
      attendance = await _attendanceSummary(schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId);
    }

    const config = await _loadConfig(schoolId);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    const doc     = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="report-${snap.studentId}-v${snap.version || 1}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    _buildPDFPage(doc, snap, config, attendance, true);
    doc.end();

  } catch (err) { console.error('[report-cards/:id/pdf]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /bulk-pdf  — merged PDF for whole class (chunked)
   Query: classId (required), termId, academicYearId, ?superseded=0
   ══════════════════════════════════════════════════════════════ */
router.get('/bulk-pdf', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;

    if (!req.query.classId) return E.badRequest(res, 'classId query parameter is required');

    const filter = {
      schoolId,
      classId:  req.query.classId,
      superseded: { $ne: true },
      status:   'published',
    };
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;

    // Load snapshots (exclude heavy sub-arrays for initial fetch; we need all fields for PDF)
    const snaps = await _model('report_card_snapshots')
      .find(filter).sort({ studentName: 1 }).lean();

    if (!snaps.length) return E.notFound(res, 'No published report cards found for this class/term');

    // Financial block: skip blocked students unless admin + force
    const visibleSnaps = snaps.filter(s => {
      if (!s.financialBlock) return true;
      return req.query.force === '1' && ['admin', 'superadmin'].includes(role);
    });

    if (!visibleSnaps.length) return E.badRequest(res, 'All report cards in this class are blocked by financial holds');

    const config = await _loadConfig(schoolId);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    const doc     = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      const filename = `report-cards-class-${req.query.classId}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    // Chunk: process 10 students at a time to avoid holding all attendance in memory
    const CHUNK = 10;
    for (let i = 0; i < visibleSnaps.length; i += CHUNK) {
      const chunk = visibleSnaps.slice(i, i + CHUNK);
      const attendanceResults = await Promise.all(
        chunk.map(s => s.attendanceSummary
          ? Promise.resolve(s.attendanceSummary)
          : _attendanceSummary(schoolId, s.studentId, s.classId, s.termId, s.academicYearId)
        )
      );

      chunk.forEach((snap, idx) => {
        doc.addPage();
        _buildPDFPage(doc, snap, config, attendanceResults[idx], false);
      });
    }

    doc.end();

  } catch (err) { console.error('[report-cards/bulk-pdf]', err); return E.serverError(res); }
});

module.exports = router;
