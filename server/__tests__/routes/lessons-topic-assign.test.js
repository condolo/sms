/* ============================================================
   POST /api/lessons/topics/assign-class — leadership gives class-less
   topics their class. Only topics with no class are changed; every
   assignment is audited; teachers are refused.
   ============================================================ */
'use strict';

function mockMakeTopics(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const byId = (filter) => docs.find(d => d.id === filter.id && (!filter.classId || d.classId === filter.classId));
  return {
    docs,
    findOne: (filter) => ({
      select: () => ({ lean: () => Promise.resolve(docs.find(d => d.id === filter.id) ?? null) }),
      lean:   () => Promise.resolve(docs.find(d => d.id === filter.id) ?? null),
    }),
    updateOne: jest.fn(async (filter, update) => {
      const d = docs.find(x => x.id === filter.id);
      const legacy = !d?.classId;
      if (!d || !legacy) return { modifiedCount: 0 };
      Object.assign(d, update.$set);
      return { modifiedCount: 1 };
    }),
    deleteMany: jest.fn(),
  };
}

function mockMakeClasses(seed = []) {
  return {
    find: () => ({ select: () => ({ lean: () => Promise.resolve(seed) }) }),
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
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => mockStores[col] || { findOne: () => ({ lean: () => Promise.resolve(null) }) }),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

const express = require('express');
const supertest = require('supertest');
const AuditService = require('../../services/audit');
const lessonsRouter = require('../../routes/lessons');

const SCHOOL = 'sch_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lessons', lessonsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'principal', roles: ['principal'] };
  mockStores = {
    syllabus_topics: mockMakeTopics([
      { id: 't_legacy', schoolId: SCHOOL, title: 'Electricity', subjectId: 'sub_phy', subjectName: 'Physics' },
      { id: 't_assigned', schoolId: SCHOOL, title: 'Plants', subjectId: 'sub_sci', classId: 'cls_y5' },
    ]),
    classes: mockMakeClasses([{ id: 'cls_y6', name: 'Year 6' }]),
  };
});

describe('POST /api/lessons/topics/assign-class', () => {
  test('a class-less topic is given the class chosen, and the change is audited', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics/assign-class')
      .send({ assignments: [{ topicId: 't_legacy', classId: 'cls_y6' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ assigned: 1, skipped: [] });
    expect(mockStores.syllabus_topics.docs.find(d => d.id === 't_legacy').classId).toBe('cls_y6');
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'lessons.topic.assign_class' }));
  });

  test('a topic that already has a class is never overwritten', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics/assign-class')
      .send({ assignments: [{ topicId: 't_assigned', classId: 'cls_y6' }] });
    expect(res.body.data.assigned).toBe(0);
    expect(res.body.data.skipped).toEqual([{ topicId: 't_assigned', reason: 'already has a class' }]);
    expect(mockStores.syllabus_topics.docs.find(d => d.id === 't_assigned').classId).toBe('cls_y5');
  });

  test('a super admin can assign the class of a legacy topic', async () => {
    mockCurrentUser = { userId: 'usr_super', schoolId: SCHOOL, role: 'superadmin', roles: ['superadmin'] };
    const res = await supertest(buildApp()).post('/api/lessons/topics/assign-class')
      .send({ assignments: [{ topicId: 't_legacy', classId: 'cls_y6' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.assigned).toBe(1);
    expect(mockStores.syllabus_topics.docs.find(d => d.id === 't_legacy').classId).toBe('cls_y6');
  });

  test('a class that is not in this school is refused and nothing is written', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics/assign-class')
      .send({ assignments: [{ topicId: 't_legacy', classId: 'cls_other_school' }] });
    expect(res.status).toBe(422);
    expect(mockStores.syllabus_topics.updateOne).not.toHaveBeenCalled();
  });

  test('a teacher is refused', async () => {
    mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).post('/api/lessons/topics/assign-class')
      .send({ assignments: [{ topicId: 't_legacy', classId: 'cls_y6' }] });
    expect(res.status).toBe(403);
    expect(mockStores.syllabus_topics.updateOne).not.toHaveBeenCalled();
  });
});
