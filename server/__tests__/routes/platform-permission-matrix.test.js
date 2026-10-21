/* ============================================================
   The platform permission matrix — every role template against every
   capability-gated route.

   WHY THIS IS A TEST AND NOT A PROBE
   The expected result of each call is DERIVED FROM THE TEMPLATE
   DEFINITION (server/config/platformCapabilities.js) rather than written
   out by hand. That is the point: if someone adds a capability to a role,
   or grants one route to a role, the matrix moves with it and the test
   still has to agree with reality. A hand-written expectation table
   would just be a second copy of the same decision, free to drift.

   For each role template the test logs in as an operator holding exactly
   that template and asserts, for every gated route, whether the call is
   allowed (200/201/404-from-missing-fixture are all "not 403") or refused
   (403). A 403 is the ONLY outcome that means "the gate refused you" —
   a route that 404s because a fixture id does not exist still means the
   gate let the request through.

   Also pins the two routes that must stay readable by ANY authenticated
   operator (/me and the operator directory) and the one that must never
   be readable by a limited role (the full team list).
   ============================================================ */
'use strict';

const jwt = require('jsonwebtoken');

jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac',  () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email', () => ({ sendPlatformOperatorInvite: jest.fn().mockResolvedValue(false) }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships',   () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities',    () => ({ provisionIdentityForUser: jest.fn() }));

function mockChain(v) {
  return { lean: () => Promise.resolve(v), select: () => mockChain(v), sort: () => mockChain(v), limit: () => mockChain(v) };
}
function mockGenericCollection() {
  return {
    find: () => mockChain([]), findOne: () => mockChain(null), findOneAndUpdate: () => mockChain(null),
    exists: () => Promise.resolve(null), countDocuments: () => Promise.resolve(0),
    create: d => Promise.resolve(d), updateOne: () => Promise.resolve({}), deleteMany: () => Promise.resolve({}),
    updateMany: () => Promise.resolve({}), deleteOne: () => Promise.resolve({}),
  };
}
let mockOperators = [];
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'platform_operators') {
      return {
        findOne: (filter) => mockChain(mockOperators.find(o =>
          (filter.id && o.id === filter.id) || (filter.email && o.email === filter.email)) || null),
        find: (filter = {}) => mockChain(mockOperators.filter(o => Object.entries(filter).every(([k, v]) => o[k] === v))),
        countDocuments: () => Promise.resolve(0),
        updateOne: () => Promise.resolve({}),
        create: d => Promise.resolve(d),
      };
    }
    return mockGenericCollection();
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel:   jest.fn(() => mockGenericCollection()),
  platformModel: jest.fn(() => mockGenericCollection()),
}));

const express   = require('express');
const supertest = require('supertest');
const { TEMPLATES, resolveCapabilities } = require('../../config/platformCapabilities');

const ORIGINAL_ENV = { ...process.env };

function buildApp() {
  jest.resetModules();
  const platformRouter = require('../../routes/platform');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = req.headers.cookie ? Object.fromEntries(req.headers.cookie.split('; ').map(c => c.split('='))) : {};
    next();
  });
  app.use('/api/platform', platformRouter);
  return app;
}

/* Every gated route, with the capability it requires. `cap: null` means
   the route is open to any authenticated operator. */
const ROUTES = [
  { method: 'GET',    path: '/me',                      cap: null,                       body: null },
  { method: 'GET',    path: '/my-work',                 cap: null,                       body: null },
  { method: 'GET',    path: '/operators/directory',     cap: null,                       body: null },
  { method: 'GET',    path: '/tickets',                 cap: 'tickets.view',             body: null },
  { method: 'POST',   path: '/tickets',                 cap: 'tickets.manage',           body: { subject: 'x', category: 'support' } },
  { method: 'POST',   path: '/tickets/tck_x/messages',  cap: 'tickets.manage',           body: { body: 'hi' } },
  { method: 'POST',   path: '/tickets/tck_x/assign',    cap: 'tickets.manage',           body: { operatorId: 'op_x' } },
  { method: 'GET',    path: '/demo-requests',           cap: 'onboarding.view',          body: null },
  { method: 'POST',   path: '/demo-requests/dr_x/approve', cap: 'onboarding.manage',      body: {} },
  { method: 'GET',    path: '/schools/pending',         cap: 'onboarding.view',          body: null },
  { method: 'POST',   path: '/schools/sch_x/approve',   cap: 'onboarding.manage',        body: {} },
  { method: 'POST',   path: '/schools',                 cap: 'onboarding.manage',        body: { name: 'S', slug: 's', adminName: 'A', adminEmail: 'a@b.io' } },
  { method: 'GET',    path: '/schools',                 cap: 'schools.view',             body: null },
  { method: 'PATCH',  path: '/schools/sch_x',           cap: 'schools.manage',           body: { name: 'x' } },
  { method: 'POST',   path: '/schools/sch_x/entitlements', cap: 'schools.manage',         body: { key: 'k' } },
  { method: 'DELETE', path: '/schools/sch_x',           cap: 'schools.delete',           body: null },
  { method: 'POST',   path: '/schools/sch_x/impersonate', cap: 'impersonate',            body: { reason: 'r' } },
  { method: 'GET',    path: '/users/search',            cap: 'users.search',             body: null },
  { method: 'GET',    path: '/billing/all',             cap: 'billing.view',             body: null },
  { method: 'POST',   path: '/announcements',           cap: 'content.manage',           body: { title: 't' } },
  { method: 'GET',    path: '/operators',               cap: 'operators.manage',         body: null },
  { method: 'GET',    path: '/stats',                   cap: 'diagnostics.view',         body: null },
];

const tokenFor = (op) => jwt.sign(
  { sub: 'platform-operator', operatorId: op.id, name: op.name, email: op.email, tier: op.tier, template: op.template },
  'test-platform-secret', { expiresIn: '2h' }
);

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', NODE_ENV: 'test' };
  jest.clearAllMocks();
  mockOperators = [];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('the platform permission matrix', () => {
  const templates = Object.keys(TEMPLATES).filter(t => t !== 'custom');

  test.each(templates)('role template "%s" gets exactly the routes its capabilities imply', async (template) => {
    const caps = resolveCapabilities({ tier: 'support', template });
    const op = { id: `op_${template}`, name: `T ${template}`, email: `${template}@msingi.io`, tier: 'support', template, isActive: true, status: 'active' };
    mockOperators = [op];
    const app = buildApp();
    const token = tokenFor(op);

    for (const route of ROUTES) {
      const req = supertest(app)[route.method.toLowerCase()](`/api/platform${route.path}`);
      req.set({ Cookie: `platform_token=${token}`, 'X-CSRF-Token': 'test' });
      if (route.body) req.send(route.body);
      const res = await req;

      const allowed = route.cap === null || caps.includes('*') || caps.includes(route.cap);
      if (allowed) {
        expect({ route: `${route.method} ${route.path}`, status: res.status, allowed })
          .toEqual({ route: `${route.method} ${route.path}`, status: res.status, allowed: true });
        expect(res.status).not.toBe(403);
      } else {
        expect({ route: `${route.method} ${route.path}`, status: res.status, allowed })
          .toEqual({ route: `${route.method} ${route.path}`, status: res.status, allowed: false });
        expect(res.status).toBe(403);
      }
    }
  });

  test('the owner template is not refused by any gated route', async () => {
    const op = { id: 'op_owner', name: 'Owner', email: 'owner@msingi.io', tier: 'owner', template: 'owner', isActive: true, status: 'active' };
    mockOperators = [op];
    const app = buildApp();
    const token = tokenFor(op);
    for (const route of ROUTES) {
      const req = supertest(app)[route.method.toLowerCase()](`/api/platform${route.path}`);
      req.set({ Cookie: `platform_token=${token}`, 'X-CSRF-Token': 'test' });
      if (route.body) req.send(route.body);
      const res = await req;
      expect({ route: `${route.method} ${route.path}`, status: res.status }).toEqual({ route: `${route.method} ${route.path}`, status: res.status });
      expect(res.status).not.toBe(403);
    }
  });

  test('an unknown template resolves to NO capabilities (deny by default)', async () => {
    const op = { id: 'op_ghost', name: 'Ghost', email: 'ghost@msingi.io', tier: 'support', template: 'not_a_template', isActive: true, status: 'active' };
    mockOperators = [op];
    const app = buildApp();
    const token = tokenFor(op);
    const res = await supertest(app).get('/api/platform/tickets').set({ Cookie: `platform_token=${token}` });
    expect(res.status).toBe(403);
  });
});
