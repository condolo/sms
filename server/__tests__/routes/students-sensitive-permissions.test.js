/* ============================================================
   server/routes/students.js — sensitive sub-permissions (2026-09).

   Reported directly: an admissions officer with real, granted access
   to the Admissions module could not deactivate a student. Traced to a
   client-side hardcoded `role === 'admin' || 'superadmin'` check with
   no Settings equivalent at all — but investigating it surfaced a much
   bigger gap: Purge, Promote, and Duplicate-resolution were all gated
   by the SAME coarse rbac('students','delete'|'update') action as
   ordinary, already-granted capabilities (deactivate, routine editing),
   meaning any role holding those ALSO already satisfied RBAC for these
   far more sensitive, harder-to-reverse actions — the client's hardcoded
   button visibility was the only thing standing between a non-admin
   role and calling them directly. Portal-account creation had its own
   separate hardcoded allowlist with the identical problem.

   This pins the fix: each of the 4 new sub-permissions
   (students__purge, students__promote, students__portal_accounts,
   students__duplicates) is enforced with hasExplicitSubGrant — no
   coarse-grant fallback — so holding the ordinary coarse action alone
   is confirmed NOT sufficient, while an explicit grant now genuinely
   works, and the real floor roles are confirmed unaffected.

   Uses the REAL rbac.js (hasExplicitSubGrant is not mocked) — only its
   own DB read (role_permissions) is mocked, same discipline as
   attendance-school-report.test.js earlier this session.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

let mockRolePerms = {};

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), hasNoAssignments: jest.fn(() => false) }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    const chainArr = (arr) => { const x = { sort: () => x, skip: () => x, limit: () => x, select: () => x, lean: () => Promise.resolve(arr) }; return x; };
    const chainOne = (obj) => { const x = { select: () => x, lean: () => Promise.resolve(obj) }; return x; };
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: mockRolePerms }) }) };
    }
    return {
      find: () => chainArr([]), findOne: () => chainOne(null),
      countDocuments: () => Promise.resolve(0),
      deleteMany: () => Promise.resolve({ deletedCount: 0 }),
      create: () => Promise.resolve({}),
    };
  }),
}));

const STUDENTS_SEED = [{ id: 's1', _id: 'oid_s1', schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei', status: 'active' }];
const mockStudentsColl = {
  find:             () => ({ sort: () => mockStudentsColl.find(), skip: () => mockStudentsColl.find(), limit: () => mockStudentsColl.find(), select: () => mockStudentsColl.find(), lean: () => Promise.resolve(STUDENTS_SEED) }),
  findOne:          () => ({ select: () => ({ lean: () => Promise.resolve(STUDENTS_SEED[0]) }), lean: () => Promise.resolve(STUDENTS_SEED[0]) }),
  countDocuments:   () => Promise.resolve(1),
  deleteMany:       () => Promise.resolve({ deletedCount: 1 }),
  findOneAndUpdate: () => ({ lean: () => Promise.resolve(STUDENTS_SEED[0]) }),
  updateOne:        () => Promise.resolve({ matchedCount: 1 }),
};
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'students') return mockStudentsColl;
    return {
      find: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) }),
      findOne: () => ({ lean: () => Promise.resolve(null) }),
      countDocuments: () => Promise.resolve(0),
      deleteMany: () => Promise.resolve({ deletedCount: 0 }),
      updateOne: () => Promise.resolve({ matchedCount: 0 }),
    };
  },
}));

const express     = require('express');
const supertest   = require('supertest');
const studentsRouter = require('../../routes/students');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/students', studentsRouter);
  return app;
}

beforeEach(() => {
  invalidatePermCache(SCHOOL_A);
  mockRolePerms = {};
});

const NON_FLOOR = { userId: 'usr_ao', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
const ADMIN     = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
const PRINCIPAL = { userId: 'usr_principal', schoolId: SCHOOL_A, role: 'principal', roles: ['principal'] };

describe('DELETE /api/students/purge', () => {
  test('non-floor role with full coarse students:delete but NO explicit purge grant is forbidden', async () => {
    mockRolePerms = { students: ['read', 'create', 'update', 'delete'] }; // has "Deactivate" — must not imply Purge
    const res = await supertest(buildApp(NON_FLOOR)).delete('/api/students/purge').send({ ids: ['s1'] });
    expect(res.status).toBe(403);
  });

  test('non-floor role WITH explicit students__purge grant succeeds', async () => {
    mockRolePerms = { students: ['read'], students__purge: ['read', 'delete'] };
    const res = await supertest(buildApp(NON_FLOOR)).delete('/api/students/purge').send({ ids: ['s1'] });
    expect(res.status).not.toBe(403);
  });

  test('admin (floor) succeeds via the floor bypass alone — no students__purge grant needed', async () => {
    mockRolePerms = { students: ['read', 'delete'] }; // real coarse grant so the OUTER rbac() gate passes; students__purge deliberately absent
    const res = await supertest(buildApp(ADMIN)).delete('/api/students/purge').send({ ids: ['s1'] });
    expect(res.status).not.toBe(403);
  });
});

describe('POST /api/students/promote', () => {
  const body = { promotions: [{ fromClassId: 'c1', toClassId: 'c2' }] };

  test('non-floor role with full coarse students:update but NO explicit promote grant is forbidden', async () => {
    mockRolePerms = { students: ['read', 'create', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/promote').send(body);
    expect(res.status).toBe(403);
  });

  test('non-floor role WITH explicit students__promote grant is not forbidden', async () => {
    mockRolePerms = { students: ['read'], students__promote: ['read', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/promote').send(body);
    expect(res.status).not.toBe(403);
  });

  test('admin (floor) succeeds via the floor bypass alone — no students__promote grant needed', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/promote').send(body);
    expect(res.status).not.toBe(403);
  });
});

describe('POST /api/students/bulk-portal-accounts', () => {
  test('non-floor role with full coarse students:update but NO explicit portal_accounts grant is forbidden', async () => {
    mockRolePerms = { students: ['read', 'create', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/bulk-portal-accounts').send({ studentIds: ['s1'] });
    expect(res.status).toBe(403);
  });

  test('non-floor role WITH explicit students__portal_accounts grant is not forbidden', async () => {
    mockRolePerms = { students: ['read'], students__portal_accounts: ['read', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/bulk-portal-accounts').send({ studentIds: ['s1'] });
    expect(res.status).not.toBe(403);
  });

  test('admin (floor) succeeds via the floor bypass alone', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-portal-accounts').send({ studentIds: ['s1'] });
    expect(res.status).not.toBe(403);
  });

  test('principal is ALSO an unconditional floor for portal_accounts specifically (matches the pre-existing allowlist, unchanged)', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(PRINCIPAL)).post('/api/students/bulk-portal-accounts').send({ studentIds: ['s1'] });
    expect(res.status).not.toBe(403);
  });
});

describe('POST /api/students/duplicates/resolve', () => {
  test('non-floor role with full coarse students:delete but NO explicit duplicates grant is forbidden', async () => {
    mockRolePerms = { students: ['read', 'create', 'update', 'delete'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/duplicates/resolve').send({ keepId: 's1', removeIds: ['s2'] });
    expect(res.status).toBe(403);
  });

  test('non-floor role WITH explicit students__duplicates grant is not forbidden', async () => {
    mockRolePerms = { students: ['read'], students__duplicates: ['read', 'delete'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/duplicates/resolve').send({ keepId: 's1', removeIds: ['s2'] });
    expect(res.status).not.toBe(403);
  });

  test('admin (floor) succeeds via the floor bypass alone', async () => {
    mockRolePerms = { students: ['read', 'delete'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/duplicates/resolve').send({ keepId: 's1', removeIds: ['s2'] });
    expect(res.status).not.toBe(403);
  });
});

describe('DELETE /api/students/:id — Deactivate (the actual reported bug) — unchanged, plain coarse RBAC', () => {
  test('a role with real, explicitly-granted students:delete (e.g. the admissions officer in this report) succeeds', async () => {
    mockRolePerms = { students: ['read', 'create', 'update', 'delete'] };
    const res = await supertest(buildApp(NON_FLOOR)).delete('/api/students/s1');
    expect(res.status).not.toBe(403);
  });

  test('a role without students:delete is forbidden', async () => {
    mockRolePerms = { students: ['read', 'create', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).delete('/api/students/s1');
    expect(res.status).toBe(403);
  });
});
