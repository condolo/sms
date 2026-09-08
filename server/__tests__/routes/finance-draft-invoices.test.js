/* ============================================================
   Draft invoices — server/routes/finance.js
   (Part 4 of the 2026-09 school-driven Finance request)

   Admission-triggered invoices (utils/admission-billing.js) are always
   created with status 'draft' — Finance reviews before a parent ever
   sees one. Covers the rest of that lifecycle, on the finance.js side:

     1. PATCH /invoices/:id/issue moves a draft to 'unpaid' — the only
        way out of 'draft' — and rejects being called on anything else.
     2. POST /payments refuses to record a payment against a draft
        invoice (it hasn't been issued to the parent yet).
     3. GET /summary excludes draft invoices from totals — an
        unissued admission invoice isn't a real receivable yet.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/counters', () => ({
  nextInvoiceNumber: jest.fn().mockResolvedValue('INV-1'),
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-1'),
}));
const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v)   return doc[k] !== v.$ne;
      if ('$nin' in v)  return !v.$nin.includes(doc[k]);
      if ('$in' in v)   return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}
function mockChainArr(arr) { return { sort: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter, update, opts) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const set = update.$set ?? update;
      docs[idx] = { ...docs[idx], ...set };
      return mockChainObj(docs[idx]);
    }),
    aggregate: jest.fn((pipeline) => {
      // tenantModel() prepends its OWN {$match:{schoolId}} stage ahead of
      // the route's own $match (see utils/tenant-model.js's
      // _scopedPipeline) — fold every $match stage together, not just
      // the first one, or the route's real filter gets silently ignored.
      const matchStages = pipeline.filter(s => s.$match).map(s => s.$match);
      const matched = docs.filter(d => matchStages.every(m => matchesFilter(d, m)));
      const totalInvoiced = matched.reduce((s, d) => s + (d.total || 0), 0);
      const totalBalance  = matched.reduce((s, d) => s + (d.balance || 0), 0);
      return Promise.resolve([{ totalInvoiced, totalBalance, totalPaid: 0, countInvoices: matched.length, countPaid: 0, countUnpaid: 0, countPartial: 0 }]);
    }),
    deleteOne: jest.fn(() => Promise.resolve({})),
  };
}

let mockInvoices, mockPayments, mockStudents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'invoices') return mockInvoices;
    if (c === 'payments') return mockPayments;
    if (c === 'students') return mockStudents;
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

const DRAFT_INVOICE = {
  id: 'inv_draft', schoolId: SCHOOL, studentId: 'stu_1', studentName: 'Amara Osei',
  invoiceNumber: 'INV-100', lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }],
  discountPct: 0, taxPct: 0, subtotal: 15000, discountAmount: 0, taxAmount: 0, total: 15000,
  amountPaid: 0, balance: 15000, status: 'draft',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPayments = makeFakeCollection([]);
  mockStudents = makeFakeCollection([{ id: 'stu_1', schoolId: SCHOOL, firstName: 'Amara', lastName: 'Osei' }]);
});

describe('PATCH /api/finance/invoices/:id/issue', () => {
  test('a draft invoice moves to unpaid, gains issuedAt/issuedBy, and is audit-logged', async () => {
    mockInvoices = makeFakeCollection([{ ...DRAFT_INVOICE }]);
    const res = await supertest(buildApp()).patch('/api/finance/invoices/inv_draft/issue');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('unpaid');
    expect(res.body.data.issuedAt).toBeTruthy();
    expect(res.body.data.issuedBy).toBe('usr_admin');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.invoice_issued' }));
  });

  test('an already-unpaid invoice cannot be issued again', async () => {
    mockInvoices = makeFakeCollection([{ ...DRAFT_INVOICE, status: 'unpaid' }]);
    const res = await supertest(buildApp()).patch('/api/finance/invoices/inv_draft/issue');
    expect(res.status).toBe(400);
    expect(mockInvoices._docs()[0].status).toBe('unpaid'); // unchanged
  });

  test('a nonexistent invoice returns 404', async () => {
    mockInvoices = makeFakeCollection([]);
    const res = await supertest(buildApp()).patch('/api/finance/invoices/nope/issue');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/finance/payments — draft invoices', () => {
  test('recording a payment against a draft invoice is rejected', async () => {
    mockInvoices = makeFakeCollection([{ ...DRAFT_INVOICE }]);
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_draft', amount: 15000, method: 'cash',
    });
    expect(res.status).toBe(400);
    expect(mockPayments._docs()).toHaveLength(0);
  });
});

describe('GET /api/finance/summary — excludes draft invoices', () => {
  test('a draft invoice contributes nothing to totalInvoiced/totalBalance', async () => {
    mockInvoices = makeFakeCollection([
      { ...DRAFT_INVOICE, id: 'inv_draft' },
      { id: 'inv_real', schoolId: SCHOOL, status: 'unpaid', total: 5000, balance: 5000, amountPaid: 0 },
    ]);
    const res = await supertest(buildApp()).get('/api/finance/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.invoices.totalInvoiced).toBe(5000); // draft's 15000 excluded
    expect(res.body.data.invoices.countInvoices).toBe(1);
  });
});
