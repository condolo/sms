/* ============================================================
   Public demo request API — /api/demo

   Self-serve flow:
     POST /request  → validate + Turnstile + rate limits, email a 6-digit OTP
     POST /verify   → OTP double opt-in, then (auto) provision a tenant
     POST /resend   → new OTP for the same pending request

   No auth, no cookies. Everything is rate-limited per IP and per email in
   demoService, and the endpoints never reveal whether an email exists
   beyond the caller's own request id.
   ============================================================ */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const demoService = require('../services/demoService');

const router = express.Router();

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many attempts — please try again later.' } },
});

const RequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  schoolName: z.string().trim().min(2).max(160),
  role: z.string().trim().max(80).optional().or(z.literal('')),
  email: z.string().trim().email().max(300),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  schoolSize: z.string().trim().max(40).optional().or(z.literal('')),
  turnstileToken: z.string().max(3000).optional().or(z.literal('')),
});

const VerifySchema = z.object({
  id: z.string().trim().min(4).max(80),
  email: z.string().trim().email().max(300),
  code: z.string().trim().regex(/^\d{6}$/),
});

const ResendSchema = z.object({
  id: z.string().trim().min(4).max(80),
  email: z.string().trim().email().max(300),
});

function _fail(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

router.post('/request', requestLimiter, async (req, res) => {
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return _fail(res, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }
  const result = await demoService.createRequest({
    ...parsed.data,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  if (!result.ok) return _fail(res, result.code, result.message, result.code === 'RATE_LIMITED' ? 429 : 400);
  return res.json({ success: true, data: result.data });
});

router.post('/verify', requestLimiter, async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return _fail(res, 'VALIDATION_ERROR', 'Enter the 6-digit code from your email.');
  const result = await demoService.verifyOtp(parsed.data);
  if (!result.ok) return _fail(res, result.code, result.message);
  return res.json({ success: true, data: result.data });
});

router.post('/resend', requestLimiter, async (req, res) => {
  const parsed = ResendSchema.safeParse(req.body);
  if (!parsed.success) return _fail(res, 'VALIDATION_ERROR', 'Request id and email are required.');
  const result = await demoService.resendOtp(parsed.data);
  if (!result.ok) return _fail(res, result.code, result.message, result.code === 'TOO_SOON' ? 429 : 400);
  return res.json({ success: true, data: result.data });
});

module.exports = router;
