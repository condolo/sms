/* ============================================================
   Msingi — /api/teaching-assignments
   Pre-timetabling assignment: which teacher delivers which subject
   to which class, in which preferred room.

   One record = "Agnes teaches Pure Maths to Class 12 in Room AL-1"

   This feeds:
     - Timetable slot editor auto-fill (GET ?classId=X&subjectId=Y)
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

/* ── Validation ─────────────────────────────────────────────── */
const AssignmentSchema = z.object({
  teacherId:       z.string().min(1),    // userId format (e.g. u_demo_t3)
  subjectId:       z.string().min(1),
  classId:         z.string().min(1),    // string id (e.g. cls_demo_4a)
  preferredRoomId: z.string().optional(),
  periodsPerWeek:  z.number().int().min(1).max(40).optional(),
});

/* ── GET /api/teaching-assignments ──────────────────────────── */
router.get('/', authMiddleware, async (req, res) => {
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
router.post('/', authMiddleware, async (req, res) => {
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
      tenantModel('classes', tenantContext(req)).findOne({ schoolId, id: data.classId }).lean(),
      data.preferredRoomId
        ? tenantModel('rooms', tenantContext(req)).findOne({ schoolId, id: data.preferredRoomId, isActive: { $ne: false } }).lean()
        : Promise.resolve(null),
    ]);

    if (!teacher) return E.notFound(res, 'Teacher not found');
    if (!subject) return E.notFound(res, 'Subject not found or inactive');
    if (!cls)     return E.notFound(res, 'Class not found');
    if (data.preferredRoomId && !room) return E.notFound(res, 'Room not found');

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

    // Duplicate guard — same teacher+subject+class is idempotent (conflict)
    const existing = await tenantModel('teaching_assignments', tenantContext(req)).findOne({
      schoolId,
      teacherId: data.teacherId,
      subjectId: data.subjectId,
      classId:   data.classId,
    }).lean();
    if (existing) {
      return E.conflict(res, 'This teacher is already assigned to this subject and class');
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
router.put('/:id', authMiddleware, async (req, res) => {
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
        const room = await tenantModel('rooms', tenantContext(req)).findOne({ schoolId, id: rId, isActive: { $ne: false } }).lean();
        if (!room) return E.notFound(res, 'Room not found');
        patch.preferredRoomId   = room.id;
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
router.delete('/:id', authMiddleware, async (req, res) => {
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
