/* ============================================================
   Early Payment discount — server/routes/finance.js POST /payments

   Part 3 of the 2026-09 discount-types request. Unlike sibling/
   director/referral (resolved once at invoice-generation time), Early
   Payment depends on WHEN the family actually pays — unknowable until
   a real payment is recorded. POST /fee-structures/:id/generate only
   stamps eligibility (earlyPaymentPct/earlyPaymentDeadline) onto the
   invoice; this file covers where it's actually applied:

     1. A payment landing on/before the deadline applies the discount
        exactly once, recomputing the invoice total/balance.
     2. A payment landing after the deadline leaves the invoice alone.
     3. Never applied twice (earlyPaymentApplied guards it), and never
        applied if it wouldn't actually be higher than the discount
        already on the invoice — "only one discount, highest wins"
        applies here too, not just at generation time.
     4. An invoice with no early-payment eligibility at all behaves
        exactly as before this feature existed.

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
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$in' in v) return v.$in.includes(doc[k]);
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
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update, opts) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const set = update.$set ?? update;
      docs[idx] = { ...docs[idx], ...set };
      return mockChainObj(opts?.new === false ? { ...docs[idx], ...set } : docs[idx]);
    }),
    deleteOne: jest.fn(({ _id }) => { docs = docs.filter(d => d._id !== _id); return Promise.resolve({}); }),
  };
}

let mockInvoices, mockPayments, mockStudents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'invoices')  return mockInvoices;
    if (c === 'payments')  return mockPayments;
    if (c === 'students')  return mockStudents;
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

const BASE_INVOICE = {
  id: 'inv_1', _id: 'oid_1', schoolId: SCHOOL, studentId: 'stu_1', studentName: 'Amara Osei',
  invoiceNumber: 'INV-100', lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
  discountPct: 0, taxPct: 0, subtotal: 1000, discountAmount: 0, taxAmount: 0, total: 1000,
  amountPaid: 0, balance: 1000, status: 'unpaid',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPayments = makeFakeCollection([]);
  mockStudents = makeFakeCollection([{ id: 'stu_1', schoolId: SCHOOL, firstName: 'Amara', lastName: 'Osei' }]);
});

describe('Early Payment discount — applies on a sufficiently early payment', () => {
  test('a payment on/before the deadline recalculates the invoice at the higher discount, exactly once', async () => {
    mockInvoices = makeFakeCollection([{
      ...BASE_INVOICE,
      earlyPaymentPct: 5, earlyPaymentDeadline: '2026-01-10', earlyPaymentApplied: false,
    }]);

    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 950, method: 'cash', paidAt: '2026-01-05T09:00:00.000Z',
    });

    expect(res.status).toBe(201);
    const inv = mockInvoices._docs()[0];
    expect(inv.discountPct).toBe(5);
    expect(inv.total).toBe(950);
    expect(inv.earlyPaymentApplied).toBe(true);
    expect(inv.balance).toBe(0);
    expect(res.body.data.invoiceStatus).toBe('paid');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.early_payment_discount_applied' }));
  });

  test('paying exactly on the deadline date still qualifies (inclusive)', async () => {
    mockInvoices = makeFakeCollection([{
      ...BASE_INVOICE,
      earlyPaymentPct: 5, earlyPaymentDeadline: '2026-01-10', earlyPaymentApplied: false,
    }]);
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 100, method: 'cash', paidAt: '2026-01-10T23:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(mockInvoices._docs()[0].discountPct).toBe(5);
  });
});

describe('Early Payment discount — does not apply', () => {
  test('a payment recorded AFTER the deadline leaves the invoice at full price', async () => {
    mockInvoices = makeFakeCollection([{
      ...BASE_INVOICE,
      earlyPaymentPct: 5, earlyPaymentDeadline: '2026-01-10', earlyPaymentApplied: false,
    }]);
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 1000, method: 'cash', paidAt: '2026-01-15T09:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const inv = mockInvoices._docs()[0];
    expect(inv.discountPct).toBe(0);
    expect(inv.total).toBe(1000);
    expect(inv.earlyPaymentApplied).toBeFalsy();
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.early_payment_discount_applied' }));
  });

  test('already applied (earlyPaymentApplied: true) is never re-applied on a later payment', async () => {
    mockInvoices = makeFakeCollection([{
      ...BASE_INVOICE, discountPct: 5, total: 950, amountPaid: 500, balance: 450,
      earlyPaymentPct: 5, earlyPaymentDeadline: '2026-01-10', earlyPaymentApplied: true,
    }]);
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 450, method: 'cash', paidAt: '2026-01-05T09:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const inv = mockInvoices._docs()[0];
    expect(inv.total).toBe(950); // unchanged — not recalculated a second time
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.early_payment_discount_applied' }));
  });

  test("never applied if it wouldn't actually beat the discount already on the invoice", async () => {
    // Simulates an invoice whose discountPct was set higher than the
    // early-payment rate by some other means after generation — the
    // payment-time guard must hold defensively, not just the
    // generation-time one.
    mockInvoices = makeFakeCollection([{
      ...BASE_INVOICE, discountPct: 10, subtotal: 1000, discountAmount: 100, total: 900, balance: 900,
      earlyPaymentPct: 5, earlyPaymentDeadline: '2026-01-10', earlyPaymentApplied: false,
    }]);
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 900, method: 'cash', paidAt: '2026-01-05T09:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const inv = mockInvoices._docs()[0];
    expect(inv.discountPct).toBe(10); // unchanged — 5% would be worse, not applied
    expect(inv.total).toBe(900);
  });

  test('an invoice with no early-payment eligibility at all behaves exactly as before', async () => {
    mockInvoices = makeFakeCollection([{ ...BASE_INVOICE }]);
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 1000, method: 'cash',
    });
    expect(res.status).toBe(201);
    expect(mockInvoices._docs()[0].total).toBe(1000);
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.early_payment_discount_applied' }));
  });
});
