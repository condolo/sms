/* ============================================================
   server/routes/grades.js — write-side scope enforcement

   Scope (scopeMiddleware/scopeEngine) was previously only ever checked
   on the GET list route. POST /, POST /bulk, PUT /:id and DELETE /:id
   had zero scope check at all — an 'assigned'-scope account (a teacher,
   or any custom role scoped the same way) could write a grade against
   ANY classId in the school, not just their own assigned classes,
   because nothing on the write path ever consulted scope. These tests
   exercise the real scopeMiddleware + ScopeEngine.isClassInScope (not
   mocked) against a real teaching_assignments fixture, same discipline
   as medical-alerts.test.js.

   No live UI currently calls these write routes (the client only
   consumes GET /grades/report) — this closes the gap defensively
   regardless, so it can't reopen the moment something does write
   through it.

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
    findOneAndUpdate: jest.fn((filter) => { const d = docs.find(x => mockMatchesFilter(x, filter)); return mockChainObj(d ? { ...d } : null); }),
    findOneAndDelete: jest.fn((filter) => Promise.resolve(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    create:           jest.fn((doc) => Promise.resolve({ ...doc, toObject: () => doc })),
    countDocuments:   jest.fn(() => Promise.resolve(0)),
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

let mockGrades, mockTeachingAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    if (c === 'academic_config') return { findOne: jest.fn(() => mockChainObj(null)) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'grades') return mockGrades;
    return mockMakeFakeCollection([]); // mark_audit_log etc.
  },
}));

const express   = require('express');
const supertest = require('supertest');
const gradesRouter = require('../../routes/grades');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/grades', gradesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockGrades = mockMakeFakeCollection([
    { id: 'grd_1', schoolId: SCHOOL_A, studentId: 'stu_1', subjectId: 'sub_1', classId: 'cls_1', score: 80, maxScore: 100 },
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

describe('POST /api/grades — write-side scope', () => {
  test('a teacher assigned to the class can create a grade for it', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/grades').send({
      studentId: 'stu_2', subjectId: 'sub_1', classId: 'cls_1', score: 5, maxScore: 10,
    });
    expect(res.status).toBe(201);
  });

  test('a teacher NOT assigned to the class is forbidden — the actual bug this closes', async () => {
    asTeacherOf('cls_1'); // assigned to cls_1 only
    const res = await supertest(buildApp()).post('/api/grades').send({
      studentId: 'stu_2', subjectId: 'sub_1', classId: 'cls_9', score: 5, maxScore: 10, // writing to an unassigned class
    });
    expect(res.status).toBe(403);
  });

  test('classId is optional on this schema — a request that omits it is not scope-blocked', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/grades').send({
      studentId: 'stu_2', subjectId: 'sub_1', score: 5, maxScore: 10, // no classId at all
    });
    expect(res.status).toBe(201);
  });

  test('admin (school-level scope) can write to any class', async () => {
    const res = await supertest(buildApp()).post('/api/grades').send({
      studentId: 'stu_2', subjectId: 'sub_1', classId: 'cls_anything', score: 5, maxScore: 10,
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/grades/bulk — write-side scope', () => {
  test('one out-of-scope classId in the batch forbids the whole batch', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/grades/bulk').send({
      grades: [
        { studentId: 'stu_2', subjectId: 'sub_1', classId: 'cls_1', score: 5, maxScore: 10 },
        { studentId: 'stu_3', subjectId: 'sub_1', classId: 'cls_9', score: 5, maxScore: 10 },
      ],
    });
    expect(res.status).toBe(403);
  });

  test('a batch entirely within scope succeeds', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).post('/api/grades/bulk').send({
      grades: [{ studentId: 'stu_2', subjectId: 'sub_1', classId: 'cls_1', score: 5, maxScore: 10 }],
    });
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/grades/:id — write-side scope', () => {
  test('a teacher not assigned to the EXISTING record\'s class is forbidden, even if the body omits classId', async () => {
    asTeacherOf('cls_9'); // grd_1 is on cls_1 — not this teacher's class
    const res = await supertest(buildApp()).put('/api/grades/grd_1').send({ score: 90 });
    expect(res.status).toBe(403);
  });

  test('a teacher cannot reassign an in-scope record onto an out-of-scope class', async () => {
    asTeacherOf('cls_1'); // owns the existing record's class...
    const res = await supertest(buildApp()).put('/api/grades/grd_1').send({ classId: 'cls_9' }); // ...but not the target
    expect(res.status).toBe(403);
  });

  test('a teacher assigned to the class can update the record', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).put('/api/grades/grd_1').send({ score: 90 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/grades/:id — write-side scope', () => {
  test('a teacher not assigned to the record\'s class cannot delete it', async () => {
    asTeacherOf('cls_9');
    const res = await supertest(buildApp()).delete('/api/grades/grd_1');
    expect(res.status).toBe(403);
  });

  test('a teacher assigned to the class can delete the record', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).delete('/api/grades/grd_1');
    expect(res.status).toBe(200);
  });

  test('admin (school-level scope) can delete any record', async () => {
    const res = await supertest(buildApp()).delete('/api/grades/grd_1');
    expect(res.status).toBe(200);
  });
});
