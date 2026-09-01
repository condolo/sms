/* ============================================================
   PLAT-01 remediation — complete impersonation lifecycle,
   end to end: grant → access → audit → notification →
   revocation → denied access.

   The reviewer's explicit acceptance test:
     "Platform operator starts impersonation → access works →
      impersonation is revoked → the token/session immediately
      stops working."

   This deliberately does NOT mock SessionService, sign()/verify(),
   or the real authMiddleware — those are the exact pieces whose
   interaction is under test. Only the DB layer (mongoose.model) is
   faked, with a real in-memory 'sessions' collection so
   SessionService's actual create/get/revoke logic runs for real.
   ============================================================ */
'use strict';

jest.mock('../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../utils/email', () => ({ sendImpersonationNotice: jest.fn() }));
jest.mock('../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../utils/provision-memberships', () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn() }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

// platformSession/requireOwnerTier are stubbed to authorize as an owner-tier
// operator; everything else on middleware/auth (crucially, the real auth
// middleware function, with its real PLAT-01 revocation check) stays untouched.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    platformSession: (req, _res, next) => {
      req.platformOperatorTier = 'owner';
      req.platformOperator = { id: 'op_e2e', name: 'E2E Operator', email: 'operator@msingi.io', tier: 'owner' };
      next();
    },
    requireOwnerTier: (req, _res, next) => next(),
  };
});

/* ── Minimal in-memory mongoose.model() fake ──────────────────
   'schools'/'users'/'sessions' get real, queryable stores; every
   other collection ('organizations', 'teachers', 'memberships',
   'identities', …) gets a no-op stub — every real call site that
   touches them is already wrapped in non-fatal try/catch. */
function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => mockMatchFilter(doc, sub));
    return doc[k] === v;
  });
}
function mockChain(value) {
  const p = Promise.resolve(value);
  return { lean: () => p, select: () => mockChain(value) };
}
function mockMakeStore(seedDocs) {
  const docs = [...seedDocs];
  return {
    docs,
    findOne: (filter) => mockChain(docs.find((d) => mockMatchFilter(d, filter)) ?? null),
    find:    (filter = {}) => mockChain(docs.filter((d) => mockMatchFilter(d, filter))),
    create:  (doc) => { const d = { ...doc }; docs.push(d); return Promise.resolve(d); },
    updateOne: (filter, update) => {
      const d = docs.find((x) => mockMatchFilter(x, filter));
      if (!d) return Promise.resolve({ modifiedCount: 0 });
      if (update.$set) Object.assign(d, update.$set);
      if (update.$inc) Object.entries(update.$inc).forEach(([k, v]) => { d[k] = (d[k] || 0) + v; });
      return Promise.resolve({ modifiedCount: 1 });
    },
  };
}
function mockGenericStore() {
  return { findOne: () => mockChain(null), find: () => mockChain([]), create: (d) => Promise.resolve({ ...d }), updateOne: () => Promise.resolve({ modifiedCount: 0 }) };
}

const SCHOOL_ID = 'sch_e2e_lifecycle';
const ADMIN_ID  = 'usr_e2e_admin';

let mockSchoolStore, mockUserStore, mockSessionStore;
function resetStores() {
  mockSchoolStore  = mockMakeStore([{ id: SCHOOL_ID, name: 'E2E Lifecycle School' }]);
  mockUserStore    = mockMakeStore([{ id: ADMIN_ID, role: 'superadmin', name: 'E2E Admin', email: 'admin@e2e-lifecycle.example', schoolId: SCHOOL_ID }]);
  mockSessionStore = mockMakeStore([]);
}
resetStores();

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools')  return mockSchoolStore;
      if (col === 'users')    return mockUserStore;
      if (col === 'sessions') return mockSessionStore;
      return mockGenericStore();
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function buildApp() {
  const { authMiddleware } = require('../middleware/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/platform', require('../routes/platform'));
  // A tiny stand-in for any real protected route — proves whether the
  // impersonated token can reach past the real authMiddleware or not.
  app.get('/api/test/protected', authMiddleware, (req, res) => {
    res.json({ ok: true, userId: req.jwtUser.userId, impersonated: !!req.jwtUser.impersonated });
  });
  return app;
}

describe('PLAT-01 — complete impersonation lifecycle (grant → access → audit → notification → revoke → denied)', () => {
  const prevAllow = process.env.ALLOW_IMPERSONATION;
  const prevEnv   = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_IMPERSONATION = 'true';
  });
  afterAll(() => {
    process.env.ALLOW_IMPERSONATION = prevAllow;
    process.env.NODE_ENV = prevEnv;
  });

  test('the full lifecycle', async () => {
    const app = buildApp();
    const { dispatchNotification } = require('../utils/notify-dispatch');

    /* ── 1. GRANT ── */
    const grantRes = await supertest(app)
      .post(`/api/platform/schools/${SCHOOL_ID}/impersonate`)
      .send({ reason: 'E2E lifecycle test — support investigation' });

    expect(grantRes.status).toBe(200);
    const { token, impersonationId, expiresAt } = grantRes.body;
    expect(typeof token).toBe('string');
    expect(typeof impersonationId).toBe('string');
    expect(expiresAt).toBeDefined();

    // A real, queryable session row exists — not just a bare id stamped on the token.
    expect(mockSessionStore.docs).toHaveLength(1);
    expect(mockSessionStore.docs[0]).toMatchObject({ id: impersonationId, status: 'active', impersonation: true, userId: ADMIN_ID, schoolId: SCHOOL_ID });

    // AUDIT — the grant itself is recorded.
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.impersonate',
      schoolId: SCHOOL_ID,
      details: expect.objectContaining({ impersonationId, reason: 'E2E lifecycle test — support investigation' }),
    }));

    // NOTIFICATION — the school's admin is told, via the existing dispatch mechanism.
    expect(dispatchNotification).toHaveBeenCalledWith(expect.objectContaining({
      schoolId: SCHOOL_ID,
      eventKey: 'platform_impersonation',
      recipients: [expect.objectContaining({ userId: ADMIN_ID, email: 'admin@e2e-lifecycle.example' })],
    }));

    /* ── 2. ACCESS WORKS ── */
    const accessRes = await supertest(app)
      .get('/api/test/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(accessRes.status).toBe(200);
    expect(accessRes.body).toMatchObject({ ok: true, userId: ADMIN_ID, impersonated: true });

    /* ── 3. REVOKE ── */
    mockAuditLog.mockClear();
    const revokeRes = await supertest(app)
      .post(`/api/platform/impersonation-sessions/${impersonationId}/revoke`)
      .send({ reason: 'Investigation complete' });
    expect(revokeRes.status).toBe(200);
    expect(mockSessionStore.docs[0].status).toBe('revoked');

    // AUDIT — the revocation itself is recorded.
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.impersonate_revoked',
      schoolId: SCHOOL_ID,
      details: expect.objectContaining({ impersonationId }),
    }));

    /* ── 4. DENIED ACCESS — the acceptance test ──
       The SAME token, immediately after revocation — not a new login,
       not a token expiry, an explicit revoke — must stop working on
       the very next request. */
    mockAuditLog.mockClear();
    const deniedRes = await supertest(app)
      .get('/api/test/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(deniedRes.status).toBe(401);
    expect(deniedRes.body.error.code).toBe('IMPERSONATION_ENDED');

    // AUDIT — the denied attempt is itself recorded (PLAT-01 auditability
    // requirement: not just grant/revoke, but every subsequent denied use).
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.impersonate_denied',
      schoolId: SCHOOL_ID,
      details: expect.objectContaining({ impersonationId }),
    }));
  });

  test('revoking an already-revoked session is a 409, not a silent no-op — and access stays denied', async () => {
    const app = buildApp();
    const grantRes = await supertest(app)
      .post(`/api/platform/schools/${SCHOOL_ID}/impersonate`)
      .send({ reason: 'Second E2E run' });
    const { token, impersonationId } = grantRes.body;

    const first  = await supertest(app).post(`/api/platform/impersonation-sessions/${impersonationId}/revoke`).send({});
    expect(first.status).toBe(200);
    const second = await supertest(app).post(`/api/platform/impersonation-sessions/${impersonationId}/revoke`).send({});
    expect(second.status).toBe(409);

    const deniedRes = await supertest(app).get('/api/test/protected').set('Authorization', `Bearer ${token}`);
    expect(deniedRes.status).toBe(401);
  });
});
