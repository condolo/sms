/* ============================================================
   InnoLearn — /api/finance  (Invoices + Payments)
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
const { nextInvoiceNumber, nextReceiptNumber } = require('../utils/counters');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

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
  currency:    z.string().length(3).default('GBP'),
  notes:       z.string().max(1000).optional(),
});

const PaymentCreateSchema = z.object({
  invoiceId:    z.string().min(1),
  amount:       z.number().positive(),
  method:       z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'online', 'other']),
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
    if (req.query.studentId)    filter.studentId    = req.query.studentId;
    if (req.query.status)       filter.status       = req.query.status;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)       filter.termId       = req.query.termId;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ invoiceNumber: rx }, { title: rx }];
    }

    const Invoices = _model('invoices');
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
    const Invoices = _model('invoices');
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

    const Invoices = _model('invoices');
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
    const Invoices  = _model('invoices');
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
    const Payments  = _model('payments');
    const payments  = await Payments.find({ invoiceId: req.params.id, schoolId }).lean();
    const bal       = _calcBalance(totals.total, payments);

    delete data.invoiceNumber; delete data.schoolId; delete data.id;

    const doc = await Invoices.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, ...totals, amountPaid: bal.paid, balance: bal.balance, status: bal.status, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();

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
    const Invoices = _model('invoices');
    const doc      = await Invoices.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Invoice not found');

    if (doc.status === 'paid') {
      return E.badRequest(res, 'Cannot void a fully paid invoice. Issue a refund instead.');
    }

    await Invoices.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'voided', voidedAt: new Date().toISOString(), voidedBy: userId }
    );

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

    const Payments = _model('payments');
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
    const Invoices = _model('invoices');
    const invoice  = await Invoices.findOne({ id: data.invoiceId, schoolId }).lean();
    if (!invoice) return E.notFound(res, 'Invoice not found');
    if (invoice.status === 'voided') return E.badRequest(res, 'Cannot record payment on a voided invoice');

    // Validate payment amount doesn't exceed outstanding balance
    const maxPayable = _round(invoice.balance || (invoice.total - (invoice.amountPaid || 0)));
    if (_round(data.amount) > _round(maxPayable + 0.01)) { // 1p tolerance for rounding
      return E.badRequest(res, `Payment amount (${data.amount}) exceeds outstanding balance (${maxPayable})`);
    }

    const receiptNumber = await nextReceiptNumber(schoolId);

    const Payments = _model('payments');
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

    // Server-side: recalculate invoice balance after this payment
    const allPayments  = await Payments.find({ invoiceId: data.invoiceId, schoolId }).lean();
    const bal          = _calcBalance(invoice.total, allPayments);

    await Invoices.findOneAndUpdate(
      { id: data.invoiceId },
      { amountPaid: bal.paid, balance: bal.balance, status: bal.status, updatedBy: userId }
    );

    return created(res, {
      payment: payment.toObject ? payment.toObject() : payment,
      invoiceStatus: bal.status,
      invoiceBalance: bal.balance
    });
  } catch (err) {
    console.error('[finance POST /payments]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/finance/summary ─ School financial overview ────── */
router.get('/summary', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const filter = { schoolId };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;

    const Invoices = _model('invoices');
    const Payments = _model('payments');

    const [invoiceSummary, paymentSummary] = await Promise.all([
      Invoices.aggregate([
        { $match: filter },
        { $group: {
          _id:          null,
          totalInvoiced: { $sum: '$total' },
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

module.exports = router;
