/* ============================================================
   server/routes/students.js — PATCH /:id/deactivate + /:id/reactivate

   Raised directly: two students stuck at status='inactive' (set via
   StudentList.jsx's row action, DELETE /:id) had no way back — the
   Reactivate button on StudentProfile.jsx only ever checked for
   'withdrawn'/'graduated' (the two outcomes THIS route's own Deactivate
   button produces), never 'inactive'. This file proves the SERVER side
   was always correct (PATCH /:id/reactivate's only guard is `status ===
   'active'`, so it already accepted 'inactive') — the gap was purely
   the client-side visibility check, fixed separately in
   StudentProfile.jsx. It also proves the companion fix: PATCH
   /:id/deactivate's own "already deactivated" guard used to miss
   'inactive' and 'suspended', silently allowing a no-op re-deactivation
   instead of a clear 400.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'], email: 'admin@school-a.test' };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_q, _s, n) => n() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}

let mockStudentDoc;
const mockUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const mockStudents = {
  findOne:   jest.fn((filter) => mockChainObj(
    (filter.id === mockStudentDoc?.id || filter._id === mockStudentDoc?.id) ? mockStudentDoc : null,
  )),
  updateOne: mockUpdateOne,
};

jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: () => mockChainObj([]), findOne: () => mockChainObj(null) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'students') return mockStudents;
    return { find: () => mockChainObj([]), findOne: () => mockChainObj(null) };
  },
}));

const express   = require('express');
const supertest = require('supertest');
const studentsRouter = require('../../routes/students');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = { id: 'stu_1', _id: 'oid_stu_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active' };
});

describe('PATCH /api/students/:id/deactivate — the "already deactivated" guard', () => {
  test('succeeds on an active student', async () => {
    const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('withdrawn');
  });

  test('rejects a student already at status=inactive — the actual gap (was previously NOT blocked)', async () => {
    mockStudentDoc.status = 'inactive';
    const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
    expect(res.status).toBe(400);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('rejects a student already at status=suspended', async () => {
    mockStudentDoc.status = 'suspended';
    const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
    expect(res.status).toBe(400);
  });

  test('still rejects withdrawn/graduated/transferred exactly as before', async () => {
    for (const status of ['withdrawn', 'graduated', 'transferred']) {
      mockStudentDoc.status = status;
      const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
      expect(res.status).toBe(400);
    }
  });
});

describe('PATCH /api/students/:id/reactivate — already worked for every non-active status', () => {
  test('reactivates a student stuck at status=inactive', async () => {
    mockStudentDoc.status = 'inactive';
    const res = await supertest(buildApp()).patch('/api/students/stu_1/reactivate');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    const patch = mockUpdateOne.mock.calls[0][1].$set;
    expect(patch.status).toBe('active');
  });

  test('reactivates a withdrawn student too', async () => {
    mockStudentDoc.status = 'withdrawn';
    const res = await supertest(buildApp()).patch('/api/students/stu_1/reactivate');
    expect(res.status).toBe(200);
  });

  test('rejects an already-active student', async () => {
    const res = await supertest(buildApp()).patch('/api/students/stu_1/reactivate');
    expect(res.status).toBe(400);
  });

  test('unsets the deactivation metadata on reactivation', async () => {
    mockStudentDoc.status = 'inactive';
    await supertest(buildApp()).patch('/api/students/stu_1/reactivate');
    const update = mockUpdateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ deactivatedAt: '', deactivatedBy: '', deactivationReason: '', deactivationNotes: '' });
  });
});
