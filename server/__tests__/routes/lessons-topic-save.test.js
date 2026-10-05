/* ============================================================
   POST /api/lessons/topics — what a teacher's save must accept.

   A whole-class assignment (an elective, or a class with no streams) comes
   back from GET /my-classes with streamId: null. The topic form sends that
   value back unchanged, so the save must accept null as "no stream". A
   rejected save must say which field was wrong, not only "Validation failed".
   ============================================================ */
'use strict';

function mockMakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    find:    () => ({ lean: () => Promise.resolve(docs), select: () => ({ lean: () => Promise.resolve(docs) }) }),
    findOne: () => ({ lean: () => Promise.resolve(docs[0] || null), select: () => ({ lean: () => Promise.resolve(docs[0] || null) }) }),
    create:  jest.fn(async (doc) => { docs.push({ ...doc }); return { ...doc, toObject: () => ({ ...doc }) }; }),
  };
}

let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: () => false }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col] || mockMakeCollection([])) }));

const express = require('express');
const supertest = require('supertest');
const lessonsRouter = require('../../routes/lessons');

const SCHOOL = 'sch_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lessons', lessonsRouter);
  return app;
}

const base = {
  classId: 'cls_y6',
  subjectId: 'sub_coding',
  subjectName: 'Coding',
  academicYear: '2026-2027',
  title: 'Algorithms',
  description: '',
  subtopics: [{ title: 'Loops', order: 0 }],
};

beforeEach(() => {
  mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockStores = {
    syllabus_topics: mockMakeCollection([]),
    subjects: mockMakeCollection([{ id: 'sub_coding', schoolId: SCHOOL, name: 'Coding' }]),
  };
});

describe('POST /api/lessons/topics', () => {
  test('a whole-class assignment (streamId: null) saves with no stream', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics').send({ ...base, streamId: null });
    expect(res.status).toBe(201);
    expect(res.body.data.classId).toBe('cls_y6');
  });

  test('a stream assignment (streamId set) saves', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics').send({ ...base, streamId: 'str_sapphire' });
    expect(res.status).toBe(201);
  });

  test('a rejected save names the field that was wrong', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics').send({ ...base, title: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.issues.map(i => i.field)).toContain('title');
  });
});
