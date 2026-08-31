/* ============================================================
   server/middleware/rbac.js — the Per-User override wipeout fix

   Role Architecture Audit 2026-08 §2d, "the most serious finding":
   an admin who granted a person ONE additional Per-User permission
   used to silently strip their inherited role access to every OTHER
   module. Mechanically proven at the time (see the audit doc) by
   feeding a real, single-key override through the old code path and
   watching students:read and attendance:read both flip to false for
   someone whose role plainly grants both.

   These tests exercise the REAL, fixed rbac.js (hasPermission /
   _isAllowed / _mergeUserOverrides) against fake role_permissions
   data — no MongoDB required — proving:
     1. an unrelated module a person's role grants survives a
        Per-User override that never touched it (the actual bug),
     2. the touched sub-key itself reflects the override correctly,
     3. the module's own coarse gate (what a no-subKey rbac() call
        reads) is not stuck ignoring the override,
     4. a role with NO sub-key breakdown at all (exactly what
        repairPermissions.js seeds before any admin customization) is
        still handled correctly — the coarse-grant "floor",
     5. an override that revokes a sub-key doesn't accidentally
        widen a module the role never granted at all.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

let mockRolePerms;
jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection !== 'role_permissions') throw new Error('unexpected collection: ' + collection);
    return {
      findOne: (filter) => ({
        lean: async () => mockRolePerms.find(d =>
          d.schoolId === filter.schoolId &&
          (filter.roleKey !== undefined ? d.roleKey === filter.roleKey : true) &&
          (filter.userId !== undefined ? d.userId === filter.userId : true)
        ) ?? null,
      }),
    };
  }),
}));

const { hasPermission, _mergeUserOverrides } = require('../middleware/rbac');

beforeEach(() => {
  mockRolePerms = [];
});

describe('_mergeUserOverrides — unit', () => {
  test('an untouched module keeps its role value exactly, unmodified', () => {
    const rolePerms = { students: ['read'], attendance: ['read', 'create'] };
    const userPerms = { 'hr__payroll_view': ['read'] };
    const merged = _mergeUserOverrides(rolePerms, userPerms);
    expect(merged.students).toEqual(['read']);
    expect(merged.attendance).toEqual(['read', 'create']);
  });

  test('the touched module\'s coarse key is recomputed as a union, not left stuck at the role\'s original value', () => {
    const rolePerms = { hr: ['read'] }; // coarse only — no sub-keys yet (freshly-seeded shape)
    const userPerms = { 'hr__payroll_view': ['read', 'create'] };
    const merged = _mergeUserOverrides(rolePerms, userPerms);
    expect(merged.hr.sort()).toEqual(['create', 'read']); // union of the floor + the override
    expect(merged['hr__payroll_view']).toEqual(['read', 'create']);
  });

  test('a role WITH existing sub-key grants under the touched module keeps them alongside the new override', () => {
    const rolePerms = { hr: ['read'], 'hr__leave_view': ['read'] };
    const userPerms = { 'hr__payroll_view': ['read'] };
    const merged = _mergeUserOverrides(rolePerms, userPerms);
    expect(merged['hr__leave_view']).toEqual(['read']); // untouched sub-key survives
    expect(merged.hr.sort()).toEqual(['read']);
  });

  test('revoking a sub-key does not widen a module the role never granted', () => {
    const rolePerms = { finance: [] };
    const userPerms = { 'finance__void_invoice': [] };
    const merged = _mergeUserOverrides(rolePerms, userPerms);
    expect(merged.finance).toEqual([]);
  });
});

describe('hasPermission — end to end through the real merge', () => {
  test('THE BUG: a Per-User override for one module no longer erases role access to unrelated modules', async () => {
    mockRolePerms = [
      { schoolId: SCHOOL, roleKey: 'hr', permissions: { students: ['read'], hr: ['read'], attendance: ['read'] } },
      // Exactly what settings.js's _deriveUserOverridePerms now writes for
      // a single Per-User toggle — sparse, one key only.
      { schoolId: SCHOOL, userId: 'u_jane', permissions: { 'hr__payroll_view': ['read'] } },
    ];
    const jane = { jwtUser: { userId: 'u_jane', schoolId: SCHOOL, role: 'hr', roles: ['hr'] } };

    expect(await hasPermission(jane, 'students', 'read')).toBe(true);
    expect(await hasPermission(jane, 'attendance', 'read')).toBe(true);
    expect(await hasPermission(jane, 'hr', 'read')).toBe(true);
    expect(await hasPermission(jane, 'hr', 'read', 'payroll_view')).toBe(true);
  });

  test('a role with zero sub-key breakdown (fresh repairPermissions.js seed) still resolves correctly after one override', async () => {
    mockRolePerms = [
      { schoolId: SCHOOL, roleKey: 'teacher', permissions: { students: ['read'], grades: ['read', 'create'] } },
      { schoolId: SCHOOL, userId: 'u_bob', permissions: { 'grades__enter_marks': ['read', 'create'] } },
    ];
    const bob = { jwtUser: { userId: 'u_bob', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] } };

    expect(await hasPermission(bob, 'students', 'read')).toBe(true);
    expect(await hasPermission(bob, 'grades', 'read')).toBe(true);
    expect(await hasPermission(bob, 'grades', 'create', 'enter_marks')).toBe(true);
  });

  test('a user with NO per-user override at all is unaffected — pure role permissions', async () => {
    mockRolePerms = [
      { schoolId: SCHOOL, roleKey: 'finance', permissions: { finance: ['read', 'create'] } },
    ];
    const carol = { jwtUser: { userId: 'u_carol', schoolId: SCHOOL, role: 'finance', roles: ['finance'] } };
    expect(await hasPermission(carol, 'finance', 'read')).toBe(true);
    expect(await hasPermission(carol, 'students', 'read')).toBe(false);
  });

  test('Global (By Role) edits still apply normally to everyone with no override', async () => {
    mockRolePerms = [
      { schoolId: SCHOOL, roleKey: 'deputy_principal', permissions: { finance: ['read', 'create', 'update', 'delete'] } },
    ];
    const john = { jwtUser: { userId: 'u_john', schoolId: SCHOOL, role: 'deputy_principal', roles: ['deputy_principal'] } };
    expect(await hasPermission(john, 'finance', 'delete')).toBe(true);
  });
});
