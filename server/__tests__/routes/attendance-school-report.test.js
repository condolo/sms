/* ============================================================
   GET /api/attendance/school-report — whole-school, per-class/stream.

   Deliberately MORE restrictive than plain 'attendance:read': a class
   teacher or subject teacher with ordinary register access should not
   automatically see every other class's registers in one aggregate view.
   Uses hasExplicitSubGrant (no coarse-grant fallback) for anyone outside
   the admin/principal/deputy floor — same reasoning as report-card
   publishing and mark-submissions review elsewhere in this codebase.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

let mockRolePerms = {}; // { [mod__sub]: string[] }

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({
  scopeMiddleware: (req, _res, next) => { req.scope = null; next(); },
}));

// Real rbac.js (not mocked) so hasExplicitSubGrant's real no-fallback logic
// is what's under test — only its own DB read (role_permissions) is mocked.
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: mockRolePerms }) }) };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

let mockStudentsRoster, mockAttendanceDay, mockClasses, mockStreams;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    const chainArr = (arr) => { const c = { select: () => c, lean: () => Promise.resolve(arr) }; return c; };
    if (collection === 'classes')  return { find: () => chainArr(mockClasses) };
    if (collection === 'streams')  return { find: () => chainArr(mockStreams) };
    if (collection === 'students') return { aggregate: () => Promise.resolve(mockStudentsRoster) };
    if (collection === 'attendance') return { aggregate: () => Promise.resolve(mockAttendanceDay) };
    return { find: () => chainArr([]) };
  },
}));

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp(jwtUser) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/attendance', attendanceRouter);
  return app;
}

beforeEach(() => {
  invalidatePermCache(SCHOOL_A);
  mockRolePerms = { attendance: ['read', 'create', 'update', 'delete'] }; // ordinary full attendance access, no report grant
  mockClasses = [{ id: 'cls_1', name: 'Year 7' }];
  mockStreams = [{ id: 'str_1', name: 'A', classId: 'cls_1' }, { id: 'str_2', name: 'B', classId: 'cls_1' }];
  mockStudentsRoster = [
    { _id: { classId: 'cls_1', streamId: 'str_1' }, roster: 10 },
    { _id: { classId: 'cls_1', streamId: 'str_2' }, roster: 8 },
  ];
  mockAttendanceDay = [
    { _id: { classId: 'cls_1', streamId: 'str_1', status: 'present' }, count: 9 },
    { _id: { classId: 'cls_1', streamId: 'str_1', status: 'absent' },  count: 1 },
    { _id: { classId: 'cls_1', streamId: 'str_2', status: 'present' }, count: 8 },
  ];
});

describe('GET /api/attendance/school-report — access control', () => {
  test('a plain teacher role with ordinary full attendance access is FORBIDDEN — the whole point of this sub', async () => {
    const res = await supertest(buildApp({ userId: 'u1', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] }))
      .get('/api/attendance/school-report');
    expect(res.status).toBe(403);
  });

  test('admin (floor role) can view it with no explicit grant needed', async () => {
    const res = await supertest(buildApp({ userId: 'u2', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] }))
      .get('/api/attendance/school-report');
    expect(res.status).toBe(200);
  });

  test('principal (floor role) can view it', async () => {
    const res = await supertest(buildApp({ userId: 'u3', schoolId: SCHOOL_A, role: 'principal', roles: ['principal'] }))
      .get('/api/attendance/school-report');
    expect(res.status).toBe(200);
  });

  test('a non-floor role WITH the explicit attendance__report grant can view it', async () => {
    mockRolePerms = { attendance: ['read'], attendance__report: ['read'] };
    const res = await supertest(buildApp({ userId: 'u4', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] }))
      .get('/api/attendance/school-report');
    expect(res.status).toBe(200);
  });

  test('holding full coarse attendance:read/create/update/delete does NOT imply the report grant', async () => {
    mockRolePerms = { attendance: ['read', 'create', 'update', 'delete'] }; // no attendance__report key at all
    const res = await supertest(buildApp({ userId: 'u5', schoolId: SCHOOL_A, role: 'exams_officer', roles: ['exams_officer'] }))
      .get('/api/attendance/school-report');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/attendance/school-report — aggregation', () => {
  test('merges roster + day\'s attendance into a per-class/stream breakdown with correct rates', async () => {
    const res = await supertest(buildApp({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] }))
      .get('/api/attendance/school-report?date=2026-09-22');

    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2026-09-22');
    expect(res.body.data.classes).toHaveLength(1);

    const cls = res.body.data.classes[0];
    expect(cls.className).toBe('Year 7');
    expect(cls.roster).toBe(18);
    expect(cls.present).toBe(17);
    expect(cls.rate).toBe(94); // round(17/18*100)

    const streamA = cls.streams.find(s => s.streamName === 'A');
    expect(streamA).toMatchObject({ roster: 10, present: 9, absent: 1, unmarked: 0, rate: 90 });

    const streamB = cls.streams.find(s => s.streamName === 'B');
    expect(streamB).toMatchObject({ roster: 8, present: 8, unmarked: 0, rate: 100 });

    expect(res.body.data.schoolWide).toMatchObject({ roster: 18, present: 17, rate: 94 });
  });

  test('a student with no attendance record at all for the date counts as unmarked, not absent', async () => {
    mockStudentsRoster = [{ _id: { classId: 'cls_1', streamId: 'str_1' }, roster: 5 }];
    mockAttendanceDay = [{ _id: { classId: 'cls_1', streamId: 'str_1', status: 'present' }, count: 3 }];

    const res = await supertest(buildApp({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] }))
      .get('/api/attendance/school-report');

    const stream = res.body.data.classes[0].streams.find(s => s.streamId === 'str_1');
    expect(stream.unmarked).toBe(2);
  });

  test('rejects a malformed date', async () => {
    const res = await supertest(buildApp({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] }))
      .get('/api/attendance/school-report?date=not-a-date');
    expect(res.status).toBe(400);
  });
});
