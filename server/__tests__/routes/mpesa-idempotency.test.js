/* ============================================================
   Regression test — server/routes/mpesa.js STK callback idempotency

   BUG-002 (see docs/governance/ARCHITECTURE_GOVERNANCE_REVIEW_v1.md):
   Safaricom retries STK callbacks (documented behavior, not an edge
   case). The handler used to create a new Payment on every successful
   delivery with no check that the transaction was already completed —
   a retried callback created a second, duplicate Payment for the same
   money.

   Fix: the transaction is claimed atomically via
   findOneAndUpdate({ status: { $ne: 'completed' } }, ...) before a
   Payment is created. A second delivery for the same checkoutRequestId
   finds status already 'completed', matches nothing, and is skipped.

   This test simulates two callback deliveries for the same
   checkoutRequestId and asserts Payments.create runs exactly once.

   All DB calls are mocked — no MongoDB required.
   Run: npm test
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_test_001', schoolId: 'school_test_001', role: 'admin', roles: ['admin'] };
    next();
  },
}));

jest.mock('../../utils/counters', () => ({
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-001'),
}));

const CHECKOUT_ID = 'ws_CO_test_12345';
const TXN = {
  id: 'txn_001',
  schoolId: 'school_test_001',
  invoiceId: 'inv_001',
  phone: '254712345678',
  checkoutRequestId: CHECKOUT_ID,
  status: 'pending',
};
const INVOICE = { id: 'inv_001', schoolId: 'school_test_001', studentId: 'stu_001' };

/* Stateful mock: the FIRST findOneAndUpdate claim succeeds (txn not yet
   completed); the SECOND — simulating a retried callback — finds status
   already 'completed' and returns null, exactly as MongoDB would. */
let claimed = false;
const mockTxnFindOne = jest.fn().mockResolvedValue(TXN);
const mockTxnFindOneAndUpdate = jest.fn(() => ({
  lean: jest.fn().mockImplementation(() => {
    if (claimed) return Promise.resolve(null);
    claimed = true;
    return Promise.resolve({ ...TXN, status: 'completed' });
  }),
}));
const mockTxnUpdateOne = jest.fn().mockResolvedValue({});

const mockInvoiceFindOne = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(INVOICE) }));
const mockPaymentsCreate = jest.fn().mockResolvedValue({});
const mockPaymentsFind   = jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) }));
const mockInvoicesUpdateOne = jest.fn().mockResolvedValue({});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'mpesa_transactions') {
      return {
        findOne: jest.fn(() => ({ lean: mockTxnFindOne })),
        findOneAndUpdate: mockTxnFindOneAndUpdate,
        updateOne: mockTxnUpdateOne,
      };
    }
    if (collection === 'invoices') {
      return { findOne: mockInvoiceFindOne, updateOne: mockInvoicesUpdateOne };
    }
    if (collection === 'payments') {
      return { create: mockPaymentsCreate, find: mockPaymentsFind };
    }
    return {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
  }),
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

function makeCallbackBody() {
  return {
    Body: {
      stkCallback: {
        CheckoutRequestID: CHECKOUT_ID,
        ResultCode: 0,
        ResultDesc: 'Success',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 500 },
            { Name: 'MpesaReceiptNumber', Value: 'QGR7XXXX01' },
          ],
        },
      },
    },
  };
}

describe('POST /api/mpesa/callback — idempotency (BUG-002)', () => {
  beforeEach(() => {
    claimed = false;
    jest.clearAllMocks();
  });

  test('a retried callback for the same checkoutRequestId does not create a second Payment', async () => {
    const app = buildApp();

    const first = await supertest(app).post('/api/mpesa/callback').send(makeCallbackBody());
    expect(first.status).toBe(200);

    // Give the fire-and-forget async processing inside the handler a tick to run —
    // the route responds 200 immediately, then processes the callback body.
    await new Promise(r => setImmediate(r));

    const second = await supertest(app).post('/api/mpesa/callback').send(makeCallbackBody());
    expect(second.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(mockTxnFindOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mockPaymentsCreate).toHaveBeenCalledTimes(1);
  });
});
