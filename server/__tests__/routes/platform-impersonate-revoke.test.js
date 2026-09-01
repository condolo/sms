/* ============================================================
   POST /api/platform/impersonation-sessions/:sessionId/revoke
   PLAT-01 remediation — the platform-operator-side half of
   explicit revocation.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => {
    req.platformOperatorTier = 'owner';
    req.platformOperator = { id: 'op_1', name: 'Jane Ops', email: 'jane@msingi.io', tier: 'owner' };
    next();
  },
  requireOwnerTier: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

let mockSessions;
jest.mock('../../services/sessionService', () => ({
  getImpersonationSession: jest.fn((id) => Promise.resolve(mockSessions.find(s => s.id === id) ?? null)),
  revokeImpersonationSession: jest.fn((id, revokedBy, reason) => {
    const s = mockSessions.find(x => x.id === id && x.status === 'active');
    if (!s) return Promise.resolve(false);
    s.status = 'revoked';
    s.revokedBy = revokedBy;
    s.revokeReason = reason;
    return Promise.resolve(true);
  }),
}));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { ...actual, models: {}, isValidObjectId: () => false, model: jest.fn(() => ({ findOne: () => ({ lean: () => Promise.resolve(null) }) })) };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessions = [
    { id: 'sess_active', status: 'active', schoolId: 'sch_trinitas', userId: 'usr_admin1' },
    { id: 'sess_gone',   status: 'revoked', schoolId: 'sch_trinitas', userId: 'usr_admin1' },
  ];
});

describe('POST /api/platform/impersonation-sessions/:sessionId/revoke', () => {
  test('revokes an active session', async () => {
    const res = await supertest(app()).post('/api/platform/impersonation-sessions/sess_active/revoke').send({ reason: 'Investigation done' });
    expect(res.status).toBe(200);
    expect(mockSessions.find(s => s.id === 'sess_active').status).toBe('revoked');
  });

  test('logs platform.impersonate_revoked with the operator as actor', async () => {
    const AuditService = require('../../services/audit');
    await supertest(app()).post('/api/platform/impersonation-sessions/sess_active/revoke').send({ reason: 'Done' });
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.impersonate_revoked',
      schoolId: 'sch_trinitas',
      details: expect.objectContaining({ impersonationId: 'sess_active' }),
    }));
  });

  test('an unknown session id is a 404', async () => {
    const res = await supertest(app()).post('/api/platform/impersonation-sessions/sess_nope/revoke').send({});
    expect(res.status).toBe(404);
  });

  test('an already-revoked session is a 409, not a silent success', async () => {
    const res = await supertest(app()).post('/api/platform/impersonation-sessions/sess_gone/revoke').send({});
    expect(res.status).toBe(409);
  });
});
