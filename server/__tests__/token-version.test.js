/* ============================================================
   Unit tests — server/utils/token-version.js

   Covers both revocation tiers (ADR-0003 Decision 4):
     - users.tokenVersion / getTokenVersion / revokeUserTokens
       (pre-existing, previously untested)
     - identities.tokenVersion / getIdentityTokenVersion /
       revokeIdentityTokens (new — C8/MR-001 Phase 1)

   Both pairs share the same cache-then-DB-fallback shape; these tests
   verify caching behavior, cache invalidation on revocation, and that
   the two tiers are fully independent of each other.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let userDocs = [];
let identityDocs = [];

const mockUsersFindOne = jest.fn((filter) => ({
  lean: () => Promise.resolve(userDocs.find(u => u.id === filter.id) || null),
}));
const mockUsersUpdateOne = jest.fn((filter, update) => {
  const u = userDocs.find(x => x.id === filter.id);
  if (u) u.tokenVersion = (u.tokenVersion || 0) + update.$inc.tokenVersion;
  return Promise.resolve({ modifiedCount: u ? 1 : 0 });
});

const mockIdentitiesFindOne = jest.fn((filter) => ({
  lean: () => Promise.resolve(identityDocs.find(i => i.id === filter.id) || null),
}));
const mockIdentitiesUpdateOne = jest.fn((filter, update) => {
  const i = identityDocs.find(x => x.id === filter.id);
  if (i) i.tokenVersion = (i.tokenVersion || 0) + update.$inc.tokenVersion;
  return Promise.resolve({ modifiedCount: i ? 1 : 0 });
});

jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') return { findOne: mockUsersFindOne, updateOne: mockUsersUpdateOne };
    if (collection === 'identities') return { findOne: mockIdentitiesFindOne, updateOne: mockIdentitiesUpdateOne };
    return {};
  }),
}));

describe('token-version', () => {
  let tokenVersion;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    userDocs = [{ id: 'usr_1', tokenVersion: 3 }];
    identityDocs = [{ id: 'idt_1', tokenVersion: 5 }];
    tokenVersion = require('../utils/token-version');
  });

  describe('getTokenVersion / revokeUserTokens (users.tokenVersion — school-scoped)', () => {
    test('returns the stored version for a known user', async () => {
      await expect(tokenVersion.getTokenVersion('usr_1')).resolves.toBe(3);
    });

    test('falls back to 0 for a user with no tokenVersion field set', async () => {
      userDocs.push({ id: 'usr_2' });
      await expect(tokenVersion.getTokenVersion('usr_2')).resolves.toBe(0);
    });

    test('caches the result — a second call within TTL does not hit the DB again', async () => {
      await tokenVersion.getTokenVersion('usr_1');
      await tokenVersion.getTokenVersion('usr_1');
      expect(mockUsersFindOne).toHaveBeenCalledTimes(1);
    });

    test('revokeUserTokens increments the DB version and invalidates the cache', async () => {
      await tokenVersion.getTokenVersion('usr_1'); // warm the cache at version 3
      await tokenVersion.revokeUserTokens('usr_1');

      const [filter, update] = mockUsersUpdateOne.mock.calls[0];
      expect(filter).toEqual({ id: 'usr_1' });
      expect(update).toEqual({ $inc: { tokenVersion: 1 } });

      // Cache was invalidated — the next read re-hits the DB and sees the bumped version.
      const version = await tokenVersion.getTokenVersion('usr_1');
      expect(version).toBe(4);
      expect(mockUsersFindOne).toHaveBeenCalledTimes(2);
    });

    test('revoking one user never touches another user\'s version', async () => {
      userDocs.push({ id: 'usr_2', tokenVersion: 0 });
      await tokenVersion.revokeUserTokens('usr_1');
      await expect(tokenVersion.getTokenVersion('usr_2')).resolves.toBe(0);
    });
  });

  describe('getIdentityTokenVersion / revokeIdentityTokens (identities.tokenVersion — cross-school)', () => {
    test('returns the stored version for a known identity', async () => {
      await expect(tokenVersion.getIdentityTokenVersion('idt_1')).resolves.toBe(5);
    });

    test('falls back to 0 for an identity with no tokenVersion field set', async () => {
      identityDocs.push({ id: 'idt_2' });
      await expect(tokenVersion.getIdentityTokenVersion('idt_2')).resolves.toBe(0);
    });

    test('caches the result — a second call within TTL does not hit the DB again', async () => {
      await tokenVersion.getIdentityTokenVersion('idt_1');
      await tokenVersion.getIdentityTokenVersion('idt_1');
      expect(mockIdentitiesFindOne).toHaveBeenCalledTimes(1);
    });

    test('revokeIdentityTokens increments the DB version and invalidates the cache', async () => {
      await tokenVersion.getIdentityTokenVersion('idt_1'); // warm at version 5
      await tokenVersion.revokeIdentityTokens('idt_1');

      const [filter, update] = mockIdentitiesUpdateOne.mock.calls[0];
      expect(filter).toEqual({ id: 'idt_1' });
      expect(update).toEqual({ $inc: { tokenVersion: 1 } });

      const version = await tokenVersion.getIdentityTokenVersion('idt_1');
      expect(version).toBe(6);
      expect(mockIdentitiesFindOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('the two tiers are fully independent', () => {
    test('revoking a user\'s tokens never touches the identities collection', async () => {
      await tokenVersion.revokeUserTokens('usr_1');
      expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled();
    });

    test('revoking an identity\'s tokens never touches the users collection', async () => {
      await tokenVersion.revokeIdentityTokens('idt_1');
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });
  });
});
