/* ============================================================
   Public outreach unsubscribe endpoints — /api/outreach/*

   The HMAC token identifies one send without exposing lead IDs.
   GET shows a confirmation page; POST supports one-click mail
   client unsubscribe and suppresses the address immediately.
   ============================================================ */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const outreach = require('../services/outreachService');
const { escapeHtml } = require('../utils/outreach-email-template');
const { E } = require('../utils/response');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const GREEN = '#0f172a';
const GOLD = '#00e898';
const CREAM = '#f8fafc';
const MUTED = '#475569';

function shell(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:${CREAM};font-family:Arial,Helvetica,sans-serif;color:#14231d;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CREAM};"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:480px;background:#fffdf8;border:1px solid #e7e0d3;border-radius:14px;overflow:hidden;box-shadow:0 16px 40px rgba(20,35,29,.10);">
<tr><td style="padding:22px 26px;background:${GREEN};border-bottom:3px solid ${GOLD};"><img src="https://msingi.io/api/public/platform-asset/logo" width="250" alt="Msingi — School Management Platform" style="display:block;width:250px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td style="padding:30px 26px;">${body}</td></tr>
</table></td></tr></table></body></html>`;
}

function page(title, message, token, action) {
  const form = action
    ? `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" style="border:0;background:${GOLD};color:${GREEN};padding:14px 22px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">Unsubscribe me</button></form>`
    : '';
  return shell(title, `<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#14231d;">${escapeHtml(title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:${MUTED};">${escapeHtml(message)}</p>${form}`);
}

function resultPage(ok, message) {
  const title = ok ? 'You have been unsubscribed' : 'Could not unsubscribe';
  return shell(title, `<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#14231d;">${escapeHtml(title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.7;color:${MUTED};">${escapeHtml(message)}</p>`);
}

function wantsHtml(req) {
  return String(req.headers.accept || '').includes('text/html');
}

router.get('/unsubscribe/:token', limiter, (req, res) => {
  try {
    const valid = outreach.verifyUnsubscribeToken(req.params.token);
    if (!valid) return res.status(400).type('html').send(page('Link unavailable', 'This unsubscribe link is invalid or has expired.'));
    return res.type('html').send(page('Unsubscribe from Msingi emails', 'Confirm below and we will stop outreach emails to this address immediately.', req.params.token, '/api/outreach/unsubscribe'));
  } catch (error) {
    return res.status(500).type('html').send(page('Something went wrong', 'Please try again later.'));
  }
});

async function handleUnsubscribe(req, res, token) {
  try {
    const result = await outreach.unsubscribeByToken(token);
    if (!result.ok) {
      if (wantsHtml(req)) return res.status(400).type('html').send(resultPage(false, result.message));
      return E.badRequest(res, result.message);
    }
    if (wantsHtml(req)) return res.type('html').send(resultPage(true, 'We will no longer send outreach email to this address.'));
    return res.json({ success: true, message: 'You have been unsubscribed.' });
  } catch (error) {
    if (wantsHtml(req)) return res.status(500).type('html').send(resultPage(false, 'Please try again later.'));
    return E.serverError(res, 'Could not update your preference right now.');
  }
}

router.post('/unsubscribe/:token', limiter, (req, res) => handleUnsubscribe(req, res, req.params.token));

router.post('/unsubscribe', limiter, async (req, res) => {
  const parsed = z.object({ token: z.string().trim().min(1).max(2000) }).safeParse(req.body || {});
  if (!parsed.success) {
    if (wantsHtml(req)) return res.status(400).type('html').send(resultPage(false, 'Invalid unsubscribe request.'));
    return E.badRequest(res, 'Invalid unsubscribe request.');
  }
  return handleUnsubscribe(req, res, parsed.data.token);
});

module.exports = router;
