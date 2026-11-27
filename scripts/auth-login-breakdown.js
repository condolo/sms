#!/usr/bin/env node
'use strict';

/**
 * Login latency breakdown.
 *
 * Measures the actual stages used by POST /api/auth/login-credentials
 * against a running local MongoDB. No credentials are printed or written.
 *
 *   AUTH_LOGIN_IDENTIFIER=teacher@demo.msingi.io \
 *   AUTH_LOGIN_PASSWORD='Demo2025!' \
 *   AUTH_LOGIN_URI=mongodb://127.0.0.1:27017 \
 *   AUTH_LOGIN_DB=msingi_perf node scripts/auth-login-breakdown.js
 */

process.env.AUTH_HASH_MODE = 'worker';

const mongoose = require('mongoose');
const { performance } = require('perf_hooks');
const { findLoginCandidates } = require('../server/services/preauth-account-lookup');
const { comparePassword, closePool } = require('../server/services/passwordHash');
const { _model } = require('../server/utils/model');
const { _findSchool } = require('../server/middleware/tenant');
const SecurityService = require('../server/services/securityService');

const URI = process.env.AUTH_LOGIN_URI || 'mongodb://127.0.0.1:27017';
const DB = process.env.AUTH_LOGIN_DB || 'msingi_perf';
const IDENTIFIER = process.env.AUTH_LOGIN_IDENTIFIER || 'teacher@demo.msingi.io';
const PASSWORD = process.env.AUTH_LOGIN_PASSWORD || 'Demo2025!';
const RUNS = Number(process.env.AUTH_LOGIN_RUNS || 10);
const PROJECTION = 'id schoolId email username password identityId isActive role primaryRole roles';

const round = n => Math.round(n * 10) / 10;
const percentile = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(arr.length * p / 100) - 1)];

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, ms: round(performance.now() - start) };
}

async function main() {
  await mongoose.connect(URI, { dbName: DB });
  const Users = _model('users');

  const first = await timed(() => findLoginCandidates(IDENTIFIER.toLowerCase().trim(), PROJECTION));
  const candidate = first.value[0];
  if (!candidate) throw new Error('No demo candidate found. Start/seed the API once first.');
  const schoolId = candidate.schoolId;

  const explainEmail = await Users.find({ email: IDENTIFIER.toLowerCase().trim() })
    .collation({ locale: 'en', strength: 2 }).explain('executionStats');
  const explainUsername = await Users.find({ username: IDENTIFIER.toLowerCase().trim() }).explain('executionStats');
  const planOf = explain => explain?.queryPlanner?.winningPlan;
  const summarizePlan = plan => JSON.stringify(plan);

  const stages = { lookup: [], password: [], fullUser: [], school: [], lock: [] };
  for (let i = 0; i < RUNS; i += 1) {
    const lookup = await timed(() => findLoginCandidates(IDENTIFIER.toLowerCase().trim(), PROJECTION));
    stages.lookup.push(lookup.ms);
    const row = lookup.value[0] || candidate;
    const password = await timed(() => comparePassword(PASSWORD, row.password));
    stages.password.push(password.ms);
    const fullUser = await timed(() => Users.findOne({ id: row.id, schoolId }).lean());
    stages.fullUser.push(fullUser.ms);
    const school = await timed(() => _findSchool({ id: schoolId }));
    stages.school.push(school.ms);
    const lock = await timed(() => SecurityService.checkAccountLock(schoolId, IDENTIFIER));
    stages.lock.push(lock.ms);
  }

  const report = {};
  for (const [name, values] of Object.entries(stages)) {
    report[name] = { p50: percentile(values, 50), p95: percentile(values, 95), min: Math.min(...values), max: Math.max(...values) };
  }
  console.log(JSON.stringify({
    identifier: IDENTIFIER,
    candidates: first.value.length,
    stagesMs: report,
    plans: {
      email: summarizePlan(planOf(explainEmail)),
      username: summarizePlan(planOf(explainUsername)),
    },
  }, null, 2));

  await closePool();
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await closePool().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
