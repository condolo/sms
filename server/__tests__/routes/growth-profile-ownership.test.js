/* ============================================================
   GET /api/growth-profile/:studentId(/academic|/behaviour) —
   ownership scoping for parent/student self-service roles.

   Previously, these three routes gated only on the coarse
   growth_profile:read module permission — a parent or student role
   with that grant could request ANY studentId in the school and get
   it back, not just their own child / themselves (an IDOR). Staff
   roles (teacher, admin, etc.) are deliberately left unrestricted here
   — this app's convention elsewhere is that staff access is bounded by
   RBAC, not hard-coded to "my own class only"; only parent/student
   self-service scoping was actually missing and is what this fix (and
   this test) covers.

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
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockMakeCollection(docs = []) {
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) ?? null)),
    countDocuments: jest.fn(() => Promise.resolve(0)),
    aggregate:      jest.fn(() => Promise.resolve([])),
  };
}
function mockStudentOwn()   { return { id: 'stu_own',   schoolId: SCHOOL_A, firstName: 'Own',   lastName: 'Kid' }; }
function mockStudentOther() { return { id: 'stu_other', schoolId: SCHOOL_A, firstName: 'Other', lastName: 'Kid' }; }

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'students') return mockMakeCollection([mockStudentOwn(), mockStudentOther()]);
    return mockMakeCollection([]);
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const growthProfileRouter = require('../../routes/growth-profile');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-profile', growthProfileRouter);
  return app;
}

beforeEach(() => { jest.clearAllMocks(); });

describe.each([
  ['/:studentId',           id => `/api/growth-profile/${id}`],
  ['/:studentId/academic',  id => `/api/growth-profile/${id}/academic`],
  ['/:studentId/behaviour', id => `/api/growth-profile/${id}/behaviour`],
])('%s', (_label, urlFor) => {
  test('a student viewing their own profile succeeds', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get(urlFor('stu_own'));
    expect(res.status).toBe(200);
  });

  test('a student viewing another student\'s profile is forbidden', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get(urlFor('stu_other'));
    expect(res.status).toBe(403);
  });

  test('a parent viewing their own child (via studentIds) succeeds', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get(urlFor('stu_own'));
    expect(res.status).toBe(200);
  });

  test('a parent viewing their own child (via guardianOf only) succeeds', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'parent', studentIds: [], guardianOf: ['stu_own'] };
    const res = await supertest(buildApp()).get(urlFor('stu_own'));
    expect(res.status).toBe(200);
  });

  test('a parent viewing a child not their own is forbidden — the IDOR this fix closes', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get(urlFor('stu_other'));
    expect(res.status).toBe(403);
  });

  test('a teacher (staff role) can view any student — unrestricted by design, not part of this fix', async () => {
    mockJwtUser = { userId: 'usr_3', schoolId: SCHOOL_A, role: 'teacher' };
    const resOwn   = await supertest(buildApp()).get(urlFor('stu_own'));
    const resOther = await supertest(buildApp()).get(urlFor('stu_other'));
    expect(resOwn.status).toBe(200);
    expect(resOther.status).toBe(200);
  });

  test('404 (not 403) for a student that does not exist at this school, regardless of role', async () => {
    mockJwtUser = { userId: 'usr_3', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get(urlFor('stu_missing'));
    expect(res.status).toBe(404);
  });
});
