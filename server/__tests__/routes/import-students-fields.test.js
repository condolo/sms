/* ============================================================
   POST /api/import-export/students — field completeness fixes
   (onboarding import templates update, 2026-08)

   Three gaps found while auditing the template against the real
   students.js schema/validation:
     1. VALID_STATUS was missing 'withdrawn' — a real, live status
        (students.js's own enum, and the default list filter excludes it
        by name) that the importer rejected as invalid.
     2. Bulk import bypasses StudentCreateSchema entirely (builds docs
        directly), so it never set enrollmentAcademicYearId/
        enrollmentTermId — fields every student created through the
        regular Add Student form always gets (client defaults to the
        live-resolved current period). Now resolved server-side once per
        batch via the same resolveAcademicPeriod() utility.
     3. No way to assign a student's house on import at all, despite
        houseId being read by report-cards.js/teachers.js/scopeMiddleware.js
        — added houseName, resolved against school.houses the same way
        className/streamName already resolve against live classes/streams.

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
  app.use(express.text({ type: 'text/csv' }));
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockCurrentPeriod = { academicYearId: 'ay_2026', termId: 'term_1' };
  mockStores = {
    students: makeStore([]),
    classes:  makeStore([{ id: 'cls_1', schoolId: SCHOOL, name: 'Grade 3' }]),
    streams:  makeStore([]),
    invoices: makeStore([]),
    payments: makeStore([]),
    schools:  makeStore([{ id: SCHOOL, admissionConfig: {}, houses: [{ id: 'house_baobab', name: 'Baobab' }] }]),
  };
});

function row(overrides = {}) {
  return { firstName: 'Amara', lastName: 'Osei', ...overrides };
}

describe('POST /api/import-export/students — status validation', () => {
  test('"withdrawn" is now a valid status (was previously rejected)', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ status: 'withdrawn' })] });

    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].status).toBe('withdrawn');
  });

  test('a genuinely invalid status is still rejected', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ status: 'made_up_status' })] });

    expect(res.body.data.created).toBe(0);
    expect(mockStores.students._docs()).toHaveLength(0);
  });
});

describe('POST /api/import-export/students — enrollment period auto-resolution', () => {
  test('imported students get the live-resolved current academic year/term, matching the regular Add Student form default', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].enrollmentAcademicYearId).toBe('ay_2026');
    expect(mockStores.students._docs()[0].enrollmentTermId).toBe('term_1');
  });

  test('a brand-new school with no academic years configured yet does not error — just leaves the fields unset', async () => {
    mockCurrentPeriod = { academicYearId: null, termId: null };
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].enrollmentAcademicYearId).toBeUndefined();
  });
});

describe('POST /api/import-export/students — houseName resolution', () => {
  test('a real house name resolves to houseId', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ houseName: 'Baobab' })] });

    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].houseId).toBe('house_baobab');
  });

  test('an unmatched house name is rejected with a clear, actionable error — not silently dropped', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ houseName: 'Nonexistent House' })] });

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors[0].field).toBe('houseName');
    expect(mockStores.students._docs()).toHaveLength(0);
  });

  test('blank houseName is fine — house assignment is optional', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].houseId).toBeUndefined();
  });
});

describe('POST /api/import-export/students — className still resolves against live data (regression check)', () => {
  test('className correctly resolves to a real classId', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ className: 'Grade 3' })] });

    expect(res.status).toBe(201);
    expect(mockStores.students._docs()[0].classId).toBe('cls_1');
  });

  test('an unmatched className is still rejected (never silently stored as free text)', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ className: 'Nonexistent Class' })] });

    expect(res.body.data.created).toBe(0);
    expect(mockStores.students._docs()).toHaveLength(0);
  });
});

describe('POST /api/import-export/students — opening-fee invoice creation is now audited (cross-module import audit)', () => {
  test('creating an opening-fee invoice via import logs finance.invoices_imported, matching how every other invoice-creating route is audited', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ openingFeeAmount: '45000', openingFeePaid: '20000' })] });

    expect(res.status).toBe(201);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'finance.invoices_imported',
      schoolId: SCHOOL,
      details: expect.objectContaining({ invoicesCreated: 1 }),
    }));
  });

  test('no audit entry when the batch creates no invoices at all (no openingFeeAmount rows)', async () => {
    await supertest(buildApp())
      .post('/api/import-export/students')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
