/* ============================================================
   Msingi — /api/report-cards  (v3 — production hardened)

   Endpoints:
     POST /generate              — live preview (not persisted)
     POST /publish               — versioned batch snapshot (admin only)
     GET  /publish-batches       — audit trail of publish runs
     GET  /                      — list snapshots
     GET  /:id                   — full snapshot detail
     PUT  /:id/comments          — save comments (role-gated)
     GET  /:id/pdf               — single PDF (DRAFT watermark if not published)
     GET  /bulk-pdf              — class-wide merged PDF (cursor-streamed)

   Data integrity:
     - Calculations delegated to server/utils/academic-calc.js (single source)
     - Publish is interrupt-safe (publish_batches collection)
     - Snapshots are versioned (superseded never deleted)
     - Moderation guard enforced; bypass requires reason + audit
     - Parent/student role: blocked from superseded snapshots
     - Bulk PDF uses cursor — no full collection load into RAM

   Plan: standard | RBAC: grades:{read,create,update}
   ============================================================ */
const express   = require('express');
const { z }     = require('zod');
const { v4: uuidv4 } = require('uuid');
const mongoose  = require('mongoose');
const crypto    = require('crypto');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');
const { mergeConfig }    = require('./academic-config');
const { isYearArchived } = require('../utils/archival');
const {
  aggregateGrades,
  aggregateExamResults,
  aggregateAssessmentMarks,
  computeFinalScores,
  attendanceSummary,
  attachDeviations,
} = require('../utils/academic-calc');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Config loader (legacy academic_config) ─────────────────── */
async function _loadConfig(schoolId) {
  const saved = await _model('academic_config').findOne({ schoolId }).lean();
  return mergeConfig(saved);
}

/* ── Report ID generator — RC-YYYY-TN-XXXXXX ───────────────── */
async function _nextReportId(schoolId, termNumber, academicYear) {
  const year = academicYear ? String(academicYear).slice(0, 4) : String(new Date().getFullYear());
  const tn   = String(termNumber || 1).padStart(1, '0');
  const key  = `rc_${schoolId}_${year}_${tn}`;
  const ctr  = await _model('report_card_counters').findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { schoolId, year, termNumber: tn } },
    { upsert: true, new: true }
  ).lean();
  const seq = String(ctr.seq).padStart(6, '0');
  return `RC-${year}-${tn}-${seq}`;
}

/* ── SHA-256 hash of immutable snapshot content ─────────────── */
function _hashSnapshot(snap) {
  const payload = JSON.stringify({
    studentId:   snap.studentId,
    studentName: snap.studentName,
    admissionNo: snap.admissionNo,
    classId:     snap.classId,
    termNumber:  snap.termNumber,
    academicYear: snap.academicYear,
    subjects:    snap.subjects,
    totalScore:  snap.totalScore,
    averageScore: snap.averageScore,
    gpa:         snap.gpa,
    rankings:    snap.rankings,
    publishedAt: snap.publishedAt,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/* ── CA config loader (assessment_config + grade_boundaries) ── */
/**
 * Load the school's CA-system configuration:
 *   - customTypes  from assessment_config   (the school's CA type definitions + weights)
 *   - gradeScale   from grade_boundaries    (the school's default grading scale)
 *
 * Both can be null if the school hasn't configured them yet.
 */
async function _loadCaConfig(schoolId) {
  const [assessmentCfg, defaultScale] = await Promise.all([
    _model('assessment_config').findOne({ schoolId, academicYearId: null }).lean(),
    _model('grade_boundaries').findOne({ schoolId, isDefault: true }).lean(),
  ]);
  return {
    customTypes: assessmentCfg?.customTypes ?? [],
    gradeScale:  defaultScale ?? null,
  };
}

/**
 * Convert assessment_config.customTypes → assessmentWeights format expected by computeFinalScores.
 * Returns null when customTypes is empty (caller should fall back to academic_config.assessmentWeights).
 */
function _convertCustomTypesToWeights(customTypes) {
  if (!Array.isArray(customTypes) || !customTypes.length) return null;
  const total = customTypes.reduce((s, t) => s + (t.weight ?? 0), 0);
  if (total <= 0) return null;
  return customTypes.map(t => ({
    assessmentType: t.key,
    label:          t.label || t.key,
    weight:         t.weight ?? 0,
  }));
}

/**
 * Merge old gradebook data (grades collection) with new CA marks data (assessment_marks).
 * CA marks win on conflict per assessmentType within the same student+subject.
 */
function _mergeGradeData(gradesData, caData) {
  const merged = {};
  const allStudents = new Set([...Object.keys(gradesData), ...Object.keys(caData)]);
  for (const sid of allStudents) {
    merged[sid] = {};
    const oldSubjects = gradesData[sid] || {};
    const caSubjects  = caData[sid]     || {};
    const allSubjects = new Set([...Object.keys(oldSubjects), ...Object.keys(caSubjects)]);
    for (const sub of allSubjects) {
      // Spread old first, then CA overwrites individual type keys
      merged[sid][sub] = { ...(oldSubjects[sub] || {}), ...(caSubjects[sub] || {}) };
    }
  }
  return merged;
}

/* ── Restricted roles (parents/students see only current versions) ── */
const RESTRICTED_ROLES = ['parent', 'student', 'guardian'];

/* ── Validation ─────────────────────────────────────────────── */
const GenerateSchema = z.object({
  classId:        z.string().min(1),
  termId:         z.string().optional(),
  termNumber:     z.number().int().min(1).max(3).optional(),
  academicYearId: z.string().optional(),
  studentId:      z.string().optional(),
});

const PublishSchema = z.object({
  classId:         z.string().min(1),
  termId:          z.string().optional(),
  termNumber:      z.number().int().min(1).max(3).optional(),
  academicYearId:  z.string().optional(),
  className:       z.string().max(100).optional(),
  termName:        z.string().max(100).optional(),
  academicYear:    z.string().max(50).optional(),
  schoolName:      z.string().max(200).optional(),
  skipModerationCheck: z.boolean().default(false),
  // Required when skipModerationCheck is true
  skipReason:      z.string().max(500).optional(),
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
   POST /generate  — live preview (not persisted)
   ══════════════════════════════════════════════════════════════ */
router.post('/generate', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { data, error } = _validate(GenerateSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, termId, termNumber: termNum, academicYearId, studentId } = data;

    const [config, caConfig] = await Promise.all([
      _loadConfig(schoolId),
      _loadCaConfig(schoolId),
    ]);

    const [gradesData, { data: examData }, caMarksData] = await Promise.all([
      aggregateGrades(schoolId, classId, termId, academicYearId, studentId),
      aggregateExamResults(schoolId, classId, termId, academicYearId, studentId),
      aggregateAssessmentMarks(schoolId, classId, termNum ?? null, academicYearId, studentId),
    ]);

    // Prefer assessment_config.customTypes (CA system) over legacy academic_config.assessmentWeights
    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes) ?? config.assessmentWeights;
    // Prefer grade_boundaries default scale over legacy academic_config.gradingSchema
    const activeSchema  = caConfig.gradeScale?.bands ?? config.gradingSchema;

    // Merge old gradebook data with CA marks — CA marks win on per-type conflict
    const mergedGrades = _mergeGradeData(gradesData, caMarksData);

    const allReports = computeFinalScores(mergedGrades, examData, activeWeights, activeSchema);

    // Attach class deviations (requires full class data)
    if (!studentId) attachDeviations(allReports);

    // Provisional class rankings
    const classInput = Object.values(allReports).map(r => ({
      studentId:  r.studentId,
      totalScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
    }));
    const classRanks = rankStudents(classInput, config.rankingMethod);

    const targets = studentId
      ? (allReports[studentId] ? { [studentId]: allReports[studentId] } : {})
      : allReports;

    const studentsWithRanks = Object.values(targets).map(r => ({
      ...r,
      rankingScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
      rankings: config.rankingEnabled ? mergeRankings(r.studentId, { class: classRanks }) : {},
    }));

    // Resolve class teacher name: student → stream (formTeacherId) → teacher name
    const studentIds  = studentsWithRanks.map(s => s.studentId);
    const Students    = _model('students');
    const Streams     = _model('streams');
    const Teachers    = _model('teachers');

    const studentDocs = await Students
      .find({ schoolId, id: { $in: studentIds } })
      .select('id streamId').lean();

    const streamIds = [...new Set(studentDocs.map(d => d.streamId).filter(Boolean))];
    const streamDocs = streamIds.length
      ? await Streams.find({ schoolId, id: { $in: streamIds } }).select('id formTeacherId').lean()
      : [];

    const teacherIds = [...new Set(streamDocs.map(d => d.formTeacherId).filter(Boolean))];
    const teacherDocs = teacherIds.length
      ? await Teachers.find({ schoolId, id: { $in: teacherIds } }).select('id title firstName lastName').lean()
      : [];

    const streamMap  = Object.fromEntries(streamDocs.map(d => [d.id, d.formTeacherId]));
    const teacherMap = Object.fromEntries(teacherDocs.map(t => [
      t.id,
      [t.title, t.firstName, t.lastName].filter(Boolean).join(' '),
    ]));
    const studentStreamMap = Object.fromEntries(studentDocs.map(d => [d.id, d.streamId]));

    const students = studentsWithRanks.map(r => {
      const streamId       = studentStreamMap[r.studentId];
      const formTeacherId  = streamId ? streamMap[streamId] : null;
      const classTeacherName = formTeacherId ? (teacherMap[formTeacherId] ?? null) : null;
      return { ...r, classTeacherId: formTeacherId ?? null, classTeacherName: classTeacherName ?? null };
    });

    return ok(res, {
      generated: students.length,
      config: {
        gradingType: config.gradingType, passMark: config.passMark,
        rankingEnabled: config.rankingEnabled, rankingSubjectStrategy: config.rankingSubjectStrategy,
        assessmentWeights: config.assessmentWeights,
        customTypes: caConfig.customTypes ?? null,
        gradeScale:  caConfig.gradeScale  ?? null,
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

  // skipModerationCheck requires an explicit reason (mandatory)
  if (data.skipModerationCheck && !data.skipReason?.trim()) {
    return E.badRequest(res, 'skipReason is required when skipModerationCheck is true — document why the moderation check is being bypassed');
  }

  const { classId, termId, termNumber: termNum, academicYearId, className, termName, academicYear, schoolName, skipModerationCheck, skipReason } = data;
  const now     = new Date().toISOString();
  const batchId = uuidv4();

  // ── Step 1: Create batch record (interrupt-safe anchor) ──────
  const Batches = _model('publish_batches');
  await Batches.create({
    id: batchId, schoolId, classId,
    termId: termId || null, academicYearId: academicYearId || null,
    status: 'running', startedBy: userId, startedAt: now,
    studentCount: 0, successCount: 0, failedStudents: [],
    moderationBypassed: skipModerationCheck,
    moderationBypassReason: skipReason || null,
  });

  try {
    // ── Step 1b: Block publish for archived academic years ───
    if (academicYearId && await isYearArchived(schoolId, academicYearId)) {
      await Batches.updateOne({ id: batchId }, {
        status: 'failed',
        failureReason: `Academic year "${academicYearId}" is archived — publishing is not permitted for closed years.`,
        completedAt: now,
      });
      return E.badRequest(res, `Academic year "${academicYearId}" has been archived — report card publishing is not permitted for closed years.`);
    }

    const [config, caConfig] = await Promise.all([
      _loadConfig(schoolId),
      _loadCaConfig(schoolId),
    ]);

    // Prefer assessment_config.customTypes (CA system) over legacy academic_config.assessmentWeights
    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes) ?? config.assessmentWeights;
    // Prefer grade_boundaries default scale over legacy academic_config.gradingSchema
    const activeSchema  = caConfig.gradeScale?.bands ?? config.gradingSchema;

    // ── Step 2: Moderation guard ─────────────────────────────
    const { data: examData, examStatuses } = await aggregateExamResults(schoolId, classId, termId, academicYearId);

    if (skipModerationCheck) {
      // Write audit entry for the bypass — this is mandatory, non-negotiable
      await _model('mark_audit_log').create({
        action:    'MODERATION_BYPASS',
        batchId,
        schoolId,  classId,
        termId:    termId || null,
        editedBy:  userId,
        reason:    skipReason,
        timestamp: now,
        examStatusAtBypass: examStatuses.map(e => ({ id: e.id, title: e.title, status: e.status })),
      });
      console.warn(`[REPORT-CARDS] ⚠️  Moderation check BYPASSED — batch ${batchId} by ${userId}: "${skipReason}"`);
    } else {
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
          'Approve all exams first — or pass skipModerationCheck: true with a documented skipReason.'
        ].join('\n'));
      }
    }

    // ── Step 3: Aggregate grades + CA marks, then compute scores ──
    const [gradesData, caMarksData] = await Promise.all([
      aggregateGrades(schoolId, classId, termId, academicYearId),
      aggregateAssessmentMarks(schoolId, classId, termNum ?? null, academicYearId),
    ]);
    // Merge old gradebook data with CA marks — CA marks win on per-type conflict
    const mergedGrades = _mergeGradeData(gradesData, caMarksData);
    const allReports = computeFinalScores(mergedGrades, examData, activeWeights, activeSchema);
    attachDeviations(allReports);

    if (Object.keys(allReports).length === 0) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No graded results found', completedAt: now });
      return E.badRequest(res, 'No graded results found for this class/term — nothing to publish');
    }

    // ── Step 4: Rankings ─────────────────────────────────────
    const classInput = Object.values(allReports).map(r => ({
      studentId:  r.studentId,
      totalScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
    }));
    const classRanks  = rankStudents(classInput, config.rankingMethod);
    const subjectBest = config.showBestPerSubject
      ? bestPerSubject(Object.values(allReports).map(r => ({ studentId: r.studentId, subjects: r.subjects })))
      : {};

    // ── Step 5: Load existing live snapshots (for versioning) ─
    const existingSnaps = await _model('report_card_snapshots').find({
      schoolId, classId,
      termId: termId || null, academicYearId: academicYearId || null,
      superseded: { $ne: true },
    }).lean();
    const existingMap = Object.fromEntries(existingSnaps.map(s => [s.studentId, s]));

    // ── Step 6: Denormalise student info ─────────────────────
    const studentIds = Object.keys(allReports);
    const students   = await _model('students').find({ schoolId,
      $or: [
        { id: { $in: studentIds } },
        { _id: { $in: studentIds.filter(s => /^[0-9a-f]{24}$/i.test(s)) } }
      ]
    }).lean();
    const studentMap = Object.fromEntries(students.map(s => [s.id || s._id.toString(), s]));

    // ── Step 6b: Batch-load outstanding fee balances ─────────
    // Best-effort: finance may not be used by this school. Any DB error leaves all flags false.
    const blockedStudentIds = new Set();
    try {
      const unpaidIds = await _model('invoices').distinct('studentId', {
        schoolId,
        studentId: { $in: studentIds },
        balance:   { $gt: 0 },
      });
      unpaidIds.forEach(id => blockedStudentIds.add(id));
    } catch (_) { /* non-fatal — invoice collection may not exist */ }

    // ── Step 6c: Load school signature/stamp URLs for snapshotting ────────
    let principalSignatureUrl = null;
    let schoolStampUrl        = null;
    try {
      const schoolDoc = await _model('schools').findOne({ id: schoolId }).select('principalSignatureUrl schoolStampUrl').lean();
      principalSignatureUrl = schoolDoc?.principalSignatureUrl || null;
      schoolStampUrl        = schoolDoc?.schoolStampUrl        || null;
    } catch (_) { /* non-fatal */ }

    // ── Step 7: Build new snapshots ──────────────────────────
    const newSnaps     = [];
    const supersedeOps = [];
    const partialFails = [];

    for (const r of Object.values(allReports)) {
      try {
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
          studentPhotoUrl: stu.photo || null,
          classId,        className:   className   || '',
          termId:         termId         || null,  termName:    termName    || '',
          termNumber:     termNum        ?? null,
          academicYearId: academicYearId || null,  academicYear: academicYear || '',
          schoolName:     schoolName || '',

          // Immutable config snapshot — use active (CA-system-aware) weights and schema
          gradingSchema:          activeSchema,
          assessmentWeights:      activeWeights,
          passMark:               config.passMark,
          gradingType:            config.gradingType,
          rankingSubjectStrategy: config.rankingSubjectStrategy,
          rankingN:               config.rankingN,

          // Results
          subjects:     r.subjects,
          totalScore:   r.totalScore,
          averageScore: r.averageScore,
          gpa:          r.gpa,
          subjectCount: r.subjectCount,
          rankingScore,
          rankingSubjectsUsed: subjectsUsed,

          rankings: config.rankingEnabled
            ? mergeRankings(r.studentId, { class: classRanks })
            : {},

          subjectBest: Object.fromEntries(
            Object.entries(subjectBest).map(([sub, winnerId]) => [sub, winnerId === r.studentId])
          ),

          // Carry forward comments from previous version
          comments: prev?.comments || { subjectComments: {}, classTeacherRemark: '', principalRemark: '' },

          // Snapshot school signature/stamp URLs at publish time (stays valid even if URLs change later)
          principalSignatureUrl,
          schoolStampUrl,

          attendanceSummary: null,
          financialBlock:    blockedStudentIds.has(r.studentId),
          status:            'published',
          publishedAt:       now,
          publishedBy:       userId,
          batchId,
          superseded:        false,
          moderationBypassed: skipModerationCheck,
          updatedAt:         now,
          updatedBy:         userId,
        };

        // RC-3: assign unique reportId + SHA-256 integrity hash
        snap.reportId   = await _nextReportId(schoolId, termNum, academicYear);
        snap.sha256Hash = _hashSnapshot(snap);

        newSnaps.push(snap);

        if (prev) {
          supersedeOps.push({
            updateOne: {
              filter: { id: prev.id },
              update: { $set: { superseded: true, supersededAt: now, supersededBy: newId } },
            }
          });
        }
      } catch (snapErr) {
        partialFails.push({ studentId: r.studentId, error: snapErr.message });
      }
    }

    // ── Step 8: Persist (transaction-wrapped when replica set available) ──
    const Snaps = _model('report_card_snapshots');
    const insertOps = newSnaps.map(s => ({ insertOne: { document: s } }));

    let session = null;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await Snaps.bulkWrite(insertOps, { ordered: false, session });
        if (supersedeOps.length) {
          await Snaps.bulkWrite(supersedeOps, { ordered: false, session });
        }
      });
    } catch (txErr) {
      // Code 20 = "Transaction numbers are only allowed on a replica set member or mongos"
      // Standalone MongoDB (dev/test) doesn't support transactions — fall back to non-transactional writes
      if (txErr.code === 20 || txErr.codeName === 'IllegalOperation' || txErr.message?.includes('Transaction')) {
        console.warn('[REPORT-CARDS] Transactions not available (standalone MongoDB) — falling back to non-transactional writes');
        await Snaps.bulkWrite(insertOps, { ordered: false });
        if (supersedeOps.length) {
          await Snaps.bulkWrite(supersedeOps, { ordered: false });
        }
      } else {
        throw txErr;  // Re-throw unexpected errors
      }
    } finally {
      if (session) await session.endSession().catch(() => {});
    }

    // ── Step 9: Mark batch complete (or partial) ─────────────
    const finalStatus = partialFails.length > 0 ? 'partial' : 'completed';
    await Batches.updateOne({ id: batchId }, {
      status:       finalStatus,
      completedAt:  now,
      studentCount: newSnaps.length + partialFails.length,
      successCount: newSnaps.length,
      failedStudents: partialFails,
      newVersions: newSnaps.map(s => ({ snapshotId: s.id, studentId: s.studentId, version: s.version })),
    });

    const response = {
      batchId,
      status:      finalStatus,
      published:   newSnaps.length,
      versioned:   supersedeOps.length,
      failed:      partialFails.length,
      classId,     termId,
      publishedAt: now,
    };

    // Surface bypass warning in response
    if (skipModerationCheck) {
      response.warnings = [`⚠️ Moderation check was bypassed. Reason: "${skipReason}". This action has been logged.`];
    }
    if (partialFails.length) {
      response.warnings = [...(response.warnings || []),
        `${partialFails.length} student(s) failed to snapshot — check publish-batches/${batchId} for details`];
    }

    console.log(`[REPORT-CARDS] Batch ${batchId}: ${newSnaps.length} published (${finalStatus}) by ${userId}`);
    return ok(res, response, null, 201);

  } catch (err) {
    await _model('publish_batches').updateOne({ id: batchId }, {
      status: 'failed', failureReason: err.message, completedAt: new Date().toISOString()
    }).catch(() => {});
    console.error('[report-cards/publish]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /publish-batches
   ══════════════════════════════════════════════════════════════ */
router.get('/publish-batches', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { schoolId };
    if (req.query.classId) filter.classId = req.query.classId;
    if (req.query.termId)  filter.termId  = req.query.termId;
    if (req.query.status)  filter.status  = req.query.status;

    const [docs, total] = await Promise.all([
      _model('publish_batches').find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit)
        .select('-newVersions -__v').lean(),
      _model('publish_batches').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[publish-batches GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /  — list snapshots
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    // Restricted roles can never see superseded versions
    const showHistory = req.query.history === '1' && !RESTRICTED_ROLES.includes(role);
    const filter = { schoolId };
    if (!showHistory) filter.superseded = { $ne: true };

    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.status)         filter.status         = req.query.status;

    const [docs, total] = await Promise.all([
      _model('report_card_snapshots').find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit)
        .select('-gradingSchema -assessmentWeights -subjects -__v').lean(),
      _model('report_card_snapshots').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[report-cards GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /verify/:reportId  — public authenticity check (no auth)
   Must be before GET /:id so Express doesn't capture "verify" as :id
   ══════════════════════════════════════════════════════════════ */
router.get('/verify/:reportId', async (req, res) => {
  try {
    const snap = await _model('report_card_snapshots')
      .findOne({ reportId: req.params.reportId })
      .lean();
    if (!snap) {
      return res.status(404).json({ verified: false, error: 'Report ID not found. This document may be fraudulent.' });
    }

    const computed = _hashSnapshot(snap);
    const isAuthentic = computed === snap.sha256Hash;

    return res.json({
      verified:     true,
      isAuthentic,
      reportId:     snap.reportId,
      studentName:  snap.studentName,
      admissionNo:  snap.admissionNo,
      className:    snap.className,
      termName:     snap.termName,
      termNumber:   snap.termNumber,
      academicYear: snap.academicYear,
      schoolName:   snap.schoolName,
      publishedAt:  snap.publishedAt,
      version:      snap.version,
      status:       isAuthentic ? 'Authentic' : 'INTEGRITY CHECK FAILED — document may have been tampered with',
    });
  } catch (err) {
    console.error('[report-cards/verify]', err);
    return res.status(500).json({ verified: false, error: 'Verification service error.' });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /:id  — full snapshot
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role, userId, guardianOf } = req.jwtUser;
    const doc = await _model('report_card_snapshots')
      .findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Report card snapshot not found');

    // Parents/students cannot access superseded snapshots
    if (doc.superseded && RESTRICTED_ROLES.includes(role)) {
      return E.forbidden(res, 'This report card has been superseded. Please access the latest version.');
    }

    // Guardian/parent: can only view their own linked children's report cards
    if (['parent', 'guardian'].includes(role)) {
      const linkedStudents = Array.isArray(guardianOf) ? guardianOf : [];
      if (!linkedStudents.includes(doc.studentId)) {
        // Log the access attempt for compliance (GDPR/POPIA: failed access to student records)
        _model('mark_audit_log').create({
          action:       'GUARDIAN_ACCESS_DENIED',
          schoolId,
          requestedBy:  userId,
          requestedRole: role,
          targetStudentId: doc.studentId,
          snapshotId:   req.params.id,
          route:        'GET /api/report-cards/:id',
          timestamp:    new Date().toISOString(),
        }).catch(e => console.error('[report-cards] guardian audit log failed:', e.message));
        return E.forbidden(res, 'You are not authorised to view this student\'s report card.');
      }
    }

    return ok(res, doc);
  } catch (err) { console.error('[report-cards GET/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   PUT /:id/comments
   ══════════════════════════════════════════════════════════════ */
router.put('/:id/comments', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(CommentSchema, req.body);
    if (error) return E.validation(res, error);

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');
    if (snap.superseded) return E.badRequest(res, 'Cannot edit a superseded report card. Use the current version.');

    const now    = new Date().toISOString();
    const merged = { ...(snap.comments || {}) };

    if (data.subjectComments) {
      merged.subjectComments = { ...(merged.subjectComments || {}), ...data.subjectComments };
    }
    if (data.classTeacherRemark != null) {
      merged.classTeacherRemark    = data.classTeacherRemark;
      merged.classTeacherCommentBy = userId;
      merged.classTeacherCommentAt = now;
    }
    if (data.principalRemark != null) {
      if (!['admin', 'superadmin'].includes(role)) return E.forbidden(res, 'Only admins can set the principal remark');
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

/* Decode a URL or data: URI to a Buffer. Non-fatal — returns null on any error. */
async function _fetchImageBuf(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1];
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
  return new Promise((resolve) => {
    const mod = url.startsWith('https://') ? require('https') : require('http');
    const req = mod.get(url, { timeout: 5000 }, resp => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
      resp.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* Fetch school-level images shared across all pages in a PDF batch. */
async function _fetchSignatureImages(snap) {
  const [principalSignature, schoolStamp] = await Promise.all([
    _fetchImageBuf(snap.principalSignatureUrl).catch(() => null),
    _fetchImageBuf(snap.schoolStampUrl).catch(() => null),
  ]);
  return { principalSignature, schoolStamp };
}

function _buildPDFPage(doc, snap, config, attendance, isFirstPage, images = {}) {
  if (!isFirstPage) doc.addPage();

  const PAGE_WIDTH = doc.page.width - 80;
  const GRAY = '#555555', DARK = '#1a1a2e', ACCENT = '#2563eb', LIGHT_GRAY = '#f3f4f6', BORDER = '#d1d5db';
  const COL_GAP = 5;
  const isDraft = snap.status !== 'published' || snap.superseded;

  /* DRAFT WATERMARK */
  if (isDraft) {
    doc.save()
       .translate(doc.page.width / 2, doc.page.height / 2)
       .rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(snap.superseded ? 'SUPERSEDED' : 'DRAFT', -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  /* HEADER */
  doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
  doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
     .text(snap.schoolName || 'School Management System', 50, 52, { width: PAGE_WIDTH - 20 });
  doc.fontSize(9).font('Helvetica')
     .text('ACADEMIC REPORT CARD' + (isDraft ? '   [DRAFT — NOT OFFICIAL]' : ''), 50, 75, { width: PAGE_WIDTH - 20 });
  doc.fillColor(DARK);

  /* STUDENT INFO — passport photo on right, text on left */
  const infoTop    = 115;
  const infoHeight = 90;
  const PHOTO_W = 52, PHOTO_H = 68;
  const photoX  = 40 + PAGE_WIDTH - PHOTO_W - 6;
  const photoY  = infoTop + 11;
  doc.rect(40, infoTop, PAGE_WIDTH, infoHeight).fill(LIGHT_GRAY).stroke(BORDER);

  // Text columns — leave room for photo on the right
  const textWidth = PAGE_WIDTH - PHOTO_W - 20;
  const c1 = 50, c2 = 280;
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('STUDENT NAME', c1, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(snap.studentName || '—', c1, infoTop + 19, { width: Math.min(200, textWidth - c1 + 40) });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ADMISSION NO.', c2, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(snap.admissionNo || '—', c2, infoTop + 19, { width: 130 });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('CLASS', c1, infoTop + 50);
  doc.fillColor(DARK).fontSize(10).font('Helvetica').text(snap.className || '—', c1, infoTop + 61);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('TERM / ACADEMIC YEAR', c2, infoTop + 50);
  doc.fillColor(DARK).fontSize(10).font('Helvetica')
     .text([snap.termName, snap.academicYear].filter(Boolean).join(' — ') || '—', c2, infoTop + 61, { width: 160 });

  /* Passport photo — rendered if available, else a placeholder box */
  doc.rect(photoX - 1, photoY - 1, PHOTO_W + 2, PHOTO_H + 2).stroke(BORDER);
  if (images.studentPhoto) {
    try {
      doc.image(images.studentPhoto, photoX, photoY, { width: PHOTO_W, height: PHOTO_H, cover: [PHOTO_W, PHOTO_H] });
    } catch (_) {
      doc.rect(photoX, photoY, PHOTO_W, PHOTO_H).fill('#e2e8f0');
    }
  } else {
    doc.rect(photoX, photoY, PHOTO_W, PHOTO_H).fill('#e2e8f0');
    doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica')
       .text('PHOTO', photoX, photoY + PHOTO_H / 2 - 4, { width: PHOTO_W, align: 'center' });
  }

  /* VERSION BADGE */
  if (snap.version > 1 || snap.superseded) {
    doc.fillColor(snap.superseded ? '#dc2626' : '#059669').fontSize(8).font('Helvetica-Bold')
       .text(`v${snap.version}${snap.superseded ? ' (Superseded)' : ''}`, c2, infoTop + 37, { width: 130, align: 'left' });
  }

  /* MODERATION BYPASS WARNING */
  if (snap.moderationBypassed) {
    const warnY = infoTop + infoHeight + 2;
    doc.rect(40, warnY, PAGE_WIDTH, 14).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(7.5).font('Helvetica-Bold')
       .text('⚠ Published with moderation check bypassed', 44, warnY + 3, { width: PAGE_WIDTH - 8 });
  }

  /* RESULTS TABLE — dynamic columns from snapshot's assessmentWeights */
  const tableTop = infoTop + infoHeight + (snap.moderationBypassed ? 20 : 6);

  const weights     = snap.assessmentWeights || config.assessmentWeights;
  // One column per assessment type, using the type's label (first word only to save space)
  const typeEntries = weights.map(w => ({
    key:   w.assessmentType,
    label: (w.label || w.assessmentType).split(/[\s/]+/)[0],
  }));

  // Fixed column widths; type columns share the remaining space equally
  const W_SUBJECT  = 155;
  const W_SCORE    = 42;
  const W_GRADE    = 42;
  const W_REMARKS  = 80;
  const fixedTotal = W_SUBJECT + W_SCORE + W_GRADE + W_REMARKS;
  const totalGaps  = (typeEntries.length + 3) * COL_GAP;
  const W_TYPE     = typeEntries.length > 0
    ? Math.max(36, Math.floor((PAGE_WIDTH - fixedTotal - totalGaps) / typeEntries.length))
    : 0;

  const colDefs = [
    { label: 'Subject',  width: W_SUBJECT },
    ...typeEntries.map(t => ({ label: t.label + '\n(%)', width: W_TYPE, key: t.key })),
    { label: 'Score',   width: W_SCORE   },
    { label: 'Grade',   width: W_GRADE   },
    { label: 'Remarks', width: W_REMARKS },
  ];
  const colWidths = colDefs.map(c => c.width);
  const colX = []; let cx = 40;
  for (const w of colWidths) { colX.push(cx); cx += w + COL_GAP; }

  // Header row
  doc.rect(40, tableTop, PAGE_WIDTH, 22).fill(ACCENT);
  doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
  colDefs.forEach((col, i) => {
    doc.text(col.label, colX[i] + 3, tableTop + 4, { width: colWidths[i] - 3, align: 'center' });
  });

  let rowY = tableTop + 22;
  const passMark = snap.passMark ?? config.passMark ?? 40;

  // Stable column indices for the fixed tail columns
  const typeStart = 1;
  const scoreIdx  = typeStart + typeEntries.length;
  const gradeIdx  = scoreIdx + 1;
  const rmrkIdx   = gradeIdx + 1;

  Object.entries(snap.subjects || {}).forEach(([subjectId, sub], idx) => {
    const rowH  = 18;
    doc.rect(40, rowY, PAGE_WIDTH, rowH).fill(idx % 2 === 0 ? 'white' : LIGHT_GRAY);

    const failed = sub.finalScore != null && sub.finalScore < passMark;
    const isBest = snap.subjectBest?.[subjectId];
    const isUsed = snap.rankingSubjectsUsed?.includes(subjectId);

    // Subject name
    doc.fillColor(failed ? '#dc2626' : DARK).fontSize(8.5).font('Helvetica');
    doc.text(
      (isBest ? '★ ' : '') + subjectId + (isUsed && snap.rankingSubjectStrategy !== 'all' ? ' ●' : ''),
      colX[0] + 3, rowY + 5, { width: colWidths[0] - 3 }
    );
    // One column per assessment type
    typeEntries.forEach((te, ti) => {
      const ci  = typeStart + ti;
      const val = sub.breakdown?.[te.key];
      doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
         .text(val != null ? val.toFixed(1) : '—', colX[ci] + 3, rowY + 5, { width: colWidths[ci] - 3, align: 'center' });
    });
    // Score
    doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
       .text(sub.finalScore?.toFixed(1) ?? '—', colX[scoreIdx] + 3, rowY + 5, { width: colWidths[scoreIdx] - 3, align: 'center' });
    // Grade
    doc.font('Helvetica-Bold').fillColor(sub.grade ? (failed ? '#dc2626' : ACCENT) : GRAY)
       .text(sub.grade || '—', colX[gradeIdx] + 3, rowY + 5, { width: colWidths[gradeIdx] - 3, align: 'center' });
    // Remarks
    doc.font('Helvetica').fillColor(GRAY).fontSize(7.5)
       .text(sub.remarks || sub.descriptor || '', colX[rmrkIdx] + 3, rowY + 5, { width: colWidths[rmrkIdx] - 3 });
    rowY += rowH;
  });

  doc.rect(40, tableTop, PAGE_WIDTH, rowY - tableTop).stroke(BORDER);

  if (snap.rankingSubjectStrategy && snap.rankingSubjectStrategy !== 'all') {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(`● Subjects counted toward rank (${snap.rankingSubjectStrategy === 'best_n' ? `Best ${snap.rankingN}` : 'Compulsory only'})`, 40, rowY + 3, { width: PAGE_WIDTH });
    rowY += 12;
  }

  /* SUMMARY */
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

  /* ATTENDANCE */
  if (config.showAttendanceSummary && attendance) {
    rowY += 8;
    doc.rect(40, rowY, PAGE_WIDTH, 26).fill(LIGHT_GRAY).stroke(BORDER);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ATTENDANCE', 50, rowY + 4);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(`Present: ${attendance.daysPresent}   Absent: ${attendance.daysAbsent}   Total Days: ${attendance.totalSchoolDays}` +
             (attendance.percentage != null ? `   Attendance: ${attendance.percentage}%` : ''),
             50, rowY + 14, { width: PAGE_WIDTH - 20 });
    rowY += 26;
  }

  /* COMMENTS */
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

  /* SIGNATURES */
  const sigY = rowY + 8;
  const sigW = (PAGE_WIDTH - 20) / 2;

  // Render principal signature image above the line (if available)
  if (images.principalSignature) {
    try {
      doc.image(images.principalSignature, 40 + sigW + 10, sigY - 28, { height: 28, fit: [sigW - 10, 28] });
    } catch (_) { /* non-fatal — skip image if corrupt */ }
  }
  // Render school stamp (right of signatures, small)
  if (images.schoolStamp) {
    try {
      doc.image(images.schoolStamp, 40 + PAGE_WIDTH - 56, sigY - 36, { height: 36, fit: [50, 36] });
    } catch (_) { /* non-fatal */ }
  }

  doc.moveTo(40, sigY + 20).lineTo(40 + sigW - 10, sigY + 20).stroke(DARK);
  doc.moveTo(40 + sigW + 10, sigY + 20).lineTo(40 + PAGE_WIDTH, sigY + 20).stroke(DARK);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica')
     .text(config.classTeacherSignatureLabel || 'Class Teacher', 40, sigY + 24, { width: sigW })
     .text(config.principalSignatureLabel    || 'Principal',      40 + sigW + 10, sigY + 24, { width: sigW });

  /* FOOTER */
  const footerY = doc.page.height - 55;
  doc.rect(40, footerY, PAGE_WIDTH, 0.5).fill(BORDER);
  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
     .text(config.footerNote || 'This report card is computer-generated.', 40, footerY + 6, { width: PAGE_WIDTH, align: 'center' });
  const genLine = `Generated: ${new Date().toUTCString()}  |  v${snap.version || 1}  |  Batch: ${snap.batchId || '—'}`;
  if (snap.reportId) {
    const verifyRow = footerY + 18;
    doc.fillColor(DARK).fontSize(7).font('Helvetica-Bold')
       .text(`Report ID: ${snap.reportId}`, 40, verifyRow, { width: PAGE_WIDTH / 2 });
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(`Verify at: /verify/${snap.reportId}`, 40 + PAGE_WIDTH / 2, verifyRow, { width: PAGE_WIDTH / 2, align: 'right' });
    doc.fillColor(GRAY).fontSize(6.5).font('Helvetica')
       .text(genLine, 40, footerY + 28, { width: PAGE_WIDTH, align: 'center' });
  } else {
    doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
       .text(genLine, 40, footerY + 18, { width: PAGE_WIDTH, align: 'center' });
  }
}

/* ── Portal roles bypass RBAC; the handler does ownership + fee checks ── */
function _pdfAccess(req, res, next) {
  if (RESTRICTED_ROLES.includes(req.jwtUser?.role)) return next();
  return rbac('grades', 'read')(req, res, next);
}

/* ══════════════════════════════════════════════════════════════
   GET /:id/pdf  — single student PDF
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/pdf', authMiddleware, PLAN, _pdfAccess, async (req, res) => {
  try {
    const { schoolId, role, guardianOf, studentId: jwtStudentId, userId } = req.jwtUser;

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (snap.superseded && RESTRICTED_ROLES.includes(role)) {
      return E.forbidden(res, 'This report card has been superseded. Please download the latest version.');
    }

    // Student: can only download their own report card
    if (role === 'student') {
      if (snap.studentId !== jwtStudentId) {
        return E.forbidden(res, 'You are not authorised to download this report card.');
      }
    }

    // Guardian/parent: can only download their own linked children's PDFs
    if (['parent', 'guardian'].includes(role)) {
      const linkedStudents = Array.isArray(guardianOf) ? guardianOf : [];
      if (!linkedStudents.includes(snap.studentId)) {
        _model('mark_audit_log').create({
          action:       'GUARDIAN_ACCESS_DENIED',
          schoolId,
          requestedBy:  userId,
          requestedRole: role,
          targetStudentId: snap.studentId,
          snapshotId:   req.params.id,
          route:        'GET /api/report-cards/:id/pdf',
          timestamp:    new Date().toISOString(),
        }).catch(e => console.error('[report-cards/pdf] guardian audit log failed:', e.message));
        return E.forbidden(res, 'You are not authorised to download this student\'s report card.');
      }
    }

    // Fee clearance check — uses school-configurable threshold (default 100 = fully paid).
    // Admins and force=1 always bypass. Threshold 0 means always accessible.
    if (req.query.force !== '1' && !['admin', 'superadmin'].includes(role)) {
      try {
        const school    = await _model('schools').findOne({ id: schoolId }, { 'portalConfig.reportCardFeeThreshold': 1 }).lean();
        const threshold = school?.portalConfig?.reportCardFeeThreshold ?? 100;
        if (threshold > 0) {
          const invoices    = await _model('invoices').find({ schoolId, studentId: snap.studentId }, { total: 1, balance: 1 }).lean();
          const totalBilled = invoices.reduce((s, i) => s + (i.total || 0), 0);
          const totalOwed   = invoices.reduce((s, i) => s + (i.balance || 0), 0);
          const clearancePct = totalBilled > 0
            ? Math.round(((totalBilled - totalOwed) / totalBilled) * 100)
            : 100;
          if (clearancePct < threshold) {
            return res.status(403).json({
              error: `Report card access blocked — ${clearancePct}% of fees cleared (${threshold}% required).`,
              financialBlock: true,
              clearancePct,
              threshold,
            });
          }
        }
      } catch (_) {
        // Non-fatal — fall back to the snapshot's stored flag
        if (snap.financialBlock) {
          return res.status(403).json({ error: 'Download blocked — outstanding fee balance.', financialBlock: true });
        }
      }
    }

    let attData = snap.attendanceSummary;
    if (!attData) {
      attData = await attendanceSummary(schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId);
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

    const pdfImages = await _fetchSignatureImages(snap);
    pdfImages.studentPhoto = await _fetchImageBuf(snap.studentPhotoUrl).catch(() => null);
    _buildPDFPage(doc, snap, config, attData, true, pdfImages);
    doc.end();
  } catch (err) { console.error('[report-cards/:id/pdf]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /bulk-pdf  — cursor-streamed class PDF (no giant buffer)
   ══════════════════════════════════════════════════════════════ */
router.get('/bulk-pdf', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!req.query.classId) return E.badRequest(res, 'classId query parameter is required');

    const filter = {
      schoolId, classId: req.query.classId,
      superseded: { $ne: true }, status: 'published',
    };
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;

    const config = await _loadConfig(schoolId);

    // Pre-fetch signature images once for the whole batch (same school for all snaps)
    const firstSnap    = await _model('report_card_snapshots').findOne(filter).lean();
    const bulkImages   = firstSnap ? await _fetchSignatureImages(firstSnap) : {};

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    // Count first so we can return 404 before sending any headers
    const total = await _model('report_card_snapshots').countDocuments(filter);
    if (total === 0) return E.notFound(res, 'No published report cards found for this class/term');

    // Start streaming response now — headers sent before cursor begins
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-cards-class-${req.query.classId}.pdf"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    const pdfDoc  = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });
    pdfDoc.pipe(res);  // stream directly to response — no giant buffer accumulation

    // Use Mongoose cursor — loads CHUNK_SIZE documents at a time, not all at once
    const CHUNK_SIZE = 10;
    const cursor = _model('report_card_snapshots')
      .find(filter)
      .sort({ studentName: 1 })
      .batchSize(CHUNK_SIZE)
      .cursor();

    let isFirst  = true;
    let chunkBuf = [];

    const processChunk = async (chunk) => {
      const [attResults, photoBuffers] = await Promise.all([
        Promise.all(chunk.map(s => s.attendanceSummary
          ? Promise.resolve(s.attendanceSummary)
          : attendanceSummary(schoolId, s.studentId, s.classId, s.termId, s.academicYearId)
        )),
        // Fetch each student's photo individually — different per student
        Promise.all(chunk.map(s => _fetchImageBuf(s.studentPhotoUrl).catch(() => null))),
      ]);
      chunk.forEach((snap, i) => {
        const isAdmin = ['admin', 'superadmin'].includes(role);
        if (snap.financialBlock && req.query.force !== '1' && !isAdmin) return; // skip blocked
        pdfDoc.addPage();
        _buildPDFPage(pdfDoc, snap, config, attResults[i], false,
          { ...bulkImages, studentPhoto: photoBuffers[i] });
        isFirst = false;
      });
    };

    // Iterate cursor, accumulate chunks, process when chunk is full
    for await (const snap of cursor) {
      chunkBuf.push(snap);
      if (chunkBuf.length >= CHUNK_SIZE) {
        await processChunk(chunkBuf);
        chunkBuf = [];
      }
    }
    if (chunkBuf.length > 0) await processChunk(chunkBuf);

    pdfDoc.end();
  } catch (err) {
    console.error('[report-cards/bulk-pdf]', err);
    // Headers may already be sent — can't send JSON error; just end the response
    if (!res.headersSent) return E.serverError(res);
    res.end();
  }
});

/* ── Draft Comments — pre-publish per-student comment store ─── */

// GET /draft-comments?classId=&termNumber=
router.get('/draft-comments', authMiddleware, PLAN, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.classId)    filter.classId    = req.query.classId;
    if (req.query.termNumber) filter.termNumber = Number(req.query.termNumber);
    const docs = await _model('report_card_draft_comments').find(filter).lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[report-cards/draft-comments GET]', err);
    return E.serverError(res);
  }
});

// PUT /draft-comments/:studentId — upsert comment record for a student
// subjectComments: { [subjectId]: string } — merged per-key (each teacher only touches their own subject)
router.put('/draft-comments/:studentId', authMiddleware, PLAN, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId: updatedBy } = req.jwtUser;
    const { studentId } = req.params;
    const { classId, termNumber, classTeacherName, classTeacherRemark,
            sportsAndTalent, principalName, principalRemark, closingDate, nextTermBegin,
            subjectComments } = req.body;
    if (!termNumber) return E.badRequest(res, 'termNumber is required');

    // Base fields always updated together
    const setFields = {
      schoolId, studentId, classId,
      termNumber:         Number(termNumber),
      classTeacherName:   classTeacherName   ?? '',
      classTeacherRemark: classTeacherRemark ?? '',
      sportsAndTalent:    sportsAndTalent    ?? '',
      principalName:      principalName      ?? '',
      principalRemark:    principalRemark    ?? '',
      closingDate:        closingDate        ?? '',
      nextTermBegin:      nextTermBegin      ?? '',
      updatedBy,
      updatedAt: new Date(),
    };

    // Merge subject comments with dot-notation $set so each teacher only touches their own subject
    // without wiping other teachers' comments on the same student record.
    if (subjectComments && typeof subjectComments === 'object') {
      for (const [subjectId, comment] of Object.entries(subjectComments)) {
        if (typeof comment === 'string') {
          setFields[`subjectComments.${subjectId}`] = comment;
        }
      }
    }

    const doc = await _model('report_card_draft_comments').findOneAndUpdate(
      { schoolId, studentId, termNumber: Number(termNumber) },
      { $set: setFields },
      { upsert: true, new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[report-cards/draft-comments PUT]', err);
    return E.serverError(res);
  }
});

// PUT /draft-comments/:studentId/subject/:subjectId — update one subject comment only (teacher-safe merge)
router.put('/draft-comments/:studentId/subject/:subjectId', authMiddleware, PLAN, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId: updatedBy } = req.jwtUser;
    const { studentId, subjectId } = req.params;
    const { classId, termNumber, comment } = req.body;
    if (!termNumber) return E.badRequest(res, 'termNumber is required');
    if (typeof comment !== 'string') return E.badRequest(res, 'comment must be a string');

    const doc = await _model('report_card_draft_comments').findOneAndUpdate(
      { schoolId, studentId, termNumber: Number(termNumber) },
      { $set: {
          schoolId, studentId, classId,
          termNumber: Number(termNumber),
          [`subjectComments.${subjectId}`]: comment,
          updatedBy,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[report-cards/draft-comments/subject PUT]', err);
    return E.serverError(res);
  }
});

module.exports = router;
