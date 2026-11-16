/* ============================================================
   server/utils/telemetry-core.js — route normalisation, module
   mapping and histogram maths. Pure functions, no DB.
   ============================================================ */
'use strict';

const {
  normalizeRoute,
  moduleForPath,
  bucketFor,
  percentileFromBucketCounts,
  latencyArray,
  shouldSkipPath,
} = require('../utils/telemetry-core');

describe('normalizeRoute', () => {
  test('joins the mounted router and its route template', () => {
    expect(normalizeRoute({ baseUrl: '/api/finance', routePath: '/invoices' }))
      .toBe('/api/finance/invoices');
  });

  test('replaces ObjectIds, UUIDs, numbers and opaque tokens', () => {
    expect(normalizeRoute({ baseUrl: '/api/students', routePath: '/64b7f0c2a1b2c3d4e5f60718' }))
      .toBe('/api/students/:id');
    expect(normalizeRoute({ baseUrl: '/api/students', routePath: '/2f697b71-f36d-4493-9c5c-4fa3ae0a0ff3' }))
      .toBe('/api/students/:id');
    expect(normalizeRoute({ baseUrl: '/api/invoices', routePath: '/25' }))
      .toBe('/api/invoices/:id');
    expect(normalizeRoute({ baseUrl: '/api/join', routePath: '/abcdefghijklmnopqrstuvwx' }))
      .toBe('/api/join/:token');
  });

  test('falls back to the first path segments for an unmatched 404', () => {
    expect(normalizeRoute({ originalUrl: '/api/nope/thing?x=1' })).toBe('/api/nope/thing');
  });

  test('never leaves a trailing slash', () => {
    expect(normalizeRoute({ baseUrl: '/api/health', routePath: '/' })).toBe('/api/health');
  });
});

describe('moduleForPath', () => {
  test('the first segment is the module', () => {
    expect(moduleForPath('/api/finance')).toBe('finance');
    expect(moduleForPath('/api/students/123')).toBe('students');
  });

  test('aliases real route names onto registry keys', () => {
    expect(moduleForPath('/api/report-cards')).toBe('report_cards');
    expect(moduleForPath('/api/teacher-portal')).toBe('teachers');
    expect(moduleForPath('/api/weekly-snapshots')).toBe('weekly_snapshot');
    expect(moduleForPath('/api/lesson-plans')).toBe('lessons');
  });

  test('unknown modules collapse to other — never an unbounded key', () => {
    expect(moduleForPath('/api/not-a-real-module')).toBe('other');
    expect(moduleForPath('')).toBe('other');
  });
});

describe('latency histogram', () => {
  test('bucketFor picks the first upper bound that covers the duration', () => {
    expect(bucketFor(1)).toBe(0);
    expect(bucketFor(5)).toBe(0);
    expect(bucketFor(6)).toBe(1);
    expect(bucketFor(100)).toBe(4);
    expect(bucketFor(99_999)).toBe(10);
  });

  test('p95 returns the upper bound of the bucket where the 95th percentile falls', () => {
    const counts = [50, 45, 5, 0, 0, 0, 0, 0, 0, 0, 0];
    // 95% of 100 lands on the last item of bucket 1 (10 ms).
    expect(percentileFromBucketCounts(counts, 0.95)).toBe(10);
  });

  test('an empty histogram is zero, not a crash', () => {
    expect(percentileFromBucketCounts([], 0.95)).toBe(0);
    expect(percentileFromBucketCounts(new Array(11).fill(0), 0.99)).toBe(0);
  });

  test('latencyArray reads b0..bN from a Mongo doc', () => {
    expect(latencyArray({ b0: 2, b4: 3 })).toEqual([2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0]);
  });
});

describe('shouldSkipPath', () => {
  test('skips static assets, health probes, the console itself and platform stats', () => {
    expect(shouldSkipPath('/assets/app.js')).toBe(true);
    expect(shouldSkipPath('/api/health')).toBe(true);
    expect(shouldSkipPath('/api/platform/analytics/overview')).toBe(true);
    expect(shouldSkipPath('/api/ops/health')).toBe(true);
    expect(shouldSkipPath('/api/platform/stats')).toBe(true);
  });

  test('counts real product traffic', () => {
    expect(shouldSkipPath('/api/students')).toBe(false);
    expect(shouldSkipPath('/api/finance/invoices')).toBe(false);
  });
});
