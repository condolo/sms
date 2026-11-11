/* ============================================================
   Public referral program API — /api/referrals

   No auth, no cookies. Anyone can become a referral partner and get
   a code; the only sensitive capability is the private hub token,
   emailed to the partner and stored only as a SHA-256 hash.

   Rate limits are per IP: creating a partner is deliberately slow
   (a person only needs one code), while code validation and hub
   reads are generous enough for a normal signup form.
   ============================================================ */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const referralService = require('../services/referralService');
const { ok, E } = require('../utils/response');

const router = express.Router();

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many referral signups from this network. Please try again later.' } },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests. Please slow down.' } },
});

const hubActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests. Please slow down.' } },
});

const PayoutDetailsSchema = z.object({
  method: z.enum(['mpesa', 'bank']).optional(),
  payoutPhone: z.string().trim().max(40).optional().or(z.literal('')),
  bankName: z.string().trim().max(120).optional().or(z.literal('')),
  bankAccountName: z.string().trim().max(120).optional().or(z.literal('')),
  bankAccountNumber: z.string().trim().max(40).optional().or(z.literal('')),
  bankBranch: z.string().trim().max(120).optional().or(z.literal('')),
});

const PayoutRequestSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

const ResendSchema = z.object({
  email: z.string().trim().email().max(300),
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests. Please try again later.' } },
});

function _hubError(res, result) {
  const status = result.code === 'NOT_FOUND' ? 404
    : result.code === 'PARTNER_BLOCKED' ? 403
    : ['PAYOUT_IN_REVIEW', 'REQUEST_IN_PROGRESS', 'ALREADY_SETTLED'].includes(result.code) ? 409
    : 400;
  return res.status(status).json({ success: false, error: { code: result.code, message: result.message } });
}

const PartnerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(300),
  phone: z.string().trim().min(5).max(40),
  payoutPhone: z.string().trim().max(40).optional().or(z.literal('')),
  schoolName: z.string().trim().max(160).optional().or(z.literal('')),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

/* GET /api/referrals/program — public program terms for the /refer page. */
router.get('/program', readLimiter, async (req, res) => {
  try {
    const program = await referralService.getProgramSettings();
    return ok(res, {
      enabled: program.enabled,
      bountyAmount: program.bountyAmount,
      currency: program.currency,
      refereeIncentive: program.refereeIncentive,
      termsUrl: program.termsUrl,
    });
  } catch (err) {
    console.error('[referrals GET /program]', err);
    return E.serverError(res);
  }
});

/* POST /api/referrals/partners — anyone can join the program. */
router.post('/partners', createLimiter, async (req, res) => {
  const parsed = PartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return E.badRequest(res, parsed.error.issues.map((i) => i.message).join('; '));
  }

  try {
    const result = await referralService.createPartner({
      ...parsed.data,
      ip: req.ip,
    });

    if (!result.ok) {
      const status = result.code === 'PROGRAM_DISABLED' ? 403 : result.code === 'EMAIL_TAKEN' ? 409 : 400;
      return res.status(status).json({ success: false, error: { code: result.code, message: result.message } });
    }

    return res.status(201).json({
      success: true,
      data: {
        code: result.partner.code,
        name: result.partner.name,
        links: result.links,
        program: result.program,
        message: 'Your referral code is ready. We have also emailed it to you with your private dashboard link.',
      },
    });
  } catch (err) {
    console.error('[referrals POST /partners]', err);
    return E.serverError(res);
  }
});

/* GET /api/referrals/validate?code=... — form-time check, never reveals
   the partner's contact details. */
router.get('/validate', readLimiter, async (req, res) => {
  try {
    const code = referralService.normalizeCode(req.query.code);
    if (!code) return ok(res, { valid: false, code: null });
    const resolved = await referralService.resolveAttribution({ code, email: null });
    return ok(res, { valid: !!resolved.ok && !!resolved.attribution, code });
  } catch (err) {
    console.error('[referrals GET /validate]', err);
    return E.serverError(res);
  }
});

/* POST /api/referrals/partners/resend — email me my dashboard link. Always
   returns the same generic answer so the endpoint cannot enumerate partners. */
router.post('/partners/resend', resendLimiter, async (req, res) => {
  const parsed = ResendSchema.safeParse(req.body || {});
  if (!parsed.success) return E.badRequest(res, 'Enter the email you signed up with.');

  try {
    await referralService.resendHubLink({ email: parsed.data.email });
    return ok(res, {
      message: 'If that email is registered, we have sent a fresh private dashboard link to it.',
    });
  } catch (err) {
    console.error('[referrals POST /partners/resend]', err);
    return E.serverError(res);
  }
});

/* GET /api/referrals/hub/:token — private partner dashboard data. */
router.get('/hub/:token', readLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 20 || token.length > 200) {
    return E.notFound(res, 'This referral dashboard link is not valid.');
  }
  try {
    const result = await referralService.getHub(token);
    if (!result.ok) return E.notFound(res, result.message);
    res.set('Cache-Control', 'no-store');
    return ok(res, result.data);
  } catch (err) {
    console.error('[referrals GET /hub]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/referrals/hub/:token/payout-details — the partner chooses
   where manual payouts should go (M-Pesa or bank). */
router.patch('/hub/:token/payout-details', hubActionLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 20 || token.length > 200) {
    return E.notFound(res, 'This referral dashboard link is not valid.');
  }
  const parsed = PayoutDetailsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return E.badRequest(res, parsed.error.issues.map((i) => i.message).join('; '));
  }
  try {
    const result = await referralService.updatePayoutDetails({ token, patch: parsed.data });
    if (!result.ok) return _hubError(res, result);
    res.set('Cache-Control', 'no-store');
    return ok(res, { payout: result.payout });
  } catch (err) {
    console.error('[referrals PATCH /hub payout-details]', err);
    return E.serverError(res);
  }
});

/* POST /api/referrals/hub/:token/payout-requests — ask ops to settle the
   currently available rewards. Manual settlement; this only opens a queue
   item and locks those conversions. */
router.post('/hub/:token/payout-requests', hubActionLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 20 || token.length > 200) {
    return E.notFound(res, 'This referral dashboard link is not valid.');
  }
  const parsed = PayoutRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return E.badRequest(res, parsed.error.issues.map((i) => i.message).join('; '));
  }
  try {
    const result = await referralService.requestPayout({ token, note: parsed.data.note || '' });
    if (!result.ok) return _hubError(res, result);
    res.set('Cache-Control', 'no-store');
    return ok(res, { request: result.request, payout: result.payout });
  } catch (err) {
    console.error('[referrals POST /hub payout-requests]', err);
    return E.serverError(res);
  }
});

module.exports = router;
