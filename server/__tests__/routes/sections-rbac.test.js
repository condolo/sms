/* ============================================================
   Sections RBAC rewire — server/routes/sections.js

   sections.js used to hardcode an admin/superadmin-only inline check
   (_isAdmin()) never routed through role_permissions. Converted to
   rbac('settings', action, 'school') — no role_permissions entry
   grants 'settings' to anyone but admin/superadmin by default, so
   this reproduces current behavior exactly while making it
   Settings-editable. Reads stay open to every authenticated user.

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants matching repairPermissions.js's real defaults.

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
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    insertMany:       jest.fn((newDocs) => { docs.push(...newDocs); return Promise.resolve(newDocs); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      docs[idx] = { ...docs[idx], ...update };
      return mockChainObj(docs[idx]);
    }),
    deleteOne:      jest.fn(() => Promise.resolve({ deletedCount: 1 })),
    countDocuments: jest.fn(() => Promise.resolve(0)),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const mockRolePerms = {
  admin:   { settings: ['read', 'create', 'update', 'delete'] },
  teacher: {},
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockSections, mockTeachers, mockClasses;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'sections')          return mockSections;
    if (c === 'teachers')          return mockTeachers;
    if (c === 'classes')           return mockClasses;
    if (c === 'role_permissions')  return mockMakeRolePermsStore();
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const sectionsRouter = require('../../routes/sections');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sections', sectionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser  = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockSections = makeFakeCollection([{ id: 's1', schoolId: SCHOOL_A, key: 'primary', name: 'Primary', color: '#3b82f6', order: 2 }]);
  mockTeachers = makeFakeCollection([]);
  mockClasses  = makeFakeCollection([]);
});

test('GET / is open to a read-only role', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).get('/api/sections');
  expect(res.status).toBe(200);
});

test('POST / succeeds for admin', async () => {
  const res = await supertest(buildApp()).post('/api/sections').send({ key: 'kg2', name: 'KG2' });
  expect(res.status).toBe(201);
});

test('POST / is forbidden for a role with no settings grant', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).post('/api/sections').send({ key: 'kg2', name: 'KG2' });
  expect(res.status).toBe(403);
});

test('DELETE /:id is forbidden for a role with no settings grant', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).delete('/api/sections/s1');
  expect(res.status).toBe(403);
});
