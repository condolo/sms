/* ============================================================
   POST /api/finance/payments — the receipt number must be one this
   school's ledger does not already hold.

   The unit tests in receipt-number-collision.test.js cover the walk inside
   utils/counters.js. This covers the wiring that was actually broken: the
   payment route has to *ask* before filing. Reported 2026-11-01 from the
   bursar's phone — recording the school's first app payment filed
   RCP-2026-000001, a number the seed's own first receipt already held,
   because the counter only advances when a payment comes through it.

   Checked per school: another school's identical number is irrelevant, and
   payments has no unique index, so nothing else would catch either a
   collision or an over-broad lookup.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL      = 'school_bursar';
const OTHER       = 'school_elsewhere';
const mockYear        = new Date().getFullYear();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_bursar', schoolId: SCHOOL, role: 'finance', roles: ['finance'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => true),
  hasPermission: () => true,
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

// Faithful stand-in for utils/counters: takes one number per attempt and stops
// on the first the caller's isTaken says is free. The real function is covered
// by receipt-number-collision.test.js; here it is the route's side of the pair.
let mockSeq;
jest.mock('../../utils/counters', () => ({
  nextInvoiceNumber: jest.fn(async () => 'INV-1'),
  nextReceiptNumber: jest.fn(async (schoolId, isTaken) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      mockSeq += 1;
      const candidate = `RCP-${mockYear}-${String(mockSeq).padStart(6, '0')}`;
      if (!isTaken || !(await isTaken(candidate))) return candidate;
    }
    throw new Error('Could not find a free receipt number');
  }),
}));

const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}

function makeFakeCollection(seed = []) {
  const docs = [...seed];
  const chainArr = (rows) => ({
    sort: () => chainArr(rows), skip: () => chainArr(rows), limit: () => chainArr(rows),
    select: () => chainArr(rows), lean: () => Promise.resolve(rows),
  });
  const chainObj = (obj) => ({ select: () => chainObj(obj), lean: () => Promise.resolve(obj) });
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => chainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => chainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    // Real mongoose semantics: resolves to the document's _id, or null.
    exists:  jest.fn(async (filter) => {
      const hit = docs.find(d => matchesFilter(d, filter));
      return hit ? { _id: hit._id } : null;
    }),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => chainObj({ ...docs.find(d => matchesFilter(d, filter)), ...update })),
    deleteOne: jest.fn(({ _id }) => { const i = docs.findIndex(d => d._id === _id); if (i > -1) docs.splice(i, 1); return Promise.resolve({}); }),
  };
}

let mockInvoices, mockPayments, mockStudents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'invoices') return mockInvoices;
    if (c === 'payments') return mockPayments;
    if (c === 'students') return mockStudents;
    const chain = () => ({ select: chain, lean: () => Promise.resolve(null) });
    return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: chain, create: jest.fn(async (d) => d) };
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

const INVOICE = {
  id: 'inv_1', _id: 'oid_inv', schoolId: SCHOOL, studentId: 'stu_1', studentName: 'Rose Wanjiru',
  invoiceNumber: 'INV-2026-000017', total: 1000, amountPaid: 0, balance: 1000, status: 'unpaid',
};

// Receipts already in the books — on other invoices, so the balance maths is
// untouched, and one in a different school, to prove the lookup is scoped.
const SEEDED_RECEIPTS = () => [
  { id: 'pay_seed_mine', _id: 'oid_seed_mine', schoolId: SCHOOL,  invoiceId: 'inv_other', receiptNumber: `RCP-${mockYear}-000001`, amount: 500 },
  { id: 'pay_seed_mine2', _id: 'oid_seed_mine2', schoolId: SCHOOL, invoiceId: 'inv_other', receiptNumber: `RCP-${mockYear}-000002`, amount: 500 },
  { id: 'pay_seed_theirs', _id: 'oid_seed_theirs', schoolId: OTHER, invoiceId: 'inv_other', receiptNumber: `RCP-${mockYear}-000003`, amount: 500 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSeq = 0;
  mockInvoices = makeFakeCollection([INVOICE]);
  mockPayments = makeFakeCollection(SEEDED_RECEIPTS());
  mockStudents = makeFakeCollection([{ id: 'stu_1', schoolId: SCHOOL, firstName: 'Rose', lastName: 'Wanjiru' }]);
});

function postPayment(body = { invoiceId: 'inv_1', amount: 400, method: 'cash' }) {
  return supertest(buildApp()).post('/api/finance/payments').send(body);
}

describe('POST /payments receipt numbering', () => {
  test('skips the numbers this school already issued and takes the next free one', async () => {
    const res = await postPayment();
    expect(res.status).toBe(201);
    // This school's seeded ledger holds 000001 and 000002, so the walk moves on.
    expect(res.body.data.payment.receiptNumber).toBe(`RCP-${mockYear}-000003`);
  });

  test('the collision check is scoped to this school, never a global scan', async () => {
    await postPayment();
    const lookedUp = mockPayments.exists.mock.calls.map(call => call[0]);
    expect(lookedUp.length).toBeGreaterThan(0);
    for (const filter of lookedUp) expect(filter.schoolId).toBe(SCHOOL);
    expect(lookedUp.every(f => f.receiptNumber)).toBe(true);
  });

  test('never files a number this school already holds', async () => {
    const res = await postPayment();
    const filed = res.body.data.payment.receiptNumber;
    const already = SEEDED_RECEIPTS().filter(r => r.schoolId === SCHOOL).map(r => r.receiptNumber);
    expect(already).not.toContain(filed);
  });

  test('a ledger with no receipts of its own still gets the first number', async () => {
    mockPayments = makeFakeCollection([{ id: 'pay_x', _id: 'oid_x', schoolId: OTHER, invoiceId: 'inv_other', receiptNumber: `RCP-${mockYear}-000001` }]);
    const res = await postPayment();
    expect(res.body.data.payment.receiptNumber).toBe(`RCP-${mockYear}-000001`);
  });

  test('the receipt is stamped with a paidAt the ledger can sort on', async () => {
    const res = await postPayment();
    expect(typeof res.body.data.payment.paidAt).toBe('string');
    expect(res.body.data.payment.paidAt.slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the walk leaves the rest of the response exactly as it was', async () => {
    const res = await postPayment();
    expect(res.body.data.invoiceStatus).toBe('partial');
    expect(res.body.data.invoiceBalance).toBe(600);
    expect(mockAuditLog).toHaveBeenCalled();
  });
});
