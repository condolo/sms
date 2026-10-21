/* ============================================================
   /api/platform/tickets/:id/assign  +  GET /api/platform/my-work

   Assignment is the "which teammate owns this" half of platform work
   management. The queue endpoint is deliberately readable by ANY
   authenticated operator because it only ever returns the caller's own
   assignments plus backlog counts — never another person's workload.
   ============================================================ */

const jwt = require('jsonwebtoken');

jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac',  () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email', () => ({ sendPlatformOperatorInvite: jest.fn().mockResolvedValue(false) }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships',   () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities',    () => ({ provisionIdentityForUser: jest.fn() }));

/* ── tiny query matcher (equality + $in + $lt + null-matches-missing) ── */
function mockMatch(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    const actual = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(actual);
      if ('$lt' in v) return actual != null && actual < v.$lt;
      if ('$ne' in v) return actual !== v.$ne;
    }
    if (v === null) return actual === null || actual === undefined; // Mongo semantics: null matches missing
    return actual === v;
  });
}
function mockChain(v) {
  return { lean: () => Promise.resolve(v), select: () => mockChain(v), sort: () => mockChain(v), limit: () => mockChain(v), skip: () => mockChain(v) };
}

let mockTickets = [];
let mockOperators = [];
let mockSchools = [];
let mockDemoRequests = [];
const NOW = () => new Date().toISOString();

function mockTicketStore() {
  const store = {
    find: (filter = {}) => mockChain(mockTickets.filter(t => mockMatch(t, filter))),
    findOne: (filter) => mockChain(mockTickets.find(t => mockMatch(t, filter)) ?? null),
    findOneAndUpdate: (filter, update) => {
      const t = mockTickets.find(x => mockMatch(x, filter));
      if (!t) return mockChain(null);
      if (update.$set) Object.assign(t, update.$set);
      return mockChain(t);
    },
    countDocuments: (filter = {}) => Promise.resolve(mockTickets.filter(t => mockMatch(t, filter)).length),
  };
  return store;
}
function mockOperatorStore() {
  return {
    findOne: (filter) => mockChain(mockOperators.find(o => mockMatch(o, filter)) ?? null),
    find:    (filter = {}) => mockChain(mockOperators.filter(o => mockMatch(o, filter))),
  };
}
function mockGenericCollection() {
  return {
    find: () => mockChain([]), findOne: () => mockChain(null), findOneAndUpdate: () => mockChain(null),
    countDocuments: () => Promise.resolve(0), exists: () => Promise.resolve(null),
    create: d => Promise.resolve(d), updateOne: () => Promise.resolve({}), deleteMany: () => Promise.resolve({}),
  };
}

function mockGenericStore(backing) {
  return {
    find: (filter = {}) => mockChain((backing || []).filter(d => mockMatch(d, filter))),
    findOne: (filter) => mockChain((backing || []).find(d => mockMatch(d, filter)) ?? null),
    findOneAndUpdate: (filter, update) => {
      const d = (backing || []).find(x => mockMatch(x, filter));
      if (!d) return mockChain(null);
      if (update.$set) Object.assign(d, update.$set);
      return mockChain(d);
    },
    countDocuments: (filter = {}) => Promise.resolve((backing || []).filter(d => mockMatch(d, filter)).length),
    updateOne: (filter, update) => {
      const d = (backing || []).find(x => mockMatch(x, filter));
      if (d && update.$set) Object.assign(d, update.$set);
      return Promise.resolve({ modifiedCount: d ? 1 : 0 });
    },
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'tickets') return mockTicketStore();
    if (col === 'platform_operators') return mockOperatorStore();
    if (col === 'schools') return mockGenericStore(mockSchools);
    return mockGenericCollection();
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel:   jest.fn((col) => (col === 'tickets' ? mockTicketStore() : mockGenericCollection())),
  platformModel: jest.fn((col) => {
    if (col === 'tickets') return mockTicketStore();
    if (col === 'demo_requests') return mockGenericStore(mockDemoRequests);
    return mockGenericCollection();
  }),
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
const tokenFor = (operatorId) => jwt.sign(
  { sub: 'platform-operator', operatorId, name: operatorId, email: `${operatorId}@msingi.io`, tier: 'support', template: 'support_agent' },
  'test-platform-secret', { expiresIn: '2h' }
);
const cookie = (t) => ({ Cookie: `platform_token=${t}` });

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', NODE_ENV: 'test', APP_URL: 'https://app.msingi.io' };
  jest.clearAllMocks();
  mockOperators = [
    { id: 'op_agent', name: 'Ada Agent', email: 'ada@msingi.io', tier: 'support', template: 'support_agent', isActive: true, status: 'active' },
    { id: 'op_other', name: 'Ola Other', email: 'ola@msingi.io', tier: 'support', template: 'support_agent', isActive: true, status: 'active' },
  ];
  mockTickets = [
    { id: 'tck_open_unassigned', ref: 'TCK-0001', subject: 'Open, nobody owns it', status: 'open',      assigneeId: null,     updatedAt: '2026-10-20T10:00:00.000Z', createdAt: '2026-10-19T10:00:00.000Z' },
    { id: 'tck_mine',            ref: 'TCK-0002', subject: 'Mine already',        status: 'open',      assigneeId: 'op_agent', updatedAt: '2026-10-21T10:00:00.000Z', createdAt: '2026-10-18T10:00:00.000Z' },
    { id: 'tck_theirs',          ref: 'TCK-0003', subject: "Ola's ticket",        status: 'in_progress', assigneeId: 'op_other', updatedAt: '2026-10-21T11:00:00.000Z', createdAt: '2026-10-18T11:00:00.000Z' },
    { id: 'tck_closed',          ref: 'TCK-0004', subject: 'Already closed',      status: 'closed',    assigneeId: null,     updatedAt: '2026-10-17T10:00:00.000Z', createdAt: '2026-10-16T10:00:00.000Z' },
    { id: 'tck_breached',        ref: 'TCK-0005', subject: 'Past its SLA',        status: 'open',      assigneeId: null,     slaDueAt: '2020-01-01T00:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', createdAt: '2026-10-15T10:00:00.000Z' },
  ];
  mockSchools = [
    { _id: 'sch_pending_unassigned', id: 'sch_pending_unassigned', name: 'Unclaimed Academy', slug: 'unclaimed', status: 'pending', assigneeId: null,         createdAt: '2026-10-18T10:00:00.000Z' },
    { _id: 'sch_pending_mine',       id: 'sch_pending_mine',       name: 'My Academy',        slug: 'mine',      status: 'pending', assigneeId: 'op_agent',   createdAt: '2026-10-19T10:00:00.000Z' },
    { _id: 'sch_active',             id: 'sch_active',             name: 'Live School',       slug: 'live',      status: 'active',  assigneeId: null,         createdAt: '2026-10-01T10:00:00.000Z' },
  ];
  mockDemoRequests = [
    { id: 'dr_mine',      schoolName: 'My Demo',        status: 'pending', assigneeId: 'op_agent', email: 'a@x.io', createdAt: '2026-10-19T11:00:00.000Z' },
    { id: 'dr_unclaimed', schoolName: 'Free Demo',      status: 'pending', assigneeId: null,       email: 'b@x.io', createdAt: '2026-10-17T11:00:00.000Z' },
    { id: 'dr_other',     schoolName: "Ola's Demo",     status: 'pending', assigneeId: 'op_other', email: 'c@x.io', createdAt: '2026-10-18T11:00:00.000Z' },
  ];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('POST /tickets/:id/assign', () => {
  test('an agent with tickets.manage can claim a ticket', async () => {
    const res = await supertest(buildApp()).post('/api/platform/tickets/tck_open_unassigned/assign')
      .set(cookie(tokenFor('op_agent'))).send({ operatorId: 'op_agent' });
    expect(res.status).toBe(200);
    expect(res.body.ticket.assigneeId).toBe('op_agent');
    expect(res.body.ticket.assigneeName).toBe('Ada Agent');
    expect(res.body.ticket.assignee).toBe('Ada Agent'); // legacy free-text field kept in sync
  });

  test('an operator with no tickets.manage is refused by the capability gate', async () => {
    const viewerTok = jwt.sign(
      { sub: 'platform-operator', operatorId: 'op_viewer', name: 'V', email: 'v@msingi.io', tier: 'support', template: 'viewer' },
      'test-platform-secret', { expiresIn: '2h' }
    );
    const res = await supertest(buildApp()).post('/api/platform/tickets/tck_open_unassigned/assign')
      .set(cookie(viewerTok)).send({ operatorId: 'op_agent' });
    expect(res.status).toBe(403);
  });

  test('assigning to an unknown operator is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/platform/tickets/tck_open_unassigned/assign')
      .set(cookie(tokenFor('op_agent'))).send({ operatorId: 'op_ghost' });
    expect(res.status).toBe(404);
  });

  test('omitting operatorId unassigns', async () => {
    const res = await supertest(buildApp()).post('/api/platform/tickets/tck_mine/assign')
      .set(cookie(tokenFor('op_agent'))).send({});
    expect(res.status).toBe(200);
    expect(res.body.ticket.assigneeId).toBeNull();
    expect(res.body.ticket.assignee).toBeNull();
  });

  test('assigning a ticket that does not exist is a 404', async () => {
    const res = await supertest(buildApp()).post('/api/platform/tickets/tck_nope/assign')
      .set(cookie(tokenFor('op_agent'))).send({ operatorId: 'op_agent' });
    expect(res.status).toBe(404);
  });
});

describe('GET /tickets?assigned=…', () => {
  test('assigned=me returns only the caller\u2019s open tickets', async () => {
    const res = await supertest(buildApp()).get('/api/platform/tickets?assigned=me').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(200);
    const ids = res.body.tickets.map(t => t.id);
    expect(ids).toContain('tck_mine');
    expect(ids).not.toContain('tck_theirs');
  });

  test('assigned=none returns the unclaimed backlog (null and missing alike)', async () => {
    const res = await supertest(buildApp()).get('/api/platform/tickets?assigned=none').set(cookie(tokenFor('op_agent')));
    const ids = res.body.tickets.map(t => t.id);
    expect(ids).toContain('tck_open_unassigned');
    expect(ids).not.toContain('tck_mine');
    expect(ids).not.toContain('tck_theirs');
  });
});

describe('GET /my-work', () => {
  test('any authenticated operator may read their own queue', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(200);
    expect(res.body.operator.id).toBe('op_agent');
  });

  test('assignedToMe contains only the caller\u2019s tickets, never a colleague\u2019s', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    const ids = res.body.assignedToMe.map(t => t.id);
    expect(ids).toEqual(['tck_mine']);
    expect(ids).not.toContain('tck_theirs');
  });

  test('the unassigned queue excludes closed tickets', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    const ids = res.body.unassigned.map(t => t.id);
    expect(ids).toContain('tck_open_unassigned');
    expect(ids).not.toContain('tck_closed');
  });

  test('past-SLA open tickets are surfaced', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    expect(res.body.slaBreached.map(t => t.id)).toContain('tck_breached');
    expect(res.body.counts.slaBreached).toBe(1);
  });

  test('counts are always present so the UI can render the tiles', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    expect(res.body.counts).toEqual(expect.objectContaining({
      assignedToMe: expect.any(Number),
      unassigned: expect.any(Number),
      slaBreached: expect.any(Number),
      pendingSchools: expect.any(Number),
      demoRequests: expect.any(Number),
    }));
  });

  test('the legacy credential has a queue too (no operator record)', async () => {
    const legacy = jwt.sign({ sub: 'platform-admin' }, 'test-platform-secret', { expiresIn: '2h' });
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(legacy));
    expect(res.status).toBe(200);
    expect(res.body.operator.id).toBe('platform');
  });
});

describe('onboarding assignment — schools and demo requests', () => {
  test('claiming a pending school records the owner', async () => {
    const res = await supertest(buildApp()).post('/api/platform/schools/sch_pending_unassigned/assign')
      .set(cookie(tokenFor('op_agent'))).send({ operatorId: 'op_agent' });
    expect(res.status).toBe(200);
    expect(res.body.assigneeId).toBe('op_agent');
    expect(mockSchools.find(s => s.id === 'sch_pending_unassigned').assigneeName).toBe('Ada Agent');
  });

  test('an operator without onboarding.manage is refused', async () => {
    const viewerTok = jwt.sign(
      { sub: 'platform-operator', operatorId: 'op_viewer', name: 'V', email: 'v@msingi.io', tier: 'support', template: 'viewer' },
      'test-platform-secret', { expiresIn: '2h' }
    );
    const res = await supertest(buildApp()).post('/api/platform/schools/sch_pending_unassigned/assign')
      .set(cookie(viewerTok)).send({ operatorId: 'op_agent' });
    expect(res.status).toBe(403);
  });

  test('a demo request can be claimed and unassigned', async () => {
    const app = buildApp();
    const claim = await supertest(app).post('/api/platform/demo-requests/dr_unclaimed/assign')
      .set(cookie(tokenFor('op_agent'))).send({ operatorId: 'op_other' });
    expect(claim.status).toBe(200);
    expect(claim.body.request.assigneeId).toBe('op_other');

    const clear = await supertest(buildApp()).post('/api/platform/demo-requests/dr_unclaimed/assign')
      .set(cookie(tokenFor('op_agent'))).send({});
    expect(clear.status).toBe(200);
    expect(clear.body.request.assigneeId).toBeNull();
  });

  test('an unknown demo request is a 404', async () => {
    const res = await supertest(buildApp()).post('/api/platform/demo-requests/dr_nope/assign')
      .set(cookie(tokenFor('op_agent'))).send({ operatorId: 'op_agent' });
    expect(res.status).toBe(404);
  });
});

describe('GET /my-work — onboarding queue', () => {
  test('only the caller\u2019s onboarding items appear under onboarding', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(200);
    expect(res.body.onboarding.schools.map(s => s.id)).toEqual(['sch_pending_mine']);
    expect(res.body.onboarding.demoRequests.map(r => r.id)).toEqual(['dr_mine']);
    expect(res.body.onboarding.demoRequests.map(r => r.id)).not.toContain('dr_other');
  });

  test('counts split owned vs unclaimed onboarding work', async () => {
    const res = await supertest(buildApp()).get('/api/platform/my-work').set(cookie(tokenFor('op_agent')));
    expect(res.body.counts.myOnboarding).toBe(2);        // 1 school + 1 demo request
    expect(res.body.counts.unassignedOnboarding).toBe(2); // 1 school + 1 demo request
    expect(res.body.counts.pendingSchools).toBe(2);       // sch_pending_* (not the active one)
  });
});

describe('GET /operators/directory — the assignee picker\u2019s data source', () => {
  test('a support agent can read it (they cannot read the full team list)', async () => {
    const res = await supertest(buildApp()).get('/api/platform/operators/directory').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(200);
    expect(res.body.operators.map(o => o.id).sort()).toEqual(['op_agent', 'op_other']);
  });

  test('it exposes only id/name/email — no roles, capabilities or statuses', async () => {
    const res = await supertest(buildApp()).get('/api/platform/operators/directory').set(cookie(tokenFor('op_agent')));
    res.body.operators.forEach(o => expect(Object.keys(o).sort()).toEqual(['email', 'id', 'name']));
  });

  test('...while the FULL team list still requires operators.manage', async () => {
    const res = await supertest(buildApp()).get('/api/platform/operators').set(cookie(tokenFor('op_agent')));
    expect(res.status).toBe(403);
  });
});
