/* ============================================================
   Fee Types catalogue — refundable flag (2026-09)

   A school-wide "standard fee items" request (Admission, Caution Money,
   Ambulance Cover, T-shirt, Hymn Book, Swimming, Digital Learning,
   Reading Diary, Workbook) surfaced that Caution Money is a refundable
   deposit, not ordinary fee revenue. Covers:

     1. DEFAULT_FEE_TYPES now includes the new standard items, and
        'caution' is flagged refundable by default.
     2. PUT /fee-config accepts and persists a per-type `refundable` flag.
     3. Fee-structure line items snapshot `refundable` (LineItemSchema),
        the same way `feeType` itself is stored as a free string, not a
        live reference to the catalogue.

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
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function mockChainArr(arr) { return { sort: () => mockChainArr(arr), skip: () => mockChainArr(arr), limit: () => mockChainArr(arr), select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }

let mockFeeConfigDoc;
let mockFeeStructures;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'fee_config') {
      return {
        findOne: jest.fn(() => mockChainObj(mockFeeConfigDoc)),
        findOneAndUpdate: jest.fn((_filter, update) => {
          const set = update.$set ?? update;
          mockFeeConfigDoc = { ...mockFeeConfigDoc, ...set };
          return mockChainObj(mockFeeConfigDoc);
        }),
      };
    }
    if (c === 'fee_structures') {
      return {
        create: jest.fn((doc) => { mockFeeStructures.push(doc); return Promise.resolve(doc); }),
        find: jest.fn(() => mockChainArr(mockFeeStructures)),
      };
    }
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

beforeEach(() => {
  jest.clearAllMocks();
  mockFeeConfigDoc = null;
  mockFeeStructures = [];
});

describe('GET /api/finance/fee-config — defaults', () => {
  test('includes the new standard fee items, with caution flagged refundable', async () => {
    const res = await supertest(buildApp()).get('/api/finance/fee-config');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.data.feeTypes.map(t => [t.key, t]));
    for (const key of ['admission', 'caution', 'ambulance', 'extracurricular', 'swimming', 'digital_learning', 'hymn_book', 'reading_diary', 'workbook']) {
      expect(byKey[key]).toBeDefined();
    }
    expect(byKey.caution.refundable).toBe(true);
    expect(byKey.tuition.refundable).toBeFalsy();
  });
});

describe('PUT /api/finance/fee-config — refundable flag', () => {
  test('a school can mark any fee type refundable, not just the built-in default', async () => {
    const res = await supertest(buildApp()).put('/api/finance/fee-config').send({
      feeTypes: [
        { key: 'tuition', label: 'Tuition Fees' },
        { key: 'deposit', label: 'Security Deposit', refundable: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.feeTypes.find(t => t.key === 'deposit').refundable).toBe(true);
    expect(res.body.data.feeTypes.find(t => t.key === 'tuition').refundable).toBe(false);
  });

  test('duplicate keys are still rejected (pre-existing validation, unaffected by the new field)', async () => {
    const res = await supertest(buildApp()).put('/api/finance/fee-config').send({
      feeTypes: [{ key: 'a', label: 'A' }, { key: 'a', label: 'A2' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/finance/fee-structures — line items snapshot refundable', () => {
  test('a refundable line item persists the flag on the fee structure (and therefore on invoices generated from it)', async () => {
    const res = await supertest(buildApp()).post('/api/finance/fee-structures').send({
      name: 'New Admission Package',
      scopeType: 'all',
      lineItems: [
        { description: 'Admission Fee', quantity: 1, unitPrice: 15000, feeType: 'admission' },
        { description: 'Caution Money', quantity: 1, unitPrice: 10000, feeType: 'caution', refundable: true },
      ],
    });
    expect(res.status).toBe(201);
    const stored = mockFeeStructures[0];
    expect(stored.lineItems[0].refundable).toBeUndefined();
    expect(stored.lineItems[1].refundable).toBe(true);
  });
});
