/* ============================================================
   server/services/sessionService.js — impersonation session
   functions (PLAT-01 remediation)

   Unit tests for createImpersonationSession / getImpersonationSession /
   revokeImpersonationSession against a fake in-memory 'sessions'
   collection. No MongoDB required.
   ============================================================ */
'use strict';

let mockDocs;
function mockMatches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => doc[k] === v);
}
jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    collection: { createIndex: jest.fn().mockResolvedValue(undefined) },
    create: jest.fn((doc) => { mockDocs.push({ ...doc }); return Promise.resolve({ ...doc }); }),
    findOne: jest.fn((filter) => ({
      lean: () => Promise.resolve(mockDocs.find(d => mockMatches(d, filter)) ?? null),
    })),
    updateOne: jest.fn((filter, update) => {
      const doc = mockDocs.find(d => mockMatches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    }),
  })),
}));
jest.mock('../utils/token-version', () => ({ revokeUserTokens: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/jwt', () => ({ ABSOLUTE_TIMEOUT_MS: 8 * 60 * 60 * 1000 }));

const SessionService = require('../services/sessionService');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocs = [];
});

describe('createImpersonationSession', () => {
  test('creates a session flagged impersonation:true, carrying who/why', async () => {
    const { sessionId, absoluteExpiry } = await SessionService.createImpersonationSession(
      'usr_admin1', 'sch_trinitas', 'superadmin', '1.2.3.4', 'test-agent',
      { impersonatedBy: { operatorId: 'op_1', tier: 'owner', email: 'ops@msingi.io' }, reason: 'Ticket #1', timeoutMs: 60 * 60 * 1000 },
    );
    expect(sessionId).toBeDefined();
    expect(absoluteExpiry).toBeDefined();

    const doc = mockDocs.find(d => d.id === sessionId);
    expect(doc.impersonation).toBe(true);
    expect(doc.userId).toBe('usr_admin1');
    expect(doc.schoolId).toBe('sch_trinitas');
    expect(doc.reason).toBe('Ticket #1');
    expect(doc.impersonatedBy).toEqual({ operatorId: 'op_1', tier: 'owner', email: 'ops@msingi.io' });
    expect(doc.status).toBe('active');
  });

  test('honours a custom timeoutMs — the shorter impersonation window, not the 8h default', async () => {
    const shortMs = 15 * 60 * 1000;
    const before = Date.now();
    const { absoluteExpiry } = await SessionService.createImpersonationSession(
      'u', 's', 'superadmin', '1.1.1.1', 'ua', { reason: 'x', timeoutMs: shortMs },
    );
    const deltaMs = new Date(absoluteExpiry).getTime() - before;
    expect(deltaMs).toBeGreaterThan(shortMs - 5000);
    expect(deltaMs).toBeLessThan(shortMs + 5000);
  });

  test('falls back to the normal ABSOLUTE_TIMEOUT_MS if no timeoutMs is given', async () => {
    const before = Date.now();
    const { absoluteExpiry } = await SessionService.createImpersonationSession('u', 's', 'superadmin', '1.1.1.1', 'ua', {});
    const deltaMs = new Date(absoluteExpiry).getTime() - before;
    expect(deltaMs).toBeGreaterThan(8 * 60 * 60 * 1000 - 5000);
  });
});

describe('getImpersonationSession', () => {
  test('finds an impersonation session by id', async () => {
    mockDocs.push({ id: 'sess_1', impersonation: true, status: 'active', schoolId: 'sch_a' });
    const found = await SessionService.getImpersonationSession('sess_1');
    expect(found.schoolId).toBe('sch_a');
  });

  test('never returns a NORMAL (non-impersonation) session, even with a matching id', async () => {
    mockDocs.push({ id: 'sess_normal', status: 'active', schoolId: 'sch_a' }); // no impersonation:true
    const found = await SessionService.getImpersonationSession('sess_normal');
    expect(found).toBeNull();
  });

  test('a null/undefined sessionId returns null without querying', async () => {
    expect(await SessionService.getImpersonationSession(null)).toBeNull();
    expect(await SessionService.getImpersonationSession(undefined)).toBeNull();
  });
});

describe('revokeImpersonationSession', () => {
  test('revokes an active impersonation session and records who/why', async () => {
    mockDocs.push({ id: 'sess_1', impersonation: true, status: 'active', schoolId: 'sch_a' });
    const ok = await SessionService.revokeImpersonationSession(
      'sess_1', { userId: 'op_1', role: 'platform_owner', email: 'ops@msingi.io' }, 'Investigation complete',
    );
    expect(ok).toBe(true);
    const doc = mockDocs.find(d => d.id === 'sess_1');
    expect(doc.status).toBe('revoked');
    expect(doc.revokedBy).toEqual({ userId: 'op_1', role: 'platform_owner', email: 'ops@msingi.io' });
    expect(doc.revokeReason).toBe('Investigation complete');
    expect(doc.revokedAt).toBeInstanceOf(Date);
  });

  test('revoking an already-revoked session returns false — no double-revoke, no false success', async () => {
    mockDocs.push({ id: 'sess_1', impersonation: true, status: 'revoked', schoolId: 'sch_a' });
    const ok = await SessionService.revokeImpersonationSession('sess_1', { userId: 'op_1' }, 'x');
    expect(ok).toBe(false);
  });

  test('revoking an unknown session id returns false', async () => {
    const ok = await SessionService.revokeImpersonationSession('sess_nope', { userId: 'op_1' }, 'x');
    expect(ok).toBe(false);
  });

  test('cannot be used to revoke a NORMAL session via this function — impersonation:true is part of the filter', async () => {
    mockDocs.push({ id: 'sess_normal', status: 'active', schoolId: 'sch_a' }); // no impersonation flag
    const ok = await SessionService.revokeImpersonationSession('sess_normal', { userId: 'op_1' }, 'x');
    expect(ok).toBe(false);
    expect(mockDocs.find(d => d.id === 'sess_normal').status).toBe('active'); // untouched
  });
});
