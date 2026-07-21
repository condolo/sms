/* ============================================================
   server/utils/notification-digest-cron.js — groups pending
   notification_digests by {schoolId,userId}, sends one email per
   group, clears sent rows. A failed send leaves its rows queued for
   the next run instead of losing them.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  let docs = seed.map(d => ({ ...d }));
  return {
    find:       () => chain(docs.slice()),
    findOne:    (filter) => chain(docs.find(d => d.id === filter.id) || null),
    deleteMany: async (filter) => {
      const ids = filter.id?.$in ?? [];
      const before = docs.length;
      docs = docs.filter(d => !ids.includes(d.id));
      return { deletedCount: before - docs.length };
    },
    _docs: () => docs,
  };
}

let mockStores;
const mockSendDigestSummary = jest.fn().mockResolvedValue(true);

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/email', () => ({ sendDigestSummary: (...args) => mockSendDigestSummary(...args) }));

const { runDigestSend } = require('../utils/notification-digest-cron');

const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: makeStore([
      { id: SCHOOL_A, name: 'School A', systemEmail: 'a@x.io' },
      { id: SCHOOL_B, name: 'School B', systemEmail: 'b@x.io' },
    ]),
    notification_digests: makeStore([
      { id: 'd1', schoolId: SCHOOL_A, userId: 'u1', recipientEmail: 'p1@x.io', recipientName: 'P1', eventKey: 'behaviour_incident', subject: 'Incident A', body: 'demerit' },
      { id: 'd2', schoolId: SCHOOL_A, userId: 'u1', recipientEmail: 'p1@x.io', recipientName: 'P1', eventKey: 'behaviour_incident', subject: 'Incident B', body: 'merit' },
      { id: 'd3', schoolId: SCHOOL_A, userId: 'u2', recipientEmail: 'p2@x.io', recipientName: 'P2', eventKey: 'behaviour_incident', subject: 'Incident C', body: 'demerit' },
      { id: 'd4', schoolId: SCHOOL_B, userId: 'u3', recipientEmail: 'p3@x.io', recipientName: 'P3', eventKey: 'behaviour_incident', subject: 'Incident D', body: 'merit' },
    ]),
  };
});

test('does nothing when there are no pending digests', async () => {
  mockStores.notification_digests = makeStore([]);
  await runDigestSend();
  expect(mockSendDigestSummary).not.toHaveBeenCalled();
});

test('groups by schoolId+userId and sends exactly one email per group', async () => {
  await runDigestSend();
  expect(mockSendDigestSummary).toHaveBeenCalledTimes(3); // (A,u1), (A,u2), (B,u3)

  const u1Call = mockSendDigestSummary.mock.calls.find(c => c[0].recipientEmail === 'p1@x.io');
  expect(u1Call[0].items).toHaveLength(2);
  expect(u1Call[0].schoolName).toBe('School A');
});

test('clears sent rows from notification_digests', async () => {
  await runDigestSend();
  expect(mockStores.notification_digests._docs()).toHaveLength(0);
});

test('a failed send leaves that group\'s rows queued, does not affect other groups', async () => {
  mockSendDigestSummary.mockImplementationOnce(() => { throw new Error('smtp down'); });
  await runDigestSend();

  const remaining = mockStores.notification_digests._docs();
  // Whichever group failed first is still queued; the others were cleared.
  expect(remaining.length).toBeGreaterThan(0);
  expect(remaining.length).toBeLessThan(4);
});
