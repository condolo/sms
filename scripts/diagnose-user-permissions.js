/**
 * diagnose-user-permissions.js — READ-ONLY diagnostic
 *
 * Reports the exact evidence needed to distinguish role-assignment,
 * role-permissions, module-setting, frontend-visibility, and
 * backend-authorization problems for one user, without guessing.
 *
 * WHY THIS EXISTS
 * There are TWO independent implementations of "merge a per-user
 * override on top of a role's permissions":
 *   - server/middleware/rbac.js's _mergeUserOverrides — fixed in the
 *     2026-08 RBAC remediation to floor the coarse module grant at the
 *     role's own value (per-user overrides can only ADD, never suppress
 *     a module the role already grants).
 *   - server/routes/auth.js's _loadMergedPermissions — feeds the LOGIN
 *     RESPONSE and GET /api/auth/permissions (what the sidebar actually
 *     renders from) — still does a plain `{...roleResult, ...userDoc.
 *     permissions}` spread, which CAN let a stale per-user override
 *     document silently overwrite (not merge with) the role's grant.
 * This script runs BOTH implementations against the real documents for
 * one user and reports if/where they diverge — the exact evidence to
 * tell "she's not seeing it" (frontend visibility) apart from "she
 * genuinely can't do it" (backend authorization), before any fix is
 * attempted.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes.
 *
 * Usage:
 *   node scripts/diagnose-user-permissions.js --email an.wanjiku@mla.ac.ke --module admissions
 *   node scripts/diagnose-user-permissions.js --userId usr_xxx --schoolId sch_xxx --module admissions
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}
const EMAIL     = argVal('--email');
const USER_ID   = argVal('--userId');
const SCHOOL_ID = argVal('--schoolId');
const MODULE    = argVal('--module') || 'admissions';

if (!EMAIL && !(USER_ID && SCHOOL_ID)) {
  console.error('Usage: node scripts/diagnose-user-permissions.js --email <email> [--module <key>]');
  console.error('   or: node scripts/diagnose-user-permissions.js --userId <id> --schoolId <id> [--module <key>]');
  process.exit(1);
}

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

// ── Mirrors server/middleware/rbac.js's _mergeUserOverrides exactly (FIXED version) ──
function mergeUserOverrides_rbacFixed(rolePerms, userPerms) {
  const merged = { ...rolePerms, ...userPerms };
  const touchedModules = new Set(
    Object.keys(userPerms).filter(k => k.includes('__')).map(k => k.split('__')[0])
  );
  for (const mod of touchedModules) {
    const actions = new Set(Array.isArray(rolePerms[mod]) ? rolePerms[mod] : []);
    for (const [key, arr] of Object.entries(merged)) {
      if (key.startsWith(`${mod}__`) && Array.isArray(arr)) arr.forEach(a => actions.add(a));
    }
    merged[mod] = [...actions];
  }
  return merged;
}

// ── Mirrors server/routes/auth.js's _loadMergedPermissions's per-user step exactly (UNFIXED version) ──
function mergeUserOverrides_authUnfixed(roleResult, userDocPermissions) {
  return { ...roleResult, ...userDocPermissions };
}

async function run() {
  // Mirrors server/config/db.js exactly — without an explicit dbName, the
  // driver defaults to the "test" database, not the app's real one, when
  // the connection string's own path segment is empty (as it is here).
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'innolearn',
  });
  console.log('Connected [READ-ONLY — this script makes no writes]\n');

  const Users       = _model('users');
  const RolePerms   = _model('role_permissions');
  const Schools     = _model('schools');

  const user = EMAIL
    ? await Users.findOne({ email: EMAIL }).lean()
    : await Users.findOne({ id: USER_ID, schoolId: SCHOOL_ID }).lean();

  if (!user) { console.log('No user found matching that email/id.'); await mongoose.disconnect(); return; }

  const schoolId = user.schoolId;
  const role     = user.role;
  const userId   = user.id ?? user._id?.toString();

  console.log('── 1. users.role ──────────────────────────────');
  console.log(`  name: ${user.name ?? '(no name)'}  email: ${user.email}`);
  console.log(`  users.role = "${role}"   userId = ${userId}   schoolId = ${schoolId}\n`);

  console.log(`── 2. role_permissions for roleKey="${role}" ──`);
  const roleDoc = await RolePerms.findOne({ schoolId, roleKey: role }).lean();
  if (!roleDoc) {
    console.log(`  NO role_permissions document exists for roleKey="${role}" at this school.`);
  } else {
    console.log(`  Found. permissions.${MODULE} = ${JSON.stringify(roleDoc.permissions?.[MODULE] ?? '(not present)')}`);
    const subKeys = Object.keys(roleDoc.permissions ?? {}).filter(k => k.startsWith(`${MODULE}__`));
    if (subKeys.length) {
      console.log(`  Sub-keys under ${MODULE}:`);
      subKeys.forEach(k => console.log(`    ${k} = ${JSON.stringify(roleDoc.permissions[k])}`));
    }
  }
  console.log('');

  console.log(`── 2b. role_permissions PER-USER override for userId="${userId}" ──`);
  const userDoc = await RolePerms.findOne({ schoolId, userId }).lean();
  if (!userDoc) {
    console.log('  No per-user override document exists for this user. (Rules out branch 3 entirely — nothing to diverge on.)');
  } else {
    console.log(`  Found a per-user override document. Full permissions object:`);
    console.log(`  ${JSON.stringify(userDoc.permissions, null, 2)}`);
  }
  console.log('');

  const rolePermsObj = roleDoc?.permissions ?? {};
  const userPermsObj = userDoc?.permissions ?? null;

  console.log('── 3. Computed effective admissions permissions — BOTH implementations ──');
  const viaRbacFixed = userPermsObj
    ? mergeUserOverrides_rbacFixed(rolePermsObj, userPermsObj)
    : rolePermsObj;
  console.log(`  rbac.js (FIXED, used for actual API authorization):`);
  console.log(`    effective.${MODULE} = ${JSON.stringify(viaRbacFixed[MODULE] ?? [])}`);

  const viaAuthUnfixed = userPermsObj
    ? mergeUserOverrides_authUnfixed(rolePermsObj, userPermsObj)
    : rolePermsObj;
  console.log(`  auth.js (_loadMergedPermissions, UNFIXED, feeds sidebar/session):`);
  console.log(`    effective.${MODULE} = ${JSON.stringify(viaAuthUnfixed[MODULE] ?? [])}`);

  const diverge = JSON.stringify(viaRbacFixed[MODULE] ?? []) !== JSON.stringify(viaAuthUnfixed[MODULE] ?? []);
  console.log(`\n  ${diverge ? '⚠️  THESE DIVERGE — confirms the frontend-visibility bug for this exact user/module.' : '✓ These agree — the two-implementation bug is NOT the cause here for this module.'}\n`);

  console.log('── 4. Is the module enabled for this school? ──');
  const school = await Schools.findOne({ id: schoolId }).select('moduleConfig').lean();
  const cfg     = school?.moduleConfig || [];
  const entry   = cfg.find(m => m.key === MODULE);
  console.log(`  moduleConfig entry for '${MODULE}': ${entry ? JSON.stringify(entry) : '(none — defaults to enabled)'}`);
  console.log(`  Enabled: ${entry ? entry.enabled !== false : true}\n`);

  console.log('── 5. Authenticated API response ──');
  console.log('  NOT checked by this script — requires an authenticated request as this user,');
  console.log('  which needs either their session or credentials. Check via browser DevTools');
  console.log('  Network tab while logged in as this user, on the actual Admissions page load.\n');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
