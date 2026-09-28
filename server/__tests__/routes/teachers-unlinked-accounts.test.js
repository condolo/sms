/* ============================================================
   GET /api/teachers/unlinked-accounts (2026-09-28)

   New route backing HR's "Activate Existing User" flow: a login
   account for a staff-type role (invited via Settings, or granted
   superadmin via the platform console) was never required to have a
   matching HR staff profile — `users` and `teachers` are entirely
   independent collections. This surfaces "who has a login but no HR
   record" so HR can give them a real staff profile pre-filled from
   their existing account, instead of re-typing their details or
   risking a duplicate login.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/counters', () => ({ nextStaffId: jest.fn().mockResolvedValue('STF-0001') }));

const SCHOOL_ID = 'sch_demo_001';
let mockJwtUser;
let mockUsers;
let mockTeachers;

function mockMatches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    if (v && typeof v === 'object' && '$nin' in v) return !v.$nin.includes(doc[k]);
    return doc[k] === v;
  });
}
let usersSort;
let usersLimit;
function mockFindChain(docs) {
  const chain = {
    select: () => chain,
    sort:   (...args) => { usersSort  = args; return chain; },
    limit:  (...args) => { usersLimit = args; return chain; },
    lean:   () => Promise.resolve(docs),
  };
  return chain;
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) })),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'users') {
      return { find: (filter) => mockFindChain(mockUsers.filter(d => mockMatches(d, filter))) };
    }
    if (col === 'teachers') {
      return { find: (filter) => mockFindChain(mockTeachers.filter(d => mockMatches(d, filter))) };
    }
    return { find: () => mockFindChain([]) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const teachersRouter = require('../../routes/teachers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teachers', teachersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_hr_001', schoolId: SCHOOL_ID, role: 'hr', roles: ['hr'] };
  mockUsers = [];
  mockTeachers = [];
  usersSort = undefined;
  usersLimit = undefined;
});

describe('GET /api/teachers/unlinked-accounts', () => {
  test('an active superadmin login with no teachers record is returned', async () => {
    mockUsers = [{ id: 'usr_collins', schoolId: SCHOOL_ID, name: 'Collins Ndolo', email: 'collins@trinitas.example', role: 'superadmin' }];
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject(
      { id: 'usr_collins', name: 'Collins Ndolo', email: 'collins@trinitas.example', role: 'superadmin' },
    );
  });

  test('a user already linked via a teachers.userId record is excluded', async () => {
    mockUsers = [{ id: 'usr_linked', schoolId: SCHOOL_ID, name: 'Jane Teacher', email: 'jane@trinitas.example', role: 'teacher' }];
    mockTeachers = [{ schoolId: SCHOOL_ID, userId: 'usr_linked' }];
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('parent, guardian, and student accounts are never returned even if unlinked', async () => {
    mockUsers = [
      { id: 'usr_parent', schoolId: SCHOOL_ID, name: 'A Parent', email: 'p@x.com', role: 'parent' },
      { id: 'usr_guardian', schoolId: SCHOOL_ID, name: 'A Guardian', email: 'g@x.com', role: 'guardian' },
      { id: 'usr_student', schoolId: SCHOOL_ID, name: 'A Student', email: 's@x.com', role: 'student' },
    ];
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('a deactivated (soft-deleted) login is never returned', async () => {
    mockUsers = [{ id: 'usr_dead', schoolId: SCHOOL_ID, name: 'Old Account', email: 'old@x.com', role: 'admin', isActive: false }];
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('a legacy user with isActive unset is still eligible', async () => {
    mockUsers = [{ id: 'usr_legacy', schoolId: SCHOOL_ID, name: 'Legacy Admin', email: 'legacy@x.com', role: 'admin' }];
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('usr_legacy');
  });

  test('no unlinked accounts at all returns an empty list, not an error', async () => {
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('the users query is sorted by name and capped, so an unusually large school cannot return an unbounded list', async () => {
    mockUsers = [{ id: 'usr_a', schoolId: SCHOOL_ID, name: 'A', email: 'a@x.com', role: 'admin' }];
    const res = await supertest(buildApp()).get('/api/teachers/unlinked-accounts');
    expect(res.status).toBe(200);
    expect(usersSort).toEqual([{ name: 1 }]);
    expect(usersLimit).toEqual([500]);
  });
});
