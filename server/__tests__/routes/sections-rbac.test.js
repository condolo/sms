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

// A richer matcher than this file's plain matchesFilter() — the cleanup
// query uses $or/$exists/$size (the exact SECTION_DEFAULT shape
// bell-schedule.js itself matches a default against).
function _bellMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => _bellMatches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$exists' in v) return (val !== undefined) === v.$exists;
      if ('$size' in v) return Array.isArray(val) && val.length === v.$size;
    }
    return val === v;
  });
}
// Real (not blindly-stubbed) deleteOne, since the orphan-cleanup tests
// below need to see what, if anything, actually got removed.
function makeFakeBellScheduleStore(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    deleteOne: jest.fn((filter) => {
      const idx = docs.findIndex(d => _bellMatches(d, filter));
      if (idx === -1) return Promise.resolve({ deletedCount: 0 });
      docs.splice(idx, 1);
      return Promise.resolve({ deletedCount: 1 });
    }),
  };
}

let mockSections, mockTeachers, mockClasses, mockBellSchedules;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'sections')          return mockSections;
    if (c === 'teachers')          return mockTeachers;
    if (c === 'classes')           return mockClasses;
    if (c === 'bell_schedules')    return mockBellSchedules;
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
  mockBellSchedules = makeFakeBellScheduleStore([]);
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

// Deleting a section leaves its own bell-schedule default permanently
// unreachable — resolveBellSchedule only ever matches a section default
// against a class whose live sectionKey equals it, and no class can carry
// this key anymore once the section is gone (the active-class check above
// already guarantees that). Left behind, it would linger in the Bell
// Schedules list forever, visible but never actually applied to anything.
describe('DELETE /:id — bell schedule cleanup', () => {
  test("deleting a section removes its own bell-schedule default", async () => {
    mockBellSchedules = makeFakeBellScheduleStore([
      { id: 'bs_primary', schoolId: SCHOOL_A, section: 'primary', name: 'Primary default', classIds: [] },
    ]);
    const res = await supertest(buildApp()).delete('/api/sections/s1');
    expect(res.status).toBe(200);
    expect(mockBellSchedules._docs()).toHaveLength(0);
  });

  test("a DIFFERENT section's default, and any class-specific schedule, are left untouched", async () => {
    mockBellSchedules = makeFakeBellScheduleStore([
      { id: 'bs_primary',  schoolId: SCHOOL_A, section: 'primary',    name: 'Primary default', classIds: [] },
      { id: 'bs_secondary', schoolId: SCHOOL_A, section: 'secondary', name: 'Secondary default', classIds: [] },
      { id: 'bs_cls',      schoolId: SCHOOL_A, section: 'all',        name: 'Year 7 only', classIds: ['cls_7'] },
    ]);
    await supertest(buildApp()).delete('/api/sections/s1');
    const remaining = mockBellSchedules._docs().map(d => d.id);
    expect(remaining).toEqual(expect.arrayContaining(['bs_secondary', 'bs_cls']));
    expect(remaining).not.toContain('bs_primary');
  });

  test('a section with no saved bell schedule deletes cleanly either way', async () => {
    mockBellSchedules = makeFakeBellScheduleStore([]);
    const res = await supertest(buildApp()).delete('/api/sections/s1');
    expect(res.status).toBe(200);
  });
});
