/* ============================================================
   growth-records.js / growth-projects.js / growth-recommendations.js —
   in-route staff guard on POST/PUT/DELETE (GROWTH_PROFILE_STAFF_ROLES).

   Why this exists: SettingsPage.jsx's Roles & Permissions grid unions
   every sub-checkbox under a module into ONE flat action array
   (_deriveApiPerms in settings.js) — so granting a self-service role
   like student ANY write sub-permission anywhere under growth_profile
   (e.g. editing their own aspirations) also satisfies the bare
   `rbac('growth_profile', 'update')` check these write routes use, with
   no subKey to distinguish "edit my own aspirations" from "edit any
   student's leadership record." These tests mock rbac() as an
   always-allow passthrough specifically so a 403 here can ONLY come
   from the in-route role guard, not from RBAC — isolating exactly the
   layer this fix added.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), skip: () => chain(result), limit: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        const doc = docs.find(d => matches(d, filter));
        if (!doc) return null;
        Object.assign(doc, update.$set ?? update);
        return { ...doc };
      },
    }),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
// Always-allow — isolates the in-route staff guard from RBAC entirely.
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const express   = require('express');
const supertest = require('supertest');
const growthRecordsRouter         = require('../../routes/growth-records');
const growthProjectsRouter        = require('../../routes/growth-projects');
const growthRecommendationsRouter = require('../../routes/growth-recommendations');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-records', growthRecordsRouter);
  app.use('/api/growth-projects', growthProjectsRouter);
  app.use('/api/growth-recommendations', growthRecommendationsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    growth_leadership:      makeStore([{ id: 'gl_1', schoolId: SCHOOL, studentId: 'stu_1', title: 'Head Boy' }]),
    growth_projects:        makeStore([{ id: 'gp_1', schoolId: SCHOOL, studentId: 'stu_1', title: 'Science Fair' }]),
    growth_recommendations: makeStore([]),
  };
});

describe.each([
  ['growth-records.js', () => supertest(buildApp()).post('/api/growth-records/leadership').send({ studentId: 'stu_2', title: 'New' })],
  ['growth-projects.js', () => supertest(buildApp()).post('/api/growth-projects').send({ studentId: 'stu_2', title: 'New' })],
])('%s POST — staff-only, independent of RBAC', (_label, doPost) => {
  test('a student role (even though RBAC itself would allow it) is rejected', async () => {
    mockCurrentUser = { userId: 'stu_2', schoolId: SCHOOL, role: 'student', studentId: 'stu_2' };
    const res = await doPost();
    expect(res.status).toBe(403);
  });

  test('a parent role is rejected', async () => {
    mockCurrentUser = { userId: 'usr_1', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_2'] };
    const res = await doPost();
    expect(res.status).toBe(403);
  });

  test('a teacher (legitimate staff) succeeds', async () => {
    mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher' };
    const res = await doPost();
    expect(res.status).toBe(201);
  });
});

describe.each([
  ['growth-records.js', () => supertest(buildApp()).put('/api/growth-records/leadership/gl_1').send({ title: 'Edited' })],
  ['growth-projects.js', () => supertest(buildApp()).put('/api/growth-projects/gp_1').send({ title: 'Edited' })],
])('%s PUT — staff-only, independent of RBAC', (_label, doPut) => {
  test('a student role is rejected, even for a record that is not even theirs', async () => {
    mockCurrentUser = { userId: 'stu_9', schoolId: SCHOOL, role: 'student', studentId: 'stu_9' };
    const res = await doPut();
    expect(res.status).toBe(403);
  });

  test('an admin succeeds', async () => {
    mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin' };
    const res = await doPut();
    expect(res.status).toBe(200);
  });
});

describe('growth-recommendations.js POST — staff-only (pre-existing check, now shares GROWTH_PROFILE_STAFF_ROLES)', () => {
  test('a student cannot write a recommendation', async () => {
    mockCurrentUser = { userId: 'stu_1', schoolId: SCHOOL, role: 'student', studentId: 'stu_1' };
    const res = await supertest(buildApp()).post('/api/growth-recommendations').send({ studentId: 'stu_1', content: 'I am a great student, trust me on this one.' });
    expect(res.status).toBe(403);
  });

  test('a teacher can write a recommendation', async () => {
    mockCurrentUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher' };
    const res = await supertest(buildApp()).post('/api/growth-recommendations').send({ studentId: 'stu_1', content: 'A genuinely excellent contributor to class discussions.' });
    expect(res.status).toBe(201);
  });
});
