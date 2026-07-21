/* ============================================================
   server/utils/notify-dispatch.js — central notification dispatch

   Verifies the branching this whole notification-activation build
   depends on: in-app message creation gated on isEnabled(inApp), email
   sent immediately vs queued to notification_digests based on
   getFrequency(), and one recipient failing never blocks the rest.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore() {
  const docs = [];
  return {
    create: async (doc) => { const d = { ...doc }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockIsEnabled;   // (schoolId, eventKey, channel) => bool
let mockFrequency;   // 'immediate' | 'daily_digest'

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/notif-settings', () => ({
  isEnabled:    (...args) => mockIsEnabled(...args),
  getFrequency: () => Promise.resolve(mockFrequency),
}));

const { dispatchNotification } = require('../utils/notify-dispatch');

const SCHOOL = 'school_test_001';
const ctx = { schoolId: SCHOOL };

beforeEach(() => {
  mockStores = { messages: makeStore(), notification_digests: makeStore() };
  mockIsEnabled = jest.fn().mockResolvedValue(true);
  mockFrequency = 'immediate';
});

test('creates an in-app message when inApp is enabled', async () => {
  const sendEmail = jest.fn();
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [{ userId: 'u1', name: 'Parent One', email: 'p1@x.io' }],
    inAppSubject: 'Subject', inAppBody: 'Body', sendEmail,
  });
  expect(mockStores.messages._docs()).toHaveLength(1);
  expect(mockStores.messages._docs()[0].recipients).toEqual(['u1']);
});

test('skips the in-app message when inApp is disabled for this event', async () => {
  mockIsEnabled = jest.fn((s, e, ch) => Promise.resolve(ch !== 'inApp'));
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [{ userId: 'u1', name: 'P', email: 'p1@x.io' }],
    inAppSubject: 'Subject', sendEmail: jest.fn(),
  });
  expect(mockStores.messages._docs()).toHaveLength(0);
});

test('sends the email immediately when frequency is immediate', async () => {
  const sendEmail = jest.fn().mockResolvedValue(true);
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [{ userId: 'u1', name: 'P', email: 'p1@x.io' }],
    inAppSubject: 'S', sendEmail,
  });
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(mockStores.notification_digests._docs()).toHaveLength(0);
});

test('queues into notification_digests instead of sending when frequency is daily_digest', async () => {
  mockFrequency = 'daily_digest';
  const sendEmail = jest.fn();
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [{ userId: 'u1', name: 'Parent One', email: 'p1@x.io' }],
    inAppSubject: 'S', emailDigestSubject: 'Digest subj', emailDigestBody: 'Digest body', sendEmail,
  });
  expect(sendEmail).not.toHaveBeenCalled();
  const rows = mockStores.notification_digests._docs();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ schoolId: SCHOOL, userId: 'u1', recipientEmail: 'p1@x.io', subject: 'Digest subj', body: 'Digest body' });
});

test('a recipient with no email is skipped for email but still gets the in-app message', async () => {
  const sendEmail = jest.fn();
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [{ userId: 'u1', name: 'No Email Guy', email: null }],
    inAppSubject: 'S', sendEmail,
  });
  expect(sendEmail).not.toHaveBeenCalled();
  expect(mockStores.messages._docs()).toHaveLength(1);
});

test('one recipient failing does not block the next', async () => {
  const sendEmail = jest.fn()
    .mockRejectedValueOnce(new Error('smtp down'))
    .mockResolvedValueOnce(true);
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [
      { userId: 'u1', name: 'A', email: 'a@x.io' },
      { userId: 'u2', name: 'B', email: 'b@x.io' },
    ],
    inAppSubject: 'S', sendEmail,
  });
  expect(sendEmail).toHaveBeenCalledTimes(2);
  // u1's email threw, but its in-app message (created before the email call) already landed;
  // u2's full flow (in-app + email) completed normally.
  expect(mockStores.messages._docs().map(m => m.recipients[0])).toEqual(expect.arrayContaining(['u1', 'u2']));
});

test('recipients without a userId are skipped entirely', async () => {
  const sendEmail = jest.fn();
  await dispatchNotification({
    ctx, schoolId: SCHOOL, eventKey: 'behaviour_incident', actorUserId: 'system',
    recipients: [{ name: 'No Id', email: 'x@x.io' }],
    inAppSubject: 'S', sendEmail,
  });
  expect(mockStores.messages._docs()).toHaveLength(0);
  expect(sendEmail).not.toHaveBeenCalled();
});
