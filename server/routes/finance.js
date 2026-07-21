/* ============================================================
   Msingi — /api/finance  (Invoices + Payments)
   Server-side RBAC + plan gating (premium)
   All financial calculations done server-side.
   Server generates invoice/receipt numbers via atomic counter.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }               = require('../middleware/auth');
const { rbac }                         = require('../middleware/rbac');
const { planGate }                     = require('../middleware/plan');
const { _model }                       = require('../utils/model');
const { tenantModel, tenantContext }   = require('../utils/tenant-model');
const { nextInvoiceNumber, nextReceiptNumber } = require('../utils/counters');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');
const AuditService = require('../services/audit');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const email = require('../utils/email');

const router = express.Router();
const PLAN   = planGate('finance');

/* ── Helpers ────────────────────────────────────────────────── */
/** Round to 2 decimal places to avoid floating-point drift */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Recalculate invoice totals from line items.
 * Returns: { subtotal, discountAmount, taxAmount, total }
 */
function _calcInvoiceTotals(lineItems = [], discountPct = 0, taxPct = 0) {
  const subtotal       = _round(lineItems.reduce((s, i) => s + _round((i.unitPrice || 0) * (i.quantity || 1)), 0));
  const discountAmount = _round(subtotal * (Math.min(Math.max(discountPct, 0), 100) / 100));
  const taxableAmount  = _round(subtotal - discountAmount);
  const taxAmount      = _round(taxableAmount * (Math.min(Math.max(taxPct, 0), 100) / 100));
  const total          = _round(taxableAmount + taxAmount);
  return { subtotal, discountAmount, taxAmount, total };
}

/**
 * Recalculate balance due on an invoice given existing payments.
 */
function _calcBalance(invoiceTotal, payments = []) {
  const paid    = _round(payments.reduce((s, p) => s + (p.amount || 0), 0));
  const balance = _round(invoiceTotal - paid);
  return { paid, balance, status: balance <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid') };
}

/* ── Validation schemas ─────────────────────────────────────── */
const LineItemSchema = z.object({
  description: z.string().min(1).max(200),
  quantity:    z.number().positive().default(1),
  unitPrice:   z.number().min(0),
  feeType:     z.string().optional(),    // 'tuition', 'uniform', 'trip', etc.
});

const InvoiceCreateSchema = z.object({
  studentId:   z.string().min(1),
  title:       z.string().min(1).max(200).default('School Fee Invoice'),
  dueDate:     z.string().optional(),
  academicYearId: z.string().optional(),
  termId:      z.string().optional(),
  lineItems:   z.array(LineItemSchema).min(1),
  discountPct: z.number().min(0).max(100).default(0),
  taxPct:      z.number().min(0).max(100).default(0),
  currency:    z.string().length(3).optional(),
  notes:       z.string().max(1000).optional(),
});

const PaymentCreateSchema = z.object({
  invoiceId:    z.string().min(1),
  amount:       z.number().positive(),
  method:       z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'mpesa', 'online', 'other']),
  mpesaCode:    z.string().max(20).optional(),
  paidAt:       z.string().optional(),   // ISO date; defaults to now
  reference:    z.string().max(100).optional(),
  notes:        z.string().max(500).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   INVOICES
   ══════════════════════════════════════════════════════════════ */

/* ── GET /api/finance/invoices ───────────────────────────────── */
router.get('/invoices', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _sid = strParam(req.query.studentId);
    const _st  = strParam(req.query.status);
    const _ay  = strParam(req.query.academicYearId);
    const _tid = strParam(req.query.termId);
    if (_sid) filter.studentId    = _sid;
    if (_st)  filter.status       = _st;
    if (_ay)  filter.academicYearId = _ay;
    if (_tid) filter.termId       = _tid;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ invoiceNumber: rx }, { title: rx }];
    }

    const Invoices = tenantModel('invoices', tenantContext(req));
    const [docs, total] = await Promise.all([
      Invoices.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Invoices.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[finance GET /invoices]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/finance/invoices/:id ───────────────────────────── */
router.get('/invoices/:id', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Invoices = tenantModel('invoices', tenantContext(req));
    const doc = await Invoices.findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Invoice not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[finance GET /invoices/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/finance/invoices ─ Create invoice ────────────── */
router.post('/invoices', authMiddleware, PLAN, rbac('finance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(InvoiceCreateSchema, req.body);
    if (error) return E.validation(res, error);

    // Server-side financial calculations — client totals are ignored
    const totals        = _calcInvoiceTotals(data.lineItems, data.discountPct, data.taxPct);
    const invoiceNumber = await nextInvoiceNumber(schoolId);

    // Use school's currency if client didn't specify — never default to GBP
    if (!data.currency) {
      const school = await _model('schools').findOne({ id: schoolId }, { currency: 1 }).lean();
      data.currency = school?.currency || 'KES';
    }

    const Invoices = tenantModel('invoices', tenantContext(req));
    const doc = await Invoices.create({
      ...data,
      id:            uuidv4(),
      schoolId,
      invoiceNumber,
      ...totals,
      amountPaid:    0,
      balance:       totals.total,
      status:        'unpaid',
      createdBy:     userId,
      updatedBy:     userId,
    });

    AuditService.log({ action: 'finance.invoice_created', actor: req.jwtUser, schoolId, target: { type: 'invoice', id: doc.id, label: invoiceNumber }, details: { studentId: data.studentId, total: totals.total, currency: data.currency }, req });
    _notifyInvoiceCreated(req, doc.toObject ? doc.toObject() : doc).catch(err => console.error('[finance/invoices notify]', err));
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[finance POST /invoices]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/finance/invoices/:id ─ Update invoice ─────────── */
router.put('/invoices/:id', authMiddleware, PLAN, rbac('finance', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(InvoiceCreateSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    // Re-calculate totals if line items / discounts changed
    const Invoices  = tenantModel('invoices', tenantContext(req));
    const existing  = await Invoices.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Invoice not found');

    if (existing.status === 'paid') {
      return E.badRequest(res, 'Cannot edit a fully paid invoice');
    }

    const lineItems  = data.lineItems  || existing.lineItems;
    const discountPct = data.discountPct !== undefined ? data.discountPct : existing.discountPct;
    const taxPct      = data.taxPct     !== undefined ? data.taxPct     : existing.taxPct;
    const totals      = _calcInvoiceTotals(lineItems, discountPct, taxPct);

    // Recalculate balance from stored payments
    const Payments  = tenantModel('payments', tenantContext(req));
    const payments  = await Payments.find({ invoiceId: req.params.id, schoolId }).lean();
    const bal       = _calcBalance(totals.total, payments);

    const clientVersion = data._v;
    delete data.invoiceNumber; delete data.schoolId; delete data.id; delete data._v;

    const { doc, conflict } = await applyOptimisticLock(
      Invoices,
      { id: req.params.id, schoolId },
      { ...data, ...totals, amountPaid: bal.paid, balance: bal.balance, status: bal.status, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'This invoice was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Invoice not found');
    AuditService.log({ action: 'finance.invoice_updated', actor: req.jwtUser, schoolId, target: { type: 'invoice', id: req.params.id }, details: { total: doc.total }, req });
    return ok(res, doc);
  } catch (err) {
    console.error('[finance PUT /invoices/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/finance/invoices/:id ─ Void invoice ────────── */
router.delete('/invoices/:id', authMiddleware, PLAN, rbac('finance', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Invoices = tenantModel('invoices', tenantContext(req));
    const doc      = await Invoices.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Invoice not found');

    if (doc.status === 'paid') {
      return E.badRequest(res, 'Cannot void a fully paid invoice. Issue a refund instead.');
    }

    await Invoices.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'voided', voidedAt: new Date().toISOString(), voidedBy: userId }
    );

    AuditService.log({ action: 'finance.invoice_voided', actor: req.jwtUser, schoolId, target: { type: 'invoice', id: req.params.id, label: doc.invoiceNumber }, details: { studentId: doc.studentId, total: doc.total }, req });
    return ok(res, { id: req.params.id, voided: true });
  } catch (err) {
    console.error('[finance DELETE /invoices/:id]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   PAYMENTS
   ══════════════════════════════════════════════════════════════ */

/* ── GET /api/finance/payments ───────────────────────────────── */
router.get('/payments', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.invoiceId)  filter.invoiceId  = req.query.invoiceId;
    if (req.query.studentId)  filter.studentId  = req.query.studentId;
    if (req.query.method)     filter.method     = req.query.method;

    if (req.query.dateFrom || req.query.dateTo) {
      filter.paidAt = {};
      if (req.query.dateFrom) filter.paidAt.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.paidAt.$lte = req.query.dateTo;
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ receiptNumber: rx }, { reference: rx }];
    }

    const Payments = tenantModel('payments', tenantContext(req));
    const [docs, total] = await Promise.all([
      Payments.find(filter).sort({ paidAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Payments.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[finance GET /payments]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/finance/payments ─ Record payment ────────────── */
router.post('/payments', authMiddleware, PLAN, rbac('finance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(PaymentCreateSchema, req.body);
    if (error) return E.validation(res, error);

    // Load the invoice and verify it belongs to this school
    const Invoices = tenantModel('invoices', tenantContext(req));
    const invoice  = await Invoices.findOne({ id: data.invoiceId, schoolId }).lean();
    if (!invoice) return E.notFound(res, 'Invoice not found');
    if (invoice.status === 'voided') return E.badRequest(res, 'Cannot record payment on a voided invoice');

    // Validate payment amount doesn't exceed outstanding balance
    const maxPayable = _round(invoice.balance || (invoice.total - (invoice.amountPaid || 0)));
    if (_round(data.amount) > _round(maxPayable + 0.01)) { // 1p tolerance for rounding
      return E.badRequest(res, `Payment amount (${data.amount}) exceeds outstanding balance (${maxPayable})`);
    }

    const receiptNumber = await nextReceiptNumber(schoolId);

    const Payments = tenantModel('payments', tenantContext(req));
    const payment  = await Payments.create({
      ...data,
      id:            uuidv4(),
      schoolId,
      studentId:     invoice.studentId,
      receiptNumber,
      paidAt:        data.paidAt || new Date().toISOString(),
      recordedBy:    userId,
      createdBy:     userId,
    });

    // Recalculate from ALL payments (including the one just created).
    // This is safe against concurrent payment recording: if two payments were
    // created simultaneously and the combined total exceeds the invoice, the
    // resulting negative balance is caught here, the new payment is rolled back,
    // and the caller gets a clear error message.
    const allPayments = await Payments.find({ invoiceId: data.invoiceId, schoolId }).lean();
    const bal         = _calcBalance(invoice.total, allPayments);

    if (bal.balance < -0.01) {
      // Concurrent overpayment detected — delete the just-created payment
      await Payments.deleteOne({ _id: payment._id });
      const freshInv = await Invoices.findOne({ id: data.invoiceId, schoolId }).lean();
      const remaining = _round(freshInv?.balance ?? 0);
      return E.badRequest(res, `Payment would cause an overpayment. Current outstanding balance is ${remaining}. Please refresh and try again.`);
    }

    await Invoices.findOneAndUpdate(
      { id: data.invoiceId },
      { amountPaid: bal.paid, balance: bal.balance, status: bal.status, updatedBy: userId }
    );

    AuditService.log({ action: 'finance.payment_recorded', actor: req.jwtUser, schoolId, target: { type: 'payment', id: payment.id, label: receiptNumber }, details: { invoiceId: data.invoiceId, amount: data.amount, method: data.method, invoiceStatus: bal.status }, req });
    _notifyPaymentReceived(req, payment.toObject ? payment.toObject() : payment, { currency: invoice.currency, balance: bal.balance }).catch(err => console.error('[finance/payments notify]', err));
    return created(res, {
      payment: payment.toObject ? payment.toObject() : payment,
      invoiceStatus:  bal.status,
      invoiceBalance: bal.balance,
    });
  } catch (err) {
    console.error('[finance POST /payments]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   FEE STRUCTURES — define standard fees per class/term
   ══════════════════════════════════════════════════════════════ */
const FeeStructureSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  academicYear:z.string().max(20).optional(),
  term:        z.number().int().min(1).max(4).optional(),
  classIds:    z.array(z.string()).optional(),   // empty = all classes
  lineItems:   z.array(LineItemSchema).min(1),
  dueDate:     z.string().optional(),
  notes:       z.string().max(500).optional(),
});

/* ── GET /api/finance/fee-structures ─────────────────────────── */
router.get('/fee-structures', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const FeeStructures = tenantModel('fee_structures', tenantContext(req));
    const docs = await FeeStructures.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[finance GET /fee-structures]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/finance/fee-structures ────────────────────────── */
router.post('/fee-structures', authMiddleware, PLAN, rbac('finance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(FeeStructureSchema, req.body);
    if (error) return E.validation(res, error);

    const totals = _calcInvoiceTotals(data.lineItems);
    const FeeStructures = tenantModel('fee_structures', tenantContext(req));
    const doc = await FeeStructures.create({
      id:        uuidv4(),
      schoolId,
      createdBy: userId,
      ...data,
      total: totals.total,
    });
    AuditService.log({ action: 'finance.fee_structure_created', actor: req.jwtUser, schoolId, target: { type: 'fee_structure', id: doc.id, label: data.name }, details: { total: totals.total }, req });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[finance POST /fee-structures]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/finance/fee-structures/:id ─────────────────────── */
router.put('/fee-structures/:id', authMiddleware, PLAN, rbac('finance', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(FeeStructureSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const totals = data.lineItems ? _calcInvoiceTotals(data.lineItems) : {};
    const FeeStructures = tenantModel('fee_structures', tenantContext(req));
    const doc = await FeeStructures.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, ...(totals.total != null ? { total: totals.total } : {}), updatedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Fee structure not found');
    AuditService.log({ action: 'finance.fee_structure_updated', actor: req.jwtUser, schoolId, target: { type: 'fee_structure', id: req.params.id, label: doc.name }, req });
    return ok(res, doc);
  } catch (err) {
    console.error('[finance PUT /fee-structures/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/finance/fee-structures/:id ──────────────────── */
router.delete('/fee-structures/:id', authMiddleware, PLAN, rbac('finance', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const FeeStructures = tenantModel('fee_structures', tenantContext(req));
    const doc = await FeeStructures.findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Fee structure not found');
    AuditService.log({ action: 'finance.fee_structure_deleted', actor: req.jwtUser, schoolId, target: { type: 'fee_structure', id: req.params.id, label: doc.name }, req });
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[finance DELETE /fee-structures/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/finance/fee-structures/:id/generate ─ Bulk invoices */
router.post('/fee-structures/:id/generate', authMiddleware, PLAN, rbac('finance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const FeeStructures = tenantModel('fee_structures', tenantContext(req));
    const Students      = tenantModel('students', tenantContext(req));
    const Invoices      = tenantModel('invoices', tenantContext(req));

    const fs = await FeeStructures.findOne({ id: req.params.id, schoolId }).lean();
    if (!fs) return E.notFound(res, 'Fee structure not found');

    // Resolve target students
    const studentFilter = { schoolId, status: 'active' };
    if (fs.classIds && fs.classIds.length > 0) studentFilter.classId = { $in: fs.classIds };

    const students = await Students.find(studentFilter).lean();
    if (students.length === 0) return ok(res, { created: 0, message: 'No active students found for the given criteria' });

    // Skip students who already have an invoice from this structure (idempotent)
    const existingInvStudents = await Invoices.distinct('studentId', { schoolId, feeStructureId: fs.id });
    const existingSet = new Set(existingInvStudents);
    const targets = students.filter(s => !existingSet.has(s.id ?? s._id?.toString()));

    if (targets.length === 0) return ok(res, { created: 0, message: 'Invoices already generated for all students in this structure' });

    const totals  = _calcInvoiceTotals(fs.lineItems);
    const created_docs = [];

    for (const student of targets) {
      const invNum = await nextInvoiceNumber(schoolId);
      const inv = await Invoices.create({
        id:             uuidv4(),
        schoolId,
        invoiceNumber:  invNum,
        studentId:      student.id ?? student._id?.toString(),
        studentName:    `${student.firstName} ${student.lastName}`,
        title:          fs.name,
        lineItems:      fs.lineItems,
        dueDate:        fs.dueDate,
        academicYear:   fs.academicYear,
        term:           fs.term,
        feeStructureId: fs.id,
        ...totals,
        amountPaid: 0,
        balance:    totals.total,
        status:     'unpaid',
        createdBy:  userId,
      });
      created_docs.push(inv.toObject ? inv.toObject() : inv);
    }

    AuditService.log({ action: 'finance.bulk_invoices_generated', actor: req.jwtUser, schoolId, target: { type: 'fee_structure', id: req.params.id, label: fs.name }, details: { invoicesCreated: created_docs.length }, req });
    return created(res, { created: created_docs.length, invoices: created_docs });
  } catch (err) {
    console.error('[finance POST /fee-structures/:id/generate]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/finance/summary ─ School financial overview ────── */
router.get('/summary', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const filter = { schoolId };
    const _ay2 = strParam(req.query.academicYearId);
    if (_ay2) filter.academicYearId = _ay2;

    const Invoices = tenantModel('invoices', tenantContext(req));
    const Payments = tenantModel('payments', tenantContext(req));

    const [invoiceSummary, paymentSummary] = await Promise.all([
      Invoices.aggregate([
        { $match: filter },
        { $group: {
          _id:          null,
          totalInvoiced: { $sum: '$amount' },
          totalPaid:    { $sum: '$amountPaid' },
          totalBalance: { $sum: '$balance' },
          countInvoices: { $sum: 1 },
          countPaid:    { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          countUnpaid:  { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } },
          countPartial: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
        }}
      ]),
      Payments.aggregate([
        { $match: { schoolId } },
        { $group: { _id: '$method', totalCollected: { $sum: '$amount' }, count: { $sum: 1 } } }
      ])
    ]);

    return ok(res, {
      invoices:       invoiceSummary[0] || { totalInvoiced: 0, totalPaid: 0, totalBalance: 0 },
      paymentsByMethod: paymentSummary
    });
  } catch (err) {
    console.error('[finance GET /summary]', err);
    return E.serverError(res);
  }
});

/* ── Notification triggers (finance) ─────────────────────────── */
async function _notifyInvoiceCreated(req, invoice) {
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);
  const school = await _model('schools').findOne({ id: schoolId }).select('name systemEmail').lean();
  const schoolName  = school?.name || '';
  const schoolEmail = school?.systemEmail || '';

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'invoice_created',
    items: [{
      studentId: invoice.studentId,
      inAppSubject: `New invoice: ${invoice.invoiceNumber}`,
      inAppBody:    `A new invoice of ${invoice.currency} ${invoice.total} has been issued${invoice.dueDate ? `, due ${invoice.dueDate}` : ''}.`,
      emailDigestSubject: `New invoice — ${invoice.invoiceNumber}`,
      emailDigestBody:    `A new invoice of ${invoice.currency} ${invoice.total} has been issued.`,
      sendEmail: (recipient) => email.sendFeeInvoiceCreatedAlert({
        recipientName: recipient.name, recipientEmail: recipient.email,
        studentName: invoice.studentName || '', invoiceNumber: invoice.invoiceNumber,
        total: invoice.total, currency: invoice.currency, dueDate: invoice.dueDate,
        schoolName, schoolEmail, schoolId,
      }),
    }],
  });
}

async function _notifyPaymentReceived(req, payment, { currency, balance }) {
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);
  const school = await _model('schools').findOne({ id: schoolId }).select('name systemEmail').lean();
  const schoolName  = school?.name || '';
  const schoolEmail = school?.systemEmail || '';

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'payment_received',
    items: [{
      studentId: payment.studentId,
      inAppSubject: `Payment received — receipt ${payment.receiptNumber}`,
      inAppBody:    `A payment of ${currency} ${payment.amount} was recorded (receipt ${payment.receiptNumber}).`,
      emailDigestSubject: `Payment received — ${payment.receiptNumber}`,
      emailDigestBody:    `A payment of ${currency} ${payment.amount} was recorded.`,
      sendEmail: (recipient) => email.sendFeePaymentReceivedAlert({
        recipientName: recipient.name, recipientEmail: recipient.email,
        studentName: payment.studentName || '', receiptNumber: payment.receiptNumber,
        amount: payment.amount, currency, balance,
        schoolName, schoolEmail, schoolId,
      }),
    }],
  });
}

router._notifyInvoiceCreated   = _notifyInvoiceCreated;
router._notifyPaymentReceived  = _notifyPaymentReceived;

module.exports = router;
