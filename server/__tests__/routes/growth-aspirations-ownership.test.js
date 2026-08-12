/* ============================================================
   growth-recommendations.js — /aspirations/:studentId (GET + PUT)

   Covers: the ownership fix (forbiddenForSelfServiceRole — previously
   ABSENT on both routes, meaning any role with growth_profile:read/
   update could read or overwrite ANY student's aspirations by ID) and
   the subKey fix (rbac('growth_profile', <action>, 'aspirations') —
   previously a bare module-level check, meaning granting a student
   write access to their own aspirations would also have satisfied
   growth-records.js's/growth-projects.js's unrelated PUT routes; see
   growth-write-guard.test.js for that side of the fix).

   rbac() here is REAL (not mocked) so the subKey-fallback resolution
   itself is exercised, using an in-memory permissions store standing
   in for role_permissions.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockMakeCollection(docs = []) {
  return {
    findOne: jest.fn((filter) => chain(docs.find(d => mockMatches(d, filter)) ?? null)),
    findOneAndUpdate: jest.fn((filter, update) => ({
      lean: async () => {
        let doc = docs.find(d => mockMatches(d, filter));
        if (!doc) { doc = { ...filter }; docs.push(doc); }
        Object.assign(doc, update, update.$setOnInsert ?? {});
        delete doc.$setOnInsert;
        return { ...doc };
      },
    })),
  };
}

let mockJwtUser;
let mockRolePerms; // { [roleKey]: { [permKey]: string[] } }

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

// Real rbac.js, but with role_permissions/users backed by an in-memory store —
// exercises the actual subKey-fallback logic in _isAllowed(), not a stub.
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'role_permissions') {
      return {
        findOne: jest.fn(({ roleKey, userId }) => ({
          lean: async () => {
            if (userId) return null; // no per-user overrides in these tests
            const perms = mockRolePerms[roleKey];
            return perms ? { permissions: perms } : null;
          },
        })),
      };
    }
    if (col === 'students') return mockMakeCollection([mockStudentOwn(), mockStudentOther()]);
    if (col === 'growth_aspirations') return mockMakeCollection([
      { id: 'asp_1', schoolId: SCHOOL, studentId: 'stu_own', careerInterests: ['Medicine'] },
    ]);
    return mockMakeCollection([]);
  }),
}));

function mockStudentOwn()   { return { id: 'stu_own',   schoolId: SCHOOL }; }
function mockStudentOther() { return { id: 'stu_other', schoolId: SCHOOL }; }

const express   = require('express');
const supertest = require('supertest');
const growthRecommendationsRouter = require('../../routes/growth-recommendations');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-recommendations', growthRecommendationsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRolePerms = {
    // Matches repairPermissions.js's ROLE_DEFAULTS after this fix.
    student: { growth_profile: ['read'], growth_profile__aspirations: ['read', 'create', 'update'] },
    parent:  { growth_profile: ['read'] }, // view-only, no aspirations sub-key at all
    teacher: { growth_profile: ['read', 'create', 'update'] }, // no aspirations sub-key — falls back to flat, which already covers it
  };
});

describe('GET /aspirations/:studentId', () => {
  test('a student reading their own aspirations succeeds', async () => {
    mockJwtUser = { userId: 'u1', schoolId: SCHOOL, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/growth-recommendations/aspirations/stu_own');
    expect(res.status).toBe(200);
    expect(res.body.data.careerInterests).toEqual(['Medicine']);
  });

  test('a student reading another student\'s aspirations is forbidden', async () => {
    mockJwtUser = { userId: 'u1', schoolId: SCHOOL, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/growth-recommendations/aspirations/stu_other');
    expect(res.status).toBe(403);
  });

  test('a parent reading their own child\'s aspirations succeeds via the flat view-only fallback', async () => {
    mockJwtUser = { userId: 'u2', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/growth-recommendations/aspirations/stu_own');
    expect(res.status).toBe(200);
  });

  test('a parent reading another child\'s aspirations is forbidden', async () => {
    mockJwtUser = { userId: 'u2', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/growth-recommendations/aspirations/stu_other');
    expect(res.status).toBe(403);
  });

  test('a teacher (staff) is unrestricted by ownership', async () => {
    mockJwtUser = { userId: 'u3', schoolId: SCHOOL, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/growth-recommendations/aspirations/stu_other');
    expect(res.status).toBe(200);
  });
});

describe('PUT /aspirations/:studentId', () => {
  test('a student editing their own aspirations succeeds', async () => {
    mockJwtUser = { userId: 'u1', schoolId: SCHOOL, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).put('/api/growth-recommendations/aspirations/stu_own').send({ careerInterests: ['Engineering'] });
    expect(res.status).toBe(200);
  });

  test('a student CANNOT overwrite another student\'s aspirations — the exact IDOR this fix closes', async () => {
    mockJwtUser = { userId: 'u1', schoolId: SCHOOL, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).put('/api/growth-recommendations/aspirations/stu_other').send({ careerInterests: ['Hacked'] });
    expect(res.status).toBe(403);
  });

  test('a parent (view-only flat grant, no aspirations sub-key) is blocked at RBAC before ownership is even checked', async () => {
    mockJwtUser = { userId: 'u2', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).put('/api/growth-recommendations/aspirations/stu_own').send({ careerInterests: ['Anything'] });
    expect(res.status).toBe(403);
  });

  test('a teacher can edit any student\'s aspirations on their behalf', async () => {
    mockJwtUser = { userId: 'u3', schoolId: SCHOOL, role: 'teacher' };
    const res = await supertest(buildApp()).put('/api/growth-recommendations/aspirations/stu_other').send({ careerInterests: ['Law'] });
    expect(res.status).toBe(200);
  });
});
