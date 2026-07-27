/* ============================================================
   server/routes/exams.js — POST/PUT subjectId/classId FK validation

   subjectId/classId on ExamSchema are free-text strings (no Mongoose
   ref) — before this fix, a typo'd or stale id would silently create
   an exam that never matches any aggregateExamResults()/report-cards.js
   filter downstream, with no error surfaced at write time. This test
   proves the new _checkExamFKs() guard rejects unknown ids and accepts
   real ones.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockCurrentUser = { userId: 'usr_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] };
let mockSubjects;
let mockClasses;
const mockExamCreate = jest.fn(async (doc) => ({ ...doc }));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'subjects') return { findOne: (f) => mockChain(mockSubjects.find(s => s.id === f.id) || null) };
    if (col === 'classes')  return { findOne: (f) => mockChain(mockClasses.find(c => c.id === f.id) || null) };
    if (col === 'exams')    return { create: mockExamCreate, findOne: () => mockChain(null) };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

const express      = require('express');
const supertest    = require('supertest');
const examsRouter  = require('../../routes/exams');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] };
  mockSubjects = [{ id: 'sub_math', schoolId: 'sch_1' }];
  mockClasses  = [{ id: 'cls_1', schoolId: 'sch_1' }];
});

describe('POST /api/exams — subjectId/classId FK validation', () => {
  test('unknown subjectId → 400, no exam created', async () => {
    const res = await supertest(buildApp())
      .post('/api/exams')
      .send({ title: 'Mid-Term', subjectId: 'sub_typo', classId: 'cls_1', maxScore: 100 });
    expect(res.status).toBe(400);
    expect(mockExamCreate).not.toHaveBeenCalled();
  });

  test('unknown classId → 400, no exam created', async () => {
    const res = await supertest(buildApp())
      .post('/api/exams')
      .send({ title: 'Mid-Term', subjectId: 'sub_math', classId: 'cls_typo', maxScore: 100 });
    expect(res.status).toBe(400);
    expect(mockExamCreate).not.toHaveBeenCalled();
  });

  test('real subjectId + classId → 201, exam created', async () => {
    const res = await supertest(buildApp())
      .post('/api/exams')
      .send({ title: 'Mid-Term', subjectId: 'sub_math', classId: 'cls_1', maxScore: 100 });
    expect(res.status).toBe(201);
    expect(mockExamCreate).toHaveBeenCalledTimes(1);
  });

  test('subjectId/classId omitted entirely → still allowed (fields are optional)', async () => {
    const res = await supertest(buildApp())
      .post('/api/exams')
      .send({ title: 'Mid-Term', maxScore: 100 });
    expect(res.status).toBe(201);
    expect(mockExamCreate).toHaveBeenCalledTimes(1);
  });
});
