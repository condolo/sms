/* ============================================================
   Platform telemetry — request counters, presence, health samples.

   Design rules (see the performance budget in the platform console):
     • nothing on the request path touches the database
     • one fixed-size histogram per route family, never per request
     • one bulkWrite per minute, one health sample per 30 s
     • every collection has a TTL; rollups are idempotent upserts
     • PLATFORM_TELEMETRY=off disables collection entirely
     • any telemetry failure is swallowed: the product keeps serving
   ============================================================ */
'use strict';

const mongoose = require('mongoose');
const { monitorEventLoopDelay } = require('perf_hooks');

const { _model } = require('./model');
const {
  LATENCY_FIELDS,
  moduleForPath,
  normalizeRoute,
  bucketFor,
  percentileFromBucketCounts,
  latencyArray,
  latencySumGroup,
  emptyLatencyFields,
  shouldSkipPath,
} = require('./telemetry-core');

const ENABLED = !['0', 'off', 'false', 'no'].includes(String(process.env.PLATFORM_TELEMETRY || 'on').toLowerCase());
const FLUSH_MS = 60_000;
const HEALTH_MS = 30_000;
const ROLLUP_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MIN_TTL_DAYS = 3;
const HOUR_TTL_DAYS = 35;
const DAY_TTL_DAYS = 400;
const HEALTH_TTL_DAYS = 7;

const T = {
  min:    () => _model('platform_traffic_min'),
  hour:   () => _model('platform_traffic_hour'),
  day:    () => _model('platform_traffic_day'),
  schoolHour: () => _model('platform_school_hour'),
  schoolDay:  () => _model('platform_school_day'),
  users:  () => _model('platform_user_days'),
  errors: () => _model('platform_error_samples'),
  health: () => _model('platform_health_samples'),
};

/* ── Buckets ─────────────────────────────────────────────────── */
function minuteOf(d) { const x = new Date(d); x.setSeconds(0, 0); return x; }
function hourOf(d) { const x = new Date(d); x.setMinutes(0, 0, 0); return x; }
function dayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }
function nairobiDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

/* ── State ───────────────────────────────────────────────────── */
let _routeBuckets = new Map();   // route|method -> bucket
let _schoolBuckets = new Map();  // schoolId|module|hourISO -> bucket
let _presence = new Map();       // userId -> { lastSeen, role, schoolId, name? }
let _dailyUsers = new Map();     // date|schoolId|role -> Set<userId>
let _dailyDirty = new Set();      // keys changed since the last flush
let _errorSamples = new Map();    // fingerprint -> exact 4xx/5xx sample
let _errorRouteCounts = new Map(); // route -> new fingerprints this flush
let _flushing = false;
let _rolling = false;
let _timers = [];
let _loopHistogram = null;

const _stats = {
  enabled: ENABLED,
  startedAt: new Date().toISOString(),
  lastFlushAt: null,
  lastFlushMs: null,
  lastHealthAt: null,
  lastRollupAt: null,
  flushFailures: 0,
  rollupFailures: 0,
  droppedBuckets: 0,
  droppedUsers: 0,
  lastError: null,
};

const MAX_ROUTE_BUCKETS = 2_000;
const MAX_SCHOOL_BUCKETS = 5_000;
const MAX_PRESENCE = 50_000;
const MAX_DAILY_SETS = 2_000;
const MAX_DAILY_SET_SIZE = 50_000;

function _newBucket(now) {
  return {
    bucket: minuteOf(now),
    count: 0, err5: 0, err4: 0, sum: 0, max: 0,
    lat: new Array(LATENCY_FIELDS.length).fill(0),
  };
}

function _addToBucket(b, ms, status) {
  b.count += 1;
  if (status >= 500) b.err5 += 1;
  else if (status >= 400) b.err4 += 1;
  b.sum += ms;
  if (ms > b.max) b.max = ms;
  b.lat[bucketFor(ms)] += 1;
}

function _incLatency(b) {
  const out = {};
  for (let i = 0; i < LATENCY_FIELDS.length; i++) {
    if (b.lat[i]) out[LATENCY_FIELDS[i]] = b.lat[i];
  }
  return out;
}

/* ── Presence / daily users ──────────────────────────────────── */
function _noteUser(userId, role, schoolId) {
  if (!userId) return;
  const now = Date.now();
  const existing = _presence.get(userId);
  if (existing) {
    existing.lastSeen = now;
  } else {
    if (_presence.size >= MAX_PRESENCE) { _stats.droppedUsers++; return; }
    _presence.set(userId, { lastSeen: now, role: role || 'user', schoolId: schoolId || null });
  }

  const date = nairobiDate();
  const key = `${date}|${schoolId || 'platform'}|${role || 'user'}`;
  let set = _dailyUsers.get(key);
  if (!set) {
    if (_dailyUsers.size >= MAX_DAILY_SETS) { _stats.droppedUsers++; return; }
    set = new Set();
    _dailyUsers.set(key, set);
  }
  if (set.size < MAX_DAILY_SET_SIZE) {
    if (!set.has(userId)) {
      set.add(userId);
      _dailyDirty.add(key);
    }
  }
}

function _prunePresence() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, p] of _presence) {
    if (p.lastSeen < cutoff) _presence.delete(id);
  }
  if (_dailyUsers.size <= MAX_DAILY_SETS) return;
  const sorted = [..._dailyUsers.keys()].sort();
  while (_dailyUsers.size > MAX_DAILY_SETS) _dailyUsers.delete(sorted.shift());
}

/* ── Exact error samples ────────────────────────────────────── */
function _redactMessage(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bBearer\s+[\w.-]+/gi, 'Bearer <token>')
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{24}\b/gi, '<id>')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, '<number>')
    .slice(0, 500);
}

/** Read the error envelope an API route just sent. This runs inside the
 *  response's own `json` call, so it adds no I/O and no second serialisation. */
function _captureError(req, res, body) {
  const status = res.statusCode || 0;
  if (status < 400) return;
  const error = body && typeof body === 'object' && body.error && typeof body.error === 'object'
    ? body.error : null;
  const exception = req._telemetryException || null;
  let code = error?.code || body?.code || exception?.code || '';
  let message = error?.message
    || (typeof body?.error === 'string' ? body.error : '')
    || body?.message
    || '';
  const issueText = Array.isArray(error?.issues)
    ? error.issues.slice(0, 3).map((i) => i?.message).filter(Boolean).join('; ')
    : '';
  if (!message && issueText) message = issueText;
  if (!code && issueText) code = 'VALIDATION_ERROR';
  if (!message && !code && !exception) return;
  if (!message) message = exception?.message || '';

  const route = normalizeRoute({
    baseUrl: req.baseUrl || '',
    routePath: req.route?.path || '',
    originalUrl: req.originalUrl || req.url || '',
  });
  const cleanMessage = _redactMessage(message);
  const detail = _redactMessage(exception?.message || issueText || '').slice(0, 300);
  const key = `${route}|${req.method}|${status}|${code}|${cleanMessage}|${detail}`;
  const now = new Date();

  const existing = _errorSamples.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastAt = now;
    if (req.correlationId) existing.requestId = req.correlationId;
    return;
  }
  if (_errorSamples.size >= 200) return;
  const routeCount = _errorRouteCounts.get(route) || 0;
  if (routeCount >= 25) return;
  _errorRouteCounts.set(route, routeCount + 1);
  _errorSamples.set(key, {
    route,
    method: req.method,
    status,
    code: String(code || '').slice(0, 80),
    message: cleanMessage,
    detail,
    exception: String(exception?.name || '').slice(0, 60),
    count: 1,
    firstAt: now,
    lastAt: now,
    requestId: req.correlationId || '',
    schoolId: req.jwtUser?.schoolId || null,
  });
}

/** Attach the server-side exception to the response sample. The global
 *  error handler calls this before sending its generic 500 envelope, so the
 *  log keeps the root message without ever leaking a stack to the client. */
function recordException(err, req) {
  if (!err || !req) return;
  try {
    req._telemetryException = {
      name: err.name || 'Error',
      code: String(err.code || '').slice(0, 80),
      message: _redactMessage(err.message || String(err)),
    };
  } catch { /* telemetry never breaks error handling */ }
}

/* ── Middleware ──────────────────────────────────────────────── */
function middleware() {
  if (!ENABLED) return (_req, _res, next) => next();
  return (req, res, next) => {
    if (shouldSkipPath(req.originalUrl || req.url || '')) return next();
    const started = process.hrtime.bigint();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try { _captureError(req, res, body); } catch { /* telemetry never breaks a response */ }
      return originalJson(body);
    };
    res.once('finish', () => {
      try {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const status = res.statusCode || 0;
        const route = normalizeRoute({
          baseUrl: req.baseUrl || '',
          routePath: req.route?.path || '',
          originalUrl: req.originalUrl || req.url || '',
        });
        const module = moduleForPath(req.baseUrl || req.originalUrl || '');

        const key = `${route}|${req.method}`;
        let bucket = _routeBuckets.get(key);
        if (!bucket) {
          if (_routeBuckets.size >= MAX_ROUTE_BUCKETS) { _stats.droppedBuckets++; return; }
          bucket = _newBucket(new Date());
          _routeBuckets.set(key, bucket);
        }
        _addToBucket(bucket, ms, status);

        const schoolId = req.jwtUser?.schoolId || null;
        const userId = req.jwtUser?.userId || req.platformOperator?.id || null;
        const role = req.jwtUser?.role || (req.platformOperator ? 'platform' : 'user');

        if (schoolId) {
          const hour = hourOf(new Date());
          const skey = `${schoolId}|${module}|${hour.toISOString()}`;
          let sb = _schoolBuckets.get(skey);
          if (!sb) {
            if (_schoolBuckets.size >= MAX_SCHOOL_BUCKETS) { _stats.droppedBuckets++; }
            else {
              sb = { ..._newBucket(new Date()), bucket: hour, schoolId, module };
              _schoolBuckets.set(skey, sb);
            }
          }
          if (sb) _addToBucket(sb, ms, status);
        }

        if (userId) _noteUser(userId, role, schoolId);
      } catch (err) {
        _stats.lastError = err.message;
      }
    });
    next();
  };
}

/* ── Flush ───────────────────────────────────────────────────── */
function _routeOps(routes) {
  const ops = [];
  for (const [key, b] of routes) {
    const [route, method] = key.split('|');
    const module = moduleForPath(route);
    ops.push({
      updateOne: {
        filter: { bucket: b.bucket, route, method },
        update: {
          $inc: { count: b.count, err5: b.err5, err4: b.err4, sum: b.sum, ..._incLatency(b) },
          $max: { max: b.max },
          $setOnInsert: {
            module,
            expiresAt: new Date(b.bucket.getTime() + MIN_TTL_DAYS * DAY_MS),
          },
        },
        upsert: true,
      },
    });
  }
  return ops;
}

function _schoolOps(schools) {
  const ops = [];
  for (const b of schools.values()) {
    ops.push({
      updateOne: {
        filter: { bucket: b.bucket, schoolId: b.schoolId, module: b.module },
        update: {
          $inc: { count: b.count, err5: b.err5, err4: b.err4, sum: b.sum, ..._incLatency(b) },
          $max: { max: b.max },
          $setOnInsert: {
            expiresAt: new Date(b.bucket.getTime() + HOUR_TTL_DAYS * DAY_MS),
          },
        },
        upsert: true,
      },
    });
  }
  return ops;
}

function _userOps(daily, dirty) {
  const ops = [];
  for (const key of dirty) {
    const set = daily.get(key);
    if (!set) continue;
    const [date, schoolId, role] = key.split('|');
    ops.push({
      updateOne: {
        filter: { date, schoolId: schoolId === 'platform' ? null : schoolId, role },
        update: {
          $max: { count: set.size },
          $setOnInsert: {
            expiresAt: new Date(Date.now() + DAY_TTL_DAYS * DAY_MS),
          },
        },
        upsert: true,
      },
    });
  }
  return ops;
}

function _errorOps(errors) {
  const ops = [];
  for (const [fingerprint, e] of errors) {
    ops.push({
      updateOne: {
        filter: { fingerprint },
        update: {
          $inc: { count: e.count },
          $set: { lastAt: e.lastAt, requestId: e.requestId },
          $setOnInsert: {
            route: e.route,
            method: e.method,
            status: e.status,
            code: e.code,
            message: e.message,
            detail: e.detail || '',
            exception: e.exception || '',
            firstAt: e.firstAt,
            schoolId: e.schoolId,
            expiresAt: new Date(Date.now() + HEALTH_TTL_DAYS * DAY_MS),
          },
        },
        upsert: true,
      },
    });
  }
  return ops;
}

async function flush() {
  if (!ENABLED || _flushing) return;
  if (mongoose.connection.readyState !== 1) { _stats.lastError = 'db-not-connected'; return; }
  if (_routeBuckets.size === 0 && _schoolBuckets.size === 0 && _dailyDirty.size === 0 && _errorSamples.size === 0) return;

  _flushing = true;
  const started = Date.now();
  const routes = _routeBuckets;
  const schools = _schoolBuckets;
  const errors = _errorSamples;
  const dailyDirty = new Set(_dailyDirty);
  _routeBuckets = new Map();
  _schoolBuckets = new Map();
  _errorSamples = new Map();
  _errorRouteCounts = new Map();
  _dailyDirty.clear();

  try {
    const routeOps = _routeOps(routes);
    const schoolOps = _schoolOps(schools);
    const userOps = _userOps(_dailyUsers, dailyDirty);
    const errorOps = _errorOps(errors);
    if (routeOps.length) await T.min().bulkWrite(routeOps, { ordered: false });
    if (schoolOps.length) await T.schoolHour().bulkWrite(schoolOps, { ordered: false });
    if (userOps.length) await T.users().bulkWrite(userOps, { ordered: false });
    if (errorOps.length) await T.errors().bulkWrite(errorOps, { ordered: false });

    _prunePresence();
    // Drop previous days; today's sets stay for the rest of the day.
    const today = nairobiDate();
    for (const key of _dailyUsers.keys()) {
      if (!key.startsWith(`${today}|`)) _dailyUsers.delete(key);
    }

    _stats.lastFlushAt = new Date().toISOString();
    _stats.lastFlushMs = Date.now() - started;
    _stats.lastError = null;
  } catch (err) {
    _stats.flushFailures += 1;
    _stats.lastError = err.message;
    for (const key of dailyDirty) _dailyDirty.add(key);
    console.error('[telemetry] flush failed:', err.message);
    // A failed batch is dropped, never retried synchronously: analytics must
    // not become a write amplifier when the database is already struggling.
  } finally {
    _flushing = false;
  }
}

/* ── Health sample ───────────────────────────────────────────── */
async function _dbPing() {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const t0 = Date.now();
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    return Date.now() - t0;
  } catch {
    return null;
  }
}

async function healthSample() {
  if (!ENABLED) return;
  try {
    const mem = process.memoryUsage();
    const eventLoopMs = _loopHistogram
      ? Math.round((_loopHistogram.percentile(95) / 1e6) * 10) / 10
      : null;
    if (_loopHistogram) _loopHistogram.reset();
    const dbPingMs = await _dbPing();

    await T.health().create({
      at: new Date(),
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
      eventLoopMs,
      handles: process.getActiveResourcesInfo?.().length ?? null,
      dbState: mongoose.connection.readyState,
      dbPingMs,
      expiresAt: new Date(Date.now() + HEALTH_TTL_DAYS * DAY_MS),
    });
    _stats.lastHealthAt = new Date().toISOString();
  } catch (err) {
    _stats.lastError = err.message;
  }
}

/* ── Rollups ─────────────────────────────────────────────────── */
async function _upsertAggregates(Model, rows, keyOf, ttlDays, withModule = false) {
  if (!rows.length) return 0;
  const ops = rows.map((r) => {
    const key = keyOf(r);
    return {
      updateOne: {
        filter: key,
        update: {
          $set: {
            ...key,
            count: r.count || 0,
            err5: r.err5 || 0,
            err4: r.err4 || 0,
            sum: r.sum || 0,
            max: r.max || 0,
            ...(withModule ? { module: r._id.module } : {}),
            ...Object.fromEntries(LATENCY_FIELDS.map((f) => [f, r[f] || 0])),
            expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
          },
        },
        upsert: true,
      },
    };
  });
  await Model.bulkWrite(ops, { ordered: false });
  return ops.length;
}

async function rollups() {
  if (!ENABLED || _rolling) return;
  if (mongoose.connection.readyState !== 1) return;
  _rolling = true;
  try {
    const now = new Date();
    const from = hourOf(new Date(now.getTime() - 3 * 3600_000));
    const to = hourOf(now);

    const hourly = await T.min().aggregate([
      { $match: { bucket: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { unit: 'hour', date: '$bucket' } },
            route: '$route', method: '$method', module: '$module',
          },
          count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
          sum: { $sum: '$sum' }, max: { $max: '$max' }, ...latencySumGroup(),
        },
      },
    ]).allowDiskUse(true);

    await _upsertAggregates(
      T.hour(),
      hourly,
      (r) => ({ bucket: r._id.bucket, route: r._id.route, method: r._id.method }),
      HOUR_TTL_DAYS,
      true,
    );

    const dayFrom = dayOf(new Date(now.getTime() - 2 * DAY_MS));
    const daily = await T.hour().aggregate([
      { $match: { bucket: { $gte: dayFrom } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { unit: 'day', date: '$bucket' } },
            route: '$route', method: '$method', module: '$module',
          },
          count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
          sum: { $sum: '$sum' }, max: { $max: '$max' }, ...latencySumGroup(),
        },
      },
    ]).allowDiskUse(true);

    await _upsertAggregates(
      T.day(),
      daily,
      (r) => ({ bucket: r._id.bucket, route: r._id.route, method: r._id.method }),
      DAY_TTL_DAYS,
      true,
    );

    const schoolDaily = await T.schoolHour().aggregate([
      { $match: { bucket: { $gte: dayFrom } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { unit: 'day', date: '$bucket' } },
            schoolId: '$schoolId', module: '$module',
          },
          count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
          sum: { $sum: '$sum' }, max: { $max: '$max' }, ...latencySumGroup(),
        },
      },
    ]).allowDiskUse(true);

    await _upsertAggregates(
      T.schoolDay(),
      schoolDaily,
      (r) => ({ bucket: r._id.bucket, schoolId: r._id.schoolId, module: r._id.module }),
      DAY_TTL_DAYS,
      true,
    );

    _stats.lastRollupAt = new Date().toISOString();
  } catch (err) {
    _stats.rollupFailures += 1;
    _stats.lastError = err.message;
    console.error('[telemetry] rollup failed:', err.message);
  } finally {
    _rolling = false;
  }
}

/* ── Read helpers ────────────────────────────────────────────── */
function _p95(row) { return percentileFromBucketCounts(latencyArray(row), 0.95); }
function _p50(row) { return percentileFromBucketCounts(latencyArray(row), 0.5); }
function _p99(row) { return percentileFromBucketCounts(latencyArray(row), 0.99); }
function _rate(err, count) { return count ? Math.round((err / count) * 1000) / 10 : 0; }

function _presenceCounts(windowMs) {
  const cutoff = Date.now() - windowMs;
  let total = 0;
  const byRole = {};
  const bySchool = new Map();
  for (const p of _presence.values()) {
    if (p.lastSeen < cutoff) continue;
    total += 1;
    byRole[p.role || 'user'] = (byRole[p.role || 'user'] || 0) + 1;
    if (p.schoolId) bySchool.set(p.schoolId, (bySchool.get(p.schoolId) || 0) + 1);
  }
  return { total, byRole, bySchool };
}

async function _schoolNames(ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const rows = await _model('schools')
    .find({ id: { $in: clean } })
    .select('id name shortName')
    .lean()
    .catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.id, r.shortName || r.name || r.id]));
}

function _rangeSpec(range) {
  const r = ['24h', '7d', '30d'].includes(range) ? range : '24h';
  const now = new Date();
  if (r === '7d') return { r, from: addDays(dayOf(now), -6), collection: 'hour' };
  if (r === '30d') return { r, from: addDays(dayOf(now), -29), collection: 'day' };
  return { r, from: new Date(now.getTime() - DAY_MS), collection: 'minute' };
}

async function _series(range) {
  const spec = _rangeSpec(range);

  if (spec.collection === 'minute') {
    return T.min().aggregate([
      { $match: { bucket: { $gte: spec.from } } },
      {
        $group: {
          _id: { $dateTrunc: { unit: 'minute', date: '$bucket', binSize: 15 } },
          count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
          ...latencySumGroup(),
        },
      },
      { $sort: { _id: 1 } },
    ]).allowDiskUse(true);
  }

  const source = spec.collection === 'hour' ? T.hour() : T.day();
  const unit = spec.collection === 'hour' ? 'hour' : 'day';
  return source.aggregate([
    { $match: { bucket: { $gte: spec.from } } },
    {
      $group: {
        _id: { $dateTrunc: { unit, date: '$bucket' } },
        count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
        ...latencySumGroup(),
      },
    },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);
}

async function _userSeries(range) {
  const spec = _rangeSpec(range);
  const from = spec.from.toISOString().slice(0, 10);
  return T.users().aggregate([
    { $match: { date: { $gte: from } } },
    { $group: { _id: '$date', count: { $sum: '$count' } } },
    { $sort: { _id: 1 } },
  ]);
}

/* ── Public read API ─────────────────────────────────────────── */
let _overviewCache = { at: 0, data: null };

async function overview() {
  if (_overviewCache.data && Date.now() - _overviewCache.at < 10_000) return _overviewCache.data;

  const now = new Date();
  const since60 = new Date(now.getTime() - 60 * 60_000);
  const since24 = new Date(now.getTime() - DAY_MS);
  const today = nairobiDate();
  const yesterday = nairobiDate(new Date(Date.now() - DAY_MS));

  const [
    totals60,
    slowRows,
    moduleRows,
    schoolRows,
    dauRows,
    latestHealth,
  ] = await Promise.all([
    T.min().aggregate([
      { $match: { bucket: { $gte: since60 } } },
      { $group: {
        _id: null, count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
        ...latencySumGroup(),
      } },
    ]),
    T.min().aggregate([
      { $match: { bucket: { $gte: since60 } } },
      { $group: {
        _id: '$route', count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
        max: { $max: '$max' }, ...latencySumGroup(),
      } },
      { $sort: { count: -1 } },
      { $limit: 40 },
    ]),
    T.schoolHour().aggregate([
      { $match: { bucket: { $gte: since24 } } },
      { $group: {
        _id: '$module', count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
        schools: { $addToSet: '$schoolId' }, ...latencySumGroup(),
      } },
      { $sort: { count: -1 } },
    ]),
    T.schoolHour().aggregate([
      { $match: { bucket: { $gte: since60 } } },
      { $group: {
        _id: '$schoolId', count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
        ...latencySumGroup(),
      } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]),
    T.users().aggregate([
      { $match: { date: { $in: [today, yesterday] } } },
      { $group: { _id: '$date', count: { $sum: '$count' } } },
    ]),
    T.health().findOne({}).sort({ at: -1 }).lean().catch(() => null),
  ]);

  const total = totals60[0] || {};
  const series = await _series('24h');
  const names = await _schoolNames(schoolRows.map((r) => r._id));
  const presenceNow = _presenceCounts(60_000);
  const presence15 = _presenceCounts(15 * 60_000);
  const presence60 = _presenceCounts(60 * 60_000);

  const activeSchoolRows = [...presenceNow.bySchool.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const activeSchoolNames = await _schoolNames(activeSchoolRows.map(([id]) => id));

  const slowRoutes = slowRows
    .map((r) => ({
      route: r._id,
      requests: r.count || 0,
      errors5: r.err5 || 0,
      errorRate: _rate(r.err5 || 0, r.count || 0),
      p95: _p95(r),
      max: r.max || 0,
    }))
    .filter((r) => r.requests >= 3)
    .sort((a, b) => b.p95 - a.p95 || b.requests - a.requests)
    .slice(0, 8);

  const modules = moduleRows.map((r) => ({
    module: r._id,
    requests: r.count || 0,
    schools: (r.schools || []).filter(Boolean).length,
    errors5: r.err5 || 0,
    errorRate: _rate(r.err5 || 0, r.count || 0),
    p95: _p95(r),
  }));

  const schools = schoolRows.map((r) => ({
    schoolId: r._id,
    name: names[r._id] || r._id,
    requests: r.count || 0,
    errors5: r.err5 || 0,
    errorRate: _rate(r.err5 || 0, r.count || 0),
    p95: _p95(r),
  }));

  const dauMap = Object.fromEntries(dauRows.map((r) => [r._id, r.count]));
  const avgRows = await T.users().aggregate([
    { $match: { date: { $gte: nairobiDate(new Date(Date.now() - 6 * DAY_MS)) } } },
    { $group: { _id: '$date', count: { $sum: '$count' } } },
  ]);
  const avg7 = avgRows.length
    ? Math.round(avgRows.reduce((s, r) => s + (r.count || 0), 0) / avgRows.length)
    : 0;

  const data = {
    generatedAt: now.toISOString(),
    users: {
      now: presenceNow.total,
      m15: presence15.total,
      h1: presence60.total,
      byRole: presence60.byRole,
      bySchool: activeSchoolRows.map(([id, count]) => ({
        schoolId: id,
        name: activeSchoolNames[id] || id,
        count,
      })),
      dauToday: dauMap[today] || 0,
      dauYesterday: dauMap[yesterday] || 0,
      dauAvg7: avg7,
    },
    traffic: {
      windowMinutes: 60,
      requests: total.count || 0,
      perMinute: Math.round(((total.count || 0) / 60) * 10) / 10,
      errors5: total.err5 || 0,
      errors4: total.err4 || 0,
      errorRate: _rate(total.err5 || 0, total.count || 0),
      p50: _p50(total),
      p95: _p95(total),
      p99: _p99(total),
      series: series.map((r) => ({
        t: r._id,
        requests: r.count || 0,
        errors5: r.err5 || 0,
        p95: _p95(r),
      })),
    },
    modules,
    slowRoutes,
    schools,
    system: {
      ...(latestHealth || {}),
      _id: undefined,
      expiresAt: undefined,
    },
    telemetry: {
      enabled: ENABLED,
      bufferedRoutes: _routeBuckets.size,
      bufferedErrors: _errorSamples.size,
      bufferedSchools: _schoolBuckets.size,
      presenceTracked: _presence.size,
      ..._stats,
    },
  };

  _overviewCache = { at: Date.now(), data };
  return data;
}

async function history(range) {
  const spec = _rangeSpec(range);
  const [points, users] = await Promise.all([_series(spec.r), _userSeries(spec.r)]);
  return {
    range: spec.r,
    from: spec.from.toISOString(),
    to: new Date().toISOString(),
    points: points.map((r) => ({
      t: r._id,
      requests: r.count || 0,
      errors5: r.err5 || 0,
      errors4: r.err4 || 0,
      errorRate: _rate(r.err5 || 0, r.count || 0),
      p95: _p95(r),
    })),
    users: users.map((r) => ({ date: r._id, count: r.count || 0 })),
  };
}

async function schools(range) {
  const spec = _rangeSpec(range);
  const source = spec.collection === 'minute' || spec.collection === 'hour' ? T.schoolHour() : T.schoolDay();
  const since = spec.collection === 'minute' ? new Date(Date.now() - DAY_MS) : spec.from;
  const rows = await source.aggregate([
    { $match: { bucket: { $gte: since } } },
    { $group: {
      _id: '$schoolId', count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
      modules: { $addToSet: '$module' }, ...latencySumGroup(),
    } },
    { $sort: { count: -1 } },
    { $limit: 100 },
  ]).allowDiskUse(true);
  const names = await _schoolNames(rows.map((r) => r._id));
  const today = nairobiDate();
  const userRows = await T.users().aggregate([
    { $match: { date: today, schoolId: { $in: rows.map((r) => r._id) } } },
    { $group: { _id: { schoolId: '$schoolId', role: '$role' }, count: { $sum: '$count' } } },
  ]);
  const usersBySchool = {};
  for (const r of userRows) {
    if (!r._id.schoolId) continue;
    usersBySchool[r._id.schoolId] = (usersBySchool[r._id.schoolId] || 0) + (r.count || 0);
  }
  return rows.map((r) => ({
    schoolId: r._id,
    name: names[r._id] || r._id,
    requests: r.count || 0,
    errors5: r.err5 || 0,
    errorRate: _rate(r.err5 || 0, r.count || 0),
    p95: _p95(r),
    modules: (r.modules || []).filter(Boolean).length,
    activeUsersToday: usersBySchool[r._id] || 0,
  }));
}

async function modules(range) {
  const spec = _rangeSpec(range);
  const source = spec.collection === 'minute' || spec.collection === 'hour' ? T.schoolHour() : T.schoolDay();
  const since = spec.collection === 'minute' ? new Date(Date.now() - DAY_MS) : spec.from;
  const rows = await source.aggregate([
    { $match: { bucket: { $gte: since } } },
    { $group: {
      _id: '$module', count: { $sum: '$count' }, err5: { $sum: '$err5' }, err4: { $sum: '$err4' },
      schools: { $addToSet: '$schoolId' }, ...latencySumGroup(),
    } },
    { $sort: { count: -1 } },
  ]).allowDiskUse(true);
  return rows.map((r) => ({
    module: r._id,
    requests: r.count || 0,
    schools: (r.schools || []).filter(Boolean).length,
    errors5: r.err5 || 0,
    errorRate: _rate(r.err5 || 0, r.count || 0),
    p95: _p95(r),
  }));
}

async function errors(range) {
  const spec = _rangeSpec(range);
  const source = spec.collection === 'minute' ? T.min()
    : spec.collection === 'hour' ? T.hour() : T.day();
  const rows = await source.aggregate([
    { $match: { bucket: { $gte: spec.from }, $or: [{ err5: { $gt: 0 } }, { err4: { $gt: 0 } }] } },
    { $group: {
      _id: '$route', err5: { $sum: '$err5' }, err4: { $sum: '$err4' }, count: { $sum: '$count' },
    } },
    { $sort: { err5: -1, err4: -1 } },
    { $limit: 50 },
  ]).allowDiskUse(true);
  return rows.map((r) => ({
    route: r._id,
    errors5: r.err5 || 0,
    errors4: r.err4 || 0,
    requests: r.count || 0,
    errorRate: _rate(r.err5 || 0, r.count || 0),
  }));
}

/**
 * Exact error samples — the message the API actually sent, deduped by
 * (route, status, code, message). Retained 7 days; platform-only.
 */
async function errorLog(range, { status = 'all', q = '', limit = 100 } = {}) {
  const spec = _rangeSpec(range);
  const filter = { lastAt: { $gte: spec.from } };
  if (status === '4xx') filter.status = { $gte: 400, $lt: 500 };
  if (status === '5xx') filter.status = { $gte: 500, $lt: 600 };

  const term = String(q || '').trim();
  if (term) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ route: rx }, { code: rx }, { message: rx }];
  }

  const cap = Math.min(200, Math.max(1, Number(limit) || 100));
  const rows = await T.errors()
    .find(filter)
    .sort({ count: -1, lastAt: -1 })
    .limit(cap)
    .lean();

  return rows.map((r) => ({
    route: r.route,
    method: r.method,
    status: r.status,
    code: r.code,
    message: r.message,
    detail: r.detail || '',
    exception: r.exception || '',
    count: r.count,
    firstAt: r.firstAt,
    lastAt: r.lastAt,
    requestId: r.requestId || null,
  }));
}

let _systemCache = { at: 0, data: null };
async function system() {
  if (_systemCache.data && Date.now() - _systemCache.at < 15_000) return _systemCache.data;
  const [latest, dbStats] = await Promise.all([
    T.health().findOne({}).sort({ at: -1 }).lean().catch(() => null),
    mongoose.connection.readyState === 1
      ? mongoose.connection.db.stats().catch(() => null)
      : null,
  ]);
  const data = {
    health: latest ? { ...latest, _id: undefined, expiresAt: undefined } : null,
    db: dbStats ? {
      collections: dbStats.collections,
      objects: dbStats.objects,
      dataSizeMb: Math.round((dbStats.dataSize / 1024 / 1024) * 10) / 10,
      storageSizeMb: Math.round((dbStats.storageSize / 1024 / 1024) * 10) / 10,
      indexes: dbStats.indexes,
    } : null,
    telemetry: {
      enabled: ENABLED,
      bufferedRoutes: _routeBuckets.size,
      bufferedErrors: _errorSamples.size,
      bufferedSchools: _schoolBuckets.size,
      presenceTracked: _presence.size,
      ..._stats,
    },
  };
  _systemCache = { at: Date.now(), data };
  return data;
}

/* ── Indexes ─────────────────────────────────────────────────── */
async function ensureIndexes() {
  if (!ENABLED || mongoose.connection.readyState !== 1) return;
  try {
    await Promise.all([
      T.min().collection.createIndex({ bucket: 1, route: 1, method: 1 }, { unique: true }),
      T.min().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.hour().collection.createIndex({ bucket: 1, route: 1, method: 1 }, { unique: true }),
      T.hour().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.day().collection.createIndex({ bucket: 1, route: 1, method: 1 }, { unique: true }),
      T.day().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.schoolHour().collection.createIndex({ bucket: 1, schoolId: 1, module: 1 }, { unique: true }),
      T.schoolHour().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.schoolDay().collection.createIndex({ bucket: 1, schoolId: 1, module: 1 }, { unique: true }),
      T.schoolDay().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.users().collection.createIndex({ date: 1, schoolId: 1, role: 1 }, { unique: true }),
      T.users().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.errors().collection.createIndex({ fingerprint: 1 }, { unique: true }),
      T.errors().collection.createIndex({ lastAt: -1 }),
      T.errors().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      T.health().collection.createIndex({ at: -1 }),
      T.health().collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  } catch (err) {
    console.warn('[telemetry] index creation skipped:', err.message);
  }
}

/* ── Init ────────────────────────────────────────────────────── */
function init(app) {
  if (!ENABLED) {
    console.log('[telemetry] disabled by PLATFORM_TELEMETRY');
    return;
  }

  _loopHistogram = monitorEventLoopDelay({ resolution: 20 });
  _loopHistogram.enable();

  if (app) app.use(middleware());

  _timers.push(setInterval(() => { void flush(); }, FLUSH_MS).unref());
  _timers.push(setInterval(() => { void healthSample(); }, HEALTH_MS).unref());
  _timers.push(setInterval(() => { void rollups(); }, ROLLUP_MS).unref());

  setTimeout(() => {
    void ensureIndexes();
    void healthSample();
  }, 8_000).unref();

  console.log('[telemetry] platform telemetry on — 60s flush, 30s health, 10m rollups');
}

function stats() {
  return {
    enabled: ENABLED,
    bufferedRoutes: _routeBuckets.size,
    bufferedErrors: _errorSamples.size,
    bufferedSchools: _schoolBuckets.size,
    presenceTracked: _presence.size,
    ..._stats,
  };
}

module.exports = {
  init,
  middleware,
  flush,
  healthSample,
  rollups,
  ensureIndexes,
  overview,
  history,
  schools,
  modules,
  errors,
  errorLog,
  recordException,
  system,
  stats,
  _middlewareForTests: middleware,
};
