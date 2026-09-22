/* ============================================================
   GET /api/growth-profile/:studentId(/academic|/behaviour) —
   teacher-scope enforcement (Priority 0, 2026-09).

   Previously these three routes had ZERO class/stream scoping for
   staff roles — any teacher with the (role-default-granted)
   growth_profile:read permission could fetch ANY student's Growth
   Profile by studentId directly, including students in classes they
   don't teach. MODULE_SCOPE already registered 'growth_profile' as a
   classId/stream-aware module (scopeEngine.js) — these routes simply
   never called ScopeEngine.isClassInScope. This is the real, live
   scopeMiddleware (not mocked) so the actual teaching_assignments-
   driven scope resolution is what's under test — only the DB
   accessors it reads are mocked.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

const STUDENT_IN_CLASS_A = { id: 'stu_a', schoolId: SCHOOL_A, firstName: 'A', lastName: 'Student', classId: 'cls_A', streamId: null };
const STUDENT_IN_CLASS_B = { id: 'stu_b', schoolId: SCHOOL_A, firstName: 'B', lastName: 'Student', classId: 'cls_B', streamId: null };
const STUDENT_IN_STREAM  = { id: 'stu_a', schoolId: SCHOOL_A, firstName: 'A', lastName: 'Student', classId: 'cls_A', streamId: 'str_A1' };

let mockJwtUser;
let mockTeachingAssignments;
let mockStudentsById; // { [studentId]: studentDoc }

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

// scopeMiddleware (real, unmocked) reads via the raw _model, not tenantModel.
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    const c = (arr) => { const x = { sort: () => x, skip: () => x, limit: () => x, select: () => x, lean: () => Promise.resolve(arr) }; return x; };
    const one = (obj) => { const x = { select: () => x, lean: () => Promise.resolve(obj) }; return x; };
    if (collection === 'teaching_assignments') return { find: () => c(mockTeachingAssignments) };
    return { find: () => c([]), findOne: () => one(null), countDocuments: () => Promise.resolve(0) };
  }),
}));

// growth-profile.js's own route body reads via tenantModel.
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    const c = (arr) => { const x = { sort: () => x, skip: () => x, limit: () => x, select: () => x, lean: () => Promise.resolve(arr) }; return x; };
    const one = (obj) => { const x = { select: () => x, lean: () => Promise.resolve(obj) }; return x; };
    if (collection === 'students') {
      return { findOne: (filter) => one(mockStudentsById[filter.id] ?? null) };
    }
    return { find: () => c([]), findOne: () => one(null), aggregate: () => Promise.resolve([]), countDocuments: () => Promise.resolve(0) };
  },
}));

const express   = require('express');
const supertest = require('supertest');
const growthProfileRouter = require('../../routes/growth-profile');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-profile', growthProfileRouter);
  return app;
}

beforeEach(() => {
  invalidateScopeCache('usr_teacher', SCHOOL_A);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  mockTeachingAssignments = [];
  mockStudentsById = { stu_a: STUDENT_IN_CLASS_A, stu_b: STUDENT_IN_CLASS_B };
});

describe.each([
  ['/:studentId',           id => `/api/growth-profile/${id}`],
  ['/:studentId/academic',  id => `/api/growth-profile/${id}/academic`],
  ['/:studentId/behaviour', id => `/api/growth-profile/${id}/behaviour`],
])('%s — teacher scope', (_label, urlFor) => {
  test('a teacher assigned to the student\'s class can view their profile', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = [{ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_A', subjectId: 'sub_math' }];
    const res = await supertest(buildApp()).get(urlFor('stu_a'));
    expect(res.status).toBe(200);
  });

  test('a teacher NOT assigned to the student\'s class is forbidden — the actual bug this closes', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = [{ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_A', subjectId: 'sub_math' }];
    const res = await supertest(buildApp()).get(urlFor('stu_b'));
    expect(res.status).toBe(403);
  });

  test('a teacher with zero teaching assignments at all is forbidden for any real class', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = [];
    const res = await supertest(buildApp()).get(urlFor('stu_a'));
    expect(res.status).toBe(403);
  });

  test('admin (school-level scope) can view any student regardless of assignments', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    const res = await supertest(buildApp()).get(urlFor('stu_b'));
    expect(res.status).toBe(200);
  });

  test('a stream-only assignment (compulsory subject, per-stream teacher) is honored', async () => {
    mockStudentsById = { stu_a: STUDENT_IN_STREAM };
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    // Stream-only row: has a streamId, so it does NOT contribute to classIds
    // (see scopeMiddleware.js's _loadAssigned) — only streamIds, which
    // isClassInScope's streamAware handling for growth_profile must match.
    mockTeachingAssignments = [{ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_A', streamId: 'str_A1', subjectId: 'sub_math' }];
    const res = await supertest(buildApp()).get(urlFor('stu_a'));
    expect(res.status).toBe(200);
  });
});
