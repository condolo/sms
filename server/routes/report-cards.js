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
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');
const { mergeConfig, resolveGrade, resolveCurrentPeriod } = require('./academic-config');
const { getConfig: _getAssessmentConfig } = require('./assessment');
const { resolveTemplate } = require('./report-card-templates');
const { getLayout }       = require('../utils/report-layouts');
const { isYearArchived } = require('../utils/archival');
const AuditService       = require('../services/audit');
const { sanitisePdfStr } = require('../utils/sanitisePdf');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const { canWriteSubject, unassignedPairs } = require('../utils/subject-scope');
const { getWorkflowConfig, saveWorkflowConfig, resolveStep, resolveAssigneeLabel } = require('../utils/workflow-config');
const { dispatchNotification } = require('../utils/notify-dispatch');
const email = require('../utils/email');
const {
  aggregateGrades,
  aggregateExamResults,
  aggregateAssessmentMarks,
  computeFinalScores,
  attendanceSummary,
  behaviourSummary,
  attachDeviations,
  computeTermDeviation,
} = require('../utils/academic-calc');

const router = express.Router();
const PLAN   = planGate('grades');
const MODGATE = moduleGate('report_cards');

/* RC8 — report-level remark approval chain, reusing the same
   workflow-config.js engine leave_approval/marks_unlock/payroll already
   proved reusable across HR. Opt-in per school: a school that never
   configures this key keeps writing classTeacherRemark/principalRemark
   directly via PUT /draft-comments/:studentId, completely unaffected —
   see docs/audits/REPORT_CARD_PLATFORM_FUNCTIONAL_ARCHITECTURE.md §11. */
const REPORT_COMMENT_WORKFLOW_KEY = 'report_comment_approval';
const REPORT_COMMENT_MIN_STEPS = 1;

/* ── Config loader (legacy academic_config) ─────────────────── */
async function _loadConfig(schoolId) {
  const saved = await tenantModel('academic_config', { schoolId }).findOne({ schoolId }).lean();
  return mergeConfig(saved);
}

/* RC9 — Publication Policy (docs/audits/REPORT_CARD_PLATFORM_FUNCTIONAL_ARCHITECTURE.md
   §12): the rules governing whether a specific report may be published,
   owned by Report Cards (not the general platform Settings layer) since
   nothing outside this module's own publish logic could enforce them.
   Stored as discrete, independently-evaluated {key: enabled} entries —
   not one monolithic flag — so a future {key, condition, enabled} shape
   (curriculum/section-conditional rules) can be introduced later without
   restructuring storage. Defaults match today's exact hardcoded behavior
   for the one pre-existing rule (moderation); the two new completeness
   rules default OFF — no school has ever had them, and per §12's own
   "needs a verified runtime consumer before it ships as a toggle" bar,
   they're additive capabilities, never a silent new restriction. */
const PUBLICATION_POLICY_DEFAULTS = {
  require_moderation_complete:       true,
  require_subject_comments_complete: false,
  require_report_remarks_complete:   false,
};
const PUBLICATION_POLICY_KEYS = Object.keys(PUBLICATION_POLICY_DEFAULTS);

async function _loadPublicationPolicy(schoolId) {
  const saved = await tenantModel('academic_config', { schoolId }).findOne({ schoolId }).select('publicationPolicy').lean();
  return { ...PUBLICATION_POLICY_DEFAULTS, ...(saved?.publicationPolicy || {}) };
}

/* RC9 — pure decision functions, exported (like _resolveSnapComments) for
   direct unit testing without exercising the transaction-wrapped full
   /publish route. */
function _missingSubjectComments(subjects, draft) {
  return Object.keys(subjects || {}).filter(subId => !draft?.subjectComments?.[subId]?.trim());
}

function _isReportCommentChainComplete(draft, reportCommentConfig) {
  if (!reportCommentConfig) return true; // no chain configured — nothing to require
  const stepOrder = draft?.currentStepOrder ?? 1;
  return stepOrder > reportCommentConfig.steps.length;
}

/* ── Short, deterministic per-school code embedded in reportId ──
   sha256(schoolId) truncated to 6 hex chars, not the raw schoolId itself —
   keeps the printed code a fixed length regardless of how long/short a
   given schoolId string is, and doesn't expose the school's internal id
   format on a physical document. Collisions between two different
   schoolIds hashing to the same 6 chars are astronomically unlikely
   (1 in 16^6 ≈ 16.7M) and, even if one occurred, would only matter if
   both schools also independently generated the identical year+term+seq
   report — i.e. it would recreate a narrow version of the exact bug this
   is fixing, not reopen it outright. */
function _schoolReportCode(schoolId) {
  return crypto.createHash('sha256').update(String(schoolId)).digest('hex').slice(0, 6).toUpperCase();
}

/* ── Report ID generator — RC-SSSSSS-YYYY-TN-XXXXXX ──────────
   The counter itself was always correctly school-scoped (`key` embeds
   schoolId), but the *string* previously discarded that scoping —
   RC-2026-1-000001 was reused by every school's own independent sequence,
   so GET /verify/:reportId (a deliberately public, cross-tenant-by-design
   lookup — see below) could return an ARBITRARY other school's student's
   name/admission number/grades to anyone who guessed a low sequence
   number. Embedding a short school code makes the id space actually
   collision-free, matching what that route's own comment already assumed
   was true.
   Does NOT retroactively fix reportIds already generated before this
   change — those keep their pre-fix, collision-prone format forever
   (snapshots are immutable/versioned, never rewritten). This closes the
   hole for every report generated from here on; already-issued report
   cards would need a separate, deliberate data migration to reissue. */
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
  return `RC-${_schoolReportCode(schoolId)}-${year}-${tn}-${seq}`;
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

/**
 * RC5 — closes the draft-to-published comment carry-forward gap
 * (docs/audits/REPORT_CARD_COMMENT_LIFECYCLE_REVIEW.md, "Recommendation 1").
 * On a student's first-ever publish for a term, there is no `prev` snapshot
 * to carry `comments` forward from, so it used to start completely blank —
 * regardless of what a teacher had already typed into
 * `report_card_draft_comments`. When there's no `prev`, this seeds the new
 * snapshot's `comments` from that draft doc instead; a re-publish keeps
 * carrying `prev.comments` forward exactly as before (this fix does not
 * decide draft-vs-published precedence once a report has been published
 * once — that's the approval-workflow question, out of scope here).
 * Carries every comment-shaped field the draft doc has, not just the three
 * `CommentSchema`/`PUT /:id/comments` already covers, since Sports &
 * Talent / Closing Date / Next Term / the two signer names are genuine
 * report content a school already collects pre-publish. Exported (like
 * `_hashSnapshot`/`_normalizeGradeScaleBands`) for direct unit testing
 * without exercising the transaction-wrapped full /publish route.
 */
function _resolveSnapComments(prev, draft) {
  if (prev?.comments) return prev.comments;
  return {
    subjectComments:    draft?.subjectComments    ?? {},
    classTeacherRemark: draft?.classTeacherRemark  ?? '',
    principalRemark:    draft?.principalRemark     ?? '',
    sportsAndTalent:    draft?.sportsAndTalent     ?? '',
    closingDate:        draft?.closingDate         ?? '',
    nextTermBegin:      draft?.nextTermBegin       ?? '',
    classTeacherName:   draft?.classTeacherName    ?? '',
    principalName:      draft?.principalName       ?? '',
    // RC8 — populated only for schools using the report_comment_approval
    // chain (PATCH /draft-comments/:studentId/advance); empty for every
    // other school, same as subjectComments defaulting to {}.
    reportRemarks:      draft?.reportRemarks       ?? [],
  };
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

/* ── Resolve academicYearId/termId before aggregating exam/legacy-grade
   data ────────────────────────────────────────────────────────────
   `classes` documents are NOT year-scoped (the same classId — e.g.
   "Grade 7" — persists across every academic year; students are
   promoted in/out, the class itself is never re-created). classId +
   termNumber alone can't disambiguate "Term 2 of which year" once a
   school has been through POST /transition-year more than once.

   Neither ReportCardsTab.jsx (no year picker at all — Generate &
   Publish only exposes class + term number) nor the exams-results UI's
   caller ever sends academicYearId/termId explicitly, so this resolves
   them the exact same way exam creation already does client-side
   (useCurrentAcademicPeriod → resolveCurrentPeriod): live-resolve the
   school's current academic year, then find that year's Nth term by
   position (termNumber is 1-based index into year.terms[], same
   convention _resolveCurrentPeriod itself uses). An explicit
   termId/academicYearId in the request always wins over this
   resolution — a future admin UI that adds a real year picker doesn't
   need any server change.

   Now ALSO used for aggregateAssessmentMarks (Academic Year & Term
   Dependency Map, finding #2). Previously deliberately exempted: every
   assessment_marks document was written with academicYearId: null
   (ExamsPage.jsx's Markbook never sent one), so passing a resolved
   non-null year id would have filtered every mark out and silently
   zeroed every report card's CA marks. Fixed at the source instead —
   the Markbook save payload now sends the real academicYearId, and
   assessment.js's mark-upsert adopts (and backfills) any legacy
   null-tagged record for the same key on first touch rather than
   orphaning it — so this can resolve CA marks the same way grades and
   exam results already do. A record that has genuinely never been
   re-saved since this fix still carries academicYearId: null and won't
   match a resolved year filter; that's an accepted gap for untouched
   historical marks, not a live-write bug. */
async function _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber }) {
  if (termId && academicYearId) return { academicYearId, termId };

  const years = await tenantModel('academic_years', ctx).find({ schoolId }).lean();
  let year = academicYearId
    ? years.find(y => (y.id || y._id?.toString()) === academicYearId)
    : null;
  if (!year) {
    const resolved = resolveCurrentPeriod(years);
    year = resolved.year;
  }
  if (!year) return { academicYearId: academicYearId || null, termId: termId || null };

  const resolvedYearId = year.id || year._id?.toString();
  const terms = Array.isArray(year.terms) ? year.terms : [];
  const resolvedTermId = termId || (termNumber ? (terms[termNumber - 1]?.id ?? null) : null);

  return { academicYearId: resolvedYearId, termId: resolvedTermId };
}

/* ══════════════════════════════════════════════════════════════
   POST /generate  — live preview (not persisted)
   ══════════════════════════════════════════════════════════════ */
router.post('/generate', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { data, error } = _validate(GenerateSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, termId, termNumber: termNum, academicYearId, studentId } = data;
    const ctx = tenantContext(req);
    // classId alone can't disambiguate which academic year — resolve the
    // real year/term before aggregating exam/legacy-grade data (see
    // _resolveTermScope's own comment for why assessment_marks is exempt).
    const scope = await _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber: termNum });

    const [config, caConfig] = await Promise.all([
      _loadConfig(schoolId),
      _loadCaConfig(schoolId),
    ]);

    const [gradesData, { data: examData }, caMarksData] = await Promise.all([
      aggregateGrades(schoolId, classId, scope.termId, scope.academicYearId, studentId),
      aggregateExamResults(schoolId, classId, scope.termId, scope.academicYearId, studentId),
      aggregateAssessmentMarks(schoolId, classId, termNum ?? null, scope.academicYearId, studentId),
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
router.post('/publish', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
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
  const ctx     = tenantContext(req);

  // Same live-resolution as /generate — the client only ever sends
  // {classId, termNumber}, never termId/academicYearId, so without this
  // every aggregation below would silently pull data across ALL years for
  // the class (classes are not year-scoped — see _resolveTermScope above).
  const scope = await _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber: termNum });

  // ── Step 1: Create batch record (interrupt-safe anchor) ──────
  const Batches = tenantModel('publish_batches', ctx);
  await Batches.create({
    id: batchId, schoolId, classId,
    termId: scope.termId, academicYearId: scope.academicYearId,
    status: 'running', startedBy: userId, startedAt: now,
    studentCount: 0, successCount: 0, failedStudents: [],
    moderationBypassed: skipModerationCheck,
    moderationBypassReason: skipReason || null,
  });

  try {
    // ── Step 1b: Block publish for archived academic years ───
    if (scope.academicYearId && await isYearArchived(schoolId, scope.academicYearId)) {
      await Batches.updateOne({ id: batchId }, {
        status: 'failed',
        failureReason: `Academic year "${scope.academicYearId}" is archived — publishing is not permitted for closed years.`,
        completedAt: now,
      });
      return E.badRequest(res, `Academic year "${scope.academicYearId}" has been archived — report card publishing is not permitted for closed years.`);
    }

    const [config, caConfig, policy] = await Promise.all([
      _loadConfig(schoolId),
      _loadCaConfig(schoolId),
      _loadPublicationPolicy(schoolId),
    ]);

    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes);
    // Prefer grade_boundaries default scale over legacy academic_config.gradingSchema
    const activeSchema  = caConfig.gradeScale?.bands ?? config.gradingSchema;

    // ── Step 2: Moderation guard ─────────────────────────────
    // RC9 — enforcement is now policy-driven, default true (today's exact
    // hardcoded behavior for every school that hasn't opted out).
    const { data: examData, examStatuses } = await aggregateExamResults(schoolId, classId, scope.termId, scope.academicYearId);

    if (skipModerationCheck) {
      // Write audit entry for the bypass — this is mandatory, non-negotiable
      await tenantModel('mark_audit_log', ctx).create({
        action:    'MODERATION_BYPASS',
        batchId,
        schoolId,  classId,
        termId:    scope.termId,
        editedBy:  userId,
        reason:    skipReason,
        timestamp: now,
        examStatusAtBypass: examStatuses.map(e => ({ id: e.id, title: e.title, status: e.status })),
      });
      console.warn(`[REPORT-CARDS] ⚠️  Moderation check BYPASSED — batch ${batchId} by ${userId}: "${skipReason}"`);
    } else if (policy.require_moderation_complete) {
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
      aggregateGrades(schoolId, classId, scope.termId, scope.academicYearId),
      // scope.academicYearId — see _resolveTermScope's comment above.
      // Markbook now tags marks with the real year and adopts/backfills
      // any legacy null-tagged record on first touch, so this can resolve
      // the year the same way grades does.
      aggregateAssessmentMarks(schoolId, classId, termNum ?? null, scope.academicYearId),
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
      termId: scope.termId, academicYearId: scope.academicYearId,
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

    // ── Step 6f: Resolve stream names once per distinct id present in this
    // class (RCE1 cover field) — same batching convention as Step 6e's
    // per-section template resolution, not a lookup per student.
    const distinctStreamIds = [...new Set(students.map(s => s.streamId).filter(Boolean))];
    const streamNameById = {};
    if (distinctStreamIds.length) {
      const streamDocs = await tenantModel('streams', tenantContext(req))
        .find({ schoolId, id: { $in: distinctStreamIds } }).select('id name').lean();
      for (const s of streamDocs) streamNameById[s.id] = s.name;
    }

    // ── Step 6a: Batch-load draft comments for first-ever publishes (RC5) ──
    // Only students with no `prev` snapshot need this for comment
    // carry-forward — a re-publish keeps carrying prev.comments forward,
    // unchanged. RC9's completeness gates below are a different question
    // ("did the draft get filled in") and need every student's draft doc
    // regardless of prev, so the load widens to all studentIds whenever
    // either completeness rule is active.
    const needsCompletenessCheck = policy.require_subject_comments_complete || policy.require_report_remarks_complete;
    const draftLoadIds = needsCompletenessCheck ? studentIds : studentIds.filter(sid => !existingMap[sid]);
    const draftCommentsMap = {};
    if (draftLoadIds.length && termNum != null) {
      const draftDocs = await tenantModel('report_card_draft_comments', tenantContext(req))
        .find({ schoolId, studentId: { $in: draftLoadIds }, termNumber: termNum }).lean();
      for (const d of draftDocs) draftCommentsMap[d.studentId] = d;
    }

    // ── Step 6d: Load the report-comment approval chain config, if RC9's
    // "require complete" rule for it is on — a single lookup, not per-student.
    const reportCommentConfig = policy.require_report_remarks_complete
      ? await getWorkflowConfig(tenantContext(req), schoolId, REPORT_COMMENT_WORKFLOW_KEY)
      : null;

    // ── Step 6e: Resolve report-card template per distinct sectionId
    // present in this class, once each (RC11) — not one resolveTemplate()
    // call per student. resolveTemplate() itself already falls through
    // section-default → school-default → Legacy Tabular, so a student
    // with no sectionId just resolves against the `null` bucket.
    const distinctSectionIds = [...new Set(Object.values(studentMap).map(s => s.sectionId || null))];
    const templateBySection = {};
    for (const secId of distinctSectionIds) {
      templateBySection[secId ?? '__none__'] = await resolveTemplate(tenantContext(req), schoolId, secId);
    }

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
    let houseNameById         = {};
    try {
      const schoolDoc = await _model('schools').findOne({ id: schoolId }).select('principalSignatureUrl schoolStampUrl houses').lean();
      principalSignatureUrl = schoolDoc?.principalSignatureUrl || null;
      schoolStampUrl        = schoolDoc?.schoolStampUrl        || null;
      // RCE1 — house names for the cover page; houses are a freeform
      // array on the school doc (no dedicated collection), keyed by
      // `id` when present else `name` itself (matches how the Settings
      // UI already keys deletions: `(h.id ?? h.name)`).
      houseNameById = Object.fromEntries(
        (Array.isArray(schoolDoc?.houses) ? schoolDoc.houses : [])
          .map(h => [h.id ?? h.name, h.name]).filter(([id]) => id)
      );
    } catch (_) { /* non-fatal */ }

    // ── Step 7: Build new snapshots ──────────────────────────
    const newSnaps     = [];
    const supersedeOps = [];
    const partialFails = [];

    for (const r of Object.values(allReports)) {
      try {
        const stu  = studentMap[r.studentId] || {};
        const prev = existingMap[r.studentId];
        const draft = draftCommentsMap[r.studentId];
        const template = templateBySection[stu.sectionId || '__none__'];

        // RC9 — Publication Policy completeness gates. Per-student, not
        // batch-wide: one student missing a comment doesn't block the
        // rest of the class (matches this loop's existing per-student
        // try/catch → partialFails pattern for every other failure mode).
        if (policy.require_subject_comments_complete && caConfig.subjectTeacherCommentsEnabled !== false) {
          const missing = _missingSubjectComments(r.subjects, draft);
          if (missing.length > 0) {
            throw new Error(`Subject comments incomplete — missing for: ${missing.join(', ')}`);
          }
        }
        if (policy.require_report_remarks_complete && !_isReportCommentChainComplete(draft, reportCommentConfig)) {
          throw new Error('Report-level remark approval chain has not been completed for this student');
        }

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
          // RCE1 — cover-page fields, resolved once per distinct id above.
          // streamId itself (not just the display name) denormalized here
          // too — same convention as attendance/grades/assessment — so
          // report-card reads can eventually be stream-scoped the same way
          // once that read-side gap (Security Baseline Register
          // AUTHZ-19/20/21, pre-existing and separately tracked, not
          // touched by this change) is closed. Safe to add unconditionally:
          // _hashSnapshot uses an explicit field allowlist, so this doesn't
          // touch the integrity hash, same as streamName/templateId already don't.
          streamId:       stu.streamId || null,
          streamName:     stu.streamId ? (streamNameById[stu.streamId] || '') : '',
          houseName:      stu.houseId  ? (houseNameById[stu.houseId]   || '') : '',
          classId,        className:   className   || '',
          termId:         scope.termId,  termName:    termName    || '',
          termNumber:     termNum        ?? null,
          academicYearId: scope.academicYearId,  academicYear: academicYear || '',
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

          // Carry forward comments from the previous version, or — for a
          // first-ever publish — seed from the draft comments doc (RC5).
          comments: _resolveSnapComments(prev, draft),

          // Snapshot school signature/stamp URLs at publish time (stays valid even if URLs change later)
          principalSignatureUrl,
          schoolStampUrl,

          attendanceSummary: null,
          financialBlock:    blockedStudentIds.has(r.studentId),
          // RC11 — presentation-only, deliberately outside _hashSnapshot's
          // payload (Consolidation Plan §2.3): a school re-theming its
          // templates later must never invalidate an old report's hash.
          templateId:        template.templateId,
          templateVersion:   template.templateVersion,
          // RCE2 — the rendering key this snapshot must use forever,
          // frozen alongside templateId/templateVersion for the exact
          // same reason: re-theming later must never change history.
          layoutKey:         template.layoutKey,
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
      classId,     termId: scope.termId,
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
    AuditService.log({ action: 'report_card.publish', actor: req.jwtUser, schoolId, target: { type: 'class', id: classId, label: className }, details: { batchId, termId: scope.termId, studentCount: newSnaps.length, status: finalStatus }, req });

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
router.get('/publish-batches', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
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
router.get('/', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
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
    // Verifies a report card by its reportId without knowing the school —
    // an intentional cross-tenant lookup. Stays on _model(); tenantModel()
    // would (correctly) fail closed here. reportId is globally unique for
    // every report generated by _nextReportId() above (which embeds a
    // per-school code specifically so this single-argument, no-schoolId
    // lookup is safe) — but reports generated before that fix used a
    // shorter, per-school-only-unique format and can still collide across
    // schools; those are not retroactively covered.
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
   GET /bulk-pdf  — cursor-streamed class PDF (no giant buffer)

   Registered here, before GET /:id, on purpose — Express matches
   single-segment routes in registration order, and /:id would
   otherwise swallow every request to /bulk-pdf (id='bulk-pdf', no
   matching snapshot, 404) before this handler is ever reached. Same
   reasoning applies to GET /draft-comments right below it. Found via
   direct testing while scoping RC8 (which adds a third single-segment
   GET route, /workflow-config, at this same prefix) — both were
   completely unreachable before this fix, confirmed with no existing
   test coverage to have caught it.
   ══════════════════════════════════════════════════════════════ */
router.get('/bulk-pdf', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
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

    // RCE3c — class-wide extras resolved ONCE for the whole batch, not
    // per student (this is a bulk export — an extra query per student
    // would multiply real cost). school/subjectTeacherNames/comments-
    // capability are the same for every student in one class; behaviour
    // and term-over-term deviation stay unresolved here (genuinely
    // per-student, and neither layout shipped so far needs them in the
    // bulk-export path) — a documented scope boundary, not an oversight.
    // Resolved AFTER the zero-match 404 check above — no point paying
    // for 3 extra queries on a request that's about to 404 anyway.
    const [bulkSchool, bulkCaConfig, bulkAssignments] = await Promise.all([
      _model('schools').findOne({ id: schoolId }, { logoUrl: 1, tagline: 1, address: 1, phone: 1, email: 1, website: 1 }).lean().catch(() => null),
      _getAssessmentConfig(schoolId, req.query.academicYearId || null),
      tenantModel('teaching_assignments', tenantContext(req))
        .find({ schoolId, classId: req.query.classId }).select('subjectId teacherName').lean().catch(() => []),
    ]);
    const bulkSubjectTeacherNames = {};
    for (const a of bulkAssignments) {
      if (!bulkSubjectTeacherNames[a.subjectId]) bulkSubjectTeacherNames[a.subjectId] = a.teacherName || '';
    }
    const bulkExtra = {
      school: bulkSchool, subjectTeacherNames: bulkSubjectTeacherNames,
      subjectTeacherCommentsEnabled: bulkCaConfig.subjectTeacherCommentsEnabled !== false,
    };

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
          { ...bulkImages, studentPhoto: photoBuffers[i] }, bulkExtra);
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

// GET /draft-comments?classId=&termNumber= — same registration-order reasoning as /bulk-pdf above
router.get('/draft-comments', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'read'), async (req, res) => {
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

/* GET/PUT /workflow-config — school-configured report-level remark chain
   (RC8). Registered here for the same registration-order reason as
   /bulk-pdf and /draft-comments above — a third single-segment GET
   route that would otherwise be shadowed by GET /:id. */
router.get('/workflow-config', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const config = await getWorkflowConfig(tenantContext(req), schoolId, REPORT_COMMENT_WORKFLOW_KEY);
    return ok(res, config || { schoolId, workflowKey: REPORT_COMMENT_WORKFLOW_KEY, steps: [], notifyOnly: [] });
  } catch (err) {
    console.error('[report-cards/workflow-config GET]', err);
    return E.serverError(res);
  }
});

router.put('/workflow-config', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { steps, notifyOnly } = req.body;
    const doc = await saveWorkflowConfig(tenantContext(req), schoolId, REPORT_COMMENT_WORKFLOW_KEY, { steps, notifyOnly }, userId, REPORT_COMMENT_MIN_STEPS);
    return ok(res, doc);
  } catch (err) {
    if (err.statusCode === 400) return E.badRequest(res, err.message);
    console.error('[report-cards/workflow-config PUT]', err);
    return E.serverError(res);
  }
});

/* GET/PATCH /publication-policy — RC9. Same registration-order reasoning
   as /bulk-pdf, /draft-comments, /workflow-config above — a fourth
   single-segment GET route that would otherwise be shadowed by GET /:id. */
router.get('/publication-policy', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    return ok(res, await _loadPublicationPolicy(schoolId));
  } catch (err) {
    console.error('[report-cards/publication-policy GET]', err);
    return E.serverError(res);
  }
});

router.patch('/publication-policy', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const updates = req.body || {};
    const invalidKeys = Object.keys(updates).filter(k => !PUBLICATION_POLICY_KEYS.includes(k));
    if (invalidKeys.length > 0) {
      return E.badRequest(res, `Unknown publication policy key(s): ${invalidKeys.join(', ')}`);
    }
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'boolean') return E.badRequest(res, `${key} must be a boolean`);
    }

    const Config  = tenantModel('academic_config', tenantContext(req));
    const current = await Config.findOne({ schoolId }).select('publicationPolicy').lean();
    const merged  = { ...PUBLICATION_POLICY_DEFAULTS, ...(current?.publicationPolicy || {}), ...updates };
    await Config.findOneAndUpdate(
      { schoolId },
      { $set: { schoolId, publicationPolicy: merged } },
      { upsert: true, new: true }
    ).lean();
    return ok(res, merged);
  } catch (err) {
    console.error('[report-cards/publication-policy PATCH]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /:id  — full snapshot
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
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
router.put('/:id/comments', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
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

/* RCE3c — resolves every "presentation, not scored content" extra
   _computeReportSections's 4th param accepts (school branding/contact,
   behaviour, term-over-term deviations, subject-teacher-comments
   capability, subject-teacher names) for a SINGLE snapshot. Was
   previously inlined in GET /:id/html only — GET /:id/pdf never called
   any of this, which was invisible while legacy_tabular's PDF renderer
   ignored these fields entirely, but became a real gap once a layout
   (subject_paired) started reading them: a school with subject-teacher
   comments disabled would still see them in a downloaded PDF. One
   helper now, used by both, so they can never drift apart again. */
async function _loadRenderExtras(req, schoolId, snap) {
  const [school, behaviour, prevSnap, caConfig, assignments] = await Promise.all([
    _model('schools').findOne({ id: schoolId }, { logoUrl: 1, tagline: 1, address: 1, phone: 1, email: 1, website: 1 }).lean().catch(() => null),
    behaviourSummary(schoolId, snap.studentId).catch(() => null),
    snap.termNumber > 1
      ? tenantModel('report_card_snapshots', tenantContext(req)).findOne({
          schoolId, studentId: snap.studentId, academicYearId: snap.academicYearId,
          termNumber: snap.termNumber - 1, superseded: { $ne: true },
        }).lean().catch(() => null)
      : Promise.resolve(null),
    _getAssessmentConfig(schoolId, snap.academicYearId ?? null),
    tenantModel('teaching_assignments', tenantContext(req))
      .find({ schoolId, classId: snap.classId, subjectId: { $in: Object.keys(snap.subjects || {}) } })
      .select('subjectId teacherName').lean().catch(() => []),
  ]);
  const deviations = computeTermDeviation(snap.subjects, prevSnap?.subjects);
  // First assignment found per subject wins — a subject could in theory
  // have more than one teaching_assignments doc (co-teaching); the
  // report shows one name, not a list.
  const subjectTeacherNames = {};
  for (const a of assignments) {
    if (!subjectTeacherNames[a.subjectId]) subjectTeacherNames[a.subjectId] = a.teacherName || '';
  }
  return {
    school, behaviour, deviations, subjectTeacherNames,
    subjectTeacherCommentsEnabled: caConfig.subjectTeacherCommentsEnabled !== false,
  };
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
   — not a redesign of what's shown or how.

   RC3 (Consolidation Plan Phase 4 step 3) added the optional 4th
   `extra` param and several new output fields (cover/behaviour/
   gradingKey/per-row deviationText) for the new HTML adapter below.
   _drawReportPage only reads the specific keys it already read before
   RC3 — it never enumerates all of `s`'s keys — so these additions
   are inert to the PDF path and its golden fixture stays unchanged. */
function _computeReportSections(snap, config, attendance, extra = {}) {
  // subjectTeacherCommentsEnabled defaults true — every existing caller
  // that doesn't pass it (e.g. legacy_tabular's PDF renderer, which
  // never reads comments.subjectComments at all) keeps today's behavior.
  const {
    school = null, behaviour = null, deviations = null, subjectTeacherCommentsEnabled = true,
    // RCE3c — {subjectId: teacherName}, resolved by the caller from
    // teaching_assignments (same "caller resolves, IR formats" posture
    // as deviations/behaviour/school above). Presentation-only — who
    // currently teaches a subject is never frozen at publish time.
    subjectTeacherNames = {},
  } = extra;
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
    const dev = deviations?.subjects ? (deviations.subjects[subjectId] ?? null) : null;
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
      // Term-over-term (not class-average) deviation — resolved by the
      // caller (I/O: needs the previous term's computed report), same
      // "caller resolves, IR just formats" posture `attendance` already
      // has. null when no comparable previous-term score exists.
      deviationText: dev == null ? null : (dev >= 0 ? `+${dev.toFixed(1)}` : dev.toFixed(1)),
    };
  });

  const rankingNote = (snap.rankingSubjectStrategy && snap.rankingSubjectStrategy !== 'all')
    ? `● Subjects counted toward rank (${snap.rankingSubjectStrategy === 'best_n' ? `Best ${snap.rankingN}` : 'Compulsory only'})`
    : null;

  const showRanking = !!(config.rankingEnabled && config.showRankOnReport !== false && snap.rankings?.class);
  const showAttendance = !!(config.showAttendanceSummary && attendance);
  const showBehaviourSection = config.showBehaviour !== false && !!behaviour;

  // Whatever grading bands actually graded THIS report's subjects —
  // never a client-local default (Audit §6.2, same discipline
  // _normalizeGradeScaleBands already enforces elsewhere in this file).
  const gradeBands = _normalizeGradeScaleBands(snap.gradingSchema).sort((a, b) => b.min - a.min);
  const meanGrade  = snap.averageScore != null && gradeBands.length ? resolveGrade(snap.averageScore, snap.gradingSchema) : null;

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
    resultsTable: {
      typeEntries, rows, rankingNote,
      // RCE1 — wires academic_config.showDeviation live (previously
      // defined in the schema/merge but never read anywhere). Kept as
      // its own flag rather than nulling out deviationText per-row so
      // "no comparable prior score" and "config says hide" stay distinct
      // reasons a renderer can tell apart.
      showDeviation: config.showDeviation !== false,
    },
    summary: {
      totalText:   `Total Score: ${snap.totalScore?.toFixed(1) ?? '—'}`,
      averageText: `Average: ${snap.averageScore?.toFixed(1) ?? '—'}%`,
      // RCE1 — wires academic_config.showClassAverage live (previously dead).
      showAverage: config.showClassAverage !== false,
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
      // RCE1 — new toggles, independent of whether a remark was actually
      // entered. Consumed starting with the RCE3/4 layout renderers;
      // legacy_tabular ignores them and keeps always showing both blocks.
      showClassTeacherRemark: config.showClassTeacherRemark !== false,
      showPrincipalRemark:    config.showPrincipalRemark    !== false,
      // RC3-only fields (not read by the PDF adapter) — persisted by
      // RC5's draft-to-published carry-forward fix.
      sportsAndTalent: sanitisePdfStr(snap.comments?.sportsAndTalent) || '',
      closingDate:     snap.comments?.closingDate   || '',
      nextTermBegin:   snap.comments?.nextTermBegin || '',
      classTeacherName: snap.comments?.classTeacherName || '',
      principalName:    snap.comments?.principalName    || '',
      // RC7 — a disabled capability produces zero trace in the output
      // (Functional Architecture §11): no rows built at all, and the HTML
      // adapter uses this same flag to skip the section header/table too,
      // rather than rendering an empty "No comment entered" list.
      subjectTeacherCommentsEnabled,
      subjectComments: subjectTeacherCommentsEnabled
        ? Object.keys(snap.subjects || {}).map(subjectId => ({
            subjectId, text: sanitisePdfStr(snap.comments?.subjectComments?.[subjectId]) || '',
            // RCE3c — the actual subject teacher's name, when known, so
            // a layout can label the comment with who wrote it instead
            // of a generic "Teacher Comment" heading.
            teacherName: subjectTeacherNames[subjectId] || '',
          }))
        : [],
      // RC8 — populated only for schools using the report_comment_approval
      // chain; empty array for every school that still writes
      // classTeacherRemark/principalRemark directly (the two fields
      // above stay correct and rendered as before in that case).
      reportRemarks: (snap.comments?.reportRemarks || []).map(r => ({
        label: r.label || 'Remark', text: sanitisePdfStr(r.remark) || '',
      })),
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
    // ── RC3-only sections below — read only by _computeReportHTML,
    //    never by _drawReportPage (PDF stays pixel-for-pixel unchanged) ──
    cover: {
      logoUrl:  school?.logoUrl  || null,
      tagline:  school?.tagline  || '',
      subtitle: `ACADEMIC REPORT — TERM ${snap.termNumber ?? '—'} — ${snap.academicYear || ''}`,
      rows: [
        { label: 'Student Name',  value: snap.studentName || '—' },
        { label: 'Admission No.', value: snap.admissionNo || '—' },
        { label: 'Class',         value: snap.className   || '—' },
        { label: 'Mean Mark',     value: `${snap.averageScore != null ? snap.averageScore.toFixed(1) + '%' : '—'}` +
                                          (meanGrade?.grade ? ` — ${meanGrade.grade} (${meanGrade.descriptor || ''})` : '') },
        { label: 'Class Rank',    value: showRanking ? `${snap.rankings.class.rank}/${snap.rankings.class.outOf}` : '—' },
        { label: 'Class Teacher', value: snap.comments?.classTeacherName || '—' },
      ],
      // RCE1 — named fields for the RCE3/4 layout renderers' own
      // cover-page components (a fixed label/value list doesn't let
      // those layouts control their own visual arrangement). `rows`
      // above is unchanged and still what legacy_tabular's HTML cover
      // renders from.
      title:            'REPORT CARD',
      schoolName:       snap.schoolName    || '',
      studentName:      snap.studentName   || '—',
      admissionNo:      snap.admissionNo   || '—',
      className:        snap.className    || '—',
      streamName:       snap.streamName   || '',
      houseName:        snap.houseName    || '',
      academicYear:     snap.academicYear || '',
      termNumber:       snap.termNumber   ?? null,
      // RCE3b — school identity/contact, resolved live at render time
      // (branding, not scored content — same non-frozen posture logoUrl/
      // tagline already have; a school updating its address later is
      // fine to show on a re-render of an old report).
      schoolAddress:    school?.address || '',
      schoolPhone:      school?.phone   || '',
      schoolEmail:      school?.email   || '',
      schoolWebsite:    school?.website || '',
      classTeacherName: snap.comments?.classTeacherName || '',
      principalName:    snap.comments?.principalName    || '',
      studentPhotoUrl:  snap.studentPhotoUrl || null,
    },
    gradingKey: gradeBands.map((b, i) => ({
      grade:  b.grade,
      range:  `${b.min}–${i === 0 ? 100 : gradeBands[i - 1].min - 1}%`,
      points: b.points ?? '—',
      label:  b.label  ?? '',
    })),
    behaviour: showBehaviourSection ? {
      merits:   behaviour.merits   ?? 0,
      demerits: behaviour.demerits ?? 0,
      points:   behaviour.points   ?? 0,
      total:    behaviour.total    ?? 0,
    } : null,
  };
}


/* RCE2 — dispatches on the SNAPSHOT'S OWN frozen layoutKey, never the
   school's current default. A published report_card_snapshots doc must
   render identically forever regardless of what a school configures
   later (same immutability guarantee _hashSnapshot's fixed field list
   already protects) — snapshots published before this engine existed
   simply have no layoutKey, which getLayout() maps to 'legacy_tabular',
   today's exact pre-existing output. */
function _buildPDFPage(doc, snap, config, attendance, isFirstPage, images = {}, extra = {}) {
  const sections = _computeReportSections(snap, config, attendance, extra);
  getLayout(snap.layoutKey).renderPdf(doc, sections, images, isFirstPage);
}

/* ── Portal roles bypass RBAC; the handler does ownership + fee checks ── */
function _pdfAccess(req, res, next) {
  if (RESTRICTED_ROLES.includes(req.jwtUser?.role)) return next();
  return rbac('grades', 'read')(req, res, next);
}

/* Shared ownership + ­fee-clearance gate for a single snapshot — used by
   both GET /:id/pdf and GET /:id/html so the two output formats can never
   drift on who's allowed to see a given report card. Sends the
   appropriate error response itself and returns false when access is
   denied; the caller's route handler should `return` immediately on
   false, exactly the same "guard clause decides, caller trusts it"
   shape _pdfAccess already established one level up (RBAC vs. ownership). */
async function _checkSnapshotAccess(req, res, snap) {
  const { schoolId, role, guardianOf, studentId: jwtStudentId, userId } = req.jwtUser;

  if (snap.superseded && RESTRICTED_ROLES.includes(role)) {
    E.forbidden(res, 'This report card has been superseded. Please download the latest version.');
    return false;
  }

  if (role === 'student' && snap.studentId !== jwtStudentId) {
    E.forbidden(res, 'You are not authorised to download this report card.');
    return false;
  }

  if (['parent', 'guardian'].includes(role)) {
    const linkedStudents = Array.isArray(guardianOf) ? guardianOf : [];
    if (!linkedStudents.includes(snap.studentId)) {
      tenantModel('mark_audit_log', tenantContext(req)).create({
        action:       'GUARDIAN_ACCESS_DENIED',
        schoolId,
        requestedBy:  userId,
        requestedRole: role,
        targetStudentId: snap.studentId,
        snapshotId:   snap.id,
        route:        req.method + ' ' + req.baseUrl + req.path,
        timestamp:    new Date().toISOString(),
      }).catch(e => console.error('[report-cards] guardian audit log failed:', e.message));
      E.forbidden(res, 'You are not authorised to download this student\'s report card.');
      return false;
    }
  }

  // Fee clearance check — uses school-configurable threshold (default 100 = fully
  // paid). Admins always bypass. ?force=1 is a genuine, deliberate override —
  // the comment that used to sit here said so explicitly ("Admins and force=1
  // always bypass") — but the implementation granted it to ANY role that
  // reaches this handler, including self-service parent/student/guardian
  // callers via _pdfAccess's RESTRICTED_ROLES bypass, with no authorization
  // check and no audit trail. No caller anywhere in this codebase has ever
  // actually sent force=1 (grepped the whole client — zero hits), so nothing
  // relies on the old, open behavior. Security Baseline Register, CFG-03.
  const isAdmin = ['admin', 'superadmin'].includes(role);
  const forced  = req.query.force === '1';

  if (forced && !isAdmin) {
    tenantModel('mark_audit_log', tenantContext(req)).create({
      action:          'FEE_CLEARANCE_OVERRIDE_DENIED',
      schoolId,
      requestedBy:     userId,
      requestedRole:   role,
      targetStudentId: snap.studentId,
      snapshotId:      snap.id,
      route:           req.method + ' ' + req.baseUrl + req.path,
      timestamp:       new Date().toISOString(),
    }).catch(e => console.error('[report-cards] fee-override-denied audit log failed:', e.message));
    E.forbidden(res, 'Only an administrator can override the fee-clearance requirement.');
    return false;
  }

  if (isAdmin) {
    if (forced) {
      // The override was explicitly invoked, not just implied by role — worth
      // its own audit trail distinct from an admin's routine download, which
      // never needed the fee check to begin with.
      tenantModel('mark_audit_log', tenantContext(req)).create({
        action:          'FEE_CLEARANCE_OVERRIDDEN',
        schoolId,
        requestedBy:     userId,
        requestedRole:   role,
        targetStudentId: snap.studentId,
        snapshotId:      snap.id,
        route:           req.method + ' ' + req.baseUrl + req.path,
        timestamp:       new Date().toISOString(),
      }).catch(e => console.error('[report-cards] fee-override audit log failed:', e.message));
    }
  } else {
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
          res.status(403).json({
            error: `Report card access blocked — ${clearancePct}% of fees cleared (${threshold}% required).`,
            financialBlock: true, clearancePct, threshold,
          });
          return false;
        }
      }
    } catch (_) {
      // Non-fatal — fall back to the snapshot's stored flag
      if (snap.financialBlock) {
        res.status(403).json({ error: 'Download blocked — outstanding fee balance.', financialBlock: true });
        return false;
      }
    }
  }

  return true;
}

/* ══════════════════════════════════════════════════════════════
   GET /:id/pdf  — single student PDF
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/pdf', authMiddleware, PLAN, MODGATE, _pdfAccess, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (!(await _checkSnapshotAccess(req, res, snap))) return;

    let attData = snap.attendanceSummary;
    if (!attData) {
      attData = await attendanceSummary(schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId);
    }
    const config = await _loadConfig(schoolId);
    // RCE3c — single-student download, so the full extras set (same as
    // GET /:id/html) is cheap; a downloaded PDF must not silently ignore
    // a school's subject-teacher-comments toggle or lose the subject
    // teacher's name just because it came from the PDF route.
    const extra = await _loadRenderExtras(req, schoolId, snap);

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
    _buildPDFPage(doc, snap, config, attData, true, pdfImages, extra);
    doc.end();
  } catch (err) { console.error('[report-cards/:id/pdf]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /:id/html  — the HTML adapter's output for a PUBLISHED (or
   superseded) snapshot. RC3: this is what retires printCard() for
   the "download/print an already-published report card" case — same
   access gate as GET /:id/pdf (_checkSnapshotAccess), same IR
   (_computeReportSections), different adapter. Behaviour/deviation
   are never snapshotted (same "resolve live if not on the frozen
   snapshot" posture attendance already has here) — a school renaming
   its logo after publish is fine to show on a re-render (branding,
   not scored content); the actual marks/grades/rankings are frozen.
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/html', authMiddleware, PLAN, MODGATE, _pdfAccess, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (!(await _checkSnapshotAccess(req, res, snap))) return;

    let attData = snap.attendanceSummary;
    if (!attData) {
      attData = await attendanceSummary(schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId);
    }
    const config = await _loadConfig(schoolId);
    const extra  = await _loadRenderExtras(req, schoolId, snap);

    const sections = _computeReportSections(snap, config, attData, extra);
    // RCE2 — dispatch on the SNAPSHOT'S OWN frozen layoutKey, same
    // immutability guarantee as _buildPDFPage's PDF path.
    const html = getLayout(snap.layoutKey).renderHtml(sections);
    return ok(res, { html });
  } catch (err) { console.error('[report-cards/:id/html]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   POST /preview-html  — the HTML adapter's output for a live,
   unpublished draft — the second half of what retires printCard().

   Deliberately does NOT re-run POST /generate's aggregation pipeline
   for one student. Two real reasons, not just convenience:
     1. A single-student re-aggregation can't reproduce a real class
        rank (rankStudents() needs the whole class's scores) — the
        client already HAS the real one, computed once for the whole
        class by the /generate call ReportCardsTab.jsx already made to
        render this exact student on screen.
     2. StudentReportCard.jsx's on-screen preview already receives
        every piece of data this needs as props (student, studentInfo,
        className, school, academicYear, draftComment,
        studentDeviations [term-over-term, computed client-side from
        two /generate calls], behaviourSummary [already fetched]) —
        printCard() today builds its HTML straight from those props,
        entirely client-side, with no server round trip at all. This
        route accepts that exact same already-computed data and
        denormalises + renders it through the shared IR/HTML adapter
        instead — replacing WHERE the HTML is built, not what's
        trusted: the client already had 100% control over printCard()'s
        output; nothing here is newly persisted, newly authoritative,
        or newly exposed to any other party — the response goes back to
        the same authenticated user who submitted it.
   ══════════════════════════════════════════════════════════════ */
const PreviewHtmlSchema = z.object({
  student: z.object({
    studentId: z.string().min(1),
    subjects: z.record(z.any()).default({}),
    totalScore: z.number().nullable().optional(),
    averageScore: z.number().nullable().optional(),
    gpa: z.number().nullable().optional(),
    subjectCount: z.number().nullable().optional(),
    rankings: z.record(z.any()).optional(),
    classTeacherName: z.string().nullable().optional(),
  }),
  studentInfo: z.object({
    firstName: z.string().optional(), lastName: z.string().optional(),
    admissionNumber: z.string().optional(), photo: z.string().nullable().optional(),
  }).optional(),
  className: z.string().optional(),
  termNum: z.number().int().min(1).max(3).optional(),
  academicYear: z.string().optional(),
  school: z.object({
    name: z.string().optional(), logoUrl: z.string().nullable().optional(), tagline: z.string().optional(),
    address: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), website: z.string().optional(),
  }).optional(),
  draftComment: z.record(z.any()).nullable().optional(),
  studentDeviations: z.object({ subjects: z.record(z.number().nullable()).optional() }).nullable().optional(),
  behaviourSummary: z.object({ merits: z.number(), demerits: z.number(), points: z.number(), total: z.number() }).nullable().optional(),
  config: z.object({
    gradeScale: z.object({ bands: z.array(z.any()).optional() }).nullable().optional(),
    // customTypes ({key,label,instances,weight}[]) is converted to the
    // {assessmentType,label,weight}[] shape _computeReportSections
    // expects via _convertCustomTypesToWeights — the same conversion
    // POST /generate and POST /publish already apply, single source of
    // truth for what that shape-change means.
    customTypes: z.array(z.any()).nullable().optional(),
    passMark: z.number().optional(), rankingEnabled: z.boolean().optional(), showGPA: z.boolean().optional(),
    subjectTeacherCommentsEnabled: z.boolean().optional(),
  }).optional(),
});

router.post('/preview-html', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { data, error } = _validate(PreviewHtmlSchema, req.body);
    if (error) return E.validation(res, error);
    const { student, studentInfo, className, termNum, academicYear, school, draftComment, studentDeviations, behaviourSummary: beh, config: clientConfig } = data;

    const gradingSchema = clientConfig?.gradeScale?.bands ?? [];

    // Denormalise into the exact snap-shape _computeReportSections
    // expects — status:'draft' so the IR's isDraft/watermark logic
    // applies unchanged.
    const snap = {
      status: 'draft', superseded: false, version: 1,
      studentId: student.studentId,
      studentName: [studentInfo?.firstName, studentInfo?.lastName].filter(Boolean).join(' ') || student.studentId,
      admissionNo: studentInfo?.admissionNumber || '',
      studentPhotoUrl: studentInfo?.photo || null,
      className: className || '',
      termNumber: termNum ?? null, academicYear: academicYear || '',
      schoolName: school?.name || '',
      gradingSchema,
      assessmentWeights: _convertCustomTypesToWeights(clientConfig?.customTypes ?? []),
      passMark: clientConfig?.passMark, rankingSubjectStrategy: null,
      subjects: student.subjects, totalScore: student.totalScore, averageScore: student.averageScore,
      gpa: student.gpa, subjectCount: student.subjectCount,
      rankings: student.rankings ?? {},
      comments: _resolveSnapComments(null, { ...draftComment, classTeacherName: draftComment?.classTeacherName || student.classTeacherName || '' }),
    };
    const config = { rankingEnabled: !!clientConfig?.rankingEnabled, showGPA: !!clientConfig?.showGPA, showAttendanceSummary: false };

    const sections = _computeReportSections(snap, config, null, {
      school, behaviour: beh ?? null, deviations: studentDeviations ?? null,
      subjectTeacherCommentsEnabled: clientConfig?.subjectTeacherCommentsEnabled !== false,
    });
    // RCE2 — an unpublished draft has no frozen layoutKey of its own, so
    // preview uses the school's LIVE current default (school-wide, no
    // section context available here) rather than a snapshotted one.
    const { schoolId } = req.jwtUser;
    const { layoutKey } = await resolveTemplate(tenantContext(req), schoolId, null);
    const html = getLayout(layoutKey).renderHtml(sections);
    return ok(res, { html });
  } catch (err) { console.error('[report-cards/preview-html]', err); return E.serverError(res); }
});

/* ── Draft Comments — pre-publish per-student comment store ───
   GET /draft-comments is registered earlier in this file, alongside
   GET /bulk-pdf, ahead of GET /:id (registration-order fix, see the
   comment there) — the PUT routes below have no such conflict (Express
   matches by method+path together, and neither of these path shapes
   collides with any PUT route). */

// PUT /draft-comments/:studentId — upsert comment record for a student
// subjectComments: { [subjectId]: string } — merged per-key (each teacher only touches their own subject)
router.put('/draft-comments/:studentId', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId: updatedBy } = req.jwtUser;
    const { studentId } = req.params;
    const { classId, termNumber, classTeacherName, classTeacherRemark,
            sportsAndTalent, principalName, principalRemark, closingDate, nextTermBegin,
            subjectComments } = req.body;
    if (!termNumber) return E.badRequest(res, 'termNumber is required');

    // Guard: subject-teacher scoping (RC6) — every subject key this caller
    // is writing must be one they're assigned to teach in this class, only
    // enforced when the school has turned on subjectAssignmentEnforced
    if (subjectComments && typeof subjectComments === 'object' && classId) {
      const pairs = Object.keys(subjectComments).map(subjectId => ({ classId, subjectId }));
      const denied = await unassignedPairs(req, pairs);
      if (denied.length > 0) {
        return E.forbidden(res, `You are not assigned to teach: ${denied.map(p => p.subjectId).join(', ')}`);
      }
    }

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
router.put('/draft-comments/:studentId/subject/:subjectId', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId: updatedBy } = req.jwtUser;
    const { studentId, subjectId } = req.params;
    const { classId, termNumber, comment } = req.body;
    if (!termNumber) return E.badRequest(res, 'termNumber is required');
    if (typeof comment !== 'string') return E.badRequest(res, 'comment must be a string');

    // Guard: subject-teacher scoping (RC6) — only enforced when the school
    // has turned on academic_config.subjectAssignmentEnforced
    if (!(await canWriteSubject(req, classId, subjectId))) {
      return E.forbidden(res, 'You are not assigned to teach this subject in this class.');
    }

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

/* PATCH /draft-comments/:studentId/advance — write the current step's
   report-level remark and advance the school-configured chain (RC8).
   Mirrors hr.js's PATCH /leave/:id/advance exactly: sequential
   enforcement (only the current step's eligible assignee may write),
   404/400 posture, resolveAssigneeLabel for audit richness, notify the
   next step. Schools with no report_comment_approval config never reach
   a state where this route applies — use the legacy PUT
   /draft-comments/:studentId (classTeacherRemark/principalRemark)
   instead, completely unaffected by this route's existence. */
router.patch('/draft-comments/:studentId/advance', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, name, role } = req.jwtUser;
    const { studentId } = req.params;
    const { classId, termNumber, remark } = req.body;
    if (!termNumber) return E.badRequest(res, 'termNumber is required');
    if (typeof remark !== 'string' || !remark.trim()) return E.badRequest(res, 'remark is required');

    const ctx = tenantContext(req);
    const config = await getWorkflowConfig(ctx, schoolId, REPORT_COMMENT_WORKFLOW_KEY);
    if (!config) return E.badRequest(res, 'No report-comment approval chain is configured for this school');

    const Draft = tenantModel('report_card_draft_comments', ctx);
    const existing = await Draft.findOne({ schoolId, studentId, termNumber: Number(termNumber) }).lean();
    const stepOrder = existing?.currentStepOrder ?? 1;

    if (stepOrder > config.steps.length) {
      return E.badRequest(res, 'This report has already completed its remark chain');
    }
    const step = config.steps.find(s => s.order === stepOrder);
    if (!step) return E.serverError(res);

    const eligible = await resolveStep(ctx, schoolId, step);
    if (!eligible.some(u => u.id === userId)) {
      return E.forbidden(res, 'You are not an approver at this step');
    }

    const resolvedRoleLabel = await resolveAssigneeLabel(ctx, schoolId, step.assigneeType, step.assigneeValue);
    const nextStepOrder = stepOrder + 1;
    const priorRemarks = (existing?.reportRemarks || []).filter(r => r.stepOrder !== stepOrder);
    const reportRemarks = [...priorRemarks, {
      stepOrder, label: step.label || resolvedRoleLabel,
      assigneeType: step.assigneeType, assigneeValue: step.assigneeValue,
      remark: remark.trim(), writtenBy: userId, writtenByName: name || resolvedRoleLabel,
      writtenAt: new Date().toISOString(),
    }].sort((a, b) => a.stepOrder - b.stepOrder);

    const doc = await Draft.findOneAndUpdate(
      { schoolId, studentId, termNumber: Number(termNumber) },
      { $set: { schoolId, studentId, classId: classId ?? existing?.classId, termNumber: Number(termNumber), reportRemarks, currentStepOrder: nextStepOrder, updatedBy: userId, updatedAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    await AuditService.log({
      action: 'report_comment.step_written',
      actor: { userId, role, name },
      schoolId,
      target: { type: 'report_card_draft_comments', id: `${studentId}_${termNumber}` },
      details: { stepOrder, resolvedRoleLabel, complete: nextStepOrder > config.steps.length },
      req,
    });

    if (nextStepOrder <= config.steps.length) {
      const nextStep = config.steps.find(s => s.order === nextStepOrder);
      if (nextStep) {
        const nextEligible = await resolveStep(ctx, schoolId, nextStep);
        await dispatchNotification({
          ctx, schoolId, eventKey: 'report_comment_step', actorUserId: userId,
          recipients: nextEligible.map(u => ({ userId: u.id, name: u.name, email: u.email })),
          inAppSubject: 'Report comment ready for your review',
          inAppBody: `A report-level remark is ready for you to review for a student's report card (Term ${termNumber}).`,
        });
      }
    }

    return ok(res, doc);
  } catch (err) {
    console.error('[report-cards/draft-comments/advance PATCH]', err);
    return E.serverError(res);
  }
});

// Exposed for direct unit testing without exercising the full (transaction-
// wrapped, config-loading) /publish route — same lightweight-testability
// convention as qa-health.js's exported check functions.
router._notifyReportCardsPublished = _notifyReportCardsPublished;
router._normalizeGradeScaleBands = _normalizeGradeScaleBands;
router._buildPDFPage = _buildPDFPage;
router._loadRenderExtras = _loadRenderExtras;
router._computeReportSections = _computeReportSections;
router._resolveSnapComments = _resolveSnapComments;
// RCE2 — _computeReportHTML moved to server/utils/report-layouts.js as
// legacy_tabular's renderHtml; re-exported under its original name so
// every existing direct-call test (report-cards.test.js) needs zero changes.
router._computeReportHTML = getLayout('legacy_tabular').renderHtml;
router._loadPublicationPolicy = _loadPublicationPolicy;
router._missingSubjectComments = _missingSubjectComments;
router._isReportCommentChainComplete = _isReportCommentChainComplete;
router.PUBLICATION_POLICY_DEFAULTS = PUBLICATION_POLICY_DEFAULTS;
router._nextReportId = _nextReportId;
router._schoolReportCode = _schoolReportCode;

module.exports = router;
