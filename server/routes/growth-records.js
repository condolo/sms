/* ============================================================
   Msingi — /api/growth-records/:type
   CRUD + verification for Growth Profile record sections:
     leadership | activities | service | awards

   Plan: standard | RBAC: growth_profile:{read,create,update,delete}
   Verify endpoint uses server-side role guard (not RBAC middleware)
   so teachers can verify at staff level while admins can fully verify.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('growth_profile');

/* ── Allowed record types → collection names ────────────────── */
const TYPE_COLLECTIONS = {
  leadership: 'growth_leadership',
  activities: 'growth_activities',
  service:    'growth_service',
  awards:     'growth_awards',
};

/* ── Validation ─────────────────────────────────────────────── */
const RecordSchema = z.object({
  studentId:    z.string().min(1),
  title:        z.string().min(1).max(200).trim(),
  category:     z.string().max(100).trim().optional(),
  description:  z.string().max(2000).trim().optional(),
  startDate:    z.string().optional(),
  endDate:      z.string().optional(),
  achievement:  z.string().max(500).trim().optional(),
  evidenceUrl:  z.string().url().optional().or(z.literal('')),
  location:     z.string().max(200).trim().optional(),
  organization: z.string().max(200).trim().optional(),
  hours:        z.number().min(0).max(100000).optional(),   // service hours
  issuer:       z.string().max(200).trim().optional(),      // award issuer
  level:        z.enum(['school','local','regional','national','international']).optional(),
  isPublic:     z.boolean().default(true),
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

/* ── Type guard middleware ───────────────────────────────────── */
function _typeGuard(req, res, next) {
  if (!TYPE_COLLECTIONS[req.params.type]) {
    return E.badRequest(res, `Invalid record type '${req.params.type}'. Allowed: ${Object.keys(TYPE_COLLECTIONS).join(', ')}`);
  }
  next();
}

/* ── GET /api/growth-records/:type ─────────────────────────── */
router.get('/:type', authMiddleware, PLAN, rbac('growth_profile', 'read'), _typeGuard, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const col = TYPE_COLLECTIONS[req.params.type];
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId, deletedAt: { $exists: false } };
    if (req.query.studentId)          filter.studentId          = req.query.studentId;
    if (req.query.category)           filter.category           = req.query.category;
    if (req.query.verificationStatus) filter.verificationStatus = req.query.verificationStatus;

    const [docs, total] = await Promise.all([
      tenantModel(col, tenantContext(req)).find(filter).sort({ startDate: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel(col, tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error(`[growth-records GET /${req.params.type}]`, err); return E.serverError(res); }
});

/* ── GET /api/growth-records/:type/:id ──────────────────────── */
router.get('/:type/:id', authMiddleware, PLAN, rbac('growth_profile', 'read'), _typeGuard, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const col = TYPE_COLLECTIONS[req.params.type];
    const doc = await tenantModel(col, tenantContext(req)).findOne({ id: req.params.id, schoolId, deletedAt: { $exists: false } }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Record not found');
    return ok(res, doc);
  } catch (err) { console.error(`[growth-records GET /${req.params.type}/:id]`, err); return E.serverError(res); }
});

/* ── POST /api/growth-records/:type ────────────────────────── */
router.post('/:type', authMiddleware, PLAN, rbac('growth_profile', 'create'), _typeGuard, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const col = TYPE_COLLECTIONS[req.params.type];
    const { data, error } = _validate(RecordSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel(col, tenantContext(req)).create({
      ...data,
      id:                 uuidv4(),
      schoolId,
      type:               req.params.type,
      verificationStatus: 'pending_verification',
      createdBy:          userId,
      updatedBy:          userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error(`[growth-records POST /${req.params.type}]`, err); return E.serverError(res); }
});

/* ── PUT /api/growth-records/:type/:id ──────────────────────── */
router.put('/:type/:id', authMiddleware, PLAN, rbac('growth_profile', 'update'), _typeGuard, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const col = TYPE_COLLECTIONS[req.params.type];
    const { data, error } = _validate(RecordSchema.partial().omit({ studentId: true }), req.body);
    if (error) return E.validation(res, error);

    // Never allow direct mutation of verification state via PUT — use PATCH /verify
    delete data.verificationStatus; delete data.verifiedBy; delete data.verifiedAt;
    delete data.schoolId; delete data.id;

    const doc = await tenantModel(col, tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId, deletedAt: { $exists: false } },
      { ...data, updatedBy: userId, updatedAt: new Date().toISOString() },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Record not found');
    return ok(res, doc);
  } catch (err) { console.error(`[growth-records PUT /${req.params.type}/:id]`, err); return E.serverError(res); }
});

/* ── DELETE /api/growth-records/:type/:id ───────────────────────
   Soft-delete only (Governance Spec §2) — permanence is a stated
   guarantee for Growth Profile history, not an accident. Mirrors
   behaviour_incidents' existing deletedAt/deletedBy pattern, the more
   careful half of the module this brings the rest up to. The record is
   retained forever and excluded from default reads (above), never
   destroyed. */
router.delete('/:type/:id', authMiddleware, PLAN, rbac('growth_profile', 'delete'), _typeGuard, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const col = TYPE_COLLECTIONS[req.params.type];
    const doc = await tenantModel(col, tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId, deletedAt: { $exists: false } },
      { deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Record not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error(`[growth-records DELETE /${req.params.type}/:id]`, err); return E.serverError(res); }
});

/* ── PATCH /api/growth-records/:type/:id/verify ────────────── */
router.patch('/:type/:id/verify', authMiddleware, PLAN, _typeGuard, async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    // Verification requires staff role — separate from read/write RBAC
    const CAN_VERIFY = ['admin', 'superadmin', 'teacher', 'section_head', 'deputy_principal'];
    if (!CAN_VERIFY.includes(role)) {
      return E.forbidden(res, 'Only admin or teaching staff can verify growth profile records');
    }

    const { data, error } = _validate(VerifySchema, req.body);
    if (error) return E.validation(res, error);

    // Teacher-level staff may only set staff_verified — institution_verified is admin/leadership only
    const STAFF_TIER = ['teacher', 'section_head'];
    if (STAFF_TIER.includes(role) && data.status === 'institution_verified') {
      return E.forbidden(res, 'Teachers can only set staff verification. Institution verification requires admin or deputy principal.');
    }

    const col = TYPE_COLLECTIONS[req.params.type];
    const now = new Date().toISOString();
    const doc = await tenantModel(col, tenantContext(req)).findOneAndUpdate(
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
    if (!doc) return E.notFound(res, 'Record not found');
    return ok(res, doc);
  } catch (err) { console.error(`[growth-records PATCH /${req.params.type}/:id/verify]`, err); return E.serverError(res); }
});

module.exports = router;
