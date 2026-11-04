/* ============================================================
   POST /api/finance/invoices — the invoice number must be one this
   school's ledger does not already hold.

   invoice-number-collision.test.js covers the walk inside utils/counters.js.
   This covers the wiring, which is the part that was actually broken: the
   invoice route drew a number and filed it without asking, so a school whose
   invoices arrived by seed or import (a counter that never advanced for them)
   got a duplicate invoice number on its first app-created invoice.

   Checked per school: another school's identical number is irrelevant, and
   invoices has no unique index on invoiceNumber — deliberately, so a school
   already holding a repeat can still build its indexes — which means nothing
   else would catch either a collision or an over-broad lookup.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL   = 'school_bursar';
const OTHER    = 'school_elsewhere';
const mockYear = new Date().getFullYear();

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
// by invoice-number-collision.test.js; here it is the route's side of the pair.
let mockSeq, mockProbeCalls;
jest.mock('../../utils/counters', () => ({
  nextReceiptNumber: jest.fn(async () => 'RCP-1'),
  nextInvoiceNumber: jest.fn(async (schoolId, isTaken) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      mockSeq += 1;
      const candidate = `INV-${mockYear}-${String(mockSeq).padStart(6, '0')}`;
      if (!isTaken) return candidate;
      mockProbeCalls += 1;
      if (!(await isTaken(candidate))) return candidate;
    }
    throw new Error('Could not find a free invoice number');
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
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve({ ...doc, toObject: () => doc }); }),
    deleteOne: jest.fn(({ _id }) => { const i = docs.findIndex(d => d._id === _id); if (i > -1) docs.splice(i, 1); return Promise.resolve({}); }),
  };
}

let mockInvoices, mockStudents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    const chainObj = (obj) => ({ select: () => chainObj(obj), lean: () => Promise.resolve(obj) });
    const chainArr = (rows) => ({ select: () => chainArr(rows), lean: () => Promise.resolve(rows) });
    if (c === 'invoices') return mockInvoices;
    if (c === 'students') return mockStudents;
    if (c === 'schools')  return { findOne: jest.fn(() => chainObj({ currency: 'KES' })) };
    return { find: jest.fn(() => chainArr([])), findOne: jest.fn(() => chainObj(null)) };
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

const fmt = (seq) => `INV-${mockYear}-${String(seq).padStart(6, '0')}`;

// The paper history a school brings with it: five invoices already numbered
// from 1, one of them in a different school that must not be counted.
const SEEDED_INVOICES = () => [
  { id: 'inv_seed_1', _id: 'oid_seed_1', schoolId: SCHOOL, invoiceNumber: fmt(1), status: 'unpaid', balance: 1000 },
  { id: 'inv_seed_2', _id: 'oid_seed_2', schoolId: SCHOOL, invoiceNumber: fmt(2), status: 'unpaid', balance: 1000 },
  { id: 'inv_seed_3', _id: 'oid_seed_3', schoolId: SCHOOL, invoiceNumber: fmt(3), status: 'paid',   balance: 0 },
  { id: 'inv_seed_9', _id: 'oid_seed_9', schoolId: SCHOOL, invoiceNumber: fmt(9), status: 'unpaid', balance: 1000 },
  { id: 'inv_seed_10', _id: 'oid_seed_10', schoolId: SCHOOL, invoiceNumber: fmt(10), status: 'unpaid', balance: 1000 },
  { id: 'inv_theirs', _id: 'oid_theirs', schoolId: OTHER,  invoiceNumber: fmt(1), status: 'unpaid', balance: 1000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSeq = 0;
  mockProbeCalls = 0;
  mockInvoices = makeFakeCollection(SEEDED_INVOICES());
  mockStudents = makeFakeCollection([{ id: 'stu_1', _id: 'oid_stu_1', schoolId: SCHOOL, firstName: 'Rose', lastName: 'Wanjiru' }]);
});

function postInvoice(body = {
  studentId: 'stu_1',
  lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
}) {
  return supertest(buildApp()).post('/api/finance/invoices').send(body);
}

describe('POST /invoices invoice numbering', () => {
  test('skips the numbers this school already issued and takes the next free one', async () => {
    const res = await postInvoice();
    expect(res.status).toBe(201);
    // 000001-000003 are held, so the walk stops at 4 rather than colliding.
    expect(res.body.data.invoiceNumber).toBe(fmt(4));
  });

  test('the route actually asks — a walk that never probed means the wiring regressed', async () => {
    await postInvoice();
    expect(mockProbeCalls).toBeGreaterThan(0);
  });

  test('the collision check is scoped to this school, never a global scan', async () => {
    await postInvoice();
    const lookedUp = mockInvoices.exists.mock.calls.map(call => call[0]);
    expect(lookedUp.length).toBeGreaterThan(0);
    for (const filter of lookedUp) {
      expect(filter.schoolId).toBe(SCHOOL);
      expect(filter.invoiceNumber).toBeTruthy();
    }
  });

  test("another school's identical number does not push this school's walk on", async () => {
    // Only the OTHER school holds fmt(1) — this school starts free at 1.
    mockInvoices = makeFakeCollection([{ id: 'inv_theirs', _id: 'oid_theirs', schoolId: OTHER, invoiceNumber: fmt(1) }]);
    const res = await postInvoice();
    expect(res.body.data.invoiceNumber).toBe(fmt(1));
  });

  test('never files a number the ledger already holds', async () => {
    const res = await postInvoice();
    const filed = res.body.data.invoiceNumber;
    expect(SEEDED_INVOICES().filter(i => i.schoolId === SCHOOL).map(i => i.invoiceNumber)).not.toContain(filed);
  });

  test('back-to-back invoices get distinct numbers, so the batch the app files can self-collide no more', async () => {
    const a = await postInvoice();
    const b = await postInvoice();
    expect(a.body.data.invoiceNumber).toBe(fmt(4));
    expect(b.body.data.invoiceNumber).toBe(fmt(5));
  });

  test('the walk changes nothing else about the invoice', async () => {
    const res = await postInvoice({ studentId: 'stu_1', currency: 'KES',
      lineItems: [{ description: 'Tuition', quantity: 2, unitPrice: 500 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(1000);
    expect(res.body.data.balance).toBe(1000);
    expect(res.body.data.status).toBe('unpaid');
    expect(res.body.data.createdBy).toBe('usr_bursar');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.invoice_created' }));
  });
});
