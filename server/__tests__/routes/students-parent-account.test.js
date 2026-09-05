/* ============================================================
   POST /api/students/:id/parent-account — per-parent accounts (2026-09)

   Covers:
     1. Legacy behaviour (no `guardian` in the body) is completely
        unchanged — still keyed off student.parentEmail/parentName,
        still sets hasParentAccount.
     2. guardian: 'mother' creates an account from motherEmail/
        motherName and sets hasMotherAccount — independently of any
        father or legacy account.
     3. guardian: 'father' creates an account from fatherEmail/
        fatherName and sets hasFatherAccount.
     4. Mother and Father accounts are genuinely independent: creating
        one never touches the other's flag, and each is looked up/
        created by its OWN email.
     5. guardian: 'mother' with no motherEmail on file is rejected
        with a clear, guardian-specific error (not the generic legacy
        message).
     6. SIBLING-AWARE: a second call for the same guardian email (a
        second child of the same mother) adds to that parent's
        existing studentIds/guardianOf instead of creating a duplicate
        Users doc — proven per-guardian, not just for the legacy path.
     7. `guardian` outside {'mother','father'} is rejected as a bad
        request, not silently treated as legacy.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/counters', () => ({
  nextAdmissionNumber:     jest.fn().mockResolvedValue('ADM-001'),
  reserveAdmissionNumbers: jest.fn().mockResolvedValue(['ADM-001']),
}));
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../utils/email', () => ({
  sendWelcomeCredentials: jest.fn().mockResolvedValue(null),
}));

const SCHOOL = 'school_test_001';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockUsersDocs;
let mockStudentDoc;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return { findOne: () => mockChain({ id: SCHOOL, name: 'Test School', plan: 'enterprise', systemEmail: '', slug: 'test' }) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((collection) => {
    if (collection === 'students') {
      return {
        findOne: (filter) => mockChain(
          (mockStudentDoc && (filter.id === mockStudentDoc.id || filter._id === mockStudentDoc._id))
            ? mockStudentDoc
            : null
        ),
        updateOne: (filter, update) => {
          if (mockStudentDoc) Object.assign(mockStudentDoc, update.$set);
          return Promise.resolve({ matchedCount: 1 });
        },
      };
    }
    if (collection === 'users') {
      return {
        findOne: (filter) => mockChain(mockUsersDocs.find((u) => u.email === filter.email && u.schoolId === filter.schoolId && u.role === filter.role) ?? null),
        create: (doc) => { const d = { ...doc, _id: `uid_${mockUsersDocs.length + 1}` }; mockUsersDocs.push(d); return Promise.resolve(d); },
        updateOne: (filter, update) => {
          const d = mockUsersDocs.find((u) => u._id === filter._id);
          if (!d) return Promise.resolve({ matchedCount: 0 });
          if (update.$addToSet) {
            for (const [k, v] of Object.entries(update.$addToSet)) {
              d[k] = Array.isArray(d[k]) ? d[k] : [];
              if (!d[k].includes(v)) d[k].push(v);
            }
          }
          if (update.$set) Object.assign(d, update.$set);
          return Promise.resolve({ matchedCount: 1 });
        },
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
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

function makeStudent(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    id:  'stu_001',
    schoolId: SCHOOL,
    firstName: 'Amara', lastName: 'Osei',
    parentName: 'Adjoa Osei', parentEmail: 'adjoa@example.com', parentPhone: '+254700000001', parentRelationship: 'Mother',
    motherName: 'Adjoa Osei', motherEmail: 'adjoa@example.com', motherPhone: '+254700000001',
    fatherName: 'Kofi Osei',  fatherEmail: 'kofi@example.com',  fatherPhone: '+254712345678',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsersDocs = [];
  mockStudentDoc = makeStudent();
});

describe('legacy path (no guardian) — unchanged', () => {
  test('creates the shared account from parentEmail/parentName and sets hasParentAccount', async () => {
    const res = await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('adjoa@example.com');
    expect(res.body.data.guardian).toBeNull();
    expect(mockStudentDoc.hasParentAccount).toBe(true);
    expect(mockStudentDoc.hasMotherAccount).toBeUndefined();
    expect(mockUsersDocs).toHaveLength(1);
  });
});

describe('per-parent accounts', () => {
  test("guardian: 'mother' creates an account from motherEmail/motherName, sets hasMotherAccount only", async () => {
    const res = await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'mother' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('adjoa@example.com');
    expect(res.body.data.guardian).toBe('mother');
    expect(mockStudentDoc.hasMotherAccount).toBe(true);
    expect(mockStudentDoc.hasFatherAccount).toBeUndefined();
    expect(mockStudentDoc.hasParentAccount).toBeUndefined();
  });

  test("guardian: 'father' creates an INDEPENDENT account from fatherEmail/fatherName, sets hasFatherAccount only", async () => {
    const res = await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'father' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('kofi@example.com');
    expect(res.body.data.guardian).toBe('father');
    expect(mockStudentDoc.hasFatherAccount).toBe(true);
    expect(mockStudentDoc.hasMotherAccount).toBeUndefined();
  });

  test('creating BOTH mother and father accounts produces two separate Users docs, each with a distinct email', async () => {
    await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'mother' });
    await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'father' });
    expect(mockUsersDocs).toHaveLength(2);
    const emails = mockUsersDocs.map((u) => u.email).sort();
    expect(emails).toEqual(['adjoa@example.com', 'kofi@example.com']);
    expect(mockStudentDoc.hasMotherAccount).toBe(true);
    expect(mockStudentDoc.hasFatherAccount).toBe(true);
  });

  test("guardian: 'mother' with no motherEmail on file is rejected with a mother-specific message", async () => {
    mockStudentDoc = makeStudent({ motherEmail: '' });
    const res = await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'mother' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Mother's email/i);
    expect(mockUsersDocs).toHaveLength(0);
  });

  test("guardian outside {'mother','father'} is rejected, not silently treated as legacy", async () => {
    const res = await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'grandma' });
    expect(res.status).toBe(400);
    expect(mockUsersDocs).toHaveLength(0);
  });
});

describe('sibling-aware per guardian', () => {
  test("a second call with the SAME mother email (another child) adds to her existing account instead of duplicating it", async () => {
    // First child already has Mother's account.
    mockUsersDocs = [{
      _id: 'uid_existing', id: 'u1', schoolId: SCHOOL, role: 'parent',
      name: 'Adjoa Osei', email: 'adjoa@example.com', studentIds: ['stu_sibling'], guardianOf: ['stu_sibling'],
    }];
    const res = await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'mother' });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('updated');
    expect(mockUsersDocs).toHaveLength(1); // no duplicate account created
    expect(mockUsersDocs[0].studentIds.sort()).toEqual(['stu_001', 'stu_sibling'].sort());
    expect(mockUsersDocs[0].guardianOf).toContain('stu_001');
  });

  test('Father\'s existing account (from a sibling) is untouched by a Mother-only call for this child', async () => {
    mockUsersDocs = [{
      _id: 'uid_father', id: 'u2', schoolId: SCHOOL, role: 'parent',
      name: 'Kofi Osei', email: 'kofi@example.com', studentIds: ['stu_sibling'], guardianOf: ['stu_sibling'],
    }];
    await supertest(buildApp()).post('/api/students/stu_001/parent-account').send({ guardian: 'mother' });
    // Father's account gained no new student — a brand-new Mother account was created instead.
    const father = mockUsersDocs.find((u) => u.email === 'kofi@example.com');
    expect(father.studentIds).toEqual(['stu_sibling']);
    expect(mockUsersDocs).toHaveLength(2);
  });
});
