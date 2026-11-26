#!/usr/bin/env node
'use strict';

/**
 * Auth latency smoke/load test.
 *
 * Requires a running API and a known account. Credentials are read from the
 * environment and never printed or written to disk.
 *
 *   AUTH_PERF_IDENTIFIER=teacher@demo.msingi.io \
 *   AUTH_PERF_PASSWORD='Demo2025!' \
 *     npm run test:auth:perf
 *
 * Any endpoint can be measured by supplying a JSON body:
 *   AUTH_PERF_PATH=/api/auth/mobile/otp/request \
 *   AUTH_PERF_PAYLOAD='{"email":"parent@demo.msingi.io"}' \
 *   AUTH_PERF_EXPECT_STATUS=200 npm run test:auth:perf
 *
 * AUTH_PERF_PAYLOAD also accepts @path/to/file. For mixed outcomes use
 * AUTH_PERF_EXPECT_STATUSES, e.g. '200:1,401:9'. Credentials are never printed
 * or written to disk by this script.
 *
 * Optional:
 *   AUTH_PERF_BASE_URL=http://localhost:3005
 *   AUTH_PERF_CONCURRENCY=10
 *   AUTH_PERF_WARMUP=2
 *   AUTH_PERF_MAX_P95_MS=5000
 */

const { readFileSync } = require('fs');
const { performance } = require('perf_hooks');

const baseUrl = (process.env.AUTH_PERF_BASE_URL || 'http://localhost:3005').replace(/\/$/, '');
const endpoint = process.env.AUTH_PERF_PATH || '/api/auth/login-credentials';
const payloadSpec = process.env.AUTH_PERF_PAYLOAD;
const identifier = process.env.AUTH_PERF_IDENTIFIER;
const password = process.env.AUTH_PERF_PASSWORD;
const concurrency = Number(process.env.AUTH_PERF_CONCURRENCY || 10);
const defaultWarmup = endpoint.includes('/otp/') ? 0 : 2;
const warmup = Number(process.env.AUTH_PERF_WARMUP || defaultWarmup);
const maxP95Ms = Number(process.env.AUTH_PERF_MAX_P95_MS || 5000);
const timeoutMs = Number(process.env.AUTH_PERF_TIMEOUT_MS || 30000);
const expectedStatus = Number(process.env.AUTH_PERF_EXPECT_STATUS || 200);
const expectedStatuses = process.env.AUTH_PERF_EXPECT_STATUSES || null;
const requireToken = process.env.AUTH_PERF_REQUIRE_TOKEN === '1'
  || (!payloadSpec && endpoint === '/api/auth/login-credentials');

let requestBody;
if (payloadSpec) {
  requestBody = JSON.parse(payloadSpec.startsWith('@')
    ? readFileSync(payloadSpec.slice(1), 'utf8')
    : payloadSpec);
} else if (identifier && password) {
  requestBody = { identifier, password, platform: 'mobile' };
} else {
  console.error('Set AUTH_PERF_PAYLOAD, or AUTH_PERF_IDENTIFIER and AUTH_PERF_PASSWORD.');
  process.exit(2);
}
const serializedBody = JSON.stringify(requestBody);

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  console.error('AUTH_PERF_CONCURRENCY must be an integer between 1 and 100.');
  process.exit(2);
}
if (!Number.isInteger(warmup) || warmup < 0 || warmup > 100) {
  console.error('AUTH_PERF_WARMUP must be an integer between 0 and 100.');
  process.exit(2);
}
if (!Number.isFinite(maxP95Ms) || maxP95Ms <= 0) {
  console.error('AUTH_PERF_MAX_P95_MS must be a positive number.');
  process.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('AUTH_PERF_TIMEOUT_MS must be a positive number.');
  process.exit(2);
}
if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
  console.error('AUTH_PERF_EXPECT_STATUS must be an integer between 100 and 599.');
  process.exit(2);
}
const wanted = expectedStatuses ? parseStatusCounts(expectedStatuses) : { [expectedStatus]: concurrency };
if (!wanted || Object.values(wanted).reduce((sum, count) => sum + count, 0) !== concurrency) {
  console.error('AUTH_PERF_EXPECT_STATUSES must contain valid status:count pairs totaling AUTH_PERF_CONCURRENCY.');
  process.exit(2);
}

async function once() {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serializedBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return {
      status: response.status,
      ms: Math.round((performance.now() - started) * 10) / 10,
      hasToken: Boolean(body?.data?.token ?? body?.token),
      errorCode: body?.error?.code ?? body?.error ?? null,
    };
  } catch (error) {
    return {
      status: 0,
      ms: Math.round((performance.now() - started) * 10) / 10,
      hasToken: false,
      errorCode: error?.cause?.code ?? error?.name ?? 'FETCH_ERROR',
    };
  }
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function parseStatusCounts(spec) {
  if (!spec) return null;
  const counts = {};
  for (const entry of spec.split(',')) {
    const [status, count] = entry.split(':').map(Number);
    if (!Number.isInteger(status) || status < 100 || status > 599
      || !Number.isInteger(count) || count < 1) return null;
    counts[status] = (counts[status] ?? 0) + count;
  }
  return counts;
}

async function main() {
  const warmupResults = [];
  for (let i = 0; i < warmup; i += 1) warmupResults.push(await once());
  const warmupStatuses = warmupResults.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  const warmupOk = warmupResults.every(result =>
    Object.prototype.hasOwnProperty.call(wanted, result.status)
    && (!requireToken || result.hasToken));

  const started = performance.now();
  const results = await Promise.all(Array.from({ length: concurrency }, () => once()));
  const wallMs = Math.round((performance.now() - started) * 10) / 10;
  const times = results.map((result) => result.ms).sort((a, b) => a - b);
  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  const statuses = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  const metrics = {
    endpoint,
    concurrency,
    warmup: { count: warmup, statuses: warmupStatuses, ok: warmupOk },
    wallMs,
    statuses,
    latencyMs: {
      min: times[0],
      p50: percentile(times, 50),
      p90: percentile(times, 90),
      p95: percentile(times, 95),
      max: times.at(-1),
      mean: Math.round(mean * 10) / 10,
    },
  };

  console.log(JSON.stringify(metrics, null, 2));

  const statusesOk = Object.keys(wanted).every(status => statuses[status] === wanted[status])
    && Object.keys(statuses).every(status => statuses[status] === wanted[status]);
  const tokensOk = !requireToken || results.every(result => result.hasToken);
  const fastEnough = metrics.latencyMs.p95 <= maxP95Ms;
  if (!warmupOk || !statusesOk || !tokensOk || !fastEnough) {
    const reasons = [
      warmupOk ? null : 'warmup request failed',
      statusesOk ? null : 'unexpected status counts',
      tokensOk ? null : 'missing token',
      fastEnough ? null : `p95 ${metrics.latencyMs.p95}ms exceeds ${maxP95Ms}ms`,
    ].filter(Boolean);
    console.error(`FAIL: ${reasons.join('; ')}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
