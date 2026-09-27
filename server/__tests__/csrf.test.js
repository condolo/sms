/* ============================================================
   utils/csrf.js — double-submit CSRF defense (security review, 2026-09)
   ============================================================ */
'use strict';

const { issueCsrfCookie, clearCsrfCookie, csrfOk, CSRF_COOKIE_NAME, PLATFORM_CSRF_COOKIE_NAME, CSRF_HEADER_NAME } = require('../utils/csrf');

function mockRes() {
  const calls = { cookie: [], clearCookie: [] };
  return {
    cookie: (name, value, opts) => calls.cookie.push({ name, value, opts }),
    clearCookie: (name, opts) => calls.clearCookie.push({ name, opts }),
    _calls: calls,
  };
}

describe('issueCsrfCookie', () => {
  test('sets a cookie under the default name, NOT httpOnly (must be readable by same-origin JS)', () => {
    const res = mockRes();
    issueCsrfCookie(res, 1000);
    expect(res._calls.cookie).toHaveLength(1);
    expect(res._calls.cookie[0].name).toBe(CSRF_COOKIE_NAME);
    expect(res._calls.cookie[0].opts.httpOnly).toBe(false);
    expect(res._calls.cookie[0].opts.sameSite).toBe('strict');
    expect(res._calls.cookie[0].opts.maxAge).toBe(1000);
  });

  test('the token is a real random value, not predictable or reused across calls', () => {
    const res = mockRes();
    const a = issueCsrfCookie(res, 1000);
    const b = issueCsrfCookie(res, 1000);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
  });

  test('accepts a custom cookie name (platform sessions use a distinct one)', () => {
    const res = mockRes();
    issueCsrfCookie(res, 1000, PLATFORM_CSRF_COOKIE_NAME);
    expect(res._calls.cookie[0].name).toBe(PLATFORM_CSRF_COOKIE_NAME);
  });
});

describe('clearCsrfCookie', () => {
  test('clears the default cookie name with matching options', () => {
    const res = mockRes();
    clearCsrfCookie(res);
    expect(res._calls.clearCookie[0].name).toBe(CSRF_COOKIE_NAME);
  });
});

describe('csrfOk — the actual double-submit verification', () => {
  function req(method, cookieToken, headerToken) {
    return {
      method,
      cookies: cookieToken !== undefined ? { [CSRF_COOKIE_NAME]: cookieToken } : {},
      headers: headerToken !== undefined ? { [CSRF_HEADER_NAME]: headerToken } : {},
    };
  }

  test('GET/HEAD/OPTIONS are always exempt, even with no cookie or header at all', () => {
    expect(csrfOk(req('GET'))).toBe(true);
    expect(csrfOk(req('HEAD'))).toBe(true);
    expect(csrfOk(req('OPTIONS'))).toBe(true);
  });

  test('a state-changing request with NO csrf cookie passes through (legacy session / non-browser caller — see rollout note)', () => {
    expect(csrfOk(req('POST'))).toBe(true);
    expect(csrfOk(req('DELETE'))).toBe(true);
  });

  test('a state-changing request WITH the cookie but a matching header succeeds', () => {
    expect(csrfOk(req('POST', 'abc123', 'abc123'))).toBe(true);
  });

  test('a state-changing request WITH the cookie but NO header is rejected', () => {
    expect(csrfOk(req('POST', 'abc123', undefined))).toBe(false);
  });

  test('a state-changing request WITH the cookie but a MISMATCHED header is rejected', () => {
    expect(csrfOk(req('POST', 'abc123', 'xyz999999'))).toBe(false);
  });

  test('a header of a different length than the cookie is rejected without throwing (timingSafeEqual requires equal-length buffers)', () => {
    expect(csrfOk(req('POST', 'abc123', 'ab'))).toBe(false);
    expect(csrfOk(req('POST', 'abc123', 'abc1234567890'))).toBe(false);
  });

  test('a non-string header value (e.g. an array, from a duplicated header) is rejected, not thrown on', () => {
    const r = req('POST', 'abc123');
    r.headers[CSRF_HEADER_NAME] = ['abc123', 'abc123'];
    expect(csrfOk(r)).toBe(false);
  });

  test('respects a custom cookie name for the platform-session variant', () => {
    const r = { method: 'POST', cookies: { [PLATFORM_CSRF_COOKIE_NAME]: 'zzz' }, headers: { [CSRF_HEADER_NAME]: 'zzz' } };
    expect(csrfOk(r, PLATFORM_CSRF_COOKIE_NAME)).toBe(true);
    expect(csrfOk(r)).toBe(true); // no default-name cookie present at all → passes through
  });
});
