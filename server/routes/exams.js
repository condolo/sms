/* ============================================================
   Msingi — /api/exams  (Exam Scheduling + Results)
   Sub-routes:
     /api/exams              — exam definitions
     /api/exams/:id/results  — results for one exam
     /api/exams/results      — query all results (cross-exam)
   Plan: standard | RBAC: exams:{read,create,update,delete}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const { isYearArchived } = require('../utils/archival');
const { getConfig: _getAssessmentConfig } = require('./assessment');
const { mergeConfig, resolveGrade } = require('./academic-config');
const { _model } = require('../utils/model');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const email = require('../utils/email');

const router = express.Router();
const PLAN   = planGate('exams');
const MODGATE = moduleGate('grades');

/* ── Helpers ────────────────────────────────────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** Convert raw score to grade/percentage via the school's live grading
 *  scale — grade_boundaries' default scale, falling back to
 *  academic_config.gradingSchema (same resolution order assessment.js's
 *  GET /report and report-cards.js use — resolveGrade() is the single
 *  shared band-lookup, never duplicated per-route). Previously this read
 *  a per-exam `exam.gradeScale` field that no route ever set, so grade/
 *  percentage were silently null on every exam result ever entered. */
function _calcGrade(score, maxScore, gradingSchema) {
  if (!maxScore || maxScore === 0) return null;
  const pct = _round((score / maxScore) * 100);
  const { grade, points } = resolveGrade(pct, gradingSchema);
  return { percentage: pct, grade, points };
}

/* ── Validation ─────────────────────────────────────────────── */
/* ── Exam status state machine ──────────────────────────────────
   Allowed transitions (server enforces — clients cannot skip states):
     scheduled    → in_progress | cancelled
     in_progress  → completed   | cancelled
     completed    → moderated   | locked     (admin only)
     moderated    → approved    | completed  (admin can reopen)
     approved     → locked                   (admin only)
     locked       → published   | approved   (unlock = back to approved)
     published    → archived
   ─────────────────────────────────────────────────────────────── */
const EXAM_TRANSITIONS = {
  scheduled:   ['in_progress', 'cancelled'],
  in_progress: ['completed',   'cancelled'],
  completed:   ['moderated',   'locked'],
  moderated:   ['approved',    'completed'],
  approved:    ['locked'],
  locked:      ['published',   'approved'],   // 'approved' = unlock
  published:   ['archived'],
  archived:    [],
  cancelled:   [],
};

/* Roles allowed to drive each transition.
   2026-09 Exams Officer fix: this list previously excluded 'exams_officer'
   from EVERY entry, despite that role holding full exams:RCUD
   (server/utils/repairPermissions.js) — an Exams Officer could create exams
   and enter marks but could not move a single exam through its own
   lifecycle, not even Start Exam. Added here for every transition except
   'locked' and 'approved', which are handled separately in _checkTransition
   below (see the comment there for why 'approved' can't just be added to
   this list too — it's ambiguous between the Approve and Unlock actions). */
const TRANSITION_ROLES = {
  in_progress: ['teacher', 'exams_officer', 'admin', 'superadmin'],
  completed:   ['teacher', 'exams_officer', 'admin', 'superadmin'],
  cancelled:   ['exams_officer', 'admin', 'superadmin'],
  moderated:   ['exams_officer', 'admin', 'superadmin'],
  approved:    ['exams_officer', 'admin', 'superadmin'],  // this list only ever governs moderated->approved (ordinary Approve) — locked->approved (unlock) is caught by its own earlier, stricter branch in _checkTransition before this list is even consulted
  locked:      ['admin', 'superadmin'],  // see _checkTransition — the real floor is the admin/superadmin-or-explicit-grant check there, not this list
  published:   ['exams_officer', 'admin', 'superadmin'],
  archived:    ['exams_officer', 'admin', 'superadmin'],
};

/* Mark states — distinct from absent boolean for backward compat */
const MARK_STATES = ['present', 'ABS', 'MIS', 'EXM', 'INC'];
// present = has a valid score
// ABS     = absent (not treated as zero — excluded from averages unless school config says otherwise)
// MIS     = missing mark — teacher has not entered score yet (flags for action)
// EXM     = exempted — excluded from averaging entirely
// INC     = incomplete — blocks report approval until resolved

const ExamSchema = z.object({
  title:          z.string().min(1).max(200).trim(),
  subjectId:      z.string().optional(),
  classId:        z.string().optional(),
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  type:           z.enum(['test', 'mock', 'terminal', 'internal', 'external', 'coursework']).default('test'),
  date:           z.string().optional(),
  startTime:      z.string().optional(),
  duration:       z.number().int().min(1).optional(),    // minutes
  maxScore:       z.number().positive(),
  passMark:       z.number().min(0).optional(),
  room:           z.string().max(100).optional(),
  invigilatorId:  z.string().optional(),
  instructions:   z.string().max(1000).optional(),
  // Extended status — old values (scheduled/in_progress/completed/cancelled) still valid
  status: z.enum([
    'scheduled', 'in_progress', 'completed', 'cancelled',
    'moderated', 'approved', 'locked', 'published', 'archived'
  ]).default('scheduled'),
  // Teacher-subject ownership (set when creating — used for validation)
  ownerId:       z.string().optional(),   // userId of subject teacher who owns this exam
  // weightPercent/assessmentLabel are client-supplied hints only — _resolveAssessmentType()
  // overwrites both from the school's canonical assessment_config.customTypes before saving,
  // so they can never drift from what Configuration shows.
  weightPercent: z.number().min(0).max(100).optional(),  // how much this exam contributes to term grade
  // Assessment type linkage — key into assessment_config.customTypes (server/routes/assessment.js)
  assessmentType:  z.string().max(50).optional(),   // customTypes[].key, e.g. 'MT', 'ET', 'CA'
  assessmentLabel: z.string().max(100).optional(),  // display label, e.g. 'Mid-Term Exam', 'CA 1'
  termLabel:       z.string().max(100).optional(),  // denormalized term name, e.g. 'Term 1'
  subjectName:     z.string().max(100).optional(),  // denormalized subject name for quick display
  // Phase 4 — teacher sitting announcement fields
  scheduleEntryId:         z.string().optional(),           // linked assessment_schedule entry id
  endTime:                 z.string().optional(),           // HH:MM end time
  topics:                  z.string().max(500).optional(),  // topics / what to expect
  subjectTeacherAnnounced: z.boolean().optional(),          // true when created by subject teacher
});

const ResultSchema = z.object({
  studentId:  z.string().min(1),
  score:      z.number().min(0).optional(),  // optional — absent/missing/exempted have no score
  // markState replaces absent:boolean — backward-compat: absent:true → ABS, absent:false → present
  markState:  z.enum(MARK_STATES).default('present'),
  absent:     z.boolean().default(false),    // kept for backward compat — derived from markState
  notes:      z.string().max(500).optional(),
  gradedBy:   z.string().optional(),         // overridden by JWT
  // Audit: who entered/changed this result
  actingAs:   z.string().optional(),         // if admin acting as teacher: teacherId
  // Optimistic concurrency — the _v the client last read for this result.
  // Omit to skip the check (backward compatible with clients that don't send it).
  _v:         z.number().int().min(0).optional(),
});

const BulkResultSchema = z.object({
  results: z.array(ResultSchema).min(1).max(500),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/**
 * Resolve assessmentType against the school's canonical assessment_config.customTypes
 * and overwrite weightPercent/assessmentLabel with the configured values — so an exam's
 * stored weight can never diverge from what Configuration shows, regardless of what a
 * (possibly stale) client sends. Returns an error string if assessmentType is set but
 * doesn't match any configured type; returns null (no-op) if assessmentType is absent.
 */
async function _resolveAssessmentType(schoolId, data) {
  if (!data.assessmentType) return null;
  const cfg   = await _getAssessmentConfig(schoolId, null);
  const match = (cfg.customTypes || []).find(t => t.key === data.assessmentType);
  if (!match) {
    const valid = (cfg.customTypes || []).map(t => t.key).join(', ');
    return `Unknown assessment type "${data.assessmentType}" — must be one of: ${valid}`;
  }
  data.assessmentLabel = match.label || match.key;
  data.weightPercent   = match.weight ?? 0;
  return null;
}

/**
 * Validate exam status transition — returns error string or null.
 *
 * 2026-09 Exams Officer fix — `grants` carries PRE-RESOLVED
 * hasExplicitSubGrant() booleans for 'lock'/'unlock' (the caller resolves
 * these async, before calling this function, so this stays a plain
 * synchronous function — matching the Permission Granularity Plan's §4a
 * "Option A" note that this was achievable without making _checkTransition
 * itself async). Two targets are handled OUTSIDE the plain TRANSITION_ROLES
 * list because a flat toStatus-keyed list can't express what they actually
 * need:
 *   - toStatus === 'locked': must require the admin/superadmin floor OR an
 *     explicit exams.lock grant — exactly what POST /:id/lock already
 *     enforces. Before this fix, POST /:id/lock computed that grant check
 *     correctly but then called this function unchanged, which re-rejected
 *     a legitimately-granted non-floor caller anyway (the grant check was
 *     real but silently overridden one line later) — the tracked-open item
 *     from the Permission Granularity Plan's §4a. Fixed by having both
 *     call sites pass their already-computed grant through.
 *   - fromStatus 'locked' -> toStatus 'approved' IS the unlock transition
 *     (this state machine reuses the 'approved' status for both "reviewed
 *     and signed off" and "unlocked"). It needs the SAME floor-or-grant
 *     check as POST /:id/unlock. The much more common 'moderated' ->
 *     'approved' transition (the ordinary post-moderation Approve action)
 *     is a different, less sensitive action that happens to share the same
 *     target status — it stays governed by TRANSITION_ROLES like every
 *     other transition, now including exams_officer. Blanket-adding
 *     exams_officer to TRANSITION_ROLES.approved instead of handling this
 *     split would have silently also granted them (and anyone else on that
 *     list) the unlock transition via PUT /:id, bypassing the explicit
 *     exams.lock/exams.unlock grant system entirely.
 */
function _checkTransition(fromStatus, toStatus, userRole, grants = {}) {
  const allowed = EXAM_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return `Cannot transition from "${fromStatus}" to "${toStatus}". Allowed next states: [${allowed.join(', ')}]`;
  }
  const isFloorRole = ['admin', 'superadmin'].includes(userRole);
  if (toStatus === 'locked') {
    if (isFloorRole || grants.lock) return null;
    return `Your role ("${userRole}") cannot set status to "locked" — ask your admin to grant exams.lock in Settings, or use an admin/superadmin account`;
  }
  if (fromStatus === 'locked' && toStatus === 'approved') {
    if (isFloorRole || grants.unlock) return null;
    return `Your role ("${userRole}") cannot unlock this exam — ask your admin to grant exams.unlock in Settings, or use an admin/superadmin account`;
  }
  const roleOk = TRANSITION_ROLES[toStatus] || [];
  if (roleOk.length && !roleOk.includes(userRole)) {
    return `Your role ("${userRole}") cannot set status to "${toStatus}"`;
  }
  return null;
}

/** Resolve markState + absent for backward compat.
 *  If markState is given, derive absent from it.
 *  If only absent is given, derive markState from it. */
function _resolveMarkState(data) {
  if (data.markState && data.markState !== 'present') {
    return { markState: data.markState, absent: data.markState === 'ABS', score: null };
  }
  if (data.absent === true && (!data.markState || data.markState === 'present')) {
    return { markState: 'ABS', absent: true, score: null };
  }
  return { markState: 'present', absent: false, score: data.score ?? null };
}

/* ══════════════════════════════════════════════════════════════
   EXAMS
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   TEACHER SITTING ANNOUNCEMENT  —  POST /api/exams/announce
   Dedicated endpoint for subject teachers to announce a specific
   exam sitting within an admin-defined schedule window.
   No exams.create RBAC needed — teacher role itself is the gate.
   ══════════════════════════════════════════════════════════════ */

const AnnounceSittingSchema = z.object({
  classId:         z.string().min(1),
  subjectId:       z.string().min(1),
  scheduleEntryId: z.string().min(1),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  startTime:       z.string().optional(),
  endTime:         z.string().optional(),
  maxScore:        z.number().positive(),
  topics:          z.string().max(500).optional(),
  academicYearId:  z.string().optional(),
  termId:          z.string().optional(),
  termLabel:       z.string().optional(),
});

router.post('/announce', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: teacher-only (inline role check)
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (role !== 'teacher') {
      return E.forbidden(res, 'Only teachers can use the announce sitting endpoint');
    }

    const parsed = AnnounceSittingSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }
    const d = parsed.data;

    // Validate teacher owns this class + subject
    const assignment = await tenantModel('teaching_assignments', tenantContext(req)).findOne({
      schoolId, teacherId: userId, classId: d.classId, subjectId: d.subjectId,
    }).lean();
    if (!assignment) {
      return E.forbidden(res, 'You are not assigned to teach this subject in this class.');
    }

    // Validate schedule entry exists and is not locked
    const schedEntry = await tenantModel('assessment_schedule', tenantContext(req)).findOne({
      id: d.scheduleEntryId, schoolId,
    }).lean();
    if (!schedEntry) return E.notFound(res, 'Schedule entry not found');
    if (schedEntry.isLocked) {
      return E.forbidden(res, 'This assessment window has been locked by admin. New sittings cannot be announced.');
    }

    // Validate date is within the schedule window
    if (d.date < schedEntry.dateFrom || d.date > schedEntry.dateTo) {
      return E.badRequest(res, `Exam date must be within the schedule window: ${schedEntry.dateFrom} to ${schedEntry.dateTo}.`);
    }

    // Enrich with denormalized names for quick display
    const [subject, cls] = await Promise.all([
      tenantModel('subjects', tenantContext(req)).findOne({ id: d.subjectId, schoolId }).select('name').lean(),
      tenantModel('classes', tenantContext(req)).findOne({ id: d.classId, schoolId }).select('name').lean(),
    ]);

    const title = `${subject?.name ?? d.subjectId} — ${schedEntry.label || schedEntry.assessmentType}`;

    const doc = await tenantModel('exams', tenantContext(req)).create({
      id:                      uuidv4(),
      schoolId,
      classId:                 d.classId,
      subjectId:               d.subjectId,
      subjectName:             subject?.name ?? null,
      className:               cls?.name ?? null,
      academicYearId:          d.academicYearId ?? null,
      termId:                  d.termId ?? null,
      termLabel:               d.termLabel ?? null,
      scheduleEntryId:         d.scheduleEntryId,
      assessmentType:          schedEntry.assessmentType,
      assessmentLabel:         schedEntry.label || schedEntry.assessmentType,
      title,
      date:                    d.date,
      startTime:               d.startTime ?? null,
      endTime:                 d.endTime ?? null,
      maxScore:                d.maxScore,
      topics:                  d.topics ?? null,
      status:                  'scheduled',
      ownerId:                 userId,
      subjectTeacherAnnounced: true,
      createdBy:               userId,
      updatedBy:               userId,
    });

    console.log(`[EXAMS] Teacher ${userId} announced sitting: ${title} on ${d.date}`);
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[exams/announce POST]', err);
    return E.serverError(res);
  }
});

router.get('/', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _cid = strParam(req.query.classId);
    const _sub = strParam(req.query.subjectId);
    const _tid = strParam(req.query.termId);
    const _ay  = strParam(req.query.academicYearId);
    const _typ = strParam(req.query.type);
    const _st  = strParam(req.query.status);
    if (_cid) filter.classId        = _cid;
    if (_sub) filter.subjectId      = _sub;
    if (_tid) filter.termId         = _tid;
    if (_ay)  filter.academicYearId = _ay;
    if (_typ) filter.type           = _typ;
    if (_st)  filter.status         = _st;

    const _at = strParam(req.query.assessmentType);
    const _tl = strParam(req.query.termLabel);
    if (_at) filter.assessmentType = _at;
    if (_tl) filter.termLabel      = _tl;

    const _df = strParam(req.query.dateFrom);
    const _dt = strParam(req.query.dateTo);
    if (_df || _dt) {
      filter.date = {};
      if (_df) filter.date.$gte = _df;
      if (_dt) filter.date.$lte = _dt;
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.title = rx;
    }

    const Exams = tenantModel('exams', tenantContext(req));
    const [docs, total] = await Promise.all([
      Exams.find(filter).sort({ date: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Exams.countDocuments(filter)
    ]);

    // Enrich with subject names and class names via FK lookup
    const subjectIds = [...new Set(docs.map(d => d.subjectId).filter(Boolean))];
    const classIds   = [...new Set(docs.map(d => d.classId).filter(Boolean))];
    const [subjectDocs, classDocs] = await Promise.all([
      subjectIds.length ? tenantModel('subjects', tenantContext(req)).find({ id: { $in: subjectIds }, schoolId }).select('id name').lean() : Promise.resolve([]),
      classIds.length   ? tenantModel('classes', tenantContext(req)).find({ id: { $in: classIds }, schoolId }).select('id name').lean()   : Promise.resolve([]),
    ]);
    const subjectMap = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));
    const classMap   = Object.fromEntries(classDocs.map(c => [c.id, c.name]));
    const enriched   = docs.map(d => ({
      ...d,
      subjectName: d.subjectId ? (subjectMap[d.subjectId] ?? d.subjectName ?? null) : (d.subjectName ?? null),
      className:   d.classId   ? (classMap[d.classId]     ?? d.className   ?? null) : (d.className   ?? null),
    }));

    return ok(res, enriched, paginate(page, limit, total));
  } catch (err) { console.error('[exams GET]', err); return E.serverError(res); }
});

router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Exam not found');
    return ok(res, doc);
  } catch (err) { console.error('[exams GET/:id]', err); return E.serverError(res); }
});

/* subjectId/classId are free-text FK strings on ExamSchema (no Mongoose
   ref) — a typo or stale id would silently create an exam that never
   matches any aggregateExamResults()/report-cards.js filter, with no
   error at write time. Checked here, not in the schema, since both
   fields stay optional (an exam can legitimately be created before its
   subject/class is finalised). */
async function _checkExamFKs(schoolId, ctx, { subjectId, classId }) {
  if (subjectId) {
    const exists = await tenantModel('subjects', ctx).findOne({ id: subjectId, schoolId }).select('id').lean();
    if (!exists) return `subjectId "${subjectId}" does not match any subject for this school`;
  }
  if (classId) {
    const exists = await tenantModel('classes', ctx).findOne({ id: classId, schoolId }).select('id').lean();
    if (!exists) return `classId "${classId}" does not match any class for this school`;
  }
  return null;
}

router.post('/', authMiddleware, PLAN, MODGATE, rbac('exams', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ExamSchema, req.body);
    if (error) return E.validation(res, error);

    const ctx = tenantContext(req);
    const fkError = await _checkExamFKs(schoolId, ctx, data);
    if (fkError) return E.badRequest(res, fkError);

    const typeError = await _resolveAssessmentType(schoolId, data);
    if (typeError) return E.badRequest(res, typeError);

    const doc = await tenantModel('exams', ctx).create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[exams POST]', err); return E.serverError(res); }
});

router.put('/:id', authMiddleware, PLAN, MODGATE, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(ExamSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const fkError = await _checkExamFKs(schoolId, tenantContext(req), data);
    if (fkError) return E.badRequest(res, fkError);

    const typeError = await _resolveAssessmentType(schoolId, data);
    if (typeError) return E.badRequest(res, typeError);

    const existing = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Exam not found');

    // Block edits to locked/published/archived exams (except by admin via unlock flow)
    if (['locked', 'published', 'archived'].includes(existing.status) && !data.status) {
      return E.badRequest(res, `Exam is "${existing.status}" — use the unlock endpoint to allow edits`);
    }

    // Validate status transition if status is being changed
    if (data.status && data.status !== existing.status) {
      // Only resolve the exams.lock/exams.unlock grants when this transition
      // could actually need them (into 'locked', or 'locked'->'approved' i.e.
      // unlock) — an extra DB read on every other status change (Start Exam,
      // Mark Completed, Moderate, Approve, Publish, Archive) would be waste.
      // This is what closes the previously tracked-open gap: PUT /:id now
      // respects the same Settings-granted exams.lock/exams.unlock as the
      // dedicated endpoints, instead of being blind to them (see
      // _checkTransition's own comment for the full reasoning).
      const grants = {};
      if (data.status === 'locked') {
        grants.lock = await hasExplicitSubGrant(req, 'exams', 'lock', 'update');
      } else if (existing.status === 'locked' && data.status === 'approved') {
        grants.unlock = await hasExplicitSubGrant(req, 'exams', 'unlock', 'update');
      }
      const transitionError = _checkTransition(existing.status, data.status, role, grants);
      if (transitionError) return E.badRequest(res, transitionError);

      // Log the transition in audit
      data.statusChangedBy = userId;
      data.statusChangedAt = new Date().toISOString();
      data.statusHistory   = [
        ...(existing.statusHistory || []),
        { from: existing.status, to: data.status, by: userId, at: new Date().toISOString(), reason: req.body.reason || '' }
      ];
    }

    const doc = await tenantModel('exams', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();

    if (data.status === 'published' && existing.status !== 'published') {
      _notifyExamResultsPublished(req, doc).catch(err => console.error('[exams/:id notify]', err));
    }

    return ok(res, doc);
  } catch (err) { console.error('[exams PUT/:id]', err); return E.serverError(res); }
});

/* Notify each student's parent(s)/guardian(s) that this exam's results were
   published — school-configured channel + frequency, same shared mechanism
   as behaviour_incident/report_published. One dispatch per student sitting
   the exam, resolved from exam_results (the exam doc itself has no student
   list). */
async function _notifyExamResultsPublished(req, exam) {
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);

  const [results, school] = await Promise.all([
    tenantModel('exam_results', ctx).find({ schoolId, examId: exam.id }).select('studentId').lean(),
    _model('schools').findOne({ id: schoolId }).select('name systemEmail').lean(),
  ]);
  const studentIds = [...new Set(results.map(r => r.studentId).filter(Boolean))];
  if (!studentIds.length) return;

  const students = await tenantModel('students', ctx).find({ id: { $in: studentIds } }).select('id firstName lastName').lean();
  const nameById = Object.fromEntries(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
  const schoolName  = school?.name || '';
  const schoolEmail = school?.systemEmail || '';

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'exam_results',
    items: studentIds.map(studentId => {
      const studentName = nameById[studentId] || studentId;
      return {
        studentId,
        inAppSubject: `Exam results published for ${studentName}`,
        inAppBody:    `Results for "${exam.title || 'the exam'}" are now available for ${studentName}.`,
        emailDigestSubject: `Exam results published — ${studentName}`,
        emailDigestBody:    `Results for "${exam.title || 'the exam'}" are now available.`,
        sendEmail: (recipient) => email.sendExamResultsAlert({
          recipientName: recipient.name, recipientEmail: recipient.email,
          studentName, examName: exam.title || 'Exam',
          schoolName, schoolEmail, schoolId,
        }),
      };
    }),
  });
}

router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('exams', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await tenantModel('exams', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'cancelled', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Exam not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[exams DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   EXAM STATUS MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

/** POST /api/exams/:id/lock — admin locks an exam (approved → locked) */
router.post('/:id/lock', authMiddleware, PLAN, MODGATE, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    // Permission Granularity Plan 2026-09, Priority 0 — Option A, completed
    // 2026-09-05. The admin/superadmin floor stays (never weakened); a
    // school can additionally grant exams.lock via Settings. Uses
    // hasExplicitSubGrant (no coarse-grant fallback), same reasoning as
    // report_generate/mark_submissions: falling back to plain exams:update
    // would hand lock authority to anyone who can merely create/edit exams.
    //
    // BUG FIXED HERE (was the tracked-open item from the Plan §4a): this
    // grant check was computed correctly but then _checkTransition() below
    // was called WITHOUT it, so it re-rejected the very caller this check
    // had just approved — TRANSITION_ROLES.locked never included anyone but
    // admin/superadmin, so an explicitly-granted Exams Officer got PAST this
    // check only to be silently blocked one line later. _checkTransition now
    // takes this same boolean and honours it — no other behavior here
    // changed (the floor is still never weakened, and this is still the
    // only place a plain exams:update grant is insufficient on its own).
    const isFloorRole = ['admin', 'superadmin'].includes(role);
    const hasLockGrant = await hasExplicitSubGrant(req, 'exams', 'lock', 'update');
    if (!isFloorRole && !hasLockGrant) {
      return E.forbidden(res, 'Only admins, superadmins, or explicitly granted staff can lock exams');
    }

    const exam = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    const transitionError = _checkTransition(exam.status, 'locked', role, { lock: hasLockGrant });
    if (transitionError) return E.badRequest(res, transitionError);

    const now = new Date().toISOString();
    const doc = await tenantModel('exams', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        status: 'locked', lockedBy: userId, lockedAt: now, updatedBy: userId,
        $push: { statusHistory: { from: exam.status, to: 'locked', by: userId, at: now, reason: req.body.reason || 'Admin locked' } }
      },
      { new: true }
    ).lean();

    console.log(`[EXAMS] Locked exam "${exam.title}" by ${userId}`);
    return ok(res, doc);
  } catch (err) { console.error('[exams/:id/lock]', err); return E.serverError(res); }
});

/** POST /api/exams/:id/unlock — admin unlocks (locked → approved) with mandatory reason */
router.post('/:id/unlock', authMiddleware, PLAN, MODGATE, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    // Same design as /lock above, using the separate exams.unlock grant —
    // deliberately independent (a role granted lock is not automatically
    // granted unlock, and vice versa; see the Plan §4a for why these are
    // two rows, not one).
    const isFloorRole = ['admin', 'superadmin'].includes(role);
    if (!isFloorRole && !(await hasExplicitSubGrant(req, 'exams', 'unlock', 'update'))) {
      return E.forbidden(res, 'Only admins, superadmins, or explicitly granted staff can unlock exams');
    }

    const reason = (req.body.reason || '').trim();
    if (!reason) return E.badRequest(res, 'A reason is required when unlocking an exam');

    const exam = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');
    if (exam.status !== 'locked') return E.badRequest(res, `Exam is "${exam.status}" — only locked exams can be unlocked`);

    const now = new Date().toISOString();
    const doc = await tenantModel('exams', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        status: 'approved', unlockedBy: userId, unlockedAt: now, unlockReason: reason, updatedBy: userId,
        $push: { statusHistory: { from: 'locked', to: 'approved', by: userId, at: now, reason } }
      },
      { new: true }
    ).lean();

    // Write to audit log
    await tenantModel('mark_audit_log', tenantContext(req)).create({
      action: 'EXAM_UNLOCKED', examId: req.params.id, schoolId,
      editedBy: userId, reason, timestamp: now
    });

    console.log(`[EXAMS] Unlocked exam "${exam.title}" by ${userId}: ${reason}`);
    return ok(res, doc);
  } catch (err) { console.error('[exams/:id/unlock]', err); return E.serverError(res); }
});

/** GET /api/exams/:id/status-history — audit trail of status changes */
router.get('/:id/status-history', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const exam = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');
    return ok(res, { examId: req.params.id, title: exam.title, currentStatus: exam.status, history: exam.statusHistory || [] });
  } catch (err) { console.error('[exams/:id/status-history]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   RESULTS  (scoped to one exam, or cross-exam query)
   ══════════════════════════════════════════════════════════════ */

/* GET /api/exams/:id/results */
router.get('/:id/results', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const exam = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    const filter = { schoolId, examId: req.params.id };
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.absent === 'true') filter.absent = true;

    const Results = tenantModel('exam_results', tenantContext(req));
    const [docs, total] = await Promise.all([
      Results.find(filter).sort({ score: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Results.countDocuments(filter)
    ]);

    // Compute class statistics server-side
    const allScores  = docs.filter(d => !d.absent).map(d => d.score);
    const stats      = allScores.length ? {
      count:   allScores.length,
      highest: Math.max(...allScores),
      lowest:  Math.min(...allScores),
      average: _round(allScores.reduce((s, n) => s + n, 0) / allScores.length),
      passCount: exam.passMark != null ? allScores.filter(s => s >= exam.passMark).length : null,
    } : null;

    return ok(res, { results: docs, stats, exam: { id: exam.id, title: exam.title, maxScore: exam.maxScore, passMark: exam.passMark } }, paginate(page, limit, total));
  } catch (err) { console.error('[exams/:id/results GET]', err); return E.serverError(res); }
});

/* POST /api/exams/:id/results  — bulk upsert results for this exam */
router.post('/:id/results', authMiddleware, PLAN, MODGATE, rbac('exams', 'create'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(BulkResultSchema, req.body);
    if (error) return E.validation(res, error);

    const exam = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    // Block writes to locked/published/archived exams
    if (['locked', 'published', 'archived'].includes(exam.status)) {
      return E.badRequest(res, `Exam is "${exam.status}" — results are read-only. An admin must unlock it to allow changes.`);
    }

    // Block writes to archived academic years — log the attempt for auditability
    if (await isYearArchived(schoolId, exam.academicYearId)) {
      tenantModel('mark_audit_log', tenantContext(req)).create({
        action:        'WRITE_BLOCKED_ARCHIVED_YEAR',
        schoolId,
        academicYearId: exam.academicYearId,
        examId:        req.params.id,
        route:         'POST /api/exams/:id/results',
        attemptedBy:   userId,
        payload:       { resultCount: data.results.length },
        timestamp:     new Date().toISOString(),
      }).catch(e => console.error('[exams/results] audit log failed:', e.message));
      return E.badRequest(res, `Academic year for this exam has been archived — results are permanently read-only.`);
    }

    // Teacher ownership check — if enforced, only the exam owner (or admin) can write results
    if (exam.ownerId && exam.ownerId !== userId && !['admin', 'superadmin'].includes(role)) {
      return E.forbidden(res, 'Only the assigned subject teacher can enter results for this exam');
    }

    // If admin is acting as teacher, require actingAs field
    const actingAs = req.body.actingAs || null;
    if (['admin', 'superadmin'].includes(role) && actingAs) {
      // Will be written to audit log
    }

    // Validate scores — only 'present' results require a score; ABS/MIS/EXM/INC do not
    const presentResults = data.results.filter(r => r.markState === 'present' && !r.absent);
    const overscored = presentResults.filter(r => r.score != null && r.score > exam.maxScore);
    if (overscored.length) {
      return E.badRequest(res, `${overscored.length} result(s) exceed the exam maximum score of ${exam.maxScore}`);
    }

    // Fetch existing results for audit trail + the school's live grading
    // scale (grade_boundaries default, falling back to academic_config) —
    // same resolution order as assessment.js/report-cards.js.
    const [existingResults, defaultScale, academicCfg] = await Promise.all([
      tenantModel('exam_results', tenantContext(req)).find({
        schoolId, examId: req.params.id,
        studentId: { $in: data.results.map(r => r.studentId) }
      }).lean(),
      tenantModel('grade_boundaries', tenantContext(req)).findOne({ schoolId, isDefault: true }).lean(),
      tenantModel('academic_config', tenantContext(req)).findOne({ schoolId }).lean(),
    ]);
    const existingMap   = Object.fromEntries(existingResults.map(r => [r.studentId, r]));
    const gradingSchema = defaultScale?.bands ?? mergeConfig(academicCfg).gradingSchema;

    // Optimistic concurrency — split off any result whose client-supplied _v
    // doesn't match the current DB value (two teachers editing the same
    // student's marks at the same time). These are never sent to bulkWrite:
    // encoding _v into an upsert filter would make a stale version silently
    // create a duplicate document instead of correctly failing to match.
    // Conflicting entries are reported back, not written. Omitting _v (as
    // every client does today) skips this check entirely — no behavior
    // change until a client actually starts sending it.
    const conflicts = [];
    const writableResults = [];
    for (const r of data.results) {
      const existing = existingMap[r.studentId];
      if (existing && r._v != null && Number(r._v) !== (existing._v ?? 0)) {
        conflicts.push({
          studentId:        r.studentId,
          yourVersion:      Number(r._v),
          currentVersion:   existing._v ?? 0,
          currentScore:     existing.score,
          currentMarkState: existing.markState,
        });
        continue;
      }
      writableResults.push(r);
    }

    const now    = new Date().toISOString();
    const auditEntries = [];
    const Results = tenantModel('exam_results', tenantContext(req));

    const ops = writableResults.map(r => {
      const resolved  = _resolveMarkState(r);
      const gradeInfo = resolved.markState === 'present' && resolved.score != null
        ? _calcGrade(resolved.score, exam.maxScore, gradingSchema)
        : null;

      // Build audit entry if score changed
      const existing = existingMap[r.studentId];
      if (existing && existing.score !== resolved.score) {
        auditEntries.push({
          action:        'RESULT_UPDATED',
          examId:        req.params.id,
          studentId:     r.studentId,
          subjectId:     exam.subjectId,
          schoolId,
          editedBy:      userId,
          actingAs:      actingAs || null,
          previousValue: existing.score,
          previousState: existing.markState || (existing.absent ? 'ABS' : 'present'),
          newValue:      resolved.score,
          newState:      resolved.markState,
          reason:        r.notes || '',
          timestamp:     now,
        });
      }

      return {
        updateOne: {
          filter: { schoolId, examId: req.params.id, studentId: r.studentId },
          update: {
            $set: {
              score:      resolved.score,
              markState:  resolved.markState,
              absent:     resolved.absent,          // backward compat
              notes:      r.notes || '',
              gradedBy:   userId,
              updatedBy:  userId,
              examId:     req.params.id,
              schoolId,
              studentId:  r.studentId,
              classId:    exam.classId,
              subjectId:  exam.subjectId,
              updatedAt:  now,
              ...(gradeInfo || {}),
            },
            $setOnInsert: { id: uuidv4(), createdBy: userId, createdAt: now },
            $inc: { _v: 1 },
          },
          upsert: true
        }
      };
    });

    const [result] = await Promise.all([
      ops.length ? Results.bulkWrite(ops, { ordered: false }) : Promise.resolve({ upsertedCount: 0, modifiedCount: 0 }),
      auditEntries.length ? tenantModel('mark_audit_log', tenantContext(req)).insertMany(auditEntries) : Promise.resolve()
    ]);

    // Auto-advance exam to 'completed' when marks are first entered
    if (['scheduled', 'in_progress'].includes(exam.status)) {
      await tenantModel('exams', tenantContext(req)).updateOne({ id: req.params.id }, { status: 'completed', updatedBy: userId });
    }

    // Check for any INC/MIS marks remaining — surface as warning, not error
    const incCount = data.results.filter(r => ['INC', 'MIS'].includes(r.markState)).length;

    return ok(res, {
      upserted:  result.upsertedCount,
      modified:  result.modifiedCount,
      total:     data.results.length,
      audited:   auditEntries.length,
      conflicts,
      warnings:  incCount ? [`${incCount} result(s) marked as INC/MIS — resolve before approving`] : [],
    }, null, 201);
  } catch (err) { console.error('[exams/:id/results POST]', err); return E.serverError(res); }
});

/* GET /api/exams/results — cross-exam results query */
router.get('/results/all', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.studentId)    filter.studentId    = req.query.studentId;
    if (req.query.classId)      filter.classId      = req.query.classId;
    if (req.query.subjectId)    filter.subjectId    = req.query.subjectId;
    if (req.query.examId)       filter.examId       = req.query.examId;

    const Results = tenantModel('exam_results', tenantContext(req));
    const [docs, total] = await Promise.all([
      Results.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Results.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[exams/results/all GET]', err); return E.serverError(res); }
});

// Exposed for direct unit testing (same convention as report-cards.js).
router._notifyExamResultsPublished = _notifyExamResultsPublished;

module.exports = router;
