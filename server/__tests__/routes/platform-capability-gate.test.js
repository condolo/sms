/* ============================================================
   server/routes/platform.js â€” capability gate integration

   Verifies the capability layer end-to-end through the real router:
   the POLICY table plus the live platform_operators document decide
   what each operator may do. This replaces the old binary tier gate,
   so the important guarantees are:

     1. Owner and the legacy shared credential still reach everything.
     2. A capability role reaches exactly its routes and no others.
     3. The legacy 'support' tier maps to read-only â€” creating this
        layer must never widen an account that already existed.
     4. An unrouted verb keeps the historical "owner only" default.
     5. A suspended operator is rejected even with a valid token.

   All DB access is mocked â€” no MongoDB required.
   ============================================================ */

const jwt = require('jsonwebtoken');

jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac',  () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email', () => ({
  sendPlatformOperatorInvite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships',   () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities',    () => ({ provisionIdentityForUser: jest.fn() }));

/* Chainable stub with the read + write surface platform.js touches. */
function mockChain(result) {
  const c = {
    lean:    () => Promise.resolve(result),
    select:  () => c,
    sort:    () => c,
    limit:   () => c,
    skip:    () => c,
  };
  return c;
}
function mockGenericCollection() {
  return {
    find:            jest.fn(() => mockChain([])),
    findOne:         jest.fn(() => mockChain(null)),
    findOneAndUpdate:jest.fn(() => mockChain(null)),
    exists:          jest.fn(() => Promise.resolve(null)),
    countDocuments:  jest.fn(() => Promise.resolve(0)),
    create:          jest.fn(d => Promise.resolve(d)),
    insertOne:       jest.fn(() => Promise.resolve({ insertedId: 'x' })),
    insertMany:      jest.fn(() => Promise.resolve({ insertedCount: 0 })),
    updateOne:       jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
    updateMany:      jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
    deleteOne:       jest.fn(() => Promise.resolve({ deletedCount: 1 })),
    deleteMany:      jest.fn(() => Promise.resolve({ deletedCount: 1 })),
    aggregate:       jest.fn(() => ({ toArray: () => Promise.resolve([]) })),
    distinct:        jest.fn(() => Promise.resolve([])),
  };
}

let mockOperators = [];

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col !== 'platform_operators') return mockGenericCollection();
    return {
      findOne: jest.fn((filter) => mockChain(
        mockOperators.find(o =>
          (filter.id     !== undefined && o.id === filter.id) ||
          (filter.email  !== undefined && o.email === filter.email)
        ) || null
      )),
      exists: jest.fn(() => Promise.resolve(mockOperators.some(o => o.isActive) ? { _id: 'x' } : null)),
      updateOne: jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
      create: jest.fn(d => Promise.resolve(d)),
    };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel:   jest.fn(() => mockGenericCollection()),
  platformModel: jest.fn(() => mockGenericCollection()),
}));

const express   = require('express');
const supertest = require('supertest');

const ORIGINAL_ENV = { ...process.env };

function buildApp() {
  jest.resetModules();
  const platformRouter = require('../../routes/platform');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = req.headers.cookie
      ? Object.fromEntries(req.headers.cookie.split('; ').map(c => c.split('=')))
      : {};
    next();
  });
  app.use('/api/platform', platformRouter);
  return app;
}

/* A token for a real operator document in mockOperators. */
function tokenFor(operatorId) {
  const op = mockOperators.find(o => o.id === operatorId) || { id: operatorId, name: 'X', email: 'x@msingi.io', tier: 'support' };
  return jwt.sign(
    { sub: 'platform-operator', operatorId: op.id, name: op.name, email: op.email, tier: op.tier, template: op.template || null },
    'test-platform-secret',
    { expiresIn: '2h' }
  );
}
/* The legacy shared-credential token shape. */
function legacyToken() {
  return jwt.sign({ sub: 'platform-admin' }, 'test-platform-secret', { expiresIn: '2h' });
}
const withCookie = (t) => ({ Cookie: `platform_token=${t}` });

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', NODE_ENV: 'test' };
  mockOperators = [
    { id: 'op_owner',     name: 'Ollie Owner',   email: 'owner@msingi.io',    tier: 'owner',   template: 'owner',         isActive: true, status: 'active' },
    { id: 'op_agent',     name: 'Ada Agent',     email: 'agent@msingi.io',    tier: 'support', template: 'support_agent', isActive: true, status: 'active' },
    { id: 'op_viewer',    name: 'Vic Viewer',    email: 'viewer@msingi.io',   tier: 'support', template: 'viewer',        isActive: true, status: 'active' },
    { id: 'op_legacy',    name: 'Lee Legacy',    email: 'legacy@msingi.io',   tier: 'support', /* no template */            isActive: true, status: 'active' },
    { id: 'op_suspended', name: 'Sue Suspended', email: 'susp@msingi.io',     tier: 'support', template: 'support_agent', isActive: false, status: 'suspended' },
    { id: 'op_custom',    name: 'Cass Custom',   email: 'custom@msingi.io',   tier: 'support', template: 'custom',        capabilities: ['tickets.manage'], isActive: true, status: 'active' },
  ];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

/* Convenience: "was the gate passed?" â€” any non-403 means yes. */
async function hit(app, method, path, token) {
  const req = supertest(app)[method](`/api/platform${path}`);
  if (token) req.set(withCookie(token));
  const res = await req.send(method === 'get' ? undefined : {});
  return res;
}

describe('owner and legacy credential reach everything', () => {
  test('owner template can mutate (patch a school) - passes the gate', async () => {
    const res = await hit(buildApp(), 'patch', '/schools/sch_x', tokenFor('op_owner'));
    expect(res.status).not.toBe(403);
  });

  test('the legacy shared-credential token is still full owner access', async () => {
    const res = await hit(buildApp(), 'delete', '/schools/sch_x', legacyToken());
    expect(res.status).not.toBe(403);
  });

  test('owner can read the sensitive cross-school user search', async () => {
    const res = await hit(buildApp(), 'get', '/users/search?email=x', tokenFor('op_owner'));
    expect(res.status).not.toBe(403);
  });
});

describe('support_agent â€” tickets and onboarding, nothing destructive', () => {
  const t = () => tokenFor('op_agent');

  test('can reply to / manage a ticket', async () => {
    expect((await hit(buildApp(), 'post', '/tickets', t())).status).not.toBe(403);
    expect((await hit(buildApp(), 'post', '/tickets/tck_1/messages', t())).status).not.toBe(403);
  });

  test('can approve a demo request / school', async () => {
    expect((await hit(buildApp(), 'post', '/demo-requests/dr_1/approve', t())).status).not.toBe(403);
    expect((await hit(buildApp(), 'post', '/schools/sch_1/approve', t())).status).not.toBe(403);
  });

  test('CANNOT impersonate a school user', async () => {
    const res = await hit(buildApp(), 'post', '/schools/sch_1/impersonate', t());
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/impersonate/);
  });

  test('CANNOT delete a school', async () => {
    expect((await hit(buildApp(), 'delete', '/schools/sch_1', t())).status).toBe(403);
  });

  test('CANNOT grant entitlements', async () => {
    expect((await hit(buildApp(), 'post', '/schools/sch_1/entitlements', t())).status).toBe(403);
  });

  test('CANNOT manage the team', async () => {
    expect((await hit(buildApp(), 'get', '/operators', t())).status).toBe(403);
    expect((await hit(buildApp(), 'post', '/operators/invite', t())).status).toBe(403);
  });
});

describe('legacy support tier â€” read-only, no escalation', () => {
  const t = () => tokenFor('op_legacy');

  test('can read tickets and schools', async () => {
    expect((await hit(buildApp(), 'get', '/tickets', t())).status).not.toBe(403);
    expect((await hit(buildApp(), 'get', '/schools', t())).status).not.toBe(403);
  });

  test('CANNOT manage a ticket â€” the exact regression this guards against', async () => {
    expect((await hit(buildApp(), 'post', '/tickets', t())).status).toBe(403);
    expect((await hit(buildApp(), 'post', '/tickets/tck_1/messages', t())).status).toBe(403);
  });

  test('CANNOT approve onboarding requests', async () => {
    expect((await hit(buildApp(), 'post', '/schools/sch_1/approve', t())).status).toBe(403);
  });

  test('CANNOT read the sensitive cross-school user search (a GET, still denied)', async () => {
    expect((await hit(buildApp(), 'get', '/users/search?email=x', t())).status).toBe(403);
  });
});

describe('per-operator capability overrides', () => {
  test('a custom operator with only tickets.manage can manage tickets', async () => {
    const res = await hit(buildApp(), 'post', '/tickets', tokenFor('op_custom'));
    expect(res.status).not.toBe(403);
  });

  test('...but that same operator cannot read tickets (no tickets.view)', async () => {
    expect((await hit(buildApp(), 'get', '/tickets', tokenFor('op_custom'))).status).toBe(403);
  });
});

describe('unrouted verbs keep the historical owner-only default', () => {
  test('an unknown GET is allowed through the gate (then 404s downstream)', async () => {
    const res = await hit(buildApp(), 'get', '/totally/unknown/route', tokenFor('op_viewer'));
    expect(res.status).not.toBe(403);
  });

  test('an unknown non-GET requires owner', async () => {
    expect((await hit(buildApp(), 'post', '/totally/unknown/route', tokenFor('op_viewer'))).status).toBe(403);
    expect((await hit(buildApp(), 'post', '/totally/unknown/route', tokenFor('op_owner'))).status).not.toBe(403);
  });
});

describe('suspension takes effect on the next request', () => {
  test('a suspended operator is rejected even with a valid token', async () => {
    const res = await hit(buildApp(), 'get', '/schools', tokenFor('op_suspended'));
    expect(res.status).toBe(401);
  });
});

describe('GET /me — identity and capabilities', () => {
  test('any authenticated operator can read their own caps', async () => {
    const res = await hit(buildApp(), 'get', '/me', tokenFor('op_agent'));
    expect(res.status).toBe(200);
    expect(res.body.operator.id).toBe('op_agent');
    expect(res.body.caps).toEqual(expect.arrayContaining(['tickets.manage', 'onboarding.manage']));
    expect(res.body.caps).not.toContain('*');
  });

  test('the legacy shared credential reports owner caps', async () => {
    const res = await hit(buildApp(), 'get', '/me', legacyToken());
    expect(res.status).toBe(200);
    expect(res.body.caps).toEqual(['*']);
  });
});

describe('unauthenticated', () => {
  test('no platform token is rejected', async () => {
    const res = await hit(buildApp(), 'get', '/schools', null);
    expect(res.status).toBe(401);
  });
});

