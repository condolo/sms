/* ============================================================
   InnoLearn — /api/teachers  (Resource Route)
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
  subjects:       z.array(z.string()).optional(),          // subject IDs
  classes:        z.array(z.string()).optional(),          // class IDs assigned
  houseId:        z.string().optional(),                   // house tutor
  address:        z.string().max(500).optional(),
  photo:          z.string().optional(),
  joinDate:       z.string().optional(),
  contractType:   z.enum(['full_time', 'part_time', 'supply', 'volunteer']).optional(),
  status:         z.enum(['active', 'inactive', 'on_leave', 'terminated']).default('active'),
  customFields:   z.record(z.unknown()).optional(),
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

    const doc = await Teachers.create({
      ...data,
      id:         uuidv4(),
      schoolId,
      staffId,
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
    delete data.staffId;
    delete data.schoolId;
    delete data.id;

    // If email is being changed, check for duplicates
    if (data.email) {
      const Teachers = _model('teachers');
      const conflict = await Teachers.findOne({ schoolId, email: data.email, id: { $ne: req.params.id } }).lean();
      if (conflict) return E.conflict(res, `Email '${data.email}' is already used by another teacher`);
    }

    const Teachers = _model('teachers');
    const doc = await Teachers.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();

    if (!doc) return E.notFound(res, 'Teacher not found');
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
