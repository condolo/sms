/* ============================================================
   Msingi — /api/classes  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   ============================================================ */
const express  = require('express');
const { z }    = require('zod');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine         = require('../utils/scopeEngine');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');

const router = express.Router();
const PLAN   = planGate('classes');
const MODGATE = moduleGate('classes');

/* ── Validation ─────────────────────────────────────────────── */
const ClassSchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  sectionKey:  z.string().max(50).optional(),  // references sections.key
  description: z.string().max(500).optional(),
  status:      z.enum(['active', 'inactive']).default('active'),
  order:       z.number().int().min(0).max(999).optional(), // promotion sequence — lower = earlier
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/classes ────────────────────────────────────────── */
// Deliberately UNSCOPED by default — this list feeds 21 different client
// surfaces (Dashboard, Finance fee structures, Subjects catalog, Library,
// Admissions, etc.), most of which have a legitimate reason to see every
// class in the school regardless of the caller's own teaching/assigned
// scope (e.g. building a fee structure needs to reference every class,
// not just the classes the current staff member personally teaches).
// Blanket-restricting this endpoint would be a broad, cross-cutting policy
// change disguised as a bugfix — see scopeEngine.js's isClassInScope for
// the related write-side story.
//
// `?assignedOnly=true` is the narrow, opt-in exception: a caller that
// specifically wants "just the classes I can act on" (Exams/Assessment's
// and Growth Profile's own class pickers — the write/read routes they
// feed already enforce this authoritatively server-side; this narrows
// the dropdown itself so a scoped user isn't shown classes they'd be
// rejected for picking) can ask for it explicitly. Every other consumer
// that never passes the flag sees exactly the same unrestricted list it
// always has — zero behavior change. Uses the generic scopeMiddleware
// scope, correctly treating any role that's 'school'-level for its OWN
// module (e.g. exams_officer) as unrestricted here too — that's correct
// for Exams/Growth Profile's purposes.
//
// `?attendanceScope=true` is a SEPARATE, deliberately narrower exception
// — AttendancePage.jsx's own class picker only. Several roles that are
// genuinely 'school'-level for their own module (exams_officer,
// admissions_officer, finance, hr, timetabler, discipline_committee)
// have no legitimate reason to see every class's DAILY REGISTER just
// because of that — Attendance tracks real teaching/homeroom duty, not
// a specialist administrative remit (see scopeEngine.js's
// resolveAttendanceScope for the full reasoning and the narrower floor
// it applies). `?lessonsScope=true` is the identical exception for
// LessonsPage.jsx's own class picker (Lesson Plans), for the exact same
// set of roles and the exact same reasoning — see resolveLessonsScope.
// Never combine more than one of these flags — attendanceScope /
// lessonsScope win over assignedOnly if somehow present together, since
// they're the more restrictive of the two.
router.get(
  '/', authMiddleware, PLAN, MODGATE, rbac('classes', 'read'),
  (req, res, next) => (req.query.assignedOnly === 'true' || req.query.attendanceScope === 'true' || req.query.lessonsScope === 'true' ? scopeMiddleware(req, res, next) : next()),
  async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.status)      filter.status     = req.query.status;
    if (req.query.sectionKey)  filter.sectionKey = req.query.sectionKey;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }

    if (req.query.attendanceScope === 'true') {
      const originalScope = req.scope;
      req.scope = await ScopeEngine.resolveAttendanceClassPickerScope(req);
      ScopeEngine.applyToFilter(req, 'classes', filter);
      const noAssignments = ScopeEngine.hasNoAssignments(req, 'classes');
      req.scope = originalScope;
      if (noAssignments) {
        return ok(res, [], { ...paginate(page, limit, 0), noAssignments: true });
      }
    } else if (req.query.lessonsScope === 'true') {
      const originalScope = req.scope;
      req.scope = await ScopeEngine.resolveLessonsClassPickerScope(req);
      ScopeEngine.applyToFilter(req, 'classes', filter);
      const noAssignments = ScopeEngine.hasNoAssignments(req, 'classes');
      req.scope = originalScope;
      if (noAssignments) {
        return ok(res, [], { ...paginate(page, limit, 0), noAssignments: true });
      }
    } else if (req.query.assignedOnly === 'true') {
      // A stream-only teaching assignment (scopeMiddleware.js's
      // _loadAssigned) deliberately never contributes to scope.classIds —
      // that's what lets students/attendance/grades etc. narrow to just
      // that one stream's own records instead of the whole class. But a
      // `classes` document has no streamId field of its own at all (see
      // scopeEngine.js's MODULE_SCOPE comment on `classes`) — so a teacher
      // whose ONLY assignments are stream-scoped (the common case whenever
      // a compulsory subject has a separate teacher per stream) had zero
      // classIds to match and saw an empty "Select class..." picker on
      // Attendance despite having real, valid assignments.
      // resolveClassPickerScope() resolves those streams to their PARENT
      // classes and returns a NEW scope object — never mutates req.scope
      // itself, since scopeMiddleware caches it per userId::schoolId and
      // other modules' routes (e.g. assessment.js's own /analytics
      // availableClasses, the only other `classes`-module scope consumer)
      // read that same cached object on their own next call.
      const originalScope = req.scope;
      req.scope = await ScopeEngine.resolveClassPickerScope(req);
      ScopeEngine.applyToFilter(req, 'classes', filter);
      const noAssignments = ScopeEngine.hasNoAssignments(req, 'classes');
      req.scope = originalScope; // restore — the resolved copy is only for this list's own scoping
      if (noAssignments) {
        return ok(res, [], { ...paginate(page, limit, 0), noAssignments: true });
      }
    }

    const Classes = tenantModel('classes', tenantContext(req));
    const [docs, total] = await Promise.all([
      Classes.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Classes.countDocuments(filter),
    ]);

    // Normalize: ensure every class has an id (UUID or _id hex fallback)
    // so that classId references stored on child records always match.
    const normalised = docs.map(d => ({ ...d, id: d.id || d._id?.toString() }));

    // Enrich with stream count + total student count per class
    const classIds = normalised.map(d => d.id).filter(Boolean);
    const Streams  = tenantModel('streams', tenantContext(req));
    const Students = tenantModel('students', tenantContext(req));

    const [streamCounts, studentCounts] = await Promise.all([
      Streams.aggregate([
        { $match: { classId: { $in: classIds }, schoolId, status: 'active' } },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]),
      Students.aggregate([
        { $match: { classId: { $in: classIds }, schoolId, status: { $nin: ['withdrawn', 'graduated'] } } },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]),
    ]);

    const streamCountMap  = {};
    const studentCountMap = {};
    for (const r of streamCounts)  streamCountMap[r._id]  = r.count;
    for (const r of studentCounts) studentCountMap[r._id] = r.count;

    const enriched = normalised.map(d => ({
      ...d,
      streamCount:  streamCountMap[d.id]  ?? 0,
      studentCount: studentCountMap[d.id] ?? 0,
    }));

    return ok(res, enriched, paginate(page, limit, total));
  } catch (err) {
    console.error('[classes GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/classes/:id ────────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('classes', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Classes = tenantModel('classes', tenantContext(req));
    const paramId = req.params.id;

    // Primary lookup by custom UUID id field
    let doc = await Classes.findOne({ id: paramId, schoolId }).select('-__v').lean();

    // Fallback: if not found and the param looks like a MongoDB ObjectId, try _id
    if (!doc && /^[a-f\d]{24}$/i.test(paramId)) {
      try {
        doc = await Classes.findOne({ _id: new mongoose.Types.ObjectId(paramId), schoolId }).select('-__v').lean();
      } catch { /* invalid ObjectId — leave doc as null */ }
    }

    if (!doc) return E.notFound(res, 'Class not found');
    // Ensure id is always present so client can pass it to child-resource endpoints
    if (!doc.id) doc = { ...doc, id: doc._id?.toString() };
    return ok(res, doc);
  } catch (err) {
    console.error('[classes GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/classes/:id/students ─ Students in a class ─────── */
router.get('/:id/students', authMiddleware, PLAN, MODGATE, rbac('students', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    // Verify the class belongs to this school (try custom id, then _id fallback)
    const Classes = tenantModel('classes', tenantContext(req));
    const pId     = req.params.id;
    let cls       = await Classes.findOne({ id: pId, schoolId }).lean();
    if (!cls && /^[a-f\d]{24}$/i.test(pId)) {
      try { cls = await Classes.findOne({ _id: new mongoose.Types.ObjectId(pId), schoolId }).lean(); } catch { /* ignore */ }
    }
    if (!cls) return E.notFound(res, 'Class not found');

    // Security Baseline Register, AUTHZ-27 — this route had no scope check at
    // all, unlike GET /api/students (the list route for the same underlying
    // data), which correctly enforces ScopeEngine.applyToFilter. A teacher
    // restricted to their own assigned classes on the list endpoint could
    // still pull any class's full roster — including parent contact PII — by
    // id here. Live-confirmed against production before this fix.
    //
    // Stream-scoping follow-up: a teacher assigned a compulsory subject in
    // ONE stream of this class (e.g. 7i's Maths, not 7ii's) has real,
    // narrower access here — not the binary "whole class or nothing" this
    // gate used to enforce. isClassInScope only ever means a whole-class
    // grant; a teacher with stream-only access fails it and must be allowed
    // through here specifically so the query below can narrow them to just
    // their own stream(s), same reasoning as streams.js's own roster route.
    //
    // `?attendanceScope=true` — raised directly: a class with 3 streams
    // showed ALL 54 students merged together when taking attendance,
    // instead of forcing a per-stream pick. Root cause: AttendancePage.jsx's
    // stream picker already correctly uses streams.js's own attendanceScope
    // (ScopeEngine.resolveAttendanceScope — the narrow, real-assignment-only
    // floor: only admin/superadmin/principal/deputy_principal/deputy are
    // unrestricted, see that function's own comment), so a caller scoped to
    // exactly ONE real stream in a multi-stream class correctly sees just
    // that one stream and skips the picker — but the roster query THEN falls
    // back to THIS route, which used the GENERIC scopeMiddleware scope
    // instead. For a role that's 'school'-level generically for its OWN
    // module (exams_officer/admissions_officer/finance/hr/timetabler/
    // discipline_committee — see scopeMiddleware.js's ROLE_SCOPE_LEVEL)
    // but ALSO holds a real, narrow teaching_assignments or homeroom row in
    // THIS class (the same "administrative role is layered on top of a real
    // teaching duty" case Attendance's whole floor design exists for), the
    // generic scope is null (fully unrestricted) even though their actual
    // attendance-relevant access is one stream — so this route returned
    // every student in the class instead of just theirs. Opt-in and
    // additive, same convention as classes.js's own GET / attendanceScope/
    // assignedOnly/lessonsScope flags: every other caller of this route
    // (Exams marks entry, Report Cards picker) is unaffected.
    const originalScope = req.scope;
    if (req.query.attendanceScope === 'true') {
      req.scope = await ScopeEngine.resolveAttendanceScope(req);
    }
    const inWholeClassScope = ScopeEngine.isClassInScope(req, 'students', cls.id);
    let myStreamIds = req.scope?.streamIds ?? [];
    // Raised directly, and dangerous-sounding until traced: a real form/
    // homeroom teacher (streams.js's own formTeacherId, set independently of
    // any subject-teaching row) with ZERO teaching_assignments row in her own
    // homeroom class got a 403 here — confirmed live, students never moved or
    // deleted — even though she could correctly take attendance for that
    // exact same class the day before. Reason: resolveAttendanceScope folds
    // homeroom streams in for Attendance's own scope (see its own comment),
    // but the GENERIC scope this route otherwise uses never does (scopeEngine
    // .js's foldHomeroomScope is deliberately Attendance/Lessons-picker-only)
    // — so a pure homeroom teacher passed here with an empty streamIds. The
    // client (ClassDetail.jsx) then rendered that 403 identically to a
    // genuinely empty class ("no students yet — add some"), indistinguishable
    // from real data loss to whoever saw it. streams.js's own sibling route
    // already falls back to resolveHomeroomStreamIds for exactly this reason
    // — mirrored here rather than invented fresh.
    if (!inWholeClassScope) {
      const homeroomStreamIds = await ScopeEngine.resolveHomeroomStreamIds(req);
      if (homeroomStreamIds.length) myStreamIds = [...new Set([...myStreamIds, ...homeroomStreamIds])];
    }
    req.scope = originalScope; // restore — the resolved copy is only for this route's own check
    const classIdForms = [...new Set([cls.id, String(cls._id), req.params.id].filter(Boolean))];

    // A teacher's streamIds may belong to a totally different class (e.g.
    // stream-scoped to 4A's Maths, requesting 9C's roster) — narrow to only
    // the ones that actually belong to THIS class before deciding access,
    // so that case denies (403) the same way a whole-class-elsewhere
    // teacher already does, rather than silently 200-with-an-empty-list.
    const relevantStreamIds = (!inWholeClassScope && myStreamIds.length)
      ? await tenantModel('streams', tenantContext(req))
          .find({ schoolId, classId: { $in: classIdForms }, id: { $in: myStreamIds } })
          .select('id').lean().then(docs => docs.map(d => d.id))
      : [];

    if (!inWholeClassScope && relevantStreamIds.length === 0) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const Students = tenantModel('students', tenantContext(req));
    // Match students stored under ANY identifier form of this class —
    // UUID `id` or Mongo `_id` string (pre-migration / imported records)
    const filter   = { schoolId, classId: { $in: classIdForms } };
    if (!inWholeClassScope) {
      // Stream-scoped only: narrow to just the caller's own stream(s) within
      // this class.
      filter.streamId = { $in: relevantStreamIds };
    }
    // Raised directly: a deactivated student must not appear in a class
    // roster, and must reappear once reactivated. This route had no default
    // at all — a caller that forgot `?status=active` (found live: the exam
    // marks-entry roster and the Report Cards student picker both did) got
    // EVERY status back, inactive/withdrawn/graduated included. `?status=all`
    // remains available for a caller that genuinely wants every status,
    // matching students.js's own GET / convention.
    if (req.query.status === 'all') {
      // no status filter — every status, on request
    } else if (req.query.status) {
      filter.status = req.query.status;
    } else {
      filter.status = 'active';
    }

    const [docs, total] = await Promise.all([
      Students.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Students.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[classes/:id/students GET]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/classes ───────────────────────────────────────── */
router.post('/', authMiddleware, PLAN, MODGATE, rbac('classes', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ClassSchema, req.body);
    if (error) return E.validation(res, error);

    const Classes = tenantModel('classes', tenantContext(req));
    const dup = await Classes.findOne({ schoolId, name: data.name }).lean();
    if (dup) return E.conflict(res, `A class named '${data.name}' already exists`);

    const doc = await Classes.create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[classes POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/classes/:id ────────────────────────────────────── */
router.put('/:id', authMiddleware, PLAN, MODGATE, rbac('classes', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ClassSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const clientVersion = data._v;
    delete data.schoolId; delete data.id; delete data._v;

    const paramId = req.params.id;
    const isOid   = /^[a-f\d]{24}$/i.test(paramId);
    const putFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    const { doc, conflict } = await applyOptimisticLock(
      tenantModel('classes', tenantContext(req)),
      putFilter,
      { ...data, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'This class record was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Class not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[classes PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/classes/:id ─ Soft-delete ───────────────────── */
router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('classes', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const paramId = req.params.id;
    const isOid   = /^[a-f\d]{24}$/i.test(paramId);
    const delFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    // Block if class still has active streams
    const Streams     = tenantModel('streams', tenantContext(req));
    const streamCount = await Streams.countDocuments({ classId: paramId, schoolId, status: 'active' });
    if (streamCount > 0) {
      return E.conflict(res, `Cannot delete class with ${streamCount} active stream${streamCount !== 1 ? 's' : ''}. Remove all streams first.`);
    }

    const Classes = tenantModel('classes', tenantContext(req));
    const doc = await Classes.findOneAndUpdate(
      delFilter,
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Class not found');
    return ok(res, { id: paramId, deleted: true });
  } catch (err) {
    console.error('[classes DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
