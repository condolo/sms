/* ============================================================
   server/routes/students.js — POST /bulk-reset-portal-passwords (2026-10).

   Verifies, against the REAL rbac.js (hasExplicitSubGrant not mocked):
   - reset_passwords is a genuinely SEPARATE permission from
     portal_accounts — holding one must not satisfy the other.
   - SENSITIVE_FLOOR (admin/superadmin) bypasses unconditionally; nobody
     else does without an explicit grant, including principal/
     deputy_principal who ARE exempt for portal_accounts.
   - dryRun returns counts/sibling-overlap without writing anything —
     a student missing an admission number is reported, not silently
     dropped, and a parent with a child in a DIFFERENT class is flagged
     so the admin knows a later reset there will invalidate this one.

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
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn(() => Promise.resolve()),
  revokeIdentityTokens: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn(() => Promise.resolve()) }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    const chainOne = (obj) => ({ select: () => chainOne(obj), lean: () => Promise.resolve(obj) });
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: mockRolePerms }) }) };
    }
    if (c === 'schools') {
      return { findOne: () => chainOne({ id: SCHOOL_A, name: 'Test School', plan: 'enterprise' }) };
    }
    return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: () => chainOne(null) };
  }),
}));

/* Seed: classA has s1+s2 sharing parent p1@x.com (siblings), s3 with no
   parentEmail, s4 with no admissionNumber. classB has s5, also parented
   by p1@x.com — the sibling-overlap case. */
const STUDENTS_SEED = [
  { id: 's1', _id: 'oid_s1', schoolId: SCHOOL_A, classId: 'classA', firstName: 'Amara', lastName: 'Osei',   status: 'active', admissionNumber: 'ADM-001', parentEmail: 'p1@x.com', parentName: 'Mr Osei' },
  { id: 's2', _id: 'oid_s2', schoolId: SCHOOL_A, classId: 'classA', firstName: 'Kwame', lastName: 'Osei',   status: 'active', admissionNumber: 'ADM-002', parentEmail: 'P1@X.com', parentName: 'Mr Osei' },
  { id: 's3', _id: 'oid_s3', schoolId: SCHOOL_A, classId: 'classA', firstName: 'Zuri',  lastName: 'Kamau',  status: 'active', admissionNumber: 'ADM-003' },
  { id: 's4', _id: 'oid_s4', schoolId: SCHOOL_A, classId: 'classA', firstName: 'Noma',  lastName: 'Dube',   status: 'active' },
  { id: 's5', _id: 'oid_s5', schoolId: SCHOOL_A, classId: 'classB', firstName: 'Tendai',lastName: 'Osei',   status: 'active', admissionNumber: 'ADM-005', parentEmail: 'p1@x.com', parentName: 'Mr Osei' },
];

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      if (!cond.some(sub => matches(doc, sub))) return false;
      continue;
    }
    const val = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$nin' in cond && (cond.$nin.includes(val) || (val == null && cond.$nin.some(v => v == null)))) return false;
      if ('$ne' in cond && val === cond.$ne) return false;
      if ('$exists' in cond && cond.$exists && (val === undefined)) return false;
      if ('$in' in cond && !cond.$in.includes(val)) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

const mockStudentsColl = {
  find: (filter = {}) => ({
    select: function () { return this; },
    lean: () => Promise.resolve(STUDENTS_SEED.filter(s => matches(s, filter))),
  }),
  // Only reached on the non-dryRun write path (dryRun returns earlier) —
  // every pre-existing test here used dryRun, so this was never needed
  // until the email-backfill tests below, which exercise real writes.
  updateOne: (filter) => {
    const doc = STUDENTS_SEED.find(s => matches(s, filter));
    if (doc) doc.hasPortalAccount = true;
    return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
  },
};
const CLASSES_SEED = [{ id: 'classA', schoolId: SCHOOL_A, name: 'Class A' }, { id: 'classB', schoolId: SCHOOL_A, name: 'Class B' }];
const mockClassesColl = {
  find: (filter = {}) => ({
    select: function () { return this; },
    lean: () => Promise.resolve(CLASSES_SEED.filter(c => matches(c, filter))),
  }),
};

// Mutable seed + real findOne/updateOne — needed for the email-backfill
// test below, which exercises the actual (non-dryRun) write path. Every
// other test in this file only ever used dryRun, so `users` was never
// anything but an always-empty stub before this.
let USERS_SEED = [];
const mockUsersColl = {
  findOne: (filter = {}) => ({ lean: () => Promise.resolve(USERS_SEED.find(u => matches(u, filter)) ?? null) }),
  updateOne: (filter, update) => {
    const doc = USERS_SEED.find(u => matches(u, filter));
    if (doc && update.$set) Object.assign(doc, update.$set);
    return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
  },
};

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'students') return mockStudentsColl;
    if (collection === 'classes')  return mockClassesColl;
    if (collection === 'users')    return mockUsersColl;
    return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: () => ({ lean: () => Promise.resolve(null) }) };
  },
}));

const express        = require('express');
const supertest      = require('supertest');
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

const NON_FLOOR  = { userId: 'usr_dp', schoolId: SCHOOL_A, role: 'deputy_principal', roles: ['deputy_principal'] };
const ADMIN      = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };

describe('POST /api/students/bulk-reset-portal-passwords — permission separation', () => {
  test('deputy_principal — exempt for portal_accounts — is still forbidden without an explicit reset_passwords grant', async () => {
    mockRolePerms = { students: ['read', 'create', 'update', 'delete'] }; // ordinary access, no sub-grant
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    expect(res.status).toBe(403);
  });

  test('holding portal_accounts alone does NOT satisfy reset_passwords — the two are genuinely separate', async () => {
    mockRolePerms = { students: ['read', 'update'], students__portal_accounts: ['read', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    expect(res.status).toBe(403);
  });

  test('an explicit students__reset_passwords grant succeeds', async () => {
    mockRolePerms = { students: ['read'], students__reset_passwords: ['read', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    expect(res.status).not.toBe(403);
  });

  test('admin (SENSITIVE_FLOOR) succeeds via the floor bypass alone — no explicit grant needed', async () => {
    mockRolePerms = { students: ['read', 'update'] }; // real coarse grant so the outer rbac() gate passes; reset_passwords deliberately absent
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/students/bulk-reset-portal-passwords — dryRun counts and sibling overlap', () => {
  test('counts eligible students, lists the ineligible one, and does not write anything', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.dryRun).toBe(true);
    // s1, s2, s3 have admission numbers; s4 does not.
    expect(body.studentCount).toBe(3);
    expect(body.studentIneligible).toEqual(['Noma Dube']);
  });

  test('groups siblings within the class into one parent, case-insensitively', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    // s1 (p1@x.com) and s2 (P1@X.com) are the same parent, case-folded — one parent, not two.
    expect(res.body.data.parentCount).toBe(1);
  });

  test('flags a parent who also has a child in a different class, naming that class', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classA', dryRun: true });
    const overlap = res.body.data.siblingOverlap;
    expect(overlap).toHaveLength(1);
    expect(overlap[0].parentEmail).toBe('p1@x.com');
    expect(overlap[0].otherClasses).toEqual([{ classId: 'classB', className: 'Class B' }]);
  });

  test('overlap is symmetric — resetting classB warns about the SAME parent\'s child back in classA', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classB', dryRun: true });
    expect(res.body.data.studentCount).toBe(1);
    expect(res.body.data.siblingOverlap).toEqual([
      { parentEmail: 'p1@x.com', parentName: 'Mr Osei', otherClasses: [{ classId: 'classA', className: 'Class A' }] },
    ]);
  });
});

/* Reported directly: a school ran this reset and only 2 of many parents
   were touched. Root cause — every guardian lookup here only ever read
   student.parentEmail, the legacy single-guardian field. The 2026-09
   guardian split added independent motherEmail/fatherEmail slots used by
   the single-student /:id/parent-account route; this bulk route never
   learned about them, so any student whose guardian was only entered via
   Mother's/Father's own email was silently invisible to it — confirmed
   live at one school: 111 active students affected. */
describe('POST /api/students/bulk-reset-portal-passwords — mother/father guardian slots (2026-10)', () => {
  beforeAll(() => {
    STUDENTS_SEED.push(
      { id: 's6', _id: 'oid_s6', schoolId: SCHOOL_A, classId: 'classC', firstName: 'Mara', lastName: 'Niko', status: 'active', admissionNumber: 'ADM-006', motherEmail: 'mum6@x.com', motherName: 'Mrs Niko' },
      { id: 's7', _id: 'oid_s7', schoolId: SCHOOL_A, classId: 'classC', firstName: 'Ben',  lastName: 'Niko', status: 'active', admissionNumber: 'ADM-007', fatherEmail: 'dad7@x.com', fatherName: 'Mr Niko' },
    );
  });

  test('students whose only guardian contact is Mother\'s or Father\'s email are still counted, not silently skipped', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classC', dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.data.studentCount).toBe(2);
    // mum6@x.com and dad7@x.com — two distinct guardian accounts, neither of
    // which was ever visible to this route before this fix.
    expect(res.body.data.parentCount).toBe(2);
  });
});

/* Reported directly 2026-10-27, "this is student account sent by the
   system, but not working": a student's welcome/reset email told them to
   log in with their schoolEmail, but the account itself never had that
   email — their portal account was created BEFORE schoolEmail was added
   to their student record, and resetting an EXISTING account only ever
   touched password/status fields, never backfilled email once it became
   available. Confirmed live at one school: 264/267 students with a
   schoolEmail on file had this exact gap. */
describe('POST /api/students/bulk-reset-portal-passwords — email backfill on an existing account (2026-10-27)', () => {
  beforeAll(() => {
    STUDENTS_SEED.push(
      { id: 's8', _id: 'oid_s8', schoolId: SCHOOL_A, classId: 'classD', firstName: 'Donique', lastName: 'Chege', status: 'active', admissionNumber: '17113', schoolEmail: 'donique.chege@trinitasinternationalschool.sc.ke' },
      { id: 's9', _id: 'oid_s9', schoolId: SCHOOL_A, classId: 'classD', firstName: 'Already', lastName: 'HasEmail', status: 'active', admissionNumber: 'ADM-009', schoolEmail: 'already@x.com' },
      { id: 's10', _id: 'oid_s10', schoolId: SCHOOL_A, classId: 'classD', firstName: 'Taken', lastName: 'Email', status: 'active', admissionNumber: 'ADM-010', schoolEmail: 'collision@x.com' },
    );
  });

  beforeEach(() => {
    USERS_SEED = [
      // s8: account created before schoolEmail existed — username only, no email yet.
      { _id: 'u_s8', id: 'u_s8', schoolId: SCHOOL_A, role: 'student', studentId: 's8', username: '17113', email: undefined },
      // s9: already has the right email — must not be touched/overwritten.
      { _id: 'u_s9', id: 'u_s9', schoolId: SCHOOL_A, role: 'student', studentId: 's9', username: 'adm-009', email: 'already@x.com' },
      // s10: wants collision@x.com, but another (non-student) account already owns it.
      { _id: 'u_s10', id: 'u_s10', schoolId: SCHOOL_A, role: 'student', studentId: 's10', username: 'adm-010', email: undefined },
      { _id: 'u_other', id: 'u_other', schoolId: SCHOOL_A, role: 'parent', email: 'collision@x.com' },
    ];
  });

  test('backfills email onto an existing account whose schoolEmail was added after creation', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    const res = await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classD', dryRun: false });
    expect(res.status).toBe(200);
    const u8 = USERS_SEED.find(u => u.id === 'u_s8');
    expect(u8.email).toBe('donique.chege@trinitasinternationalschool.sc.ke');
    expect(u8.password).toBeTruthy(); // password reset still happened as normal
  });

  test('does not touch an account that already has the correct email', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classD', dryRun: false });
    const u9 = USERS_SEED.find(u => u.id === 'u_s9');
    expect(u9.email).toBe('already@x.com');
  });

  test('never overwrites/collides with an email already owned by a different account', async () => {
    mockRolePerms = { students: ['read', 'update'] };
    await supertest(buildApp(ADMIN)).post('/api/students/bulk-reset-portal-passwords').send({ classId: 'classD', dryRun: false });
    const u10 = USERS_SEED.find(u => u.id === 'u_s10');
    expect(u10.email).toBeUndefined();
    expect(u10.password).toBeTruthy(); // the reset itself still succeeds
  });
});
