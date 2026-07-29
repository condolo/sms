/* ============================================================
   Rooms RBAC rewire — server/routes/rooms.js

   rooms.js used to hardcode MANAGE_ROLES = new Set(['admin',
   'superadmin', 'deputy', 'principal', 'timetabler']) — real roles,
   but never routed through role_permissions, so a school could never
   restrict or delegate room management via Settings. Converted to
   rbac('timetable', action, 'rooms') — the exact same 5 roles already
   hold real timetable:RCUD grants server-side, so this reproduces
   current behavior while making it Settings-editable. Reads stay
   open to every authenticated user, matching the file's own
   documented design.

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
  admin:   { timetable: ['read', 'create', 'update', 'delete'] },
  teacher: { timetable: ['read'] },
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockRooms;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'rooms')             return mockRooms;
    if (c === 'role_permissions')  return mockMakeRolePermsStore();
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const roomsRouter = require('../../routes/rooms');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rooms', roomsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockRooms = makeFakeCollection([{ id: 'r1', schoolId: SCHOOL_A, name: 'Room 1', isActive: true }]);
});

test('GET / is open to a read-only role', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).get('/api/rooms');
  expect(res.status).toBe(200);
});

test('POST / succeeds for a role with timetable RCUD', async () => {
  const res = await supertest(buildApp()).post('/api/rooms').send({ name: 'New Room' });
  expect(res.status).toBe(201);
});

test('POST / is forbidden for a read-only role', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).post('/api/rooms').send({ name: 'New Room' });
  expect(res.status).toBe(403);
});

test('DELETE /:id is forbidden for a read-only role', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).delete('/api/rooms/r1');
  expect(res.status).toBe(403);
});
