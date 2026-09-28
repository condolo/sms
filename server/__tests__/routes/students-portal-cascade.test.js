/* ============================================================
   server/routes/students.js — portal-login cascade on
   deactivate/reactivate, and live account-status on GET /:id

   Real gap, confirmed live against production data: deactivating a
   single student (PATCH /:id/deactivate, or DELETE /:id — the two
   paths an admin actually uses from a student's profile/list) never
   touched their portal login at all. Only the bulk year-end
   graduation path (POST /promote) ever deactivated a student's login.
   A withdrawn/suspended/expelled student — and their parent — kept
   full working portal access indefinitely. Confirmed against real
   data: 2 of 6 currently-inactive students, and 1 linked parent,
   still had isActive:true logins.

   Deactivating the PARENT's login is sibling-aware, per explicit
   instruction: only when EVERY one of that parent's linked children
   (their own `studentIds` array) is inactive — a parent with another
   still-enrolled child must never be locked out.

   Also: GET /:id's `has*Account` flags only ever mean "a login was
   created at some point" (nothing unsets them), so the student
   profile page kept showing "Active" even after a login was disabled.
   New `*AccountActive` fields report the login's real, current state.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'], email: 'admin@school-a.test' };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_q, _s, n) => n() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

let mockStudents;
let mockUsers;

function mockMatches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    // A scalar filter value against an array field matches on array
    // membership — same semantics Mongo uses for e.g. `studentIds: 'x'`.
    if (Array.isArray(doc[k]) && !(v && typeof v === 'object')) return doc[k].includes(v);
    return doc[k] === v;
  });
}
function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

const mockStudentsCollection = {
  findOne: (filter) => mockChain(mockStudents.find(d => mockMatches(d, filter)) ?? null),
  find:    (filter) => mockChain(mockStudents.filter(d => mockMatches(d, filter))),
  updateOne: jest.fn((filter, update) => {
    const doc = mockStudents.find(d => mockMatches(d, filter));
    if (doc) Object.assign(doc, update.$set);
    return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
  }),
  findOneAndUpdate: jest.fn((filter, update, _opts) => {
    const doc = mockStudents.find(d => mockMatches(d, filter));
    if (doc) Object.assign(doc, update);
    return mockChain(doc ?? null);
  }),
};

const mockUsersCollection = {
  findOne: (filter) => mockChain(mockUsers.find(d => mockMatches(d, filter)) ?? null),
  find:    (filter) => mockChain(mockUsers.filter(d => mockMatches(d, filter))),
  updateMany: jest.fn((filter, update) => {
    const matched = mockUsers.filter(d => mockMatches(d, filter));
    matched.forEach(d => Object.assign(d, update.$set));
    return Promise.resolve({ modifiedCount: matched.length });
  }),
  updateOne: jest.fn((filter, update) => {
    const doc = mockUsers.find(d => mockMatches(d, filter));
    if (doc) Object.assign(doc, update.$set);
    return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
  }),
};

jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: () => mockChain([]), findOne: () => mockChain(null) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'students') return mockStudentsCollection;
    if (collection === 'users')    return mockUsersCollection;
    return { find: () => mockChain([]), findOne: () => mockChain(null) };
  },
}));

const express   = require('express');
const supertest = require('supertest');
const studentsRouter = require('../../routes/students');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudents = [];
  mockUsers = [];
});

describe('PATCH /api/students/:id/deactivate — portal-login cascade', () => {
  test('deactivates the student\'s own portal login', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active' }];
    mockUsers = [{ id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: true }];

    const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_stu_1').isActive).toBe(false);
  });

  test('deactivates the parent\'s login when this was their ONLY child', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active' }];
    mockUsers = [
      { id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: true },
      { id: 'usr_parent_1', _id: 'oid_usr_parent_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_1'], isActive: true },
    ];

    const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_parent_1').isActive).toBe(false);
  });

  test('does NOT deactivate the parent\'s login when another sibling is still active', async () => {
    mockStudents = [
      { id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active' },
      { id: 'stu_2', _id: 'oid_2', schoolId: SCHOOL_A, firstName: 'Grace', lastName: 'Maina', status: 'active' },
    ];
    mockUsers = [
      { id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: true },
      { id: 'usr_parent_1', _id: 'oid_usr_parent_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_1', 'stu_2'], isActive: true },
    ];

    const res = await supertest(buildApp()).patch('/api/students/stu_1/deactivate').send({ reason: 'withdrawn' });
    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_parent_1').isActive).toBe(true);
  });
});

describe('DELETE /api/students/:id — the same cascade applies to the other deactivation path', () => {
  test('deactivates the student\'s own portal login', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active' }];
    mockUsers = [{ id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: true }];

    const res = await supertest(buildApp()).delete('/api/students/stu_1');
    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_stu_1').isActive).toBe(false);
  });
});

describe('PATCH /api/students/:id/reactivate — portal-login restore', () => {
  test('reactivates the student\'s own portal login', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'inactive' }];
    mockUsers = [{ id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: false }];

    const res = await supertest(buildApp()).patch('/api/students/stu_1/reactivate');
    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_stu_1').isActive).toBe(true);
  });

  test('reactivates a parent login that the deactivate cascade had disabled', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'inactive' }];
    mockUsers = [
      { id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: false },
      { id: 'usr_parent_1', _id: 'oid_usr_parent_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_1'], isActive: false },
    ];

    const res = await supertest(buildApp()).patch('/api/students/stu_1/reactivate');
    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_parent_1').isActive).toBe(true);
  });
});

describe('GET /api/students/:id — live portal account status', () => {
  test('reports portalAccountActive:true for a working student login', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active', hasPortalAccount: true }];
    mockUsers = [{ id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: true }];

    const res = await supertest(buildApp()).get('/api/students/stu_1');
    expect(res.status).toBe(200);
    expect(res.body.data.portalAccountActive).toBe(true);
  });

  test('reports portalAccountActive:false when the login was deactivated but hasPortalAccount is still true', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'inactive', hasPortalAccount: true }];
    mockUsers = [{ id: 'usr_stu_1', _id: 'oid_usr_stu_1', schoolId: SCHOOL_A, studentId: 'stu_1', role: 'student', isActive: false }];

    const res = await supertest(buildApp()).get('/api/students/stu_1');
    expect(res.status).toBe(200);
    expect(res.body.data.hasPortalAccount).toBe(true);
    expect(res.body.data.portalAccountActive).toBe(false);
  });

  test('reports parentAccountActive by matching the student\'s parentEmail', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'inactive', hasParentAccount: true, parentEmail: 'diana@example.com' }];
    mockUsers = [{ id: 'usr_parent_1', _id: 'oid_usr_parent_1', schoolId: SCHOOL_A, email: 'diana@example.com', role: 'parent', isActive: false }];

    const res = await supertest(buildApp()).get('/api/students/stu_1');
    expect(res.status).toBe(200);
    expect(res.body.data.parentAccountActive).toBe(false);
  });

  test('reports null when hasPortalAccount is true but no matching login exists at all', async () => {
    mockStudents = [{ id: 'stu_1', _id: 'oid_1', schoolId: SCHOOL_A, firstName: 'Nathaniel', lastName: 'Maina', status: 'active', hasPortalAccount: true }];
    mockUsers = [];

    const res = await supertest(buildApp()).get('/api/students/stu_1');
    expect(res.status).toBe(200);
    expect(res.body.data.portalAccountActive).toBeNull();
  });
});
