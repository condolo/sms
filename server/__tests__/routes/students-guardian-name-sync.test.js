/* ============================================================
   PUT /api/students/:id — editing a guardian's name now syncs their
   already-created parent portal account's display name (2026-10-13).

   Reported directly: "a parent had a wrong name in their portal, one
   of the admins edited the parent details in the student profile but
   did not reflect to the parent." Root cause: a parent portal account
   is created ONCE (POST /:id/parent-account, see
   students-parent-account.test.js) from whichever of
   parentName/motherName/fatherName the account was created for, and
   nothing re-synced `users.name` when that field was edited later —
   this route only ever wrote the student document.

   Fix matches by EMAIL (lowercased/trimmed the same way account
   creation stores it) + guardianOf containing this student, never by
   studentId alone (one account can be shared across siblings), and
   only touches `name` — never the login email itself, even if the
   email field is also edited in the same request.

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

const SCHOOL = 'school_test_001';

// .lean() in real Mongoose returns an independent plain-object snapshot,
// not a live reference into whatever the document becomes later — clone
// here so `existing` (fetched BEFORE applyOptimisticLock's mock mutates
// mockStudentDoc in place) stays a true "before" snapshot, exactly like
// the real route relies on to detect which field actually changed.
function mockChain(result) {
  const snapshot = result && typeof result === 'object' ? { ...result } : result;
  return { select: () => mockChain(snapshot), lean: () => Promise.resolve(snapshot) };
}

let mockStudentDoc;
let mockUsersDocs;
let mockUsersUpdateCalls;

// applyOptimisticLock itself is mocked directly below (it's a thin
// findOneAndUpdate wrapper with its own dedicated test coverage
// elsewhere) — this file only needs it to apply `data` onto
// mockStudentDoc and hand back the merged doc, exactly what the real
// one does against a real Mongo document.
jest.mock('../../utils/optimistic-lock', () => ({
  applyOptimisticLock: jest.fn(async (_Model, _filter, updateFields) => {
    Object.assign(mockStudentDoc, updateFields);
    return { doc: { ...mockStudentDoc }, conflict: false };
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
      };
    }
    if (collection === 'users') {
      return {
        updateOne: (filter, update) => {
          mockUsersUpdateCalls.push({ filter, update });
          const match = mockUsersDocs.find(u =>
            u.schoolId === filter.schoolId && u.role === filter.role &&
            u.email === filter.email &&
            (Array.isArray(u.guardianOf) ? u.guardianOf.includes(filter.guardianOf) : false)
          );
          if (match && update.$set) Object.assign(match, update.$set);
          return Promise.resolve({ matchedCount: match ? 1 : 0 });
        },
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

const express        = require('express');
const supertest       = require('supertest');
const studentsRouter  = require('../../routes/students');

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
    firstName: 'Amara', lastName: 'Osei', _v: 1,
    parentName: 'Adjoa Osei', parentEmail: 'adjoa@example.com',
    motherName: 'Adjoa Osei', motherEmail: 'adjoa@example.com',
    fatherName: 'Kofi Osei',  fatherEmail: 'kofi@example.com',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = makeStudent();
  mockUsersDocs  = [];
  mockUsersUpdateCalls = [];
});

test("correcting the mother's name syncs her ALREADY-CREATED parent account", async () => {
  // Student record (and the account created from it) both still carry
  // the original typo — this is the admin's correction.
  mockStudentDoc = makeStudent({ motherName: 'Adjao Osei' });
  mockUsersDocs = [{
    schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com',
    name: 'Adjao Osei', guardianOf: ['stu_001'], studentIds: ['stu_001'],
  }];

  const res = await supertest(buildApp()).put('/api/students/stu_001').send({ motherName: 'Adjoa Osei' });

  expect(res.status).toBe(200);
  expect(mockUsersDocs[0].name).toBe('Adjoa Osei');
});

test("correcting the father's name does NOT touch the mother's account", async () => {
  mockStudentDoc = makeStudent({ fatherName: 'Kofi Osie' }); // typo being corrected
  mockUsersDocs = [
    { schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', name: 'Adjoa Osei', guardianOf: ['stu_001'] },
    { schoolId: SCHOOL, role: 'parent', email: 'kofi@example.com',  name: 'Kofi Osie',  guardianOf: ['stu_001'] },
  ];

  const res = await supertest(buildApp()).put('/api/students/stu_001').send({ fatherName: 'Kofi Osei' });

  expect(res.status).toBe(200);
  expect(mockUsersDocs.find(u => u.email === 'kofi@example.com').name).toBe('Kofi Osei');
  expect(mockUsersDocs.find(u => u.email === 'adjoa@example.com').name).toBe('Adjoa Osei'); // unchanged
});

test('no linked parent account yet — the student edit still succeeds, nothing to sync', async () => {
  mockUsersDocs = []; // guardian never activated a portal account

  const res = await supertest(buildApp()).put('/api/students/stu_001').send({ motherName: 'Adjoa K. Osei' });

  expect(res.status).toBe(200);
  expect(res.body.data.motherName).toBe('Adjoa K. Osei');
});

test('editing an UNRELATED field (e.g. phone) never touches the users collection', async () => {
  mockUsersDocs = [{ schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', name: 'Adjoa Osei', guardianOf: ['stu_001'] }];

  const res = await supertest(buildApp()).put('/api/students/stu_001').send({ motherPhone: '+254700999999' });

  expect(res.status).toBe(200);
  expect(mockUsersUpdateCalls).toHaveLength(0);
});

test('only touches the account matching THIS student via guardianOf — a same-email account not linked to this student is untouched', async () => {
  // A different school's/child's account that happens to share the same email string is not realistic in
  // practice (schoolId differs), but the guardianOf check is the real guard being exercised here: an account
  // with the right email but NOT guardianOf this student must not be matched.
  mockUsersDocs = [{ schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', name: 'Someone Else', guardianOf: ['stu_other_child'] }];

  const res = await supertest(buildApp()).put('/api/students/stu_001').send({ motherName: 'Adjoa Osei (corrected)' });

  expect(res.status).toBe(200);
  expect(mockUsersDocs[0].name).toBe('Someone Else'); // untouched — not this student's account
});
