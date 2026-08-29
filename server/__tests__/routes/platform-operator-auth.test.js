/* ============================================================
   server/routes/platform.js — POST /auth/login + tier gate
   Security Baseline Register, PLAT-01.

   Before this fix: one shared username/password pair from env vars,
   the resulting session was a bare boolean (req.platformAdmin=true)
   with no real identity behind it, and every audit entry for every
   platform action was hardcoded to the literal actor
   {userId:'platform', role:'platform', email:null} regardless of who
   actually used the credential (PLAT-04).

   Now: named platform_operators accounts with a tier (support:
   read-only, owner: full access). The legacy env-var credential still
   works, but ONLY while platform_operators is empty (bootstrap path) —
   the moment one operator exists, that path is structurally
   unreachable, with no separate "delete the old code" step required.

   Uses the real bcryptjs/jsonwebtoken packages (not mocked) — this is
   exactly the crypto boundary worth exercising for real.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac',  () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships',   () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities',    () => ({ provisionIdentityForUser: jest.fn() }));

let mockOperators; // array backing the platform_operators collection
function mockChain(result) { return { lean: () => Promise.resolve(result) }; }
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) })),
}));
function mockOperatorsCollection() {
  return {
    exists:  jest.fn((filter) => Promise.resolve(mockOperators.some(o => (filter.isActive === undefined || o.isActive === filter.isActive)) ? { _id: 'x' } : null)),
    findOne: jest.fn((filter) => mockChain(mockOperators.find(o => o.email === filter.email && (filter.isActive === undefined || o.isActive === filter.isActive)) || null)),
    updateOne: jest.fn((filter, update) => {
      const op = mockOperators.find(o => o.email === filter.email || o.id === filter.id);
      if (op && update.$set) Object.assign(op, update.$set);
      return Promise.resolve({ modifiedCount: op ? 1 : 0 });
    }),
  };
}
// platform.js defines its OWN local _model helper (mongoose.model(name,
// schema, col) directly) rather than importing server/utils/model — so
// that shared module isn't what needs mocking here; mongoose itself is.
// Routes by the real 3rd argument (collection name) platform.js's local
// _model always passes, same as the real one would resolve to a real
// per-collection Mongoose model.
function mockGenericSafeCollection() {
  return {
    find:    jest.fn(() => mockChain([])),
    findOne: jest.fn(() => mockChain(null)),
    exists:  jest.fn(() => Promise.resolve(null)),
  };
}
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    model: jest.fn((_name, _schema, col) => (col === 'platform_operators' ? mockOperatorsCollection() : mockGenericSafeCollection())),
  };
});

const express   = require('express');
const supertest = require('supertest');

const ORIGINAL_ENV = { ...process.env };

function buildApp() {
  jest.resetModules();
  const platformRouter = require('../../routes/platform');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cookies = req.headers.cookie ? Object.fromEntries(req.headers.cookie.split('; ').map(c => c.split('='))) : {}; next(); });
  app.use('/api/platform', platformRouter);
  return app;
}

beforeEach(async () => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', NODE_ENV: 'test' };
  mockOperators = [];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('POST /auth/login — bootstrap path (no operators exist yet)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ADMIN_USER = 'legacy_admin';
    process.env.PLATFORM_ADMIN_PASS_HASH = bcrypt.hashSync('legacy_pass', 4);
  });

  test('the legacy env-var credential still works while platform_operators is empty', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'legacy_admin', password: 'legacy_pass' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^platform_token=/);
  });

  test('wrong legacy password is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'legacy_admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('the issued legacy token grants owner tier (unchanged historical behavior)', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'legacy_admin', password: 'legacy_pass' });
    const cookie = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const payload = jwt.verify(cookie, 'test-platform-secret');
    expect(payload.sub).toBe('platform-admin');
  });
});

describe('POST /auth/login — named-operator path (at least one operator exists)', () => {
  beforeEach(async () => {
    process.env.PLATFORM_ADMIN_USER = 'legacy_admin';
    process.env.PLATFORM_ADMIN_PASS_HASH = bcrypt.hashSync('legacy_pass', 4);
    mockOperators = [
      { id: 'plop_1', name: 'Jane Owner', email: 'jane@msingi.io', tier: 'owner', isActive: true, passwordHash: bcrypt.hashSync('owner_pass', 4) },
      { id: 'plop_2', name: 'Sam Support', email: 'sam@msingi.io', tier: 'support', isActive: true, passwordHash: bcrypt.hashSync('support_pass', 4) },
    ];
  });

  test('a real operator logs in successfully and the token carries their real identity + tier', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'jane@msingi.io', password: 'owner_pass' });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const payload = jwt.verify(cookie, 'test-platform-secret');
    expect(payload.sub).toBe('platform-operator');
    expect(payload.operatorId).toBe('plop_1');
    expect(payload.email).toBe('jane@msingi.io');
    expect(payload.tier).toBe('owner');
  });

  test('a support-tier operator logs in and their token carries tier:support', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'sam@msingi.io', password: 'support_pass' });
    const cookie = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const payload = jwt.verify(cookie, 'test-platform-secret');
    expect(payload.tier).toBe('support');
  });

  test('the legacy env-var credential NO LONGER WORKS once a real operator exists — the actual fix this closes', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'legacy_admin', password: 'legacy_pass' });
    expect(res.status).toBe(401);
  });

  test('a wrong password for a real operator is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'jane@msingi.io', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('an email matching no operator is rejected (no user-enumeration crash, still constant-effort)', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'nobody@msingi.io', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  test('an inactive operator cannot log in even with the correct password', async () => {
    mockOperators[0].isActive = false;
    const res = await supertest(buildApp()).post('/api/platform/auth/login').send({ username: 'jane@msingi.io', password: 'owner_pass' });
    expect(res.status).toBe(401);
  });
});

describe('Owner-tier gate — mutating platform routes require owner, GETs do not', () => {
  function tokenFor(tier) {
    return jwt.sign({ sub: 'platform-operator', operatorId: 'plop_x', name: 'X', email: 'x@msingi.io', tier }, 'test-platform-secret', { expiresIn: '2h' });
  }

  test('support tier CAN reach a GET route', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/platform/schools').set('Cookie', `platform_token=${tokenFor('support')}`);
    // Not asserting the exact success shape (schools list itself is mocked
    // generically) — only that the tier gate itself did not block it.
    expect(res.status).not.toBe(403);
  });

  test('support tier is FORBIDDEN from a mutating route — the actual PLAT-01 tier boundary', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/platform/schools/sch_x/impersonate').set('Cookie', `platform_token=${tokenFor('support')}`).send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  test('owner tier CAN reach a mutating route (passes the tier gate; may still fail later for unrelated reasons)', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/platform/schools/sch_x/impersonate').set('Cookie', `platform_token=${tokenFor('owner')}`).send({ reason: 'test' });
    expect(res.status).not.toBe(403);
  });

  test('support tier is forbidden from the sensitive GET /users/search route despite being a GET', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/platform/users/search?email=x').set('Cookie', `platform_token=${tokenFor('support')}`);
    expect(res.status).toBe(403);
  });
});
