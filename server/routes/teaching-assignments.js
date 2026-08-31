/* ============================================================
   Msingi — /api/teaching-assignments
   Pre-timetabling assignment: which teacher delivers which subject
   to which class (and, when it matters, which stream), in which
   preferred room.

   One record = "Agnes teaches Pure Maths to Class 12 in Room AL-1"

   Stream rule (class has streams, e.g. 7i / 7ii with different Maths
   teachers — a plain class-wide assignment can't express that):
     - Subject is COMPULSORY for this class (class_subjects.
       isCompulsoryForClass) AND the class actually has streams
       → streamId is REQUIRED. Each stream gets its own assignment row,
         and each is independently scoped — assigning Agnes to 7i's
         Maths does not give her visibility into 7ii.
     - Subject is ELECTIVE for this class, OR the class has no streams
       at all → streamId is OPTIONAL. Omitted = whole-class grant
       (electives commonly pool students from every stream into one
       group, so class-wide is the correct default, not a narrowing).
   See scopeEngine.js / scopeMiddleware.js for how streamId then flows
   into what a teacher can actually see.

   This feeds:
     - Timetable slot editor auto-fill (GET ?classId=X&subjectId=Y&streamId=Z)
     - Teacher profile "Assignments" tab (GET ?teacherId=X)
     - Room availability (GET ?roomId=X)

   RBAC:
     - READ:   any authenticated user (teachers see only own)
     - WRITE:  admin, superadmin, principal, deputy (any subject/class)
               hod (only subjects in their department)
               timetabler (read only, cannot create/delete)
   ============================================================ */
'use strict';

const express        = require('express');
const { z }         = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }      = require('../middleware/auth');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E }      = require('../utils/response');
const { invalidateScopeCache } = require('../middleware/scopeMiddleware');

const router = express.Router();

/* ── Role helpers ────────────────────────────────────────────── */
const FULL_MANAGE = new Set(['admin', 'superadmin', 'deputy', 'principal']);

function _effectiveRoles(req) {
  const role       = req.jwtUser?.role       ?? '';
  const roles      = req.jwtUser?.roles      ?? [];
  const extraRoles = req.jwtUser?.extraRoles ?? [];
  return new Set([role, ...roles, ...extraRoles]);
}

/* Returns true if user may create/delete assignments.
   departmentId is the subject's department — used to scope HODs. */
function canManage(req, subjectDepartmentId = null) {
  const eff = _effectiveRoles(req);
  if ([...FULL_MANAGE].some(r => eff.has(r))) return true;

  // HOD: only within their own department
  if (eff.has('hod')) {
    if (!subjectDepartmentId) return true; // no dept info yet, validate later
    return (req.jwtUser.departmentId ?? req.jwtUser.deptId) === subjectDepartmentId;
  }
  return false;
}

/* ── Helper: find a class by either custom id (UUID) or _id (ObjectId string) ─
   Classes created before the id field was added only have _id. GET /classes
   normalises both into `id` for the frontend's own dropdowns (see its own
   "Normalize" comment), so a class missing a real id still displays and
   selects correctly — but a write route that only matches the literal `id`
   field never finds that class, surfacing as a false "Class not found" even
   though the class is right there in the picker. Same helper/reasoning as
   class-subjects.js's _classQuery, kept local rather than shared since
   every route in this codebase that needs it keeps its own copy (e.g.
   students.js's _entityIdForms). */
function _classQuery(schoolId, classId) {
  const isOid = /^[a-f\d]{24}$/i.test(classId);
  return isOid
    ? { schoolId, $or: [{ id: classId }, { _id: classId }] }
    : { schoolId, id: classId };
}

/* Same reasoning as _classQuery, for streams — see streams.js, whose own
   POST/GET routes tolerate the identical legacy _id-as-id case. */
function _streamQuery(schoolId, classId, streamId) {
  const isOid = /^[a-f\d]{24}$/i.test(streamId);
  return isOid
    ? { schoolId, classId, $or: [{ id: streamId }, { _id: streamId }] }
    : { schoolId, classId, id: streamId };
}

/* Same reasoning as _classQuery, for rooms — the Preferred Room picker
   (TeacherList.jsx's TeacherAssignmentsTab) built its option values as
   `r._id ?? r.id`, the wrong priority: every room document always has a
   Mongo _id, so that fallback never actually reached `r.id` at all — the
   dropdown was unconditionally sending the raw Mongo _id, which this
   route's literal `id`-only match then never found. "Room not found" was
   not intermittent or data-dependent; it fired on every save that picked
   a room, regardless of whether that room had a proper id (client fix is
   the real one; this is defense in depth, same as _classQuery/_streamQuery,
   in case a room is ever missing a real id via some path that hasn't been
   audited). */
function _roomQuery(schoolId, roomId) {
  const isOid = /^[a-f\d]{24}$/i.test(roomId);
  return isOid
    ? { schoolId, isActive: { $ne: false }, $or: [{ id: roomId }, { _id: roomId }] }
    : { schoolId, isActive: { $ne: false }, id: roomId };
}

/* ── Validation ─────────────────────────────────────────────── */
const AssignmentSchema = z.object({
  teacherId:       z.string().min(1),    // userId format (e.g. u_demo_t3)
  subjectId:       z.string().min(1),
  classId:         z.string().min(1),    // string id (e.g. cls_demo_4a)
  streamId:        z.string().min(1).optional(),
  preferredRoomId: z.string().optional(),
  periodsPerWeek:  z.number().int().min(1).max(40).optional(),
});

/* ── GET /api/teaching-assignments ──────────────────────────── */
router.get('/', authMiddleware, async (req, res) => { // rbac: self-scoped below for plain teachers, open to all other real roles — see header comment
  try {
    const { schoolId } = req.jwtUser;
    const eff          = _effectiveRoles(req);

    const filter = { schoolId };

    // Teachers can only read their own assignments
    const isTeacherOnly = eff.has('teacher') &&
      !['admin','superadmin','principal','deputy','hod','timetabler']
        .some(r => eff.has(r));

    if (isTeacherOnly) {
      filter.teacherId = req.jwtUser.userId ?? req.jwtUser.id;
    }

    // Query filters
    if (req.query.teacherId)  filter.teacherId  = req.query.teacherId;
    if (req.query.classId)    filter.classId    = req.query.classId;
    if (req.query.subjectId)  filter.subjectId  = req.query.subjectId;
    // Timetable auto-fill lookup (?classId=X&subjectId=Y&streamId=Z) needs
    // this to pick the RIGHT teacher when a compulsory subject has separate,
    // stream-scoped assignments — without it, a class with two different
    // stream teachers for the same subject would match both rows and the
    // lookup couldn't tell them apart.
    if (req.query.streamId)   filter.streamId   = req.query.streamId;
    if (req.query.roomId)     filter.preferredRoomId = req.query.roomId;
    if (req.query.departmentId) filter.departmentId  = req.query.departmentId;

    const docs = await tenantModel('teaching_assignments', tenantContext(req))
      .find(filter)
      .sort({ subjectName: 1, className: 1 })
      .lean();

    return ok(res, docs);
  } catch (err) {
    console.error('[teaching-assignments GET /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/teaching-assignments ─────────────────────────── */
router.post('/', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;
    const role = req.jwtUser?.role ?? '';

    const result = AssignmentSchema.safeParse(req.body);
    if (!result.success) return E.validation(res, result.error.issues);
    const { data } = result;

    // Resolve entities — denormalise names at write time
    const [teacher, subject, cls, room] = await Promise.all([
      tenantModel('teachers', tenantContext(req)).findOne({
        schoolId,
        $or: [{ userId: data.teacherId }, { id: data.teacherId }],
      }).lean(),
      tenantModel('subjects', tenantContext(req)).findOne({ schoolId, id: data.subjectId, isActive: { $ne: false } }).lean(),
      tenantModel('classes', tenantContext(req)).findOne(_classQuery(schoolId, data.classId)).lean(),
      data.preferredRoomId
        ? tenantModel('rooms', tenantContext(req)).findOne(_roomQuery(schoolId, data.preferredRoomId)).lean()
        : Promise.resolve(null),
    ]);

    if (!teacher) return E.notFound(res, 'Teacher not found');
    if (!subject) return E.notFound(res, 'Subject not found or inactive');
    if (!cls)     return E.notFound(res, 'Class not found');
    if (data.preferredRoomId && !room) return E.notFound(res, 'Room not found');

    // Same normalization GET /classes already applies for its own dropdowns
    // (see that route's "Normalize" comment) — a legacy class matched only
    // via _classQuery's _id fallback has no real `id` field, and every
    // lookup below (class_subjects, streams) needs a stable id to key on.
    if (!cls.id) cls.id = String(cls._id);
    if (room && !room.id) room.id = String(room._id);

    // HOD scope check: HODs may only assign within their department
    const eff = _effectiveRoles(req);
    const isHodOnly = eff.has('hod') && ![...FULL_MANAGE].some(r => eff.has(r));
    if (isHodOnly) {
      const hodDeptId = req.jwtUser.departmentId ?? req.jwtUser.deptId;
      if (subject.departmentId && hodDeptId && subject.departmentId !== hodDeptId) {
        return E.forbidden(res, 'As HOD you can only create assignments for subjects in your department');
      }
    } else if (!canManage(req)) {
      return E.forbidden(res);
    }

    // ── Stream rule ──────────────────────────────────────────
    // The subject must already be part of this class's curriculum (the
    // Subject dropdown in both the Assignments tab and the timetable editor
    // is populated from exactly this — class_subjects — so under normal use
    // this always exists; this is the server-side backstop for direct API
    // calls). isCompulsoryForClass is the actual source of truth for
    // whether a stream is required, not the subject's own school-wide
    // isCompulsory flag — a subject can be compulsory for one class and
    // elective for another (see class-subjects.js).
    const classSubject = await tenantModel('class_subjects', tenantContext(req))
      .findOne({ schoolId, classId: cls.id, subjectId: data.subjectId }).lean();
    if (!classSubject) {
      return E.badRequest(res, 'This subject is not part of this class\'s curriculum — add it in Curriculum first.');
    }

    const classIdForms = [...new Set([cls.id, String(cls._id)].filter(Boolean))];
    const streamCount = await tenantModel('streams', tenantContext(req))
      .countDocuments({ schoolId, classId: { $in: classIdForms }, status: 'active' });

    let stream = null;
    if (data.streamId) {
      // classId as { $in: classIdForms } is a valid Mongo filter value —
      // matches the stream regardless of which id-form it was stored under.
      stream = await tenantModel('streams', tenantContext(req))
        .findOne(_streamQuery(schoolId, { $in: classIdForms }, data.streamId)).lean();
      if (!stream) return E.notFound(res, 'Stream not found in this class');
    } else if (classSubject.isCompulsoryForClass && streamCount > 0) {
      return E.badRequest(res, 'This subject is compulsory for this class, and the class has streams — select which stream this teacher covers.');
    }

    // Duplicate guard — same teacher+subject+class+stream is idempotent
    // (conflict). streamId is part of the identity now: Agnes/Maths/Year 7i
    // and Agnes/Maths/Year 7ii are two distinct, non-conflicting rows.
    const existing = await tenantModel('teaching_assignments', tenantContext(req)).findOne({
      schoolId,
      teacherId: data.teacherId,
      subjectId: data.subjectId,
      classId:   data.classId,
      streamId:  stream?.id ?? null,
    }).lean();
    if (existing) {
      return E.conflict(res, stream
        ? `This teacher is already assigned to this subject in ${stream.name}`
        : 'This teacher is already assigned to this subject and class');
    }

    const teacherName = [teacher.title, teacher.firstName, teacher.lastName]
      .filter(Boolean).join(' ');

    const doc = await tenantModel('teaching_assignments', tenantContext(req)).create({
      id:                uuidv4(),
      schoolId,
      teacherId:         data.teacherId,
      teacherName,
      subjectId:         data.subjectId,
      subjectName:       subject.name,
      classId:           data.classId,
      className:         cls.name,
      streamId:          stream?.id   ?? null,
      streamName:        stream?.name ?? null,
      departmentId:      subject.departmentId ?? null,
      preferredRoomId:   room?.id            ?? null,
      preferredRoomName: room?.name          ?? null,
      periodsPerWeek:    data.periodsPerWeek ?? null,
      assignedBy:        userId,
      assignedByRole:    role,
    });

    // Bust scope cache so the teacher's next request reflects the new assignment
    invalidateScopeCache(data.teacherId, schoolId);
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[teaching-assignments POST /]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/teaching-assignments/:id — update preferred room / periods ── */
router.put('/:id', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;

    const existing = await tenantModel('teaching_assignments', tenantContext(req))
      .findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');

    if (!canManage(req, existing.departmentId)) return E.forbidden(res);

    const UpdateSchema = z.object({
      preferredRoomId: z.string().optional().nullable(),
      periodsPerWeek:  z.number().int().min(1).max(40).optional().nullable(),
    });
    const result = UpdateSchema.safeParse(req.body);
    if (!result.success) return E.validation(res, result.error.issues);

    const patch = { updatedBy: userId };

    if ('preferredRoomId' in result.data) {
      const rId = result.data.preferredRoomId;
      if (rId) {
        const room = await tenantModel('rooms', tenantContext(req)).findOne(_roomQuery(schoolId, rId)).lean();
        if (!room) return E.notFound(res, 'Room not found');
        patch.preferredRoomId   = room.id || String(room._id);
        patch.preferredRoomName = room.name;
      } else {
        patch.preferredRoomId   = null;
        patch.preferredRoomName = null;
      }
    }
    if ('periodsPerWeek' in result.data) patch.periodsPerWeek = result.data.periodsPerWeek;

    const doc = await tenantModel('teaching_assignments', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      patch,
      { new: true, runValidators: false },
    ).lean();

    invalidateScopeCache(existing.teacherId, schoolId);
    return ok(res, doc);
  } catch (err) {
    console.error('[teaching-assignments PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/teaching-assignments/:id ───────────────────── */
router.delete('/:id', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId } = req.jwtUser;

    const existing = await tenantModel('teaching_assignments', tenantContext(req))
      .findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');

    if (!canManage(req, existing.departmentId)) return E.forbidden(res);

    await tenantModel('teaching_assignments', tenantContext(req)).deleteOne({ id: req.params.id, schoolId });
    invalidateScopeCache(existing.teacherId, schoolId);
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[teaching-assignments DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
