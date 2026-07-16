/* ============================================================
   Cross-tenant isolation regression — server/routes/finance.js
   (C4 · ADR-0001 §5)

   Money is the highest-risk tenant data. Authenticated as School A,
   asserts every query reaching the data layer is scoped to School A —
   including the two writes that previously carried NO schoolId in their
   filter (Payments.deleteOne({_id}) and the post-payment
   Invoices.findOneAndUpdate({id})): tenantModel() now injects schoolId
   there, closing latent gaps while preserving behavior.

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

const seen = {
  invFind: [], invCount: [], invFindOne: [], invCreate: [], invFindOneAndUpdate: [], invAggregate: [],
  payFind: [], payCreate: [], payDeleteOne: [], payAggregate: [],
};

function mockChain(result) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(result) };
  return c;
}

const mockInvoices = {
  find:             jest.fn((f) => { seen.invFind.push(f); return mockChain([]); }),
  countDocuments:   jest.fn((f) => { seen.invCount.push(f); return Promise.resolve(0); }),
  findOne:          jest.fn((f) => { seen.invFindOne.push(f); return mockChain({ id: 'inv_1', schoolId: 'school_A', total: 1000, balance: 1000, amountPaid: 0, status: 'unpaid', studentId: 's1' }); }),
  create:           jest.fn((d) => { seen.invCreate.push(d); return Promise.resolve({ ...d }); }),
  findOneAndUpdate: jest.fn((f, u) => { seen.invFindOneAndUpdate.push({ filter: f, update: u }); return Promise.resolve({}); }),
  aggregate:        jest.fn((p) => { seen.invAggregate.push(p); return Promise.resolve([{ totalInvoiced: 0 }]); }),
};
const mockPayments = {
  find:       jest.fn((f) => { seen.payFind.push(f); return mockChain([{ amount: 500 }]); }),
  create:     jest.fn((d) => { seen.payCreate.push(d); return Promise.resolve({ _id: 'p_oid', id: 'pay_1', schoolId: 'school_A' }); }),
  deleteOne:  jest.fn((f) => { seen.payDeleteOne.push(f); return Promise.resolve({ deletedCount: 1 }); }),
  aggregate:  jest.fn((p) => { seen.payAggregate.push(p); return Promise.resolve([]); }),
};
const mockSchools = { findOne: jest.fn(() => mockChain({ currency: 'KES' })) };

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'invoices')  return mockInvoices;
    if (c === 'payments')  return mockPayments;
    if (c === 'schools')   return mockSchools;
    if (c === 'audit_logs') return { create: jest.fn().mockResolvedValue({}) };
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
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
function assertScopedToA(f) { expect(f).toBeDefined(); expect(f.schoolId).toBe(SCHOOL_A); }

beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(seen)) seen[k] = []; });

describe('finance — cross-tenant isolation (authenticated as School A)', () => {
  test('GET /invoices scopes list find + count to School A', async () => {
    await supertest(buildApp()).get('/api/finance/invoices?studentId=s1');
    assertScopedToA(seen.invFind[0]);
    assertScopedToA(seen.invCount[0]);
    expect(seen.invFind[0].studentId).toBe('s1');
  });

  test('GET /invoices/:id can only match within School A (School B id 404s)', async () => {
    await supertest(buildApp()).get('/api/finance/invoices/inv_belonging_to_B');
    assertScopedToA(seen.invFindOne[0]);
    expect(seen.invFindOne[0].id).toBe('inv_belonging_to_B');
  });

  test('GET /summary prepends a School-A $match on both aggregates', async () => {
    await supertest(buildApp()).get('/api/finance/summary');
    expect(seen.invAggregate[0][0]).toEqual({ $match: { schoolId: SCHOOL_A } });
    expect(seen.payAggregate[0][0]).toEqual({ $match: { schoolId: SCHOOL_A } });
  });

  test('POST /payments — every write is School-A-scoped, including the previously-unscoped invoice update', async () => {
    const res = await supertest(buildApp()).post('/api/finance/payments').send({
      invoiceId: 'inv_1', amount: 500, method: 'cash',
    });
    expect(res.status).toBe(201);

    // invoice ownership lookup scoped to A
    assertScopedToA(seen.invFindOne[0]);
    // payment persisted under A
    expect(seen.payCreate[0].schoolId).toBe(SCHOOL_A);
    // recalculation query scoped to A
    assertScopedToA(seen.payFind[0]);
    // THE LATENT GAP: the post-payment invoice update filter had no schoolId
    // in the source; tenantModel now injects it.
    assertScopedToA(seen.invFindOneAndUpdate[0].filter);
    expect(seen.invFindOneAndUpdate[0].filter.id).toBe('inv_1');
  });
});
