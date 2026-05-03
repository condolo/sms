/* ============================================================
   InnoLearn — /api/classes  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('classes');

/* ── Validation ─────────────────────────────────────────────── */
const ClassSchema = z.object({
  name:           z.string().min(1).max(100).trim(),
  year:           z.string().max(20).optional(),         // e.g. "Year 7", "Grade 3"
  keyStageId:     z.string().optional(),
  teacherId:      z.string().optional(),                 // form tutor
  houseId:        z.string().optional(),
  capacity:       z.number().int().min(1).max(200).optional(),
  academicYearId: z.string().optional(),
  room:           z.string().max(50).optional(),
  description:    z.string().max(500).optional(),
  status:         z.enum(['active', 'inactive']).default('active'),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/classes ────────────────────────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('classes', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.status)       filter.status       = req.query.status;
    if (req.query.keyStageId)   filter.keyStageId   = req.query.keyStageId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.teacherId)    filter.teacherId    = req.query.teacherId;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { year: rx }, { room: rx }];
    }

    const Classes = _model('classes');
    const [docs, total] = await Promise.all([
      Classes.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Classes.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[classes GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/classes/:id ────────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('classes', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Classes = _model('classes');
    const doc = await Classes.findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Class not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[classes GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/classes/:id/students ─ Students in a class ─────── */
router.get('/:id/students', authMiddleware, PLAN, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    // Verify the class belongs to this school
    const Classes  = _model('classes');
    const cls      = await Classes.findOne({ id: req.params.id, schoolId }).lean();
    if (!cls) return E.notFound(res, 'Class not found');

    const Students = _model('students');
    const filter   = { schoolId, classId: req.params.id };
    if (req.query.status) filter.status = req.query.status;

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
router.post('/', authMiddleware, PLAN, rbac('classes', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ClassSchema, req.body);
    if (error) return E.validation(res, error);

    const Classes = _model('classes');
    // Prevent duplicate class name in same school + academic year
    const dup = await Classes.findOne({ schoolId, name: data.name, academicYearId: data.academicYearId || null }).lean();
    if (dup) return E.conflict(res, `A class named '${data.name}' already exists`);

    const doc = await Classes.create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[classes POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/classes/:id ────────────────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('classes', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ClassSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    delete data.schoolId; delete data.id;

    const Classes = _model('classes');
    const doc = await Classes.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();

    if (!doc) return E.notFound(res, 'Class not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[classes PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/classes/:id ─ Soft-delete ───────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('classes', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Classes = _model('classes');
    const doc = await Classes.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Class not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[classes DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
