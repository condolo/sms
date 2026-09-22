/* ============================================================
   server/routes/classes.js — GET / ?attendanceScope=true (2026-09)

   Reported directly: an Exams Officer who is ALSO a homeroom teacher
   for one stream saw EVERY class in the Attendance picker — because
   exams_officer is 'school'-level scope (ROLE_SCOPE_LEVEL), correctly
   unrestricted for THEIR OWN module (Exams), but that same blanket
   status was being inherited by Attendance, which has nothing to do
   with exam administration and everything to do with real teaching/
   homeroom duty.

   `?attendanceScope=true` is a SEPARATE, deliberately narrower flag
   from the existing `?assignedOnly=true` (covered by
   classes-assigned-only.test.js, and left completely unchanged — Exams/
   Growth Profile's use of assignedOnly must keep treating exams_officer
   etc. as unrestricted, since that's correct for THEIR domain). This
   file's whole point is proving the two flags diverge for exactly the
   roles this bug was about.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as classes-assigned-only.test.js.

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
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    aggregate:      jest.fn(() => Promise.resolve([])),
  };
}

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockHomeroomTeacherRecord;
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve(mockHomeroomTeacherRecord)),
}));

let mockClasses, mockTeachingAssignments, mockStreams;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes') return mockClasses;
    if (collection === 'streams') return mockStreams;
    return mockMakeFakeCollection([]); // students enrichment
  },
}));

const express     = require('express');
const supertest   = require('supertest');
const classesRouter = require('../../routes/classes');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_exams_officer', schoolId: SCHOOL_A, role: 'exams_officer', roles: ['exams_officer'] };
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_1', schoolId: SCHOOL_A, name: 'Year 4', status: 'active' },
    { id: 'cls_2', schoolId: SCHOOL_A, name: 'Year 7', status: 'active' },
  ]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockStreams = mockMakeFakeCollection([]);
  mockHomeroomTeacherRecord = null;
  invalidateScopeCache('usr_exams_officer', SCHOOL_A);
  invalidateScopeCache('usr_admin', SCHOOL_A);
});

describe('exams_officer — the exact reported scenario', () => {
  test('WITHOUT any assignments, exams_officer is unrestricted for assignedOnly (Exams\' own picker) — correct, unchanged', async () => {
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('the SAME exams_officer, with no real class assignment, is narrowed to nothing for attendanceScope', async () => {
    const res = await supertest(buildApp()).get('/api/classes?attendanceScope=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.noAssignments).toBe(true);
  });

  test('an exams_officer who IS a homeroom teacher for one stream sees only that stream\'s parent class via attendanceScope', async () => {
    mockHomeroomTeacherRecord = { id: 'tch_1', userId: 'usr_exams_officer' };
    mockStreams = mockMakeFakeCollection([
      { id: 'str_7a', schoolId: SCHOOL_A, classId: 'cls_2', formTeacherId: 'tch_1' },
    ]);
    const res = await supertest(buildApp()).get('/api/classes?attendanceScope=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id)).toEqual(['cls_2']);
  });

  test('the same account still sees BOTH classes for assignedOnly (Exams) even while homeroom-scoped for attendanceScope', async () => {
    mockHomeroomTeacherRecord = { id: 'tch_1', userId: 'usr_exams_officer' };
    mockStreams = mockMakeFakeCollection([
      { id: 'str_7a', schoolId: SCHOOL_A, classId: 'cls_2', formTeacherId: 'tch_1' },
    ]);
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });
});

describe('every "school-level-for-its-own-module" role is narrowed for attendanceScope', () => {
  test.each(['admissions_officer', 'finance', 'hr', 'timetabler', 'discipline_committee'])(
    '%s with no attendance-relevant assignment sees nothing via attendanceScope',
    async (role) => {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/classes?attendanceScope=true');
      expect(res.body.data).toEqual([]);
    }
  );
});

describe('the genuine Attendance floor stays fully unrestricted', () => {
  test.each(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy'])(
    '%s sees every class via attendanceScope, with no assignments at all',
    async (role) => {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/classes?attendanceScope=true');
      expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
    }
  );
});

describe('a genuine teacher is narrowed identically under both flags', () => {
  test('a plain teacher assigned to one class sees only that class for attendanceScope', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_1' },
    ]);
    const res = await supertest(buildApp()).get('/api/classes?attendanceScope=true');
    expect(res.body.data.map(c => c.id)).toEqual(['cls_1']);
  });
});
