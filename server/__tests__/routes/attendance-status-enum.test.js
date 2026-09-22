/* ============================================================
   server/routes/attendance.js — status enum contract.

   AttendancePage.jsx's "Excused" button sent status: 'excused' to
   POST /api/attendance and POST /api/attendance/bulk, but neither
   route's Zod schema ever accepted that value — only 'authorised_absence'
   (the value every server-side aggregation, growth-profile.js, and
   weekly-snapshot-aggregate.js already use). Zod validation rejects the
   WHOLE request on any invalid record, so marking a single student
   "Excused" in an otherwise-fully-marked register failed the entire
   batch save with a 400 — losing every other student's marks too, not
   just the excused one. Fixed by renaming the client's value (display
   label "Excused" unchanged); this test pins the real wire contract so
   client and server can't drift apart on it again.

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
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:             jest.fn(() => mockChainArr(docs)),
    findOne:          jest.fn(() => mockChainObj(docs[0] || null)),
    findOneAndUpdate: jest.fn((filter, update, opts) => {
      if (opts?.upsert) return mockChainObj({ id: 'att_new', ...filter, ...update });
      return mockChainObj(null);
    }),
    findOneAndDelete: jest.fn(() => Promise.resolve(null)),
    bulkWrite:        jest.fn(() => Promise.resolve({ upsertedCount: 1, modifiedCount: 0 })),
  };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({
  scopeMiddleware: (req, _res, next) => { req.scope = null; next(); },
  invalidateScopeCache: jest.fn(),
}));

let mockAttendance;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => (c === 'attendance' ? mockAttendance : { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => (collection === 'attendance' ? mockAttendance : mockMakeFakeCollection([])),
}));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAttendance = mockMakeFakeCollection([]);
});

describe('POST /api/attendance/bulk — status enum', () => {
  test('accepts "authorised_absence" — the real wire value for Excused', async () => {
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_1', date: '2026-05-02',
      records: [{ studentId: 'stu_1', status: 'authorised_absence' }],
    });
    expect(res.status).toBe(201);
  });

  test('rejects "excused" — the bug: this is not, and never was, a valid status', async () => {
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_1', date: '2026-05-02',
      records: [{ studentId: 'stu_1', status: 'excused' }],
    });
    expect(res.status).toBe(422);
  });

  test('one invalid status fails the WHOLE batch — not just that student (why this bug was severe)', async () => {
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_1', date: '2026-05-02',
      records: [
        { studentId: 'stu_1', status: 'present' },
        { studentId: 'stu_2', status: 'present' },
        { studentId: 'stu_3', status: 'excused' },
      ],
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/attendance — status enum', () => {
  test('accepts "authorised_absence"', async () => {
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: 'stu_1', classId: 'cls_1', date: '2026-05-02', status: 'authorised_absence',
    });
    expect(res.status).toBe(201);
  });

  test('rejects "excused"', async () => {
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: 'stu_1', classId: 'cls_1', date: '2026-05-02', status: 'excused',
    });
    expect(res.status).toBe(422);
  });
});
