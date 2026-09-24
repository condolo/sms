/* ============================================================
   server/routes/timetable.js — timetableManageAccess (2026-09)

   Raised directly: a plain teacher with only "View Timetable" ticked in
   Settings could see the ENTIRE school's Scheduling Engine (every class,
   every teacher, the Institution overview) because every admin-console
   route here only ever checked the coarse `timetable` action array via
   plain rbac(). That array is a union of every sub-key row's own grant —
   confirmed live on a real customer school: the "View Timetable" row had
   ALL THREE V/E/D boxes ticked (an easy, understandable mistake given a
   row labelled "View" having Edit/Delete columns at all), which silently
   handed full create/update/delete via the coarse array despite every
   OTHER row (Edit Timetable, Manage Rooms, etc.) being correctly empty.

   This proves the fix: every admin-console route now requires either the
   real scheduling-admin floor (TIMETABLE_FLOOR_ROLES) or an explicit
   `timetable__manage` grant — no coarse-array fallback, so no amount of
   accidental over-permissioning on any OTHER sub-key can reach it. GET
   /my and /my-children (the self-service Portal's own data source) are
   deliberately untouched and remain open to any authenticated user.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../routes/bell-schedule', () => ({ resolveBellSchedule: jest.fn().mockResolvedValue({ periods: [] }) }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: () => mockChainArr([]), findOne: () => mockChainObj(null) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({
    find: () => mockChainArr([]),
    findOne: () => mockChainObj(null),
    countDocuments: () => Promise.resolve(0),
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');
const rbacMock = require('../../middleware/rbac');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetableRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  rbacMock.hasExplicitSubGrant.mockResolvedValue(false);
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
});

describe('the reported bug — a plain teacher can no longer reach the admin console', () => {
  test('GET / (Class Grid data) is forbidden for a plain teacher with no explicit grant', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/timetable');
    expect(res.status).toBe(403);
  });

  test('GET /overview (Institution view) is forbidden for a plain teacher', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/timetable/overview');
    expect(res.status).toBe(403);
  });

  test('POST / (create a slot) is forbidden for a plain teacher', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).post('/api/timetable').send({ classId: 'cls_1', day: 'monday', period: '1' });
    expect(res.status).toBe(403);
  });

  test('this is true even when the coarse `timetable` action array is wide open — the exact real-world case', async () => {
    // Mirrors the actual corrupted data found live: role_permissions.timetable
    // = ['read','create','update','delete'] despite no explicit manage grant.
    // The OLD plain rbac('timetable', action) check would have read straight
    // from that array and passed; timetableManageAccess never consults it.
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/timetable');
    expect(res.status).toBe(403);
  });
});

describe('who IS allowed', () => {
  test('admin (floor role) can reach GET /', async () => {
    const res = await supertest(buildApp()).get('/api/timetable');
    expect(res.status).toBe(200);
  });

  test('principal, deputy_principal, and timetabler (all floor roles) can reach GET /overview', async () => {
    for (const role of ['principal', 'deputy_principal', 'timetabler']) {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/timetable/overview');
      expect(res.status).toBe(200);
    }
  });

  test('a role with the explicit timetable__manage grant is allowed even without floor status', async () => {
    mockJwtUser = { userId: 'usr_section_head', schoolId: SCHOOL_A, role: 'section_head', roles: ['section_head'] };
    rbacMock.hasExplicitSubGrant.mockResolvedValue(true);
    const res = await supertest(buildApp()).get('/api/timetable');
    expect(res.status).toBe(200);
    expect(rbacMock.hasExplicitSubGrant).toHaveBeenCalledWith(expect.anything(), 'timetable', 'manage', 'read');
  });

  test('the explicit grant check is asked for the RIGHT action on a write route', async () => {
    mockJwtUser = { userId: 'usr_section_head', schoolId: SCHOOL_A, role: 'section_head', roles: ['section_head'] };
    rbacMock.hasExplicitSubGrant.mockResolvedValue(true);
    await supertest(buildApp()).post('/api/timetable').send({ classId: 'cls_1', day: 'monday', period: '1' });
    expect(rbacMock.hasExplicitSubGrant).toHaveBeenCalledWith(expect.anything(), 'timetable', 'manage', 'create');
  });

  test('exams_officer/admissions_officer/finance/hr/discipline_committee — "school"-level for their OWN module — are NOT floor here', async () => {
    for (const role of ['exams_officer', 'admissions_officer', 'finance', 'hr', 'discipline_committee']) {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/timetable');
      expect(res.status).toBe(403);
    }
  });
});

describe('the self-service Portal is untouched', () => {
  test('GET /my remains reachable for a plain teacher with no timetable permissions at all', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/timetable/my');
    expect(res.status).not.toBe(403);
  });

  test('GET /my-children remains reachable for a parent', async () => {
    mockJwtUser = { userId: 'usr_parent', schoolId: SCHOOL_A, role: 'parent', roles: ['parent'] };
    const res = await supertest(buildApp()).get('/api/timetable/my-children');
    expect(res.status).not.toBe(403);
  });
});
