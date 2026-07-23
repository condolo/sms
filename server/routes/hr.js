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
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { _model } = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const AuditService = require('../services/audit');
const { dispatchNotification } = require('../utils/notify-dispatch');
const email = require('../utils/email');
const {
  getWorkflowConfig, saveWorkflowConfig, resolveStep, resolveAssigneeLabel,
} = require('../utils/workflow-config');

const LEAVE_WORKFLOW_KEY = 'leave_approval';
const LEAVE_MIN_STEPS    = 2; // platform floor: >=2 steps before HR's own final step

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
    /* Non-HR staff see their own requests, plus (if a leave chain is
       configured) any pending request currently awaiting a step they're
       eligible to act on — otherwise a HOD/Principal step approver could
       never see the requests they need to advance. */
    if (!HR_ROLES.has(role)) {
      const ctx = tenantContext(req);
      const config = await getWorkflowConfig(ctx, schoolId, LEAVE_WORKFLOW_KEY);
      const eligibleStepOrders = [];
      if (config) {
        for (const step of config.steps) {
          const eligible = await resolveStep(ctx, schoolId, step);
          if (eligible.some(u => u.id === userId)) eligibleStepOrders.push(step.order);
        }
      }
      filter.$or = eligibleStepOrders.length
        ? [{ staffId: userId }, { currentStepOrder: { $in: eligibleStepOrders } }]
        : [{ staffId: userId }];
    } else {
      if (staffId) filter.staffId = staffId;
    }
    if (status) filter.status = status;

    const [docs, total] = await Promise.all([
      tenantModel('leave_requests', tenantContext(req)).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('leave_requests', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hr/leave GET]', err);
    return E.serverError(res);
  }
});

/* ── Leave workflow helpers ──────────────────────────────────── */

async function _sendSystemMessage(req, recipientUserId, subject, body) {
  const { schoolId, userId: senderId } = req.jwtUser;
  await tenantModel('messages', tenantContext(req)).create({
    id: uuidv4(),
    schoolId,
    senderId,
    senderName: 'System',
    senderRole: 'system',
    recipients: [recipientUserId],
    subject,
    body,
    type: 'direct',
    isRead: {},
    createdAt: new Date().toISOString(),
  });
}

async function _notifyStep(req, step, leaveDoc, text) {
  try {
    const { schoolId } = req.jwtUser;
    const eligible = await resolveStep(tenantContext(req), schoolId, step);
    for (const u of eligible) await _sendSystemMessage(req, u.id, 'Leave request pending your review', text);
  } catch (err) { console.error('[hr/leave notify step]', err); }
}

async function _notifyHr(req, text) {
  try {
    const { schoolId } = req.jwtUser;
    const hrUsers = await tenantModel('users', tenantContext(req))
      .find({ schoolId, role: 'hr', isActive: { $ne: false } }).select('id').lean();
    for (const u of hrUsers) await _sendSystemMessage(req, u.id, 'Leave request ready for HR confirmation', text);
  } catch (err) { console.error('[hr/leave notify hr]', err); }
}

async function _notifyOnlyParties(req, config, text) {
  if (!config?.notifyOnly?.length) return;
  try {
    const { schoolId } = req.jwtUser;
    const Users = tenantModel('users', tenantContext(req));
    for (const party of config.notifyOnly) {
      const users = party.assigneeType === 'user'
        ? await Users.find({ id: party.assigneeValue, schoolId }).select('id').lean()
        : await Users.find({ schoolId, $or: [{ role: party.assigneeValue }, { roles: party.assigneeValue }, { extraRoles: party.assigneeValue }] }).select('id').lean();
      for (const u of users) await _sendSystemMessage(req, u.id, 'Leave request update', text);
    }
  } catch (err) { console.error('[hr/leave notifyOnly]', err); }
}

function _leaveSummary(doc) {
  return `${doc.staffName || 'A staff member'} — ${doc.type} leave, ${doc.startDate} to ${doc.endDate}.`;
}

/* GET/PUT /api/hr/leave/workflow-config — school-configured approval chain (Governance Spec §0/§1) */
router.get('/leave/workflow-config', rbac('hr', 'manage_workflow'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const config = await getWorkflowConfig(tenantContext(req), schoolId, LEAVE_WORKFLOW_KEY);
    return ok(res, config || { schoolId, workflowKey: LEAVE_WORKFLOW_KEY, steps: [], notifyOnly: [] });
  } catch (err) {
    console.error('[hr/leave/workflow-config GET]', err);
    return E.serverError(res);
  }
});

router.put('/leave/workflow-config', rbac('hr', 'manage_workflow'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { steps, notifyOnly } = req.body;
    const doc = await saveWorkflowConfig(tenantContext(req), schoolId, LEAVE_WORKFLOW_KEY, { steps, notifyOnly }, userId, LEAVE_MIN_STEPS);
    return ok(res, doc);
  } catch (err) {
    if (err.statusCode === 400) return E.badRequest(res, err.message);
    console.error('[hr/leave/workflow-config PUT]', err);
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

    const config = await getWorkflowConfig(tenantContext(req), schoolId, LEAVE_WORKFLOW_KEY);

    const doc = await tenantModel('leave_requests', tenantContext(req)).create({
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
      currentStepOrder: config ? 1 : null,
      createdBy:     userId,
      createdAt:     new Date().toISOString(),
    });
    const plain = doc.toObject ? doc.toObject() : doc;

    if (config) await _notifyStep(req, config.steps[0], plain, _leaveSummary(plain));

    return created(res, plain);
  } catch (err) {
    console.error('[hr/leave POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/hr/leave/:id/advance — approve/reject a school-configured chain step
   (schools with no workflow_configs doc never reach a state where this applies —
   currentStepOrder stays null and /resolve alone handles them, unchanged). */
router.patch('/leave/:id/advance', authMiddleware, async (req, res) => {
  try {
    const { schoolId, userId, name, role, email } = req.jwtUser;
    const { status, notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return E.badRequest(res, 'status must be "approved" or "rejected"');
    }
    if (status === 'rejected' && !notes?.trim()) {
      return E.badRequest(res, 'A reason is required to reject a leave request');
    }

    const ctx   = tenantContext(req);
    const Leave = tenantModel('leave_requests', ctx);
    const existing = await Leave.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Leave request not found');
    if (existing.status !== 'pending') return E.badRequest(res, 'This request has already been resolved');

    const config = await getWorkflowConfig(ctx, schoolId, LEAVE_WORKFLOW_KEY);
    if (!config) return E.badRequest(res, 'No approval chain is configured for this school');

    const stepOrder = existing.currentStepOrder;
    if (!stepOrder || stepOrder > config.steps.length) {
      return E.badRequest(res, 'This request is not at a configurable chain step');
    }
    const step = config.steps.find(s => s.order === stepOrder);
    if (!step) return E.serverError(res);

    const eligible = await resolveStep(ctx, schoolId, step);
    if (!eligible.some(u => u.id === userId)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not an approver at this step' } });
    }

    const resolvedRoleLabel = await resolveAssigneeLabel(ctx, schoolId, step.assigneeType, step.assigneeValue);
    const actor = { userId, role, email };

    if (status === 'rejected') {
      const doc = await Leave.findOneAndUpdate(
        { id: req.params.id, schoolId },
        { $set: { status: 'rejected', resolvedBy: name ?? '', resolvedById: userId, resolvedAt: new Date().toISOString(), notes: notes ?? '' } },
        { new: true }
      ).lean();
      await AuditService.log({
        action: 'leave.step_rejected', actor, schoolId,
        target: { type: 'leave_request', id: doc.id },
        details: { comment: notes ?? '', stepOrder, resolvedRoleLabel },
        req,
      });
      await _notifyOnlyParties(req, config, `${_leaveSummary(doc)} Rejected at step ${stepOrder}: ${notes}`);
      return ok(res, doc);
    }

    const nextStepOrder = stepOrder + 1;
    const doc = await Leave.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { currentStepOrder: nextStepOrder } },
      { new: true }
    ).lean();

    await AuditService.log({
      action: 'leave.step_approved', actor, schoolId,
      target: { type: 'leave_request', id: doc.id },
      details: { comment: notes ?? '', stepOrder, resolvedRoleLabel },
      req,
    });

    if (nextStepOrder <= config.steps.length) {
      const nextStep = config.steps.find(s => s.order === nextStepOrder);
      if (nextStep) await _notifyStep(req, nextStep, doc, _leaveSummary(doc));
    } else {
      await _notifyHr(req, `${_leaveSummary(doc)} Cleared the full approval chain — needs HR confirmation.`);
    }
    await _notifyOnlyParties(req, config, `${_leaveSummary(doc)} Approved at step ${stepOrder}.`);

    return ok(res, doc);
  } catch (err) {
    console.error('[hr/leave PATCH advance]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/hr/leave/:id/resolve — HR's final confirmation (or, for schools with
   no configured chain, the single-step legacy resolution — unchanged behavior). */
router.patch('/leave/:id/resolve', rbac('hr', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, name, role, email } = req.jwtUser;

    const { status, notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return E.badRequest(res, 'status must be "approved" or "rejected"');
    }
    if (status === 'rejected' && !notes?.trim()) {
      return E.badRequest(res, 'A reason is required to reject a leave request');
    }

    const ctx   = tenantContext(req);
    const Leave = tenantModel('leave_requests', ctx);
    const existing = await Leave.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Leave request not found');
    if (existing.status !== 'pending') return E.badRequest(res, 'This request has already been resolved');

    const config = await getWorkflowConfig(ctx, schoolId, LEAVE_WORKFLOW_KEY);
    if (config && (existing.currentStepOrder ?? 0) <= config.steps.length) {
      return E.badRequest(res, 'An earlier step in the approval chain is still pending');
    }

    const doc = await Leave.findOneAndUpdate(
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

    await AuditService.log({
      action: status === 'approved' ? 'leave.hr_confirmed' : 'leave.hr_rejected',
      actor: { userId, role, email }, schoolId,
      target: { type: 'leave_request', id: doc.id },
      details: { comment: notes ?? '', stepOrder: config ? config.steps.length + 1 : 1, resolvedRoleLabel: 'HR' },
      req,
    });
    if (config) await _notifyOnlyParties(req, config, `${_leaveSummary(doc)} HR ${status === 'approved' ? 'confirmed' : 'rejected'} this request.`);

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
      tenantModel('payroll', tenantContext(req)).find(filter).sort({ payPeriod: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('payroll', tenantContext(req)).countDocuments(filter),
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
      tenantModel('payroll', tenantContext(req)).find(filter).sort({ payPeriod: -1, staffName: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('payroll', tenantContext(req)).countDocuments(filter),
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

    // Snapshot the school's currency onto the record at creation time —
    // same "stamp it once, never recompute" posture finance.js uses for
    // invoices (finance.js's InvoiceCreateSchema). Only set on insert, not
    // on later edits, so a mid-year currency change never silently
    // reinterprets an already-created payroll record's figures.
    const school = await _model('schools').findOne({ id: schoolId }, { currency: 1 }).lean();
    const currency = school?.currency || 'KES';

    const doc = await tenantModel('payroll', tenantContext(req)).findOneAndUpdate(
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
          currency,
          status:    'draft',
          createdBy: userId,
          createdAt: now,
        },
      },
      { upsert: true, new: true, runValidators: false }
    ).lean();

    await AuditService.log({
      action: 'payroll.record_saved', actor: { userId, role: req.jwtUser.role, email: req.jwtUser.email },
      schoolId, target: { type: 'payroll', id: doc.id },
      details: { staffId: doc.staffId, payPeriod: doc.payPeriod, netSalary: doc.netSalary }, req,
    });

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

    const doc = await tenantModel('payroll', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { status, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Payroll record not found');

    // 'paid' is the highest-stakes transition (money has actually moved,
    // per the admin's own attestation) — same 'critical' treatment
    // report_card.publish gets; everything else stays at the catalogue's
    // 'warn' default.
    await AuditService.log({
      action: 'payroll.status_changed', actor: { userId, role, email: req.jwtUser.email },
      schoolId, target: { type: 'payroll', id: doc.id },
      details: { staffId: doc.staffId, payPeriod: doc.payPeriod, status },
      ...(status === 'paid' ? { severity: 'critical' } : {}), req,
    });

    // Notify the staff member their payroll moved — only for the two
    // states an employee actually cares about ("it's confirmed" / "you've
    // been paid"). Reverting to 'draft' isn't a notify-worthy event and
    // could read as alarming without context, so it's deliberately excluded.
    if (status === 'confirmed' || status === 'paid') {
      try {
        const staffUser = await tenantModel('users', tenantContext(req))
          .findOne({ id: doc.staffId, schoolId }).select('name email').lean();
        if (staffUser?.email) {
          const school = await _model('schools').findOne({ id: schoolId }, { name: 1, systemEmail: 1 }).lean();
          const subject = `Payroll ${status === 'paid' ? 'payment processed' : 'confirmed'} — ${doc.payPeriod}`;
          const body    = `Your payroll record for ${doc.payPeriod} has been marked as ${status}. Net pay: ${doc.currency || 'KES'} ${Number(doc.netSalary || 0).toLocaleString()}.`;
          await dispatchNotification({
            ctx: tenantContext(req), schoolId, eventKey: 'payroll_status_changed', actorUserId: userId,
            recipients: [{ userId: doc.staffId, name: staffUser.name, email: staffUser.email }],
            inAppSubject: subject, inAppBody: body,
            emailDigestSubject: subject, emailDigestBody: body,
            sendEmail: (recipient) => email.sendPayrollStatusEmail({
              recipientName: recipient.name, recipientEmail: recipient.email,
              payPeriod: doc.payPeriod, status, netSalary: doc.netSalary, currency: doc.currency,
              schoolName: school?.name || '', schoolEmail: school?.systemEmail || '', schoolId,
            }),
          });
        }
      } catch (err) {
        // Notification failure must never block the status change itself.
        console.error('[hr/payroll PATCH status] notify failed:', err.message);
      }
    }

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

    const Payroll = tenantModel('payroll', tenantContext(req));
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
        currency:    p.currency || 'KES',
        notes:       p.notes ?? '',
        status:      'draft',
        createdBy:   userId,
        createdAt:   now,
        updatedAt:   now,
      });
      copied++;
    }));

    await AuditService.log({
      action: 'payroll.copied', actor: { userId, role: req.jwtUser.role, email: req.jwtUser.email },
      schoolId, target: { type: 'payroll', id: null },
      details: { sourcePeriod, targetPeriod, copied }, req,
    });

    return ok(res, { copied, message: `${copied} record${copied !== 1 ? 's' : ''} copied to ${targetPeriod}` });
  } catch (err) {
    console.error('[hr/payroll/copy POST]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/hr/payroll/:id — remove a payroll record by its ID */
router.delete('/payroll/:id', rbac('hr', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    const doc = await tenantModel('payroll', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Payroll record not found');

    /* Only admins can delete confirmed/paid records */
    const isLocked = ['confirmed', 'paid'].includes(doc.status);
    if (isLocked && !ADMIN_ROLES.has(role)) {
      return E.forbidden(res, 'Only Admin can delete confirmed or paid payroll records');
    }

    await tenantModel('payroll', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });

    // Deleting a confirmed/paid record removes a financial record an admin
    // already attested was real money — same 'critical' bar as marking one
    // 'paid' in the first place. A still-draft record is routine cleanup.
    await AuditService.log({
      action: 'payroll.deleted', actor: { userId, role, email: req.jwtUser.email },
      schoolId, target: { type: 'payroll', id: doc.id },
      details: { staffId: doc.staffId, payPeriod: doc.payPeriod, status: doc.status, netSalary: doc.netSalary },
      ...(isLocked ? { severity: 'critical' } : {}), req,
    });

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
      tenantModel('staff_documents', tenantContext(req)).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('staff_documents', tenantContext(req)).countDocuments(filter),
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

    const doc = await tenantModel('staff_documents', tenantContext(req)).create({
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

    const doc = await tenantModel('staff_documents', tenantContext(req)).findOneAndUpdate(
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

    const doc = await tenantModel('staff_documents', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
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
      tenantModel('teachers', tenantContext(req)).aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:      null,
            total:    { $sum: 1 },
            active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] },   1, 0] } },
            onLeave:  { $sum: { $cond: [{ $eq: ['$status', 'on_leave'] }, 1, 0] } },
        }},
      ]),
      tenantModel('leave_requests', tenantContext(req)).countDocuments({ schoolId, status: 'pending' }),
      tenantModel('payroll', tenantContext(req)).aggregate([
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
