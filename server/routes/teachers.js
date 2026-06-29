/* ============================================================
   Msingi — /api/teachers  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   Server generates staff IDs via atomic counter.
   ============================================================ */
const express  = require('express');
const { z }    = require('zod');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }  = require('../middleware/auth');
const { rbac }            = require('../middleware/rbac');
const { planGate }        = require('../middleware/plan');
const { _model }          = require('../utils/model');
const { nextStaffId }     = require('../utils/counters');
const { ok, created, fail, paginate, parsePagination, E } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');

const router = express.Router();
const PLAN   = planGate('teachers');

/* ── Validation schemas ─────────────────────────────────────── */
const TeacherCreateSchema = z.object({
  firstName:      z.string().min(1).max(100).trim(),
  lastName:       z.string().min(1).max(100).trim(),
  middleName:     z.string().max(100).trim().optional(),
  email:          z.string().email(),
  phone:          z.string().max(30).optional(),
  dateOfBirth:    z.string().optional(),
  gender:         z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  title:          z.string().max(20).optional(),           // Mr, Mrs, Dr, etc.
  qualifications: z.string().max(500).optional(),
  specialization: z.string().max(200).optional(),
  subjects:       z.array(z.string()).optional(),          // subject IDs
  classes:        z.array(z.string()).optional(),          // class IDs assigned
  houseId:        z.string().optional(),                   // house tutor
  address:        z.string().max(500).optional(),
  photo:          z.string().optional(),
  joinDate:       z.string().optional(),
  contractType:   z.enum(['full_time', 'part_time', 'supply', 'volunteer']).optional(),
  status:         z.enum(['active', 'inactive', 'on_leave', 'terminated']).default('active'),
  customFields:   z.record(z.unknown()).optional(),
  // Employment / HR classification — matches system role keys (built-in or custom)
  staffType:    z.string().max(60).optional(),
  departmentId: z.string().optional(),
  formClassId:  z.string().optional(),
  extraRoles:   z.array(z.enum(['hod','class_teacher','timetabler','exam_officer','deputy','principal'])).optional(),
  // Sensitive HR fields (stored on profile, visible to HR/Admin only)
  nationalId:   z.string().max(50).optional(),
  nssfNo:       z.string().max(50).optional(),
  shaNo:        z.string().max(50).optional(),
  kraPinNo:     z.string().max(50).optional(),
  nextOfKin:    z.object({
    name:         z.string().max(100).optional(),
    phone:        z.string().max(30).optional(),
    relationship: z.string().max(50).optional(),
  }).optional(),
});

const TeacherUpdateSchema = TeacherCreateSchema.partial().omit({ email: true }).extend({
  email: z.string().email().optional(),
});

function _validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  }
  return { data: result.data };
}

/* Fields a staff member can update on their own record (no HR gate) */
const SELF_EDITABLE = ['phone', 'address', 'qualifications', 'specialization', 'dateOfBirth', 'nextOfKin',
  'zoomPMILink', 'zoomPasscode', 'meetLink',  // online meeting links — self-managed by teacher
];

/* Sensitive fields — never returned to the staff member themselves */
function _stripSensitive(doc) {
  if (!doc) return doc;
  const { nationalId, nssfNo, shaNo, kraPinNo, ...safe } = doc;
  return safe;
}

/* Roles that may see full staff data (contact details, DOB, HR fields, etc.) */
const FULL_ACCESS_ROLES = new Set(['admin', 'superadmin', 'principal', 'hr']);

/* Returns true when the requesting role is allowed full staff data */
function _canViewFullData(role) { return FULL_ACCESS_ROLES.has(role); }

/* MongoDB projection for limited view — sensitive fields never leave the DB.
   Includes professional/public info only: name, photo, role, status, and
   the academic fields (subjects/classes/qualifications) that form a teacher's
   public profile.  Personal contact details, HR data, and IDs are excluded
   at query time so they are never loaded into Node.js memory. */
// Inclusive projection — MongoDB only returns the listed fields, so __v is
// already excluded without needing -__v (mixing inclusive+exclusive is invalid).
const LIMITED_PROJECTION =
  'id firstName lastName title middleName photo role staffType status extraRoles ' +
  'subjects classes qualifications specialization departmentId';

const FULL_PROJECTION = '-__v';

/* Build user filter that handles both custom id and ObjectId-only users */
function _userFilter(userId, schoolId) {
  const isOid = /^[a-f\d]{24}$/i.test(userId);
  const idQ   = isOid
    ? { $or: [{ id: userId }, { _id: new mongoose.Types.ObjectId(userId) }] }
    : { id: userId };
  return schoolId ? { ...idQ, schoolId } : idQ;
}

/* ── GET /api/teachers/me — own staff record (no RBAC/plan gate) ─ */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const user = await _model('users').findOne(_userFilter(userId, schoolId)).lean();
    if (!user) return E.notFound(res, 'User not found');
    const doc = await _model('teachers').findOne({ schoolId, email: user.email }).lean();
    if (!doc) return res.json({ success: true, data: null }); // no staff record — that's OK
    return ok(res, _stripSensitive(doc));
  } catch (err) {
    console.error('[teachers/me GET]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/teachers/me — self-service update (no RBAC/plan gate) ─ */
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const user = await _model('users').findOne(_userFilter(userId, schoolId)).lean();
    if (!user) return E.notFound(res, 'User not found');

    // Only allow the approved self-editable subset
    const update = {};
    for (const key of SELF_EDITABLE) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No updatable fields provided.' } });
    }
    update.updatedAt = new Date().toISOString();
    update.updatedBy = userId;

    const doc = await _model('teachers').findOneAndUpdate(
      { schoolId, email: user.email },
      { $set: update },
      { new: true }
    ).lean();

    if (!doc) return E.notFound(res, 'No staff directory entry found for your account. Contact your administrator to link your profile.');
    return ok(res, _stripSensitive(doc));
  } catch (err) {
    console.error('[teachers/me PUT]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/teachers ─ Paginated list ─────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('teachers', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };

    // Privileged roles (admin/principal/hr) may filter by any status.
    // All other roles are forced to active-only — ignoring any ?status= they send
    // so inactive, terminated, or on-leave staff are never exposed via the API.
    if (_canViewFullData(req.jwtUser.role)) {
      if (req.query.status) filter.status = req.query.status;
    } else {
      filter.status = 'active';
    }

    if (req.query.houseId)      filter.houseId      = req.query.houseId;
    if (req.query.staffType)    filter.staffType    = req.query.staffType;
    if (req.query.contractType) filter.contractType = req.query.contractType;
    if (req.query.departmentId) filter.departmentId = req.query.departmentId;

    // classId filter: resolve via teaching_assignments (teachers.classes[] is not reliably populated)
    if (req.query.classId) {
      const Assignments = _model('teaching_assignments');
      const teacherIds  = await Assignments.distinct('teacherId', { classId: req.query.classId, schoolId });
      // teacherId may be stored as teacher.id or teacher.userId — match both
      const Teachers2   = _model('teachers');
      const matched     = await Teachers2.find({ schoolId, $or: [{ id: { $in: teacherIds } }, { userId: { $in: teacherIds } }] }).select('id').lean();
      filter.id = { $in: matched.map(t => t.id) };
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { email: rx },
        { staffId: rx }, { phone: rx }
      ];
    }

    const viewFull   = _canViewFullData(req.jwtUser.role);
    const projection = viewFull ? FULL_PROJECTION : LIMITED_PROJECTION;

    const Teachers = _model('teachers');
    const [docs, total] = await Promise.all([
      Teachers.find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip(skip).limit(limit)
        .select(projection)
        .lean(),
      Teachers.countDocuments(filter)
    ]);

    // Resolve subject IDs → names so the client can display names without extra lookups.
    // Subjects stored as free-text strings are returned as-is (fallback).
    const allSubjectIds = [...new Set(docs.flatMap(d => d.subjects ?? []).filter(Boolean))];
    let subjectNameMap = {};
    if (allSubjectIds.length) {
      const subs = await _model('subjects').find({ id: { $in: allSubjectIds }, schoolId }).select('id name').lean();
      for (const s of subs) subjectNameMap[s.id] = s.name;
    }

    const enriched = docs.map(d => ({
      ...d,
      id:         d.id || d._id?.toString(),
      subjectIds: d.subjects ?? [],
      subjects:   (d.subjects ?? []).map(sid => subjectNameMap[sid] ?? sid),
    }));

    return ok(res, enriched, paginate(page, limit, total));
  } catch (err) {
    console.error('[teachers GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/teachers/:id ───────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('teachers', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const projection = _canViewFullData(req.jwtUser.role) ? FULL_PROJECTION : LIMITED_PROJECTION;
    const Teachers = _model('teachers');
    const paramId  = req.params.id;
    let doc = await Teachers.findOne({ id: paramId, schoolId }).select(projection).lean();
    if (!doc && /^[a-f\d]{24}$/i.test(paramId)) {
      try { doc = await Teachers.findOne({ _id: new mongoose.Types.ObjectId(paramId), schoolId }).select(projection).lean(); } catch { /* ignore */ }
    }
    if (!doc) return E.notFound(res, 'Teacher not found');
    if (!doc.id) doc = { ...doc, id: doc._id?.toString() };
    return ok(res, doc);
  } catch (err) {
    console.error('[teachers GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/teachers ─ Create teacher ────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('teachers', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(TeacherCreateSchema, req.body);
    if (error) return E.validation(res, error);

    // Check for duplicate email within the school
    const Teachers = _model('teachers');
    const existing = await Teachers.findOne({ schoolId, email: data.email }).lean();
    if (existing) return E.conflict(res, `A teacher with email '${data.email}' already exists`);

    const staffId = await nextStaffId(schoolId);

    // Bind userId from the linked user account (if a user with this email already exists).
    // This is required for timetable slot resolution and meeting-link lookups.
    let linkedUserId = null;
    if (data.email) {
      const userDoc = await _model('users').findOne({ schoolId, email: data.email }).select('id').lean();
      if (userDoc) linkedUserId = userDoc.id;
    }

    const doc = await Teachers.create({
      ...data,
      id:         uuidv4(),
      schoolId,
      staffId,
      userId:     linkedUserId,
      createdBy:  userId,
      updatedBy:  userId,
    });

    const docObj = doc.toObject ? doc.toObject() : doc;

    // Sync staffType → user role so permissions apply immediately
    if (data.staffType && docObj.userId) {
      await _model('users').updateOne(
        { id: docObj.userId, schoolId },
        { $set: { role: data.staffType, primaryRole: data.staffType, roles: [data.staffType], updatedAt: new Date().toISOString() } }
      );
    }

    return created(res, docObj);
  } catch (err) {
    if (err.code === 11000) return E.conflict(res, 'A teacher with those details already exists');
    console.error('[teachers POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/teachers/:id ───────────────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('teachers', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(TeacherUpdateSchema, req.body);
    if (error) return E.validation(res, error);

    // Immutable fields
    const clientVersion = data._v;
    delete data.staffId;
    delete data.schoolId;
    delete data.id;
    delete data._v;

    // If email is being changed, check for duplicates
    if (data.email) {
      const Teachers = _model('teachers');
      const existing = await Teachers.findOne({ schoolId, email: data.email, id: { $ne: req.params.id } }).lean();
      if (existing) return E.conflict(res, `Email '${data.email}' is already used by another teacher`);
    }

    const { doc, conflict } = await applyOptimisticLock(
      _model('teachers'),
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'This teacher record was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Teacher not found');

    // Sync staffType → user role when staffType was explicitly updated
    if (data.staffType && doc.userId) {
      await _model('users').updateOne(
        { id: doc.userId, schoolId },
        { $set: { role: data.staffType, primaryRole: data.staffType, roles: [data.staffType], updatedAt: new Date().toISOString() } }
      );
    }

    return ok(res, doc);
  } catch (err) {
    console.error('[teachers PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/teachers/bulk — hard-delete multiple teachers + their user accounts ── */
router.delete('/bulk', authMiddleware, PLAN, rbac('teachers', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return E.badRequest(res, 'ids array is required');
    if (ids.length > 200)
      return E.badRequest(res, 'Maximum 200 teachers per batch');

    const Teachers = _model('teachers');
    const Users    = _model('users');

    // Build a filter that handles both UUID id and legacy ObjectId-only records
    const isOid = id => /^[a-f\d]{24}$/i.test(id);
    const oidList = ids.filter(isOid).map(id => { try { return new mongoose.Types.ObjectId(id); } catch { return null; } }).filter(Boolean);
    const findFilter = {
      schoolId,
      $or: [
        { id: { $in: ids } },
        ...(oidList.length ? [{ _id: { $in: oidList } }] : []),
      ],
    };

    // Resolve emails before deleting (needed to remove user accounts)
    const toDelete  = await Teachers.find(findFilter).select('id _id email').lean();
    const emails    = toDelete.map(t => t.email).filter(Boolean);
    const confirmed = toDelete.map(t => t.id || t._id?.toString()).filter(Boolean);

    if (confirmed.length === 0) return E.notFound(res, 'No matching teachers found');

    const { deletedCount } = await Teachers.deleteMany(findFilter);

    let usersDeleted = 0;
    if (emails.length > 0) {
      const r = await Users.deleteMany({ schoolId, email: { $in: emails } });
      usersDeleted = r.deletedCount;
    }

    console.log(`[teachers] Bulk delete: ${deletedCount} teachers, ${usersDeleted} user accounts — school ${schoolId}`);
    return ok(res, { deleted: deletedCount, usersDeleted });
  } catch (err) {
    console.error('[teachers DELETE/bulk]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/teachers/:id ─ Soft-delete ─────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('teachers', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const paramId = req.params.id;
    const isOid   = /^[a-f\d]{24}$/i.test(paramId);
    const delFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    const Teachers = _model('teachers');
    const doc = await Teachers.findOneAndUpdate(
      delFilter,
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Teacher not found');
    return ok(res, { id: paramId, deleted: true });
  } catch (err) {
    console.error('[teachers DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
