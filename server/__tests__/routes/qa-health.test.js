/* ============================================================
   Unit tests — server/routes/qa-health.js
   (C8/MR-001 Phase 2 — identity migration visibility, ADR-0003)

   First test coverage this route has ever had. Scoped to the 3
   functions Phase 2 added — attached directly on the exported router
   (`router._checkDanglingIdentityFK` etc.) specifically so they can be
   unit-tested without mocking the route's unrelated dependencies
   (RBAC scan, release-cert file reads, test-directory scan).

   Load-bearing test: collision_pending users must NOT count as
   "pending" in _identityMigrationStatus — otherwise the gate could
   never reach 'complete' in any organization with an unresolved
   collision, contradicting ADR-0003's own framing of collision_pending
   as a permanent, safe fallback rather than an unfinished migration
   step.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockUserDocs = [];
let mockIdentityDocs = [];

// Supports both .select().lean() and .select().limit(N).lean() — the two
// chain shapes the real qa-health.js code actually uses.
function mockChain(resolveFn) {
  return { lean: () => Promise.resolve(resolveFn()), limit: () => ({ lean: () => Promise.resolve(resolveFn()) }) };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        find: jest.fn((filter) => ({
          select: () => mockChain(() => mockUserDocs.filter(u => mockMatchesUserFilter(u, filter))),
        })),
      };
    }
    if (collection === 'identities') {
      return {
        find: jest.fn((filter) => ({
          select: () => mockChain(() => mockIdentityDocs.filter(i => mockMatchesIdentityFilter(i, filter))),
        })),
        countDocuments: jest.fn((filter) => Promise.resolve(mockIdentityDocs.filter(i => mockMatchesIdentityFilter(i, filter)).length)),
      };
    }
    return { find: () => ({ select: () => mockChain(() => []) }), countDocuments: () => Promise.resolve(0) };
  }),
}));

function mockMatchesUserFilter(u, filter) {
  if (filter.identityId) return u.identityId != null; // { $exists: true, $ne: null }
  if (filter.email) return typeof u.email === 'string'; // { $exists: true, $type: 'string' }
  return true;
}
function mockMatchesIdentityFilter(i, filter) {
  if (filter.id && filter.id.$in) return filter.id.$in.includes(i.id);
  if (filter.status) return i.status === filter.status;
  return true;
}

jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));

const qaHealth = require('../../routes/qa-health');

beforeEach(() => {
  mockUserDocs = [];
  mockIdentityDocs = [];
});

describe('_checkDanglingIdentityFK', () => {
  test('returns 0 when every identityId resolves to a real identity', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'a@x.com', identityId: 'idt_1' }];
    mockIdentityDocs = [{ id: 'idt_1' }];

    const result = await qaHealth._checkDanglingIdentityFK();
    expect(result).toEqual({ count: 0, samples: [] });
  });

  test('flags a user whose identityId points to nothing', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'ghost@x.com', identityId: 'idt_missing' }];
    mockIdentityDocs = []; // idt_missing does not exist

    const result = await qaHealth._checkDanglingIdentityFK();
    expect(result.count).toBe(1);
    expect(result.samples).toContain('ghost@x.com');
  });

  test('returns 0 with no writes when no user has an identityId', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'a@x.com' }];
    const result = await qaHealth._checkDanglingIdentityFK();
    expect(result).toEqual({ count: 0, samples: [] });
  });
});

describe('_checkPasswordHashMismatch', () => {
  test('returns 0 when the dual-written hashes match', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'a@x.com', identityId: 'idt_1', password: '$2hash1' }];
    mockIdentityDocs = [{ id: 'idt_1', passwordHash: '$2hash1' }];

    const result = await qaHealth._checkPasswordHashMismatch();
    expect(result).toEqual({ count: 0, samples: [] });
  });

  test('flags a real divergence between users.password and identities.passwordHash', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'stale@x.com', identityId: 'idt_1', password: '$2hashOLD' }];
    mockIdentityDocs = [{ id: 'idt_1', passwordHash: '$2hashNEW' }];

    const result = await qaHealth._checkPasswordHashMismatch();
    expect(result.count).toBe(1);
    expect(result.samples).toContain('stale@x.com');
  });

  test('never flags an OAuth user (no password, no passwordHash) as a mismatch — null-normalized', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'oauth@x.com', identityId: 'idt_1' }]; // no `password` field
    mockIdentityDocs = [{ id: 'idt_1', passwordHash: null }];

    const result = await qaHealth._checkPasswordHashMismatch();
    expect(result).toEqual({ count: 0, samples: [] });
  });

  test('skips a user with a dangling identityId — not this check\'s concern', async () => {
    mockUserDocs = [{ id: 'usr_1', email: 'ghost@x.com', identityId: 'idt_missing', password: '$2hash' }];
    mockIdentityDocs = []; // idt_missing does not exist

    const result = await qaHealth._checkPasswordHashMismatch();
    expect(result).toEqual({ count: 0, samples: [] });
  });
});

describe('_identityMigrationStatus', () => {
  test('status is complete when every email-bearing user has been processed', async () => {
    mockUserDocs = [
      { id: 'usr_1', email: 'a@x.com' },
      { id: 'usr_2', email: 'b@x.com' },
    ];
    mockIdentityDocs = [
      { id: 'idt_1', sourceUserIds: ['usr_1'], status: 'active' },
      { id: 'idt_2', sourceUserIds: ['usr_2'], status: 'active' },
    ];

    const result = await qaHealth._identityMigrationStatus();
    expect(result).toEqual({ identityBackfillPending: 0, collisionPending: 0, status: 'complete' });
  });

  test('status is pending when a user has never been processed by provisionIdentities at all', async () => {
    mockUserDocs = [{ id: 'usr_never_processed', email: 'new@x.com' }];
    mockIdentityDocs = []; // no identity references this user anywhere yet

    const result = await qaHealth._identityMigrationStatus();
    expect(result.identityBackfillPending).toBe(1);
    expect(result.status).toBe('pending');
  });

  test('LOAD-BEARING: a collision_pending user counts as processed, NOT pending — the gate must reach complete despite an unresolved collision', async () => {
    mockUserDocs = [
      { id: 'usr_a', email: 'shared@gmail.com' },
      { id: 'usr_b', email: 'shared@gmail.com' },
    ];
    // Neither usr_a nor usr_b has users.identityId set (by design — collision,
    // never auto-merged), but BOTH are recorded in the collision_pending
    // identity's sourceUserIds, which is what _identityMigrationStatus must
    // treat as "already processed."
    mockIdentityDocs = [
      { id: 'idt_collision', sourceUserIds: ['usr_a', 'usr_b'], status: 'collision_pending' },
    ];

    const result = await qaHealth._identityMigrationStatus();
    expect(result.identityBackfillPending).toBe(0);
    expect(result.status).toBe('complete');
    expect(result.collisionPending).toBe(1);
  });

  test('collisionPending is informational only — nonzero does not prevent status: complete', async () => {
    mockUserDocs = [{ id: 'usr_a', email: 'shared@gmail.com' }];
    mockIdentityDocs = [{ id: 'idt_collision', sourceUserIds: ['usr_a'], status: 'collision_pending' }];

    const result = await qaHealth._identityMigrationStatus();
    expect(result.collisionPending).toBe(1);
    expect(result.status).toBe('complete'); // the collision itself never fails the gate
  });

  test('users with no email are irrelevant to this migration (student/username-only accounts)', async () => {
    mockUserDocs = [{ id: 'usr_student', username: 'stu001' }]; // no email field at all
    mockIdentityDocs = [];

    const result = await qaHealth._identityMigrationStatus();
    expect(result.identityBackfillPending).toBe(0);
    expect(result.status).toBe('complete');
  });
});
