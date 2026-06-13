/* ============================================================
   Msingi — /api/teachers  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   Server generates staff IDs via atomic counter.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
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
  // Employment / HR classification
  staffType:    z.enum(['teacher','administrator','librarian','counselor','finance','hr','it','security','other']).optional(),
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

/* ── GET /api/teachers/me — own staff record (no RBAC/plan gate) ─ */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const user = await _model('users').findOne({ id: userId, schoolId }).lean();
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
    const user = await _model('users').findOne({ id: userId, schoolId }).lean();
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
    if (req.query.status)   filter.status  = req.query.status;
    if (req.query.houseId)  filter.houseId = req.query.houseId;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { email: rx },
        { staffId: rx }, { phone: rx }
      ];
    }

    const Teachers = _model('teachers');
    const [docs, total] = await Promise.all([
      Teachers.find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip(skip).limit(limit)
        .select('-__v')
        .lean(),
      Teachers.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[teachers GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/teachers/:id ───────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('teachers', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Teachers = _model('teachers');
    const doc = await Teachers.findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Teacher not found');
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

    return created(res, doc.toObject ? doc.toObject() : doc);
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
    return ok(res, doc);
  } catch (err) {
    console.error('[teachers PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/teachers/:id ─ Soft-delete ─────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('teachers', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Teachers = _model('teachers');
    const doc = await Teachers.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Teacher not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[teachers DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
