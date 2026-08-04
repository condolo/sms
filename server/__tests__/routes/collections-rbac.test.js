/* ============================================================
   Collections generic-CRUD RBAC gap — server/routes/collections.js

   This router is a generic escape hatch (offline sync) that reads/wrote
   ANY allowlisted collection with no per-collection permission check
   beyond a small ADMIN_WRITE set for writes — meaning any authenticated
   user could read data through /api/collections/:col that their
   role_permissions would deny through the collection's own dedicated
   route (e.g. every staff member's leave requests, bypassing hr.js's
   deliberate self-scoping; every student's behaviour record, bypassing
   behaviourAccess() entirely).

   Pins three things at once:
   1. The real leak is closed — a role without the owning module's
      grant can no longer read leave_requests/behaviour_incidents here.
   2. The fix doesn't regress — a teacher's real attendance/grades
      access (which ADMIN_WRITE restricts on WRITE only) still works
      on READ, since gating reads to admin-only would have broken it.
   3. Reference/curriculum collections with no dedicated gate stay open.

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants matching repairPermissions.js's real defaults.

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
function mockMakeFakeModel(seed = []) {
  const docs = [...seed];
  return {
    find: jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    create: jest.fn((data) => {
      const doc = { ...data };
      docs.push(doc);
      return Promise.resolve({ toObject: () => doc });
    }),
    bulkWrite: jest.fn((ops) => {
      let upsertedCount = 0, modifiedCount = 0;
      for (const op of ops) {
        const { filter, update } = op.updateOne;
        const existing = docs.find(d => matchesFilter(d, filter));
        if (existing) { Object.assign(existing, update.$set); modifiedCount++; }
        else { docs.push({ ...update.$set }); upsertedCount++; }
      }
      return Promise.resolve({ upsertedCount, modifiedCount });
    }),
    _docs: docs,
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (_req, _res, next) => next() }));

const mockRolePerms = {
  admin:   { behaviour: ['read', 'create', 'update', 'delete'], hr: ['read', 'update'], attendance: ['read'], grades: ['read'] },
  teacher: { attendance: ['read', 'create', 'update'], grades: ['read', 'create', 'update'] }, // no behaviour, no hr
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockTenantData;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') return mockMakeRolePermsStore();
    return { findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => mockTenantData[col] ?? mockMakeFakeModel([])),
  tenantContext: (req) => ({ schoolId: req.jwtUser?.schoolId }),
  PLATFORM_COLLECTIONS: new Set(['schools']),
}));

const express   = require('express');
const supertest = require('supertest');
const collectionsRouter = require('../../routes/collections');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/collections', collectionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockTenantData = {
    leave_requests:      mockMakeFakeModel([{ id: 'l1', schoolId: SCHOOL_A, staffId: 'usr_other' }]),
    behaviour_incidents: mockMakeFakeModel([{ id: 'b1', schoolId: SCHOOL_A, studentId: 'stu_1' }]),
    attendance:          mockMakeFakeModel([{ id: 'a1', schoolId: SCHOOL_A }]),
    grades:              mockMakeFakeModel([{ id: 'g1', schoolId: SCHOOL_A }]),
    subjects:            mockMakeFakeModel([{ id: 's1', schoolId: SCHOOL_A, name: 'Math' }]),
    users:               mockMakeFakeModel([]),
  };
});

describe('C-1: POST/bulk cannot self-escalate to superadmin or plant a raw password', () => {
  test('a plain admin POSTing role:"superadmin" to /users is rejected', async () => {
    const res = await supertest(buildApp())
      .post('/api/collections/users')
      .send({ name: 'Attacker', email: 'a@x.com', password: 'plaintext', role: 'superadmin' });
    expect(res.status).toBe(403);
    expect(mockTenantData.users._docs.length).toBe(0); // never written
  });

  test('a superadmin CAN create a superadmin via POST (legitimate path preserved)', async () => {
    mockJwtUser = { userId: 'usr_super', schoolId: SCHOOL_A, role: 'superadmin', roles: ['superadmin'] };
    const res = await supertest(buildApp())
      .post('/api/collections/users')
      .send({ name: 'New Super', email: 'b@x.com', role: 'superadmin' });
    expect(res.status).toBe(201);
    expect(mockTenantData.users._docs.length).toBe(1);
  });

  test('a plain admin POSTing a non-superadmin role to /users still works (no regression)', async () => {
    const res = await supertest(buildApp())
      .post('/api/collections/users')
      .send({ name: 'New Teacher', email: 'c@x.com', role: 'teacher' });
    expect(res.status).toBe(201);
    expect(mockTenantData.users._docs.length).toBe(1);
  });

  test('a client-supplied password is stripped on POST /users, even for a legitimate admin create', async () => {
    const res = await supertest(buildApp())
      .post('/api/collections/users')
      .send({ name: 'New Teacher', email: 'd@x.com', role: 'teacher', password: 'plaintext-attempt' });
    expect(res.status).toBe(201);
    expect(mockTenantData.users._docs[0].password).toBeUndefined();
  });

  test('bulk upsert containing role:"superadmin" anywhere in the array is rejected for a plain admin', async () => {
    const res = await supertest(buildApp())
      .post('/api/collections/users/bulk')
      .send([
        { id: 'u1', name: 'Fine', email: 'e@x.com', role: 'teacher' },
        { id: 'u2', name: 'Attacker', email: 'f@x.com', role: 'superadmin' },
      ]);
    expect(res.status).toBe(403);
    expect(mockTenantData.users._docs.length).toBe(0); // nothing in the batch was written
  });

  test('bulk upsert with no superadmin role, from a plain admin, still works and strips password', async () => {
    const res = await supertest(buildApp())
      .post('/api/collections/users/bulk')
      .send([{ id: 'u3', name: 'Fine', email: 'g@x.com', role: 'teacher', password: 'plaintext' }]);
    expect(res.status).toBe(200);
    expect(mockTenantData.users._docs.length).toBe(1);
    expect(mockTenantData.users._docs[0].password).toBeUndefined();
  });
});

describe('the real leak this fix closes', () => {
  test('a teacher (no hr grant) can no longer read every staff member\'s leave_requests generically', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/collections/leave_requests');
    expect(res.status).toBe(403);
  });

  test('a teacher (no behaviour grant) can no longer read every student\'s behaviour_incidents generically', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/collections/behaviour_incidents');
    expect(res.status).toBe(403);
  });

  test('admin (real hr + behaviour grants) can still read both', async () => {
    let res = await supertest(buildApp()).get('/api/collections/leave_requests');
    expect(res.status).toBe(200);
    res = await supertest(buildApp()).get('/api/collections/behaviour_incidents');
    expect(res.status).toBe(200);
  });
});

describe('the fix does not regress legitimate read access', () => {
  test('a teacher\'s real attendance:read grant still works — ADMIN_WRITE restricts writes, not reads', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/collections/attendance');
    expect(res.status).toBe(200);
  });

  test('a teacher\'s real grades:read grant still works', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/collections/grades');
    expect(res.status).toBe(200);
  });
});

describe('unmapped reference/curriculum collections stay open', () => {
  test('a teacher can read subjects (no dedicated gate to bypass)', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/collections/subjects');
    expect(res.status).toBe(200);
  });
});
