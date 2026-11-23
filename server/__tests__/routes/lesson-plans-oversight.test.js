/* ============================================================
   Lesson plans — oversight by Settings row (v5.279.0)

   Seeing or managing every teacher's lesson plans used to need a leadership
   role by name (admin, superadmin, principal, head_teacher). It now also
   follows "Manage All Lesson Plans" under Lessons, checked strictly:
     - a teacher still sees only their own plans;
     - a non-teaching role without the row is refused;
     - with View ticked it sees every plan, but cannot change another's;
     - with Edit ticked it can;
     - leadership roles are unchanged.
   ============================================================ */
'use strict';

let mockJwtUser;
let mockTicked = new Set();
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  hasExplicitSubGrant: async (_req, mod, sub, action) => mockTicked.has(`${mod}__${sub}:${action}`),
}));
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: async (userId) => (userId === 'u_t1' ? { id: 't1', firstName: 'Ann' } : null),
}));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));

const express = require('express');
const supertest = require('supertest');

const S = 'sch_1';
const api = (user) => {
  mockJwtUser = user;
  const a = express();
  a.use(express.json());
  a.use('/api/lesson-plans', require('../../routes/lesson-plans'));
  return supertest(a);
};
const TEACHER = { userId: 'u_t1', schoolId: S, role: 'teacher', roles: ['teacher'] };
const DEAN    = { userId: 'u_dean', schoolId: S, role: 'academic_dean', roles: ['academic_dean'] };
const PRINCIPAL = { userId: 'u_p', schoolId: S, role: 'principal', roles: ['principal'] };

beforeEach(() => {
  mockTicked = new Set();
  mockDb = createFakeDb({
    lesson_plans: [
      { id: 'p1', schoolId: S, teacherId: 't1', classId: 'c1', subjectId: 'm', date: '2026-11-20', topicTitle: 'Fractions', status: 'planned' },
      { id: 'p2', schoolId: S, teacherId: 't2', classId: 'c2', subjectId: 'e', date: '2026-11-21', topicTitle: 'Poems', status: 'planned' },
    ],
  });
});

test('a teacher still sees only their own plans', async () => {
  const res = await api(TEACHER).get('/api/lesson-plans');
  expect(res.status).toBe(200);
  expect(res.body.data.map(p => p.id)).toEqual(['p1']);
});

test('a non-teaching role without the row is refused', async () => {
  expect((await api(DEAN).get('/api/lesson-plans')).status).toBe(403);
});

test('View ticked: every plan, but not another teacher\'s to change', async () => {
  mockTicked = new Set(['lessons__plans_all:read']);
  const res = await api(DEAN).get('/api/lesson-plans');
  expect(res.status).toBe(200);
  expect(res.body.data.map(p => p.id).sort()).toEqual(['p1', 'p2']);
  expect((await api(DEAN).put('/api/lesson-plans/p2').send({ topicTitle: 'Changed' })).status).toBe(403);
});

test('Edit ticked: may change another teacher\'s plan', async () => {
  mockTicked = new Set(['lessons__plans_all:read', 'lessons__plans_all:update']);
  const res = await api(DEAN).put('/api/lesson-plans/p2').send({ topicTitle: 'Changed' });
  expect(res.status).toBe(200);
});

test('leadership roles are unchanged', async () => {
  const res = await api(PRINCIPAL).get('/api/lesson-plans');
  expect(res.status).toBe(200);
  expect(res.body.data).toHaveLength(2);
});
