#!/usr/bin/env node
'use strict';

/**
 * Repeatable local API load test.
 *
 * Spawns the real server against a dedicated MongoDB database, lets the
 * normal demo seed run, logs in each persona, then drives the slow route
 * families from the Live Analytics screen with a fixed concurrency for a
 * fixed duration. It records TRUE client-side percentiles (not the
 * histogram bucket ceilings the console shows) and writes a JSON artifact
 * plus a Markdown summary so a "before" run can be compared with an
 * "after" run after optimisation.
 *
 * Usage:
 *   node scripts/perf-load-test.js                       # baseline
 *   PERF_LABEL=optimised PERF_OUT=docs/perf/optimised.json node scripts/perf-load-test.js
 *
 * Optional env:
 *   PERF_PORT=3005              PERF_BASE_URL=http://127.0.0.1:3005
 *   PERF_MONGO_URI=mongodb://127.0.0.1:27017
 *   PERF_DB_NAME=msingi_perf
 *   PERF_CONCURRENCY=10         PERF_DURATION_SEC=12      PERF_WARMUP=2
 *   PERF_NO_SPAWN=1             (measure an already-running server)
 *   PERF_JWT_SECRET=...         PERF_PLATFORM_JWT_SECRET=...
 *   PERF_NODE_ENV=development
 *
 * Never prints credentials. The demo password is intentionally public in
 * the seed script; this harness never writes it to the artifact.
 */

const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { mkdirSync, writeFileSync } = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PERF_PORT || 3005);
const BASE_URL = (process.env.PERF_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const MONGO_URI = process.env.PERF_MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.PERF_DB_NAME || 'msingi_perf';
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY || 10);
const DURATION_SEC = Number(process.env.PERF_DURATION_SEC || 12);
const WARMUP = Number(process.env.PERF_WARMUP || 2);
const ROUNDS = Number(process.env.PERF_ROUNDS || 1);
const ROTATE_IP = process.env.PERF_ROTATE_IP === '1';
const LABEL = process.env.PERF_LABEL || 'run';
const OUT_JSON = path.resolve(process.env.PERF_OUT || path.join(ROOT, 'docs', 'perf', `${LABEL}.json`));
const OUT_MD = path.resolve(process.env.PERF_OUT_MD || path.join(ROOT, 'docs', 'perf', `${LABEL}.md`));
const NO_SPAWN = process.env.PERF_NO_SPAWN === '1';
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS || 30000);

const DEMO_PASSWORD = 'Demo2025!';
const SCHOOL_ID = 'sch_demo';

function cfgError(message) {
  console.error(`[perf] ${message}`);
  process.exit(2);
}
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) cfgError('PERF_CONCURRENCY must be a positive integer.');
if (!Number.isFinite(DURATION_SEC) || DURATION_SEC <= 0) cfgError('PERF_DURATION_SEC must be positive.');
if (!Number.isInteger(WARMUP) || WARMUP < 0) cfgError('PERF_WARMUP must be a non-negative integer.');
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) cfgError('PERF_ROUNDS must be a positive integer.');

const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

/* ── server lifecycle ───────────────────────────────────────────── */

function startServer() {
  const env = {
    ...process.env,
    MONGODB_URI: MONGO_URI,
    MONGODB_DB_NAME: DB_NAME,
    JWT_SECRET: process.env.PERF_JWT_SECRET || 'perf_only_jwt_secret_do_not_use_in_production',
    PLATFORM_JWT_SECRET: process.env.PERF_PLATFORM_JWT_SECRET || 'perf_only_platform_secret_do_not_use_in_production',
    PORT: String(PORT),
    NODE_ENV: process.env.PERF_NODE_ENV || 'development',
    ALLOW_DEMO_SEED: '1',
    // Client-side timing is what we measure; disable telemetry writes so the
    // harness itself does not add DB load to the numbers.
    PLATFORM_TELEMETRY: '0',
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = [];
  const keep = (chunk) => {
    tail.push(String(chunk).trim());
    if (tail.length > 40) tail = tail.slice(-40);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.serverLogTail = () => tail.join('\n');
  return child;
}

async function waitForRouteReady(name, path, token, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await request({ name, method: 'GET', path, token });
    if (last.status >= 200 && last.status < 400) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${name} never became ready (last status ${last?.status}: ${last?.errorMessage})`);
}

async function waitForHealth(child) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}):\n${child.serverLogTail()}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      const body = await res.json();
      if (res.ok && body?.status === 'ok' && body?.db === 'connected') {
        // Let the post-listen self-healing migrations settle before measuring.
        await new Promise(resolve => setTimeout(resolve, 8000));
        return;
      }
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`server did not become healthy within 90s:\n${child ? child.serverLogTail() : ''}`);
}

/* ── auth + id discovery ────────────────────────────────────────── */

async function login(identifier) {
  const res = await fetch(`${BASE_URL}/api/auth/login-credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: DEMO_PASSWORD, platform: 'mobile' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  const token = body?.data?.token ?? body?.token;
  if (!token) {
    throw new Error(`login failed for ${identifier} (status ${res.status}): ${JSON.stringify(body?.error || body || {}).slice(0, 300)}`);
  }
  return token;
}

async function discoverIds(teacherToken) {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 10000 });
  const schema = new mongoose.Schema({}, { strict: false, versionKey: false });
  const Schools = mongoose.model('PerfSchools', schema, 'schools');
  const Students = mongoose.model('PerfStudents', schema, 'students');
  const stu = await Students.findOne({ schoolId: SCHOOL_ID }).lean();

  // The asset route needs a real logo to fetch and decode. The demo seed
  // does not set one, so give the perf DB a ~1 MB data-URI blob so cold
  // asset reads exercise the same DB read + synchronous base64 decode as
  // production. Idempotent: only written when missing.
  const school = await Schools.findOne({ id: SCHOOL_ID }).lean();
  if (!school?.logoBase64) {
    const blob = Buffer.alloc(750_000, 0x61).toString('base64');
    await Schools.updateOne(
      { id: SCHOOL_ID },
      { $set: { logoBase64: `data:image/png;base64,${blob}` } },
    );
  }
  await mongoose.disconnect();

  // Pick a class from the teacher's own scoped list, not an arbitrary class
  // in the collection (the first one may be outside their assignment).
  const res = await fetch(`${BASE_URL}/api/classes?limit=1`, {
    headers: { authorization: `Bearer ${teacherToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json();
  const list = Array.isArray(body?.data) ? body.data : (body?.data?.items || []);
  const cls = list[0];
  return {
    classId: cls?.id || cls?._id?.toString() || null,
    studentId: stu?.id || stu?._id?.toString() || null,
    logoSeeded: !school?.logoBase64,
  };
}

/* ── load driver ────────────────────────────────────────────────── */

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

let requestCounter = 0;

async function request(route) {
  const started = performance.now();
  try {
    const headers = {};
    // The login rate limiters key on client IP. With several long rounds a
    // single local IP would exhaust the 300/15min bucket and every later
    // request would be a fast 429, destroying the measurement. The server
    // trusts proxy headers, so spread synthetic load across IPs.
    if (ROTATE_IP) {
      requestCounter += 1;
      const n = requestCounter;
      const ip = `10.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
      headers['x-forwarded-for'] = ip;
      headers['cf-connecting-ip'] = ip;
    }
    if (route.body) headers['content-type'] = 'application/json';
    if (route.token) headers.authorization = `Bearer ${route.token}`;
    const res = await fetch(BASE_URL + route.path, {
      method: route.method,
      headers,
      body: route.body ? JSON.stringify(route.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* binary or plain */ }
    return {
      ms: round(performance.now() - started),
      status: res.status,
      errorCode: body?.error?.code ?? null,
      errorMessage: body?.error?.message ?? null,
      bytes: text.length,
    };
  } catch (error) {
    return {
      ms: round(performance.now() - started),
      status: 0,
      errorCode: error?.cause?.code ?? error?.name ?? 'FETCH_ERROR',
      errorMessage: error?.message ?? null,
      bytes: 0,
    };
  }
}

function summarise(route, samples) {
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const statusCounts = {};
  const errorCodes = {};
  const errorMessages = {};
  let bytes = 0;
  for (const s of samples) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
    if (s.errorCode) errorCodes[s.errorCode] = (errorCodes[s.errorCode] || 0) + 1;
    if (s.errorMessage) errorMessages[s.errorMessage] = (errorMessages[s.errorMessage] || 0) + 1;
    bytes += s.bytes;
  }
  const okCount = Object.entries(statusCounts)
    .filter(([status]) => Number(status) >= 200 && Number(status) < 400)
    .reduce((sum, [, count]) => sum + count, 0);
  const mean = times.reduce((sum, v) => sum + v, 0) / (times.length || 1);
  return {
    name: route.name,
    method: route.method,
    path: route.path,
    requests: samples.length,
    concurrency: CONCURRENCY,
    durationSec: DURATION_SEC,
    warmup: WARMUP,
    statusCounts,
    okPct: round((okCount / (samples.length || 1)) * 100),
    avgResponseBytes: round(bytes / (samples.length || 1), 0),
    throughputRps: round(samples.length / DURATION_SEC),
    latencyMs: {
      min: times[0] || 0,
      p50: percentile(times, 50),
      p90: percentile(times, 90),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: times.at(-1) || 0,
      mean: round(mean),
    },
    topErrorCodes: Object.entries(errorCodes)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([code, count]) => ({ code, count })),
    topErrorMessages: Object.entries(errorMessages)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([message, count]) => ({ message, count })),
  };
}

async function runRoute(route) {
  const rounds = [];
  for (let r = 0; r < ROUNDS; r += 1) {
    for (let i = 0; i < WARMUP; i += 1) await request(route);
    const samples = [];
    const deadline = performance.now() + DURATION_SEC * 1000;
    while (performance.now() < deadline) {
      const batch = [];
      for (let i = 0; i < CONCURRENCY && performance.now() < deadline; i += 1) {
        batch.push(request(route).then(sample => { samples.push(sample); }));
      }
      await Promise.all(batch);
    }
    rounds.push(summarise(route, samples));
  }
  if (ROUNDS === 1) return rounds[0];

  // Local machines are noisy. Take the median round's p95 as the headline
  // number and keep every round so variance is visible in the artifact.
  const p95s = rounds.map(result => result.latencyMs.p95).sort((a, b) => a - b);
  const median = percentile(p95s, 50);
  const chosen = rounds.reduce((best, result) =>
    Math.abs(result.latencyMs.p95 - median) < Math.abs(best.latencyMs.p95 - median) ? result : best, rounds[0]);
  return {
    ...chosen,
    rounds: rounds.map(result => ({
      requests: result.requests,
      p50: result.latencyMs.p50,
      p95: result.latencyMs.p95,
      p99: result.latencyMs.p99,
      max: result.latencyMs.max,
    })),
  };
}

/* ── artifact ───────────────────────────────────────────────────── */

function writeArtifact(report) {
  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');

  const lines = [
    `# Local API load test — ${LABEL}`,
    '',
    `- Captured: ${report.capturedAt}`,
    `- Node: ${report.environment.node} (${report.environment.platform})`,
    `- Concurrency: ${CONCURRENCY}, duration: ${DURATION_SEC}s per round, warmup: ${WARMUP}, rounds: ${ROUNDS}`,
    `- Headline p95: median of ${ROUNDS} round(s)`,
    `- Database: ${DB_NAME} (local MongoDB)`,
    '',
    'True client-side percentiles (not histogram buckets):',
    '',
    '| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of report.routes) {
    const l = r.latencyMs;
    lines.push(`| ${r.method} ${r.name} | ${r.requests} | ${l.p50} | ${l.p90} | ${l.p95} | ${l.p99} | ${l.max} | ${l.mean} | ${r.throughputRps} | ${r.okPct} |`);
  }
  if (ROUNDS > 1) {
    lines.push('', 'Per-round p95 (ms):', '');
    for (const r of report.routes) {
      if (r.rounds) lines.push(`- **${r.name}**: ${r.rounds.map(x => x.p95).join(', ')}`);
    }
  }
  lines.push('', 'Status counts:', '');
  for (const r of report.routes) {
    const detail = [
      ...r.topErrorCodes.map(e => `${e.code}(${e.count})`),
      ...r.topErrorMessages.map(e => `"${e.message}"(${e.count})`),
    ];
    lines.push(`- **${r.name}**: ${JSON.stringify(r.statusCounts)}${detail.length ? ` — errors: ${detail.join(', ')}` : ''}`);
  }
  lines.push('', `Raw data: \`${path.relative(ROOT, OUT_JSON).replace(/\\/g, '/')}\``, '');
  writeFileSync(OUT_MD, lines.join('\n'));
  console.log(`\n[perf] wrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_MD)}`);
}

/* ── main ───────────────────────────────────────────────────────── */

async function main() {
  let child = null;
  try {
    if (!NO_SPAWN) {
      child = startServer();
      console.log(`[perf] starting API on ${BASE_URL} (db: ${DB_NAME})`);
    }
    await waitForHealth(child);

    const tokens = {
      admin: await login('admin@demo.msingi.io'),
      teacher: await login('teacher@demo.msingi.io'),
      student: await login('demo-student'),
      parent: await login('parent@demo.msingi.io'),
    };

    const ids = await discoverIds(tokens.teacher);
    if (!ids.classId || !ids.studentId) {
      throw new Error(`demo seed missing class/student (classId=${ids.classId}, studentId=${ids.studentId})`);
    }

    const routes = [
      { name: 'auth-me', method: 'GET', path: '/api/auth/me', token: tokens.teacher },
      { name: 'login-credentials', method: 'POST', path: '/api/auth/login-credentials', body: { identifier: 'teacher@demo.msingi.io', password: DEMO_PASSWORD, platform: 'mobile' } },
      { name: 'student-dashboard', method: 'GET', path: '/api/student-portal/dashboard', token: tokens.student },
      { name: 'assessment-reminders', method: 'GET', path: '/api/assessment/reminders', token: tokens.teacher },
      { name: 'class-students', method: 'GET', path: `/api/classes/${ids.classId}/students`, token: tokens.teacher },
      { name: 'parent-report', method: 'GET', path: `/api/parent-portal/report/${ids.studentId}`, token: tokens.parent },
      { name: 'school-asset', method: 'GET', path: `/api/public/school-asset/logo?slug=${SCHOOL_ID}` },
    ];

    // The server finishes permission/seed backfills asynchronously after it
    // starts listening. Do not record a baseline until the protected routes
    // actually answer 200, otherwise the "before" numbers are 403 noise.
    await waitForRouteReady('class-students', routes.find(r => r.name === 'class-students').path, tokens.teacher);
    await waitForRouteReady('parent-report', routes.find(r => r.name === 'parent-report').path, tokens.parent);
    await waitForRouteReady('school-asset', routes.find(r => r.name === 'school-asset').path, null);

    const results = [];
    for (const route of routes) {
      process.stdout.write(`[perf] measuring ${route.name} ... `);
      const result = await runRoute(route);
      results.push(result);
      console.log(`p95 ${result.latencyMs.p95}ms  p99 ${result.latencyMs.p99}ms  max ${result.latencyMs.max}ms  ${JSON.stringify(result.statusCounts)}`);
    }

    writeArtifact({
      label: LABEL,
      capturedAt: new Date().toISOString(),
      environment: { node: process.version, platform: process.platform, arch: process.arch, baseUrl: BASE_URL },
      config: { concurrency: CONCURRENCY, durationSec: DURATION_SEC, warmup: WARMUP, rounds: ROUNDS, rotateIp: ROTATE_IP, timeoutMs: TIMEOUT_MS },
      discovered: ids,
      routes: results,
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 8000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      }).catch(() => {});
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[perf] FAILED: ${error.message}`);
  process.exitCode = 1;
});
