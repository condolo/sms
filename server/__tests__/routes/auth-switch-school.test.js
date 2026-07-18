/* ============================================================
   Integration tests — POST /api/auth/switch-school
   (C9, D-004, Constitution §10 Stage 4)

   First test coverage for this route. Verifies the provably-inert
   design: fails closed at the multiSchoolEnabled check for every
   organization that hasn't explicitly opted in (currently all of
   them), the same-organization boundary (409 on cross-org, mirroring
   POST /memberships), the Membership-grant-without-users-doc gap
   (a Membership existing does not guarantee login credentials exist
   at the target school), and the happy path minting a correctly
   re-scoped token via the existing exchange-code mechanism.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: 'sess_switch_001',
    absoluteExpiry: new Date(Date.now() + 86_400_000).toISOString(),
  }),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

let mockMembershipDoc = null;
let mockSchoolDocs = {}; // keyed by id
let mockOrgDocs = {};    // keyed by id
let mockTargetUserDoc = null;

// Supports both `.findOne(...).lean()` and `.findOne(...).select(...).lean()`
// chain shapes, since production call sites use both.
function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }) };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'memberships') {
      return { findOne: jest.fn(() => mockChain(() => mockMembershipDoc)) };
    }
    if (collection === 'schools') {
      return { findOne: jest.fn((filter) => mockChain(() => mockSchoolDocs[filter.id] || null)) };
    }
    if (collection === 'organizations') {
      return { findOne: jest.fn((filter) => mockChain(() => mockOrgDocs[filter.id] || null)) };
    }
    if (collection === 'users') {
      return { findOne: jest.fn(() => mockChain(() => mockTargetUserDoc)) };
    }
    return { findOne: jest.fn(() => mockChain(() => null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const { sign, verify } = require('../../utils/jwt');

function buildApp() {
  const authRouter = require('../../routes/auth');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/auth', authRouter);
  return app;
}

function authCookie(payload) {
  return `token=${sign(payload)}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMembershipDoc = null;
  mockSchoolDocs = {};
  mockOrgDocs = {};
  mockTargetUserDoc = null;
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

describe('POST /api/auth/switch-school', () => {
  test('rejects a missing schoolId', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({});

    expect(res.status).toBe(400);
  });

  test('rejects switching to the same school already active', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_a' });

    expect(res.status).toBe(400);
  });

  test('404s when the caller has no membership for the target school', async () => {
    mockMembershipDoc = null;

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(404);
  });

  test('403s when the target organization does not have multiSchoolEnabled — the provably-inert case (every org today)', async () => {
    mockMembershipDoc = { userId: 'usr_1', schoolId: 'sch_b', isActive: true };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { multiSchoolEnabled: false }; // the real state of every org today

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(403);
  });

  test('403s when the target school has no organization at all', async () => {
    mockMembershipDoc = { userId: 'usr_1', schoolId: 'sch_b', isActive: true };
    mockSchoolDocs.sch_b = { id: 'sch_b', name: 'Campus B' }; // no organizationId

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(403);
  });

  test('409s on a cross-organization switch attempt, even with a valid membership and multiSchoolEnabled', async () => {
    mockMembershipDoc = { userId: 'usr_1', schoolId: 'sch_b', isActive: true };
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' }; // current school, org_x
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_y' }; // target school, DIFFERENT org
    mockOrgDocs.org_y = { multiSchoolEnabled: true };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(409);
  });

  test('404s when a Membership exists but no users doc exists at the target school yet (Link Identity grant without an account)', async () => {
    mockMembershipDoc = { userId: 'usr_1', schoolId: 'sch_b', isActive: true };
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x' };
    mockOrgDocs.org_x = { multiSchoolEnabled: true };
    mockTargetUserDoc = null; // membership granted, but no users doc created (ADR-0002's own boundary)

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(404);
  });

  test('happy path: mints a token scoped to the target school and returns an exchange code', async () => {
    mockMembershipDoc = { userId: 'usr_1', schoolId: 'sch_b', isActive: true };
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { multiSchoolEnabled: true };
    mockTargetUserDoc = {
      _id: 'oid_target', id: 'usr_1', email: 'jane@example.com',
      role: 'teacher', primaryRole: 'teacher', roles: ['teacher'],
      schoolId: 'sch_b',
    };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(200);
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code.length).toBeGreaterThan(0);
    // The exchange code is opaque — no token/JWT fields anywhere in the response body.
    expect(res.body.token).toBeUndefined();
  });

  test('the exchange code from switch-school actually redeems to a cookie scoped to the target school', async () => {
    mockMembershipDoc = { id: 'mem_1', userId: 'usr_1', schoolId: 'sch_b', orgId: 'org_x', isActive: true };
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { multiSchoolEnabled: true };
    mockTargetUserDoc = {
      _id: 'oid_target', id: 'usr_1', email: 'jane@example.com',
      role: 'teacher', primaryRole: 'teacher', roles: ['teacher'],
      schoolId: 'sch_b', isActive: true,
    };

    const app = buildApp();
    const switchRes = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' }))
      .send({ schoolId: 'sch_b' });

    expect(switchRes.status).toBe(200);

    const exchangeRes = await supertest(app)
      .post('/api/auth/exchange')
      .send({ code: switchRes.body.code });

    expect(exchangeRes.status).toBe(200);
    expect(exchangeRes.body.school.id).toBe('sch_b');

    const cookies = [].concat(exchangeRes.headers['set-cookie'] || []);
    const tokenCookie = cookies.find(c => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
    const payload = verify(tokenCookie.split(';')[0].split('=')[1]);
    expect(payload.schoolId).toBe('sch_b');
    expect(payload.orgId).toBe('org_x');
  });
});
