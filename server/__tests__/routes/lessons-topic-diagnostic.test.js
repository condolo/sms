/* ============================================================
   GET /api/lessons/topics/diagnostic — admin-only, read-only.

   Lists every syllabus topic with the subject record, class and academic
   year it was saved under, so a topic that a class view does not show can
   be traced. It must never be visible to a teacher, and must never write.
   ============================================================ */
'use strict';

function mockMakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function chain(result) {
    return {
      lean: () => Promise.resolve(result),
      select: () => chain(result),
      sort: () => chain(result),
      limit: () => chain(result),
    };
  }
  return {
    find:    () => chain(docs),
    findOne: () => chain(docs[0] || null),
    create:  async (doc) => { docs.push({ ...doc }); return doc; },
    updateOne: jest.fn(async () => ({ modifiedCount: 0 })),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
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

beforeEach(() => {
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockStores = {
    syllabus_topics: mockMakeCollection([
      { id: 't1', schoolId: SCHOOL, title: 'Plants', subjectId: 'sub_sci_a', subjectName: 'Science', classId: 'cls_y6', academicYear: '2026-2027', createdAt: new Date('2026-10-03T08:00:00+03:00') },
      { id: 't2', schoolId: SCHOOL, title: 'Legacy', subjectId: 'sub_sci_b', subjectName: 'Science', academicYear: '2025-2026', createdAt: new Date('2025-09-01T08:00:00+03:00') },
    ]),
    subjects: mockMakeCollection([
      { id: 'sub_sci_a', schoolId: SCHOOL, name: 'Science', code: 'SCI' },
      { id: 'sub_sci_b', schoolId: SCHOOL, name: 'Science', code: 'SCI2' },
      { id: 'sub_eng',   schoolId: SCHOOL, name: 'English', code: 'ENG' },
    ]),
    classes: mockMakeCollection([{ id: 'cls_y6', schoolId: SCHOOL, name: 'Year 6', status: 'active' }]),
  };
});

describe('GET /api/lessons/topics/diagnostic', () => {
  test('admin sees every topic with the subject record, class and year it was saved under', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/topics/diagnostic');
    expect(res.status).toBe(200);
    const plants = res.body.data.topics.find(t => t.id === 't1');
    expect(plants).toMatchObject({ subjectId: 'sub_sci_a', subjectRecordName: 'Science', className: 'Year 6', academicYear: '2026-2027' });
    const legacy = res.body.data.topics.find(t => t.id === 't2');
    expect(legacy.className).toBe('(legacy: no class)');
  });

  test('the subject filter lists every matching subject record, so duplicates are visible', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/topics/diagnostic?subject=science');
    expect(res.body.data.subjects.map(s => s.id).sort()).toEqual(['sub_sci_a', 'sub_sci_b']);
  });

  test('a teacher is refused', async () => {
    mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/lessons/topics/diagnostic');
    expect(res.status).toBe(403);
  });

  test('the diagnostic never writes', async () => {
    const stores = mockStores;
    await supertest(buildApp()).get('/api/lessons/topics/diagnostic');
    expect(stores.syllabus_topics.updateOne).not.toHaveBeenCalled();
    expect(stores.syllabus_topics.deleteMany).not.toHaveBeenCalled();
  });
});
