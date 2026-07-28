/* ============================================================
   Hostel RBAC rewire — server/routes/hostel.js

   hostel.js used to hardcode MANAGE_ROLES = new Set(['superadmin',
   'admin', 'hostel_master']) — 'hostel_master' was never a real
   assignable system role, so no school could ever delegate hostel
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
    updateOne: jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
    aggregate: jest.fn(() => Promise.resolve([])),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

/* Realistic role_permissions — matches repairPermissions.js's real
   defaults: admin gets full RCUD, teacher gets read-only. Neither has
   any 'hostel__manage'/'hostel__assign' sub-key seeded, so rbac()'s
   subKey checks fall back to these module-level arrays. */
const mockRolePerms = {
  admin:   { hostel: ['read', 'create', 'update', 'delete'] },
  teacher: { hostel: ['read'] },
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockHostels, mockRooms, mockAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'hostels')             return mockHostels;
    if (c === 'hostel_rooms')        return mockRooms;
    if (c === 'hostel_assignments')  return mockAssignments;
    if (c === 'role_permissions')    return mockMakeRolePermsStore();
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const hostelRouter = require('../../routes/hostel');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hostel', hostelRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockHostels     = makeFakeCollection([{ id: 'h1', schoolId: SCHOOL_A, name: 'Kilimanjaro House' }]);
  mockRooms       = makeFakeCollection([]);
  mockAssignments = makeFakeCollection([]);
});

describe('GET /hostels — read is broadly granted', () => {
  test('admin (full grant) can read', async () => {
    const res = await supertest(buildApp()).get('/api/hostel/hostels');
    expect(res.status).toBe(200);
  });

  test('teacher (read-only grant) can also read', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/hostel/hostels');
    expect(res.status).toBe(200);
  });
});

describe('POST /hostels — write requires manage access', () => {
  test('admin can create a hostel', async () => {
    const res = await supertest(buildApp()).post('/api/hostel/hostels').send({ name: 'New House' });
    expect(res.status).toBe(201);
  });

  test('a read-only teacher is forbidden from creating a hostel', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).post('/api/hostel/hostels').send({ name: 'New House' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /hostels/:id — delete requires manage access', () => {
  test('a read-only teacher is forbidden from deleting a hostel', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).delete('/api/hostel/hostels/h1');
    expect(res.status).toBe(403);
  });

  test('admin can delete a hostel with no rooms/assignments', async () => {
    const res = await supertest(buildApp()).delete('/api/hostel/hostels/h1');
    expect(res.status).toBe(200);
  });
});

describe('GET /assignments — self-scoping for non-manage roles', () => {
  beforeEach(() => {
    mockAssignments = makeFakeCollection([
      { id: 'a1', schoolId: SCHOOL_A, studentId: 'usr_teacher', hostelId: 'h1', roomId: 'r1', status: 'active' },
      { id: 'a2', schoolId: SCHOOL_A, studentId: 'stu_other',   hostelId: 'h1', roomId: 'r1', status: 'active' },
    ]);
  });

  test('a read-only role only sees the assignment matching their own userId', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/hostel/assignments');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].studentId).toBe('usr_teacher');
  });

  test('admin (manage-level grant) sees every assignment', async () => {
    const res = await supertest(buildApp()).get('/api/hostel/assignments');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });
});
