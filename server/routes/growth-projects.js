/* ============================================================
   Msingi — /api/growth-projects
   CRUD + verification for Growth Profile: Projects section.

   Projects differ from other records because they have a
   supervisor (teacher) reference. The supervisor's name is
   denormalized at creation time — if the teacher is later
   soft-deleted, the name is preserved on the project record.

   Plan: standard | RBAC: growth_profile:{read,create,update,delete}
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
const PLAN   = planGate('growth_profile');

/* ── Validation ─────────────────────────────────────────────── */
const ProjectSchema = z.object({
  studentId:      z.string().min(1),
  title:          z.string().min(1).max(200).trim(),
  description:    z.string().max(3000).trim().optional(),
  category:       z.string().max(100).trim().optional(),
  subjectArea:    z.string().max(200).trim().optional(),
  supervisorId:   z.string().optional(),
  supervisorName: z.string().max(200).trim().optional(),
  startDate:      z.string().optional(),
  endDate:        z.string().optional(),
  status:         z.enum(['planning','in_progress','completed','published']).default('in_progress'),
  outcome:        z.string().max(1000).trim().optional(),
  evidenceUrls:   z.array(z.string().url()).max(5).default([]),
  isPublic:       z.boolean().default(true),
});

const VerifySchema = z.object({
  status: z.enum(['institution_verified','staff_verified','pending_verification','rejected']),
  notes:  z.string().max(1000).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/growth-projects ───────────────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.studentId)          filter.studentId          = req.query.studentId;
    if (req.query.supervisorId)       filter.supervisorId       = req.query.supervisorId;
    if (req.query.status)             filter.status             = req.query.status;
    if (req.query.verificationStatus) filter.verificationStatus = req.query.verificationStatus;

    const [docs, total] = await Promise.all([
      _model('growth_projects').find(filter).sort({ startDate: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      _model('growth_projects').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[growth-projects GET]', err); return E.serverError(res); }
});

/* ── GET /api/growth-projects/:id ───────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('growth_projects').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Project not found');
    return ok(res, doc);
  } catch (err) { console.error('[growth-projects GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/growth-projects ──────────────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('growth_profile', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ProjectSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await _model('growth_projects').create({
      ...data,
      id:                 uuidv4(),
      schoolId,
      verificationStatus: 'pending_verification',
      createdBy:          userId,
      updatedBy:          userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[growth-projects POST]', err); return E.serverError(res); }
});

/* ── PUT /api/growth-projects/:id ───────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('growth_profile', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ProjectSchema.partial().omit({ studentId: true }), req.body);
    if (error) return E.validation(res, error);

    delete data.verificationStatus; delete data.verifiedBy; delete data.verifiedAt;
    delete data.schoolId; delete data.id;

    const doc = await _model('growth_projects').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId, updatedAt: new Date().toISOString() },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Project not found');
    return ok(res, doc);
  } catch (err) { console.error('[growth-projects PUT/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/growth-projects/:id ────────────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('growth_profile', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('growth_projects').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Project not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[growth-projects DELETE/:id]', err); return E.serverError(res); }
});

/* ── PATCH /api/growth-projects/:id/verify ──────────────────── */
router.patch('/:id/verify', authMiddleware, PLAN, async (req, res) => { // rbac: staff/admin (inline role check)
  try {
    const { schoolId, userId, role } = req.jwtUser;

    const CAN_VERIFY = ['admin', 'superadmin', 'teacher', 'section_head', 'deputy_principal'];
    if (!CAN_VERIFY.includes(role)) {
      return E.forbidden(res, 'Only admin or teaching staff can verify project records');
    }

    const { data, error } = _validate(VerifySchema, req.body);
    if (error) return E.validation(res, error);

    const STAFF_TIER = ['teacher', 'section_head'];
    if (STAFF_TIER.includes(role) && data.status === 'institution_verified') {
      return E.forbidden(res, 'Teachers can only set staff verification. Institution verification requires admin or deputy principal.');
    }

    const now = new Date().toISOString();
    const doc = await _model('growth_projects').findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        verificationStatus: data.status,
        verificationNotes:  data.notes || '',
        verifiedBy:         userId,
        verifiedAt:         now,
        updatedBy:          userId,
        updatedAt:          now,
      },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Project not found');
    return ok(res, doc);
  } catch (err) { console.error('[growth-projects PATCH/:id/verify]', err); return E.serverError(res); }
});

module.exports = router;
