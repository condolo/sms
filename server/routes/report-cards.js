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
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine        = require('../utils/scopeEngine');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, fail } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');
const { mergeConfig, resolveGrade, resolveCurrentPeriod, OBSERVATION_RATING_VALUES, DEFAULT_GRADING_SCHEMA } = require('./academic-config');
const { getConfig: _getAssessmentConfig } = require('./assessment');
const { KG_INDICATORS_TYPE } = require('./mark-submissions');
const { resolveTemplate } = require('./report-card-templates');
const { getLayout }       = require('../utils/report-layouts');
const { htmlToPdfBuffer, htmlToPdfBufferOrFallback, mergePdfBuffers } = require('../utils/html-to-pdf');
const { sectionIdForClass, resolveGradeScale } = require('../utils/grade-scale');
const { isYearArchived } = require('../utils/archival');
const { resolveRcTemplate } = require('../utils/rc-template-scale');
const { computeKgReport }   = require('../utils/kg-report');
const AuditService       = require('../services/audit');
const { sanitisePdfStr } = require('../utils/sanitisePdf');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const { canWriteSubject, unassignedPairs, isManagement } = require('../utils/subject-scope');
const { studentPlacement, canWriteClassRemark, scopeDraftCommentsForCaller } = require('../utils/comment-scope');
const { canViewFullReport, viewReportFor } = require('../utils/report-view-scope');
const { isElective, enrolledStudentIds, canTeachElective, isInCurriculum } = require('../utils/elective-scope');
const { getWorkflowConfig, saveWorkflowConfig, resolveStep, resolveAssigneeLabel } = require('../utils/workflow-config');
const { dispatchNotification } = require('../utils/notify-dispatch');
const { enqueueJob, registerHandler } = require('../utils/job-queue');
const email = require('../utils/email');
const { appUrl } = require('../utils/app-url');
const {
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
   they're additive capabilities, never a silent new restriction.

   require_moderation_complete is now a NO-OP (2026-10-13 mark-submission
   workflow redesign): /publish no longer gates on a pre-publish approval
   step — it locks marks automatically instead (see the auto-lock step
   below). The key is kept in the schema/API only so existing saved
   academic_config documents and this policy's GET/PATCH routes don't
   break; it's been removed from the Settings UI since toggling it now
   has no effect. */
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

/* Who can click Publish — Permission Granularity Plan 2026-09, Priority 0,
   relocated 2026-10-26. admin/superadmin remain an unconditional floor,
   never weakened. Everyone else needs this ONE specific grant — deliberately
   hasExplicitSubGrant, not the ordinary subKey-with-coarse-fallback rbac()
   behavior, so merely holding grades:create (most teaching/exam roles, for
   entering marks) never silently includes publish rights.

   Checked under TWO keys: reported directly — a principal given "full
   access" under the Report Cards module in Settings still couldn't
   publish, because this row actually lived under the separate Grades &
   Marks module (Settings → Roles & Permissions → Grades → "Generate /
   Publish Report Cards"), invisible to anyone granting access from the
   Report Cards side. Moved to report_cards.report_generate, but several
   real roles across real schools already hold grades.report_generate —
   checking both (OR, not AND) means moving the row's home in Settings
   never silently revokes an existing grant. New grants should use the
   report_cards key; the grades key is legacy-only going forward. */
async function _canPublishReportCards(req, role) {
  if (['admin', 'superadmin'].includes(role)) return true;
  const [viaReportCards, viaLegacyGrades] = await Promise.all([
    hasExplicitSubGrant(req, 'report_cards', 'report_generate', 'create'),
    hasExplicitSubGrant(req, 'grades', 'report_generate', 'create'),
  ]);
  return viaReportCards || viaLegacyGrades;
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

/* ── SHA-256 hash of immutable snapshot content ───────────────
   GET /verify/:reportId (below) always recomputes through THIS same
   function and compares to the stored hash — so a kindergarten branch
   has to live inside it, not as a separate hash function, or every KG
   report would fail verification against a hash nothing ever computed
   that way. The numeric branch's field list/order is byte-for-byte
   identical to before this branch was added — changing it would
   silently invalidate every already-published numeric report's hash. */
function _hashSnapshot(snap) {
  const payload = snap.layoutKey === 'kindergarten'
    ? JSON.stringify({
        studentId:     snap.studentId,
        studentName:   snap.studentName,
        admissionNo:   snap.admissionNo,
        classId:       snap.classId,
        termNumber:    snap.termNumber,
        academicYear:  snap.academicYear,
        kgSubjects:    snap.kgSubjects,
        overallAvgPct: snap.overallAvgPct,
        overallGrade:  snap.overallGrade,
        overallBandOnly:  snap.overallBandOnly,
        overallBandLabel: snap.overallBandLabel,
        publishedAt:   snap.publishedAt,
      })
    : JSON.stringify({
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

/* ── School-timezone-aware timestamp for the report footer's "Generated:"
   line. Reported directly: "is there somewhere in the system to
   configure the time zones... it should be configured in the system" —
   a school-level `timezone` field (IANA zone, e.g. "Africa/Nairobi")
   already exists (schools.timezone, editable in Settings → School
   Profile — SCHOOL_PROFILE_FIELDS in academic-config.js), the gap was
   narrower than "no setting exists at all": nothing on a report card
   ever actually READ it. The footer always printed raw server UTC
   (`new Date().toUTCString()`) regardless. Falls back to UTC — same as
   before this fix — when a school has no timezone set, or has an
   invalid one saved (Intl throws on an unrecognised IANA zone string;
   never let a bad save 500 the whole report). ── */
function _formatInSchoolTz(date, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      timeZoneName: 'short',
    }).format(date);
  } catch (_) {
    return date.toUTCString();
  }
}

/* Date-only variant (DD/MM/YYYY) — same timezone-aware/fail-safe posture
   as _formatInSchoolTz above, for the signature block's "Date:" line
   (reported directly, alongside a reference design: a signature should
   carry its own plain date, not a full generation timestamp). */
function _formatDateInSchoolTz(date, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(date);
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
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
  const assessmentCfg = await _getAssessmentConfig(schoolId, null);
  return { customTypes: assessmentCfg.customTypes };
}

/* Report cycle label — "just a label" per direct instruction (2026-10-18):
   most schools issue more than one report per term (a Mid-Term progress
   report, then a full End-of-Term one), but the report card only ever
   showed "Academic Year X · Term Y" — no way to say WHICH of those this
   is. Deliberately scoped down for now: one editable label per
   {class, term, year}, shown in place of "Term Y" wherever that already
   appears, with no change to publish/supersede semantics — publishing a
   second report for the same class/term/year still replaces the first
   one exactly as it does today. Stored as its own setting (not part of
   the snapshot until generate/publish freezes it onto one) specifically
   so it survives a republish without needing to be retyped — "the system
   is aware this is the Mid-Term report even if it is republished" was
   the direct requirement. A later "two independently-visible reports per
   term" feature is a separate, larger change to that supersede logic,
   not implied by this one. */
async function _loadCycleLabel(schoolId, classId, termNumber, academicYearId) {
  const doc = await tenantModel('report_card_cycle_labels', { schoolId }).findOne({
    schoolId, classId, termNumber: Number(termNumber), academicYearId: academicYearId || null,
  }).lean();
  return doc?.label || '';
}

/* Grade scales are section-scoped: a report is for one class, and a class
   belongs to one section. Refusing with a clear message beats computing with
   an undefined scale. */
/* mergeConfig() substitutes DEFAULT_GRADING_SCHEMA when nothing is saved. That
   built-in default must not count as a school's scale, or a school with no
   scale would be graded silently. Only an explicitly saved schema is legacy. */
function _savedLegacySchema(config) {
  return config.gradingSchema === DEFAULT_GRADING_SCHEMA ? null : config.gradingSchema;
}

function _noScaleMessage(classId) {
  return `No grade scale is set for this class's section (class ${classId}). Add one under Settings → Assessment → Grade Scales, for this section or as the school default.`;
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
 * RC5, extended — closes the draft-to-published comment carry-forward gap
 * (docs/audits/REPORT_CARD_COMMENT_LIFECYCLE_REVIEW.md, "Recommendation 1"),
 * now for a RE-publish too, not just the first one.
 *
 * On a student's first-ever publish for a term, there is no `prev` snapshot
 * to carry `comments` forward from, so it used to start completely blank —
 * regardless of what a teacher had already typed into
 * `report_card_draft_comments`. RC5 fixed that case. But a re-publish kept
 * returning `prev.comments` VERBATIM, ignoring the draft entirely, forever —
 * explicitly left that way as a deferred "approval-workflow question, out
 * of scope" at the time. Reported directly since: "follow the root of
 * comments, it's still not appearing... at least subject teacher is
 * appearing" — once a report had been published even once (including an
 * early test publish), every comment typed into the Comments tab
 * afterward — subject comments, class teacher/principal remarks, Sports &
 * Talent, closing date — was silently invisible on every later view,
 * download, or re-publish of that student's report, no matter how many
 * times "Publish" was clicked again, because none of that ever reaches
 * `report_card_snapshots`.
 *
 * `report_card_draft_comments` is the continuously-edited source of truth
 * regardless of publish status (the Comments tab writes there whether or
 * not a report has ever been published) — there is no separate mechanism
 * that edits an already-published snapshot's comments directly. So a
 * re-publish now prefers the CURRENT draft for every field; `prev.comments`
 * is only a fallback for a field the draft doc genuinely doesn't have
 * (e.g. the draft row was deleted outright after a report was published),
 * not a permanent freeze of whatever existed at the very first publish.
 * This does not retroactively change any already-published snapshot —
 * snapshots stay immutable; it only changes what the NEXT publish writes.
 *
 * Carries every comment-shaped field the draft doc has, not just the three
 * `CommentSchema`/`PUT /:id/comments` already covers, since Sports &
 * Talent / Closing Date / Next Term / the two signer names are genuine
 * report content a school already collects pre-publish. Exported (like
 * `_hashSnapshot`/`_normalizeGradeScaleBands`) for direct unit testing
 * without exercising the transaction-wrapped full /publish route.
 */
function _resolveSnapComments(prev, draft) {
  const base = prev?.comments || {};
  return {
    subjectComments:    draft?.subjectComments    ?? base.subjectComments    ?? {},
    classTeacherRemark: draft?.classTeacherRemark  ?? base.classTeacherRemark ?? '',
    principalRemark:    draft?.principalRemark     ?? base.principalRemark    ?? '',
    sportsAndTalent:    draft?.sportsAndTalent     ?? base.sportsAndTalent    ?? '',
    closingDate:        draft?.closingDate         ?? base.closingDate       ?? '',
    nextTermBegin:      draft?.nextTermBegin       ?? base.nextTermBegin     ?? '',
    classTeacherName:   draft?.classTeacherName    ?? base.classTeacherName  ?? '',
    principalName:      draft?.principalName       ?? base.principalName    ?? '',
    // RC8 — populated only for schools using the report_comment_approval
    // chain (PATCH /draft-comments/:studentId/advance); empty for every
    // other school, same as subjectComments defaulting to {}.
    reportRemarks:      draft?.reportRemarks       ?? base.reportRemarks    ?? [],
    // Class-teacher observation ratings — { [category]: 'excellent'|'good'|'improve' }.
    // Empty for every school not using showObservationRatings, same posture
    // as every other field here.
    observationRatings: draft?.observationRatings  ?? base.observationRatings ?? {},
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
  // Reported directly: "my 85-word comment won't fit, only 73 words
  // accepted" — 500 characters was roughly 70-85 words depending on word
  // length, noticeably tighter than the 1000-character room given to the
  // class teacher's and principal's remarks for no principled reason.
  // Matched to the same 1000 every other report-card comment field uses.
  subjectComments:    z.record(z.string().max(1000)).optional(),
  classTeacherRemark: z.string().max(1000).optional(),
  principalRemark:    z.string().max(1000).optional(),
});

// Platform audit (2026-10-18): this schema existed above but was only ever
// wired to the legacy PUT /:id/comments route — the route the UI actually
// calls, PUT /draft-comments/:studentId below, had NO length validation on
// any of these fields at all, so a client-side cap (if one even existed)
// was the only thing stopping an unbounded write. Caps match the client's
// own StudentReportCard.jsx/KgStudentReportCard.jsx Field usage: 1000 for
// the same remark fields as CommentSchema above, 200 for a name, 100 for
// the free-text closing/next-term date strings (Field renders them as
// plain text inputs, not date pickers).
const DraftCommentBodySchema = z.object({
  termNumber:         z.union([z.string(), z.number()]),
  classTeacherName:   z.string().max(200).optional(),
  classTeacherRemark: z.string().max(1000).optional(),
  sportsAndTalent:    z.string().max(1000).optional(),
  principalName:      z.string().max(200).optional(),
  principalRemark:    z.string().max(1000).optional(),
  closingDate:        z.string().max(100).optional(),
  nextTermBegin:      z.string().max(100).optional(),
  // Left unvalidated here on purpose — the route's own manual check further
  // down (against this school's configured categories/rating values) is
  // the real validation and already returns its own 400s; this schema
  // only exists to cap the free-text fields above.
  observationRatings: z.any().optional(),
}).passthrough();

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
// Same precedent as mark-submissions.js's own _lockYearFilterPart (see
// its comment there) — not imported (that file doesn't export it),
// duplicated locally. The auto-lock step below (Step 9b / /kg/publish)
// is a narrowing, mutating action, not a list: when scope.academicYearId
// is falsy (a school with no resolvable academic year), it must only
// touch OTHER legacy-tagged marks/submissions, never silently fall
// through to "every year sharing this natural key" the way a lenient
// {} filter would — exactly the cross-year leak mark-submissions.js's
// own /:id/lock route documents and guards against for the identical
// operation. (This file's own helpers elsewhere, e.g. _resolveTermScope
// above, don't need this distinction — they're read paths, not locks.)
function _lockYearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : { $or: [{ academicYearId: null }, { academicYearId: { $exists: false } }] };
}

/* Shared by /publish's and /kg/publish's Step 9b auto-lock. mark_submissions'
   only unique index is {schoolId, classId, subjectId, termNumber,
   assessmentType, instance} (indexes.js's 'mksub_composite') — streamId is
   NOT part of a submission's identity, so a compulsory subject taught
   across 2+ streams still has exactly ONE submission doc for the whole
   class. The previous version of this step conditionally added streamId
   to its own lookup filter; that filter then can't find a pre-existing
   stream-naive doc, falls through to create(), and throws a duplicate-key
   error against this same index — which the caller's single outer
   try/catch logs once and then silently abandons every combo still left
   in the loop. Confirmed live against sch_demo: 4 of 11 real combos in an
   already-published, already-locked class never got their submission
   doc flipped to 'locked' because an earlier combo in the same run hit
   exactly this collision. Per-combo try/catch here means one failure
   (this one, or any other) can no longer take out every combo after it. */
async function _lockSubmissionCombos(Submissions, { schoolId, classId, termNumber, academicYearId, combos, userId, now, yearFilter, routeTag }) {
  for (const combo of combos) {
    try {
      const subKey = {
        schoolId, classId, subjectId: combo.subjectId, termNumber,
        assessmentType: combo.assessmentType, instance: combo.instance,
        ...yearFilter,
      };
      const existingSub = await Submissions.findOne(subKey).lean();
      if (existingSub) {
        if (existingSub.status !== 'locked') {
          await Submissions.updateOne({ id: existingSub.id }, {
            $set: {
              status: 'locked', lockedBy: userId, lockedAt: now, updatedAt: now,
              ...(combo.streamId ? { streamId: combo.streamId } : {}),
            },
          });
        }
      } else {
        await Submissions.create({
          id: uuidv4(), schoolId, classId, subjectId: combo.subjectId, termNumber,
          academicYearId, assessmentType: combo.assessmentType, instance: combo.instance,
          streamId: combo.streamId || null,
          status: 'locked', lockedBy: userId, lockedAt: now,
          createdAt: now, updatedAt: now,
        });
      }
    } catch (lockErr) {
      console.error(`[${routeTag}] auto-lock failed for one combo (publish itself succeeded):`, combo, lockErr);
    }
  }
}

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

/* Reported directly, with a side-by-side PDF comparison: a published
   report card showed "Class —" and a blank "Academic Year ·" prefix.
   Root cause: className/termName/academicYear in PublishSchema are
   optional DISPLAY STRINGS the server trusted the client to send — but
   ReportCardsTab.jsx's publish call only ever sends {classId,
   termNumber, academicYearId}, never these three. Every snapshot this
   school has ever published is missing them, frozen blank forever (the
   whole point of a snapshot). Resolved server-side here instead, from
   the same IDs _resolveTermScope already resolved — authoritative, not
   dependent on the client remembering to pass matching display text —
   same posture as streamName/houseName just below, which were never
   client-trusted to begin with. */
async function _resolveDisplayNames(schoolId, ctx, { classId, academicYearId, termId }) {
  // Dual-ID safe — reported directly, live: a class that predates the
  // UUID-`id` migration (e.g. MLA's "Year 10") has no `id` field, only
  // its Mongo `_id`. `classId` arrives here as whichever form the rest
  // of the app already resolved to (the canonical `doc.id || String(doc._id)`
  // convention), so a lookup that only ever matches `id` silently found
  // nothing for that class and published a report with a BLANK Class
  // field — confirmed directly against a real MLA report card (Stream
  // "10A" correct, Class empty). Same `$or`/ObjectId-validity guard
  // students.js's own `_entityIdForms` uses, so an `id` that happens not
  // to be a valid ObjectId (the normal, post-migration case) never
  // throws a cast error by being probed against `_id` anyway.
  const classIdOr = [{ id: classId }];
  if (classId && mongoose.Types.ObjectId.isValid(classId) && String(classId).length === 24) {
    classIdOr.push({ _id: classId });
  }
  const [cls, year] = await Promise.all([
    tenantModel('classes', ctx).findOne({ schoolId, $or: classIdOr }).select('name').lean().catch(() => null),
    academicYearId
      ? tenantModel('academic_years', ctx).findOne({ schoolId, id: academicYearId }).select('name terms').lean().catch(() => null)
      : Promise.resolve(null),
  ]);
  const term = year?.terms?.find(t => t.id === termId) ?? null;
  return {
    className:    cls?.name  || '',
    academicYear: year?.name || '',
    termName:     term?.name || '',
  };
}

/* ══════════════════════════════════════════════════════════════
   GET/PUT /cycle-label — "Mid-Term"/"End of Term"/etc. label per
   {class, term, year}, shown in place of "Term Y" on the report card.
   See _loadCycleLabel's own comment for the full reasoning.
   ══════════════════════════════════════════════════════════════ */
const CycleLabelSchema = z.object({
  classId:        z.string().min(1),
  termNumber:     z.union([z.string(), z.number()]),
  academicYearId: z.string().optional(),
  label:          z.string().max(60).trim().optional().default(''),
});

router.get('/cycle-label', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, termNumber, academicYearId } = req.query;
    if (!classId || !termNumber) return E.badRequest(res, 'classId and termNumber are required');
    const label = await _loadCycleLabel(schoolId, String(classId), termNumber, academicYearId ? String(academicYearId) : null);
    return ok(res, { label });
  } catch (err) {
    console.error('[report-cards/cycle-label GET]', err);
    return E.serverError(res);
  }
});

router.put('/cycle-label', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CycleLabelSchema, req.body);
    if (error) return E.validation(res, error);
    const doc = await tenantModel('report_card_cycle_labels', tenantContext(req)).findOneAndUpdate(
      { schoolId, classId: data.classId, termNumber: Number(data.termNumber), academicYearId: data.academicYearId || null },
      { $set: { label: data.label, updatedBy: userId, updatedAt: new Date() }, $setOnInsert: { id: uuidv4(), schoolId, createdAt: new Date() } },
      { upsert: true, new: true }
    ).lean();
    return ok(res, { label: doc.label });
  } catch (err) {
    console.error('[report-cards/cycle-label PUT]', err);
    return E.serverError(res);
  }
});

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

    const [config, caConfig, cycleLabel] = await Promise.all([
      _loadConfig(schoolId),
      _loadCaConfig(schoolId),
      _loadCycleLabel(schoolId, classId, termNum, scope.academicYearId),
    ]);

    // aggregateUnmoderatedMarks/"provisional" REMOVED 2026-10-13 — workflow
    // redesign: there is no more pre-publish approval step, so under the
    // new design every not-yet-published class would always show
    // "provisional" (nothing is ever "approved" before publish locks it
    // directly), which is no longer a meaningful signal.
    const caMarksData = await aggregateAssessmentMarks(schoolId, classId, termNum ?? null, scope.academicYearId, studentId);

    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes);
    const reportSectionId = await sectionIdForClass(schoolId, classId);
    const scale = await resolveGradeScale(schoolId, reportSectionId, _savedLegacySchema(config));
    if (!scale) return E.badRequest(res, _noScaleMessage(classId));
    const activeSchema = scale.bands;

    const allReports = computeFinalScores(caMarksData, {}, activeWeights, activeSchema);

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

    // Resolve class teacher name(s): student → stream (formTeacherId /
    // assistantFormTeacherId) → teacher name. Assistant/co-homeroom
    // teacher (2026-10-29) is a second, independently-named role, not
    // merged into one string — shown as its own line wherever the
    // report renders a class teacher at all.
    const studentIds  = studentsWithRanks.map(s => s.studentId);
    const Students    = tenantModel('students', tenantContext(req));
    const Streams     = tenantModel('streams', tenantContext(req));
    const Teachers    = tenantModel('teachers', tenantContext(req));

    const studentDocs = await Students
      .find({ schoolId, id: { $in: studentIds } })
      .select('id streamId').lean();

    const streamIds = [...new Set(studentDocs.map(d => d.streamId).filter(Boolean))];
    const streamDocs = streamIds.length
      ? await Streams.find({ schoolId, id: { $in: streamIds } }).select('id formTeacherId assistantFormTeacherId').lean()
      : [];

    const teacherIds = [...new Set(streamDocs.flatMap(d => [d.formTeacherId, d.assistantFormTeacherId]).filter(Boolean))];
    const teacherDocs = teacherIds.length
      ? await Teachers.find({ schoolId, id: { $in: teacherIds } }).select('id title firstName lastName').lean()
      : [];

    const streamMap  = Object.fromEntries(streamDocs.map(d => [d.id, d.formTeacherId]));
    const assistantStreamMap = Object.fromEntries(streamDocs.map(d => [d.id, d.assistantFormTeacherId]));
    const teacherMap = Object.fromEntries(teacherDocs.map(t => [
      t.id,
      [t.title, t.firstName, t.lastName].filter(Boolean).join(' '),
    ]));
    const studentStreamMap = Object.fromEntries(studentDocs.map(d => [d.id, d.streamId]));

    const students = studentsWithRanks.map(r => {
      const streamId       = studentStreamMap[r.studentId];
      const formTeacherId  = streamId ? streamMap[streamId] : null;
      const assistantTeacherId = streamId ? assistantStreamMap[streamId] : null;
      const classTeacherName = formTeacherId ? (teacherMap[formTeacherId] ?? null) : null;
      const assistantClassTeacherName = assistantTeacherId ? (teacherMap[assistantTeacherId] ?? null) : null;
      return {
        ...r,
        classTeacherId: formTeacherId ?? null, classTeacherName: classTeacherName ?? null,
        assistantClassTeacherId: assistantTeacherId ?? null, assistantClassTeacherName: assistantClassTeacherName ?? null,
      };
    });

    // A teacher sees their own subjects of each report; a form tutor sees their stream in full.
    const viewable = (await Promise.all(students.map(s => viewReportFor(req, { ...s, classId, streamId: studentStreamMap[s.studentId] ?? null, comments: s.comments ?? {} })))).filter(Boolean);
    return ok(res, {
      generated: viewable.length,
      config: {
        gradingType: config.gradingType, passMark: config.passMark,
        rankingEnabled: config.rankingEnabled, rankingSubjectStrategy: config.rankingSubjectStrategy,
        assessmentWeights: _convertCustomTypesToWeights(caConfig.customTypes),
        customTypes: caConfig.customTypes ?? null,
        reportLabel: cycleLabel || null,
        // Always the exact bands used to grade this response's subjects —
        // never null, normalised to one shape regardless of whether they
        // came from grade_boundaries or the academic_config fallback (Audit
        // §6.2 — the client must never fall back to its own local default,
        // it has to render from what the server actually used).
        gradeScale: { bands: _normalizeGradeScaleBands(activeSchema) },
        showObservationRatings: config.showObservationRatings,
        observationCategories:  config.observationCategories,
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
  // See _canPublishReportCards' own comment for the full history/reasoning.
  if (!(await _canPublishReportCards(req, role))) {
    return E.forbidden(res, 'You do not have permission to publish report cards.');
  }

  const { data, error } = _validate(PublishSchema, req.body);
  if (error) return E.validation(res, error);

  // skipModerationCheck requires an explicit reason (mandatory)
  if (data.skipModerationCheck && !data.skipReason?.trim()) {
    return E.badRequest(res, 'skipReason is required when skipModerationCheck is true — document why the moderation check is being bypassed');
  }

  const {
    classId, termId, termNumber: termNum, academicYearId,
    className: clientClassName, termName: clientTermName, academicYear: clientAcademicYear,
    schoolName, skipModerationCheck, skipReason,
  } = data;
  const now     = new Date().toISOString();
  const batchId = uuidv4();
  const ctx     = tenantContext(req);

  // Same live-resolution as /generate — the client only ever sends
  // {classId, termNumber}, never termId/academicYearId, so without this
  // every aggregation below would silently pull data across ALL years for
  // the class (classes are not year-scoped — see _resolveTermScope above).
  const scope = await _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber: termNum });

  // See _resolveDisplayNames' own comment — the client doesn't send these,
  // so this is the real source, with the client's own value (currently
  // always absent) kept only as a last-resort fallback.
  const resolvedNames = await _resolveDisplayNames(schoolId, ctx, { classId, academicYearId: scope.academicYearId, termId: scope.termId });
  const className    = resolvedNames.className    || clientClassName    || '';
  const termName     = resolvedNames.termName     || clientTermName     || '';
  const academicYear = resolvedNames.academicYear || clientAcademicYear || '';

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

    const [config, caConfig, policy, cycleLabel] = await Promise.all([
      _loadConfig(schoolId),
      _loadCaConfig(schoolId),
      _loadPublicationPolicy(schoolId),
      _loadCycleLabel(schoolId, classId, termNum, scope.academicYearId),
    ]);

    const activeWeights = _convertCustomTypesToWeights(caConfig.customTypes);
    const classSectionId = await sectionIdForClass(schoolId, classId);
    const scale = await resolveGradeScale(schoolId, classSectionId, _savedLegacySchema(config));
    if (!scale) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No grade scale for this section', completedAt: now });
      return E.badRequest(res, _noScaleMessage(classId));
    }
    const activeSchema = scale.bands;

    // Step 2 (moderation guard) REMOVED 2026-10-13 — workflow redesign:
    // there is no more pre-publish approval step to be "complete" against.
    // Publish itself now locks marks automatically (Step 7b below)
    // instead of requiring each subject to already be individually
    // submitted+approved+manually-locked beforehand. skipModerationCheck/
    // skipReason are still accepted on the request for backward API
    // compatibility but have nothing left to bypass.

    // ── Step 3: Aggregate grades + CA marks, then compute scores ──
    // Markbook is the only mark source. scope.academicYearId — see
    // _resolveTermScope's comment above.
    const caMarksData = await aggregateAssessmentMarks(schoolId, classId, termNum ?? null, scope.academicYearId);
    const allReports = computeFinalScores(caMarksData, {}, activeWeights, activeSchema);
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

    // ── Step 6a: Batch-load draft comments for EVERY student on EVERY
    // publish (first-ever or re-publish alike) ──
    // Previously only students with no `prev` snapshot had their draft
    // loaded at all — "a re-publish keeps carrying prev.comments forward,
    // unchanged" was the stated reasoning. That directly undid
    // _resolveSnapComments' own documented contract ("not a permanent
    // freeze... this does not retroactively change any already-published
    // snapshot; it only changes what the NEXT publish writes") for the
    // common case: any school without an RC9 completeness policy turned
    // on. _resolveSnapComments itself always preferred a fresh draft over
    // the frozen prev — the merge logic was correct — but `draft` was
    // simply never loaded for a re-publish, so it had nothing fresh to
    // prefer, and a comment typed into the Markbook after first publish
    // was silently dropped on every re-publish. This is the second time
    // this exact symptom ("re-publish ignores new comments") has been
    // reported — the first fix only reached the merge function, not this
    // upstream load gate. One extra indexed query per publish is cheap;
    // always load it.
    const draftCommentsMap = {};
    if (studentIds.length && termNum != null) {
      const draftDocs = await tenantModel('report_card_draft_comments', tenantContext(req))
        .find({ schoolId, studentId: { $in: studentIds }, termNumber: termNum }).lean();
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
    const distinctSectionIds = [classSectionId];
    const templateBySection = {};
    for (const secId of distinctSectionIds) {
      const resolved = await resolveTemplate(tenantContext(req), schoolId, secId);
      // Defense in depth, same posture as /kg/generate and /kg/publish
      // independently re-verifying their own template rather than
      // trusting a caller: 'kindergarten' is reserved for the dedicated
      // KG pipeline (rc_templates/resolveRcTemplate) and should be
      // unreachable here since report-card-templates.js's TemplateSchema
      // now rejects it at creation time — but a pre-existing template
      // from before that fix, or any future gap in that enforcement,
      // must still never silently snapshot a numeric class (whose
      // `subjects` has no kgSubjects shape) under the kindergarten
      // renderer. Found by a full-codebase audit (2026-10-13).
      if (resolved.layoutKey === 'kindergarten') {
        await Batches.updateOne({ id: batchId }, {
          status: 'failed',
          failureReason: 'This class\'s report template is set to the Kindergarten layout — use the Kindergarten Generate & Publish flow instead.',
          completedAt: now,
        });
        return E.badRequest(res, 'This class\'s report template is set to the Kindergarten layout, which the ordinary numeric pipeline cannot render. Use the Kindergarten Generate & Publish flow for this class instead.');
      }
      templateBySection[secId ?? '__none__'] = resolved;
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
    let schoolPrincipalName   = null;
    let houseNameById         = {};
    try {
      const schoolDoc = await _model('schools').findOne({ id: schoolId }).select('principalSignatureUrl schoolStampUrl principalName houses').lean();
      principalSignatureUrl = schoolDoc?.principalSignatureUrl || null;
      schoolStampUrl        = schoolDoc?.schoolStampUrl        || null;
      schoolPrincipalName   = schoolDoc?.principalName         || null;
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
        const template = templateBySection[classSectionId ?? '__none__'];

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
          // "Just a label" (2026-10-18) — frozen onto the snapshot the same
          // way streamName/templateId already are (outside _hashSnapshot's
          // allowlist, so this doesn't touch integrity verification), so a
          // republish picks up whatever the setting says NOW rather than
          // whatever it said when the previous version was published.
          reportLabel:    cycleLabel || null,

          // Immutable config snapshot — use active (CA-system-aware) weights and schema
          gradingSchema:          activeSchema,
          gradeScaleId:           scale.id,
          gradeScaleSource:       scale.source,
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
          // Comments lock the same way marks do (2026-10-18, direct
          // request): PUT /:id/comments below now refuses any edit while
          // this is true, same wording/shape as the marks "locked —
          // ask an admin to unlock it" guard. POST /:id/comments/unlock
          // is the matching escape hatch, same admin-only + mandatory-
          // reason + 24h auto-relock contract as mark-submissions.js's
          // own unlock.
          commentsLocked:   true,
          commentsLockedAt: now,

          // Snapshot school signature/stamp URLs at publish time (stays valid even if URLs change later)
          principalSignatureUrl,
          schoolStampUrl,
          // Same freezing logic, same reason — a report shouldn't
          // retroactively show a different principal's name if the
          // school updates this setting after the report was published.
          // _computeReportSections' own fallback chain still lets a
          // per-report manually-typed name (Comments tab) override this.
          schoolPrincipalName,

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

    // ── Step 9b: Lock the Markbook automatically (2026-10-13 workflow
    //    redesign) — publishing now locks every mark it was built from,
    //    instead of requiring each subject to already be individually
    //    submitted+approved+manually-locked beforehand. The per-
    //    {classId,subjectId,termNumber,assessmentType,instance}
    //    mark_submissions docs created here directly in 'locked' state
    //    (skipping draft/submitted/approved entirely) are what the
    //    EXISTING unlock-request/approve/24h-auto-relock flow
    //    (mark-submissions.js, unchanged) still operates on for a rare
    //    post-publish correction. Non-fatal: the publish itself already
    //    succeeded above; a per-combo lock failure is logged by
    //    _lockSubmissionCombos, never surfaced as a publish failure.
    try {
      const yearFilter = _lockYearFilterPart(scope.academicYearId);
      const Marks = tenantModel('assessment_marks', ctx);
      const lockFilter = { schoolId, classId, termNumber: termNum, ...yearFilter };
      const combos = await Marks.find(lockFilter).select('subjectId assessmentType instance streamId').lean();
      // Deduped WITHOUT streamId — matches mark_submissions' real unique
      // index (see _lockSubmissionCombos). Whichever stream's row happens
      // to survive the dedup is only used as display metadata below.
      const distinctCombos = [...new Map(
        combos.map(c => [`${c.subjectId}::${c.assessmentType}::${c.instance}`, c])
      ).values()];

      await Marks.updateMany(lockFilter, { $set: { isLocked: true, lockedAt: now } });

      const Submissions = tenantModel('mark_submissions', ctx);
      await _lockSubmissionCombos(Submissions, {
        schoolId, classId, termNumber: termNum, academicYearId: scope.academicYearId,
        combos: distinctCombos, userId, now, yearFilter, routeTag: 'report-cards/publish',
      });
    } catch (lockErr) {
      console.error('[report-cards/publish] auto-lock failed (publish itself succeeded):', lockErr);
    }

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

/* ══════════════════════════════════════════════════════════════
   KINDERGARTEN / COMPETENCY-BAND REPORTS — deliberately SEPARATE from
   /generate and /publish above, not a branch inside them (2026-10,
   confirmed with the user before building). Those two routes are built
   entirely around numeric concepts — class ranking, weighted-score-by-
   assessment-type, deviation-from-class-average — that don't have an
   agreed meaning for indicator-based marks. Forcing a branch in would
   mean silently deciding unresolved design questions (does "rank" mean
   anything across indicator scores?) rather than building only what's
   been actually decided. Ranking and deviation are explicitly NOT
   applicable here, not silently wrong.

   What IS reused, because it's genuinely unrelated to the assessment
   model: publish_batches (interrupt-safe anchor), archived-year guard,
   snapshot versioning/supersede/hash (branched inside _hashSnapshot
   above), report_card_draft_comments (class teacher/principal remarks
   — the same collection, same shape, any class), the financial block
   check, and _notifyReportCardsPublished (reads generic snap fields).

   There never was a moderation gate here to begin with (indicator
   marks were never tied to mark_submissions review-state until the
   2026-10-13 workflow redesign wired them to it directly for locking —
   see indicator-marks.js's header), and the numeric /publish's own
   moderation gate was removed the same day — neither pipeline has a
   pre-publish approval step to enforce. skipModerationCheck is
   accepted in the request body for payload-shape compatibility with
   the numeric PublishSchema but has no effect here.
   ══════════════════════════════════════════════════════════════ */

/** Shared roster + cover-field resolution for one KG class — the parts
 * of /generate's and /publish's student-loading logic that are NOT
 * numeric-specific (ranking, deviations) are genuinely reusable, so
 * this mirrors them rather than inventing a second resolution path. */
async function _loadKgRoster(req, schoolId, classId) {
  const ctx = tenantContext(req);
  const Students = tenantModel('students', ctx);
  const students = await Students.find({ schoolId, classId, status: 'active' })
    .select('id firstName lastName admissionNumber photo streamId houseId').lean();
  if (students.length === 0) return { students: [], streamNameById: {}, houseNameById: {}, classTeacherByStream: {} };

  const streamIds = [...new Set(students.map(s => s.streamId).filter(Boolean))];
  const Streams = tenantModel('streams', ctx);
  const streamDocs = streamIds.length
    ? await Streams.find({ schoolId, id: { $in: streamIds } }).select('id name formTeacherId').lean()
    : [];
  const streamNameById = Object.fromEntries(streamDocs.map(d => [d.id, d.name]));
  const teacherIds = [...new Set(streamDocs.map(d => d.formTeacherId).filter(Boolean))];
  const Teachers = tenantModel('teachers', ctx);
  const teacherDocs = teacherIds.length
    ? await Teachers.find({ schoolId, id: { $in: teacherIds } }).select('id title firstName lastName').lean()
    : [];
  const teacherNameById = Object.fromEntries(teacherDocs.map(t => [t.id, [t.title, t.firstName, t.lastName].filter(Boolean).join(' ')]));
  const classTeacherByStream = Object.fromEntries(streamDocs.map(d => [d.id, d.formTeacherId ? (teacherNameById[d.formTeacherId] ?? null) : null]));

  const school = await _model('schools').findOne({ id: schoolId }).select('houses').lean();
  const houseNameById = Object.fromEntries(
    (Array.isArray(school?.houses) ? school.houses : []).map(h => [h.id ?? h.name, h.name]).filter(([id]) => id)
  );

  return { students, streamNameById, houseNameById, classTeacherByStream };
}

/* ── POST /report-cards/kg/generate — live preview, not persisted ── */
router.post('/kg/generate', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { data, error } = _validate(GenerateSchema, req.body);
    if (error) return E.validation(res, error);
    const { classId, termId, termNumber: termNum, academicYearId, studentId } = data;
    const ctx = tenantContext(req);
    const scope = await _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber: termNum });

    const template = await resolveRcTemplate(schoolId, classId);
    if (!template) {
      return E.badRequest(res, 'This class has no Kindergarten template assigned — use the ordinary Generate & Publish instead.');
    }
    if (!termNum) return E.badRequest(res, 'termNumber is required.');

    const reportSectionId = await sectionIdForClass(schoolId, classId);
    const scale = await resolveGradeScale(schoolId, reportSectionId, null);
    if (!scale) return E.badRequest(res, _noScaleMessage(classId));

    const { students, streamNameById, houseNameById, classTeacherByStream } = await _loadKgRoster(req, schoolId, classId);
    const targets = studentId ? students.filter(s => s.id === studentId) : students;

    const reports = await Promise.all(targets.map(async stu => {
      const kg = await computeKgReport(ctx, schoolId, classId, stu.id, termNum, scope.academicYearId, scale);
      return {
        studentId:        stu.id,
        studentName:       `${stu.firstName} ${stu.lastName}`.trim(),
        admissionNo:       stu.admissionNumber || '',
        streamName:        stu.streamId ? (streamNameById[stu.streamId] || '') : '',
        houseName:         stu.houseId  ? (houseNameById[stu.houseId]   || '') : '',
        classTeacherName:  stu.streamId ? (classTeacherByStream[stu.streamId] || '') : '',
        templateName:      kg?.templateName ?? template.name,
        subjects:          kg?.subjects ?? [],
        overallAvgPct:     kg?.overallAvgPct ?? null,
        overallGrade:      kg?.overallGrade ?? null,
        overallBandOnly:   kg?.overallBandOnly ?? false,
        overallBandLabel:  kg?.overallBandLabel ?? null,
        display:           kg?.display ?? template.display ?? {},
      };
    }));

    return ok(res, { generated: reports.length, templateId: template.id, templateName: template.name, students: reports });
  } catch (err) {
    console.error('[report-cards/kg/generate]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /kg/preview-html, POST /kg/preview-pdf — the Kindergarten
   counterparts to the numeric path's own preview-html/preview-pdf.
   Reported directly, with a screenshot: the KG report preview had no
   Print or Download button at all — KgStudentReportCard.jsx never had
   one, unlike StudentReportCard.jsx's equivalent.

   Unlike the numeric preview routes, this one DOES re-run the
   aggregation (computeKgReport) instead of trusting client-sent data —
   safe here specifically because a KG report has no ranking/GPA
   concept to lose by re-deriving it (see kg-report.js's own header:
   "no rank/GPA concept for a competency-band report"), so there is no
   single-student-can't-reproduce-the-real-rank problem the numeric
   route's own header explains. Re-deriving also means this always
   reflects the current Markbook, the same guarantee /kg/generate
   already gives the on-screen preview.

   Shares its snap-construction with /kg/publish's own shape (same
   field set, status:'draft' instead of 'published') rather than a
   third, drifting copy — draft comments are read live from
   report_card_draft_comments, same source /kg/publish itself reads at
   publish time, so Print/Download show the actually-saved remarks.
   ══════════════════════════════════════════════════════════════ */
const KgPreviewSchema = GenerateSchema.extend({ studentId: z.string().min(1) });

async function _resolveKgPreview(req, data) {
  const { schoolId } = req.jwtUser;
  const { classId, termId, termNumber: termNum, academicYearId, studentId } = data;
  const ctx = tenantContext(req);
  const scope = await _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber: termNum });

  const template = await resolveRcTemplate(schoolId, classId);
  if (!template) return { errorStatus: 400, errorMessage: 'This class has no Kindergarten template assigned — use the ordinary Generate & Publish instead.' };
  if (!termNum) return { errorStatus: 400, errorMessage: 'termNumber is required.' };

  const reportSectionId = await sectionIdForClass(schoolId, classId);
  const scale = await resolveGradeScale(schoolId, reportSectionId, null);
  if (!scale) return { errorStatus: 400, errorMessage: _noScaleMessage(classId) };

  const { students, streamNameById, houseNameById, classTeacherByStream } = await _loadKgRoster(req, schoolId, classId);
  const stu = students.find(s => s.id === studentId);
  if (!stu) return { errorStatus: 404, errorMessage: 'Student not found in this class, or not currently active.' };

  const kg = await computeKgReport(ctx, schoolId, classId, stu.id, termNum, scope.academicYearId, scale);

  const draft = await tenantModel('report_card_draft_comments', ctx)
    .findOne({ schoolId, studentId: stu.id, termNumber: termNum }).lean();

  const { className, academicYear } = await _resolveDisplayNames(schoolId, ctx, { classId, academicYearId: scope.academicYearId, termId: scope.termId });

  const school = await _model('schools').findOne({ id: schoolId })
    .select('name logoUrl tagline address phone email website country principalSignatureUrl schoolStampUrl principalName timezone showStudentPhoto reportCardWatermarkEnabled reportCardWatermarkOpacity')
    .lean();

  const config = await _loadConfig(schoolId);

  const snap = {
    status: 'draft', superseded: false, version: 1,
    studentId: stu.id,
    studentName: `${stu.firstName} ${stu.lastName}`.trim() || stu.id,
    admissionNo: stu.admissionNumber || '',
    studentPhotoUrl: stu.photo || null,
    streamName: stu.streamId ? (streamNameById[stu.streamId] || '') : '',
    houseName:  stu.houseId  ? (houseNameById[stu.houseId]   || '') : '',
    classId, className: className || '',
    termNumber: termNum, academicYear: academicYear || '',
    schoolName: school?.name || '',
    gradingSchema: scale.bands,
    templateId: template.id, templateName: template.name,
    kgSubjects: kg?.subjects ?? [],
    overallAvgPct:    kg?.overallAvgPct ?? null,
    overallGrade:     kg?.overallGrade ?? null,
    overallBandOnly:  kg?.overallBandOnly ?? false,
    overallBandLabel: kg?.overallBandLabel ?? null,
    kgDisplay: template.display ?? {},
    comments: _resolveSnapComments(null, {
      ...draft,
      classTeacherName: draft?.classTeacherName || (stu.streamId ? classTeacherByStream[stu.streamId] : '') || '',
    }),
    principalSignatureUrl: school?.principalSignatureUrl || null,
    schoolStampUrl:        school?.schoolStampUrl        || null,
    schoolPrincipalName:   school?.principalName          || null,
  };

  return { snap, school, config, sections: _computeKgReportSections(snap, config, { school }) };
}

router.post('/kg/preview-html', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { data, error } = _validate(KgPreviewSchema, req.body);
    if (error) return E.validation(res, error);
    const resolved = await _resolveKgPreview(req, data);
    if (resolved.errorStatus) {
      return resolved.errorStatus === 404 ? E.notFound(res, resolved.errorMessage) : E.badRequest(res, resolved.errorMessage);
    }
    const html = getLayout('kindergarten').renderHtml(resolved.sections);
    return ok(res, { html });
  } catch (err) {
    console.error('[report-cards/kg/preview-html]', err);
    return E.serverError(res);
  }
});

router.post('/kg/preview-pdf', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { data, error } = _validate(KgPreviewSchema, req.body);
    if (error) return E.validation(res, error);
    const resolved = await _resolveKgPreview(req, data);
    if (resolved.errorStatus) {
      return resolved.errorStatus === 404 ? E.notFound(res, resolved.errorMessage) : E.badRequest(res, resolved.errorMessage);
    }
    const { sections, snap, school, config } = resolved;
    snap.layoutKey = 'kindergarten'; // read by _pdfKitFallback's _buildPDFPage if Puppeteer can't run

    // RCE9 — same single HTML+Puppeteer pipeline the ordinary preview-pdf
    // route now uses (see html-to-pdf.js); falls back to PDFKit if
    // Puppeteer itself can't launch on this host.
    const html = getLayout('kindergarten').renderHtml(sections);
    const pdf  = await htmlToPdfBufferOrFallback(html,
      () => _pdfKitFallback(snap, config, null, { school }, school?.logoUrl, snap.studentPhotoUrl));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="kg-report-${snap.studentId}-draft.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error('[report-cards/kg/preview-pdf]', err);
    return E.serverError(res);
  }
});

/* ── POST /report-cards/kg/publish — versioned batch snapshot ─────── */
router.post('/kg/publish', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  const { schoolId, userId, role } = req.jwtUser;
  // Same gate as the numeric /publish — reuses the SAME grant key
  // (report_generate) rather than inventing a second one for a second
  // kind of report card — publishing is publishing. See
  // _canPublishReportCards' own comment for the full history/reasoning.
  if (!(await _canPublishReportCards(req, role))) {
    return E.forbidden(res, 'You do not have permission to publish report cards.');
  }

  const { data, error } = _validate(PublishSchema, req.body);
  if (error) return E.validation(res, error);
  const {
    classId, termId, termNumber: termNum, academicYearId,
    className: clientClassName, termName: clientTermName, academicYear: clientAcademicYear,
    schoolName,
  } = data;
  const now     = new Date().toISOString();
  const batchId = uuidv4();
  const ctx     = tenantContext(req);
  const scope   = await _resolveTermScope(schoolId, ctx, { academicYearId, termId, termNumber: termNum });

  // Same fix as POST /publish — see _resolveDisplayNames' own comment.
  const resolvedNames = await _resolveDisplayNames(schoolId, ctx, { classId, academicYearId: scope.academicYearId, termId: scope.termId });
  const className    = resolvedNames.className    || clientClassName    || '';
  const termName     = resolvedNames.termName     || clientTermName     || '';
  const academicYear = resolvedNames.academicYear || clientAcademicYear || '';

  const Batches = tenantModel('publish_batches', ctx);
  await Batches.create({
    id: batchId, schoolId, classId,
    termId: scope.termId, academicYearId: scope.academicYearId,
    status: 'running', startedBy: userId, startedAt: now,
    studentCount: 0, successCount: 0, failedStudents: [],
    layoutKey: 'kindergarten',
  });

  try {
    if (scope.academicYearId && await isYearArchived(schoolId, scope.academicYearId)) {
      await Batches.updateOne({ id: batchId }, {
        status: 'failed',
        failureReason: `Academic year "${scope.academicYearId}" is archived — publishing is not permitted for closed years.`,
        completedAt: now,
      });
      return E.badRequest(res, `Academic year "${scope.academicYearId}" has been archived — report card publishing is not permitted for closed years.`);
    }

    const template = await resolveRcTemplate(schoolId, classId);
    if (!template) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No Kindergarten template for this class', completedAt: now });
      return E.badRequest(res, 'This class has no Kindergarten template assigned — use the ordinary Generate & Publish instead.');
    }
    if (!termNum) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'termNumber is required', completedAt: now });
      return E.badRequest(res, 'termNumber is required.');
    }

    const reportSectionId = await sectionIdForClass(schoolId, classId);
    const scale = await resolveGradeScale(schoolId, reportSectionId, null);
    if (!scale) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No grade scale for this section', completedAt: now });
      return E.badRequest(res, _noScaleMessage(classId));
    }

    const { students, streamNameById, houseNameById, classTeacherByStream } = await _loadKgRoster(req, schoolId, classId);
    if (students.length === 0) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No active students found', completedAt: now });
      return E.badRequest(res, 'No active students found for this class/term — nothing to publish');
    }

    const studentIds = students.map(s => s.id);
    const existingSnaps = await tenantModel('report_card_snapshots', ctx).find({
      schoolId, classId, termId: scope.termId, academicYearId: scope.academicYearId, superseded: { $ne: true },
    }).lean();
    const existingMap = Object.fromEntries(existingSnaps.map(s => [s.studentId, s]));

    const draftDocs = await tenantModel('report_card_draft_comments', ctx)
      .find({ schoolId, studentId: { $in: studentIds }, termNumber: termNum }).lean();
    const draftByStudent = Object.fromEntries(draftDocs.map(d => [d.studentId, d]));

    let blockedStudentIds = new Set();
    try {
      const unpaidIds = await tenantModel('invoices', ctx).distinct('studentId', { schoolId, studentId: { $in: studentIds }, balance: { $gt: 0 } });
      blockedStudentIds = new Set(unpaidIds);
    } catch (_) { /* non-fatal — invoice collection may not exist */ }

    const school = await _model('schools').findOne({ id: schoolId }).select('principalSignatureUrl schoolStampUrl principalName').lean();
    const principalSignatureUrl = school?.principalSignatureUrl || null;
    const schoolStampUrl        = school?.schoolStampUrl        || null;
    const schoolPrincipalName   = school?.principalName          || null;

    const newSnaps = [];
    const supersedeOps = [];
    const partialFails = [];

    for (const stu of students) {
      try {
        const kg = await computeKgReport(ctx, schoolId, classId, stu.id, termNum, scope.academicYearId, scale);
        const prev = existingMap[stu.id];
        const draft = draftByStudent[stu.id];
        const newId = uuidv4();

        const snap = {
          id: newId,
          version: prev ? (prev.version || 1) + 1 : 1,
          supersedesId: prev?.id || null,
          schoolId,
          studentId:   stu.id,
          studentName: `${stu.firstName} ${stu.lastName}`.trim() || stu.id,
          admissionNo: stu.admissionNumber || '',
          studentPhotoUrl: stu.photo || null,
          streamId:   stu.streamId || null,
          streamName: stu.streamId ? (streamNameById[stu.streamId] || '') : '',
          houseName:  stu.houseId  ? (houseNameById[stu.houseId]   || '') : '',
          classId, className: className || '',
          termId: scope.termId, termName: termName || '',
          termNumber: termNum,
          academicYearId: scope.academicYearId, academicYear: academicYear || '',
          schoolName: schoolName || '',

          gradingSchema: scale.bands,
          gradeScaleId:  scale.id,
          gradeScaleSource: scale.source,

          // KG-specific content — frozen at publish time, same discipline
          // numeric snapshots already follow for gradingSchema/weights:
          // a school editing the template later must never retroactively
          // change what an already-published report shows.
          templateId:   template.id,
          templateName: template.name,
          kgSubjects:   kg?.subjects ?? [],
          overallAvgPct: kg?.overallAvgPct ?? null,
          overallGrade:  kg?.overallGrade ?? null,
          overallBandOnly:  kg?.overallBandOnly ?? false,
          overallBandLabel: kg?.overallBandLabel ?? null,
          kgDisplay:     template.display ?? {},

          comments: _resolveSnapComments(prev, draft),
          // Comments lock the same way marks do — see the identical field
          // on the numeric /publish route above for the full rationale.
          commentsLocked:   true,
          commentsLockedAt: now,

          principalSignatureUrl, schoolStampUrl, schoolPrincipalName,
          financialBlock: blockedStudentIds.has(stu.id),

          templateVersion: null,
          layoutKey: 'kindergarten',
          status: 'published',
          publishedAt: now, publishedBy: userId,
          batchId, superseded: false,
          updatedAt: now, updatedBy: userId,
        };

        snap.reportId   = await _nextReportId(schoolId, termNum, academicYear);
        snap.sha256Hash = _hashSnapshot(snap);
        newSnaps.push(snap);

        if (prev) {
          supersedeOps.push({
            updateOne: { filter: { id: prev.id }, update: { $set: { superseded: true, supersededAt: now, supersededBy: newId } } },
          });
        }
      } catch (snapErr) {
        partialFails.push({ studentId: stu.id, error: snapErr.message });
      }
    }

    const Snaps = tenantModel('report_card_snapshots', ctx);
    const insertOps = newSnaps.map(s => ({ insertOne: { document: s } }));
    let session = null;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await Snaps.bulkWrite(insertOps, { ordered: false, session });
        if (supersedeOps.length) await Snaps.bulkWrite(supersedeOps, { ordered: false, session });
      });
    } catch (txErr) {
      if (txErr.code === 20 || txErr.codeName === 'IllegalOperation' || txErr.message?.includes('Transaction')) {
        await Snaps.bulkWrite(insertOps, { ordered: false });
        if (supersedeOps.length) await Snaps.bulkWrite(supersedeOps, { ordered: false });
      } else {
        throw txErr;
      }
    } finally {
      if (session) await session.endSession().catch(() => {});
    }

    const finalStatus = partialFails.length > 0 ? 'partial' : 'completed';
    await Batches.updateOne({ id: batchId }, {
      status: finalStatus, completedAt: now,
      studentCount: newSnaps.length + partialFails.length,
      successCount: newSnaps.length, failedStudents: partialFails,
      newVersions: newSnaps.map(s => ({ snapshotId: s.id, studentId: s.studentId, version: s.version })),
    });

    // ── Lock the Markbook automatically (2026-10-13 workflow redesign) —
    //    same as the numeric /publish route's identical step, targeting
    //    indicator_marks instead of assessment_marks and the reserved
    //    KG_INDICATORS_TYPE sentinel instead of a real assessmentType
    //    (indicator marks have no instance/assessmentType of their own).
    //    Non-fatal: the publish itself already succeeded above.
    try {
      const yearFilter = _lockYearFilterPart(scope.academicYearId);
      const IndicatorMarks = tenantModel('indicator_marks', ctx);
      const lockFilter = { schoolId, classId, termNumber: termNum, ...yearFilter };
      const combos = await IndicatorMarks.find(lockFilter).select('subjectId streamId').lean();
      // Deduped by subjectId alone — see _lockSubmissionCombos for why
      // streamId isn't part of mark_submissions' real identity.
      const distinctCombos = [...new Map(
        combos.map(c => [c.subjectId, { ...c, assessmentType: KG_INDICATORS_TYPE, instance: 1 }])
      ).values()];

      await IndicatorMarks.updateMany(lockFilter, { $set: { isLocked: true, lockedAt: now } });

      const Submissions = tenantModel('mark_submissions', ctx);
      await _lockSubmissionCombos(Submissions, {
        schoolId, classId, termNumber: termNum, academicYearId: scope.academicYearId,
        combos: distinctCombos, userId, now, yearFilter, routeTag: 'report-cards/kg/publish',
      });
    } catch (lockErr) {
      console.error('[report-cards/kg/publish] auto-lock failed (publish itself succeeded):', lockErr);
    }

    console.log(`[REPORT-CARDS] KG batch ${batchId}: ${newSnaps.length} published (${finalStatus}) by ${userId}`);
    AuditService.log({ action: 'report_card.publish', actor: req.jwtUser, schoolId, target: { type: 'class', id: classId, label: className }, details: { batchId, termId: scope.termId, studentCount: newSnaps.length, status: finalStatus, layoutKey: 'kindergarten' }, req });

    _notifyReportCardsPublished(req, newSnaps).catch(err => console.error('[report-cards/kg/publish notify]', err));

    const response = {
      batchId, status: finalStatus, published: newSnaps.length, versioned: supersedeOps.length,
      failed: partialFails.length, classId, termId: scope.termId, publishedAt: now,
    };
    if (partialFails.length) {
      response.warnings = [`${partialFails.length} student(s) failed to snapshot — check publish-batches/${batchId} for details`];
    }
    return ok(res, response, null, 201);
  } catch (err) {
    await tenantModel('publish_batches', ctx).updateOne({ id: batchId }, {
      status: 'failed', failureReason: err.message, completedAt: new Date().toISOString(),
    }).catch(() => {});
    console.error('[report-cards/kg/publish]', err);
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
router.get('/', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, role, userId, guardianOf } = req.jwtUser;
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

    // Data scope. This route had none at all before — any grades:read
    // holder (e.g. a teacher, or a restricted role that somehow held that
    // permission) could list every student's report card in the school.
    // Restricted roles (parent/student/guardian) don't fit ScopeEngine's
    // class/stream shape at all — this admin-facing route isn't the one
    // their own portals actually use (student-portal.js/parent-portal.js
    // query report_card_snapshots directly, already correctly scoped),
    // but it must fail closed rather than fail open if reached directly.
    // A staff-level ('assigned'/'section') caller gets the same
    // classId(+streamId) narrowing every other stream-aware module uses.
    if (RESTRICTED_ROLES.includes(role)) {
      const ownStudentIds = ['parent', 'guardian'].includes(role)
        ? (Array.isArray(guardianOf) ? guardianOf : [])
        : [req.jwtUser.studentId].filter(Boolean);
      const requested = filter.studentId;
      filter.studentId = requested
        ? (ownStudentIds.includes(requested) ? requested : '__no_match__')
        : { $in: ownStudentIds };
    } else {
      ScopeEngine.applyToFilter(req, 'report_cards', filter);
    }

    const [docs, total] = await Promise.all([
      tenantModel('report_card_snapshots', tenantContext(req)).find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit)
        .select('-gradingSchema -assessmentWeights -subjects -__v').lean(),
      tenantModel('report_card_snapshots', tenantContext(req)).countDocuments(filter),
    ]);
    const views = (await Promise.all(docs.map(d => viewReportFor(req, d)))).filter(Boolean);
    return ok(res, views, paginate(page, limit, total));
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
router.get('/bulk-pdf', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!req.query.classId) return E.badRequest(res, 'classId query parameter is required');
    if (!isManagement(req)) return E.forbidden(res, 'Bulk report downloads are for school management.');

    // Same class/stream narrowing GET /:id already enforces (v5.106.0) —
    // this route had none at all: any staff account with plain
    // grades:read could bulk-download every published report card for
    // ANY class in the school, not just one they teach, since the filter
    // below was built purely from schoolId + a client-supplied classId.
    if (!RESTRICTED_ROLES.includes(role) && !ScopeEngine.isClassInScope(req, 'report_cards', req.query.classId, null)) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const filter = {
      schoolId, classId: req.query.classId,
      superseded: { $ne: true }, status: 'published',
    };
    if (req.query.termId)         filter.termId         = req.query.termId;
    // termNumber alongside termId — report-cards.js's own snapshots-list
    // route (GET /) already accepts either; this route only ever took
    // termId, which the client UI (ReportCardsTab.jsx) doesn't track at
    // all (it only has a plain term NUMBER, 1/2/3) — so a "download this
    // term's batch" request had no way to actually scope by term.
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    // Per-stream download — raised directly: "can the system allow
    // download per stream or class?" This route only ever filtered by
    // classId, merging every stream's reports into one PDF with no way
    // to narrow to a single stream. streamId is denormalized onto every
    // snapshot at publish time (RCE1 — see POST /publish), so this is a
    // plain equality filter, no extra lookup needed.
    if (req.query.streamId)       filter.streamId       = req.query.streamId;

    const config = await _loadConfig(schoolId);

    // Count first so we can return 404 before doing any real work
    const total = await tenantModel('report_card_snapshots', tenantContext(req)).countDocuments(filter);
    if (total === 0) return E.notFound(res, 'No published report cards found for this class/term');

    // Reported directly, with a side-by-side PDF comparison: bulk download
    // showed raw subjectIds ("subj_demo_bio") instead of real subject
    // names, and silently dropped the Behaviour section and the Dev
    // column entirely, on the exact same published snapshot that renders
    // correctly through GET /:id/pdf and GET /:id/html — both of which go
    // through _loadRenderExtras (school, subjectTeacherNames,
    // subjectNames, behaviour, deviations, subjectTeacherCommentsEnabled).
    // This route built its own, separate "bulkExtra" object instead of
    // reusing that function, and it was missing subjectNames entirely —
    // the exact gap _loadRenderExtras' own comment already documents
    // fixing for the single-student path, just never carried over here.
    // The old comment on this block claimed behaviour/deviations were a
    // deliberate, documented scope boundary ("neither layout shipped so
    // far needs them in the bulk-export path") — that was true when it
    // was written, but subject_paired/marks_then_comments both render a
    // Behaviour section and a Dev column today, so that premise no longer
    // holds; resolved per-student below, in the same per-chunk loop
    // attendance already uses, rather than left silently blank.
    // Resolved AFTER the zero-match 404 check above — no point paying
    // for these queries on a request that's about to 404 anyway.
    const [bulkSchool, bulkCaConfig, bulkAssignments, bulkSubjectDocs] = await Promise.all([
      _model('schools').findOne({ id: schoolId }, { name: 1, logoUrl: 1, tagline: 1, address: 1, phone: 1, email: 1, website: 1, country: 1, principalSignatureUrl: 1, schoolStampUrl: 1, principalName: 1, timezone: 1, reportCardWatermarkEnabled: 1, reportCardWatermarkOpacity: 1 }).lean().catch(() => null),
      _getAssessmentConfig(schoolId, req.query.academicYearId || null),
      tenantModel('teaching_assignments', tenantContext(req))
        .find({ schoolId, classId: req.query.classId }).select('subjectId teacherName').lean().catch(() => []),
      tenantModel('subjects', tenantContext(req)).find({ schoolId }).select('id name').lean().catch(() => []),
    ]);
    const bulkSubjectTeacherNames = {};
    for (const a of bulkAssignments) {
      if (!bulkSubjectTeacherNames[a.subjectId]) bulkSubjectTeacherNames[a.subjectId] = a.teacherName || '';
    }
    const bulkSubjectNames = Object.fromEntries(bulkSubjectDocs.map(s => [s.id, s.name]));
    const bulkExtraBase = {
      school: bulkSchool, subjectTeacherNames: bulkSubjectTeacherNames, subjectNames: bulkSubjectNames,
      subjectTeacherCommentsEnabled: bulkCaConfig.subjectTeacherCommentsEnabled !== false,
    };

    // RCE9 — each student is printed through the exact same HTML+Puppeteer
    // pipeline GET /:id/pdf uses (htmlToPdfBuffer), then every student's
    // one-document PDF is merged into one (mergePdfBuffers, pdf-lib) —
    // the equivalent of PDFKit's old page-by-page single document, now
    // that each student's PDF is a finished browser print rather than a
    // page drawn into a shared doc. Images are plain <img src="..."> URLs
    // already baked into each student's HTML — no separate buffer
    // fetching needed here. Rendered SEQUENTIALLY, not in parallel — this
    // host's modest CPU/memory budget (already flagged elsewhere) can't
    // safely run many headless-Chromium pages at once; a bulk export is
    // an infrequent admin action, so trading some wall-clock time for
    // staying within that budget is the right call here specifically.
    const CHUNK_SIZE = 10;
    const cursor = tenantModel('report_card_snapshots', tenantContext(req))
      .find(filter)
      .sort({ studentName: 1 })
      .batchSize(CHUNK_SIZE)
      .cursor();

    const studentPdfBuffers = [];
    let chunkBuf = [];

    const processChunk = async (chunk) => {
      const [attResults, behaviourResults, deviationResults] = await Promise.all([
        Promise.all(chunk.map(s => s.attendanceSummary
          ? Promise.resolve(s.attendanceSummary)
          : attendanceSummary(schoolId, s.studentId, s.classId, s.termId, s.academicYearId)
        )),
        // Genuinely per-student (each has their own merit/demerit history) —
        // bounded cost, same CHUNK_SIZE=10-at-a-time posture attendance
        // already uses above, not one query per student in the whole class.
        Promise.all(chunk.map(s => behaviourSummary(schoolId, s.studentId).catch(() => null))),
        Promise.all(chunk.map(s => (s.termNumber > 1
          ? tenantModel('report_card_snapshots', tenantContext(req)).findOne({
              schoolId, studentId: s.studentId, academicYearId: s.academicYearId,
              termNumber: s.termNumber - 1, superseded: { $ne: true },
            }).lean().catch(() => null)
          : Promise.resolve(null)
        ))),
      ]);
      for (let i = 0; i < chunk.length; i++) {
        const snap = chunk[i];
        const isAdmin = ['admin', 'superadmin'].includes(role);
        if (snap.financialBlock && req.query.force !== '1' && !isAdmin) continue; // skip blocked
        const studentExtra = {
          ...bulkExtraBase,
          behaviour:   behaviourResults[i],
          deviations:  computeTermDeviation(snap.subjects, deviationResults[i]?.subjects),
        };
        const sections = _buildReportSections(snap, config, attResults[i], studentExtra);
        const html     = getLayout(snap.layoutKey).renderHtml(sections);
        studentPdfBuffers.push(await htmlToPdfBufferOrFallback(html,
          () => _pdfKitFallback(snap, config, attResults[i], studentExtra, bulkSchool?.logoUrl, snap.studentPhotoUrl)));
      }
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

    if (studentPdfBuffers.length === 0) return E.notFound(res, 'No published report cards found for this class/term');

    const merged = await mergePdfBuffers(studentPdfBuffers);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-cards-class-${req.query.classId}.pdf"`);
    res.setHeader('Content-Length', merged.length);
    res.send(merged);
  } catch (err) {
    console.error('[report-cards/bulk-pdf]', err);
    if (!res.headersSent) return E.serverError(res);
    res.end();
  }
});

// GET /draft-comments?classId=&termNumber= — same registration-order reasoning as /bulk-pdf above
router.get('/draft-comments', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    // Resolved via the students collection (each draft doc's own classId
    // mirrors the student's classId at save time, but isn't the
    // authoritative source — a student moved classes, or a doc saved
    // before PUT /draft-comments/:studentId started resolving classId
    // server-side, could carry a stale value there). Matching by the
    // CURRENT roster instead means a draft is never missed just because
    // its own classId field drifted.
    if (req.query.classId) {
      const rosterIds = await tenantModel('students', tenantContext(req))
        .distinct('id', { schoolId, classId: req.query.classId });
      filter.studentId = { $in: rosterIds };
    }
    if (req.query.termNumber) filter.termNumber = Number(req.query.termNumber);
    const docs = await tenantModel('report_card_draft_comments', tenantContext(req)).find(filter).lean();
    return ok(res, await scopeDraftCommentsForCaller(req, docs));
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
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, role, userId, guardianOf, studentId: ownStudentId } = req.jwtUser;
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

    // Student: can only view their OWN report card. Previously missing
    // entirely — only 'parent'/'guardian' were checked above, so a
    // 'student'-role caller with grades:read could fetch any OTHER
    // student's full report card (scores, comments, GPA) by id, with no
    // ownership check at all.
    if (role === 'student' && doc.studentId !== ownStudentId) {
      tenantModel('mark_audit_log', tenantContext(req)).create({
        action:       'GUARDIAN_ACCESS_DENIED',
        schoolId,
        requestedBy:  userId,
        requestedRole: role,
        targetStudentId: doc.studentId,
        snapshotId:   req.params.id,
        route:        'GET /api/report-cards/:id',
        timestamp:    new Date().toISOString(),
      }).catch(e => console.error('[report-cards] student audit log failed:', e.message));
      return E.forbidden(res, 'You are not authorised to view this student\'s report card.');
    }

    // Staff (teacher/section-head): same classId(+streamId) narrowing every
    // other stream-aware module uses. This route had no scope check of any
    // kind before — a teacher with grades:read could open any student's
    // report card in the school, not just their own class/stream.
    if (!RESTRICTED_ROLES.includes(role) && !ScopeEngine.isClassInScope(req, 'report_cards', doc.classId, doc.streamId)) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const view = await viewReportFor(req, doc);
    if (!view) return E.forbidden(res, 'You do not teach any subject on this report card.');
    return ok(res, view);
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

    // Comments lock the same way marks do (2026-10-18, direct request):
    // set automatically at publish (see commentsLocked on the snapshot
    // object in /publish and /kg/publish), cleared only through the
    // matching POST /:id/comments/unlock below. Pre-fix snapshots simply
    // have commentsLocked: undefined — falsy, same backward-compatible
    // posture assessment_marks.isLocked already has for marks saved
    // before locking existed at all.
    if (snap.commentsLocked) {
      return E.forbidden(res, 'Comments are locked — the report card for this term has been published. Ask an admin to unlock it for a correction.');
    }

    // Subject-teacher scoping (RC6) — the draft-comments routes for this
    // exact same data (a subject's comment before publish) already enforce
    // this via unassignedPairs; this route, which can also edit
    // subjectComments post-publish, had no such check at all — any
    // grades:update holder could overwrite any subject's comment on any
    // published report card regardless of teaching_assignments.
    if (data.subjectComments && typeof data.subjectComments === 'object' && snap.classId) {
      const pairs = Object.keys(data.subjectComments).map(subjectId => ({ classId: snap.classId, subjectId, streamId: snap.streamId }));
      const denied = await unassignedPairs(req, pairs);
      if (denied.length > 0) {
        return E.forbidden(res, `You are not assigned to teach: ${denied.map(p => p.subjectId).join(', ')}`);
      }
    }

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

/* ══════════════════════════════════════════════════════════════
   POST /:id/comments/unlock  (2026-10-18 — comments lock like marks)
   Admin-only, mandatory reason, 24h auto-relock — same contract as
   mark-submissions.js's own POST /:id/unlock (its default, no-
   workflow-config path, which is what every school actually uses
   today). A separate job type (comments_relock) rather than reusing
   marks_relock: the payload/target shape is a snapshot id, not a
   mark_submissions id, and the two must never be confused by a worker
   that only has the job type to go on.
   ══════════════════════════════════════════════════════════════ */
const COMMENTS_RELOCK_DELAY_MS = 24 * 60 * 60 * 1000; // 24h — same window as marks

async function _autoRelockComments(payload) {
  const { snapshotId, schoolId } = payload || {};
  if (!snapshotId || !schoolId) return;
  const Snaps = _model('report_card_snapshots');
  const snap = await Snaps.findOne({ id: snapshotId, schoolId }).lean();
  // Only re-lock if still unlocked — an admin who already re-locked it
  // manually, or published a newer version over it, is never clobbered.
  if (!snap || snap.commentsLocked) return;

  const now = new Date().toISOString();
  await Snaps.updateOne({ id: snapshotId, schoolId }, {
    $set: { commentsLocked: true, commentsLockedAt: now, commentsUnlockedAt: null },
  });
  await AuditService.log({
    action: 'report_card.comments_auto_relocked', actor: { userId: 'system', role: 'system', email: null }, schoolId,
    target: { type: 'report_card_snapshot', id: snapshotId }, details: {},
  });
}
registerHandler('comments_relock', _autoRelockComments);

router.post('/:id/comments/unlock', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role, email } = req.jwtUser;
    const reason = (req.body.reason || '').trim();
    if (!reason) return E.badRequest(res, 'A reason is required to unlock comments.');
    if (!['admin', 'superadmin'].includes(role)) {
      return E.forbidden(res, 'Only admins can unlock comments.');
    }

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');
    if (!snap.commentsLocked) return E.badRequest(res, 'Comments are not locked.');

    const now = new Date().toISOString();
    const doc = await tenantModel('report_card_snapshots', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { commentsLocked: false, commentsUnlockedBy: userId, commentsUnlockedAt: now, commentsUnlockReason: reason, updatedAt: now, updatedBy: userId } },
      { new: true }
    ).lean();

    await AuditService.log({
      action: 'report_card.comments_unlocked', actor: { userId, role, email }, schoolId,
      target: { type: 'report_card_snapshot', id: doc.id }, details: { reason }, req,
    });

    await enqueueJob({ type: 'comments_relock', payload: { snapshotId: doc.id, schoolId }, runAt: new Date(Date.now() + COMMENTS_RELOCK_DELAY_MS) });

    return ok(res, { id: doc.id, commentsLocked: doc.commentsLocked });
  } catch (err) {
    console.error('[report-cards/:id/comments/unlock POST]', err);
    return E.serverError(res);
  }
});

/* ── PDF builder (shared between single and bulk) ───────────── */

/* Decode a URL or data: URI to a Buffer. Non-fatal — returns null on any error. */
async function _fetchImageBuf(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1];
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
  // A relative, self-hosted path (e.g. settings.js's logo-upload flow
  // writes `/api/public/school-asset/logo?slug=...`) resolves fine in a
  // browser, relative to the page's own origin — but this is a
  // server-side fetch with no "current page" of its own, so it has to be
  // made absolute against the app's own base URL first. Reported directly
  // 2026-10-27: without this, NO school logo (or the faint watermark that
  // reuses the same buffer) ever rendered in any downloaded PDF report
  // card, for any school using the normal logo-upload flow — confirmed
  // live for both the reporting school and a second, unrelated one; the
  // fetch below never even attempted a request.
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (!url.startsWith('/')) return null; // not a fetchable URL or app-relative path
    url = appUrl(url);
  }
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
  const [school, behaviour, prevSnap, caConfig, assignments, subjectDocs] = await Promise.all([
    // principalSignatureUrl/schoolStampUrl added as the live fallback
    // _computeReportSections' signatures block now reads when a snapshot
    // predates this field being frozen at publish time (every snapshot
    // going forward carries its own, see POST /publish's "Load school
    // signature/stamp URLs for snapshotting" step).
    _model('schools').findOne({ id: schoolId }, { name: 1, logoUrl: 1, tagline: 1, address: 1, phone: 1, email: 1, website: 1, country: 1, principalSignatureUrl: 1, schoolStampUrl: 1, principalName: 1, timezone: 1, reportCardWatermarkEnabled: 1, reportCardWatermarkOpacity: 1 }).lean().catch(() => null),
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
    // Real subject names — report cards were printing the raw subjectId
    // (e.g. "subj_demo_bio") on every subject row and in every subject
    // comment, since nothing ever resolved it to the subjects collection's
    // own `name`. Queried directly (not read off teaching_assignments'
    // own denormalized subjectName) so an UNASSIGNED subject still gets a
    // real name instead of silently falling back to its id.
    tenantModel('subjects', tenantContext(req))
      .find({ schoolId, id: { $in: Object.keys(snap.subjects || {}) } })
      .select('id name').lean().catch(() => []),
  ]);
  const deviations = computeTermDeviation(snap.subjects, prevSnap?.subjects);
  // First assignment found per subject wins — a subject could in theory
  // have more than one teaching_assignments doc (co-teaching); the
  // report shows one name, not a list.
  const subjectTeacherNames = {};
  for (const a of assignments) {
    if (!subjectTeacherNames[a.subjectId]) subjectTeacherNames[a.subjectId] = a.teacherName || '';
  }
  const subjectNames = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));
  return {
    school, behaviour, deviations, subjectTeacherNames, subjectNames,
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
    // {subjectId: name}, resolved by the caller from the subjects
    // collection — see _loadRenderExtras. Falls back to the raw id
    // below only if a subject was deleted after this snapshot's marks
    // were recorded (the id itself is always frozen; the name is a
    // live lookup, same posture as subjectTeacherNames above).
    subjectNames = {},
  } = extra;
  const isDraft = snap.status !== 'published' || snap.superseded;

  // Reported directly, side-by-side against the printed card: downloaded
  // report cards headed every page with the literal "School Management
  // System" instead of the school's own name. snap.schoolName is only
  // ever populated when the publishing client explicitly sends one (it
  // doesn't), so this always fell through. The live school doc is already
  // resolved for branding (logo/tagline/contact) and is non-frozen by
  // design, so fall back to its real name before the generic placeholder.
  const displaySchoolName =
    (snap.schoolName && String(snap.schoolName).trim()) || school?.name || 'School Management System';

  // Reported directly: "system should be aware who is the school
  // principal" — previously only the manually-typed per-report field
  // (Comments tab) ever populated this, requiring it to be retyped for
  // every student, every term. A per-report override still wins when
  // one is typed; otherwise falls to the school-wide default, frozen at
  // publish time for a real snapshot (snap.schoolPrincipalName — same
  // "stays valid even if the setting changes later" posture as
  // principalSignatureUrl/schoolStampUrl), or resolved live from the
  // school doc for an unpublished draft preview (extra.school), which
  // has no snapshot of its own yet.
  const resolvedPrincipalName = snap.comments?.principalName || snap.schoolPrincipalName || school?.principalName || '';

  const weights     = snap.assessmentWeights || [];
  const typeEntries = weights.map(w => ({
    key:   w.assessmentType,
    label: (w.label || w.assessmentType).split(/[\s/]+/)[0],
    // Untruncated, e.g. "Continuous Assessment" rather than the column-
    // header's first-word-only "label" above — for the assessment-key
    // explainer (what does CA/HW/MT/ET mean), which must only ever list
    // what THIS school actually configured (weights, hence typeEntries,
    // is already scoped to exactly that), never a hardcoded universal set.
    fullLabel: w.label || w.assessmentType,
  }));

  const passMark = snap.passMark ?? config.passMark ?? 40;

  const rows = Object.entries(snap.subjects || {}).map(([subjectId, sub]) => {
    const failed = sub.finalScore != null && sub.finalScore < passMark;
    const isBest = !!snap.subjectBest?.[subjectId];
    const isUsed = !!snap.rankingSubjectsUsed?.includes(subjectId);
    const dev = deviations?.subjects ? (deviations.subjects[subjectId] ?? null) : null;
    return {
      subjectId,
      nameLine:    (isBest ? '★ ' : '') + (subjectNames[subjectId] || subjectId) + (isUsed && snap.rankingSubjectStrategy !== 'all' ? ' ●' : ''),
      failed,
      // Reported directly: a missing mark should leave the cell blank,
      // not show a dash — the dash read as "0" or "failed" at a glance.
      typeValues:  typeEntries.map(te => {
        const val = sub.breakdown?.[te.key];
        return val != null ? val.toFixed(1) : '';
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
      schoolName: displaySchoolName,
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
      // RCE8 — raw values + the already-computed overall grade (same
      // resolveGrade() lookup the cover's "Mean Mark" row has used all
      // along — exposed here too, not re-derived, so a renderer can build
      // a single "69.6% · B+" headline instead of re-parsing totalText).
      totalScore:   snap.totalScore ?? null,
      averageScore: snap.averageScore ?? null,
      subjectCount: Object.keys(snap.subjects || {}).length,
      meanGrade:      meanGrade?.grade ?? null,
      meanGradeLabel: meanGrade?.descriptor ?? null,
    },
    attendance: showAttendance ? {
      // Reported directly: Present + Absent not summing to Total Days
      // read as a bug — an authorised absence or a late day is neither.
      // Only shown when nonzero, so a school that never uses those
      // statuses keeps the exact line it had before.
      text: `Present: ${attendance.daysPresent}   Absent: ${attendance.daysAbsent}` +
            (attendance.daysAuthorised ? `   Authorised: ${attendance.daysAuthorised}` : '') +
            (attendance.daysLate ? `   Late: ${attendance.daysLate}` : '') +
            `   Total Days: ${attendance.totalSchoolDays}` +
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
      principalName:    resolvedPrincipalName,
      // RC7 — a disabled capability produces zero trace in the output
      // (Functional Architecture §11): no rows built at all, and the HTML
      // adapter uses this same flag to skip the section header/table too,
      // rather than rendering an empty "No comment entered" list.
      subjectTeacherCommentsEnabled,
      subjectComments: subjectTeacherCommentsEnabled
        ? Object.keys(snap.subjects || {}).map(subjectId => ({
            subjectId,
            subjectName: subjectNames[subjectId] || subjectId,
            text: sanitisePdfStr(snap.comments?.subjectComments?.[subjectId]) || '',
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
      // Class-teacher observation ratings (2026-09) — off for every school
      // until explicitly turned on in Settings; same "zero trace when
      // disabled" posture as subjectTeacherCommentsEnabled above.
      showObservationRatings: !!config.showObservationRatings,
      observationRatings: (config.observationCategories || []).map(category => ({
        category,
        rating: snap.comments?.observationRatings?.[category] || null,
      })),
    },
    signatures: {
      classTeacherLabel: config.classTeacherSignatureLabel || 'Class Teacher',
      principalLabel:    config.principalSignatureLabel    || 'Principal',
      // Reported directly: "the stamp and principal's signature didn't
      // show" — true for the HTML renderers (browser print-to-PDF), which
      // only ever received these as PDFKit image Buffers (images.*,
      // _fetchSignatureImages) for the separate native-PDF path. A
      // published snapshot already has them frozen (see POST /publish's
      // "Load school signature/stamp URLs for snapshotting" step) so
      // that's the first source; extra.school is the live fallback for an
      // unpublished draft preview, which has no snapshot of its own yet.
      principalSignatureUrl: snap.principalSignatureUrl ?? school?.principalSignatureUrl ?? null,
      schoolStampUrl:         snap.schoolStampUrl         ?? school?.schoolStampUrl         ?? null,
    },
    footer: {
      footerNote: config.footerNote || 'This report card is computer-generated.',
      genLine:    `Generated: ${_formatInSchoolTz(new Date(), school?.timezone)}  |  v${snap.version || 1}  |  Batch: ${snap.batchId || '—'}`,
      reportId:   snap.reportId || null,
      // The signature block's own "Date:" — a published report's real
      // publish date (frozen, meaningful as "signed on"; doesn't drift
      // every time the PDF is re-downloaded later), falling back to
      // today for an unpublished draft preview, which has no publishedAt yet.
      signDate: _formatDateInSchoolTz(snap.publishedAt ? new Date(snap.publishedAt) : new Date(), school?.timezone),
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
      schoolName:       snap.schoolName || school?.name || '',
      studentName:      snap.studentName   || '—',
      admissionNo:      snap.admissionNo   || '—',
      className:        snap.className    || '—',
      streamName:       snap.streamName   || '',
      houseName:        snap.houseName    || '',
      academicYear:     snap.academicYear || '',
      termNumber:       snap.termNumber   ?? null,
      // "Just a label" (2026-10-18) — shown in place of "Term X" on the
      // cover wherever that's rendered, when the school has set one for
      // this class/term/year (e.g. "Mid-Term Report").
      reportLabel:      snap.reportLabel  || null,
      // RCE3b — school identity/contact, resolved live at render time
      // (branding, not scored content — same non-frozen posture logoUrl/
      // tagline already have; a school updating its address later is
      // fine to show on a re-render of an old report).
      schoolAddress:    school?.address || '',
      schoolPhone:      school?.phone   || '',
      schoolEmail:      school?.email   || '',
      schoolWebsite:    school?.website || '',
      schoolCountry:    school?.country || '',
      classTeacherName: snap.comments?.classTeacherName || '',
      principalName:    resolvedPrincipalName,
      // Reported directly: renaming "Principal" to "Head of School" in
      // Settings updated the sign-off block (signatures.principalLabel,
      // above) correctly, but the cover page's own meta row still read a
      // hardcoded 'Principal' literal in report-layouts.js — same source
      // of truth, just never threaded into `cover`.
      principalLabel:   config.principalSignatureLabel || 'Principal',
      studentPhotoUrl:  config.showStudentPhoto !== false ? (snap.studentPhotoUrl || null) : null,
      // Per-school faint-logo watermark controls (2026-10-25) — resolved
      // live from the school's own profile, same non-frozen posture as
      // logoUrl/tagline above. Defaults preserve the previous always-on,
      // 7%-opacity behaviour for a school that never touches this.
      watermarkEnabled: school?.reportCardWatermarkEnabled !== false,
      watermarkOpacity: school?.reportCardWatermarkOpacity ?? 0.07,
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


/* Kindergarten / competency-band IR — the KG sibling of
   _computeReportSections above. Separate function, not a branch inside
   it: that function's whole shape (resultsTable rows, ranking,
   deviations) is built around numeric concepts this snapshot doesn't
   have. Lives here (report-cards.js), not report-layouts.js, so it can
   reuse _normalizeGradeScaleBands and the rest of this file's private
   helpers directly — report-layouts.js requiring back into this file
   would be circular (this file already requires getLayout from there). */
function _computeKgReportSections(snap, config, extra = {}) {
  const { school = null } = extra;
  const isDraft = snap.status !== 'published' || snap.superseded;
  // Same fallback chain as _computeReportSections' own resolvedPrincipalName
  // — this one was missing the snap.comments?.principalName check, so a
  // draft-entered principal name never showed on a KG report at all.
  const resolvedPrincipalName = snap.comments?.principalName || snap.schoolPrincipalName || school?.principalName || '';

  const gradeBands = _normalizeGradeScaleBands(snap.gradingSchema).sort((a, b) => b.min - a.min);
  const display = snap.kgDisplay || {};

  return {
    isDraft,
    watermarkText: isDraft ? (snap.superseded ? 'SUPERSEDED' : 'DRAFT') : null,
    cover: {
      logoUrl: school?.logoUrl || null,
      tagline: school?.tagline || '',
      title: 'KINDERGARTEN REPORT',
      schoolName:   snap.schoolName  || '',
      studentName:  snap.studentName || '—',
      admissionNo:  snap.admissionNo || '—',
      className:    snap.className   || '—',
      streamName:   snap.streamName  || '',
      houseName:    snap.houseName   || '',
      academicYear: snap.academicYear || '',
      termNumber:   snap.termNumber  ?? null,
      reportLabel:  snap.reportLabel || null,
      schoolAddress: school?.address || '',
      schoolPhone:   school?.phone   || '',
      schoolEmail:   school?.email   || '',
      schoolWebsite: school?.website || '',
      schoolCountry: school?.country || '',
      classTeacherName: snap.comments?.classTeacherName || '',
      principalName:    resolvedPrincipalName,
      principalLabel:   config.principalSignatureLabel || 'Principal',
      studentPhotoUrl:  config.showStudentPhoto !== false ? (snap.studentPhotoUrl || null) : null,
      // Per-school faint-logo watermark controls (2026-10-25) — see the
      // numeric _computeReportSections' identical fields for the full
      // reasoning; same school-profile source, same defaults.
      watermarkEnabled: school?.reportCardWatermarkEnabled !== false,
      watermarkOpacity: school?.reportCardWatermarkOpacity ?? 0.07,
    },
    templateName: snap.templateName || '',
    display: {
      showScore:      display.showScore      !== false,
      showGrade:       display.showGrade      !== false,
      showSubjectAvg:  display.showSubjectAvg !== false,
      showOverallAvg:  display.showOverallAvg !== false,
    },
    kgSubjects: snap.kgSubjects || [],
    overall: {
      avgPct:    snap.overallAvgPct,
      grade:     snap.overallGrade,
      bandOnly:  snap.overallBandOnly || false,
      bandLabel: snap.overallBandLabel || null,
    },
    gradingKey: gradeBands.map((b, i) => ({
      grade:  b.grade,
      range:  `${b.min}–${i === 0 ? 100 : gradeBands[i - 1].min - 1}%`,
      points: b.points ?? '—',
      label:  b.label  ?? '',
    })),
    comments: {
      classTeacherRemark: snap.comments?.classTeacherRemark || '',
      principalRemark:    snap.comments?.principalRemark    || '',
      // Reported directly: turning Ranking or Principal's Comment off in
      // Report Card settings should mean the block never appears, not
      // even blank — the non-KG path already does this via these same two
      // flags (see _computeReportSections below). The KG path never read
      // them at all: a KG report only ever hid a remark block when the
      // text happened to be empty, so an already-written principal
      // comment kept showing even after the school turned the setting
      // off. Ranking has no KG equivalent to begin with (no rank/GPA
      // concept for a competency-band report), so there's nothing to gate
      // there.
      showClassTeacherRemark: config.showClassTeacherRemark !== false,
      showPrincipalRemark:    config.showPrincipalRemark    !== false,
    },
    signatures: {
      classTeacherLabel: config.classTeacherSignatureLabel || 'Class Teacher',
      principalLabel:    config.principalSignatureLabel    || 'Principal',
    },
    footer: {
      footerNote: config.footerNote || 'This report card is computer-generated.',
      genLine:    `Generated: ${_formatInSchoolTz(new Date(), school?.timezone)}  |  v${snap.version || 1}  |  Batch: ${snap.batchId || '—'}`,
      reportId:   snap.reportId || null,
      signDate: _formatDateInSchoolTz(snap.publishedAt ? new Date(snap.publishedAt) : new Date(), school?.timezone),
    },
  };
}

/* RCE2 — dispatches on the SNAPSHOT'S OWN frozen layoutKey, never the
   school's current default. A published report_card_snapshots doc must
   render identically forever regardless of what a school configures
   later (same immutability guarantee _hashSnapshot's fixed field list
   already protects) — snapshots published before this engine existed
   simply have no layoutKey, which getLayout() maps to 'legacy_tabular',
   today's exact pre-existing output.

   Branches to the KG sections builder for a kindergarten-layout
   snapshot — every OTHER call site below goes through this one
   function (or the sibling _buildReportSections used by the HTML
   routes), so there is exactly one place that decides which IR a
   layoutKey gets, never a copy-pasted ternary per route. */
function _buildReportSections(snap, config, attendance, extra) {
  return snap.layoutKey === 'kindergarten'
    ? _computeKgReportSections(snap, config, extra)
    : _computeReportSections(snap, config, attendance, extra);
}

function _buildPDFPage(doc, snap, config, attendance, isFirstPage, images = {}, extra = {}) {
  const sections = _buildReportSections(snap, config, attendance, extra);
  getLayout(snap.layoutKey).renderPdf(doc, sections, images, isFirstPage);
}

/* RCE9 fallback — builds the exact PDF this snapshot would have
   produced before the Puppeteer migration, via the still-present
   PDFKit renderer. Used ONLY when htmlToPdfBufferOrFallback's
   Puppeteer attempt throws (see that function's own header for why
   this can happen on a real host even though it works everywhere in
   testing) — a report-card download is business-critical and must not
   hard-fail just because the newer renderer can't launch on this
   particular host. Never called on the success path, so schools where
   Puppeteer works fine pay nothing for this existing. */
async function _pdfKitFallback(snap, config, attendance, extra, schoolLogoUrl, studentPhotoUrl) {
  const PDFDocument = require('pdfkit');
  const doc     = new PDFDocument({ margin: 40, size: 'A4' });
  const buffers = [];
  doc.on('data', chunk => buffers.push(chunk));
  const images = await _fetchSignatureImages(snap);
  images.studentPhoto = config.showStudentPhoto !== false
    ? await _fetchImageBuf(studentPhotoUrl).catch(() => null)
    : null;
  images.schoolLogo = await _fetchImageBuf(schoolLogoUrl).catch(() => null);
  const done = new Promise(resolve => doc.on('end', resolve));
  _buildPDFPage(doc, snap, config, attendance, true, images, extra);
  doc.end();
  await done;
  return Buffer.concat(buffers);
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

  // Same class/stream narrowing GET /:id already enforces (v5.106.0) — its
  // PDF/HTML twins never got it. _pdfAccess only checks rbac('grades','read')
  // for staff; without this, any teacher with that permission could
  // download any student's report card PDF/HTML in the school, not just
  // their own class/stream.
  if (!RESTRICTED_ROLES.includes(role) && !ScopeEngine.isClassInScope(req, 'report_cards', snap.classId, snap.streamId)) {
    E.forbidden(res, 'This class is not in your assigned scope.');
    return false;
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
router.get('/:id/pdf', authMiddleware, PLAN, MODGATE, _pdfAccess, scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (!(await _checkSnapshotAccess(req, res, snap))) return;
    if (!(await canViewFullReport(req, snap.streamId))) return E.forbidden(res, 'Printed report cards are for school management and the stream form tutor.');

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

    // RCE9 — printed server-side through the exact same HTML this
    // report's own GET /:id/html route returns (htmlToPdfBuffer, a
    // shared headless-Chromium instance — see html-to-pdf.js's header),
    // instead of a second, separately maintained PDFKit renderer. The
    // two kept drifting apart in ways only caught by comparing two real
    // downloads side by side (pills vs checkboxes, "Total" vs "Total
    // Incidents", a full-page cover vs a compact one) — one renderer
    // now, not two, so they structurally cannot drift again. Images
    // (logo/photo/signatures) are plain <img src="..."> URLs already
    // baked into this HTML; Chromium fetches them itself on render, no
    // separate buffer-fetching needed here. Falls back to PDFKit
    // (_pdfKitFallback) if Puppeteer itself can't even launch on this
    // host — see html-to-pdf.js's htmlToPdfBufferOrFallback for why
    // that's a real, documented possibility, not a hypothetical one.
    const sections = _buildReportSections(snap, config, attData, extra);
    const html     = getLayout(snap.layoutKey).renderHtml(sections);
    const pdf      = await htmlToPdfBufferOrFallback(html,
      () => _pdfKitFallback(snap, config, attData, extra, extra.school?.logoUrl, snap.studentPhotoUrl));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${snap.studentId}-v${snap.version || 1}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
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
router.get('/:id/html', authMiddleware, PLAN, MODGATE, _pdfAccess, scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const snap = await tenantModel('report_card_snapshots', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (!(await _checkSnapshotAccess(req, res, snap))) return;
    if (!(await canViewFullReport(req, snap.streamId))) return E.forbidden(res, 'Printed report cards are for school management and the stream form tutor.');

    let attData = snap.attendanceSummary;
    if (!attData) {
      attData = await attendanceSummary(schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId);
    }
    const config = await _loadConfig(schoolId);
    const extra  = await _loadRenderExtras(req, schoolId, snap);

    const sections = _buildReportSections(snap, config, attData, extra);
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
  // Reported directly: "no subject teachers name" — this route never had
  // a classId to resolve teaching_assignments with at all (only the
  // display-name className string below), so subjectTeacherNames was
  // always {} in a draft preview even when a published copy of the same
  // report (which does this lookup in _loadRenderExtras) would show it.
  classId: z.string().optional(),
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
    // "Just a label" (2026-10-18) — round-tripped from /generate's own
    // response the same way customTypes/gradeScale already are.
    reportLabel: z.string().max(60).nullable().optional(),
  }).optional(),
});

router.post('/preview-html', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { data, error } = _validate(PreviewHtmlSchema, req.body);
    if (error) return E.validation(res, error);
    const { student, studentInfo, classId, className, termNum, academicYear, school, draftComment, studentDeviations, behaviourSummary: beh, config: clientConfig } = data;
    const { schoolId } = req.jwtUser;

    // Reported directly: "why is the report not pulling and rendering
    // class and stream?" — streamName was never part of this route's
    // snap construction at all (className was, stream never). Resolved
    // live from streamId via the streams collection (not the student's
    // own possibly-stale denormalized streamName — same gap just fixed
    // for GET /api/students/:id), same reasoning as every other live
    // lookup already in this route — the one source that can't drift.
    const previewStudentDoc = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: student.studentId }).select('streamId').lean().catch(() => null);
    let previewStreamName = '';
    if (previewStudentDoc?.streamId) {
      const strm = await tenantModel('streams', tenantContext(req))
        .findOne({ schoolId, id: previewStudentDoc.streamId }).select('name').lean().catch(() => null);
      previewStreamName = strm?.name || '';
    }

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
      streamName: previewStreamName,
      termNumber: termNum ?? null, academicYear: academicYear || '',
      schoolName: school?.name || '',
      reportLabel: clientConfig?.reportLabel || null,
      gradingSchema,
      assessmentWeights: _convertCustomTypesToWeights(clientConfig?.customTypes ?? []),
      passMark: clientConfig?.passMark, rankingSubjectStrategy: null,
      subjects: student.subjects, totalScore: student.totalScore, averageScore: student.averageScore,
      gpa: student.gpa, subjectCount: student.subjectCount,
      rankings: student.rankings ?? {},
      comments: _resolveSnapComments(null, { ...draftComment, classTeacherName: draftComment?.classTeacherName || student.classTeacherName || '' }),
    };
    // Reported directly: "the system still struggling to implement what
    // is on off, like principal's comment is turned off in report card
    // setting but still appears" — confirmed real, and it was every
    // display toggle, not just that one. This route built its own
    // hand-picked {rankingEnabled, showGPA, showAttendanceSummary:false}
    // object instead of loading the school's real academic_config — every
    // OTHER toggle (showClassTeacherRemark, showPrincipalRemark,
    // showDeviation, showClassAverage, showBehaviour,
    // showObservationRatings/observationCategories, the signature labels,
    // footerNote) was simply never read here, so _computeReportSections'
    // own `config.X !== false` defaulting treated every one of them as
    // "on" unconditionally — the live, unpublished preview could never
    // actually reflect what the school had configured, only what every
    // *published* route (which all correctly call _loadConfig) would.
    // showAttendanceSummary no longer needs forcing to false: the IR's
    // own showAttendance already requires `attendance` to be non-null
    // (it's null here — no attendance fetch in this route), so the real
    // config value is safe to pass straight through.
    const config = await _loadConfig(schoolId);

    // Same subject-name resolution _loadRenderExtras does for a published
    // snapshot — this preview path never had it, so the on-screen "print
    // preview" showed raw subjectIds too.
    const subjectDocs = await tenantModel('subjects', tenantContext(req))
      .find({ schoolId, id: { $in: Object.keys(student.subjects || {}) } })
      .select('id name').lean().catch(() => []);
    const subjectNames = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));

    // Same subject-teacher resolution _loadRenderExtras does for a
    // published snapshot — see classId's own schema comment above for
    // why this needed a new field, not just a new query.
    const assignmentDocs = classId
      ? await tenantModel('teaching_assignments', tenantContext(req))
          .find({ schoolId, classId, subjectId: { $in: Object.keys(student.subjects || {}) } })
          .select('subjectId teacherName').lean().catch(() => [])
      : [];
    const subjectTeacherNames = {};
    for (const a of assignmentDocs) {
      if (!subjectTeacherNames[a.subjectId]) subjectTeacherNames[a.subjectId] = a.teacherName || '';
    }

    // The client's `school` (useAuthStore session data) never carries
    // principalSignatureUrl/schoolStampUrl — those aren't session fields —
    // so without this live lookup, a draft preview could never show the
    // sign-off images even though a published copy of the same report
    // (which snapshots them at publish time) would.
    // Reported directly: school Address/Tagline/Email/Phone/Website/
    // Country never rendered on this preview either — root cause: this
    // route trusted the CLIENT-supplied `school` (the auth session's
    // cached object, built for sidebar/branding use — name/logo/colors
    // only, never the full profile) instead of a live fetch, the same
    // mistake the published PDF/HTML routes don't make. Extended this
    // existing live lookup to the same full field set those use rather
    // than adding a second, separate one.
    const signOffDoc = await _model('schools').findOne({ id: schoolId }, { principalSignatureUrl: 1, schoolStampUrl: 1, principalName: 1, timezone: 1, address: 1, tagline: 1, email: 1, phone: 1, website: 1, country: 1, reportCardWatermarkEnabled: 1, reportCardWatermarkOpacity: 1 }).lean().catch(() => null);
    const schoolWithSignOff = {
      ...school,
      principalSignatureUrl: signOffDoc?.principalSignatureUrl || null,
      schoolStampUrl:        signOffDoc?.schoolStampUrl        || null,
      principalName:         signOffDoc?.principalName         || null,
      timezone:              signOffDoc?.timezone              || null,
      address:                signOffDoc?.address  || school?.address  || '',
      tagline:                signOffDoc?.tagline  || school?.tagline  || '',
      email:                  signOffDoc?.email    || school?.email    || '',
      phone:                  signOffDoc?.phone    || school?.phone    || '',
      website:                signOffDoc?.website  || school?.website  || '',
      country:                signOffDoc?.country  || '',
      // Same per-school watermark controls every other render path uses
      // (see cover.watermarkEnabled/Opacity in _computeReportSections) —
      // the client's own cached `school` session object never carries
      // these, same reasoning as principalSignatureUrl above.
      reportCardWatermarkEnabled: signOffDoc?.reportCardWatermarkEnabled !== false,
      reportCardWatermarkOpacity: signOffDoc?.reportCardWatermarkOpacity ?? 0.07,
    };

    // Same reasoning as the config fix above — subjectTeacherCommentsEnabled
    // lives in assessment_config, not academic_config, so it needs its own
    // live lookup rather than trusting whatever the client happened to send.
    const subjectTeacherCommentsLive = (await _getAssessmentConfig(schoolId, null).catch(() => null))?.subjectTeacherCommentsEnabled;

    // Reported directly: "attendance summary is on but I'm not seeing it
    // on the report card" — this route hard-passed null for attendance
    // unconditionally (every OTHER draft/published path fetches it), so
    // a draft report could never show it before being published, no
    // matter the setting. Same live-fetch pattern as the sign-off/
    // comments lookups above, scoped by the class the toggle already
    // showed (whole-history totals when no specific term is resolvable
    // here — same simplicity level draft behaviour summaries already use).
    const attData = await attendanceSummary(schoolId, student.studentId, classId).catch(() => null);

    const sections = _buildReportSections(snap, config, attData, {
      school: schoolWithSignOff, behaviour: beh ?? null, deviations: studentDeviations ?? null,
      subjectTeacherCommentsEnabled: subjectTeacherCommentsLive !== false,
      subjectNames, subjectTeacherNames,
    });
    // RCE2 — an unpublished draft has no frozen layoutKey of its own, so
    // preview must resolve the LIVE template. It has to resolve it the same
    // way POST /publish does, though: publish calls
    // sectionIdForClass() and passes that section to resolveTemplate()
    // (section default → school default → legacy). This route used to pass
    // null unconditionally, so any school with a section-specific default
    // saw the SCHOOL default while previewing and a different section
    // template once the same report was published — the individual preview
    // and the bulk/parent copies of one report disagreed on structure.
    const previewSectionId = classId ? await sectionIdForClass(schoolId, classId) : null;
    const { layoutKey } = await resolveTemplate(tenantContext(req), schoolId, previewSectionId);
    const html = getLayout(layoutKey).renderHtml(sections);
    return ok(res, { html });
  } catch (err) { console.error('[report-cards/preview-html]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   POST /preview-pdf  — direct-download PDF counterpart to POST
   /preview-html, for a live, unpublished draft. Until this route
   existed, the only way to get a PDF of a report card before it was
   published was the browser's own Print → Save as PDF dialog over
   the HTML preview — workable, but not a one-click download (raised
   directly). Published snapshots already have this via GET /:id/pdf;
   this is its pre-publish twin, sharing the exact same snap/sections
   construction as /preview-html (see that route's own header for why
   it doesn't re-run /generate's aggregation) and the exact same
   PDFKit rendering GET /:id/pdf uses — only the image-URL source
   differs, since a draft has no persisted snapshot to read
   principalSignatureUrl/schoolStampUrl off: those come from the same
   live school lookup (schoolWithSignOff) /preview-html already does.
   ══════════════════════════════════════════════════════════════ */
router.post('/preview-pdf', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { data, error } = _validate(PreviewHtmlSchema, req.body);
    if (error) return E.validation(res, error);
    const { student, studentInfo, classId, className, termNum, academicYear, school, draftComment, studentDeviations, behaviourSummary: beh, config: clientConfig } = data;
    const { schoolId } = req.jwtUser;

    const previewStudentDoc = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: student.studentId }).select('streamId').lean().catch(() => null);
    let previewStreamName = '';
    if (previewStudentDoc?.streamId) {
      const strm = await tenantModel('streams', tenantContext(req))
        .findOne({ schoolId, id: previewStudentDoc.streamId }).select('name').lean().catch(() => null);
      previewStreamName = strm?.name || '';
    }

    const gradingSchema = clientConfig?.gradeScale?.bands ?? [];

    const snap = {
      status: 'draft', superseded: false, version: 1,
      studentId: student.studentId,
      studentName: [studentInfo?.firstName, studentInfo?.lastName].filter(Boolean).join(' ') || student.studentId,
      admissionNo: studentInfo?.admissionNumber || '',
      studentPhotoUrl: studentInfo?.photo || null,
      className: className || '',
      streamName: previewStreamName,
      termNumber: termNum ?? null, academicYear: academicYear || '',
      schoolName: school?.name || '',
      reportLabel: clientConfig?.reportLabel || null,
      gradingSchema,
      assessmentWeights: _convertCustomTypesToWeights(clientConfig?.customTypes ?? []),
      passMark: clientConfig?.passMark, rankingSubjectStrategy: null,
      subjects: student.subjects, totalScore: student.totalScore, averageScore: student.averageScore,
      gpa: student.gpa, subjectCount: student.subjectCount,
      rankings: student.rankings ?? {},
      comments: _resolveSnapComments(null, { ...draftComment, classTeacherName: draftComment?.classTeacherName || student.classTeacherName || '' }),
    };
    const config = await _loadConfig(schoolId);

    const subjectDocs = await tenantModel('subjects', tenantContext(req))
      .find({ schoolId, id: { $in: Object.keys(student.subjects || {}) } })
      .select('id name').lean().catch(() => []);
    const subjectNames = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));

    const assignmentDocs = classId
      ? await tenantModel('teaching_assignments', tenantContext(req))
          .find({ schoolId, classId, subjectId: { $in: Object.keys(student.subjects || {}) } })
          .select('subjectId teacherName').lean().catch(() => [])
      : [];
    const subjectTeacherNames = {};
    for (const a of assignmentDocs) {
      if (!subjectTeacherNames[a.subjectId]) subjectTeacherNames[a.subjectId] = a.teacherName || '';
    }

    const signOffDoc = await _model('schools').findOne({ id: schoolId }, { principalSignatureUrl: 1, schoolStampUrl: 1, principalName: 1, timezone: 1, address: 1, tagline: 1, email: 1, phone: 1, website: 1, country: 1, reportCardWatermarkEnabled: 1, reportCardWatermarkOpacity: 1 }).lean().catch(() => null);
    const schoolWithSignOff = {
      ...school,
      principalSignatureUrl: signOffDoc?.principalSignatureUrl || null,
      schoolStampUrl:        signOffDoc?.schoolStampUrl        || null,
      principalName:         signOffDoc?.principalName         || null,
      timezone:              signOffDoc?.timezone              || null,
      address:                signOffDoc?.address  || school?.address  || '',
      tagline:                signOffDoc?.tagline  || school?.tagline  || '',
      email:                  signOffDoc?.email    || school?.email    || '',
      phone:                  signOffDoc?.phone    || school?.phone    || '',
      website:                signOffDoc?.website  || school?.website  || '',
      country:                signOffDoc?.country  || '',
      // Same per-school watermark controls every other render path uses
      // (see cover.watermarkEnabled/Opacity in _computeReportSections) —
      // the client's own cached `school` session object never carries
      // these, same reasoning as principalSignatureUrl above.
      reportCardWatermarkEnabled: signOffDoc?.reportCardWatermarkEnabled !== false,
      reportCardWatermarkOpacity: signOffDoc?.reportCardWatermarkOpacity ?? 0.07,
    };

    const subjectTeacherCommentsLive = (await _getAssessmentConfig(schoolId, null).catch(() => null))?.subjectTeacherCommentsEnabled;

    const attData = await attendanceSummary(schoolId, student.studentId, classId).catch(() => null);

    const sections = _buildReportSections(snap, config, attData, {
      school: schoolWithSignOff, behaviour: beh ?? null, deviations: studentDeviations ?? null,
      subjectTeacherCommentsEnabled: subjectTeacherCommentsLive !== false,
      subjectNames, subjectTeacherNames,
    });
    const previewSectionId = classId ? await sectionIdForClass(schoolId, classId) : null;
    const { layoutKey } = await resolveTemplate(tenantContext(req), schoolId, previewSectionId);
    snap.layoutKey = layoutKey; // read by _pdfKitFallback's _buildPDFPage if Puppeteer can't run

    // RCE9 — same single HTML+Puppeteer pipeline GET /:id/pdf now uses
    // (see html-to-pdf.js); images are plain <img src="..."> URLs already
    // baked into this HTML, no separate buffer-fetching needed. Falls
    // back to PDFKit if Puppeteer itself can't launch on this host.
    const html = getLayout(layoutKey).renderHtml(sections);
    const pdf  = await htmlToPdfBufferOrFallback(html,
      () => _pdfKitFallback(snap, config, attData, { school: schoolWithSignOff, behaviour: beh ?? null, deviations: studentDeviations ?? null, subjectTeacherCommentsEnabled: subjectTeacherCommentsLive !== false, subjectNames, subjectTeacherNames }, schoolWithSignOff.logoUrl, studentInfo?.photo));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${student.studentId}-draft.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) { console.error('[report-cards/preview-pdf]', err); return E.serverError(res); }
});

/* ── Draft Comments — pre-publish per-student comment store ───
   GET /draft-comments is registered earlier in this file, alongside
   GET /bulk-pdf, ahead of GET /:id (registration-order fix, see the
   comment there) — the PUT routes below have no such conflict (Express
   matches by method+path together, and neither of these path shapes
   collides with any PUT route). */

/* Comments lock the same way marks do (2026-10-18, direct request) — a
   DIFFERENT axis from the commentLockState removed 2026-10-11 (see
   comment-scope.js's header): that one blocked a comment write based on
   that SAME subject's marks-submission state, pre-publish, and was
   removed because a teacher must be free to write the comment and
   submit marks in either order. This one blocks a draft write only once
   the STUDENT'S REPORT FOR THIS TERM HAS BEEN PUBLISHED — mirroring
   POST /marks' "this mark is locked, ask an admin to unlock it" guard,
   not reviving the old per-subject gate. The draft doc itself is never
   locked/unlocked directly: it tracks whichever published snapshot (if
   any) exists for this studentId+termNumber, the same way assessment_
   marks.isLocked tracks its own schedule/submission state rather than
   storing a second copy of the decision. */
async function _publishedCommentsLockFor(schoolId, ctx, studentId, termNumber) {
  const snap = await tenantModel('report_card_snapshots', ctx)
    .findOne({ schoolId, studentId, termNumber: Number(termNumber), superseded: { $ne: true }, commentsLocked: true })
    .select('id').lean();
  return !!snap;
}

// PUT /draft-comments/:studentId — upsert comment record for a student
// subjectComments: { [subjectId]: string } — merged per-key (each teacher only touches their own subject)
router.put('/draft-comments/:studentId', authMiddleware, PLAN, MODGATE, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId: updatedBy } = req.jwtUser;
    const { studentId } = req.params;
    if (!req.body?.termNumber) return E.badRequest(res, 'termNumber is required');
    const { data: validated, error: validationError } = _validate(DraftCommentBodySchema, req.body);
    if (validationError) return E.validation(res, validationError);
    const { termNumber, classTeacherName, classTeacherRemark,
            sportsAndTalent, principalName, principalRemark, closingDate, nextTermBegin,
            subjectComments, observationRatings } = validated;

    if (await _publishedCommentsLockFor(schoolId, tenantContext(req), studentId, termNumber)) {
      return E.forbidden(res, 'Comments are locked — the report card for this term has been published. Ask an admin to unlock it for a correction.');
    }

    // Subject comments are saved one subject at a time (PUT .../subject/:subjectId),
    // so each save is checked against exactly the caller's own subject. Accepting a
    // whole map here meant one unassigned key refused everything else in the save.
    if (subjectComments !== undefined) {
      return E.badRequest(res, 'Subject comments are saved per subject — use PUT /draft-comments/:studentId/subject/:subjectId');
    }

    // Class-teacher remark and principal remark have their own rights (comment-scope.js).
    // A field the caller may not change is refused only when the submitted value differs
    // from what is stored, so echoing unchanged fields back still succeeds.
    const placement = await studentPlacement(req, studentId);
    if (!placement) return E.notFound(res, 'Student not found');
    // classId is always resolved server-side from the student's current
    // placement, never trusted from the request body — this route used to
    // take a client-supplied classId while PUT .../subject/:subjectId
    // (below) already resolved it this way. The two could disagree (e.g.
    // a stale client-side class list, or a student moved classes between
    // the two saves), silently flipping the stored classId on their
    // shared draft doc to a value that no longer matched what the
    // Markbook's classId-filtered GET was asking for — making the whole
    // draft (comments included) invisible there even though it was still
    // in the database. Same fix needs no client change: the body never
    // needed to send classId correctly in the first place.
    const classId = placement.classId;
    const existing = await tenantModel('report_card_draft_comments', tenantContext(req))
      .findOne({ schoolId, studentId, termNumber: Number(termNumber) }).lean();

    // Reported directly (2026-10-15), traced to a real, silent data-loss
    // path: GET /draft-comments (scopeDraftCommentsForCaller) strips this
    // ENTIRE doc down to only `subjectComments` for any caller who isn't
    // the stream's form teacher or management — classTeacherName/Remark,
    // sportsAndTalent, closingDate, nextTermBegin, and observationRatings
    // are all OMITTED from their response. The client's local state then
    // has to default those missing fields to '' — and until now, ONLY
    // classTeacherRemark and principalRemark were guarded against being
    // written when changed: every other class-teacher-tier field here
    // was written unconditionally on every save, by anyone holding the
    // coarse report_cards:update permission (effectively any teacher),
    // with no check that the value actually changed OR that the caller
    // was allowed to change it. A subject-only teacher who never loaded
    // the real sportsAndTalent/closingDate/etc values, then saved the
    // bulk comment form for ANY reason (e.g. after writing their own
    // subject comment), would silently blank out already-entered data —
    // no error, no block, just overwritten with ''. Fixed by extending
    // the exact same guard already correct for classTeacherRemark to
    // every class-teacher-tier field, and the same for principalRemark's
    // admin-only guard to principalName.
    const classTeacherFieldsChanged =
      (classTeacherName   !== undefined && (classTeacherName   ?? '') !== (existing?.classTeacherName   ?? '')) ||
      (classTeacherRemark !== undefined && (classTeacherRemark ?? '') !== (existing?.classTeacherRemark ?? '')) ||
      (sportsAndTalent    !== undefined && (sportsAndTalent    ?? '') !== (existing?.sportsAndTalent    ?? '')) ||
      (closingDate        !== undefined && (closingDate        ?? '') !== (existing?.closingDate        ?? '')) ||
      (nextTermBegin      !== undefined && (nextTermBegin      ?? '') !== (existing?.nextTermBegin      ?? '')) ||
      (observationRatings !== undefined && JSON.stringify(observationRatings ?? {}) !== JSON.stringify(existing?.observationRatings ?? {}));
    if (classTeacherFieldsChanged && !(await canWriteClassRemark(req, placement.streamId))) {
      return E.forbidden(res, "Only this stream's form teacher can write the class teacher's report fields.");
    }

    const principalFieldsChanged =
      (principalName   !== undefined && (principalName   ?? '') !== (existing?.principalName   ?? '')) ||
      (principalRemark !== undefined && (principalRemark ?? '') !== (existing?.principalRemark ?? ''));
    if (principalFieldsChanged && !['admin', 'superadmin'].includes(req.jwtUser.role)) {
      return E.forbidden(res, 'Only admins can set the principal fields');
    }

    // Class-teacher observation ratings — validated against THIS school's
    // own configured category list (Settings → Report Cards → General),
    // not a hardcoded set, since a school can rename/add/remove categories.
    if (observationRatings !== undefined) {
      if (typeof observationRatings !== 'object' || observationRatings === null || Array.isArray(observationRatings)) {
        return E.badRequest(res, 'observationRatings must be an object of { category: rating }');
      }
      const cfg = await _loadConfig(schoolId);
      const validCategories = new Set(cfg.observationCategories || []);
      for (const [category, rating] of Object.entries(observationRatings)) {
        if (!validCategories.has(category)) {
          return E.badRequest(res, `"${category}" is not a configured observation category for this school.`);
        }
        if (!OBSERVATION_RATING_VALUES.includes(rating)) {
          return E.badRequest(res, `Invalid rating "${rating}" for "${category}" — must be one of: ${OBSERVATION_RATING_VALUES.join(', ')}.`);
        }
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
    if (observationRatings !== undefined) setFields.observationRatings = observationRatings;

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
    const { termNumber, comment } = req.body;
    if (!termNumber) return E.badRequest(res, 'termNumber is required');
    if (typeof comment !== 'string') return E.badRequest(res, 'comment must be a string');
    if (comment.length > 1000) return E.badRequest(res, 'comment must be 1000 characters or fewer');

    // Same rights as marks: the caller must teach this subject in this student's stream.
    // Class and stream come from the student record, never from the request body.
    const placement = await studentPlacement(req, studentId);
    if (!placement || !placement.classId) return E.notFound(res, 'Student not found');
    const classId = placement.classId;
    if (req.body.classId && req.body.classId !== classId) return E.badRequest(res, 'classId does not match this student');

    // Kindergarten/competency-band classes don't use subject-level
    // comments at all (decided 2026-10-13) — _computeKgReportSections
    // only ever reads comments.classTeacherRemark/principalRemark, never
    // subjectComments, so a write here would just be invisible, orphaned
    // data. No UI exposes this for a KG class either way (IndicatorMarkbook.jsx
    // has no comment field; KgStudentReportCard.jsx only renders the two
    // report-level remarks) — this is a server-side guard for consistency,
    // not a behavior change to anything a user could previously see.
    if (await resolveRcTemplate(schoolId, classId)) {
      return E.forbidden(res, "This is a Kindergarten class — it doesn't use per-subject comments. Only the class teacher's remark applies.");
    }

    // Guard: curriculum integrity — same bug class as assessment.js's
    // /marks (reported directly against the ordinary Markbook): a
    // comment must name a subject that's actually in this class's
    // curriculum, for every role including management.
    if (!(await isInCurriculum(req, classId, subjectId))) {
      return E.badRequest(res, 'This subject is not part of this class\'s curriculum.');
    }

    if (await isElective(req, classId, subjectId)) {
      if (!(await canTeachElective(req, classId, subjectId))) {
        return E.forbidden(res, 'You are not assigned to teach this elective in this class.');
      }
      const enrolled = await enrolledStudentIds(req, subjectId);
      if (!enrolled.has(studentId)) return E.forbidden(res, 'This student is not enrolled in this elective.');
    } else if (!(await canWriteSubject(req, classId, subjectId, placement.streamId))) {
      return E.forbidden(res, 'You are not assigned to teach this subject in this class.');
    }

    // No lock tied to marks status, submission state, or the assessment-
    // schedule lock any more (2026-10-11) — see comment-scope.js's header.
    // The DIFFERENT, publish-based lock added 2026-10-18 still applies
    // here (see _publishedCommentsLockFor above).
    if (await _publishedCommentsLockFor(schoolId, tenantContext(req), studentId, termNumber)) {
      return E.forbidden(res, 'Comments are locked — the report card for this term has been published. Ask an admin to unlock it for a correction.');
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

    if (await _publishedCommentsLockFor(schoolId, ctx, studentId, termNumber)) {
      return E.forbidden(res, 'Comments are locked — the report card for this term has been published. Ask an admin to unlock it for a correction.');
    }

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
router._fetchImageBuf = _fetchImageBuf;
router._buildPDFPage = _buildPDFPage;
router._pdfKitFallback = _pdfKitFallback;
router._loadRenderExtras = _loadRenderExtras;
router._resolveDisplayNames = _resolveDisplayNames;
router._computeReportSections = _computeReportSections;
router._computeKgReportSections = _computeKgReportSections;
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
router._lockSubmissionCombos = _lockSubmissionCombos;
router._publishedCommentsLockFor = _publishedCommentsLockFor;
router._autoRelockComments = _autoRelockComments;

module.exports = router;
