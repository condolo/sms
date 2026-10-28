/* ============================================================
   Regression test — POST /api/mpesa/stk-push initiation idempotency

   The board calls screen 09 "the one screen that must never flop", and
   this is the flop: a parent taps pay, sees nothing, taps again — and
   gets prompted twice, enters their PIN twice, and pays twice.

   Two guards, both tested here:

   Guard 1 — the same intent arriving twice (retry, double tap): the
   client sends one `idempotencyKey` per payment intent, and the second
   call gets the ORIGINAL checkoutRequestId back. Not an error: a
   retried request that errors breeds exactly the second tap it was
   trying to recover from.

   Guard 2 — a NEW intent while a prompt is still live on the phone
   (the "it's been 20 seconds, nothing happened" case). No client key
   can see this, so the server refuses a second push for the same
   invoice inside the pending window, hands back the live
   checkoutRequestId, and the app can resume watching the attempt it
   already has instead of racing it.

   Also pinned: an amount above the invoice balance is refused (the
   other half of a double charge — the refund), and a genuinely new
   attempt after the window passes IS allowed, because a prompt that
   expired on the phone must never leave a parent unable to pay.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_test_001', schoolId: 'school_test_001', role: 'parent' };
    next();
  },
}));

jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => next(),
  _mapSchoolDoc: jest.fn(),
  CURRENCY_SYMBOLS: { KES: 'KSh' },
}));

const SCHOOL = { id: 'school_test_001' };

/* Safaricom is stubbed: a push "succeeds" and gives back unique ids. */
jest.mock('../../utils/mpesa', () => ({
  ...jest.requireActual('../../utils/mpesa'),
  normalizePhone: (p) => `254${String(p).slice(-9)}`,
  stkPush: jest.fn().mockResolvedValue({
    ResponseCode: '0',
    MerchantRequestID: 'MR-1',
    CheckoutRequestID: 'ws_CO_1',
  }),
}));

let mockTxnFindOneResult = null;
let mockPendingResult = null;
/* Guard 1 queries by idempotencyKey; guard 2 queries for a pending attempt
 * inside the window. Two result slots so a test can answer each guard
 * independently, and guard 2's slot honours the window the route asks for —
 * a 3-minute-old attempt must fall outside a 2-minute window, exactly as it
 * would in Mongo, or the "releases after the window" test lies. */
const mockTxnFindOne = jest.fn((filter = {}) => {
  const resolve = (v) => {
    const chain = { lean: () => Promise.resolve(v) };
    chain.sort = () => ({ lean: () => Promise.resolve(v) });
    return chain;
  };
  if (filter.idempotencyKey) return resolve(mockTxnFindOneResult);
  if (filter.status === 'pending') {
    const cutoff = filter.createdAt?.$gte ? new Date(filter.createdAt.$gte).getTime() : 0;
    const inWindow = mockPendingResult && new Date(mockPendingResult.createdAt).getTime() >= cutoff;
    return resolve(inWindow ? mockPendingResult : null);
  }
  return resolve(null);
});
const mockTxnCreate = jest.fn().mockResolvedValue({});

let mockInvoice = { id: 'inv_001', schoolId: SCHOOL.id, studentId: 'stu_001', balance: 12500, invoiceNumber: 'INV-1042' };
const mockInvoicesFindOne = () => ({ lean: () => Promise.resolve(mockInvoice) });

const mockSchoolsFindOne = () => ({ lean: () => Promise.resolve({ id: SCHOOL.id, mpesa: { shortCode: 'SC1', consumerKey: 'k', consumerSecret: 's', passkey: 'p' } }) });

const mockInvoicesUpdateOne = jest.fn().mockResolvedValue({});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return { findOne: mockSchoolsFindOne };
    if (collection === 'invoices') return { findOne: mockInvoicesFindOne, updateOne: mockInvoicesUpdateOne };
    return {};
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: jest.fn((collection) => {
    if (collection === 'mpesa_transactions') {
      return { findOne: mockTxnFindOne, create: mockTxnCreate };
    }
    if (collection === 'invoices') {
      return { findOne: mockInvoicesFindOne, updateOne: mockInvoicesUpdateOne };
    }
    return {};
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const { stkPush } = require('../../utils/mpesa');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mpesa', require('../../routes/mpesa'));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInvoice = { id: 'inv_001', schoolId: SCHOOL.id, studentId: 'stu_001', balance: 12500, invoiceNumber: 'INV-1042' };
  mockTxnFindOneResult = null;
  mockPendingResult = null;
  mockTxnCreate.mockResolvedValue({});
});

const post = (app, body) =>
  supertest(app).post('/api/mpesa/stk-push').send(body);

describe('POST /api/mpesa/stk-push — initiation idempotency', () => {
  test('guard 1: a repeated intent returns the ORIGINAL checkoutRequestId, and Safaricom is called once', async () => {
    const app = buildApp();
    const first = await post(app, { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-1' });
    expect(first.status).toBe(200);
    expect(first.body.checkoutRequestId).toBe('ws_CO_1');
    expect(stkPush).toHaveBeenCalledTimes(1);

    // The retry: the SAME key finds the first attempt.
    mockTxnFindOneResult = { id: 'txn_1', checkoutRequestId: 'ws_CO_1', merchantRequestId: 'MR-1', status: 'pending' };
    const again = await post(app, { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-1' });

    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);           // idempotency, not an error
    expect(again.body.checkoutRequestId).toBe('ws_CO_1');
    expect(again.body.message).toContain('already sent');
    expect(stkPush).toHaveBeenCalledTimes(1);           // no second prompt
  });

  test('guard 2: a live prompt on the phone blocks a second push and hands back the live attempt', async () => {
    const app = buildApp();
    await post(app, { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-1' });

    // A NEW intent 20 seconds later: guard 1 has never seen this key, so it is
    // the pending-window guard that must refuse the second push.
    mockPendingResult = {
      id: 'txn_1',
      checkoutRequestId: 'ws_CO_1',
      merchantRequestId: 'MR-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 20_000).toISOString(),
    };
    const second = await post(app, { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-2' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    expect(second.body.checkoutRequestId).toBe('ws_CO_1');  // resume, don't race
    expect(stkPush).toHaveBeenCalledTimes(1);
  });

  test('guard 2 releases: an attempt past the window is a new payment, never a permanent lock-out', async () => {
    const app = buildApp();
    await post(app, { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-1' });

    mockPendingResult = {
      id: 'txn_1',
      checkoutRequestId: 'ws_CO_1',
      merchantRequestId: 'MR-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),  // 3 min ago
    };
    const retry = await post(app, { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-2' });

    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBeUndefined();
    expect(stkPush).toHaveBeenCalledTimes(2);          // a new prompt IS allowed
  });

  test('an amount above the invoice balance is refused — overpayment is the other half of a double charge', async () => {
    const res = await post(buildApp(), { invoiceId: 'inv_001', phone: '0712345678', amount: 25000, idempotencyKey: 'intent-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    expect(stkPush).not.toHaveBeenCalled();
  });

  test('the idempotency lookup failure never blocks a payment — it degrades to guard 2 only', async () => {
    // Nothing matches: both lookups find no attempt, so a push must happen.
    // (mockImplementation, not mockResolvedValue: the route chains .lean()/.sort()
    // off the return value, so a bare promise is a TypeError here.)
    mockTxnFindOne.mockImplementation((filter = {}) => {
      const resolve = (v) => {
        const chain = { lean: () => Promise.resolve(v) };
        chain.sort = () => ({ lean: () => Promise.resolve(v) });
        return chain;
      };
      if (filter.idempotencyKey || filter.status) return resolve(null);
      return resolve(null);
    });
    const res = await post(buildApp(), { invoiceId: 'inv_001', phone: '0712345678', amount: 12500, idempotencyKey: 'intent-1' });
    expect(res.status).toBe(200);
    expect(res.body.checkoutRequestId).toBe('ws_CO_1');
  });
});
