#!/usr/bin/env node
'use strict';

/**
 * Concurrent credential-login stage profiler.
 *
 * Starts an isolated API (port 3015, database msingi_login_perf), enables
 * AUTH_LOGIN_TIMING, drives concurrent logins, and summarises the server's
 * PII-free stage timings. Use this to prove whether search, bcrypt, session
 * creation, or worker-pool contention dominates login p95.
 */

const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const path = require('path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.LOGIN_PROF_PORT || 3015);
const BASE = `http://127.0.0.1:${PORT}`;
const URI = process.env.LOGIN_PROF_URI || 'mongodb://127.0.0.1:27017';
const DB = process.env.LOGIN_PROF_DB || 'msingi_login_perf';
const IDENTIFIER = process.env.LOGIN_PROF_IDENTIFIER || 'teacher@demo.msingi.io';
const PASSWORD = process.env.LOGIN_PROF_PASSWORD || 'Demo2025!';
const CONCURRENCY = Number(process.env.LOGIN_PROF_CONCURRENCY || 10);
const REQUESTS = Number(process.env.LOGIN_PROF_REQUESTS || 60);

const round = n => Math.round(n * 10) / 10;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p / 100) - 1)];

async function waitForHealth(child) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        await new Promise(resolve => setTimeout(resolve, 8000));
        return;
      }
    } catch { /* not ready */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('server did not become healthy');
}

async function login(index) {
  const ip = `10.1.${(index >> 8) & 255}.${index & 255}`;
  const started = performance.now();
  const res = await fetch(`${BASE}/api/auth/login-credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD, platform: 'mobile' }),
    signal: AbortSignal.timeout(30000),
  });
  await res.json();
  return { status: res.status, ms: round(performance.now() - started) };
}

function stats(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    mean: round(values.reduce((sum, n) => sum + n, 0) / values.length),
  };
}

async function main() {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  const env = {
    ...process.env,
    MONGODB_URI: URI,
    MONGODB_DB_NAME: DB,
    JWT_SECRET: 'login_prof_only_jwt_secret_do_not_use_in_production',
    PLATFORM_JWT_SECRET: 'login_prof_only_platform_secret_do_not_use_in_production',
    PORT: String(PORT),
    NODE_ENV: 'development',
    ALLOW_DEMO_SEED: '1',
    PLATFORM_TELEMETRY: '0',
    AUTH_LOGIN_TIMING: '1',
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timings = [];
  let logTail = '';
  const consume = chunk => {
    const text = String(chunk);
    logTail = (logTail + text).slice(-12000);
    for (const line of text.split(/\r?\n/)) {
      const marker = '[auth/login-credentials:timing] ';
      const at = line.indexOf(marker);
      if (at < 0) continue;
      try { timings.push(JSON.parse(line.slice(at + marker.length))); } catch { /* ignore */ }
    }
  };
  child.stdout.on('data', consume);
  child.stderr.on('data', consume);

  try {
    await waitForHealth(child);
    // Warm the hash worker pool before measuring.
    await login(0);
    const client = [];
    let next = 1;
    while (next <= REQUESTS) {
      const batch = [];
      for (let i = 0; i < CONCURRENCY && next <= REQUESTS; i += 1) batch.push(login(next++));
      client.push(...await Promise.all(batch));
    }
    await new Promise(resolve => setTimeout(resolve, 250));

    const stageNames = ['searchMs', 'passwordMs', 'lockMs', 'schoolMs', 'fullUserMs', 'handleLoginMs', 'totalMs'];
    const stages = {};
    for (const name of stageNames) {
      const values = timings.map(t => t[name]).filter(Number.isFinite);
      stages[name] = stats(values);
    }
    console.log(JSON.stringify({
      client: stats(client.map(r => r.ms)),
      statuses: client.reduce((counts, r) => { counts[r.status] = (counts[r.status] || 0) + 1; return counts; }, {}),
      serverStages: stages,
      capturedTimings: timings.length,
    }, null, 2));
  } catch (error) {
    console.error(error);
    console.error(logTail);
    process.exitCode = 1;
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 8000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
