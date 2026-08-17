/* ============================================================
   server/routes/classes.js — GET / ?assignedOnly=true

   GET /api/classes is deliberately UNSCOPED by default (21 different
   client surfaces depend on seeing the full school list regardless of
   the caller's own teaching/assigned scope — see the route's own doc
   comment). ?assignedOnly=true is the narrow, opt-in exception:
   AttendancePage.jsx's class picker uses it so a scoped account isn't
   shown classes its own write requests (POST /attendance) would reject
   anyway. These tests cover both halves — the flag actually narrows
   when passed, and its ABSENCE changes nothing for every other caller.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as medical-alerts.test.js / grades-write-scope.test.js /
   attendance-write-scope.test.js.

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
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    aggregate:      jest.fn(() => Promise.resolve([])),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockClasses, mockTeachingAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes') return mockClasses;
    return mockMakeFakeCollection([]); // streams / students enrichment
  },
}));

const express     = require('express');
const supertest   = require('supertest');
const classesRouter = require('../../routes/classes');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_1', schoolId: SCHOOL_A, name: 'Grade 7A', status: 'active' },
    { id: 'cls_2', schoolId: SCHOOL_A, name: 'Grade 7B', status: 'active' },
  ]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherOf(...classIds) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    classIds.map(classId => ({ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId }))
  );
}

describe('GET /api/classes — default (no assignedOnly) is unrestricted for everyone', () => {
  test('a scoped teacher still sees every class when the flag is absent — zero behavior change for the other 20 callers', async () => {
    asTeacherOf('cls_1'); // assigned to only one of the two classes
    const res = await supertest(buildApp()).get('/api/classes');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('admin sees every class', async () => {
    const res = await supertest(buildApp()).get('/api/classes');
    expect(res.body.data.length).toBe(2);
  });
});

describe('GET /api/classes?assignedOnly=true — opt-in narrowing', () => {
  test('a teacher sees only their own assigned classes', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id)).toEqual(['cls_1']);
  });

  test('a teacher with zero assigned classes gets an empty list with a noAssignments flag', async () => {
    asTeacherOf(); // no assignments at all
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.noAssignments).toBe(true);
  });

  test('admin (school-level scope) still sees every class even with the flag set — no-op for unrestricted roles', async () => {
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.length).toBe(2);
  });
});
