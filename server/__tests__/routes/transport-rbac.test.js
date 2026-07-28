/* ============================================================
   Transport RBAC rewire — server/routes/transport.js

   transport.js used to hardcode MANAGE_ROLES = new Set(['superadmin',
   'admin', 'transport_officer']) — 'transport_officer' was never a real
   assignable system role, so no school could ever delegate transport
   management to a custom or built-in staff role. This is the first
   test coverage this file has ever had.

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants matching repairPermissions.js's real defaults (admin: full
   RCUD; teacher: read-only), so these tests exercise the real
   permission integration end-to-end, including hasPermission()'s
   module-level fallback used by GET /assignments' self-scoping.

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
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$gt' in v) return (doc[k] ?? 0) > v.$gt;
    }
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      return mockChainObj(docs.splice(idx, 1)[0]);
    }),
    aggregate: jest.fn(() => Promise.resolve([])),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const mockRolePerms = {
  admin:   { transport: ['read', 'create', 'update', 'delete'] },
  teacher: { transport: ['read'] },
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockRoutes, mockAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'transport_routes')      return mockRoutes;
    if (c === 'transport_assignments') return mockAssignments;
    if (c === 'role_permissions')      return mockMakeRolePermsStore();
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const transportRouter = require('../../routes/transport');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/transport', transportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockRoutes      = makeFakeCollection([{ id: 'r1', schoolId: SCHOOL_A, name: 'Route 1' }]);
  mockAssignments = makeFakeCollection([]);
});

describe('GET /routes — read is broadly granted', () => {
  test('admin (full grant) can read', async () => {
    const res = await supertest(buildApp()).get('/api/transport/routes');
    expect(res.status).toBe(200);
  });

  test('teacher (read-only grant) can also read', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/transport/routes');
    expect(res.status).toBe(200);
  });
});

describe('POST /routes — write requires manage access', () => {
  test('admin can create a route', async () => {
    const res = await supertest(buildApp()).post('/api/transport/routes').send({ name: 'New Route' });
    expect(res.status).toBe(201);
  });

  test('a read-only teacher is forbidden from creating a route', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).post('/api/transport/routes').send({ name: 'New Route' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /routes/:id — delete requires manage access', () => {
  test('a read-only teacher is forbidden from deleting a route', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).delete('/api/transport/routes/r1');
    expect(res.status).toBe(403);
  });

  test('admin can delete a route with no active assignments', async () => {
    const res = await supertest(buildApp()).delete('/api/transport/routes/r1');
    expect(res.status).toBe(200);
  });
});

describe('GET /assignments — self-scoping for non-manage roles', () => {
  beforeEach(() => {
    mockAssignments = makeFakeCollection([
      { id: 'a1', schoolId: SCHOOL_A, studentId: 'usr_teacher', routeId: 'r1', status: 'active' },
      { id: 'a2', schoolId: SCHOOL_A, studentId: 'stu_other',   routeId: 'r1', status: 'active' },
    ]);
  });

  test('a read-only role only sees the assignment matching their own userId', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/transport/assignments');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].studentId).toBe('usr_teacher');
  });

  test('admin (manage-level grant) sees every assignment', async () => {
    const res = await supertest(buildApp()).get('/api/transport/assignments');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });
});

describe('DELETE /assignments/:id — delete requires assign-management access', () => {
  beforeEach(() => {
    mockAssignments = makeFakeCollection([
      { id: 'a1', schoolId: SCHOOL_A, studentId: 'stu_1', routeId: 'r1', status: 'active' },
    ]);
  });

  test('a read-only teacher is forbidden from deleting an assignment', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).delete('/api/transport/assignments/a1');
    expect(res.status).toBe(403);
  });

  test('admin can delete an assignment', async () => {
    const res = await supertest(buildApp()).delete('/api/transport/assignments/a1');
    expect(res.status).toBe(200);
  });
});
