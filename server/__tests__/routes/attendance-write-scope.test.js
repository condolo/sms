/* ============================================================
   server/routes/attendance.js — write-side scope enforcement

   Companion to grades-write-scope.test.js. Scope was previously only
   ever checked on GET / and GET /summary — POST /, POST /bulk, PUT /:id
   and DELETE /:id had no scope check at all, and the classes dropdown
   feeding AttendancePage.jsx isn't scoped either (a separate, larger
   change deliberately not made here — see classes.js). So an
   'assigned'-scope account could mark attendance for any class in the
   school by picking it from that unscoped dropdown. These tests
   exercise the real scopeMiddleware + ScopeEngine.isClassInScope
   against a real teaching_assignments fixture — not mocked, same
   discipline as medical-alerts.test.js and grades-write-scope.test.js.

   attendance-tenant-isolation.test.js covers cross-SCHOOL isolation
   with scopeEngine mocked out; this file covers cross-CLASS scope
   within a single school, for real.

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
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter, update, opts) => {
      const existing = docs.find(d => mockMatchesFilter(d, filter));
      if (existing) return mockChainObj({ ...existing, ...update });
      if (opts?.upsert) return mockChainObj({ id: 'att_new', ...filter, ...update });
      return mockChainObj(null);
    }),
    findOneAndDelete: jest.fn((filter) => Promise.resolve(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    bulkWrite:        jest.fn(() => Promise.resolve({ upsertedCount: 1, modifiedCount: 0 })),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockAttendance, mockTeachingAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    if (c === 'attendance') return mockAttendance;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'attendance') return mockAttendance;
    return mockMakeFakeCollection([]);
  },
}));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockAttendance = mockMakeFakeCollection([
    { id: 'att_1', schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'cls_1', date: '2026-05-01', status: 'present' },
  ]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherOf(...classIds) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    classIds.map(classId => ({ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId }))
  );
}

describe('POST /api/attendance — write-side scope', () => {
  test('a teacher assigned to the class can mark attendance for it', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: 'stu_2', classId: 'cls_1', date: '2026-05-02', status: 'present',
    });
    expect(res.status).toBe(201);
  });

  test('a teacher NOT assigned to the class is forbidden — the actual bug this closes', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: 'stu_2', classId: 'cls_9', date: '2026-05-02', status: 'present',
    });
    expect(res.status).toBe(403);
  });

  test('admin (school-level scope) can mark attendance for any class', async () => {
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: 'stu_2', classId: 'cls_anything', date: '2026-05-02', status: 'present',
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/attendance/bulk — write-side scope', () => {
  test('marking a whole class the teacher is not assigned to is forbidden', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_9', date: '2026-05-02',
      records: [{ studentId: 'stu_2', status: 'present' }],
    });
    expect(res.status).toBe(403);
  });

  test('marking the teacher\'s own assigned class succeeds', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_1', date: '2026-05-02',
      records: [{ studentId: 'stu_2', status: 'present' }],
    });
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/attendance/:id — write-side scope', () => {
  test('a teacher not assigned to the record\'s class cannot edit it', async () => {
    asTeacherOf('cls_9'); // att_1 is on cls_1
    const res = await supertest(buildApp()).put('/api/attendance/att_1').send({ status: 'absent' });
    expect(res.status).toBe(403);
  });

  test('a teacher cannot move a record onto an out-of-scope class', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).put('/api/attendance/att_1').send({ classId: 'cls_9' });
    expect(res.status).toBe(403);
  });

  test('a teacher assigned to the class can edit the record', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).put('/api/attendance/att_1').send({ status: 'absent' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/attendance/:id — write-side scope', () => {
  test('a teacher not assigned to the record\'s class cannot delete it', async () => {
    asTeacherOf('cls_9');
    const res = await supertest(buildApp()).delete('/api/attendance/att_1');
    expect(res.status).toBe(403);
  });

  test('a teacher assigned to the class can delete the record', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).delete('/api/attendance/att_1');
    expect(res.status).toBe(200);
  });
});
