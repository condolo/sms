/* ============================================================
   server/middleware/auth.js — impersonation revocation

   PLAT-01 remediation, the exact acceptance test specified:
     "Platform operator starts impersonation → access works →
      impersonation is revoked → the token/session immediately
      stops working."

   Exercises the REAL, unmodified authMiddleware — not a
   reimplementation of its logic — against a mocked SessionService/
   jwt/token-version, proving the per-request session-status check
   added for impersonated tokens specifically.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../utils/jwt', () => ({ verify: jest.fn() }));
jest.mock('../utils/token-version', () => ({
  getTokenVersion:         jest.fn().mockResolvedValue(0),
  getIdentityTokenVersion: jest.fn().mockResolvedValue(0),
}));
jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({ updateOne: jest.fn().mockResolvedValue({}) })),
}));
jest.mock('../services/audit', () => ({ log: jest.fn() }));

let mockSessionStore;
jest.mock('../services/sessionService', () => ({
  getImpersonationSession: jest.fn((sessionId) => Promise.resolve(mockSessionStore[sessionId] ?? null)),
}));

const { authMiddleware } = require('../middleware/auth');
const { verify }         = require('../utils/jwt');
const AuditService       = require('../services/audit');

function mockReq() {
  return { cookies: { token: 'fake-token' }, headers: {} };
}
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

const IMPERSONATED_PAYLOAD = {
  userId: 'usr_admin1', schoolId: 'sch_trinitas', role: 'superadmin', roles: ['superadmin'],
  email: 'admin@trinitas-tis.example',
  impersonated: true, impersonationId: 'sess_abc123', sessionId: 'sess_abc123',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionStore = {};
});

describe('THE acceptance test', () => {
  test('grant → access works → revoke → immediately stops working', async () => {
    verify.mockReturnValue(IMPERSONATED_PAYLOAD);
    mockSessionStore['sess_abc123'] = { id: 'sess_abc123', status: 'active', schoolId: 'sch_trinitas' };

    // Access works.
    const req1 = mockReq(); const res1 = mockRes(); const next1 = jest.fn();
    await authMiddleware(req1, res1, next1);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(req1.jwtUser).toEqual(IMPERSONATED_PAYLOAD);

    // Revoke — this is exactly what SessionService.revokeImpersonationSession
    // does to the stored document; simulated directly here since this file
    // is testing the READ side (authMiddleware), not the write side (already
    // covered in sessionService-impersonation.test.js and the revoke route
    // tests).
    mockSessionStore['sess_abc123'].status = 'revoked';

    // The SAME token — nothing about it changed — immediately stops working
    // on the very next request. Not eventually, not after a /ping poll: the
    // next request, period.
    const req2 = mockReq(); const res2 = mockRes(); const next2 = jest.fn();
    await authMiddleware(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(401);
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'IMPERSONATION_ENDED' }),
    }));
  });

  test('the denial is itself audited — platform.impersonate_denied', async () => {
    verify.mockReturnValue(IMPERSONATED_PAYLOAD);
    mockSessionStore['sess_abc123'] = { id: 'sess_abc123', status: 'revoked', schoolId: 'sch_trinitas' };

    await authMiddleware(mockReq(), mockRes(), jest.fn());

    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.impersonate_denied',
      schoolId: 'sch_trinitas',
      details: expect.objectContaining({ impersonationId: 'sess_abc123' }),
    }));
  });
});

describe('expiry — a session record that no longer exists at all', () => {
  test('a session id with no matching record (TTL-expired and physically gone) is also denied', async () => {
    verify.mockReturnValue(IMPERSONATED_PAYLOAD);
    // mockSessionStore stays empty — nothing found for this sessionId.
    const req = mockReq(); const res = mockRes(); const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('non-impersonated tokens are completely unaffected', () => {
  test('a normal login token never even queries SessionService.getImpersonationSession', async () => {
    const SessionService = require('../services/sessionService');
    const normalPayload = { userId: 'u2', schoolId: 'sch1', role: 'teacher', roles: ['teacher'] }; // no `impersonated`
    verify.mockReturnValue(normalPayload);

    const req = mockReq(); const res = mockRes(); const next = jest.fn();
    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(SessionService.getImpersonationSession).not.toHaveBeenCalled();
  });
});

describe('a real, still-open admin session concurrent with an impersonation of the same identity', () => {
  test('revoking the impersonation session does not touch the real session at all — different mechanisms entirely', async () => {
    // The real admin's own, separate, normal session for the SAME userId —
    // no sessionId collision with the impersonation grant, no `impersonated`
    // flag, so it never even reaches the session-status check.
    const realAdminPayload = { userId: 'usr_admin1', schoolId: 'sch_trinitas', role: 'superadmin', roles: ['superadmin'] };
    verify.mockReturnValue(realAdminPayload);
    mockSessionStore['sess_abc123'] = { id: 'sess_abc123', status: 'revoked', schoolId: 'sch_trinitas' }; // the impersonation, ended

    const req = mockReq(); const res = mockRes(); const next = jest.fn();
    await authMiddleware(req, res, next);

    // The real admin's own session is untouched by the impersonation's
    // revocation — this is the entire reason the check is scoped to
    // `payload.impersonated`, not the shared `tv` (tokenVersion) mechanism.
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.jwtUser).toEqual(realAdminPayload);
  });
});
