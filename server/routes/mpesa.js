/* ============================================================
   Msingi — M-Pesa Integration Routes
   POST /api/mpesa/stk-push           — initiate STK push (auth)
   GET  /api/mpesa/status/:id         — query push status (auth)
   POST /api/mpesa/callback           — Safaricom STK callback (public)
   POST /api/mpesa/c2b/register       — register C2B URLs (admin)
   POST /api/mpesa/c2b/validation     — C2B validation (public, Safaricom)
   POST /api/mpesa/c2b/confirmation   — C2B confirmation (public, Safaricom)
   GET  /api/mpesa/transactions       — list M-Pesa transactions (auth)
   ============================================================ */
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { nextReceiptNumber } = require('../utils/counters');
const mpesa              = require('../utils/mpesa');

const router = express.Router();

/* ── Helpers ───────────────────────────────────────────────── */
function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
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

/** Recalculate invoice paid/balance/status and persist */
async function _reconcileInvoice(invoiceId, schoolId) {
  const Invoices = _model('invoices');
  const Payments = _model('payments');
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

    const Invoices = _model('invoices');
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
    const Transactions = _model('mpesa_transactions');
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
    const Transactions = _model('mpesa_transactions');
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
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) return;

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode        = Number(body.ResultCode);
    const now               = new Date().toISOString();

    const Transactions = _model('mpesa_transactions');
    const txn = await Transactions.findOne({ checkoutRequestId }).lean();
    if (!txn) {
      console.warn('[mpesa] callback: unknown checkoutRequestId', checkoutRequestId);
      return;
    }

    if (resultCode !== 0) {
      await Transactions.updateOne({ checkoutRequestId }, {
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

    // Mark transaction complete
    await Transactions.updateOne({ checkoutRequestId }, {
      $set: { status: 'completed', mpesaReceiptNumber: mpesaCode, amount, paidAt: now, updatedAt: now },
    });

    // Record payment on the invoice
    const Invoices = _model('invoices');
    const invoice  = await Invoices.findOne({ id: txn.invoiceId }).lean();
    if (!invoice) return;

    let receiptNum = mpesaCode;
    try { receiptNum = await nextReceiptNumber(txn.schoolId); } catch {}

    const Payments = _model('payments');
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
    const Transactions = _model('mpesa_transactions');
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
    const Invoices = _model('invoices');
    const invoice  = await Invoices.findOne({ schoolId: school.id, invoiceNumber: BillRefNumber }).lean();
    if (!invoice) {
      console.log(`[mpesa] C2B ${TransID} received — no matching invoice for ref "${BillRefNumber}"`);
      return;
    }

    let receiptNum = TransID;
    try { receiptNum = await nextReceiptNumber(school.id); } catch {}

    const Payments = _model('payments');
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
    const Transactions = _model('mpesa_transactions');
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

module.exports = router;
