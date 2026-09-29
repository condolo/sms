/* ============================================================
   server/routes/hr.js — closing the coarse 'hr' permission leak

   Root cause: Settings' HR & Payroll table computes the COARSE 'hr'
   array (what a bare rbac('hr', action) with no subKey reads) as the
   UNION of every action ticked across ALL 6 sub-rows
   (settings.js's _deriveApiPerms). Ticking ONLY 'View Leave Requests'
   contributes 'read' to that shared array; ticking ONLY 'Approve /
   Reject Leave''s Edit box contributes 'create'+'update' to it. Six
   hr.js routes read that same coarse array directly, with no subKey at
   all: GET /summary ('read'), PUT /payroll-config ('update'),
   POST /payroll ('create'), PATCH /payroll/:id/status ('update'),
   POST /payroll/copy ('create'), DELETE /payroll/:id ('delete') — none
   of them actually scoped to what their own Settings row controls.

   Fix: GET /summary now requires the HR_ROLES floor with no sub-grant
   escape hatch (hrFloorOnly) — it aggregates staff/leave/payroll data
   with no single sub-permission of its own. The 5 payroll write/config
   routes now require HR_ROLES OR hasExplicitSubGrant('hr',
   'payroll_view', action) (payrollManageAccess) — tied to the SAME
   'payroll_view' sub-key its own read routes already use, mirroring how
   'documents' already correctly gates its own writes.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

function chain(result) {
  return {
    select: () => chain(result),
    sort:   () => chain(result),
    skip:   () => chain(result),
    limit:  () => chain(result),
    lean:   () => Promise.resolve(result),
  };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    findOneAndUpdate: (filter, update, opts = {}) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) {
          if (!opts.upsert) return null;
          doc = { ...filter }; docs.push(doc);
          if (update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
        }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
    findOneAndDelete: (filter) => ({
      lean: async () => {
        const idx = docs.findIndex(d => matches(d, filter));
        if (idx === -1) return null;
        return docs.splice(idx, 1)[0];
      },
    }),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    aggregate: async () => [], // /summary's two aggregations — empty result is fine, only authorization is under test
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;
const mockHasExplicitSubGrant = jest.fn().mockResolvedValue(false);

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: (...args) => mockHasExplicitSubGrant(...args),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/email', () => ({ sendPayrollStatusEmail: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const hrRouter  = require('../../routes/hr');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr', hrRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasExplicitSubGrant.mockResolvedValue(false);
  // A role with NO HR_ROLES membership — the coarse 'hr' pollution bug
  // is only observable for a role outside superadmin/admin/hr.
  mockCurrentUser = { userId: 'u_deputy', schoolId: SCHOOL, role: 'deputy_principal', roles: [], email: 'd@x.io' };
  mockStores = {
    payroll: makeStore([{ id: 'pr_1', schoolId: SCHOOL, staffId: 'u_staff_1', payPeriod: '2026-07', status: 'draft', basicSalary: 50000 }]),
    payroll_config: makeStore(),
    payroll_history: makeStore(),
    workflow_configs: makeStore(),
    custom_roles: makeStore(),
    schools: makeStore([{ id: SCHOOL, name: 'Test School', currency: 'KES' }]),
    users: makeStore([
      { id: 'u_staff_1', schoolId: SCHOOL, name: 'Staff One', email: 'staff1@x.io', role: 'teacher', isActive: true },
    ]),
    leave_requests: makeStore(),
    teachers: makeStore(),
    memberships: makeStore(),
  };
});

describe('GET /api/hr/summary — no sub-grant escape hatch', () => {
  test('a non-HR-floor role is denied even if hasExplicitSubGrant would say yes for something else', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(true); // proves the route never even asks
    const res = await supertest(buildApp()).get('/api/hr/summary');
    expect(res.status).toBe(403);
    expect(mockHasExplicitSubGrant).not.toHaveBeenCalled();
  });

  test('the HR_ROLES floor still works with no sub-grant at all', async () => {
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    const res = await supertest(buildApp()).get('/api/hr/summary');
    expect(res.status).toBe(200);
  });
});

describe('Payroll write/config routes — payroll_view sub-grant replaces the coarse leak', () => {
  test('PUT /payroll-config: denied without HR_ROLES or the payroll_view grant', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(false);
    const res = await supertest(buildApp()).put('/api/hr/payroll-config').send({});
    expect(res.status).toBe(403);
    expect(mockHasExplicitSubGrant).toHaveBeenCalledWith(expect.anything(), 'hr', 'payroll_view', 'update');
  });

  test('POST /payroll: denied without the grant, even though a DIFFERENT sub-permission (e.g. leave_approve) was ticked elsewhere', async () => {
    // Simulates the exact leak this closes: some OTHER checkbox contributed
    // 'create' to the coarse array, but payroll_view itself was never granted.
    mockHasExplicitSubGrant.mockResolvedValue(false);
    const res = await supertest(buildApp()).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-08', basicSalary: 50000,
    });
    expect(res.status).toBe(403);
  });

  test('POST /payroll: allowed once payroll_view\'s own grant covers "create"', async () => {
    mockHasExplicitSubGrant.mockImplementation((_req, mod, subKey, action) =>
      Promise.resolve(mod === 'hr' && subKey === 'payroll_view' && action === 'create'));
    const res = await supertest(buildApp()).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-08', basicSalary: 50000,
    });
    expect(res.status).toBe(200);
  });

  test('PATCH /payroll/:id/status: denied without the grant', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(false);
    const res = await supertest(buildApp()).patch('/api/hr/payroll/pr_1/status').send({ status: 'confirmed' });
    expect(res.status).toBe(403);
  });

  test('POST /payroll/copy: denied without the grant', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(false);
    const res = await supertest(buildApp()).post('/api/hr/payroll/copy').send({ sourcePeriod: '2026-07', targetPeriod: '2026-08' });
    expect(res.status).toBe(403);
  });

  test('DELETE /payroll/:id: denied without the grant', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(false);
    const res = await supertest(buildApp()).delete('/api/hr/payroll/pr_1');
    expect(res.status).toBe(403);
  });

  test('DELETE /payroll/:id: allowed once payroll_view\'s own grant covers "delete" (record is draft, not locked)', async () => {
    mockHasExplicitSubGrant.mockImplementation((_req, mod, subKey, action) =>
      Promise.resolve(mod === 'hr' && subKey === 'payroll_view' && action === 'delete'));
    const res = await supertest(buildApp()).delete('/api/hr/payroll/pr_1');
    expect(res.status).toBe(200);
  });

  test('the HR_ROLES floor still works for every write route with no sub-grant at all', async () => {
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    const res = await supertest(buildApp()).patch('/api/hr/payroll/pr_1/status').send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(mockHasExplicitSubGrant).not.toHaveBeenCalled();
  });
});
