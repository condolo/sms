/* ============================================================
   server/routes/mpesa.js — Payment.studentName (2026-09 fix)

   Found while investigating a demo-account report of the Payments list
   showing raw student IDs (std_demo_1) instead of names. The DEMO seed
   was one cause (fixed in seed-demo-data.js), but tracing every real
   payment-creation path found the same gap live in BOTH M-Pesa callback
   handlers: they built the Payment record from `invoice.studentId`
   only, never `studentName` — unlike POST /api/finance/payments, which
   always resolves it. For a real school, M-Pesa is often the ONLY
   payment method in use, so this wasn't a demo-only cosmetic issue.

   Covers both STK push and C2B/Paybill callbacks:
     1. studentName is copied straight from the invoice when it has one.
     2. Falls back to a Students lookup when the invoice doesn't
        (legacy/seed data) — same resilience POST /payments has.
     3. Never crashes when neither is available (no student found
        either) — studentName just stays unset, not "undefined".

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_test_001', schoolId: 'school_test_001', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../utils/counters', () => ({
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-001'),
}));

const SCHOOL = 'school_test_001';
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }

let mockTxnDoc, mockInvoiceDoc, mockStudentDoc, mockSchoolDoc, mockPaymentsCreated;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return { findOne: jest.fn(() => mockChainObj(mockSchoolDoc)) };
    // STK's bootstrap lookup (tenant not yet known) uses _model, not
    // tenantModel, for mpesa_transactions — see mpesa.js's own comment.
    if (collection === 'mpesa_transactions') return { findOne: jest.fn(() => mockChainObj(mockTxnDoc)) };
    return { findOne: jest.fn(() => mockChainObj(null)), updateOne: jest.fn().mockResolvedValue({}) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'mpesa_transactions') {
      return {
        findOne: jest.fn(() => mockChainObj(mockTxnDoc)),
        findOneAndUpdate: jest.fn(() => mockChainObj(mockTxnDoc ? { ...mockTxnDoc, status: 'completed' } : null)),
        create: jest.fn().mockResolvedValue({}),
      };
    }
    if (collection === 'invoices') {
      return {
        findOne: jest.fn(() => mockChainObj(mockInvoiceDoc)),
        updateOne: jest.fn().mockResolvedValue({}),
      };
    }
    if (collection === 'students') {
      return { findOne: jest.fn(() => mockChainObj(mockStudentDoc)) };
    }
    if (collection === 'payments') {
      return {
        create: jest.fn((doc) => { mockPaymentsCreated.push(doc); return Promise.resolve(doc); }),
        find: jest.fn(() => mockChainObj([])),
      };
    }
    return { findOne: jest.fn(() => mockChainObj(null)), create: jest.fn().mockResolvedValue({}) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');
const mpesaRouter = require('../../routes/mpesa');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mpesa', mpesaRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPaymentsCreated = [];
  mockSchoolDoc = { id: SCHOOL, mpesa: { shortCode: '123456' } };
});

function stkCallbackBody() {
  return {
    Body: { stkCallback: {
      CheckoutRequestID: 'ws_CO_test_99999', ResultCode: 0, ResultDesc: 'Success',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }, { Name: 'MpesaReceiptNumber', Value: 'QGR7XXXX02' }] },
    } },
  };
}

describe('POST /api/mpesa/callback (STK) — Payment.studentName', () => {
  beforeEach(() => {
    mockTxnDoc = { id: 'txn_001', schoolId: SCHOOL, invoiceId: 'inv_001', phone: '254712345678', checkoutRequestId: 'ws_CO_test_99999', status: 'pending' };
  });

  test('copies studentName straight from the invoice when it already has one', async () => {
    mockInvoiceDoc = { id: 'inv_001', schoolId: SCHOOL, studentId: 'stu_001', studentName: 'Amara Osei' };
    await supertest(buildApp()).post('/api/mpesa/callback').send(stkCallbackBody());
    await new Promise(r => setImmediate(r));
    expect(mockPaymentsCreated).toHaveLength(1);
    expect(mockPaymentsCreated[0].studentName).toBe('Amara Osei');
    expect(mockPaymentsCreated[0].studentId).toBe('stu_001');
  });

  test('falls back to a Students lookup when the invoice has no studentName (legacy/seed data)', async () => {
    mockInvoiceDoc = { id: 'inv_001', schoolId: SCHOOL, studentId: 'stu_001' }; // no studentName
    mockStudentDoc = { firstName: 'Amara', lastName: 'Osei' };
    await supertest(buildApp()).post('/api/mpesa/callback').send(stkCallbackBody());
    await new Promise(r => setImmediate(r));
    expect(mockPaymentsCreated[0].studentName).toBe('Amara Osei');
  });

  test('never crashes when neither the invoice nor a student record has a name', async () => {
    mockInvoiceDoc = { id: 'inv_001', schoolId: SCHOOL, studentId: 'stu_ghost' };
    mockStudentDoc = null;
    const res = await supertest(buildApp()).post('/api/mpesa/callback').send(stkCallbackBody());
    await new Promise(r => setImmediate(r));
    expect(res.status).toBe(200);
    expect(mockPaymentsCreated).toHaveLength(1);
    expect(mockPaymentsCreated[0].studentName).toBeUndefined();
  });
});

describe('POST /api/mpesa/c2b/confirmation — Payment.studentName', () => {
  beforeEach(() => {
    mockTxnDoc = null; // C2B always creates a fresh mpesa_transactions record — not read first
  });

  function c2bBody() {
    return { TransID: 'QGR7C2B001', TransAmount: '750', BusinessShortCode: '123456', BillRefNumber: 'INV-2026-000123', MSISDN: '254722000111' };
  }

  test('copies studentName straight from the invoice when it already has one', async () => {
    mockInvoiceDoc = { id: 'inv_c2b_1', schoolId: SCHOOL, studentId: 'stu_002', studentName: 'James Mwangi', invoiceNumber: 'INV-2026-000123' };
    await supertest(buildApp()).post('/api/mpesa/c2b/confirmation').send(c2bBody());
    await new Promise(r => setImmediate(r));
    expect(mockPaymentsCreated).toHaveLength(1);
    expect(mockPaymentsCreated[0].studentName).toBe('James Mwangi');
  });

  test('falls back to a Students lookup when the invoice has no studentName', async () => {
    mockInvoiceDoc = { id: 'inv_c2b_1', schoolId: SCHOOL, studentId: 'stu_002', invoiceNumber: 'INV-2026-000123' };
    mockStudentDoc = { firstName: 'James', lastName: 'Mwangi' };
    await supertest(buildApp()).post('/api/mpesa/c2b/confirmation').send(c2bBody());
    await new Promise(r => setImmediate(r));
    expect(mockPaymentsCreated[0].studentName).toBe('James Mwangi');
  });
});
