/* ============================================================
   server/routes/growth-records.js POST /:type — streamId/classId
   denormalization (Milestone 2)

   growth_leadership/activities/service/awards never stored classId
   or streamId at all (RecordSchema has no such field, and the create
   call never added one) — so MODULE_SCOPE's existing 'growth_records'
   entry has had nothing to match against since it was added. This
   proves the new record now carries both, resolved from the
   referenced student, so future scope enforcement here is possible
   without a data migration. Deliberately does NOT add a new scope
   CHECK to this route — it has none today, a separate, pre-existing
   gap not introduced or closed by this change.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), skip: () => chain(result), limit: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    create:  async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs:   () => docs,
  };
}

const SCHOOL = 'school_A';
let mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher' };
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const express = require('express');
const supertest = require('supertest');
const growthRecordsRouter = require('../../routes/growth-records');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-records', growthRecordsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher' };
  mockStores = {
    growth_leadership: makeStore([]),
    students: makeStore([
      { id: 'stu_1', schoolId: SCHOOL, classId: 'cls_yr7', streamId: 'strm_7i' },
      { id: 'stu_2', schoolId: SCHOOL, classId: 'cls_yr7', streamId: null }, // no stream assigned
    ]),
  };
});

test('a new record is denormalized with the referenced student\'s classId and streamId', async () => {
  const res = await supertest(buildApp()).post('/api/growth-records/leadership')
    .send({ studentId: 'stu_1', title: 'Head Boy' });
  expect(res.status).toBe(201);
  expect(res.body.data.classId).toBe('cls_yr7');
  expect(res.body.data.streamId).toBe('strm_7i');
});

test('a student with no stream assigned gets streamId: null, not omitted or crashed', async () => {
  const res = await supertest(buildApp()).post('/api/growth-records/leadership')
    .send({ studentId: 'stu_2', title: 'Prefect' });
  expect(res.status).toBe(201);
  expect(res.body.data.classId).toBe('cls_yr7');
  expect(res.body.data.streamId).toBeNull();
});

test('a studentId that resolves to no student record still creates the record (null classId/streamId), not a hard failure', async () => {
  const res = await supertest(buildApp()).post('/api/growth-records/leadership')
    .send({ studentId: 'stu_does_not_exist', title: 'Something' });
  expect(res.status).toBe(201);
  expect(res.body.data.classId).toBeNull();
  expect(res.body.data.streamId).toBeNull();
});
