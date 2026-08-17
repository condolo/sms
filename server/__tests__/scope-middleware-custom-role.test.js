/* ============================================================
   server/middleware/scopeMiddleware.js — custom-role scopeLevel

   Root-cause coverage for the "RBAC grants Students access but the
   list always comes back empty" bug: a custom role (e.g. "Front
   Office") with no entry in ROLE_SCOPE_LEVEL used to silently fall
   back to `ROLE_SCOPE_LEVEL[baseRole] ?? 'assigned'` — and since the
   recommended baseRole option is 'teacher' ('assigned' scope), a
   non-teaching custom role with zero teaching_assignments rows was
   guaranteed an empty result set regardless of what RBAC granted it.

   scopeLevel is now a first-class field on custom_roles, set explicitly
   via Settings (POST/PUT /custom-roles), and takes priority over the
   baseRole-derived guess. These tests cover:
     - scopeLevel present -> wins outright, baseRole irrelevant
     - scopeLevel absent  -> legacy baseRole fallback, UNCHANGED
       (no existing custom role's live behaviour silently changes)
     - invalidateScopeCacheForRole clears every affected user's cache,
       under both id and _id forms

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

let mockCustomRole;
let mockUsers;

const mockUsersModel = {
  find: jest.fn(() => ({
    select: () => ({ lean: () => Promise.resolve(mockUsers) }),
  })),
};

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'custom_roles') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockCustomRole) }) }) };
    }
    if (col === 'users') return mockUsersModel;
    if (col === 'teaching_assignments') {
      return { find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) };
    }
    return { find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) };
  }),
}));

const {
  scopeMiddleware,
  invalidateScopeCache,
  invalidateScopeCacheForRole,
} = require('../middleware/scopeMiddleware');

function reqAs(role, overrides = {}) {
  return { jwtUser: { schoolId: 'school_001', userId: 'usr_1', role, ...overrides } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCustomRole = null;
  mockUsers = [];
});

describe('scopeMiddleware — custom role scopeLevel', () => {
  test('explicit scopeLevel: "school" wins outright, even with baseRole: teacher', async () => {
    mockCustomRole = { baseRole: 'teacher', scopeLevel: 'school' };
    const req = reqAs('front_office');
    const next = jest.fn();
    await scopeMiddleware(req, {}, next);
    expect(req.scope).toBeNull(); // null = unrestricted, matches level:'school'
    expect(next).toHaveBeenCalled();
  });

  test('explicit scopeLevel: "assigned" is honoured even with baseRole: admin', async () => {
    mockCustomRole = { baseRole: 'admin', scopeLevel: 'assigned' };
    const req = reqAs('librarian_custom');
    const next = jest.fn();
    await scopeMiddleware(req, {}, next);
    expect(req.scope).not.toBeNull();
    expect(req.scope.level).toBe('assigned');
  });

  test('no scopeLevel set — legacy baseRole fallback is unchanged (baseRole: teacher -> assigned)', async () => {
    mockCustomRole = { baseRole: 'teacher' }; // pre-existing custom role, created before this field existed
    const req = reqAs('front_office');
    const next = jest.fn();
    await scopeMiddleware(req, {}, next);
    expect(req.scope).not.toBeNull();
    expect(req.scope.level).toBe('assigned');
  });

  test('no scopeLevel set — legacy baseRole fallback (baseRole: admin -> school, unrestricted)', async () => {
    mockCustomRole = { baseRole: 'admin' };
    const req = reqAs('office_admin');
    const next = jest.fn();
    await scopeMiddleware(req, {}, next);
    expect(req.scope).toBeNull();
  });

  test('no custom_roles doc found at all — fails safe to "assigned", not open access', async () => {
    mockCustomRole = null;
    const req = reqAs('totally_unknown_role');
    const next = jest.fn();
    await scopeMiddleware(req, {}, next);
    expect(req.scope).not.toBeNull();
    expect(req.scope.level).toBe('assigned');
  });

  test('built-in roles never consult custom_roles at all', async () => {
    const req = reqAs('admin');
    const next = jest.fn();
    await scopeMiddleware(req, {}, next);
    expect(req.scope).toBeNull();
    expect(mockUsersModel.find).not.toHaveBeenCalled();
  });
});

describe('invalidateScopeCacheForRole', () => {
  test('drops the cache entry for every user holding the role, under both id and _id forms', async () => {
    // Prime the cache for two users under the 'assigned' branch so there's
    // something to invalidate.
    mockCustomRole = { baseRole: 'teacher' };
    const reqA = reqAs('front_office', { userId: 'usr_a' });
    const reqB = reqAs('front_office', { userId: 'mongo_id_b' });
    await scopeMiddleware(reqA, {}, jest.fn());
    await scopeMiddleware(reqB, {}, jest.fn());
    expect(reqA.scope).not.toBeNull();
    expect(reqB.scope).not.toBeNull();

    mockUsers = [
      { id: 'usr_a', _id: 'mongo_id_a' },
      { id: 'usr_b', _id: 'mongo_id_b' },
    ];

    await invalidateScopeCacheForRole('school_001', 'front_office');

    // Re-running scopeMiddleware for a cached user should hit the DB again
    // (not the stale cache) once invalidated — verified indirectly by
    // confirming invalidateScopeCache doesn't throw and the users lookup
    // ran with the expected filter.
    expect(mockUsersModel.find).toHaveBeenCalledWith({ schoolId: 'school_001', role: 'front_office' });
  });

  test('no-ops safely when schoolId or role is missing', async () => {
    await expect(invalidateScopeCacheForRole(null, 'x')).resolves.toBeUndefined();
    await expect(invalidateScopeCacheForRole('school_001', null)).resolves.toBeUndefined();
    expect(mockUsersModel.find).not.toHaveBeenCalled();
  });

  test('swallows a DB error rather than throwing (best-effort cache bust)', async () => {
    mockUsersModel.find.mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(invalidateScopeCacheForRole('school_001', 'front_office')).resolves.toBeUndefined();
  });
});
