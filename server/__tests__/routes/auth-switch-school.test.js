/* ============================================================
   Integration tests — POST /api/auth/switch-school
   (C9, D-004, Constitution §10 Stage 4)

   Rewritten (not patched) after a real bug was found while designing
   organization-first login: the original implementation validated the
   target account via TargetUsers.findOne({id: userId, ...}) — matching
   the CURRENT session's userId against the TARGET school's users.id.
   But every per-school account gets its own independently-generated id
   (confirmed across every user-creation path), so that lookup could
   never succeed for a real two-school account. Every mock in the
   PREVIOUS version of this file hardcoded the same id on both schools'
   fixtures — the bug was encoded as a test assumption, not caught by
   one. Fixed: resolution now goes through _resolveIdentitySchools
   (auth.js), keyed on the JWT's identityId, never on userId.

   Verifies: the identityId-required fail-closed gate, the
   multiSchoolEnabled/cross-org boundaries (unchanged), the
   no-account-at-target-school case via the resolver (replaces the old
   Membership-without-users-doc test), and the happy path minting a
   correctly re-scoped token via the existing exchange-code mechanism.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: 'sess_switch_001',
    absoluteExpiry: new Date(Date.now() + 86_400_000).toISOString(),
  }),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

let mockSchoolDocs = {};       // keyed by id
let mockOrgDocs = {};          // keyed by id
let mockEligibleUserDocs = []; // what _resolveIdentitySchools's users.find() should see: {id, schoolId, identityId, isActive}
let mockTargetUserDoc = null;  // full doc returned by the final users.findOne() re-fetch

// Supports both `.findOne(...).lean()` and `.findOne(...).select(...).lean()`
// chain shapes, since production call sites use both.
function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }) };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return {
        findOne: jest.fn((filter) => mockChain(() => mockSchoolDocs[filter.id] || null)),
        find:    jest.fn((filter) => mockChain(() => Object.values(mockSchoolDocs).filter(s => s.organizationId === filter.organizationId))),
      };
    }
    if (collection === 'organizations') {
      return { findOne: jest.fn((filter) => mockChain(() => mockOrgDocs[filter.id] || null)) };
    }
    if (collection === 'users') {
      return {
        find: jest.fn((filter) => mockChain(() => mockEligibleUserDocs.filter(u =>
          u.identityId === filter.identityId &&
          (filter.schoolId?.$in || []).includes(u.schoolId) &&
          u.isActive !== false
        ))),
        findOne: jest.fn((filter) => mockChain(() =>
          (mockTargetUserDoc && mockTargetUserDoc.id === filter.id && mockTargetUserDoc.schoolId === filter.schoolId)
            ? mockTargetUserDoc
            : null
        )),
      };
    }
    return { findOne: jest.fn(() => mockChain(() => null)), find: jest.fn(() => mockChain(() => [])) };
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
  mockSchoolDocs = {};
  mockOrgDocs = {};
  mockEligibleUserDocs = [];
  mockTargetUserDoc = null;
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

describe('POST /api/auth/switch-school', () => {
  test('rejects a missing schoolId', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({});

    expect(res.status).toBe(400);
  });

  test('rejects switching to the same school already active', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_a' });

    expect(res.status).toBe(400);
  });

  test('404s when the caller\'s token has no identityId (pre-identity-migration account) — even with a fully valid target otherwise', async () => {
    // Everything else about the target is valid — proves the identityId
    // guard itself is what blocks this, not a downstream 404 for an
    // unrelated reason (school/org not found).
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { id: 'org_x', multiSchoolEnabled: true };
    mockEligibleUserDocs = [{ id: 'usr_2', schoolId: 'sch_b', identityId: 'idt_1', isActive: true }];
    mockTargetUserDoc = {
      _id: 'oid_target', id: 'usr_2', email: 'jane@example.com',
      role: 'teacher', primaryRole: 'teacher', roles: ['teacher'],
      schoolId: 'sch_b', identityId: 'idt_1', isActive: true,
    };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a' })) // no identityId
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('You do not have access to that school.');
  });

  test('403s when the target organization does not have multiSchoolEnabled — the provably-inert case (every org today)', async () => {
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { id: 'org_x', multiSchoolEnabled: false }; // the real state of every org today

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(403);
  });

  test('403s when the target school has no organization at all', async () => {
    mockSchoolDocs.sch_b = { id: 'sch_b', name: 'Campus B' }; // no organizationId

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(403);
  });

  test('409s on a cross-organization switch attempt, even with multiSchoolEnabled true', async () => {
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' }; // current school, org_x
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_y' }; // target school, DIFFERENT org
    mockOrgDocs.org_y = { id: 'org_y', multiSchoolEnabled: true };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(409);
  });

  test('404s when the identity has no account at the target school (resolver finds no match)', async () => {
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x' };
    mockOrgDocs.org_x = { id: 'org_x', multiSchoolEnabled: true };
    mockEligibleUserDocs = []; // identity has no users doc anywhere in this org

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(404);
  });

  test('404s when the resolver finds a match but the fresh re-fetch comes back empty (deactivated in the gap)', async () => {
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x' };
    mockOrgDocs.org_x = { id: 'org_x', multiSchoolEnabled: true };
    mockEligibleUserDocs = [{ id: 'usr_2', schoolId: 'sch_b', identityId: 'idt_1', isActive: true }];
    mockTargetUserDoc = null; // fresh re-fetch finds nothing (e.g. deactivated since resolution)

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(404);
  });

  test('happy path: mints a token scoped to the target school using the resolver-matched userId, not the session userId', async () => {
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { id: 'org_x', multiSchoolEnabled: true };
    // Deliberately a DIFFERENT id than the session's 'usr_1' — proves the fix
    // no longer requires (or assumes) the same users.id across schools.
    mockEligibleUserDocs = [{ id: 'usr_2', schoolId: 'sch_b', identityId: 'idt_1', isActive: true }];
    mockTargetUserDoc = {
      _id: 'oid_target', id: 'usr_2', email: 'jane@example.com',
      role: 'teacher', primaryRole: 'teacher', roles: ['teacher'],
      schoolId: 'sch_b', identityId: 'idt_1', isActive: true,
    };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
      .send({ schoolId: 'sch_b' });

    expect(res.status).toBe(200);
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code.length).toBeGreaterThan(0);
    // The exchange code is opaque — no token/JWT fields anywhere in the response body.
    expect(res.body.token).toBeUndefined();
  });

  test('the exchange code from switch-school actually redeems to a cookie scoped to the target school and the resolved (not session) userId', async () => {
    mockSchoolDocs.sch_a = { id: 'sch_a', organizationId: 'org_x' };
    mockSchoolDocs.sch_b = { id: 'sch_b', organizationId: 'org_x', name: 'Campus B' };
    mockOrgDocs.org_x = { id: 'org_x', multiSchoolEnabled: true };
    mockEligibleUserDocs = [{ id: 'usr_2', schoolId: 'sch_b', identityId: 'idt_1', isActive: true }];
    mockTargetUserDoc = {
      _id: 'oid_target', id: 'usr_2', email: 'jane@example.com',
      role: 'teacher', primaryRole: 'teacher', roles: ['teacher'],
      schoolId: 'sch_b', identityId: 'idt_1', isActive: true,
    };

    const app = buildApp();
    const switchRes = await supertest(app)
      .post('/api/auth/switch-school')
      .set('Cookie', authCookie({ userId: 'usr_1', schoolId: 'sch_a', identityId: 'idt_1' }))
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
    expect(payload.userId).toBe('usr_2'); // resolved id, not the session's original 'usr_1'
  });
});
