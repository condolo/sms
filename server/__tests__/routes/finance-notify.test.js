/* ============================================================
   server/routes/finance.js — _notifyInvoiceCreated /
   _notifyPaymentReceived (notification-activation for
   invoice_created / payment_received). Tested directly
   (exported as router._notifyInvoiceCreated / _notifyPaymentReceived).
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

let mockStores;
const mockNotify = jest.fn().mockResolvedValue(undefined);

jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockNotify(...args) }));
jest.mock('../../utils/email', () => ({
  sendFeeInvoiceCreatedAlert: jest.fn(),
  sendFeePaymentReceivedAlert: jest.fn(),
}));

const router = require('../../routes/finance');

const SCHOOL = 'school_test_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: { findOne: () => chain({ name: 'Test School', systemEmail: 'office@test.io' }) },
  };
});

test('invoice_created notifies the invoiced student\'s guardians', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  const invoice = { studentId: 'stu_1', invoiceNumber: 'INV-001', total: 500, currency: 'KES', dueDate: '2026-08-01' };
  await router._notifyInvoiceCreated(req, invoice);

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('invoice_created');
  expect(call.items).toHaveLength(1);
  expect(call.items[0].studentId).toBe('stu_1');
  expect(call.items[0].inAppSubject).toContain('INV-001');
});

test('payment_received notifies the paying student\'s guardians with balance info', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  const payment = { studentId: 'stu_2', receiptNumber: 'RCT-001', amount: 200 };
  await router._notifyPaymentReceived(req, payment, { currency: 'KES', balance: 300 });

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('payment_received');
  expect(call.items).toHaveLength(1);
  expect(call.items[0].studentId).toBe('stu_2');
  expect(call.items[0].inAppSubject).toContain('RCT-001');
});
