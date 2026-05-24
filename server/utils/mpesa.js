/* ============================================================
   Msingi — M-Pesa Daraja API Utility
   Supports: STK Push (Lipa Na M-Pesa), STK Query, C2B URL registration
   Node 18+ native fetch used — no external HTTP dependency.
   ============================================================ */

const SANDBOX_BASE    = 'https://sandbox.safaricom.co.ke';
const PRODUCTION_BASE = 'https://api.safaricom.co.ke';

function _base(env) {
  return env === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

function _b64(str) {
  return Buffer.from(str).toString('base64');
}

/** YYYYMMDDHHmmss timestamp required by Daraja */
function _timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('');
}

async function _post(url, body, token) {
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

/* ── OAuth Token ───────────────────────────────────────────── */
async function getToken({ consumerKey, consumerSecret, env = 'sandbox' }) {
  const url = `${_base(env)}/oauth/v1/generate?grant_type=client_credentials`;
  const res = await fetch(url, {
    method:  'GET',
    headers: { Authorization: `Basic ${_b64(`${consumerKey}:${consumerSecret}`)}` },
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`[mpesa] Token error: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

/* ── STK Push (Lipa Na M-Pesa Online) ─────────────────────── */
/**
 * Triggers a push notification to the customer's phone prompting PIN entry.
 * phone: E.164 without '+', e.g. 254712345678
 * amount: integer (rounded up)
 */
async function stkPush({
  consumerKey, consumerSecret,
  shortCode, passkey,
  phone, amount,
  accountRef, description,
  callbackUrl,
  env = 'sandbox',
}) {
  const token     = await getToken({ consumerKey, consumerSecret, env });
  const timestamp = _timestamp();
  const password  = _b64(`${shortCode}${passkey}${timestamp}`);

  const body = {
    BusinessShortCode: shortCode,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.ceil(amount),
    PartyA:            phone,
    PartyB:            shortCode,
    PhoneNumber:       phone,
    CallBackURL:       callbackUrl,
    AccountReference:  String(accountRef).slice(0, 12),
    TransactionDesc:   String(description).slice(0, 13),
  };

  return _post(`${_base(env)}/mpesa/stkpush/v1/processrequest`, body, token);
}

/* ── STK Push Query ────────────────────────────────────────── */
async function stkQuery({
  consumerKey, consumerSecret,
  shortCode, passkey,
  checkoutRequestId,
  env = 'sandbox',
}) {
  const token     = await getToken({ consumerKey, consumerSecret, env });
  const timestamp = _timestamp();
  const password  = _b64(`${shortCode}${passkey}${timestamp}`);

  return _post(`${_base(env)}/mpesa/stkpushquery/v1/query`, {
    BusinessShortCode: shortCode,
    Password:          password,
    Timestamp:         timestamp,
    CheckoutRequestID: checkoutRequestId,
  }, token);
}

/* ── C2B URL Registration ──────────────────────────────────── */
async function registerC2BUrls({
  consumerKey, consumerSecret,
  shortCode,
  validationUrl, confirmationUrl,
  env = 'sandbox',
}) {
  const token = await getToken({ consumerKey, consumerSecret, env });
  return _post(`${_base(env)}/mpesa/c2b/v1/registerurl`, {
    ShortCode:       shortCode,
    ResponseType:    'Completed',
    ConfirmationURL: confirmationUrl,
    ValidationURL:   validationUrl,
  }, token);
}

/* ── Phone normalisation ───────────────────────────────────── */
/** Accepts 0712345678 / +254712345678 / 254712345678 → 254712345678 */
function normalizePhone(raw) {
  const clean = String(raw || '').replace(/\D/g, '');
  if (clean.startsWith('0'))   return '254' + clean.slice(1);
  if (clean.startsWith('254')) return clean;
  return clean;
}

module.exports = { getToken, stkPush, stkQuery, registerC2BUrls, normalizePhone };
