#!/usr/bin/env node
/* ============================================================
   Msingi — Legacy 'deputy' role migration
   Role Architecture Audit 2026-08 §4.

   'deputy' was the role key before it was renamed to
   'deputy_principal'. rbac.js keeps a live fallback (ROLE_ALIASES:
   { deputy: 'deputy_principal' }) so an account still literally on the
   old key still resolves permissions — but ONLY when no role_permissions
   document exists under the 'deputy' key itself. If a stale one does
   exist, it silently wins over the fallback: an admin edits Deputy
   Principal in Settings -> Roles & Permissions, and an account still on
   the legacy key never sees the change. That's the exact split-brain
   this migration exists to close, safely.

   THIS SCRIPT MUST BE RUN — AND ITS FINDINGS REVIEWED — BEFORE THE
   `deputy` ALIAS IS REMOVED FROM ANY APPLICATION CODE. Removing the
   alias first, without knowing whether anything still depends on it,
   is exactly the "simply delete the alias" shortcut the audit
   explicitly rejected.

   Usage:
     node server/scripts/migrate-legacy-deputy-role.js            # dry run (default) — reports only, writes nothing
     node server/scripts/migrate-legacy-deputy-role.js --apply    # perform the SAFE migrations found
     node server/scripts/migrate-legacy-deputy-role.js --schoolId=sch_xxx [--apply]

   What --apply does and does not do:
     - Users with role/roles containing 'deputy': renamed to
       'deputy_principal' (their roles[] array is corrected too), their
       tokens revoked (forces a fresh JWT with the corrected role on
       next request, same mechanism settings.js's own role-change route
       uses), and their linked teacher record's staffType cascaded to
       match — identical to the courtesy cascade PUT /users/:id already
       does for a normal role change. This is a straight rename of the
       same identity; nothing is discarded.
     - A role_permissions document keyed 'deputy' for a school that has
       NO 'deputy_principal' document yet: renamed in place (roleKey
       changed) — nothing to reconcile, nothing lost.
     - A 'deputy' document that is byte-identical to that school's
       existing 'deputy_principal' document: deleted as redundant —
       both grant exactly the same thing, so nothing is lost by
       collapsing to the one canonical document.
     - A 'deputy' document that DIFFERS from that school's existing
       'deputy_principal' document: NEVER auto-resolved, in dry run or
       with --apply. Flagged as needing a human decision about which
       grants are actually correct — auto-merging or auto-overwriting a
       genuinely divergent permission set is a security decision, not a
       migration this script gets to make on its own.

   Output: JSON report to stdout (same shape/severity convention as
   server/scripts/audit.js) + a human summary to stderr. Exit code:
   0 = clean or all findings safely handled, 1 = manual-review items
   remain, 2 = script error.
   ============================================================ */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

/* ── Pure decision logic — exported for unit testing without a DB ── */

/**
 * Given a user document, decide whether it needs migrating off the
 * legacy 'deputy' role key. Always a plain rename when it applies —
 * there is no scenario where this loses information, since 'deputy'
 * and 'deputy_principal' represent the same real-world role.
 */
function planUserMigration(user) {
  const role  = user.role;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const onLegacy = role === 'deputy' || roles.includes('deputy');
  if (!onLegacy) return { action: 'none' };
  return {
    action: 'rename',
    newRole:  role === 'deputy' ? 'deputy_principal' : role,
    newRoles: roles.map(r => (r === 'deputy' ? 'deputy_principal' : r)),
  };
}

/**
 * Given a school's 'deputy'-keyed role_permissions document (or null)
 * and its 'deputy_principal'-keyed document (or null), decide what to
 * do. Three outcomes:
 *   - 'none'          — no legacy document exists for this school.
 *   - 'rename'         — safe: no deputy_principal document exists yet,
 *                        nothing to reconcile.
 *   - 'delete'         — safe: identical to the existing
 *                        deputy_principal document, so removing the
 *                        redundant 'deputy' copy loses nothing.
 *   - 'manual_review'  — UNSAFE to automate: the two documents differ.
 *                        Never resolved automatically, with or without
 *                        --apply.
 */
function planRolePermsMigration(deputyDoc, deputyPrincipalDoc) {
  if (!deputyDoc) return { action: 'none' };
  if (!deputyPrincipalDoc) {
    return { action: 'rename', reason: 'no deputy_principal document exists yet for this school — nothing to reconcile' };
  }
  const a = JSON.stringify(deputyDoc.permissions ?? {});
  const b = JSON.stringify(deputyPrincipalDoc.permissions ?? {});
  if (a === b) {
    return { action: 'delete', reason: 'identical to the existing deputy_principal document — redundant, safe to remove' };
  }
  return {
    action: 'manual_review',
    reason: 'differs from the existing deputy_principal document — requires a human decision, not automated',
    deputyPermissions:          deputyDoc.permissions ?? {},
    deputyPrincipalPermissions: deputyPrincipalDoc.permissions ?? {},
  };
}

/* ── Everything below only runs when this file is executed directly,
   never when required by a test. ────────────────────────────────── */
if (require.main === module) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('[migrate-legacy-deputy-role] MONGODB_URI not set in environment. Exiting.');
    process.exit(2);
  }

  const args      = process.argv.slice(2);
  const apply     = args.includes('--apply');
  const schoolArg = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;

  function _model(col) {
    const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                    .replace(/^./, c => c.toUpperCase()) + 'Doc';
    if (mongoose.models[name]) return mongoose.models[name];
    const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
    return mongoose.model(name, schema, col);
  }

  const findings = { usersRenamed: [], rolePermsRenamed: [], rolePermsDeleted: [], manualReview: [] };

  async function run() {
    console.error(`[migrate-legacy-deputy-role] Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (reporting only)'}`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

    let schools;
    if (schoolArg) {
      schools = await _model('schools').find({ id: schoolArg }).lean();
      if (!schools.length) { console.error(`[migrate-legacy-deputy-role] School not found: ${schoolArg}`); process.exit(2); }
    } else {
      schools = await _model('schools').find({}).lean();
    }
    const schoolIds = schools.map(s => s.id).filter(Boolean);

    // ── Users still on the legacy key ──────────────────────────
    for (const schoolId of schoolIds) {
      const users = await _model('users').find({
        schoolId,
        $or: [{ role: 'deputy' }, { roles: 'deputy' }],
      }).lean();

      for (const user of users) {
        const plan = planUserMigration(user);
        if (plan.action === 'none') continue;
        findings.usersRenamed.push({ schoolId, userId: user.id, email: user.email, from: user.role, to: plan.newRole });
        if (apply) {
          await _model('users').updateOne(
            { id: user.id },
            { $set: { role: plan.newRole, roles: plan.newRoles, updatedAt: new Date().toISOString() } },
          );
          // Same courtesy cascade settings.js's own role-change route
          // does — keep the HR label in sync, and force a fresh JWT so
          // the corrected role takes effect immediately rather than
          // waiting out whatever's left of their current session.
          await _model('teachers').updateOne(
            { schoolId, $or: [{ userId: user.id }, { email: user.email }] },
            { $set: { staffType: plan.newRole, updatedAt: new Date().toISOString() } },
          );
          try {
            const { revokeUserTokens } = require('../utils/token-version');
            await revokeUserTokens(user.id);
          } catch (e) { console.error(`[migrate-legacy-deputy-role] token revocation failed for ${user.id} (non-fatal): ${e.message}`); }
        }
      }
    }

    // ── Stale role_permissions documents ───────────────────────
    for (const schoolId of schoolIds) {
      const [deputyDoc, deputyPrincipalDoc] = await Promise.all([
        _model('role_permissions').findOne({ schoolId, roleKey: 'deputy' }).lean(),
        _model('role_permissions').findOne({ schoolId, roleKey: 'deputy_principal' }).lean(),
      ]);
      const plan = planRolePermsMigration(deputyDoc, deputyPrincipalDoc);
      if (plan.action === 'none') continue;

      if (plan.action === 'rename') {
        findings.rolePermsRenamed.push({ schoolId, reason: plan.reason });
        if (apply) {
          await _model('role_permissions').updateOne({ schoolId, roleKey: 'deputy' }, { $set: { roleKey: 'deputy_principal' } });
        }
      } else if (plan.action === 'delete') {
        findings.rolePermsDeleted.push({ schoolId, reason: plan.reason });
        if (apply) {
          await _model('role_permissions').deleteOne({ schoolId, roleKey: 'deputy' });
        }
      } else if (plan.action === 'manual_review') {
        findings.manualReview.push({
          schoolId, reason: plan.reason,
          deputyPermissions: plan.deputyPermissions,
          deputyPrincipalPermissions: plan.deputyPrincipalPermissions,
        });
      }
    }

    await mongoose.disconnect();

    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  Legacy \'deputy\' role migration — summary');
    console.error('═══════════════════════════════════════════════════════');
    console.error(`  Schools checked           : ${schoolIds.length}`);
    console.error(`  Users renamed${apply ? '' : ' (would rename)'}       : ${findings.usersRenamed.length}`);
    console.error(`  role_permissions renamed${apply ? '' : ' (would)'} : ${findings.rolePermsRenamed.length}`);
    console.error(`  role_permissions deleted${apply ? '' : ' (would)'} : ${findings.rolePermsDeleted.length}`);
    console.error(`  NEEDS MANUAL REVIEW        : ${findings.manualReview.length}`);
    if (findings.manualReview.length) {
      console.error('  ── these were NOT touched, --apply or not — a person must decide:');
      for (const m of findings.manualReview) {
        console.error(`     school ${m.schoolId}: deputy vs deputy_principal permissions differ`);
      }
    }
    console.error('═══════════════════════════════════════════════════════\n');

    process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...findings }, null, 2) + '\n');
    process.exit(findings.manualReview.length > 0 ? 1 : 0);
  }

  run().catch(err => {
    console.error(`[migrate-legacy-deputy-role] Fatal error: ${err.message}\n${err.stack}`);
    mongoose.disconnect().finally(() => process.exit(2));
  });
}

module.exports = { planUserMigration, planRolePermsMigration };
