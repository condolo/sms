/* ============================================================
   server/services/demoService.js — the provisioning lock

   Bug class this pins down: "one demo request, two tenants". Before the
   fix, the only guard was an in-process Set, which a second worker (or the
   same worker after a restart) simply does not see. Every insert happens
   after the guard and before the request is marked provisioned, so a
   duplicate build leaves a full cloned school nobody asked for.

   The fix is an atomic claim: findOneAndUpdate on the request document
   itself. Only one concurrent caller can match, and a claim abandoned by a
   crashed builder is re-claimable after a staleness window.

   No MongoDB required — '../utils/model' is a fake whose returns each test
   controls. Its findOne ignores the filter (every read in these paths is
   "the request by id").

   Run: npm test
   ============================================================ */
'use strict';

/* ── Fake collections, defined before the mocks that close over them ── */
const mockRequests = {
  findOne:         jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne:       jest.fn(),
  countDocuments:  jest.fn(),
  create:          jest.fn(),
};

jest.mock('../utils/model', () => ({ _model: jest.fn(() => mockRequests) }));

/* Audit + email are side effects of provisioning, never its subject. */
jest.mock('../services/audit', () => ({ log: jest.fn() }));
jest.mock('../utils/email', () => ({
  sendDemoCredentials: jest.fn().mockResolvedValue(true),
  sendDemoOtp:         jest.fn().mockResolvedValue(true),
  sendDemoRejected:    jest.fn().mockResolvedValue(true),
}));

/* `mongoose.connection.db` is only reached once a build really starts; these
   tests stop before that except for the throw-path test, which needs it to
   fail loudly rather than reach a database. */
jest.mock('mongoose', () => ({ connection: { db: undefined } }));

const demoService = require('../services/demoService');

/* What every findOne in these paths returns — set per test. */
let currentDoc = null;

beforeEach(() => {
  jest.clearAllMocks();
  currentDoc = null;
  mockRequests.findOne.mockImplementation(() => ({ lean: () => Promise.resolve(currentDoc) }));
  mockRequests.findOneAndUpdate.mockResolvedValue(null);   // nothing claimable by default
  mockRequests.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

/* ── The claim itself ──────────────────────────────────────────── */

describe('provisionDemo — atomic claim', () => {
  test('claims the request before building anything', async () => {
    mockRequests.findOneAndUpdate.mockResolvedValue({ id: 'dr_1', status: 'provisioning' });
    // _provisionDemo re-reads the request; a finished one returns its URL.
    currentDoc = { id: 'dr_1', status: 'provisioned', tenantSlug: 'demo-riverside-ab12' };

    const result = await demoService.provisionDemo('dr_1');

    expect(result.ok).toBe(true);
    expect(result.data.loginUrl).toContain('demo-riverside-ab12');

    const [filter, update] = mockRequests.findOneAndUpdate.mock.calls[0];
    expect(filter.id).toBe('dr_1');
    // Claimable states: verified, or a claim old enough to be abandoned.
    expect(filter.$or[0]).toEqual({ status: 'verified' });
    expect(filter.$or[1].status).toBe('provisioning');
    expect(filter.$or[1].provisioningStartedAt.$lt).toBeInstanceOf(Date);
    expect(update.$set.status).toBe('provisioning');
    expect(update.$set.provisioningStartedAt).toBeInstanceOf(Date);
  });

  test('a request already provisioned returns its login URL instead of rebuilding', async () => {
    currentDoc = { id: 'dr_2', status: 'provisioned', tenantSlug: 'demo-lakeside-9f3c' };

    const result = await demoService.provisionDemo('dr_2');

    expect(result.ok).toBe(true);
    expect(result.data.loginUrl).toContain('demo-lakeside-9f3c');
    expect(mockRequests.updateOne).not.toHaveBeenCalled();
  });

  test('a request another worker is building answers IN_PROGRESS, not a rebuild', async () => {
    currentDoc = { id: 'dr_3', status: 'provisioning' };

    const result = await demoService.provisionDemo('dr_3');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('IN_PROGRESS');
  });

  test('a state that must not be built is refused rather than rebuilt', async () => {
    currentDoc = { id: 'dr_4', status: 'rejected' };

    const result = await demoService.provisionDemo('dr_4');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_PROVISIONABLE');
  });

  test('a double-click in the same process never reaches the claim twice', async () => {
    let releaseClaim;
    mockRequests.findOneAndUpdate.mockReturnValue(new Promise((resolve) => { releaseClaim = resolve; }));
    currentDoc = { id: 'dr_5', status: 'provisioned', tenantSlug: 'demo-x-1111' };

    const first = demoService.provisionDemo('dr_5');          // takes the in-process guard synchronously
    const second = await demoService.provisionDemo('dr_5');    // must be turned away

    expect(second.ok).toBe(false);
    expect(second.code).toBe('IN_PROGRESS');
    expect(mockRequests.findOneAndUpdate).toHaveBeenCalledTimes(1);

    releaseClaim({ id: 'dr_5', status: 'provisioning' });
    expect((await first).ok).toBe(true);
  });

  test('a build that throws leaves the request retryable, not wedged in provisioning', async () => {
    mockRequests.findOneAndUpdate.mockResolvedValue({ id: 'dr_6', status: 'provisioning' });
    currentDoc = { id: 'dr_6', status: 'provisioning', schoolName: 'Kite Academy', email: 'a@b.c' };

    await expect(demoService.provisionDemo('dr_6')).rejects.toThrow();

    expect(mockRequests.updateOne).toHaveBeenCalledWith(
      { id: 'dr_6' },
      { $set: expect.objectContaining({ status: 'failed' }) }
    );
  });
});

/* ── Operator approval must not release a live claim ───────────── */

describe('approveRequest', () => {
  test('records the approval but never hands an in-flight build back to the builder', async () => {
    currentDoc = { id: 'dr_7', status: 'provisioning', schoolName: 'Kite Academy' };

    const result = await demoService.approveRequest('dr_7', { email: 'ops@msingi.io' });

    // It is already being built — that is the honest answer.
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IN_PROGRESS');

    // Approval is recorded...
    expect(mockRequests.updateOne).toHaveBeenCalledWith(
      { id: 'dr_7' },
      { $set: expect.objectContaining({ approvedBy: 'ops@msingi.io' }) }
    );
    // ...but the status reset is filtered to exclude a live claim.
    const statusReset = mockRequests.updateOne.mock.calls.find(([, u]) => u?.$set?.status === 'verified');
    expect(statusReset[0]).toEqual({ id: 'dr_7', status: { $nin: ['provisioning', 'provisioned'] } });
  });
});
