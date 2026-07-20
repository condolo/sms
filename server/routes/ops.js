/* ============================================================
   Msingi — /api/ops
   Platform Operations API — superadmin only.

   Routes:
     GET  /health      — full ops report (health + integrity + compliance)
     GET  /certs       — release certificate history (last 30)
     GET  /certs/:id   — single certificate by certId
     POST /certs       — persist a release certificate (called by CI)
   ============================================================ */
'use strict';

const express = require('express');
const { platformSession } = require('../middleware/auth');
const ops = require('../services/ops');

const router = express.Router();

/* Gated on platformSession (the real platform-admin token, issued by
   POST /api/platform/auth/login — see platform.js), NOT a school-session
   'superadmin' role check. `fullReport()` below runs unscoped, platform-
   wide health/integrity/compliance checks across every school's data —
   'superadmin' is a per-school RBAC role every school's own admin holds,
   not a platform credential. Gating this route on it meant every single
   school's admin could see every OTHER school's platform-wide health,
   integrity, and compliance data, a real cross-tenant leak found via a
   direct report, not a scan. Real login as any school never sets the
   platform_token cookie platformSession checks, so this route is simply
   unreachable from a normal school session now — reachable only via a
   genuine platform-admin login (platform.html), same as every route in
   platform.js. */

const pkg = require('../../package.json');

/* ════════════════════════════════════════════════════════════════
   GET /api/ops/health
   Full platform health snapshot: health + integrity + compliance.
   ════════════════════════════════════════════════════════════════ */
router.get('/health', platformSession, async (req, res) => {
  try {
    const report = await ops.fullReport({ version: pkg.version });
    return res.json({ success: true, data: report });
  } catch (err) {
    console.error('[ops/health]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /api/ops/certs
   Release certificate history (last 30 releases, newest first).
   Shows trend: RBAC over time, integrity warnings over time, etc.
   ════════════════════════════════════════════════════════════════ */
router.get('/certs', platformSession, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const certs = await ops.release.history({ limit });
    return res.json({ success: true, data: certs });
  } catch (err) {
    console.error('[ops/certs GET]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /api/ops/certs/:certId
   Single certificate detail.
   ════════════════════════════════════════════════════════════════ */
router.get('/certs/:certId', platformSession, async (req, res) => {
  try {
    const cert = await ops.release.get({ certId: req.params.certId });
    if (!cert) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const isAuthentic = ops.release.verify(cert);
    return res.json({ success: true, data: { ...cert, isAuthentic } });
  } catch (err) {
    console.error('[ops/certs/:certId]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/ops/certs
   Persist a release certificate (called by CI scripts or manually).
   Body: the full certificate JSON including the seal field.
   ════════════════════════════════════════════════════════════════ */
router.post('/certs', platformSession, async (req, res) => {
  try {
    const cert = req.body;
    if (!cert?.certId || !cert?.seal) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'certId and seal required' } });
    }
    const saved = await ops.release.persist(cert);
    return res.status(201).json({ success: true, data: saved });
  } catch (err) {
    console.error('[ops/certs POST]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
