/* ============================================================
   server/routes/timetable.js PUT /substitutions/:id — substitute
   teacher lookup

   GET /available-teachers (the dropdown a cover-sheet substitute is
   picked from) deliberately returns each candidate's userId as `id`,
   specifically so it matches timetable_slots' own teacherId format
   (its own code comment says so). But PUT /substitutions/:id's own
   lookup of that same id only matched the teachers collection's
   literal `id` FIELD (the staff record's own id — a different value
   from userId) — so it never found the teacher, silently fell back to
   storing the raw id string as the "name", and printed exactly that
   ("u_demo_t6") on the cover sheet instead of a real name. Reported
   directly against a live cover-sheet printout.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatchesFilter(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatchesFilter(d, filter));
      if (!doc) return mockChainObj(null);
      Object.assign(doc, update.$set ?? update);
      return mockChainObj(doc);
    }),
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

// A candidate returned by GET /available-teachers would carry userId as
// its `id` — the staff record's OWN id (a different value) is what the
// buggy lookup used to search by mistake.
const SUBSTITUTE_TEACHER = {
  id: 'tch_demo_6', userId: 'u_demo_t6', schoolId: SCHOOL_A,
  title: 'Mr', firstName: 'Robert', lastName: 'Kioko',
};

let mockSubstitutions, mockTeachers;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'substitutions') return mockSubstitutions;
    if (collection === 'teachers')      return mockTeachers;
    return mockMakeFakeCollection([]);
  },
}));

const express = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetableRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTeachers = mockMakeFakeCollection([SUBSTITUTE_TEACHER]);
  mockSubstitutions = mockMakeFakeCollection([
    { id: 'sub_1', schoolId: SCHOOL_A, originalTeacherId: 'u_demo_other', status: 'uncovered', substituteTeacherId: null, substituteTeacherName: null },
  ]);
});

test('assigning a substitute by userId (what the dropdown actually sends) resolves the real name, not the raw id', async () => {
  const res = await supertest(buildApp())
    .put('/api/timetable/substitutions/sub_1')
    .send({ substituteTeacherId: 'u_demo_t6' });

  expect(res.status).toBe(200);
  expect(res.body.data.substituteTeacherName).toBe('Mr Robert Kioko');
  expect(res.body.data.substituteTeacherName).not.toBe('u_demo_t6');
  expect(res.body.data.status).toBe('covered');
});

test('assigning by the staff record\'s own id still works (no regression on the other identifier form)', async () => {
  const res = await supertest(buildApp())
    .put('/api/timetable/substitutions/sub_1')
    .send({ substituteTeacherId: 'tch_demo_6' });

  expect(res.status).toBe(200);
  expect(res.body.data.substituteTeacherName).toBe('Mr Robert Kioko');
});

test('an id matching no teacher at all still falls back to the raw id (documented, not silently blank)', async () => {
  const res = await supertest(buildApp())
    .put('/api/timetable/substitutions/sub_1')
    .send({ substituteTeacherId: 'u_does_not_exist' });

  expect(res.status).toBe(200);
  expect(res.body.data.substituteTeacherName).toBe('u_does_not_exist');
});

test('clearing the substitute (null) resets both id and name, and status back to uncovered', async () => {
  mockSubstitutions = mockMakeFakeCollection([
    { id: 'sub_2', schoolId: SCHOOL_A, substituteTeacherId: 'u_demo_t6', substituteTeacherName: 'Mr Robert Kioko', status: 'covered' },
  ]);
  const res = await supertest(buildApp())
    .put('/api/timetable/substitutions/sub_2')
    .send({ substituteTeacherId: null });

  expect(res.status).toBe(200);
  expect(res.body.data.substituteTeacherId).toBeNull();
  expect(res.body.data.substituteTeacherName).toBeNull();
  expect(res.body.data.status).toBe('uncovered');
});
