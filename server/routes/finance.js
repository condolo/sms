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
   FEE TYPES — school-configurable catalogue for invoice line items'
   `feeType` (Tuition/Transport/Lunch/Library/Online Subscription/…).
   Mirrors hr.js's payroll_config allowance/deduction type catalogue
   pattern exactly: one doc per school, merged over hardcoded
   defaults, upsert-on-save. LineItemSchema.feeType stays a free string
   (an invoice predates this catalogue existing, and a one-off line
   item shouldn't be blocked by it) — this is the picker source for
   the UI, not a hard FK constraint.
   ══════════════════════════════════════════════════════════════ */
const DEFAULT_FEE_TYPES = [
  { key: 'tuition',      label: 'Tuition Fees' },
  { key: 'transport',    label: 'Transport' },
  { key: 'lunch',        label: 'Lunch' },
  { key: 'library',      label: 'Library' },
  { key: 'online_subscription', label: 'Online Subscription' },
  { key: 'uniform',      label: 'Uniform' },
  { key: 'trip',         label: 'Trip / Excursion' },
  { key: 'other',        label: 'Other' },
];

const FeeTypeSchema = z.object({
  key:   z.string().min(1).max(50).regex(/^[a-z][a-z0-9_]*$/, 'key must be lowercase, start with a letter'),
  label: z.string().min(1).max(100),
});
const FeeConfigSchema = z.object({
  feeTypes: z.array(FeeTypeSchema).max(40).optional(),
});
function _mergeFeeConfig(saved) {
  return { feeTypes: saved?.feeTypes ?? DEFAULT_FEE_TYPES };
}

/* GET /api/finance/fee-config */
router.get('/fee-config', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const saved = await tenantModel('fee_config', tenantContext(req)).findOne({ schoolId }).lean();
    return ok(res, _mergeFeeConfig(saved));
  } catch (err) {
    console.error('[finance GET /fee-config]', err);
    return E.serverError(res);
  }
});

/* PUT /api/finance/fee-config */
router.put('/fee-config', authMiddleware, PLAN, rbac('finance', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(FeeConfigSchema, req.body);
    if (error) return E.validation(res, error);

    if (data.feeTypes) {
      const keys = data.feeTypes.map(t => t.key);
      if (new Set(keys).size !== keys.length) return E.badRequest(res, 'feeTypes contains duplicate keys');
    }

    const doc = await tenantModel('fee_config', tenantContext(req)).findOneAndUpdate(
      { schoolId },
      { $set: { ...data, schoolId, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true, upsert: true, runValidators: false }
    ).lean();
    return ok(res, _mergeFeeConfig(doc));
  } catch (err) {
    console.error('[finance PUT /fee-config]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   INVOICE REMINDER CONFIG — school-configurable schedule for
   invoice-overdue-cron.js: a reminder N days before the due date,
   one on the due date itself, then recurring every N days after.
   Same one-doc-per-school / merged-over-defaults shape as fee_config.
   ══════════════════════════════════════════════════════════════ */
const DEFAULT_INVOICE_REMINDER_CONFIG = {
  enabled:              true,
  beforeDueDays:        3,     // 0 disables the pre-due reminder
  onDueDate:            true,
  afterDueIntervalDays: 4,     // 0 disables recurring post-due reminders
};
const InvoiceReminderConfigSchema = z.object({
  enabled:              z.boolean().optional(),
  beforeDueDays:        z.number().int().min(0).max(30).optional(),
  onDueDate:            z.boolean().optional(),
  afterDueIntervalDays: z.number().int().min(0).max(30).optional(),
});
function _mergeInvoiceReminderConfig(saved) {
  return {
    enabled:              saved?.enabled              ?? DEFAULT_INVOICE_REMINDER_CONFIG.enabled,
    beforeDueDays:        saved?.beforeDueDays         ?? DEFAULT_INVOICE_REMINDER_CONFIG.beforeDueDays,
    onDueDate:            saved?.onDueDate             ?? DEFAULT_INVOICE_REMINDER_CONFIG.onDueDate,
    afterDueIntervalDays: saved?.afterDueIntervalDays  ?? DEFAULT_INVOICE_REMINDER_CONFIG.afterDueIntervalDays,
  };
}

/* GET /api/finance/invoice-reminder-config */
router.get('/invoice-reminder-config', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const saved = await tenantModel('invoice_reminder_config', tenantContext(req)).findOne({ schoolId }).lean();
    return ok(res, _mergeInvoiceReminderConfig(saved));
  } catch (err) {
    console.error('[finance GET /invoice-reminder-config]', err);
    return E.serverError(res);
  }
});

/* PUT /api/finance/invoice-reminder-config */
router.put('/invoice-reminder-config', authMiddleware, PLAN, rbac('finance', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(InvoiceReminderConfigSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('invoice_reminder_config', tenantContext(req)).findOneAndUpdate(
      { schoolId },
      { $set: { ...data, schoolId, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true, upsert: true, runValidators: false }
    ).lean();
    return ok(res, _mergeInvoiceReminderConfig(doc));
  } catch (err) {
    console.error('[finance PUT /invoice-reminder-config]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   FEE STRUCTURES — define standard fees per class/section/students
   ══════════════════════════════════════════════════════════════ */
const FeeStructureSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  academicYear:z.string().max(20).optional(),
  term:        z.number().int().min(1).max(4).optional(),
  // scopeType selects which of the id lists below actually targets
  // students; omitted defaults to 'classes' when classIds is present
  // (pre-existing structures created before scopeType existed) or
  // 'all' otherwise — see _resolveScopeStudents().
  scopeType:   z.enum(['all', 'classes', 'sections', 'students']).optional(),
  classIds:    z.array(z.string()).optional(),
  sectionIds:  z.array(z.string()).optional(),
  studentIds:  z.array(z.string()).optional(),
  lineItems:   z.array(LineItemSchema).min(1),
  dueDate:     z.string().optional(),
  notes:       z.string().max(500).optional(),
});

/* Resolves which students a fee structure's scope actually targets —
   the single place this logic lives, so /generate (and any future
   caller, e.g. a "how many students would this apply to" preview)
   never re-derive it differently. */
async function _resolveScopeStudents(Students, schoolId, fs, ctx) {
  const scopeType = fs.scopeType || (fs.classIds?.length ? 'classes' : 'all');
  const filter = { schoolId, status: 'active' };
  if (scopeType === 'classes' && fs.classIds?.length) {
    filter.classId = { $in: fs.classIds };
  }
  if (scopeType === 'sections' && fs.sectionIds?.length) {
    // Students carry no direct section field — section membership is always
    // derived via their class's `sectionKey` (same as students.js's own
    // ?sectionKey filter). fs.sectionIds holds section `key`s, not section
    // doc ids.
    const sectionClassIds = await tenantModel('classes', ctx)
      .find({ schoolId, sectionKey: { $in: fs.sectionIds } })
      .select('id').lean()
      .then(docs => docs.flatMap(d => [d.id, String(d._id)].filter(Boolean)));
    if (sectionClassIds.length === 0) return [];
    filter.classId = { $in: sectionClassIds };
  }
  if (scopeType === 'students' && fs.studentIds?.length) {
    return Students.find({ schoolId, status: 'active', id: { $in: fs.studentIds } }).lean();
  }
  return Students.find(filter).lean();
}

/* ══════════════════════════════════════════════════════════════
   DISCOUNT POLICIES — sibling-discount tiers, applied at bulk
   invoice generation time. One school can have several policies
   (e.g. draft vs. active, or a policy retired for next year) but
   only ONE 'sibling' policy may be `active` at a time — that is
   the one _resolveSiblingDiscounts() looks up.
   ══════════════════════════════════════════════════════════════ */
const DiscountTierSchema = z.object({
  // 1st-enrolled child in a family never appears in a tier (pays full
  // price); tiers start at the 2nd child.
  nthChild:    z.number().int().min(2).max(10),
  discountPct: z.number().min(0).max(100),
});
const DiscountPolicySchema = z.object({
  name:   z.string().min(1).max(200),
  type:   z.literal('sibling').default('sibling'),
  active: z.boolean().default(false),
  tiers:  z.array(DiscountTierSchema).min(1),
});
function _validateTiers(tiers) {
  const nths = tiers.map(t => t.nthChild);
  if (new Set(nths).size !== nths.length) return 'tiers contains duplicate nthChild values';
  return null;
}

/* ── GET /api/finance/discount-policies ──────────────────────── */
router.get('/discount-policies', authMiddleware, PLAN, rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const DiscountPolicies = tenantModel('discount_policies', tenantContext(req));
    const docs = await DiscountPolicies.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[finance GET /discount-policies]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/finance/discount-policies ─────────────────────── */
router.post('/discount-policies', authMiddleware, PLAN, rbac('finance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(DiscountPolicySchema, req.body);
    if (error) return E.validation(res, error);
    const tierErr = _validateTiers(data.tiers);
    if (tierErr) return E.badRequest(res, tierErr);

    const DiscountPolicies = tenantModel('discount_policies', tenantContext(req));
    if (data.active) {
      await DiscountPolicies.updateMany({ schoolId, type: data.type, active: true }, { $set: { active: false } });
    }
    const doc = await DiscountPolicies.create({ id: uuidv4(), schoolId, createdBy: userId, ...data });
    AuditService.log({ action: 'finance.discount_policy_created', actor: req.jwtUser, schoolId, target: { type: 'discount_policy', id: doc.id, label: data.name }, req });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[finance POST /discount-policies]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/finance/discount-policies/:id ──────────────────── */
router.put('/discount-policies/:id', authMiddleware, PLAN, rbac('finance', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(DiscountPolicySchema.partial(), req.body);
    if (error) return E.validation(res, error);
    if (data.tiers) {
      const tierErr = _validateTiers(data.tiers);
      if (tierErr) return E.badRequest(res, tierErr);
    }

    const DiscountPolicies = tenantModel('discount_policies', tenantContext(req));
    if (data.active) {
      const existing = await DiscountPolicies.findOne({ id: req.params.id, schoolId }).lean();
      if (!existing) return E.notFound(res, 'Discount policy not found');
      await DiscountPolicies.updateMany({ schoolId, type: existing.type, active: true, id: { $ne: req.params.id } }, { $set: { active: false } });
    }
    const doc = await DiscountPolicies.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Discount policy not found');
    AuditService.log({ action: 'finance.discount_policy_updated', actor: req.jwtUser, schoolId, target: { type: 'discount_policy', id: req.params.id, label: doc.name }, req });
    return ok(res, doc);
  } catch (err) {
    console.error('[finance PUT /discount-policies/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/finance/discount-policies/:id ───────────────── */
router.delete('/discount-policies/:id', authMiddleware, PLAN, rbac('finance', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const DiscountPolicies = tenantModel('discount_policies', tenantContext(req));
    const doc = await DiscountPolicies.findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Discount policy not found');
    AuditService.log({ action: 'finance.discount_policy_deleted', actor: req.jwtUser, schoolId, target: { type: 'discount_policy', id: req.params.id, label: doc.name }, req });
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[finance DELETE /discount-policies/:id]', err);
    return E.serverError(res);
  }
});

/* Resolves per-student sibling-discount percentages for a batch of
   target students, keyed by studentId — the single place this logic
   lives, called once per /generate run (never per-student: ranking a
   family's children requires each guardian's FULL child list, not
   just whichever of their kids are in this batch).

   Family grouping: `users` docs with role 'parent' carry a
   `studentIds` array (the reverse of the Link Parent relationship —
   see notify-students.js). A student can have >1 guardian, and two
   guardians of the same family may not list identical studentIds
   (e.g. one parent linked before a younger sibling enrolled), so
   families are merged via union-find over shared studentIds rather
   than assumed to match one guardian's list exactly.

   Ranking: within a merged family, children are ordered by
   enrollmentDate (earliest = 1st child, pays full price); a tier's
   discount applies from the matching nthChild onward using the
   highest tier for any child beyond the last defined tier. */
async function _resolveSiblingDiscounts(schoolId, ctx, studentIds) {
  const result = new Map();
  if (!studentIds?.length) return result;

  const DiscountPolicies = tenantModel('discount_policies', ctx);
  const policy = await DiscountPolicies.findOne({ schoolId, type: 'sibling', active: true }).lean();
  if (!policy?.tiers?.length) return result;

  const Users = tenantModel('users', ctx);
  const guardians = await Users.find({ schoolId, role: 'parent', studentIds: { $in: studentIds }, isActive: { $ne: false } })
    .select('studentIds').lean();
  if (!guardians.length) return result;

  // Union-find: merge every guardian's children into one family group.
  const parentOf = new Map();
  function find(x) { while (parentOf.get(x) !== x) x = parentOf.get(x); return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parentOf.set(ra, rb); }
  for (const g of guardians) {
    const kids = (g.studentIds || []).filter(Boolean);
    for (const k of kids) if (!parentOf.has(k)) parentOf.set(k, k);
    for (let i = 1; i < kids.length; i++) union(kids[0], kids[i]);
  }
  if (parentOf.size === 0) return result;

  const families = new Map(); // root id -> [studentId, ...]
  for (const sid of parentOf.keys()) {
    const root = find(sid);
    if (!families.has(root)) families.set(root, []);
    families.get(root).push(sid);
  }

  const tierByNth = new Map(policy.tiers.map(t => [t.nthChild, t.discountPct]));
  const maxTierNth = Math.max(...policy.tiers.map(t => t.nthChild));
  const maxTierPct = tierByNth.get(maxTierNth);

  const Students = tenantModel('students', ctx);
  for (const familyIds of families.values()) {
    if (familyIds.length < 2) continue; // only child — no sibling discount
    const siblings = await Students.find({ schoolId, id: { $in: familyIds } }).select('id enrollmentDate createdAt').lean();
    siblings.sort((a, b) => new Date(a.enrollmentDate || a.createdAt || 0) - new Date(b.enrollmentDate || b.createdAt || 0));
    siblings.forEach((s, idx) => {
      const nth = idx + 1;
      if (nth === 1 || !studentIds.includes(s.id)) return;
      const pct = tierByNth.get(nth) ?? (nth > maxTierNth ? maxTierPct : 0);
      if (pct > 0) result.set(s.id, pct);
    });
  }
  return result;
}

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

    // Resolve target students — class/section/individual-student scope,
    // single source of truth (see _resolveScopeStudents above).
    const students = await _resolveScopeStudents(Students, schoolId, fs, tenantContext(req));
    if (students.length === 0) return ok(res, { created: 0, message: 'No active students found for the given criteria' });

    // Skip students who already have an invoice from this structure (idempotent)
    const existingInvStudents = await Invoices.distinct('studentId', { schoolId, feeStructureId: fs.id });
    const existingSet = new Set(existingInvStudents);
    const targets = students.filter(s => !existingSet.has(s.id ?? s._id?.toString()));

    if (targets.length === 0) return ok(res, { created: 0, message: 'Invoices already generated for all students in this structure' });

    // Sibling discount (if an active policy exists) — resolved once for
    // every target student, not per-student, since it needs each
    // guardian's FULL child list to rank correctly.
    const targetStudentIds = targets.map(s => s.id ?? s._id?.toString());
    const siblingDiscounts = await _resolveSiblingDiscounts(schoolId, tenantContext(req), targetStudentIds);

    const created_docs = [];

    for (const student of targets) {
      const sid = student.id ?? student._id?.toString();
      const discountPct = siblingDiscounts.get(sid) ?? 0;
      const totals = _calcInvoiceTotals(fs.lineItems, discountPct);
      const invNum = await nextInvoiceNumber(schoolId);
      const inv = await Invoices.create({
        id:             uuidv4(),
        schoolId,
        discountPct,
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
