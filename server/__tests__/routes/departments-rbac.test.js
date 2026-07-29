/* ============================================================
   Departments RBAC key fix — server/routes/departments.js

   departments.js gated writes on rbac('departments', action), but
   'departments' was never a registered module (absent from
   moduleRegistry.js, repairPermissions.js, and onboard.js) -- meaning
   literally no role, not even admin, ever had it granted. Only
   superadmin (which bypasses rbac entirely) could ever create/update/
   delete a department. Fixed by reusing the 'subjects' rbac key --
   the registry's own subjects.create sub is labelled "Create Subject
   / Department", and the sibling class-subjects.js/student-subjects.js
   routes already write under 'subjects'. admin/superadmin already hold
   real subjects:RCUD via the ALL_MODULES spread in repairPermissions.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve({ ...doc, toObject: () => doc }); }),
    countDocuments:   jest.fn(() => Promise.resolve(0)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      docs[idx] = { ...docs[idx], ...update };
      return mockChainObj(docs[idx]);
    }),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const mockRolePerms = {
  admin:   { subjects: ['read', 'create', 'update', 'delete'] },
  teacher: {},
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockDepts, mockSubjects;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'departments')      return mockDepts;
    if (c === 'subjects')         return mockSubjects;
    if (c === 'role_permissions') return mockMakeRolePermsStore();
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const departmentsRouter = require('../../routes/departments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/departments', departmentsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser  = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockDepts    = makeFakeCollection([]);
  mockSubjects = makeFakeCollection([]);
});

test('admin can create a department (previously impossible for any non-superadmin role)', async () => {
  const res = await supertest(buildApp()).post('/api/departments').send({ name: 'Sciences', code: 'SCI' });
  expect(res.status).toBe(201);
});

test('a role with no subjects grant is forbidden from creating a department', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).post('/api/departments').send({ name: 'Sciences', code: 'SCI' });
  expect(res.status).toBe(403);
});

test('GET / is open to a role with no subjects grant', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).get('/api/departments');
  expect(res.status).toBe(200);
});
