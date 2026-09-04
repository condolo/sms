/* ============================================================
   POST /api/import-export/students — 2026-09 field update
   (Mother/Father split, required Gender/DOB, Allergies, Emergency
   Contact — same field set added to the Admissions application form,
   here mirrored onto the student bulk-import template)

   Covers:
     1. dateOfBirth/gender are now required on import too (previously
        optional) — same rule as the Admissions form.
     2. At least one parent is required — EITHER the legacy parentName
        (+ phone/email) columns, OR the new Mother/Father columns. This
        is the backward-compatibility guarantee: an existing customer
        CSV file built before Mother/Father existed, using only the
        old columns, must keep working completely unchanged.
     3. Mother/Father data derives parentName/Email/Phone (via the
        SAME shared server/utils/guardian-contact.js Admissions uses —
        not a hand-copied second implementation) when the new columns
        are used instead of/alongside the legacy ones.
     4. Allergies and Emergency Contact land under `medical.*` — the
        exact shape the Student Profile's own Medical tab already
        reads/writes — not a new, disconnected top-level field.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) ?? null),
    insertMany: async (newDocs) => { docs.push(...newDocs); return newDocs; },
    _docs: () => docs,
  };
}

const SCHOOL = 'school_test_001';

let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((col) => mockStores[col]),
}));
jest.mock('../../utils/counters', () => ({
  reserveAdmissionNumbers: jest.fn((schoolId, n) => Promise.resolve(Array.from({ length: n }, (_, i) => `ADM-${i + 1}`))),
  reserveStaffIds: jest.fn(),
  reserveInvoiceNumbers: jest.fn((schoolId, n) => Promise.resolve(Array.from({ length: n }, (_, i) => `INV-${i + 1}`))),
}));

let mockCurrentPeriod;
jest.mock('../../utils/academic-period', () => ({
  resolveAcademicPeriod: jest.fn(() => Promise.resolve(mockCurrentPeriod)),
}));

const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const express   = require('express');
const supertest = require('supertest');
const importExportRouter = require('../../routes/import-export');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockCurrentPeriod = { academicYearId: 'ay_2026', termId: 'term_1' };
  mockStores = {
    students: makeStore([]),
    classes:  makeStore([]),
    streams:  makeStore([]),
    invoices: makeStore([]),
    payments: makeStore([]),
    schools:  makeStore([{ id: SCHOOL, admissionConfig: {}, houses: [] }]),
  };
});

const BASE = { firstName: 'Amara', lastName: 'Osei', dateOfBirth: '2015-03-14', gender: 'female' };

describe('required fields', () => {
  test('missing dateOfBirth is rejected', async () => {
    const { dateOfBirth, ...withoutDob } = { ...BASE, parentName: 'Kofi', parentPhone: '0700' };
    const res = await supertest(buildApp()).post('/api/import-export/students').send({ rows: [withoutDob] });
    expect(res.body.data.errors[0].field).toBe('dateOfBirth');
  });

  test('missing gender is rejected', async () => {
    const { gender, ...withoutGender } = { ...BASE, parentName: 'Kofi', parentPhone: '0700' };
    const res = await supertest(buildApp()).post('/api/import-export/students').send({ rows: [withoutGender] });
    expect(res.body.data.errors[0].field).toBe('gender');
  });
});

describe('guardian requirement — backward compatible with legacy-only CSV files', () => {
  test('a row using ONLY the legacy parentName+parentPhone columns (no Mother/Father at all) still works unchanged', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students')
      .send({ rows: [{ ...BASE, parentName: 'Kofi Osei', parentPhone: '+254712345678' }] });
    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].parentName).toBe('Kofi Osei');
  });

  test('a row with NEITHER legacy parent columns NOR Mother/Father is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students').send({ rows: [BASE] });
    expect(res.body.data.errors[0].field).toBe('motherName');
    expect(mockStores.students._docs()).toHaveLength(0);
  });

  test('Mother-only (no legacy parentName at all) is accepted, given her email', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students')
      .send({ rows: [{ ...BASE, motherName: 'Adjoa Osei', motherPhone: '+254700000001', motherEmail: 'adjoa@example.com' }] });
    expect(res.status).toBe(201);
  });

  test('THE TIGHTENED RULE: Mother\'s name with a phone but no email is rejected — email is mandatory per parent, not phone-or-email', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students')
      .send({ rows: [{ ...BASE, motherName: 'Adjoa Osei', motherPhone: '+254700000001' }] });
    expect(res.body.data.errors[0].field).toBe('motherEmail');
    expect(mockStores.students._docs()).toHaveLength(0);
  });
});

describe('Mother/Father derivation — same shared logic as Admissions', () => {
  test('derives parentName/Email/Phone from Mother when primaryContact is unset', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students').send({
      rows: [{ ...BASE, motherName: 'Adjoa Osei', motherPhone: '+254700000001', motherEmail: 'adjoa@example.com' }],
    });
    expect(res.status).toBe(201);
    const doc = mockStores.students._docs()[0];
    expect(doc.parentName).toBe('Adjoa Osei');
    expect(doc.parentEmail).toBe('adjoa@example.com');
    expect(doc.parentRelationship).toBe('Mother');
    expect(doc.motherName).toBe('Adjoa Osei'); // raw field preserved too
  });

  test('explicit primaryContact=father wins even when mother is also filled', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students').send({
      rows: [{
        ...BASE, primaryContact: 'father',
        motherName: 'Adjoa Osei', motherPhone: '+254700000001', motherEmail: 'adjoa@example.com',
        fatherName: 'Kofi Osei', fatherPhone: '+254712345678', fatherEmail: 'kofi@example.com',
      }],
    });
    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].parentName).toBe('Kofi Osei');
    expect(mockStores.students._docs()[0].parentRelationship).toBe('Father');
  });

  test('an invalid motherEmail is rejected with a clear field-level error', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students').send({
      rows: [{ ...BASE, motherName: 'Adjoa', motherPhone: '0700', motherEmail: 'not-an-email' }],
    });
    expect(res.body.data.errors[0].field).toBe('motherEmail');
    expect(mockStores.students._docs()).toHaveLength(0);
  });
});

describe('Allergies / Emergency Contact — land under medical.*, matching the Student Profile Medical tab', () => {
  test('allergies and emergency contact are nested under medical, not a new top-level field', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students').send({
      rows: [{
        ...BASE, parentName: 'Kofi', parentPhone: '0700',
        allergies: 'Peanuts',
        emergencyContactName: 'Aunt Abena', emergencyContactPhone: '0722000000', emergencyContactRelation: 'Aunt',
      }],
    });
    expect(res.status).toBe(201);
    const doc = mockStores.students._docs()[0];
    expect(doc.medical).toEqual({
      allergies: 'Peanuts',
      emergencyName: 'Aunt Abena', emergencyPhone: '0722000000', emergencyRelation: 'Aunt',
    });
    expect(doc.allergies).toBeUndefined(); // never a stray top-level field
  });

  test('no medical field at all is set when none of allergies/emergency contact are provided', async () => {
    const res = await supertest(buildApp()).post('/api/import-export/students')
      .send({ rows: [{ ...BASE, parentName: 'Kofi', parentPhone: '0700' }] });
    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].medical).toBeUndefined();
  });
});
