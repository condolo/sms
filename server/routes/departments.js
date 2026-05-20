/* ============================================================
   Msingi — /api/departments
   School-editable department registry. Each department owns a
   set of subjects and may have a Head of Department (HoD).
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { _model }         = require('../utils/model');
const { ok, created, E, parsePagination } = require('../utils/response');

const router = express.Router();

/* ── Validation ─────────────────────────────────────────────── */
const DeptSchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  code:        z.string().min(1).max(20).trim().toUpperCase(),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#6366F1'),
  hodId:       z.string().optional().nullable(),
  hodName:     z.string().optional().nullable(),
  description: z.string().max(500).optional(),
  order:       z.number().int().min(0).optional().default(0),
});

function _v(data) {
  const r = DeptSchema.partial().required({ name: true, code: true }).safeParse(data);
  return r.success ? { data: r.data } : { error: r.error.issues.map(i => i.message).join('; ') };
}

/* ── GET /api/departments — list all + embedded subject counts ─ */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Dept    = _model('departments');
    const Subject = _model('subjects');

    const [depts, subjects] = await Promise.all([
      Dept.find({ schoolId, isActive: { $ne: false } })
          .sort({ order: 1, name: 1 }).limit(200).select('-__v').lean(),
      Subject.find({ schoolId, isActive: { $ne: false } })
             .select('departmentId').lean(),
    ]);

    // Embed subject count per department
    const counts = {};
    subjects.forEach(s => { counts[s.departmentId] = (counts[s.departmentId] || 0) + 1; });

    const result = depts.map(d => ({ ...d, subjectCount: counts[d.id] ?? 0 }));
    return ok(res, result);
  } catch (err) { console.error('[departments GET /]', err); return E.serverError(res); }
});

/* ── GET /api/departments/:id ──────────────────────────────── */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('departments').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Department not found');
    return ok(res, doc);
  } catch (err) { console.error('[departments GET /:id]', err); return E.serverError(res); }
});

/* ── POST /api/departments — create ────────────────────────── */
router.post('/', authMiddleware, rbac('departments', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _v(req.body);
    if (error) return E.badRequest(res, error);

    const Dept = _model('departments');
    const dup  = await Dept.findOne({ schoolId, code: data.code }).lean();
    if (dup) return E.conflict(res, `Department code '${data.code}' already exists`);

    const doc = await Dept.create({
      ...data, id: uuidv4(), schoolId, isActive: true,
      createdBy: userId, updatedBy: userId,
    });
    return created(res, doc.toObject());
  } catch (err) { console.error('[departments POST /]', err); return E.serverError(res); }
});

/* ── PUT /api/departments/:id — update ─────────────────────── */
router.put('/:id', authMiddleware, rbac('departments', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _v(req.body);
    if (error) return E.badRequest(res, error);

    // Code uniqueness (exclude self)
    if (data.code) {
      const conflict = await _model('departments').findOne({
        schoolId, code: data.code, id: { $ne: req.params.id },
      }).lean();
      if (conflict) return E.conflict(res, `Department code '${data.code}' already used`);
    }

    const doc = await _model('departments').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true },
    );
    if (!doc) return E.notFound(res, 'Department not found');
    return ok(res, doc.toObject());
  } catch (err) { console.error('[departments PUT /:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/departments/:id — soft-delete ─────────────── */
router.delete('/:id', authMiddleware, rbac('departments', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    // Block if subjects still active in this department
    const subjectCount = await _model('subjects').countDocuments({
      schoolId, departmentId: req.params.id, isActive: { $ne: false },
    });
    if (subjectCount > 0) {
      return E.badRequest(res, `Cannot delete — ${subjectCount} active subject(s) still in this department. Move or deactivate them first.`);
    }

    const doc = await _model('departments').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { isActive: false, updatedBy: userId },
      { new: true },
    );
    if (!doc) return E.notFound(res, 'Department not found');
    return ok(res, { message: 'Department deactivated' });
  } catch (err) { console.error('[departments DELETE /:id]', err); return E.serverError(res); }
});

module.exports = router;
