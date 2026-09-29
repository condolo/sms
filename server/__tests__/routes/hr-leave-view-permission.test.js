/* ============================================================
   server/routes/hr.js — GET /leave 'leave_view' sub-permission

   Root cause: Settings → Roles & Permissions → HR & Payroll →
   'View Leave Requests' (hr__leave_view) has existed as a UI checkbox
   and a tested generic RBAC mechanism (see rbac-subkey.test.js) since
   2026-09, but GET /api/hr/leave itself never consulted it — the route
   only ever checked the hardcoded HR_ROLES set (superadmin/admin/hr) to
   decide "see everyone's leave requests" vs "see only my own (+ any
   step I'm eligible to approve)". Granting hr__leave_view to any other
   role (e.g. a Deputy Principal who should see all leave requests
   without being handed the full 'hr' role) had zero effect.

   Fix: canViewAllLeave = HR_ROLES.has(role) || hasExplicitSubGrant(req,
   'hr', 'leave_view', 'read') — additive to the HR_ROLES floor, never a
   replacement.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

function chain(result) {
  const c = {
    sort:   () => c,
    skip:   () => c,
    limit:  () => c,
    select: () => c,
    lean:   () => Promise.resolve(result),
  };
  return c;
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.includes(doc[k]);
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
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

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

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
  mockCurrentUser = { userId: 'u_deputy', schoolId: SCHOOL, role: 'deputy_principal', roles: [], email: 'd@x.io' };
  mockStores = {
    leave_requests: makeStore([
      { id: 'lr_own',   schoolId: SCHOOL, staffId: 'u_deputy',  staffName: 'The Deputy', type: 'annual', startDate: '2026-08-01', endDate: '2026-08-02', days: 2, status: 'pending', createdAt: '2026-08-01' },
      { id: 'lr_other', schoolId: SCHOOL, staffId: 'u_teacher', staffName: 'A Teacher',  type: 'sick',   startDate: '2026-08-03', endDate: '2026-08-03', days: 1, status: 'pending', createdAt: '2026-08-03' },
    ]),
    workflow_configs: makeStore(),
    custom_roles:     makeStore(),
    messages:         makeStore(),
    users: makeStore([
      { id: 'u_deputy',  schoolId: SCHOOL, name: 'The Deputy', role: 'deputy_principal', isActive: true },
      { id: 'u_teacher', schoolId: SCHOOL, name: 'A Teacher',  role: 'teacher',           isActive: true },
    ]),
  };
});

describe('GET /api/hr/leave — hr__leave_view sub-permission', () => {
  test('a non-HR-floor role WITHOUT the leave_view grant sees only its own requests (unchanged pre-fix behavior)', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(false);
    const res = await supertest(buildApp()).get('/api/hr/leave');
    expect(res.status).toBe(200);
    expect(mockHasExplicitSubGrant).toHaveBeenCalledWith(expect.anything(), 'hr', 'leave_view', 'read');
    expect(res.body.data.map(d => d.id)).toEqual(['lr_own']);
  });

  test('a non-HR-floor role WITH the leave_view grant sees every leave request (the fix)', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(true);
    const res = await supertest(buildApp()).get('/api/hr/leave');
    expect(res.status).toBe(200);
    expect(res.body.data.map(d => d.id).sort()).toEqual(['lr_other', 'lr_own']);
  });

  test('the staffId filter only applies once canViewAllLeave is true — otherwise it would leak a narrower view of the requester\'s own-scope logic', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(true);
    const res = await supertest(buildApp()).get('/api/hr/leave').query({ staffId: 'u_teacher' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(d => d.id)).toEqual(['lr_other']);
  });

  test('HR_ROLES floor still bypasses the grant check entirely — hasExplicitSubGrant is never even called', async () => {
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [], email: 'hr@x.io' };
    mockStores.users._docs().push({ id: 'u_hr', schoolId: SCHOOL, name: 'HR Person', role: 'hr', isActive: true });
    const res = await supertest(buildApp()).get('/api/hr/leave');
    expect(res.status).toBe(200);
    expect(mockHasExplicitSubGrant).not.toHaveBeenCalled();
    expect(res.body.data.map(d => d.id).sort()).toEqual(['lr_other', 'lr_own']);
  });
});
