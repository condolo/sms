/* ============================================================
   Msingi — M-Pesa Integration Routes
   POST /api/mpesa/stk-push             — initiate STK push (auth)
   GET  /api/mpesa/status/:id           — query push status (auth)
   POST /api/mpesa/callback             — Safaricom STK callback (public)
   POST /api/mpesa/c2b/register         — register C2B URLs (admin)
   POST /api/mpesa/c2b/validation       — C2B validation (public, Safaricom)
   POST /api/mpesa/c2b/confirmation     — C2B confirmation (public, Safaricom)
   GET  /api/mpesa/transactions         — list M-Pesa transactions (auth)
   POST /api/mpesa/subscription         — pay Msingi subscription via M-Pesa (admin)
   POST /api/mpesa/subscription/callback — Safaricom callback for subscription STK (public)
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { nextReceiptNumber } = require('../utils/counters');
const mpesa              = require('../utils/mpesa');

const router = express.Router();

/* ── Helpers ───────────────────────────────────────────────── */
function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function _getMpesaConfig(school) {
  const cfg = school?.mpesa;
  if (!cfg?.consumerKey || !cfg?.consumerSecret || !cfg?.shortCode || !cfg?.passkey) {
    return null;
  }
  return cfg;
}

function _isAdmin(req) {
  const r  = req.jwtUser?.role  || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || r === 'admin' || rs.includes('superadmin') || rs.includes('admin');
}

function _isPrincipalOrAdmin(req) {
  const r  = req.jwtUser?.role  || '';
  const rs = req.jwtUser?.roles || [];
  const all = [r, ...rs];
  return all.some(x => ['superadmin', 'admin', 'deputy', 'principal'].includes(x));
}

/* ── Safaricom IP allowlist (production callback security) ──────
   Safaricom publishes their IP ranges; we whitelist them.
   MPESA_SKIP_IP_CHECK=true disables this (useful in sandbox/dev). */
const SAFARICOM_IPS = new Set([
  '196.201.214.200', '196.201.214.206', '196.201.213.100', '196.201.214.207',
  '196.201.214.208', '196.201.213.169', '196.201.213.170', '196.201.213.171',
  '196.201.213.172', '196.201.213.173', '196.201.214.201', '196.201.214.202',
  '196.201.214.203', '196.201.214.204', '196.201.214.205', '196.201.214.209',
  '196.201.214.210', '196.201.214.211', '196.201.214.212', '196.201.214.213',
]);

function _assertSafaricomIP(req, res) {
  if (process.env.MPESA_SKIP_IP_CHECK === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  // Use req.ip — Express resolves this correctly when app.set('trust proxy', 1) is set.
  // DO NOT read x-forwarded-for directly: attackers can prepend a spoofed Safaricom IP
  // and split(',')[0] would match it, bypassing the check entirely.
  const ip = req.ip || '';
  if (SAFARICOM_IPS.has(ip)) return true;
  console.warn(`[mpesa] Callback rejected — unknown IP: ${ip}`);
  res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
  return false;
}

/** Recalculate invoice paid/balance/status and persist */
async function _reconcileInvoice(invoiceId, schoolId) {
  const Invoices = tenantModel('invoices', { schoolId });
  const Payments = tenantModel('payments', { schoolId });
  const invoice  = await Invoices.findOne({ id: invoiceId, schoolId }).lean();
  if (!invoice) return;
  const all     = await Payments.find({ invoiceId }).lean();
  const paid    = Math.round((all.reduce((s, p) => s + (p.amount || 0), 0)) * 100) / 100;
  const balance = Math.max(0, Math.round(((invoice.total || 0) - paid) * 100) / 100);
  const status  = balance <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
  await Invoices.updateOne({ id: invoiceId }, { $set: { status, balance, paid, updatedAt: new Date().toISOString() } });
}

/* ══════════════════════════════════════════════════════════════
   STK PUSH — initiate payment
   ══════════════════════════════════════════════════════════════ */
router.post('/stk-push', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { invoiceId, phone, amount } = req.body;

    if (!invoiceId || !phone || !amount) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'invoiceId, phone, and amount are required.' } });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'amount must be a positive number.' } });
    }

    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }).lean();
    const cfg     = _getMpesaConfig(school);
    if (!cfg) {
      return res.status(422).json({ success: false, error: { code: 'MPESA_NOT_CONFIGURED', message: 'M-Pesa is not configured for this school. Add credentials in Settings → School → M-Pesa.' } });
    }

    const Invoices = tenantModel('invoices', tenantContext(req));
    const invoice  = await Invoices.findOne({ id: invoiceId, schoolId }).lean();
    if (!invoice) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });

    const normalizedPhone = mpesa.normalizePhone(phone);
    const env             = cfg.env || (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox');
    const base            = cfg.callbackBaseUrl || process.env.PUBLIC_URL || '';
    const callbackUrl     = `${base}/api/mpesa/callback`;

    let result;
    try {
      result = await mpesa.stkPush({
        consumerKey:    cfg.consumerKey,
        consumerSecret: cfg.consumerSecret,
        shortCode:      cfg.shortCode,
        passkey:        cfg.passkey,
        phone:          normalizedPhone,
        amount,
        accountRef:     invoice.invoiceNumber || invoiceId.slice(-8),
        description:    'School Fee',
        callbackUrl,
        env,
      });
    } catch (mpesaErr) {
      console.error('[mpesa] stkPush error:', mpesaErr.message);
      return res.status(502).json({ success: false, error: { code: 'MPESA_API_ERROR', message: mpesaErr.message } });
    }

    if (result.ResponseCode !== '0') {
      return res.status(502).json({
        success: false,
        error: { code: 'MPESA_ERROR', message: result.errorMessage || result.ResponseDescription || 'M-Pesa request failed.' },
        raw: result,
      });
    }

    // Record pending transaction
    const Transactions = tenantModel('mpesa_transactions', tenantContext(req));
    const txnId = _uid();
    await Transactions.create({
      id:                txnId,
      schoolId,
      invoiceId,
      studentId:         invoice.studentId,
      merchantRequestId: result.MerchantRequestID,
      checkoutRequestId: result.CheckoutRequestID,
      phone:             normalizedPhone,
      amount,
      status:            'pending',
      type:              'stk_push',
      createdAt:         new Date().toISOString(),
      updatedAt:         new Date().toISOString(),
    });

    return res.json({
      success:           true,
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID,
      txnId,
      message:           'STK push sent. Ask the customer to enter their M-Pesa PIN on their phone.',
    });
  } catch (err) {
    console.error('[mpesa] POST /stk-push error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to initiate M-Pesa payment.' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   STK STATUS — query push status
   ══════════════════════════════════════════════════════════════ */
router.get('/status/:checkoutRequestId', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Transactions = tenantModel('mpesa_transactions', tenantContext(req));
    const txn = await Transactions.findOne({
      checkoutRequestId: req.params.checkoutRequestId,
      schoolId,
    }).lean();

    if (!txn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Transaction not found.' } });

    // If already resolved locally, return immediately
    if (txn.status !== 'pending') {
      return res.json({ success: true, data: txn });
    }

    // Query Safaricom live if pending
    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }).lean();
    const cfg     = _getMpesaConfig(school);
    if (!cfg) return res.json({ success: true, data: txn });

    const env = cfg.env || (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox');
    let liveStatus = null;
    try {
      liveStatus = await mpesa.stkQuery({
        consumerKey:       cfg.consumerKey,
        consumerSecret:    cfg.consumerSecret,
        shortCode:         cfg.shortCode,
        passkey:           cfg.passkey,
        checkoutRequestId: req.params.checkoutRequestId,
        env,
      });
    } catch {}

    return res.json({ success: true, data: { ...txn, liveStatus } });
  } catch (err) {
    console.error('[mpesa] GET /status error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to query status.' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   STK CALLBACK — Safaricom posts result here (public endpoint)
   Always respond 200 immediately — Safaricom retries on non-200.
   ══════════════════════════════════════════════════════════════ */
router.post('/callback', async (req, res) => {
  if (!_assertSafaricomIP(req, res)) return;
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) return;

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode        = Number(body.ResultCode);
    const now               = new Date().toISOString();

    // Bootstrap lookup — this callback carries no auth/JWT, so the tenant
    // isn't known yet. checkoutRequestId is Safaricom's own unique ID, and
    // this is the query that DISCOVERS the tenant; it cannot itself be
    // tenant-scoped. Every subsequent query in this handler uses the
    // resolved txn.schoolId via tenantModel().
    const Transactions = _model('mpesa_transactions');
    const txn = await Transactions.findOne({ checkoutRequestId }).lean();
    if (!txn) {
      console.warn('[mpesa] callback: unknown checkoutRequestId', checkoutRequestId);
      return;
    }
    const ScopedTransactions = tenantModel('mpesa_transactions', { schoolId: txn.schoolId });

    if (resultCode !== 0) {
      await ScopedTransactions.updateOne({ checkoutRequestId, schoolId: txn.schoolId }, {
        $set: { status: 'failed', resultCode, resultDesc: body.ResultDesc, updatedAt: now },
      });
      console.log(`[mpesa] STK failed — ${checkoutRequestId} — ${body.ResultDesc}`);
      return;
    }

    // Parse callback metadata
    const items = body.CallbackMetadata?.Item || [];
    const meta  = {};
    items.forEach(({ Name, Value }) => { meta[Name] = Value; });

    const amount    = Number(meta.Amount);
    const mpesaCode = String(meta.MpesaReceiptNumber || '');

    // Atomically claim this transaction for completion — only the FIRST
    // callback delivery to reach this line matches (status starts as
    // anything other than 'completed') and proceeds to create a Payment.
    // A retried/duplicate callback — a documented Safaricom behavior, not
    // an edge case — finds status already 'completed', matches nothing,
    // and is skipped before it can create a second Payment record.
    const claimed = await ScopedTransactions.findOneAndUpdate(
      { checkoutRequestId, schoolId: txn.schoolId, status: { $ne: 'completed' } },
      { $set: { status: 'completed', mpesaReceiptNumber: mpesaCode, amount, paidAt: now, updatedAt: now } },
    ).lean();

    if (!claimed) {
      console.log(`[mpesa] callback for ${checkoutRequestId} already processed — skipping duplicate payment`);
      return;
    }

    // Record payment on the invoice
    const Invoices = tenantModel('invoices', { schoolId: txn.schoolId });
    const invoice  = await Invoices.findOne({ id: txn.invoiceId, schoolId: txn.schoolId }).lean();
    if (!invoice) return;

    let receiptNum = mpesaCode;
    try { receiptNum = await nextReceiptNumber(txn.schoolId); } catch {}

    const Payments = tenantModel('payments', { schoolId: txn.schoolId });
    await Payments.create({
      id:            _uid(),
      schoolId:      txn.schoolId,
      invoiceId:     txn.invoiceId,
      studentId:     invoice.studentId,
      receiptNumber: receiptNum,
      amount,
      method:        'mpesa',
      mpesaCode,
      phone:         txn.phone,
      paidAt:        now,
      note:          `M-Pesa STK · ${mpesaCode}`,
      createdAt:     now,
      updatedAt:     now,
    });

    await _reconcileInvoice(txn.invoiceId, txn.schoolId);
    console.log(`[mpesa] ✓ STK reconciled — invoice ${txn.invoiceId} · ${mpesaCode} · KES ${amount}`);
  } catch (err) {
    console.error('[mpesa] callback processing error:', err);
  }
});

/* ══════════════════════════════════════════════════════════════
   C2B — direct Paybill payments (customer pays via M-Pesa menu)
   ══════════════════════════════════════════════════════════════ */

/* Register C2B callback URLs with Safaricom (admin only) */
router.post('/c2b/register', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
    }
    const { schoolId } = req.jwtUser;
    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }).lean();
    const cfg     = _getMpesaConfig(school);
    if (!cfg) {
      return res.status(422).json({ success: false, error: { code: 'MPESA_NOT_CONFIGURED', message: 'M-Pesa not configured.' } });
    }
    const base   = cfg.callbackBaseUrl || process.env.PUBLIC_URL || '';
    const env    = cfg.env || (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox');
    const result = await mpesa.registerC2BUrls({
      consumerKey:     cfg.consumerKey,
      consumerSecret:  cfg.consumerSecret,
      shortCode:       cfg.shortCode,
      validationUrl:   `${base}/api/mpesa/c2b/validation`,
      confirmationUrl: `${base}/api/mpesa/c2b/confirmation`,
      env,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[mpesa] POST /c2b/register error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to register C2B URLs.' } });
  }
});

/* Safaricom C2B validation — called before confirming payment */
router.post('/c2b/validation', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/* Safaricom C2B confirmation — called when payment is confirmed */
router.post('/c2b/confirmation', async (req, res) => {
  if (!_assertSafaricomIP(req, res)) return;
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const {
      TransID, TransAmount,
      BusinessShortCode, BillRefNumber, MSISDN,
    } = req.body;

    if (!TransID) return;

    // Identify school by Paybill short code
    const Schools = _model('schools');
    const school  = await Schools.findOne({ 'mpesa.shortCode': String(BusinessShortCode) }).lean();
    if (!school) {
      console.warn(`[mpesa] C2B: unknown shortCode ${BusinessShortCode}`);
      return;
    }

    const now    = new Date().toISOString();
    const amount = Number(TransAmount);

    // Record raw transaction
    const Transactions = tenantModel('mpesa_transactions', { schoolId: school.id });
    await Transactions.create({
      id:                _uid(),
      schoolId:          school.id,
      type:              'c2b',
      mpesaReceiptNumber: TransID,
      phone:             MSISDN,
      amount,
      accountRef:        BillRefNumber,
      status:            'completed',
      createdAt:         now,
      updatedAt:         now,
    });

    // Match BillRefNumber to invoice number for auto-reconciliation
    const Invoices = tenantModel('invoices', { schoolId: school.id });
    const invoice  = await Invoices.findOne({ schoolId: school.id, invoiceNumber: BillRefNumber }).lean();
    if (!invoice) {
      console.log(`[mpesa] C2B ${TransID} received — no matching invoice for ref "${BillRefNumber}"`);
      return;
    }

    let receiptNum = TransID;
    try { receiptNum = await nextReceiptNumber(school.id); } catch {}

    const Payments = tenantModel('payments', { schoolId: school.id });
    await Payments.create({
      id:            _uid(),
      schoolId:      school.id,
      invoiceId:     invoice.id,
      studentId:     invoice.studentId,
      receiptNumber: receiptNum,
      amount,
      method:        'mpesa',
      mpesaCode:     TransID,
      phone:         MSISDN,
      paidAt:        now,
      note:          `M-Pesa C2B · ${TransID}`,
      createdAt:     now,
      updatedAt:     now,
    });

    await _reconcileInvoice(invoice.id, school.id);
    console.log(`[mpesa] ✓ C2B reconciled — invoice ${invoice.id} · ${TransID} · KES ${amount}`);
  } catch (err) {
    console.error('[mpesa] C2B confirmation processing error:', err);
  }
});

/* ══════════════════════════════════════════════════════════════
   TRANSACTIONS — list M-Pesa transactions for this school
   ══════════════════════════════════════════════════════════════ */
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Transactions = tenantModel('mpesa_transactions', tenantContext(req));
    const filter = { schoolId };
    if (req.query.invoiceId) filter.invoiceId = req.query.invoiceId;
    if (req.query.status)    filter.status    = req.query.status;

    const docs = await Transactions.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 100)
      .lean();

    res.json({ success: true, data: docs });
  } catch (err) {
    console.error('[mpesa] GET /transactions error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch transactions.' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   MSINGI SUBSCRIPTION PAYMENT
   Schools pay their Msingi platform subscription via M-Pesa.
   Uses the platform's own Daraja credentials (env vars), NOT
   the school's own M-Pesa credentials.
   Restricted to admin / principal / deputy only.
   ══════════════════════════════════════════════════════════════ */

/* Portal tier rates — single source of truth in pricing.js */
const { STUDENT_RATE } = require('../config/pricing');
/* Map legacy plan keys → portal tier keys (backward compat) */
const _LEGACY_TO_TIER = { core: 'base', standard: 'student', premium: 'family' };

/* POST /api/mpesa/subscription — initiate subscription payment */
router.post('/subscription', authMiddleware, async (req, res) => {
  try {
    if (!_isPrincipalOrAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only school admin or principal can initiate subscription payments.' } });
    }

    const { schoolId } = req.jwtUser;
    const { phone, tier, plan, studentCount } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'phone is required.' } });
    }

    // Accept new 'tier' param or legacy 'plan' param
    const rawTier    = (tier || _LEGACY_TO_TIER[plan] || 'student').toLowerCase();
    const targetPlan = rawTier; // stored as tier key going forward
    const rate       = STUDENT_RATE[rawTier];
    if (!rate) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Enterprise plans require direct sales contact. Valid tiers: base, student, family.` } });
    }
    const count  = Math.max(1, parseInt(studentCount, 10) || 1);
    const amount = rate * count;

    // Platform M-Pesa credentials (separate from school's own credentials)
    const consumerKey    = process.env.MSINGI_MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MSINGI_MPESA_CONSUMER_SECRET;
    const shortCode      = process.env.MSINGI_MPESA_SHORTCODE;
    const passkey        = process.env.MSINGI_MPESA_PASSKEY;
    const env            = process.env.MSINGI_MPESA_ENV || 'sandbox';
    const base           = process.env.PUBLIC_URL || '';

    if (!consumerKey || !consumerSecret || !shortCode || !passkey) {
      console.error('[mpesa/subscription] Platform M-Pesa credentials not configured');
      return res.status(503).json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Subscription payments are not yet enabled. Contact support.' } });
    }

    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }).lean();

    const normalizedPhone = mpesa.normalizePhone(phone);
    const callbackUrl     = `${base}/api/mpesa/subscription/callback`;

    let result;
    try {
      result = await mpesa.stkPush({
        consumerKey, consumerSecret, shortCode, passkey,
        phone:      normalizedPhone,
        amount,
        accountRef: school?.shortName || school?.slug || schoolId.slice(-8),
        description: `Msingi ${targetPlan} plan`,
        callbackUrl,
        env,
      });
    } catch (mpesaErr) {
      console.error('[mpesa/subscription] stkPush error:', mpesaErr.message);
      return res.status(502).json({ success: false, error: { code: 'MPESA_API_ERROR', message: mpesaErr.message } });
    }

    if (result.ResponseCode !== '0') {
      return res.status(502).json({ success: false, error: { code: 'MPESA_ERROR', message: result.ResponseDescription || 'M-Pesa request failed.' } });
    }

    // Record pending subscription transaction
    const Transactions = tenantModel('mpesa_transactions', tenantContext(req));
    const txnId = _uid();
    // Fetch current academic year + pending invoice term for callback reconciliation
    const schoolDoc    = await _model('schools').findOne({ id: schoolId }).select('academicYear').lean();
    const pendingSnap  = await tenantModel('billing_snapshots', tenantContext(req)).findOne({ schoolId, status: 'pending' }).sort({ generatedAt: -1 }).lean();
    await Transactions.create({
      id:                txnId,
      schoolId,
      type:              'subscription',
      plan:              targetPlan,
      academicYear:      schoolDoc?.academicYear || '',
      term:              pendingSnap?.term || null,
      merchantRequestId: result.MerchantRequestID,
      checkoutRequestId: result.CheckoutRequestID,
      phone:             normalizedPhone,
      amount,
      status:            'pending',
      createdAt:         new Date().toISOString(),
      updatedAt:         new Date().toISOString(),
    });

    return res.json({
      success:           true,
      checkoutRequestId: result.CheckoutRequestID,
      txnId,
      amount,
      plan:              targetPlan,
      message:           `STK push sent for KES ${amount.toLocaleString()}. Enter your M-Pesa PIN to complete the ${targetPlan} plan subscription.`,
    });
  } catch (err) {
    console.error('[mpesa] POST /subscription error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to initiate subscription payment.' } });
  }
});

/* POST /api/mpesa/subscription/callback — Safaricom posts result (public) */
router.post('/subscription/callback', async (req, res) => {
  if (!_assertSafaricomIP(req, res)) return;
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) return;

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode        = Number(body.ResultCode);
    const now               = new Date().toISOString();

    // Bootstrap lookup — same reasoning as the invoice-payment callback
    // above: no auth/JWT on this route, so the tenant isn't known until
    // this query resolves it via Safaricom's checkoutRequestId.
    const Transactions = _model('mpesa_transactions');
    const txn = await Transactions.findOne({ checkoutRequestId, type: 'subscription' }).lean();
    if (!txn) {
      console.warn('[mpesa/subscription] callback: unknown checkoutRequestId', checkoutRequestId);
      return;
    }
    const ScopedTransactions = tenantModel('mpesa_transactions', { schoolId: txn.schoolId });

    if (resultCode !== 0) {
      await ScopedTransactions.updateOne({ checkoutRequestId }, {
        $set: { status: 'failed', resultCode, resultDesc: body.ResultDesc, updatedAt: now },
      });
      console.log(`[mpesa/subscription] STK failed — ${checkoutRequestId} — ${body.ResultDesc}`);
      return;
    }

    const items = body.CallbackMetadata?.Item || [];
    const meta  = {};
    items.forEach(({ Name, Value }) => { meta[Name] = Value; });

    const paidAmount = Number(meta.Amount);
    const mpesaCode  = String(meta.MpesaReceiptNumber || '');

    // Same atomic claim as the invoice-payment callback above — prevents a
    // retried callback from re-running plan activation a second time.
    const claimed = await ScopedTransactions.findOneAndUpdate(
      { checkoutRequestId, type: 'subscription', status: { $ne: 'completed' } },
      { $set: { status: 'completed', mpesaReceiptNumber: mpesaCode, amount: paidAmount, paidAt: now, updatedAt: now } },
    ).lean();

    if (!claimed) {
      console.log(`[mpesa/subscription] callback for ${checkoutRequestId} already processed — skipping`);
      return;
    }

    // Activate the school's plan until end of current term (90 days fallback)
    const Schools = _model('schools');
    // Find the term end date from school settings if possible
    const school = await Schools.findOne({ id: txn.schoolId }).lean();
    const termDates = school?.termDates || [];
    // Try to find an end date for the paid term — use invoiceRef to extract term number
    let planExpiry;
    if (txn.term && termDates.length) {
      const termDef = termDates.find(t => t.term === txn.term);
      planExpiry = termDef?.endDate
        ? new Date(termDef.endDate + 'T23:59:59Z').toISOString()
        : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      planExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    }

    await Schools.updateOne({ id: txn.schoolId }, {
      $set: {
        plan:          txn.plan,
        planExpiresAt: planExpiry,
        planPaidAt:    now,
        planMpesaCode: mpesaCode,
        updatedAt:     now,
      },
    });

    // Mark the billing snapshot as paid (if one exists for this term)
    const Snapshots = tenantModel('billing_snapshots', { schoolId: txn.schoolId });
    await Snapshots.updateOne(
      { schoolId: txn.schoolId, status: 'pending', academicYear: txn.academicYear },
      { $set: { status: 'paid', paidAt: now, mpesaCode, paidAmount, updatedAt: now } }
    );

    console.log(`[mpesa/subscription] ✓ Plan activated — school ${txn.schoolId} → ${txn.plan} until ${planExpiry} · ${mpesaCode} · KSh ${paidAmount}`);
  } catch (err) {
    console.error('[mpesa/subscription] callback processing error:', err);
  }
});

/* GET /api/mpesa/subscription/plans — public pricing info */
router.get('/subscription/plans', (req, res) => {
  const { PORTAL_TIERS } = require('../config/pricing');
  res.json({
    success: true,
    model:   'per_student_per_term',
    currency: 'KES',
    data: PORTAL_TIERS.map(t => ({
      key:         t.key,
      name:        t.name,
      ratePerTerm: t.ratePerTerm,
      description: t.description,
      portals:     t.portals,
    })),
  });
});

module.exports = router;
