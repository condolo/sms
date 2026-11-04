/* ============================================================
   server/routes/attendance.js — a class register is filed once a day

   The bulk route used to be a plain upsert, so opening the same day again
   and tapping Save silently replaced the register the office had already
   read. The mobile app now locks the screen after the first filing; these
   tests prove the SERVER refuses a second one too, independently of any
   client, and that the deliberate office amendment (`amend: true`) still
   works.

   All DB calls are mocked — no MongoDB required. Same harness discipline
   as attendance-write-scope.test.js.
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

const FILED = {
  id: 'att_filed', schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'cls_1', date: '2026-05-04', status: 'present',
};

function postBulk(body) {
  return supertest(buildApp()).post('/api/attendance/bulk').send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockAttendance = mockMakeFakeCollection([FILED]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

describe('POST /api/attendance/bulk — once a day', () => {
  test('a second filing of the same class register is refused', async () => {
    const res = await postBulk({
      classId: 'cls_1', date: '2026-05-04',
      records: [{ studentId: 'stu_1', status: 'absent' }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/already filed/i);
    expect(mockAttendance.bulkWrite).not.toHaveBeenCalled();
  });

  test('the filed status is untouched — the refusal happens before any write', async () => {
    await postBulk({
      classId: 'cls_1', date: '2026-05-04',
      records: [{ studentId: 'stu_1', status: 'absent' }],
    });
    expect(mockAttendance.findOneAndUpdate).not.toHaveBeenCalled();
    expect(FILED.status).toBe('present');
  });

  test('a deliberate office amendment (amend: true) is allowed', async () => {
    const res = await postBulk({
      classId: 'cls_1', date: '2026-05-04', amend: true,
      records: [{ studentId: 'stu_1', status: 'absent' }],
    });
    expect(res.status).toBe(201);
    expect(mockAttendance.bulkWrite).toHaveBeenCalled();
  });

  test('a fresh day is not blocked by an older filed register', async () => {
    const res = await postBulk({
      classId: 'cls_1', date: '2026-05-05',
      records: [{ studentId: 'stu_1', status: 'present' }],
    });
    expect(res.status).toBe(201);
  });

  test('another stream\'s students are their own register, not a repeat', async () => {
    const res = await postBulk({
      classId: 'cls_1', date: '2026-05-04',
      records: [{ studentId: 'stu_2', status: 'present' }],
    });
    expect(res.status).toBe(201);
  });
});
