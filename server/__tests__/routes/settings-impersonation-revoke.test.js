/* ============================================================
   POST /api/settings/impersonation/:sessionId/revoke
   PLAT-01 remediation — the school-admin-side half of explicit
   impersonation revocation. Must be strictly scoped to the caller's
   own schoolId — the critical property this file exists to prove.
   ============================================================ */
'use strict';

jest.mock('../../middleware/module-gate', () => ({ invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn() }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockSessions;
jest.mock('../../services/sessionService', () => ({
  getImpersonationSession: jest.fn((id) => Promise.resolve(mockSessions.find(s => s.id === id) ?? null)),
  revokeImpersonationSession: jest.fn((id, revokedBy, reason) => {
    const s = mockSessions.find(x => x.id === id && x.status === 'active');
    if (!s) return Promise.resolve(false);
    s.status = 'revoked'; s.revokedBy = revokedBy; s.revokeReason = reason;
    return Promise.resolve(true);
  }),
}));

let mockRolePerms;
function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue((() => { const d = store.find(filter); return d ? { ...d } : null; })()),
    })),
  };
}
function mockMakeStore(initialDocs, matcher) {
  return { docs: [...initialDocs], find(filter) { return this.docs.find(d => matcher(d, filter)); } };
}
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    return mockMakeCollection(mockMakeStore([], () => false));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    return mockMakeCollection(mockMakeStore([], () => false));
  },
}));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}
function authCookie(payload) { return `token=${sign({ role: 'admin', ...payload })}`; }

const SCHOOL_A = 'sch_trinitas';
const SCHOOL_B = 'sch_other';

beforeEach(() => {
  jest.clearAllMocks();
  mockRolePerms = mockMakeStore(
    [{ schoolId: SCHOOL_A, roleKey: 'admin', permissions: { settings: ['read', 'create', 'update', 'delete'] } }],
    (d, f) => d.schoolId === f.schoolId && d.roleKey === f.roleKey,
  );
  mockSessions = [
    { id: 'sess_a_active', status: 'active', schoolId: SCHOOL_A, userId: 'usr_admin1' },
    { id: 'sess_b_active', status: 'active', schoolId: SCHOOL_B, userId: 'usr_admin2' }, // a DIFFERENT school
  ];
});

describe('POST /api/settings/impersonation/:sessionId/revoke', () => {
  test('the school\'s own admin can revoke a session targeting their own school', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/impersonation/sess_a_active/revoke')
      .set('Cookie', authCookie({ userId: 'usr_admin1', schoolId: SCHOOL_A }))
      .send({});
    expect(res.status).toBe(200);
    expect(mockSessions.find(s => s.id === 'sess_a_active').status).toBe('revoked');
  });

  test('THE CRITICAL PROPERTY: cannot revoke a session belonging to a DIFFERENT school — 404, not 403, no confirmation the id exists', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/impersonation/sess_b_active/revoke') // belongs to SCHOOL_B
      .set('Cookie', authCookie({ userId: 'usr_admin1', schoolId: SCHOOL_A })) // caller is from SCHOOL_A
      .send({});
    expect(res.status).toBe(404);
    // Untouched — SCHOOL_A's admin never got anywhere near actually revoking it.
    expect(mockSessions.find(s => s.id === 'sess_b_active').status).toBe('active');
  });

  test('an unknown session id is also 404 — identical response shape to the cross-school case, no existence leak', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/impersonation/sess_does_not_exist/revoke')
      .set('Cookie', authCookie({ userId: 'usr_admin1', schoolId: SCHOOL_A }))
      .send({});
    expect(res.status).toBe(404);
  });

  test('an already-revoked session in the caller\'s own school is a 409', async () => {
    mockSessions.push({ id: 'sess_a_gone', status: 'revoked', schoolId: SCHOOL_A, userId: 'usr_admin1' });
    const res = await supertest(buildApp())
      .post('/api/settings/impersonation/sess_a_gone/revoke')
      .set('Cookie', authCookie({ userId: 'usr_admin1', schoolId: SCHOOL_A }))
      .send({});
    expect(res.status).toBe(409);
  });

  test('logs platform.impersonate_revoked with endedBy: school_admin', async () => {
    await supertest(buildApp())
      .post('/api/settings/impersonation/sess_a_active/revoke')
      .set('Cookie', authCookie({ userId: 'usr_admin1', schoolId: SCHOOL_A }))
      .send({});
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.impersonate_revoked',
      schoolId: SCHOOL_A,
      details: expect.objectContaining({ impersonationId: 'sess_a_active', endedBy: 'school_admin' }),
    }));
  });
});
