/* ============================================================
   Msingi — HR & Staff
   /api/hr — Leave requests, payroll, staff documents

   Plan:  premium | Auth: authMiddleware + planGate('hr')
   RBAC:  HR_ROLES guard (superadmin / admin / hr)
          Leave submission open to all authenticated staff.

   Payroll lifecycle:  draft → confirmed → paid
   ============================================================ */
const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('hr');

/* All HR routes require auth + plan gate */
router.use(authMiddleware, PLAN);

/* ── Role helpers ────────────────────────────────────────────── */
const HR_ROLES    = new Set(['superadmin', 'admin', 'hr']);
const ADMIN_ROLES = new Set(['superadmin', 'admin']);

/* ── Validation schemas ──────────────────────────────────────── */
const LeaveSchema = z.object({
  type:          z.enum(['annual','sick','emergency','maternity','paternity','unpaid']),
  startDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  reason:        z.string().max(500).trim().optional(),
  handoverNotes: z.string().max(1000).trim().optional(),
});

const PayrollSchema = z.object({
  staffId:     z.string().min(1),
  staffName:   z.string().max(200).trim().optional().default(''),
  payPeriod:   z.string().regex(/^\d{4}-\d{2}$/, 'Pay period must be YYYY-MM'),
  basicSalary: z.coerce.number().min(0),
  allowances:  z.coerce.number().min(0).default(0),
  deductions:  z.coerce.number().min(0).default(0),
  notes:       z.string().max(500).trim().optional().default(''),
});

const DocSchema = z.object({
  staffId:    z.string().min(1),
  staffName:  z.string().max(200).trim().optional().default(''),
  name:       z.string().min(1).max(200).trim(),
  type:       z.enum(['contract','appraisal','certificate','id_copy','other']),
  issuedDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  notes:      z.string().max(1000).trim().optional().default(''),
  fileUrl:    z.union([z.string().url(), z.literal('')]).optional().default(''),
  status:     z.enum(['active','expired','archived']).default('active'),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   LEAVE REQUESTS
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hr/leave — list leave requests */
router.get('/leave', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { status, staffId, page: _page, limit: _limit } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    /* Non-HR staff only see their own requests */
    if (!HR_ROLES.has(role)) {
      filter.staffId = userId;
    } else {
      if (staffId) filter.staffId = staffId;
    }
    if (status) filter.status = status;

    const [docs, total] = await Promise.all([
      _model('leave_requests').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      _model('leave_requests').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hr/leave GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/hr/leave — submit a leave request */
router.post('/leave', async (req, res) => {
  try {
    const { schoolId, userId, name } = req.jwtUser;
    const { data, error } = _validate(LeaveSchema, req.body);
    if (error) return E.validation(res, error);

    if (new Date(data.endDate) < new Date(data.startDate)) {
      return E.badRequest(res, 'End date must be on or after start date');
    }

    const days = Math.max(1, Math.round(
      (new Date(data.endDate) - new Date(data.startDate)) / 86400000
    ) + 1);

    const doc = await _model('leave_requests').create({
      id:            `lr_${uuidv4().slice(0, 8)}`,
      schoolId,
      staffId:       userId,
      staffName:     name ?? '',
      type:          data.type,
      startDate:     data.startDate,
      endDate:       data.endDate,
      days,
      reason:        data.reason ?? '',
      handoverNotes: data.handoverNotes ?? '',
      status:        'pending',
      createdBy:     userId,
      createdAt:     new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[hr/leave POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/hr/leave/:id/resolve — approve or reject */
router.patch('/leave/:id/resolve', rbac('hr', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, name } = req.jwtUser;

    const { status, notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return E.badRequest(res, 'status must be "approved" or "rejected"');
    }

    const doc = await _model('leave_requests').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: {
          status,
          resolvedBy:   name ?? '',
          resolvedById: userId,
          resolvedAt:   new Date().toISOString(),
          notes:        notes ?? '',
        }
      },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Leave request not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[hr/leave PATCH]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   PAYROLL
   Lifecycle: draft → confirmed → paid
   Only HR_ROLES can create/edit. Only ADMIN_ROLES can delete.
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hr/payroll/mine — current user's own payslips (no HR role needed) */
router.get('/payroll/mine', async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { period } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId, staffId: userId };
    if (period) filter.payPeriod = period;

    const [docs, total] = await Promise.all([
      _model('payroll').find(filter).sort({ payPeriod: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      _model('payroll').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hr/payroll/mine GET]', err);
    return E.serverError(res);
  }
});

/* GET /api/hr/payroll — list records for a period */
router.get('/payroll', rbac('hr', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const { period, staffId } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (period)  filter.payPeriod = period;
    if (staffId) filter.staffId   = staffId;

    const [docs, total] = await Promise.all([
      _model('payroll').find(filter).sort({ payPeriod: -1, staffName: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      _model('payroll').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hr/payroll GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/hr/payroll — create or update a payroll record */
router.post('/payroll', rbac('hr', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(PayrollSchema, req.body);
    if (error) return E.validation(res, error);

    const grossSalary = data.basicSalary + data.allowances;
    const netSalary   = grossSalary - data.deductions;
    const now         = new Date().toISOString();

    const doc = await _model('payroll').findOneAndUpdate(
      { schoolId, staffId: data.staffId, payPeriod: data.payPeriod },
      {
        $set: {
          staffName:   data.staffName,
          basicSalary: data.basicSalary,
          allowances:  data.allowances,
          deductions:  data.deductions,
          grossSalary,
          netSalary,
          notes:       data.notes,
          updatedBy:   userId,
          updatedAt:   now,
          // Reset status to draft on any edit (unless it's a new record)
        },
        $setOnInsert: {
          id:        `pay_${uuidv4().slice(0, 8)}`,
          schoolId,
          staffId:   data.staffId,
          payPeriod: data.payPeriod,
          status:    'draft',
          createdBy: userId,
          createdAt: now,
        },
      },
      { upsert: true, new: true, runValidators: false }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[hr/payroll POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/hr/payroll/:id/status — advance payroll lifecycle */
router.patch('/payroll/:id/status', rbac('hr', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    const { status } = req.body;
    const VALID_STATUSES = ['draft', 'confirmed', 'paid'];
    if (!VALID_STATUSES.includes(status)) {
      return E.badRequest(res, `status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    /* Only admins can mark as "paid" */
    if (status === 'paid' && !ADMIN_ROLES.has(role)) {
      return E.forbidden(res, 'Only Admin can mark payroll as paid');
    }

    const doc = await _model('payroll').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { status, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Payroll record not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[hr/payroll PATCH status]', err);
    return E.serverError(res);
  }
});

/* POST /api/hr/payroll/copy — copy records from one period to another */
router.post('/payroll/copy', rbac('hr', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { sourcePeriod, targetPeriod } = req.body;
    if (!sourcePeriod || !targetPeriod)  return E.badRequest(res, 'sourcePeriod and targetPeriod are required');
    if (sourcePeriod === targetPeriod)    return E.badRequest(res, 'sourcePeriod and targetPeriod must differ');
    if (!/^\d{4}-\d{2}$/.test(sourcePeriod) || !/^\d{4}-\d{2}$/.test(targetPeriod)) {
      return E.badRequest(res, 'Periods must be in YYYY-MM format');
    }

    const Payroll = _model('payroll');
    const source  = await Payroll.find({ schoolId, payPeriod: sourcePeriod }).lean();
    if (!source.length) {
      return ok(res, { copied: 0, message: `No payroll records found for ${sourcePeriod}` });
    }

    const now = new Date().toISOString();
    let copied = 0;

    await Promise.all(source.map(async p => {
      const exists = await Payroll.findOne({ schoolId, staffId: p.staffId, payPeriod: targetPeriod }).lean();
      if (exists) return;
      const gross = (p.basicSalary || 0) + (p.allowances || 0);
      const net   = gross - (p.deductions || 0);
      await Payroll.create({
        id:          `pay_${uuidv4().slice(0, 8)}`,
        schoolId,
        staffId:     p.staffId,
        staffName:   p.staffName ?? '',
        payPeriod:   targetPeriod,
        basicSalary: p.basicSalary || 0,
        allowances:  p.allowances  || 0,
        deductions:  p.deductions  || 0,
        grossSalary: gross,
        netSalary:   net,
        notes:       p.notes ?? '',
        status:      'draft',
        createdBy:   userId,
        createdAt:   now,
        updatedAt:   now,
      });
      copied++;
    }));

    return ok(res, { copied, message: `${copied} record${copied !== 1 ? 's' : ''} copied to ${targetPeriod}` });
  } catch (err) {
    console.error('[hr/payroll/copy POST]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/hr/payroll/:id — remove a payroll record by its ID */
router.delete('/payroll/:id', rbac('hr', 'delete'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;

    const doc = await _model('payroll').findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Payroll record not found');

    /* Only admins can delete confirmed/paid records */
    if (['confirmed', 'paid'].includes(doc.status) && !ADMIN_ROLES.has(role)) {
      return E.forbidden(res, 'Only Admin can delete confirmed or paid payroll records');
    }

    await _model('payroll').findOneAndDelete({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[hr/payroll DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   STAFF DOCUMENTS
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hr/documents */
router.get('/documents', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { staffId } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (HR_ROLES.has(role)) {
      if (staffId) filter.staffId = staffId;
    } else {
      /* Non-HR staff can only see their own documents */
      filter.staffId = userId;
    }

    const [docs, total] = await Promise.all([
      _model('staff_documents').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      _model('staff_documents').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hr/documents GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/hr/documents */
router.post('/documents', rbac('hr', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(DocSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await _model('staff_documents').create({
      id:         `doc_${uuidv4().slice(0, 8)}`,
      schoolId,
      staffId:    data.staffId,
      staffName:  data.staffName,
      name:       data.name,
      type:       data.type,
      issuedDate: data.issuedDate ?? null,
      expiryDate: data.expiryDate ?? null,
      notes:      data.notes,
      fileUrl:    data.fileUrl,
      status:     data.status,
      createdBy:  userId,
      createdAt:  new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[hr/documents POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/hr/documents/:id */
router.put('/documents/:id', rbac('hr', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const doc = await _model('staff_documents').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...req.body, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Document not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[hr/documents PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/hr/documents/:id */
router.delete('/documents/:id', rbac('hr', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const doc = await _model('staff_documents').findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Document not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[hr/documents DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   SUMMARY — headcount + current-month payroll totals
   Uses aggregation instead of full JS-side filtering.
   ══════════════════════════════════════════════════════════════ */
router.get('/summary', rbac('hr', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const now = new Date().toISOString().slice(0, 7); // YYYY-MM

    const [teacherStats, pendingLeaves, payrollAgg] = await Promise.all([
      _model('teachers').aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:      null,
            total:    { $sum: 1 },
            active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] },   1, 0] } },
            onLeave:  { $sum: { $cond: [{ $eq: ['$status', 'on_leave'] }, 1, 0] } },
        }},
      ]),
      _model('leave_requests').countDocuments({ schoolId, status: 'pending' }),
      _model('payroll').aggregate([
        { $match: { schoolId, payPeriod: now } },
        { $group: {
            _id:            null,
            totalNetPayroll: { $sum: '$netSalary' },
            count:           { $sum: 1 },
        }},
      ]),
    ]);

    const ts = teacherStats[0] ?? { total: 0, active: 0, onLeave: 0 };
    const pa = payrollAgg[0]   ?? { totalNetPayroll: 0, count: 0 };

    return ok(res, {
      totalStaff:      ts.total,
      activeStaff:     ts.active,
      onLeave:         ts.onLeave,
      pendingLeaves,
      totalNetPayroll: pa.totalNetPayroll,
      payrollCount:    pa.count,
    });
  } catch (err) {
    console.error('[hr/summary GET]', err);
    return E.serverError(res);
  }
});

module.exports = router;
