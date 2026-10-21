/* ============================================================
   /api/platform/operators — team management API

   Covers the invite → accept → manage lifecycle and, most importantly,
   the three refusals that protect the platform:
     - no escalation    (can't grant what you don't hold)
     - no last-owner-out (can't suspend/demote/remove the final owner)
     - no self-lockout   (can't remove your own access / account)

   DB access is mocked with a small in-memory store; email and audit are
   stubbed. The real bcrypt + JWT packages are used.
   ============================================================ */

const jwt = require('jsonwebtoken');

jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac',  () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email', () => ({
  sendPlatformOperatorInvite: jest.fn(() => Promise.resolve(mockEmailSent)),
}));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships',   () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities',    () => ({ provisionIdentityForUser: jest.fn() }));

/* ── in-memory platform_operators store ─────────────────────── */
let mockOperators = [];
/* Whether the stubbed invite email reports success; the factory above reads
   this live at call time so a test can flip it without reaching into the
   module instance (which resetModules() makes unreliable to identify). */
let mockEmailSent = false;

function mockMatch(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockChain(v) {
  return { lean: () => Promise.resolve(v), select: () => mockChain(v), sort: () => mockChain(v), limit: () => mockChain(v) };
}
function mockOperatorStore() {
  return {
    findOne: (filter) => mockChain(mockOperators.find(o => mockMatch(o, filter)) ?? null),
    find:    (filter = {}) => mockChain(mockOperators.filter(o => mockMatch(o, filter))),
    create:  (doc) => { const d = { ...doc }; mockOperators.push(d); return Promise.resolve(d); },
    updateOne: (filter, update) => {
      const d = mockOperators.find(o => mockMatch(o, filter));
      if (!d) return Promise.resolve({ modifiedCount: 0 });
      if (update.$set) Object.assign(d, update.$set);
      return Promise.resolve({ modifiedCount: 1 });
    },
    exists: () => Promise.resolve(mockOperators.some(o => o.isActive) ? { _id: 'x' } : null),
  };
}
function mockGenericCollection() {
  return {
    find: () => mockChain([]), findOne: () => mockChain(null), findOneAndUpdate: () => mockChain(null),
    exists: () => Promise.resolve(null), countDocuments: () => Promise.resolve(0),
    create: d => Promise.resolve(d), updateOne: () => Promise.resolve({}), deleteOne: () => Promise.resolve({}),
    deleteMany: () => Promise.resolve({}), aggregate: () => ({ toArray: () => Promise.resolve([]) }),
  };
}
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => (col === 'platform_operators' ? mockOperatorStore() : mockGenericCollection())),
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
    req.cookies = req.headers.cookie ? Object.fromEntries(req.headers.cookie.split('; ').map(c => c.split('='))) : {};
    next();
  });
  app.use('/api/platform', platformRouter);
  return app;
}

function tokenFor(operatorId) {
  const op = mockOperators.find(o => o.id === operatorId) || { id: operatorId, tier: 'support' };
  return jwt.sign(
    { sub: 'platform-operator', operatorId: op.id, name: op.name || 'X', email: op.email || 'x@msingi.io', tier: op.tier, template: op.template || null },
    'test-platform-secret', { expiresIn: '2h' }
  );
}
const cookie = (t) => ({ Cookie: `platform_token=${t}` });

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', NODE_ENV: 'test', APP_URL: 'https://app.msingi.io' };
  jest.clearAllMocks();
  mockEmailSent = false;
  mockOperators = [
    { id: 'op_owner',   name: 'Ollie Owner',  email: 'owner@msingi.io',  tier: 'owner',   template: 'owner',        isActive: true,  status: 'active' },
    { id: 'op_manager', name: 'Mona Manager', email: 'mgr@msingi.io',    tier: 'support', template: 'custom', capabilities: ['operators.manage', 'tickets.view', 'tickets.manage', 'onboarding.view', 'onboarding.manage', 'schools.view', 'billing.view', 'diagnostics.view'], isActive: true, status: 'active' },
    { id: 'op_agent',   name: 'Ada Agent',    email: 'agent@msingi.io',  tier: 'support', template: 'support_agent', isActive: true, status: 'active' },
  ];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

/* ══════════════════════════════════════════════════════════════ */
describe('GET /operators — team list', () => {
  test('requires operators.manage', async () => {
    const res = await supertest(buildApp()).get('/api/platform/operators').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(403);
  });

  test('an owner sees the team, and no password/invite secrets are exposed', async () => {
    const res = await supertest(buildApp()).get('/api/platform/operators').set(cookie(tokenFor('op_owner')));
    expect(res.status).toBe(200);
    expect(res.body.operators).toHaveLength(3);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/passwordHash|inviteTokenHash/);
    const owner = res.body.operators.find(o => o.id === 'op_owner');
    expect(owner.capabilities).toEqual(['*']);
  });
});

describe('GET /operators/capabilities — catalogue', () => {
  test('is readable by any authenticated operator (it describes the model, not the team)', async () => {
    const res = await supertest(buildApp()).get('/api/platform/operators/capabilities').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(200);
    expect(res.body.capabilities.length).toBeGreaterThan(0);
    expect(res.body.templates.map(t => t.key)).toEqual(expect.arrayContaining(['owner', 'support_agent', 'viewer']));
  });
});

describe('POST /operators/invite', () => {
  const invite = { name: 'Nia New', email: 'nia@msingi.io', title: 'Support', template: 'support_agent' };

  test('an owner invites a team member — account is created inactive with a hashed token', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite').set(cookie(tokenFor('op_owner'))).send(invite);
    expect(res.status).toBe(201);
    expect(res.body.operator.email).toBe('nia@msingi.io');
    expect(res.body.operator.status).toBe('invited');
    expect(res.body.operator.isActive).toBe(false);

    const stored = mockOperators.find(o => o.email === 'nia@msingi.io');
    expect(stored.isActive).toBe(false);           // bootstrap path preserved until accepted
    expect(stored.passwordHash).toBeNull();
    expect(stored.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/inviteTokenHash|passwordHash/);
  });

  test('the invite email is sent and the raw link is NOT returned when delivery succeeds', async () => {
    mockEmailSent = true;
    const res = await supertest(buildApp()).post('/api/platform/operators/invite').set(cookie(tokenFor('op_owner'))).send(invite);
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.inviteUrl).toBeUndefined();
  });

  test('when email cannot be sent the link is returned so the inviter can deliver it', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite').set(cookie(tokenFor('op_owner'))).send(invite);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.inviteUrl).toMatch(/^https:\/\/app\.msingi\.io\/platform\?invite=[0-9a-f]{64}$/);
  });

  test('a duplicate email is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite').set(cookie(tokenFor('op_owner'))).send({ ...invite, email: 'owner@msingi.io' });
    expect(res.status).toBe(409);
  });

  test('an agent without operators.manage cannot invite', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite').set(cookie(tokenFor('op_agent'))).send(invite);
    expect(res.status).toBe(403);
  });

  test('NO ESCALATION — a manager cannot invite an owner', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite')
      .set(cookie(tokenFor('op_manager')))
      .send({ name: 'Sneaky', email: 'sneaky@msingi.io', template: 'owner' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/\*/);
  });

  test('NO ESCALATION — a manager cannot grant a capability it lacks', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite')
      .set(cookie(tokenFor('op_manager')))
      .send({ name: 'X', email: 'x@msingi.io', template: 'custom', capabilities: ['operators.manage', 'schools.delete'] });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/schools\.delete/);
  });

  test('a manager CAN invite within its own capability set', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/invite')
      .set(cookie(tokenFor('op_manager')))
      .send({ name: 'Fine', email: 'fine@msingi.io', template: 'custom', capabilities: ['operators.manage', 'tickets.manage'] });
    expect(res.status).toBe(201);
  });
});

describe('POST /auth/accept-invite', () => {
  async function issueInvite(app) {
    const res = await supertest(app).post('/api/platform/operators/invite').set(cookie(tokenFor('op_owner')))
      .send({ name: 'Nia New', email: 'nia@msingi.io', template: 'support_agent' });
    const token = new URL(res.body.inviteUrl).searchParams.get('invite');
    return token;
  }

  test('a valid invite activates the account, stores a bcrypt hash and signs the user in', async () => {
    const app = buildApp();
    const token = await issueInvite(app);
    const res = await supertest(app).post('/api/platform/auth/accept-invite').send({ token, password: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/platform_token=/);

    const stored = mockOperators.find(o => o.email === 'nia@msingi.io');
    expect(stored.status).toBe('active');
    expect(stored.isActive).toBe(true);
    expect(stored.inviteTokenHash).toBeNull();
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt, never the plain password
  });

  test('the token is single-use', async () => {
    const app = buildApp();
    const token = await issueInvite(app);
    await supertest(app).post('/api/platform/auth/accept-invite').send({ token, password: 'correct-horse' });
    const again = await supertest(app).post('/api/platform/auth/accept-invite').send({ token, password: 'another-one' });
    expect(again.status).toBe(400);
  });

  test('an expired invite is rejected', async () => {
    const app = buildApp();
    const token = await issueInvite(app);
    const stored = mockOperators.find(o => o.email === 'nia@msingi.io');
    stored.inviteExpiresAt = new Date(Date.now() - 1000).toISOString();
    const res = await supertest(app).post('/api/platform/auth/accept-invite').send({ token, password: 'correct-horse' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVITE_EXPIRED');
  });

  test('a weak password is rejected', async () => {
    const app = buildApp();
    const token = await issueInvite(app);
    const res = await supertest(app).post('/api/platform/auth/accept-invite').send({ token, password: 'short' });
    expect(res.status).toBe(400);
  });

  test('an unknown token is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/platform/auth/accept-invite').send({ token: 'nope'.repeat(16), password: 'correct-horse' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /operators/:id — role and capability changes', () => {
  test('an owner can change a team member role', async () => {
    const res = await supertest(buildApp()).patch('/api/platform/operators/op_agent').set(cookie(tokenFor('op_owner')))
      .send({ template: 'billing' });
    expect(res.status).toBe(200);
    expect(res.body.operator.capabilities).toEqual(expect.arrayContaining(['billing.view']));
    expect(res.body.operator.capabilities).not.toContain('tickets.manage');
  });

  test('SELF-LOCKOUT — cannot remove your own operators.manage', async () => {
    const res = await supertest(buildApp()).patch('/api/platform/operators/op_owner').set(cookie(tokenFor('op_owner')))
      .send({ template: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SELF_LOCKOUT');
  });

  test('NO ESCALATION — a manager cannot promote itself to owner', async () => {
    const res = await supertest(buildApp()).patch('/api/platform/operators/op_manager').set(cookie(tokenFor('op_manager')))
      .send({ template: 'owner' });
    expect(res.status).toBe(403);
  });

  test('LAST OWNER — the final owner cannot be demoted', async () => {
    const res = await supertest(buildApp()).patch('/api/platform/operators/op_owner').set(cookie(tokenFor('op_manager')))
      .send({ template: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  test('an owner CAN be demoted once another active owner exists', async () => {
    mockOperators.push({ id: 'op_owner2', name: 'Second Owner', email: 'owner2@msingi.io', tier: 'owner', template: 'owner', isActive: true, status: 'active' });
    const res = await supertest(buildApp()).patch('/api/platform/operators/op_owner').set(cookie(tokenFor('op_manager')))
      .send({ template: 'viewer' });
    expect(res.status).toBe(200);
  });
});

describe('suspend / reactivate / remove', () => {
  test('SELF-SUSPEND is refused', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/op_owner/suspend').set(cookie(tokenFor('op_owner')));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SELF_SUSPEND');
  });

  test('LAST OWNER cannot be suspended by a manager', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/op_owner/suspend').set(cookie(tokenFor('op_manager')));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  test('suspending a non-owner deactivates and revokes their sessions immediately', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/op_agent/suspend').set(cookie(tokenFor('op_owner')));
    expect(res.status).toBe(200);
    const stored = mockOperators.find(o => o.id === 'op_agent');
    expect(stored.isActive).toBe(false);
    expect(stored.status).toBe('suspended');
    expect(stored.sessionsRevokedAt).toBeTruthy();
  });

  test('SELF-REMOVE is refused', async () => {
    const res = await supertest(buildApp()).delete('/api/platform/operators/op_owner').set(cookie(tokenFor('op_owner')));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SELF_REMOVE');
  });

  test('removing a member is a soft delete, not a row deletion', async () => {
    const res = await supertest(buildApp()).delete('/api/platform/operators/op_agent').set(cookie(tokenFor('op_owner')));
    expect(res.status).toBe(200);
    const stored = mockOperators.find(o => o.id === 'op_agent');
    expect(stored).toBeTruthy();                    // audit trail keeps the record
    expect(stored.status).toBe('removed');
    expect(stored.isActive).toBe(false);
  });
});

describe('revoke-sessions', () => {
  test('stamps sessionsRevokedAt so tokens issued earlier are rejected', async () => {
    const res = await supertest(buildApp()).post('/api/platform/operators/op_agent/revoke-sessions').set(cookie(tokenFor('op_owner')));
    expect(res.status).toBe(200);
    expect(mockOperators.find(o => o.id === 'op_agent').sessionsRevokedAt).toBeTruthy();
  });
});
