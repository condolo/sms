/* ============================================================
   POST /api/finance/term-billing/preview|generate

   Transport (one-way / two-way fares) and extra-curricular enrolments land
   on each student's invoice for one term. All DB calls are mocked.
   ============================================================ */

const SCHOOL = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
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
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$exists' in v) return (doc[k] !== undefined) === v.$exists;
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
function mockFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:     jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:  jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const d = docs.find(x => matchesFilter(x, filter));
      if (!d) return mockChainObj(null);
      Object.assign(d, update.$set || {});
      return mockChainObj(d);
    }),
    distinct: jest.fn((field, filter) => Promise.resolve([...new Set(docs.filter(d => matchesFilter(d, filter)).map(d => d[field]))])),
    create:   jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
  };
}

let mockStores;
let mockArchivedYears = [];

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools')         return { findOne: jest.fn(() => mockChainObj({ currency: 'KES' })) };
    if (c === 'academic_config') return { findOne: jest.fn(() => mockChainObj({ archivedAcademicYears: mockArchivedYears })) };
    if (c === 'audit_logs')      return { create: jest.fn().mockResolvedValue({}) };
    return mockStores[c] || { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)), distinct: jest.fn(() => Promise.resolve([])) };
  }),
}));

const express = require('express');
const supertest = require('supertest');
const financeRouter = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRouter);
  return app;
}

const TERM = { id: 'term_1', name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-15' };
const YEAR = { id: 'ay_2026', schoolId: SCHOOL, name: '2026-2027', isCurrent: true, startDate: '2026-01-06', endDate: '2026-12-15', terms: [TERM] };

const ROUTE_A = { id: 'r_a', schoolId: SCHOOL, name: 'Zone A', fares: [{ fareType: 'one_way', amount: 29000 }, { fareType: 'two_way', amount: 35600 }] };
const GUITAR  = { id: 'act_g', schoolId: SCHOOL, name: 'Guitar', amount: 6000, status: 'active' };

const STUDENTS = [
  { id: 'stu1', schoolId: SCHOOL, firstName: 'Amina', lastName: 'Wanjiru', status: 'active' },
  { id: 'stu2', schoolId: SCHOOL, firstName: 'Brian', lastName: 'Otieno', status: 'active' },
  { id: 'stu3', schoolId: SCHOOL, firstName: 'Cathy', lastName: 'Mwangi', status: 'active' },
];

function seed(overrides = {}) {
  mockStores = {
    academic_years:        mockFakeCollection([YEAR]),
    transport_routes:      mockFakeCollection([ROUTE_A]),
    transport_assignments: mockFakeCollection([
      // stu1: one-way Zone A, the fare they chose
      { id: 'as1', schoolId: SCHOOL, studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'active', startDate: '2026-08-01' },
      // stu3: an assignment with no fare type chosen — must not be billed silently
      { id: 'as3', schoolId: SCHOOL, studentId: 'stu3', routeId: 'r_a', fareType: null, status: 'active', startDate: '2026-08-01' },
    ]),
    activities:         mockFakeCollection([GUITAR]),
    activity_enrolments: mockFakeCollection([
      { id: 'e1', schoolId: SCHOOL, studentId: 'stu1', activityId: 'act_g', activityName: 'Guitar', status: 'active', startDate: '2026-09-01' },
    ]),
    students: mockFakeCollection(STUDENTS),
    invoices: mockFakeCollection(overrides.invoices || []),
  };
  mockArchivedYears = [];
}

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe('POST /term-billing/preview', () => {
  test('bills the chosen fare plus the activity, and writes nothing', async () => {
    const res = await supertest(buildApp()).post('/api/finance/term-billing/preview').send({ termId: 'term_1' });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    // The term starts 1 Sep 2026: fees are due by the end of its first week (7th day).
    expect(res.body.data.dueDate).toBe('2026-09-07');
    const stu1 = res.body.data.billable.find(b => b.studentId === 'stu1');
    expect(stu1.lines).toEqual([
      { description: 'Transport — Zone A (one-way)', quantity: 1, unitPrice: 29000, feeType: 'transport' },
      { description: 'Extra-Curricular — Guitar', quantity: 1, unitPrice: 6000, feeType: 'extracurricular' },
    ]);
    expect(stu1.total).toBe(35000);
    expect(mockStores.invoices.create).not.toHaveBeenCalled();
  });

  test('a student with no fare type is reported as skipped with the reason', async () => {
    const res = await supertest(buildApp()).post('/api/finance/term-billing/preview').send({ termId: 'term_1' });
    expect(res.body.data.billable.find(b => b.studentId === 'stu3')).toBeUndefined();
    const skip = res.body.data.skipped.find(s => s.studentId === 'stu3');
    expect(skip.reasons[0]).toMatch(/no one-way or two-way fare/);
  });
});

describe('POST /term-billing/generate — due date and early payment', () => {
  test('each term invoice is due by the end of the term\'s first week', async () => {
    await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    const inv = mockStores.invoices._docs().find(d => d.studentId === 'stu1');
    expect(inv.dueDate).toBe('2026-09-07');
    expect(inv.earlyPaymentApplied).toBeUndefined();
  });

  test('an active early-payment policy stamps the deadline against the term due date', async () => {
    mockStores.discount_policies = mockFakeCollection([
      { id: 'dp1', schoolId: SCHOOL, type: 'early_payment', active: true, flatPct: 5, daysBeforeDue: 3 },
    ]);
    const res = await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    expect(res.status).toBe(200);
    const inv = mockStores.invoices._docs().find(d => d.studentId === 'stu1');
    // Early payment is paid BEFORE the term starts (1 Sep 2026): deadline is 31 Aug.
    expect(inv).toMatchObject({ earlyPaymentPct: 5, earlyPaymentDeadline: '2026-08-31', earlyPaymentApplied: false, earlyPaymentManual: true });
  });
});

describe('bursar early payment (term invoices)', () => {
  let invoiceId;
  beforeEach(async () => {
    mockStores.discount_policies = mockFakeCollection([
      { id: 'dp1', schoolId: SCHOOL, type: 'early_payment', active: true, flatPct: 5, daysBeforeDue: 3 },
    ]);
    await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    invoiceId = mockStores.invoices._docs().find(d => d.studentId === 'stu1').id;
  });

  test('confirming with no payment on or before the deadline is refused', async () => {
    const res = await supertest(buildApp()).post(`/api/finance/invoices/${invoiceId}/early-payment/confirm`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/No payment was received on or before 2026-08-31/);
  });

  test('a payment after the deadline does not qualify', async () => {
    mockStores.payments = mockFakeCollection([{ id: 'p1', schoolId: SCHOOL, invoiceId, paidAt: '2026-09-02T09:00:00Z', amount: 1000 }]);
    const res = await supertest(buildApp()).post(`/api/finance/invoices/${invoiceId}/early-payment/confirm`);
    expect(res.status).toBe(400);
  });

  test('a payment on or before the deadline lets the bursar confirm the discount, once', async () => {
    mockStores.payments = mockFakeCollection([{ id: 'p1', schoolId: SCHOOL, invoiceId, paidAt: '2026-08-20T09:00:00Z', amount: 1000 }]);
    const res = await supertest(buildApp()).post(`/api/finance/invoices/${invoiceId}/early-payment/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ earlyPaymentApplied: true, discountPct: 5 });
    expect(res.body.data.total).toBeLessThan(35000);
    const again = await supertest(buildApp()).post(`/api/finance/invoices/${invoiceId}/early-payment/confirm`);
    expect(again.status).toBe(409);
  });

  test('the deadline can be changed by the bursar until the discount is confirmed', async () => {
    const changed = await supertest(buildApp()).put(`/api/finance/invoices/${invoiceId}/early-payment`).send({ deadline: '2026-08-25' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.earlyPaymentDeadline).toBe('2026-08-25');
    const bad = await supertest(buildApp()).put(`/api/finance/invoices/${invoiceId}/early-payment`).send({ deadline: '25/08/2026' });
    expect(bad.status).toBe(422);
  });

  test('after confirmation the deadline and percentage are locked', async () => {
    mockStores.payments = mockFakeCollection([{ id: 'p1', schoolId: SCHOOL, invoiceId, paidAt: '2026-08-20T09:00:00Z', amount: 1000 }]);
    await supertest(buildApp()).post(`/api/finance/invoices/${invoiceId}/early-payment/confirm`);
    const res = await supertest(buildApp()).put(`/api/finance/invoices/${invoiceId}/early-payment`).send({ pct: 10 });
    expect(res.status).toBe(409);
  });

  test('the term list shows each invoice\'s early-payment status', async () => {
    const res = await supertest(buildApp()).get('/api/finance/term-billing/early-payments?termId=term_1');
    expect(res.status).toBe(200);
    expect(res.body.data.find(i => i.id === invoiceId)).toMatchObject({ earlyPaymentDeadline: '2026-08-31', earlyPaymentApplied: false });
  });
});

describe('POST /term-billing/generate', () => {
  test('creates one term invoice per billable student, with the lines and totals', async () => {
    const res = await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);
    const inv = mockStores.invoices._docs().find(d => d.studentId === 'stu1');
    expect(inv).toMatchObject({
      termBillingTermId: 'term_1',
      termId: 'term_1',
      academicYearId: 'ay_2026',
      currency: 'KES',
      total: 35000,
      balance: 35000,
      amountPaid: 0,
      status: 'unpaid',
      title: 'Term billing — Term 1',
    });
    expect(inv.lineItems).toHaveLength(2);
  });

  test('a second run for the same term skips students already billed (no duplicate invoice)', async () => {
    await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    const second = await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    expect(second.body.data.created).toBe(0);
    expect(second.body.data.skipped.find(s => s.studentId === 'stu1').reasons[0]).toMatch(/Already billed/);
    expect(mockStores.invoices._docs().filter(d => d.studentId === 'stu1')).toHaveLength(1);
  });

  test('a term with no start or end date is refused, not billed', async () => {
    mockStores.academic_years = mockFakeCollection([{ ...YEAR, terms: [{ id: 'term_1', name: 'Term 1' }] }]);
    const res = await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no start and end dates/);
    expect(mockStores.invoices.create).not.toHaveBeenCalled();
  });

  test('a locked (archived) academic year is refused', async () => {
    mockArchivedYears = ['ay_2026'];
    const res = await supertest(buildApp()).post('/api/finance/term-billing/generate').send({ termId: 'term_1' });
    expect(res.status).toBe(400);
    expect(mockStores.invoices.create).not.toHaveBeenCalled();
  });

  test('a term must be named', async () => {
    const res = await supertest(buildApp()).post('/api/finance/term-billing/generate').send({});
    expect(res.status).toBe(422);
  });
});
