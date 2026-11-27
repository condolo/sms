#!/usr/bin/env node
'use strict';

/**
 * Low-volume live API performance smoke test.
 *
 * Uses the public demo school and never prints/writes credentials or tokens.
 * Defaults to 10 requests per read route and 5 logins at concurrency 2 — this
 * is a smoke test, not a production load test.
 *
 *   LIVE_PERF_BASE_URL=https://msingi.io node scripts/live-perf-smoke.js
 *
 * Optional: LIVE_PERF_REQUESTS, LIVE_PERF_LOGIN_REQUESTS, LIVE_PERF_CONCURRENCY,
 * LIVE_PERF_LABEL, LIVE_PERF_OUT.
 */

const { performance } = require('perf_hooks');
const { mkdirSync, writeFileSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = (process.env.LIVE_PERF_BASE_URL || 'https://msingi.io').replace(/\/$/, '');
const REQUESTS = Number(process.env.LIVE_PERF_REQUESTS || 10);
const LOGIN_REQUESTS = Number(process.env.LIVE_PERF_LOGIN_REQUESTS || 5);
const CONCURRENCY = Number(process.env.LIVE_PERF_CONCURRENCY || 2);
const WARMUP = Number(process.env.LIVE_PERF_WARMUP || 1);
const LABEL = process.env.LIVE_PERF_LABEL || 'live-smoke';
const OUT_JSON = path.resolve(process.env.LIVE_PERF_OUT || path.join(ROOT, 'docs', 'perf', `${LABEL}.json`));
const OUT_MD = OUT_JSON.replace(/\.json$/, '.md');
const TIMEOUT_MS = Number(process.env.LIVE_PERF_TIMEOUT_MS || 30000);
const PASSWORD = 'Demo2025!';

const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p / 100) - 1)];

async function request({ method = 'GET', path: routePath, token, body, accept = [200] }) {
  const started = performance.now();
  try {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(BASE + routePath, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    return {
      ms: round(performance.now() - started),
      status: response.status,
      bytes,
      accepted: accept.includes(response.status),
    };
  } catch (error) {
    return {
      ms: round(performance.now() - started),
      status: 0,
      bytes: 0,
      accepted: false,
      error: error?.cause?.code ?? error?.name ?? 'FETCH_ERROR',
    };
  }
}

async function login(identifier) {
  const response = await fetch(`${BASE}/api/auth/login-credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD, platform: 'mobile' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  const token = body?.data?.token ?? body?.token;
  if (!token) throw new Error(`login failed for ${identifier}: status ${response.status}`);
  return token;
}

async function getJson(routePath, token) {
  const response = await fetch(BASE + routePath, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: await response.json() };
}

async function measure(route) {
  for (let i = 0; i < WARMUP; i += 1) await request(route);
  const samples = [];
  const count = route.name === 'login-credentials' ? LOGIN_REQUESTS : REQUESTS;
  for (let i = 0; i < count; i += CONCURRENCY) {
    const batch = [];
    for (let j = 0; j < CONCURRENCY && i + j < count; j += 1) batch.push(request(route));
    samples.push(...await Promise.all(batch));
  }
  const times = samples.map(s => s.ms);
  const statuses = {};
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] || 0) + 1;
  return {
    name: route.name,
    method: route.method,
    path: route.path,
    requests: samples.length,
    statusCounts: statuses,
    okPct: round(samples.filter(s => s.accepted).length / samples.length * 100),
    avgBytes: round(samples.reduce((sum, s) => sum + s.bytes, 0) / samples.length, 0),
    latencyMs: {
      min: Math.min(...times),
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      max: Math.max(...times),
      mean: round(times.reduce((sum, n) => sum + n, 0) / times.length),
    },
  };
}

async function main() {
  const health = await getJson('/api/health');
  if (health.status !== 200) throw new Error(`health check failed: ${health.status}`);

  const tokens = {
    teacher: await login('teacher@demo.msingi.io'),
    student: await login('demo-student'),
    parent: await login('parent@demo.msingi.io'),
  };

  const [_teacherMe, studentMe, parentMe, classes] = await Promise.all([
    getJson('/api/auth/me', tokens.teacher),
    getJson('/api/auth/me', tokens.student),
    getJson('/api/auth/me', tokens.parent),
    getJson('/api/classes?limit=1', tokens.teacher),
  ]);
  const studentId = studentMe.body?.user?.studentId
    || parentMe.body?.user?.studentIds?.[0]
    || parentMe.body?.user?.guardianOf?.[0]
    || 'std_demo_1';
  const classId = classes.body?.data?.[0]?.id || 'cls_demo_f1a';

  const routes = [
    { name: 'health', method: 'GET', path: '/api/health' },
    { name: 'auth-me', method: 'GET', path: '/api/auth/me', token: tokens.teacher },
    { name: 'login-credentials', method: 'POST', path: '/api/auth/login-credentials', body: { identifier: 'teacher@demo.msingi.io', password: PASSWORD, platform: 'mobile' } },
    { name: 'student-dashboard', method: 'GET', path: '/api/student-portal/dashboard', token: tokens.student },
    { name: 'assessment-reminders', method: 'GET', path: '/api/assessment/reminders', token: tokens.teacher },
    { name: 'class-students', method: 'GET', path: `/api/classes/${classId}/students`, token: tokens.teacher },
    { name: 'parent-report', method: 'GET', path: `/api/parent-portal/report/${studentId}`, token: tokens.parent },
    { name: 'school-asset', method: 'GET', path: '/api/public/school-asset/logo?slug=sch_demo', accept: [200, 404] },
    { name: 'class-rosters-batch', method: 'POST', path: '/api/classes/rosters/batch', token: tokens.teacher, body: { classIds: [classId], status: 'active' }, accept: [200, 404] },
  ];

  const results = [];
  for (const route of routes) {
    const result = await measure(route);
    results.push(result);
    console.log(`[live] ${route.name}: p95 ${result.latencyMs.p95}ms  statuses ${JSON.stringify(result.statusCounts)}`);
  }

  const report = {
    label: LABEL,
    capturedAt: new Date().toISOString(),
    baseUrl: BASE,
    config: { requests: REQUESTS, loginRequests: LOGIN_REQUESTS, concurrency: CONCURRENCY, warmup: WARMUP },
    health: health.body,
    discovered: { classId, studentId },
    routes: results,
  };
  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');

  const lines = [
    `# Live API smoke test — ${LABEL}`,
    '',
    `- Captured: ${report.capturedAt}`,
    `- Base URL: ${BASE}`,
    `- Health: ${health.body.status} · version ${health.body.version} · db ${health.body.db}`,
    `- Requests: ${REQUESTS}/read route, ${LOGIN_REQUESTS}/login, concurrency ${CONCURRENCY}, warmup ${WARMUP}`,
    '',
    '| Endpoint | p50 | p95 | Max | Avg bytes | OK% | Statuses |',
    '|---|---:|---:|---:|---:|---:|---|',
  ];
  for (const r of results) {
    lines.push(`| ${r.method} ${r.name} | ${r.latencyMs.p50} | ${r.latencyMs.p95} | ${r.latencyMs.max} | ${r.avgBytes} | ${r.okPct} | ${JSON.stringify(r.statusCounts)} |`);
  }
  lines.push('', `Raw data: \`${path.relative(ROOT, OUT_JSON).replace(/\\/g, '/')}\``, '');
  writeFileSync(OUT_MD, lines.join('\n'));
  console.log(`[live] wrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_MD)}`);
}

main().catch(error => { console.error(`[live] ${error.message}`); process.exitCode = 1; });
