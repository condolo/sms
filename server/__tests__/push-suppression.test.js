/* ============================================================
   Tests — server/utils/push.js

   Two rules this module exists to enforce, both of which fail silently in
   production if they regress:

   1. A DEMO tenant never pushes to a real device. Demo schools are cloned
      from the sales demo and are full of fictional parents; a "fees are
      overdue" push reaching a real phone from a demo ends trust in the
      product. (Same suppression utils/email.js already applies.)
   2. A dead FCM token is DELETED, not retried forever — otherwise every
      send reports a growing failure count nobody can act on.

   Firebase and Mongo are both mocked; no credentials or DB required.
   ============================================================ */
'use strict';

const mockSendEachForMulticast = jest.fn();
const mockDeleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 });
const mockDeviceRows = [];

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    find: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(mockDeviceRows) }) })),
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
    create: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteMany: mockDeleteMany,
  })),
}));

jest.mock('../utils/firebase', () => ({
  getFirebaseAdmin: jest.fn(() => ({
    messaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
  })),
  isFirebaseConfigured: jest.fn(() => true),
}));

jest.mock('../utils/demo', () => ({
  isDemoSchool: jest.fn().mockResolvedValue(false),
}));

const firebase = require('../utils/firebase');
const demo     = require('../utils/demo');
const push     = require('../utils/push');

beforeEach(() => {
  jest.clearAllMocks();
  mockDeviceRows.length = 0;
  demo.isDemoSchool.mockResolvedValue(false);
  mockSendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });
});

describe('sendToUsers', () => {
  test('a demo tenant is suppressed before FCM is ever touched', async () => {
    demo.isDemoSchool.mockResolvedValue(true);
    mockDeviceRows.push({ token: 'tok_demo_parent' });

    const result = await push.sendToUsers({
      schoolId: 'sch_demo_riverside', userIds: ['usr_1'], title: 'Fees overdue', body: 'Pay now',
    });

    expect(result.skipped).toBe('demo_tenant');
    expect(result.sent).toBe(0);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('a school with no registered device is a no-op, not an error', async () => {
    const result = await push.sendToUsers({ schoolId: 'sch_riverside', userIds: ['usr_1'], title: 'Hi', body: 'There' });

    expect(result.skipped).toBe('no_devices');
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('a real school reaches its devices', async () => {
    mockDeviceRows.push({ token: 'tok_parent_1' }, { token: 'tok_parent_2' });
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 2, failureCount: 0, responses: [{ success: true }, { success: true }],
    });

    const result = await push.sendToUsers({ schoolId: 'sch_riverside', userIds: ['usr_1'], title: 'Notice', body: 'Trip forms' });

    expect(result.sent).toBe(2);
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('an unconfigured deployment skips instead of throwing', async () => {
    firebase.getFirebaseAdmin.mockReturnValueOnce(null);
    mockDeviceRows.push({ token: 'tok_parent_1' });

    const result = await push.sendToUsers({ schoolId: 'sch_riverside', userIds: ['usr_1'], title: 'Hi', body: 'There' });

    expect(result.skipped).toBe('not_configured');
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe('sendToTokens', () => {
  test('a retired token is pruned from the registry', async () => {
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });

    const result = await push.sendToTokens({ tokens: ['tok_alive', 'tok_dead'], title: 'Hi', body: 'There' });

    expect(result.sent).toBe(1);
    expect(result.invalidTokens).toEqual(['tok_dead']);
    expect(mockDeleteMany).toHaveBeenCalledWith({ token: { $in: ['tok_dead'] } });
  });

  test('data values are stringified for FCM and duplicate tokens are collapsed', async () => {
    await push.sendToTokens({
      tokens: ['tok_a', 'tok_a'],
      title: 'Fee reminder',
      body: 'Balance is due',
      data: { invoiceId: 1042, amount: 12500, empty: null },
    });

    const call = mockSendEachForMulticast.mock.calls[0][0];
    expect(call.tokens).toEqual(['tok_a']);
    expect(call.data).toEqual({ invoiceId: '1042', amount: '12500' });
  });
});
