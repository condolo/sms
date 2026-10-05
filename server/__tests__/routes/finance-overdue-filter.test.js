/* ============================================================
   GET /api/finance/invoices?status=overdue

   'overdue' is not a stored status. It means unpaid or partly paid, with a
   due date before today. It must return those invoices, and nothing else.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
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
jest.mock('../../utils/counters', () => ({
  nextInvoiceNumber: jest.fn().mockResolvedValue('INV-1'),
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-1'),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

// A small matcher for the operators the invoice list uses.
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$and') return v.every(sub => matches(doc, sub));
    if (k === '$or') return v.some(sub => matches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(val);
      if ('$ne' in v && '$lt' in v) return val != null && val !== v.$ne && val < v.$lt;
      if ('$ne' in v) return val !== v.$ne;
      if ('$lt' in v) return val != null && val < v.$lt;
    }
    return val === v;
  });
}

let mockInvoices = [];
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve({ currency: 'KES' }) }), lean: () => Promise.resolve({ currency: 'KES' }) }) };
    if (col === 'academic_config') return { findOne: () => ({ lean: () => Promise.resolve({ archivedAcademicYears: [] }) }) };
    return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: () => ({ lean: () => Promise.resolve(null) }) };
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

function invoiceStore() {
  return {
    find: (filter) => {
      const rows = mockInvoices.filter(d => matches(d, filter));
      const chain = { sort: () => chain, skip: () => chain, limit: () => chain, select: () => chain, lean: () => Promise.resolve(rows) };
      return chain;
    },
    countDocuments: jest.fn(async (filter) => mockInvoices.filter(d => matches(d, filter)).length),
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
    distinct: jest.fn(async () => []),
    create: jest.fn(async (d) => d),
  };
}

jest.mock('../../utils/tenant-model', () => {
  const actual = jest.requireActual('../../utils/tenant-model');
  return {
    ...actual,
    tenantModel: (col, ctx) => (col === 'invoices' ? global.__invoiceStore() : actual.tenantModel(col, ctx)),
  };
});

beforeAll(() => { global.__invoiceStore = invoiceStore; });

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const PAST = '2020-01-01';
const FUTURE = '2099-01-01';

beforeEach(() => {
  mockInvoices = [
    { id: 'a', schoolId: SCHOOL, invoiceNumber: 'INV-A', status: 'unpaid', dueDate: PAST, balance: 500 },
    { id: 'b', schoolId: SCHOOL, invoiceNumber: 'INV-B', status: 'partial', dueDate: PAST, balance: 100 },
    { id: 'c', schoolId: SCHOOL, invoiceNumber: 'INV-C', status: 'unpaid', dueDate: FUTURE, balance: 500 },
    { id: 'd', schoolId: SCHOOL, invoiceNumber: 'INV-D', status: 'paid', dueDate: PAST, balance: 0 },
    { id: 'e', schoolId: SCHOOL, invoiceNumber: 'INV-E', status: 'unpaid', dueDate: null, balance: 500 },
    { id: 'f', schoolId: SCHOOL, invoiceNumber: 'INV-F', status: 'void', dueDate: PAST, balance: 0 },
    { id: 'g', schoolId: SCHOOL, invoiceNumber: 'INV-G', status: 'draft', dueDate: PAST, balance: 0 },
  ];
});

describe('GET /invoices?status=overdue', () => {
  test('returns only unpaid or partly paid invoices past their due date', async () => {
    const res = await supertest(buildApp()).get('/api/finance/invoices?status=overdue');
    expect(res.status).toBe(200);
    const numbers = (res.body.data ?? res.body.items ?? []).map(i => i.invoiceNumber).sort();
    expect(numbers).toEqual(['INV-A', 'INV-B']);
  });

  test('a plain stored status still matches exactly as before', async () => {
    const res = await supertest(buildApp()).get('/api/finance/invoices?status=draft');
    const numbers = (res.body.data ?? res.body.items ?? []).map(i => i.invoiceNumber);
    expect(numbers).toEqual(['INV-G']);
  });

  test('overdue combined with another status returns both sets', async () => {
    const res = await supertest(buildApp()).get('/api/finance/invoices?status=overdue,void');
    const numbers = (res.body.data ?? res.body.items ?? []).map(i => i.invoiceNumber).sort();
    expect(numbers).toEqual(['INV-A', 'INV-B', 'INV-F']);
  });

  test('the date is today in Africa/Nairobi (sanity check on the test clock)', () => {
    expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
