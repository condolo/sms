/* ============================================================
   Medical Centre milestone 4 — server/routes/medical.js GET /alerts

   Covers: the RBAC subKey gate (only admin/principal/deputy_principal
   and anyone granted medical__alerts can reach this route at all — see
   repairPermissions.js/onboard.js), the ScopeEngine class-based
   restriction for teacher-level scope (same mechanism the main student
   roster uses), and — the actual security property this route exists
   for — that the response never carries bloodGroup/doctorName/notes/
   consent even when the underlying student document has them.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as hostel-rbac.test.js not mocking rbac().

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
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (k.includes('.')) {
      // 'medical.severeAllergy' style dotted paths
      const [top, sub] = k.split('.');
      return doc[top] ? doc[top][sub] === v : false;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      return true; // don't over-constrain on operators this suite doesn't need
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments: jest.fn(() => Promise.resolve(0)),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

/* Matches repairPermissions.js's real defaults exactly. */
const mockRolePerms = {
  admin:   { medical: ['read', 'create', 'update', 'delete'] },
  teacher: { medical__alerts: ['read'] },
  finance: { finance: ['read', 'create', 'update', 'delete'] }, // no medical grant at all
};

let mockStudents, mockTeachingAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)) };
    }
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'students') return mockStudents;
    return mockMakeFakeCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const medicalRouter = require('../../routes/medical');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/medical', medicalRouter);
  return app;
}

function makeStudent(overrides = {}) {
  return {
    id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno', classId: 'cls_1', className: 'Grade 7',
    // Deliberately includes sensitive fields the alerts route must NEVER echo back.
    medical: {
      bloodGroup: 'O+', doctorName: 'Dr. Kamau', doctorPhone: '0700000000',
      notes: 'Confidential clinical note', parentConsentGiven: true,
      severeAllergy: true, hasAsthma: false, hasEpilepsy: false, otherCriticalAlert: '',
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockStudents = mockMakeFakeCollection([makeStudent()]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  // scopeMiddleware caches resolved scope per userId::schoolId for 5 minutes —
  // real and correct in production, but it silently leaks a stale scope
  // across test cases here that reuse the same userId with different
  // teaching_assignments fixtures. Clear it for every userId this suite uses.
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
  invalidateScopeCache('usr_finance', SCHOOL_A);
});

describe('GET /api/medical/alerts — RBAC', () => {
  test('admin (full grant) can reach the route', async () => {
    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.status).toBe(200);
  });

  test('a role with no medical grant at all is forbidden', async () => {
    mockJwtUser = { userId: 'usr_finance', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'] };
    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.status).toBe(403);
  });

  test('a teacher with ONLY medical__alerts can reach the route (the whole point of the subKey grant)', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([{ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_1' }]);
    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/medical/alerts — response never leaks the full profile', () => {
  test('only alert-relevant fields are present, never bloodGroup/doctor/notes/consent', async () => {
    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);

    const alert = res.body.data[0];
    expect(alert).toEqual({
      studentId: 'stu_1', studentName: 'Amina Otieno', classId: 'cls_1', className: 'Grade 7',
      severeAllergy: true, hasAsthma: false, hasEpilepsy: false, otherCriticalAlert: null,
    });
    expect(alert).not.toHaveProperty('bloodGroup');
    expect(alert).not.toHaveProperty('doctorName');
    expect(alert).not.toHaveProperty('notes');
    expect(alert).not.toHaveProperty('parentConsentGiven');
  });

  test('a student with no critical flags at all is excluded', async () => {
    mockStudents = mockMakeFakeCollection([
      makeStudent(),
      makeStudent({ id: 'stu_2', firstName: 'John', lastName: 'Kamau', classId: 'cls_1', medical: { bloodGroup: 'A+' } }),
    ]);
    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].studentId).toBe('stu_1');
  });
});

describe('GET /api/medical/alerts — class-based scoping for teachers', () => {
  test('a teacher only sees alerts for students in their own assigned classes', async () => {
    mockStudents = mockMakeFakeCollection([
      makeStudent({ id: 'stu_1', classId: 'cls_1' }),           // teacher's class
      makeStudent({ id: 'stu_2', classId: 'cls_2', firstName: 'Other', hasAsthma: true }), // not teacher's class
    ]);
    mockTeachingAssignments = mockMakeFakeCollection([{ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_1' }]);
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].studentId).toBe('stu_1');
  });

  test('a teacher with zero class assignments gets an empty list, not a 403 — and a noAssignments flag distinguishing it from "checked, found none"', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([]); // no assignments at all
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({ noAssignments: true });
  });

  test('admin (school-level scope) sees alerts across every class', async () => {
    mockStudents = mockMakeFakeCollection([
      makeStudent({ id: 'stu_1', classId: 'cls_1' }),
      makeStudent({ id: 'stu_2', classId: 'cls_2', firstName: 'Other', hasAsthma: true }),
    ]);
    const res = await supertest(buildApp()).get('/api/medical/alerts');
    expect(res.body.data.length).toBe(2);
  });
});
