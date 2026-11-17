/* ============================================================
   GET /api/platform/analytics/* — read-only control-center data.

   Gated by the platform session cookie (the same door as
   /api/ops/*), never by a school JWT. Every query reads the
   pre-aggregated telemetry collections; no raw request logs and
   no writes here.
   ============================================================ */
'use strict';

const express = require('express');
const { platformSession } = require('../middleware/auth');
const { ok, E } = require('../utils/response');
const telemetry = require('../utils/telemetry');

const router = express.Router();

router.use(platformSession);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

const RANGES = new Set(['24h', '7d', '30d']);
function rangeOf(req) {
  const r = String(req.query.range || '24h');
  return RANGES.has(r) ? r : '24h';
}

router.get('/overview', async (_req, res) => {
  try {
    return ok(res, await telemetry.overview());
  } catch (err) {
    console.error('[platform/analytics overview]', err);
    return E.serverError(res);
  }
});

router.get('/history', async (req, res) => {
  try {
    return ok(res, await telemetry.history(rangeOf(req)));
  } catch (err) {
    console.error('[platform/analytics history]', err);
    return E.serverError(res);
  }
});

router.get('/schools', async (req, res) => {
  try {
    return ok(res, await telemetry.schools(rangeOf(req)));
  } catch (err) {
    console.error('[platform/analytics schools]', err);
    return E.serverError(res);
  }
});

router.get('/modules', async (req, res) => {
  try {
    return ok(res, await telemetry.modules(rangeOf(req)));
  } catch (err) {
    console.error('[platform/analytics modules]', err);
    return E.serverError(res);
  }
});

router.get('/errors', async (req, res) => {
  try {
    return ok(res, await telemetry.errors(rangeOf(req)));
  } catch (err) {
    console.error('[platform/analytics errors]', err);
    return E.serverError(res);
  }
});

router.get('/error-log', async (req, res) => {
  try {
    const status = ['4xx', '5xx'].includes(String(req.query.status)) ? String(req.query.status) : 'all';
    const q = String(req.query.q || '').trim().slice(0, 120);
    return ok(res, await telemetry.errorLog(rangeOf(req), { status, q, limit: req.query.limit }));
  } catch (err) {
    console.error('[platform/analytics error-log]', err);
    return E.serverError(res);
  }
});

router.get('/system', async (_req, res) => {
  try {
    return ok(res, await telemetry.system());
  } catch (err) {
    console.error('[platform/analytics system]', err);
    return E.serverError(res);
  }
});

module.exports = router;
