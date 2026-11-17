'use strict';
/* Manual integration smoke for exact error capture.
 * Run with a local Mongo: node scripts/telemetry-error-smoke.js
 * Exercises 400/422/500 envelopes, validation issues, unhandled
 * exceptions, dedupe, redaction and the error-log filters. */
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const telemetry = require('../server/utils/telemetry');
const { _model } = require('../server/utils/model');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const TEST_ROUTES = ['/api/err/test', '/api/err/boom', '/api/err/plain', '/api/err/validate', '/api/err/throw'];
  await _model('platform_error_samples').deleteMany({ route: { $in: TEST_ROUTES } });
  await _model('platform_traffic_min').deleteMany({ route: { $in: TEST_ROUTES } });
  const app = express();
  app.use(express.json());
  app.use(telemetry.middleware());
  app.get('/api/err/test', (_req, res) => {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name is required for user test@example.com' } });
  });
  app.get('/api/err/boom', (_req, res) => {
    res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Mongo timeout after 30000ms' } });
  });
  app.get('/api/err/plain', (_req, res) => {
    res.status(422).json({ success: false, error: 'Class is archived' });
  });
  app.get('/api/err/validate', (_req, res) => {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: [{ message: 'guardianPhone must be a valid phone' }],
      },
    });
  });
  app.get('/api/err/throw', () => {
    throw new Error('Cannot read properties of undefined (reading schoolId)');
  });
  app.use((err, req, res, next) => {
    telemetry.recordException(err, req);
    res.status(500).json({ error: 'Internal server error' });
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const hit = (p) => fetch(`http://127.0.0.1:${port}${p}`);
  await hit('/api/err/test');
  await hit('/api/err/test');
  await hit('/api/err/boom');
  await hit('/api/err/plain');
  await hit('/api/err/validate');
  await hit('/api/err/throw');

  let res = await hit('/api/err/test');
  if (res.status !== 400) throw new Error('telemetry intercepted response');

  await telemetry.flush();
  const all = await telemetry.errorLog('24h');
  const five = await telemetry.errorLog('24h', { status: '5xx' });
  const four = await telemetry.errorLog('24h', { status: '4xx' });
  const search = await telemetry.errorLog('24h', { q: 'timeout' });

  const testRow = all.find((r) => r.route === '/api/err/test');
  const throwRow = all.find((r) => r.route === '/api/err/throw');
  const valRow = all.find((r) => r.route === '/api/err/validate');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const errOnly = all.filter((r) => r.route.startsWith('/api/err/'));
  const fiveErr = five.filter((r) => r.route.startsWith('/api/err/'));
  const fourErr = four.filter((r) => r.route.startsWith('/api/err/'));
  assert(testRow && testRow.count === 3, 'dedupe/count failed');
  assert(testRow.message === 'Name is required for user <email>', 'email redaction failed');
  assert(fiveErr.length === 2 && fiveErr.every((r) => r.status === 500), '5xx filter failed');
  assert(fourErr.length === 3 && fourErr.every((r) => r.status < 500), '4xx filter failed');
  assert(errOnly.every((r) => typeof r.message === 'string' && r.message.length > 0), 'message missing');
  assert(errOnly.every((r) => r.firstAt && r.lastAt), 'timestamps missing');
  assert(throwRow && throwRow.detail === 'Cannot read properties of undefined (reading schoolId)',
    'unhandled exception detail missing');
  assert(throwRow.message === 'Internal server error', 'response message changed');
  assert(valRow && valRow.detail === 'guardianPhone must be a valid phone', 'validation issue detail missing');
  assert(valRow.code === 'VALIDATION_ERROR', 'validation code missing');

  console.log(JSON.stringify({
    all: all.map((r) => ({ route: r.route, status: r.status, code: r.code, message: r.message, count: r.count })),
    five: five.length,
    four: four.length,
    search: search.length,
    assertions: 'passed',
  }, null, 2));

  await _model('platform_error_samples').deleteMany({ route: { $in: TEST_ROUTES } });
  await _model('platform_traffic_min').deleteMany({ route: { $in: TEST_ROUTES } });
  server.close();
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch {} process.exit(1); });
