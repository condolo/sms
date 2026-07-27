/* ============================================================
   _resolveAcademicPeriod — server/routes/finance.js

   Invoices and fee structures used to store academic year/term two
   different ways (Invoices: academicYearId/termId FK-style; Fee
   Structures: academicYear/term free strings) with no validation
   against the school's real academic_years records — so a bulk-
   generated invoice's year/term never actually matched what the
   Invoices list/summary filters searched for. This covers the fix:
   both now resolve+validate through _resolveAcademicPeriod, mirroring
   report-cards.js's _resolveTermScope + exams.js's FK-validation style.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/counters', () => ({
  nextInvoiceNumber: jest.fn().mockResolvedValue('INV-1'),
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-1'),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$in' in v) return Array.isArray(doc[k]) ? v.$in.some(x => doc[k].includes(x)) : v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}
function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    distinct: jest.fn(() => Promise.resolve([])),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
  };
}

/** YYYY-MM-DD `n` days offset from today, UTC-based (matches resolveCurrentPeriod's own todayStr basis). */
function dateOffset(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let mockAcademicYears = makeFakeCollection();
let mockInvoices      = makeFakeCollection();
let mockFeeStructures = makeFakeCollection();
let mockStudents      = makeFakeCollection();

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_years') return mockAcademicYears;
    if (c === 'invoices')       return mockInvoices;
    if (c === 'fee_structures') return mockFeeStructures;
    if (c === 'students')       return mockStudents;
    if (c === 'schools')        return { findOne: jest.fn(() => mockChainObj({ currency: 'KES' })) };
    if (c === 'audit_logs')     return { create: jest.fn().mockResolvedValue({}) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const financeRouter = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRouter);
  return app;
}

// One school year (current) running through today, with a term that also spans today.
const CURRENT_YEAR = {
  id: 'ay_2026', schoolId: SCHOOL_A, name: '2026', isCurrent: true,
  startDate: dateOffset(-100), endDate: dateOffset(100),
  terms: [
    { id: 'term_2026_1', name: 'Term 1', startDate: dateOffset(-100), endDate: dateOffset(-30) },
    { id: 'term_2026_2', name: 'Term 2', startDate: dateOffset(-10), endDate: dateOffset(60) },
  ],
};
const OTHER_YEAR = {
  id: 'ay_2025', schoolId: SCHOOL_A, name: '2025', isCurrent: false,
  startDate: '2025-01-01', endDate: '2025-12-15',
  terms: [{ id: 'term_2025_1', name: 'Term 1', startDate: '2025-01-06', endDate: '2025-04-04' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAcademicYears = makeFakeCollection([CURRENT_YEAR, OTHER_YEAR]);
  mockInvoices      = makeFakeCollection();
  mockFeeStructures = makeFakeCollection();
  mockStudents      = makeFakeCollection();
});

describe('POST /invoices — academic period resolution', () => {
  const basePayload = { studentId: 'stu_1', lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }] };

  test('no academicYearId/termId given → defaults to the live-resolved current year+term', async () => {
    const res = await supertest(buildApp()).post('/api/finance/invoices').send(basePayload);
    expect(res.status).toBe(201);
    expect(res.body.data.academicYearId).toBe('ay_2026');
    expect(res.body.data.termId).toBe('term_2026_2'); // the term spanning "today"
  });

  test('explicit valid academicYearId + termId are honoured as-is', async () => {
    const res = await supertest(buildApp()).post('/api/finance/invoices').send({
      ...basePayload, academicYearId: 'ay_2025', termId: 'term_2025_1',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.academicYearId).toBe('ay_2025');
    expect(res.body.data.termId).toBe('term_2025_1');
  });

  test('an academicYearId with no termId is valid (year-wide scope) — term stays unset', async () => {
    const res = await supertest(buildApp()).post('/api/finance/invoices').send({
      ...basePayload, academicYearId: 'ay_2025',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.academicYearId).toBe('ay_2025');
    expect(res.body.data.termId).toBeNull();
  });

  test('an unknown academicYearId is rejected, not silently dropped', async () => {
    const res = await supertest(buildApp()).post('/api/finance/invoices').send({
      ...basePayload, academicYearId: 'not_a_real_year',
    });
    expect(res.status).toBe(400);
    expect(mockInvoices.create).not.toHaveBeenCalled();
  });

  test('a termId that does not belong to the given year is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/finance/invoices').send({
      ...basePayload, academicYearId: 'ay_2025', termId: 'term_2026_1', // term from the OTHER year
    });
    expect(res.status).toBe(400);
    expect(mockInvoices.create).not.toHaveBeenCalled();
  });
});

describe('PUT /invoices/:id — untouched academicYearId/termId are left alone', () => {
  test('updating unrelated fields does not null out a previously-set period', async () => {
    mockInvoices = makeFakeCollection([{
      id: 'inv_1', schoolId: SCHOOL_A, status: 'unpaid', lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
      academicYearId: 'ay_2025', termId: 'term_2025_1', discountPct: 0, taxPct: 0, total: 1000,
    }]);
    const res = await supertest(buildApp()).put('/api/finance/invoices/inv_1').send({ notes: 'updated note' });
    expect(res.status).toBe(200);
    expect(res.body.data.academicYearId).toBe('ay_2025');
    expect(res.body.data.termId).toBe('term_2025_1');
  });
});

describe('fee structures + /generate — same resolution, propagated onto created invoices', () => {
  test('POST /fee-structures resolves and validates the same way as invoices', async () => {
    const res = await supertest(buildApp()).post('/api/finance/fee-structures').send({
      name: 'Term 1 Fees', academicYearId: 'ay_2025', termId: 'term_2025_1',
      lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.academicYearId).toBe('ay_2025');
    expect(res.body.data.termId).toBe('term_2025_1');
  });

  test('/generate copies the fee structure\'s resolved academicYearId/termId onto every created invoice', async () => {
    mockFeeStructures = makeFakeCollection([{
      id: 'fs_1', schoolId: SCHOOL_A, name: 'Term 1 Fees', scopeType: 'all',
      academicYearId: 'ay_2025', termId: 'term_2025_1',
      lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
    }]);
    mockStudents = makeFakeCollection([
      { id: 's1', schoolId: SCHOOL_A, status: 'active', firstName: 'A', lastName: 'One' },
    ]);

    const res = await supertest(buildApp()).post('/api/finance/fee-structures/fs_1/generate');
    expect(res.status).toBe(201);
    expect(res.body.data.invoices[0].academicYearId).toBe('ay_2025');
    expect(res.body.data.invoices[0].termId).toBe('term_2025_1');
  });
});
