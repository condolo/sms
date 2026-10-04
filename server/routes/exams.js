/* ============================================================
   Msingi — /api/exams  (Exam scheduling & logistics)
   Marks and their moderation live in the Markbook (assessment_marks,
   mark_submissions). An exam records the sitting: class, subject, date,
   room, invigilator, duration, and a four-state scheduling status.
   Plan: standard | RBAC: exams:{read,create,update,delete}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac } = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine        = require('../utils/scopeEngine');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const { getConfig: _getAssessmentConfig } = require('./assessment');
const { resolveCurrentPeriod } = require('./academic-config');

const router = express.Router();
const PLAN   = planGate('exams');
const MODGATE = moduleGate('grades');

/* ── Helpers ────────────────────────────────────────────────── */

/* ── Data scope (2026-09) ─────────────────────────────────────────
   Prompted directly: "a teacher should only see their streams and
   subjects they've been assigned to — no assumptions." Before this,
   exams.js never called scopeMiddleware/ScopeEngine at all — any
   caller holding exams:read could list or open ANY exam in the
   school, and POST /:id/results's only ownership gate was an
   optional, client-suppliable exam.ownerId that the general admin
   create path never sets (see POST / below) — meaning an exam
   created without one had NO ownership check whatsoever. */

/* exam_results carries no streamId (unlike grades/assessment_marks),
   so a teacher whose ONLY assignment for a class is stream-scoped
   (e.g. 7i's Maths teacher — see teaching-assignments.js) never
   contributes to scope.classIds, only scope.streamIds
   (scopeMiddleware.js's _loadAssigned) — the plain classId filter
   below would then wrongly show them zero exams for their own class.
   Resolve those streams' PARENT classIds so they still see "the" exam
   for their class (there is only one — exams aren't split per
   stream). Mirrors scopeEngine.js's own resolveClassPickerScope, but
   deliberately does NOT fold in homeroom/form-teacher streams the way
   that function does — being a stream's pastoral form teacher is not
   academic authority to see that stream's exams, the same boundary
   foldHomeroomScope draws for grades/assessment/report_cards. */
async function _examClassScope(req) {
  const scope = req.scope;
  if (!scope?.streamIds?.length) return scope;
  const parents = await tenantModel('streams', tenantContext(req))
    .find({ schoolId: req.jwtUser.schoolId, id: { $in: scope.streamIds } })
    .select('classId').lean();
  const resolvedClassIds = [...new Set(parents.map(s => s.classId).filter(Boolean))];
  if (!resolvedClassIds.length) return scope;
  return { ...scope, classIds: [...new Set([...(scope.classIds ?? []), ...resolvedClassIds])] };
}

/* ScopeEngine only scopes one field per module (MODULE_SCOPE.exams is
   classId) — exams also need narrowing by subjectId, since a teacher
   assigned Math in 4A should not see every OTHER subject's exams for
   4A just because they're in scope for that class. Mirrors
   applyToFilter's own string/$in-narrowing shape. An exam with no
   subjectId at all (schema allows it — created before finalising)
   has nothing to check and is let through, same philosophy as
   isClassInScope's handling of an absent classId. */
function _applySubjectScope(req, filter) {
  const scope = req.scope;
  if (!scope || scope.unrestrictedModules?.includes('exams')) return filter;
  const allowed = scope.subjectIds ?? [];
  const existing = filter.subjectId;
  if (typeof existing === 'string') {
    if (!allowed.includes(existing)) filter.subjectId = '__no_match__';
    return filter;
  }
  filter.$or = [{ subjectId: { $in: allowed } }, { subjectId: { $exists: false } }, { subjectId: null }];
  return filter;
}

/* Single-document counterpart to _applySubjectScope/applyToFilter, for
   routes that fetch one exam by id rather than building a list query
   (e.g. GET /:id). An absent classId/subjectId on the exam has nothing
   to check and is allowed through, same philosophy as isClassInScope. */
function _examInScope(scope, doc) {
  if (!scope) return true;
  if (scope.unrestrictedModules?.includes('exams')) return true;
  const classOk   = !doc.classId   || (scope.classIds   ?? []).includes(doc.classId);
  const subjectOk = !doc.subjectId || (scope.subjectIds ?? []).includes(doc.subjectId);
  return classOk && subjectOk;
}

/* ── Exam status (scheduling tracker) ─────────────────────────────
   Exams schedule a sitting. Marks and their moderation live in the Markbook
   (assessment_marks / mark_submissions). Four states only:
     scheduled   → in_progress | cancelled
     in_progress → completed   | cancelled
   ─────────────────────────────────────────────────────────────── */
const EXAM_TRANSITIONS = {
  scheduled:   ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [],
  cancelled:   [],
};

const TRANSITION_ROLES = {
  in_progress: ['teacher', 'exams_officer', 'admin', 'superadmin'],
  completed:   ['teacher', 'exams_officer', 'admin', 'superadmin'],
  cancelled:   ['exams_officer', 'admin', 'superadmin'],
};

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
  status:         z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).default('scheduled'),
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

/** Validate an exam status transition — returns an error string, or null when allowed. */
function _checkTransition(fromStatus, toStatus, userRole) {
  const allowed = EXAM_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return `Cannot transition from "${fromStatus}" to "${toStatus}". Allowed next states: [${allowed.join(', ')}]`;
  }
  const roleOk = TRANSITION_ROLES[toStatus] || [];
  if (roleOk.length && !roleOk.includes(userRole)) {
    return `Your role ("${userRole}") cannot set status to "${toStatus}"`;
  }
  return null;
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

router.get('/', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), scopeMiddleware, async (req, res) => {
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

    // Data scope — see this file's own comment on _examClassScope/
    // _applySubjectScope above. Request-local only; req.scope is restored
    // before the handler returns so scopeMiddleware's 5-minute cache
    // (shared across every other module's own next call) is never mutated.
    const originalScope = req.scope;
    req.scope = await _examClassScope(req);
    ScopeEngine.applyToFilter(req, 'exams', filter);
    _applySubjectScope(req, filter);
    req.scope = originalScope;

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

router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('exams', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('exams', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Exam not found');

    const scope = await _examClassScope(req);
    if (!_examInScope(scope, doc)) {
      return E.forbidden(res, 'This exam is not in your assigned scope.');
    }

    return ok(res, doc);
  } catch (err) { console.error('[exams GET/:id]', err); return E.serverError(res); }
});

/* subjectId/classId are free-text FK strings on ExamSchema (no Mongoose
   ref) — a typo or stale id would silently create an exam that never
   matches the Markbook/report-card filters, with no
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

/**
 * Resolve (or create) the assessment_schedule entry — the Markbook "window"
 * — that this exam's marks belong to, and return its id for scheduleEntryId.
 *
 * Architecture lock (consolidating all mark entry into the Markbook): an
 * exam is scheduling/logistics only; it no longer stores marks itself
 * (POST /:id/results is retired). But every exam still needs to open the
 * matching Markbook window automatically, the same way a CA/HW entry
 * configured directly in Assessment Schedule does — otherwise a Mid-Term
 * exam could exist with nowhere for its subject teacher to actually enter
 * marks. `exams.js`'s own ExamSchema already had a scheduleEntryId field,
 * but only the teacher /announce route ever set it (picking an existing
 * entry the exam office had configured) — the general admin "Create Exam"
 * flow left it undefined, which is exactly how the reported Biology CA
 * exam (bc4dfbd5...) ended up with no corresponding Markbook row at all.
 *
 * assessment_schedule has no instance concept worth exposing here — exams
 * default to instance 1 (a school running multiple sittings of the same
 * exam type in one term is the rare case this simplification accepts, same
 * posture the migration script takes for exam_results -> assessment_marks).
 * If data.scheduleEntryId is already set (the /announce path, or a client
 * that already knows which window it wants), it's trusted as-is.
 */
async function _resolveScheduleLink(schoolId, ctx, data) {
  if (data.scheduleEntryId) return data.scheduleEntryId;
  if (!data.assessmentType) return null; // nothing to link without a type

  let academicYearId = data.academicYearId || null;
  let termNumber = null;

  if (data.termId) {
    const year = academicYearId
      ? await tenantModel('academic_years', ctx).findOne({ schoolId, id: academicYearId }).select('terms').lean()
      : null;
    if (year) {
      const idx = (year.terms || []).findIndex(t => t.id === data.termId);
      if (idx >= 0) termNumber = idx + 1;
    }
  }

  if (!academicYearId || termNumber == null) {
    const years = await tenantModel('academic_years', ctx).find({ schoolId }).lean();
    const resolved = resolveCurrentPeriod(years);
    academicYearId = academicYearId || resolved.year?.id || null;
    termNumber = termNumber ?? resolved.termNumber ?? 1;
  }

  const naturalKey = { schoolId, termNumber, assessmentType: data.assessmentType, instance: 1 };
  const Schedule = tenantModel('assessment_schedule', ctx);
  // Adopt a legacy null-tagged entry for this key if one already exists
  // (same precedent as PUT /schedule's own adoption logic) rather than
  // creating a second, parallel schedule row under the resolved year.
  const existing = await Schedule.findOne({ ...naturalKey, $or: [{ academicYearId }, { academicYearId: null }] })
    .sort({ academicYearId: -1 })
    .lean();
  if (existing) return existing.id;

  const newEntry = await Schedule.findOneAndUpdate(
    { ...naturalKey, academicYearId },
    {
      $set: { dateFrom: data.date || new Date().toISOString().slice(0, 10), dateTo: data.date || new Date().toISOString().slice(0, 10), label: data.assessmentLabel || data.assessmentType },
      $setOnInsert: { id: uuidv4(), schoolId },
    },
    { new: true, upsert: true }
  ).lean();
  return newEntry.id;
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

    data.scheduleEntryId = await _resolveScheduleLink(schoolId, ctx, data);

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

    // Validate status transition if status is being changed
    if (data.status && data.status !== existing.status) {
      const transitionError = _checkTransition(existing.status, data.status, role);
      if (transitionError) return E.badRequest(res, transitionError);

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

    return ok(res, doc);
  } catch (err) { console.error('[exams PUT/:id]', err); return E.serverError(res); }
});

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


module.exports = router;
