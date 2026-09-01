/* ============================================================
   Unit tests — server/scripts/migrate-legacy-deputy-role.js's pure
   decision logic (planUserMigration, planRolePermsMigration)

   Role Architecture Audit 2026-08 §4: "Don't simply delete the alias
   first." These tests pin the exact safety rule the migration script
   follows — a genuinely divergent 'deputy' vs 'deputy_principal'
   role_permissions document must NEVER be auto-resolved, with or
   without --apply; only a person decides which grants are correct.

   No MongoDB required — these are pure functions, exported specifically
   so this logic is testable independent of the script's DB-connecting
   shell (which only runs when the file is executed directly, guarded
   by require.main === module).
   ============================================================ */
'use strict';

const { planUserMigration, planRolePermsMigration } = require('../scripts/migrate-legacy-deputy-role');

describe('planUserMigration', () => {
  test('a user with role="deputy" is planned for a straight rename to deputy_principal', () => {
    const plan = planUserMigration({ id: 'u_1', role: 'deputy', roles: ['deputy'] });
    expect(plan.action).toBe('rename');
    expect(plan.newRole).toBe('deputy_principal');
    expect(plan.newRoles).toEqual(['deputy_principal']);
  });

  test('a user whose roles[] contains "deputy" among others has only that entry renamed, others untouched', () => {
    const plan = planUserMigration({ id: 'u_2', role: 'deputy', roles: ['deputy', 'timetabler'] });
    expect(plan.newRoles).toEqual(['deputy_principal', 'timetabler']);
  });

  test('a user already on deputy_principal is left alone', () => {
    const plan = planUserMigration({ id: 'u_3', role: 'deputy_principal', roles: ['deputy_principal'] });
    expect(plan.action).toBe('none');
  });

  test('a user on an unrelated role is left alone', () => {
    const plan = planUserMigration({ id: 'u_4', role: 'teacher', roles: ['teacher'] });
    expect(plan.action).toBe('none');
  });
});

describe('planRolePermsMigration — the safety-critical decision', () => {
  test('no "deputy" document at all — nothing to do', () => {
    const plan = planRolePermsMigration(null, { roleKey: 'deputy_principal', permissions: { finance: ['read'] } });
    expect(plan.action).toBe('none');
  });

  test('a "deputy" document exists but no "deputy_principal" document does — safe rename, nothing to reconcile', () => {
    const plan = planRolePermsMigration({ roleKey: 'deputy', permissions: { finance: ['read'] } }, null);
    expect(plan.action).toBe('rename');
  });

  test('a "deputy" document identical to "deputy_principal" — safe to delete as redundant', () => {
    const perms = { finance: ['read', 'create'], hr: ['read'] };
    const plan = planRolePermsMigration(
      { roleKey: 'deputy', permissions: perms },
      { roleKey: 'deputy_principal', permissions: { ...perms } }, // same content, different object
    );
    expect(plan.action).toBe('delete');
  });

  test('THE SAFETY RULE: a "deputy" document that DIFFERS from "deputy_principal" is flagged for manual review, never auto-resolved', () => {
    const plan = planRolePermsMigration(
      { roleKey: 'deputy',            permissions: { finance: ['read', 'create', 'update', 'delete'] } },
      { roleKey: 'deputy_principal',  permissions: { finance: ['read'] } },
    );
    expect(plan.action).toBe('manual_review');
    // Both sides' actual permissions must be surfaced so a human has
    // what they need to decide — silently picking one would defeat
    // the entire point of this rule.
    expect(plan.deputyPermissions).toEqual({ finance: ['read', 'create', 'update', 'delete'] });
    expect(plan.deputyPrincipalPermissions).toEqual({ finance: ['read'] });
  });

  test('a divergent document is flagged for manual review regardless of which module differs', () => {
    const plan = planRolePermsMigration(
      { roleKey: 'deputy',           permissions: { finance: ['read'], hr: [] } },
      { roleKey: 'deputy_principal', permissions: { finance: ['read'], hr: ['read'] } },
    );
    expect(plan.action).toBe('manual_review');
  });
});
