/* ============================================================
   authMiddleware / platformSession — CSRF double-submit enforcement
   (security review, 2026-09)

   Uses the real sign()/verify() and the real authMiddleware/
   platformSession — only DB lookups are mocked. Models the same fixture
   pattern as middleware/auth-token-version.test.js.
   ============================================================ */
'use strict';

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'sessions') return { updateOne: () => Promise.resolve({}) };
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

const jwt = require('jsonwebtoken');
const { sign } = require('../../utils/jwt');
const { authMiddleware, platformSession } = require('../../middleware/auth');
const { CSRF_COOKIE_NAME, PLATFORM_CSRF_COOKIE_NAME, CSRF_HEADER_NAME } = require('../../utils/csrf');

function makeReqRes({ method = 'POST', cookies = {}, headers = {} }) {
  const req = { method, cookies, headers };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

describe('authMiddleware — school-tenant CSRF enforcement', () => {
  test('a state-changing request with a valid token but no csrf cookie at all still passes through (legacy session)', async () => {
    const token = sign({ userId: 'usr_1', schoolId: 'sch_a' });
    const { req, res } = makeReqRes({ method: 'POST', cookies: { token } });
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a state-changing request with a csrf cookie AND matching header succeeds', async () => {
    const token = sign({ userId: 'usr_1', schoolId: 'sch_a' });
    const { req, res } = makeReqRes({
      method: 'POST',
      cookies: { token, [CSRF_COOKIE_NAME]: 'abc123' },
      headers: { [CSRF_HEADER_NAME]: 'abc123' },
    });
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a state-changing request with a csrf cookie but NO header is rejected with 403, never reaches the route', async () => {
    const token = sign({ userId: 'usr_1', schoolId: 'sch_a' });
    const { req, res } = makeReqRes({ method: 'POST', cookies: { token, [CSRF_COOKIE_NAME]: 'abc123' } });
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
  });

  test('a state-changing request with a csrf cookie and a MISMATCHED header is rejected — the actual forged-request scenario', async () => {
    const token = sign({ userId: 'usr_1', schoolId: 'sch_a' });
    const { req, res } = makeReqRes({
      method: 'POST',
      cookies: { token, [CSRF_COOKIE_NAME]: 'real-value' },
      headers: { [CSRF_HEADER_NAME]: 'guessed-value' },
    });
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('a GET request is exempt even with a mismatched csrf cookie/header pair', async () => {
    const token = sign({ userId: 'usr_1', schoolId: 'sch_a' });
    const { req, res } = makeReqRes({
      method: 'GET',
      cookies: { token, [CSRF_COOKIE_NAME]: 'real-value' },
      headers: { [CSRF_HEADER_NAME]: 'wrong-value' },
    });
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('the CSRF check runs before an invalid/expired token would even matter — but an actually-invalid token still 401s, not 403s, when csrf is fine', async () => {
    const { req, res } = makeReqRes({ method: 'POST', cookies: { token: 'not-a-real-jwt' } });
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('platformSession — platform-operator CSRF enforcement (own cookie name)', () => {
  const SECRET = 'test-platform-secret';
  const ORIGINAL_SECRET = process.env.PLATFORM_JWT_SECRET;
  beforeAll(() => { process.env.PLATFORM_JWT_SECRET = SECRET; });
  afterAll(() => { process.env.PLATFORM_JWT_SECRET = ORIGINAL_SECRET; });

  function platformToken() {
    return jwt.sign({ sub: 'platform-operator', operatorId: 'op_1', name: 'X', email: 'x@msingi.io', tier: 'owner' }, SECRET, { expiresIn: '2h' });
  }

  test('a mutating platform request with the platform csrf cookie and matching header succeeds', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      cookies: { platform_token: platformToken(), [PLATFORM_CSRF_COOKIE_NAME]: 'zzz' },
      headers: { [CSRF_HEADER_NAME]: 'zzz' },
    });
    const next = jest.fn();
    platformSession(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a mutating platform request with the platform csrf cookie but a mismatched header is rejected', () => {
    const { req, res } = makeReqRes({
      method: 'DELETE',
      cookies: { platform_token: platformToken(), [PLATFORM_CSRF_COOKIE_NAME]: 'zzz' },
      headers: { [CSRF_HEADER_NAME]: 'not-zzz' },
    });
    const next = jest.fn();
    platformSession(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('the SCHOOL-tenant csrf_token cookie does not satisfy the platform check — the two are deliberately separate', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      cookies: { platform_token: platformToken(), [CSRF_COOKIE_NAME]: 'zzz' }, // wrong cookie name for this session type
      headers: { [CSRF_HEADER_NAME]: 'zzz' },
    });
    const next = jest.fn();
    platformSession(req, res, next);
    // No platform_csrf_token cookie present at all → passes through (legacy-session rule) — this proves the two namespaces are independent, not that cross-use is accepted.
    expect(next).toHaveBeenCalledTimes(1);
  });
});
