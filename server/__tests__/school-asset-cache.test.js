/* ============================================================
   Public school asset cache — hit/miss/ETag/invalidation contract.

   The asset route used to read + base64-decode a multi-megabyte school
   document on every cold request. These tests pin the cache behaviour
   that removes that work while keeping uploads immediately visible.
   ============================================================ */
'use strict';

const cache = require('../utils/school-asset-cache');

describe('school asset cache', () => {
  beforeEach(() => {
    cache.invalidate('sch_test');
  });

  test('returns null on a cold key and serves a cached hit with a stable ETag', () => {
    expect(cache.get('sch_test', 'logo')).toBeNull();
    const buffer = Buffer.from('logo-bytes');
    const etag = cache.setHit('sch_test', 'logo', buffer, 'image/png');

    const hit = cache.get('sch_test', 'logo');
    expect(hit.miss).toBe(false);
    expect(hit.buffer).toBe(buffer);
    expect(hit.mime).toBe('image/png');
    expect(hit.etag).toBe(etag);
    expect(cache.get('sch_test', 'logo').etag).toBe(etag);
  });

  test('generates a different ETag for different bytes', () => {
    const first = cache.setHit('sch_test', 'logo', Buffer.from('a'), 'image/png');
    const second = cache.setHit('sch_test', 'logo', Buffer.from('b'), 'image/png');
    expect(second).not.toBe(first);
  });

  test('caches misses so a missing asset does not hit MongoDB every time', () => {
    cache.setMiss('sch_test', 'favicon');
    expect(cache.get('sch_test', 'favicon')).toMatchObject({ miss: true });
  });

  test('invalidate removes one type without touching the other', () => {
    cache.setHit('sch_test', 'logo', Buffer.from('logo'), 'image/png');
    cache.setHit('sch_test', 'favicon', Buffer.from('favicon'), 'image/png');

    cache.invalidate('sch_test', 'logo');

    expect(cache.get('sch_test', 'logo')).toBeNull();
    expect(cache.get('sch_test', 'favicon')).toMatchObject({ miss: false });
  });

  test('invalidate without a type clears every asset for that school only', () => {
    cache.setHit('sch_test', 'logo', Buffer.from('logo'), 'image/png');
    cache.setHit('sch_test', 'login-bg', Buffer.from('bg'), 'image/png');
    cache.setHit('sch_other', 'logo', Buffer.from('other'), 'image/png');

    cache.invalidate('sch_test');

    expect(cache.get('sch_test', 'logo')).toBeNull();
    expect(cache.get('sch_test', 'login-bg')).toBeNull();
    expect(cache.get('sch_other', 'logo')).toMatchObject({ miss: false });
  });
});
