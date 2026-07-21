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
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');
const { mergeConfig }    = require('./academic-config');
const { getConfig: _getAssessmentConfig } = require('./assessment');
const { isYearArchived } = require('../utils/archival');
const AuditService       = require('../services/audit');
const { sanitisePdfStr } = require('../utils/sanitisePdf');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const email = require('../utils/email');
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
  const saved = await tenantModel('academic_config', { schoolId }).findOne({ schoolId }).lean();
  return mergeConfig(saved);
}

/* ── Report ID generator — RC-YYYY-TN-XXXXXX ───────────────── */
async function _nextReportId(schoolId, termNumber, academicYear) {
  const year = academicYear ? String(academicYear).slice(0, 4) : String(new Date().getFullYear());
  const tn   = String(termNumber || 1).padStart(1, '0');
  const key  = `rc_${schoolId}_${year}_${tn}`;
  const ctr  = await tenantModel('report_card_counters', { schoolId }).findOneAndUpdate(
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
 * Load the school's assessment-type configuration and grading scale.
 * customTypes is the school's single source of truth for assessment
 * types/weights (server/routes/assessment.js) — getConfig() auto-seeds
 * and persists DEFAULT_CUSTOM_TYPES on first call, so this always
 * returns a populated, weight-complete array (never empty/null).
 */
async function _loadCaConfig(schoolId) {
  const [assessmentCfg, defaultScale] = await Promise.all([
    _getAssessmentConfig(schoolId, null),
    tenantModel('grade_boundaries', { schoolId }).findOne({ schoolId, isDefault: true }).lean(),
  ]);
  return {
    customTypes: assessmentCfg.customTypes,
    gradeScale:  defaultScale ?? null,
  };
}

/**
 * Convert assessment_config.customTypes → assessmentWeights format expected by computeFinalScores.
 */
function _convertCustomTypesToWeights(customTypes) {
  return customTypes.map(t => ({
    assessmentType: t.key,
    label:          t.label || t.key,
    weight:         t.weight ?? 0,
  }));
}

/**
 * Normalise a gradingSchema into the single {min, grade, points, label} shape,
 * regardless of source format — grade_boundaries already uses this shape;
 * academic_config.gradingSchema uses {minScore, maxScore, descriptor, remarks}.
 * This is the schema the client renders from; it must always describe
 * exactly the bands the server used in computeFinalScores/resolveGrade for
 * THIS response, never a locally-invented client-side default (Audit §6.2 —
 * the client and server previously disagreed on the fallback scale when a
 * school had no grade_boundaries default configured).
 */
function _normalizeGradeScaleBands(bands) {
  return (bands || []).map(b => ({
    min:    b.min    ?? b.minScore ?? 0,
    grade:  b.grade,
    points: b.points ?? 0,
    label:  b.label  ?? b.descriptor ?? '',
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

    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes);
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
    const Students    = tenantModel('students', tenantContext(req));
    const Streams     = tenantModel('streams', tenantContext(req));
    const Teachers    = tenantModel('teachers', tenantContext(req));

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
        assessmentWeights: _convertCustomTypesToWeights(caConfig.customTypes),
        customTypes: caConfig.customTypes ?? null,
        // Always the exact bands used to grade this response's subjects —
        // never null, normalised to one shape regardless of whether they
        // came from grade_boundaries or the academic_config fallback (Audit
        // §6.2 — the client must never fall back to its own local default,
        // it has to render from what the server actually used).
        gradeScale: { bands: _normalizeGradeScaleBands(activeSchema) },
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
  const Batches = tenantModel('publish_batches', tenantContext(req));
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

    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes);
    // Prefer grade_boundaries default scale over legacy academic_config.gradingSchema
    const activeSchema  = caConfig.gradeScale?.bands ?? config.gradingSchema;

    // ── Step 2: Moderation guard ─────────────────────────────
    const { data: examData, examStatuses } = await aggregateExamResults(schoolId, classId, termId, academicYearId);

    if (skipModerationCheck) {
      // Write audit entry for the bypass — this is mandatory, non-negotiable
      await tenantModel('mark_audit_log', tenantContext(req)).create({
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
    const existingSnaps = await tenantModel('report_card_snapshots', tenantContext(req)).find({
      schoolId, classId,
      termId: termId || null, academicYearId: academicYearId || null,
      superseded: { $ne: true },
    }).lean();
    const existingMap = Object.fromEntries(existingSnaps.map(s => [s.studentId, s]));

    // ── Step 6: Denormalise student info ─────────────────────
    const studentIds = Object.keys(allReports);
    const students   = await tenantModel('students', tenantContext(req)).find({ schoolId,
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
      const unpaidIds = await tenantModel('invoices', tenantContext(req)).distinct('studentId', {
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
    const Snaps = tenantModel('report_card_snapshots', tenantContext(req));
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
    AuditService.log({ action: 'report_card.publish', actor: req.jwtUser, schoolId, target: { type: 'class', id: classId, label: className }, details: { batchId, termId, studentCount: newSnaps.length, status: finalStatus }, req });

    _notifyReportCardsPublished(req, newSnaps).catch(err => console.error('[report-cards/publish notify]', err));

    return ok(res, response, null, 201);

  } catch (err) {
    await tenantModel('publish_batches', tenantContext(req)).updateOne({ id: batchId }, {
      status: 'failed', failureReason: err.message, completedAt: new Date().toISOString()
    }).catch(() => {});
    console.error('[report-cards/publish]', err);
    return E.serverError(res);
  }
});

/* Notify each published student's parent(s)/guardian(s) — school-configured
   channel + frequency, same shared mechanism as behaviour_incident. One
   dispatch per student so each guardian's message is scoped to their own
   child, not a generic "reports were published" broadcast. */
async function _notifyReportCardsPublished(req, snaps) {
  if (!snaps.length) return;
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);
  const school = await _model('schools').findOne({ id: schoolId }).select('name systemEmail').lean();
  const schoolName  = school?.name || '';
  const schoolEmail = school?.systemEmail || '';

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'report_published',
    items: snaps.map(snap => ({
      studentId: snap.studentId,
      inAppSubject: `Report card published for ${snap.studentName}`,
      inAppBody:    `${snap.termName || 'This term'}'s report card for ${snap.studentName} is now available.`,
      emailDigestSubject: `Report card published — ${snap.studentName}`,
      emailDigestBody:    `${snap.termName || 'This term'}'s report card is now available.`,
      sendEmail: (recipient) => email.sendReportCardPublishedAlert({
        recipientName: recipient.name, recipientEmail: recipient.email,
        studentName: snap.studentName, termName: snap.termName, academicYear: snap.academicYear,
        schoolName, schoolEmail, schoolId,
      }),
    })),
  });
}

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
      tenantModel('publish_batches', tenantContext(req)).find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit)
        .select('-newVersions -__v').lean(),
      tenantModel('publish_batches', tenantContext(req)).countDocuments(filter),
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
      tenantModel('report_card_snapshots', tenantContext(req)).find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit)
        .select('-gradingSchema -assessmentWeights -subjects -__v').lean(),
      tenantModel('report_card_snapshots', tenantContext(req)).countDocuments(filter),
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
    // ADR-0001 §4 exception: PUBLIC endpoint (no auth, no tenant context).
    // Verifies a report card by its globally-unique reportId without knowing
    // the school — an intentional cross-tenant lookup. Stays on _model();
    // tenantModel() would (correctly) fail closed here. reportId is globally
    // unique, so this reveals only a single, already-public report card.
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
    const doc = await tenantModel('report_card_snapshots', tenantContext(req))
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
        tenantModel('mark_audit_log', tenantContext(req)).create({
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

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
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

    const doc = await tenantModel('report_card_snapshots', tenantContext(req)).findOneAndUpdate(
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

/* ── Report Card IR (Consolidation Plan §4) ──────────────────────
   _computeReportSections is a PURE function: given a snapshot +
   config + attendance, it decides WHAT the report contains — every
   string already formatted, every conditional already resolved —
   with zero pdfkit calls and zero layout math. _drawReportPage is
   the one PDF adapter that walks this data and draws it. Splitting
   these is what makes a future second adapter (HTML, for on-screen
   preview and print — closing the two-renderers gap in Audit §2)
   possible without a second copy of this decision logic. This first
   pass ships as a direct, behavior-preserving extraction — verified
   against a golden call-sequence fixture captured from the original
   monolithic function before this split (server/__tests__/report-cards-ir.test.js)
   — not a redesign of what's shown or how. */
function _computeReportSections(snap, config, attendance) {
  const isDraft = snap.status !== 'published' || snap.superseded;

  const weights     = snap.assessmentWeights || [];
  const typeEntries = weights.map(w => ({
    key:   w.assessmentType,
    label: (w.label || w.assessmentType).split(/[\s/]+/)[0],
  }));

  const passMark = snap.passMark ?? config.passMark ?? 40;

  const rows = Object.entries(snap.subjects || {}).map(([subjectId, sub]) => {
    const failed = sub.finalScore != null && sub.finalScore < passMark;
    const isBest = !!snap.subjectBest?.[subjectId];
    const isUsed = !!snap.rankingSubjectsUsed?.includes(subjectId);
    return {
      subjectId,
      nameLine:    (isBest ? '★ ' : '') + subjectId + (isUsed && snap.rankingSubjectStrategy !== 'all' ? ' ●' : ''),
      failed,
      typeValues:  typeEntries.map(te => {
        const val = sub.breakdown?.[te.key];
        return val != null ? val.toFixed(1) : '—';
      }),
      scoreText:   sub.finalScore?.toFixed(1) ?? '—',
      hasGrade:    !!sub.grade,
      gradeText:   sub.grade || '—',
      remarksText: sub.remarks || sub.descriptor || '',
    };
  });

  const rankingNote = (snap.rankingSubjectStrategy && snap.rankingSubjectStrategy !== 'all')
    ? `● Subjects counted toward rank (${snap.rankingSubjectStrategy === 'best_n' ? `Best ${snap.rankingN}` : 'Compulsory only'})`
    : null;

  const showRanking = !!(config.rankingEnabled && snap.rankings?.class);
  const showAttendance = !!(config.showAttendanceSummary && attendance);

  return {
    isDraft,
    watermarkText: isDraft ? (snap.superseded ? 'SUPERSEDED' : 'DRAFT') : null,
    header: {
      schoolName: snap.schoolName || 'School Management System',
      subtitle:   'ACADEMIC REPORT CARD' + (isDraft ? '   [DRAFT — NOT OFFICIAL]' : ''),
    },
    studentInfo: {
      studentName: snap.studentName || '—',
      admissionNo: snap.admissionNo || '—',
      className:   snap.className   || '—',
      termLine:    [snap.termName, snap.academicYear].filter(Boolean).join(' — ') || '—',
      versionBadge: (snap.version > 1 || snap.superseded)
        ? { text: `v${snap.version}${snap.superseded ? ' (Superseded)' : ''}`, superseded: !!snap.superseded }
        : null,
      moderationBypassed: !!snap.moderationBypassed,
    },
    resultsTable: { typeEntries, rows, rankingNote },
    summary: {
      totalText:   `Total Score: ${snap.totalScore?.toFixed(1) ?? '—'}`,
      averageText: `Average: ${snap.averageScore?.toFixed(1) ?? '—'}%`,
      showGPA:     !!config.showGPA,
      gpaText:     `GPA: ${snap.gpa?.toFixed(2) ?? '—'}`,
      showRanking,
      rankText:    showRanking ? `Class Rank: ${snap.rankings.class.rank} / ${snap.rankings.class.outOf}` : null,
    },
    attendance: showAttendance ? {
      text: `Present: ${attendance.daysPresent}   Absent: ${attendance.daysAbsent}   Total Days: ${attendance.totalSchoolDays}` +
            (attendance.percentage != null ? `   Attendance: ${attendance.percentage}%` : ''),
    } : null,
    comments: {
      classTeacherRemark: sanitisePdfStr(snap.comments?.classTeacherRemark) || '— No remark entered —',
      principalRemark:    sanitisePdfStr(snap.comments?.principalRemark)    || '— No comment entered —',
    },
    signatures: {
      classTeacherLabel: config.classTeacherSignatureLabel || 'Class Teacher',
      principalLabel:    config.principalSignatureLabel    || 'Principal',
    },
    footer: {
      footerNote: config.footerNote || 'This report card is computer-generated.',
      genLine:    `Generated: ${new Date().toUTCString()}  |  v${snap.version || 1}  |  Batch: ${snap.batchId || '—'}`,
      reportId:   snap.reportId || null,
    },
  };
}

/* PDF adapter — walks the IR above and makes the pdfkit calls. Every
   coordinate/color/size constant here is unchanged from the original
   monolithic _buildPDFPage; only the source of each value moved from
   `snap`/`config` directly to the pre-computed `s` (sections) object. */
function _drawReportPage(doc, s, images, isFirstPage) {
  if (!isFirstPage) doc.addPage();

  const PAGE_WIDTH = doc.page.width - 80;
  const GRAY = '#555555', DARK = '#1a1a2e', ACCENT = '#2563eb', LIGHT_GRAY = '#f3f4f6', BORDER = '#d1d5db';
  const COL_GAP = 5;

  /* DRAFT WATERMARK */
  if (s.watermarkText) {
    doc.save()
       .translate(doc.page.width / 2, doc.page.height / 2)
       .rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(s.watermarkText, -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  /* HEADER */
  doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
  doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
     .text(s.header.schoolName, 50, 52, { width: PAGE_WIDTH - 20 });
  doc.fontSize(9).font('Helvetica')
     .text(s.header.subtitle, 50, 75, { width: PAGE_WIDTH - 20 });
  doc.fillColor(DARK);

  /* STUDENT INFO — passport photo on right, text on left */
  const infoTop    = 115;
  const infoHeight = 90;
  const PHOTO_W = 52, PHOTO_H = 68;
  const photoX  = 40 + PAGE_WIDTH - PHOTO_W - 6;
  const photoY  = infoTop + 11;
  doc.rect(40, infoTop, PAGE_WIDTH, infoHeight).fill(LIGHT_GRAY).stroke(BORDER);

  const textWidth = PAGE_WIDTH - PHOTO_W - 20;
  const c1 = 50, c2 = 280;
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('STUDENT NAME', c1, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(s.studentInfo.studentName, c1, infoTop + 19, { width: Math.min(200, textWidth - c1 + 40) });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ADMISSION NO.', c2, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(s.studentInfo.admissionNo, c2, infoTop + 19, { width: 130 });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('CLASS', c1, infoTop + 50);
  doc.fillColor(DARK).fontSize(10).font('Helvetica').text(s.studentInfo.className, c1, infoTop + 61);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('TERM / ACADEMIC YEAR', c2, infoTop + 50);
  doc.fillColor(DARK).fontSize(10).font('Helvetica')
     .text(s.studentInfo.termLine, c2, infoTop + 61, { width: 160 });

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
  if (s.studentInfo.versionBadge) {
    doc.fillColor(s.studentInfo.versionBadge.superseded ? '#dc2626' : '#059669').fontSize(8).font('Helvetica-Bold')
       .text(s.studentInfo.versionBadge.text, c2, infoTop + 37, { width: 130, align: 'left' });
  }

  /* MODERATION BYPASS WARNING */
  if (s.studentInfo.moderationBypassed) {
    const warnY = infoTop + infoHeight + 2;
    doc.rect(40, warnY, PAGE_WIDTH, 14).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(7.5).font('Helvetica-Bold')
       .text('⚠ Published with moderation check bypassed', 44, warnY + 3, { width: PAGE_WIDTH - 8 });
  }

  /* RESULTS TABLE — dynamic columns from the IR's typeEntries */
  const tableTop = infoTop + infoHeight + (s.studentInfo.moderationBypassed ? 20 : 6);

  const typeEntries = s.resultsTable.typeEntries;
  const W_SUBJECT  = 155, W_SCORE = 42, W_GRADE = 42, W_REMARKS = 80;
  const fixedTotal = W_SUBJECT + W_SCORE + W_GRADE + W_REMARKS;
  const totalGaps  = (typeEntries.length + 3) * COL_GAP;
  const W_TYPE     = typeEntries.length > 0
    ? Math.max(36, Math.floor((PAGE_WIDTH - fixedTotal - totalGaps) / typeEntries.length))
    : 0;

  const colDefs = [
    { label: 'Subject',  width: W_SUBJECT },
    ...typeEntries.map(t => ({ label: t.label + '\n(%)', width: W_TYPE })),
    { label: 'Score',   width: W_SCORE   },
    { label: 'Grade',   width: W_GRADE   },
    { label: 'Remarks', width: W_REMARKS },
  ];
  const colWidths = colDefs.map(c => c.width);
  const colX = []; let cx = 40;
  for (const w of colWidths) { colX.push(cx); cx += w + COL_GAP; }

  doc.rect(40, tableTop, PAGE_WIDTH, 22).fill(ACCENT);
  doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
  colDefs.forEach((col, i) => {
    doc.text(col.label, colX[i] + 3, tableTop + 4, { width: colWidths[i] - 3, align: 'center' });
  });

  let rowY = tableTop + 22;
  const typeStart = 1;
  const scoreIdx  = typeStart + typeEntries.length;
  const gradeIdx  = scoreIdx + 1;
  const rmrkIdx   = gradeIdx + 1;

  s.resultsTable.rows.forEach((row, idx) => {
    const rowH = 18;
    doc.rect(40, rowY, PAGE_WIDTH, rowH).fill(idx % 2 === 0 ? 'white' : LIGHT_GRAY);

    doc.fillColor(row.failed ? '#dc2626' : DARK).fontSize(8.5).font('Helvetica');
    doc.text(row.nameLine, colX[0] + 3, rowY + 5, { width: colWidths[0] - 3 });

    row.typeValues.forEach((val, ti) => {
      const ci = typeStart + ti;
      doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
         .text(val, colX[ci] + 3, rowY + 5, { width: colWidths[ci] - 3, align: 'center' });
    });

    doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
       .text(row.scoreText, colX[scoreIdx] + 3, rowY + 5, { width: colWidths[scoreIdx] - 3, align: 'center' });

    doc.font('Helvetica-Bold').fillColor(row.hasGrade ? (row.failed ? '#dc2626' : ACCENT) : GRAY)
       .text(row.gradeText, colX[gradeIdx] + 3, rowY + 5, { width: colWidths[gradeIdx] - 3, align: 'center' });

    doc.font('Helvetica').fillColor(GRAY).fontSize(7.5)
       .text(row.remarksText, colX[rmrkIdx] + 3, rowY + 5, { width: colWidths[rmrkIdx] - 3 });
    rowY += rowH;
  });

  doc.rect(40, tableTop, PAGE_WIDTH, rowY - tableTop).stroke(BORDER);

  if (s.resultsTable.rankingNote) {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(s.resultsTable.rankingNote, 40, rowY + 3, { width: PAGE_WIDTH });
    rowY += 12;
  }

  /* SUMMARY */
  rowY += 6;
  doc.rect(40, rowY, PAGE_WIDTH, 28).fill('#eff6ff').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
  doc.text(s.summary.totalText, 50, rowY + 5);
  doc.text(s.summary.averageText, 160, rowY + 5);
  if (s.summary.showGPA) doc.text(s.summary.gpaText, 265, rowY + 5);
  if (s.summary.showRanking) {
    doc.fillColor(ACCENT).text(s.summary.rankText, 355, rowY + 5);
  }
  rowY += 28;

  /* ATTENDANCE */
  if (s.attendance) {
    rowY += 8;
    doc.rect(40, rowY, PAGE_WIDTH, 26).fill(LIGHT_GRAY).stroke(BORDER);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ATTENDANCE', 50, rowY + 4);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(s.attendance.text, 50, rowY + 14, { width: PAGE_WIDTH - 20 });
    rowY += 26;
  }

  /* COMMENTS */
  rowY += 12;
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("CLASS TEACHER'S REMARK:", 40, rowY);
  rowY += 12;
  doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
     .text(s.comments.classTeacherRemark, 46, rowY + 9, { width: PAGE_WIDTH - 12 });
  rowY += 38;

  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("PRINCIPAL'S COMMENT:", 40, rowY);
  rowY += 12;
  doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
     .text(s.comments.principalRemark, 46, rowY + 9, { width: PAGE_WIDTH - 12 });
  rowY += 42;

  /* SIGNATURES */
  const sigY = rowY + 8;
  const sigW = (PAGE_WIDTH - 20) / 2;

  if (images.principalSignature) {
    try {
      doc.image(images.principalSignature, 40 + sigW + 10, sigY - 28, { height: 28, fit: [sigW - 10, 28] });
    } catch (_) { /* non-fatal — skip image if corrupt */ }
  }
  if (images.schoolStamp) {
    try {
      doc.image(images.schoolStamp, 40 + PAGE_WIDTH - 56, sigY - 36, { height: 36, fit: [50, 36] });
    } catch (_) { /* non-fatal */ }
  }

  doc.moveTo(40, sigY + 20).lineTo(40 + sigW - 10, sigY + 20).stroke(DARK);
  doc.moveTo(40 + sigW + 10, sigY + 20).lineTo(40 + PAGE_WIDTH, sigY + 20).stroke(DARK);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica')
     .text(s.signatures.classTeacherLabel, 40, sigY + 24, { width: sigW })
     .text(s.signatures.principalLabel,    40 + sigW + 10, sigY + 24, { width: sigW });

  /* FOOTER */
  const footerY = doc.page.height - 55;
  doc.rect(40, footerY, PAGE_WIDTH, 0.5).fill(BORDER);
  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
     .text(s.footer.footerNote, 40, footerY + 6, { width: PAGE_WIDTH, align: 'center' });
  if (s.footer.reportId) {
    const verifyRow = footerY + 18;
    doc.fillColor(DARK).fontSize(7).font('Helvetica-Bold')
       .text(`Report ID: ${s.footer.reportId}`, 40, verifyRow, { width: PAGE_WIDTH / 2 });
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(`Verify at: /verify/${s.footer.reportId}`, 40 + PAGE_WIDTH / 2, verifyRow, { width: PAGE_WIDTH / 2, align: 'right' });
    doc.fillColor(GRAY).fontSize(6.5).font('Helvetica')
       .text(s.footer.genLine, 40, footerY + 28, { width: PAGE_WIDTH, align: 'center' });
  } else {
    doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
       .text(s.footer.genLine, 40, footerY + 18, { width: PAGE_WIDTH, align: 'center' });
  }
}

function _buildPDFPage(doc, snap, config, attendance, isFirstPage, images = {}) {
  const sections = _computeReportSections(snap, config, attendance);
  _drawReportPage(doc, sections, images, isFirstPage);
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

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
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
        tenantModel('mark_audit_log', tenantContext(req)).create({
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
          const invoices    = await tenantModel('invoices', tenantContext(req)).find({ schoolId, studentId: snap.studentId }, { total: 1, balance: 1 }).lean();
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
    const firstSnap    = await tenantModel('report_card_snapshots', tenantContext(req)).findOne(filter).lean();
    const bulkImages   = firstSnap ? await _fetchSignatureImages(firstSnap) : {};

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    // Count first so we can return 404 before sending any headers
    const total = await tenantModel('report_card_snapshots', tenantContext(req)).countDocuments(filter);
    if (total === 0) return E.notFound(res, 'No published report cards found for this class/term');

    // Start streaming response now — headers sent before cursor begins
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-cards-class-${req.query.classId}.pdf"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    const pdfDoc  = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });
    pdfDoc.pipe(res);  // stream directly to response — no giant buffer accumulation

    // Use Mongoose cursor — loads CHUNK_SIZE documents at a time, not all at once
    const CHUNK_SIZE = 10;
    const cursor = tenantModel('report_card_snapshots', tenantContext(req))
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
    const docs = await tenantModel('report_card_draft_comments', tenantContext(req)).find(filter).lean();
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

    const doc = await tenantModel('report_card_draft_comments', tenantContext(req)).findOneAndUpdate(
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

    const doc = await tenantModel('report_card_draft_comments', tenantContext(req)).findOneAndUpdate(
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

// Exposed for direct unit testing without exercising the full (transaction-
// wrapped, config-loading) /publish route — same lightweight-testability
// convention as qa-health.js's exported check functions.
router._notifyReportCardsPublished = _notifyReportCardsPublished;
router._normalizeGradeScaleBands = _normalizeGradeScaleBands;
router._buildPDFPage = _buildPDFPage;
router._computeReportSections = _computeReportSections;

module.exports = router;
