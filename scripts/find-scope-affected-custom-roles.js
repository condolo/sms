/**
 * find-scope-affected-custom-roles.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * A user reported a custom "Front Office" role that had real Students
 * RBAC permissions (View/Edit/Add/Delete via a per-user override) but
 * whose Students list always came back empty. Root cause: the Data
 * Scope layer (server/middleware/scopeMiddleware.js) is a SEPARATE
 * authorization layer from RBAC, keyed off the account's role rather
 * than its granted permissions. Any custom role without an explicit
 * `scopeLevel` field falls back to `ROLE_SCOPE_LEVEL[baseRole]` — and
 * since the recommended baseRole option is 'teacher' ('assigned'
 * scope, restricted to rows in teaching_assignments), any non-teaching
 * custom role built on that recommendation is guaranteed to see zero
 * records in Students/Attendance/Grades/Lessons/Medical-alerts,
 * regardless of what RBAC grants it.
 *
 * `scopeLevel` is now a first-class field (see server/routes/settings.js
 * POST/PUT /custom-roles and server/middleware/scopeMiddleware.js), and
 * new custom roles default to 'school' going forward. This script finds
 * every EXISTING custom role, across every school, that predates the
 * fix and is silently sitting in the same trap today — so each can be
 * reviewed and fixed via Settings -> Roles & Permissions -> Edit Role
 * -> Data visibility, rather than discovered one broken account at a
 * time.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes. For each school, lists every
 * custom_roles doc with no scopeLevel set whose baseRole resolves to
 * 'assigned' (i.e. currently silently scoped like a teacher), plus how
 * many live user accounts hold that role — the users most likely to be
 * hitting this today. A role with baseRole 'admin' or 'deputy' is NOT
 * flagged: those already resolve to 'school' (unrestricted) under the
 * legacy fallback, so they're not affected by this bug.
 *
 * Usage:
 *   node scripts/find-scope-affected-custom-roles.js                  # all schools
 *   node scripts/find-scope-affected-custom-roles.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TARGET_SCHOOL = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

// Mirrors scopeMiddleware.js's ROLE_SCOPE_LEVEL for the 3 baseRole choices
// a custom role can have (see SettingsPage.jsx's CreateCustomRoleModal).
const BASE_ROLE_FALLBACK = { teacher: 'assigned', deputy: 'school', admin: 'school' };

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('Connected [READ-ONLY — this script makes no writes]\n');

  const Schools     = _model('schools');
  const CustomRoles = _model('custom_roles');
  const Users       = _model('users');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let totalFlagged = 0;
  let totalUsersAffected = 0;

  for (const school of schools) {
    const roles = await CustomRoles.find({ schoolId: school.id }).lean();
    if (!roles.length) continue;

    const flagged = roles.filter(r => {
      if (r.scopeLevel) return false; // already fixed / explicitly set
      const fallback = BASE_ROLE_FALLBACK[r.baseRole] ?? 'assigned';
      return fallback === 'assigned';
    });
    if (!flagged.length) continue;

    console.log(`── ${school.name} (${school.id}) ──`);
    for (const r of flagged) {
      totalFlagged++;
      const userCount = await Users.countDocuments({ schoolId: school.id, role: r.key });
      totalUsersAffected += userCount;
      console.log(
        `  "${r.label}" (key: ${r.key})  baseRole=${r.baseRole ?? '(unset, defaults to teacher)'}  ` +
        `${userCount} user(s) currently holding this role`
      );
    }
    console.log('');
  }

  if (totalFlagged === 0) {
    console.log(TARGET_SCHOOL
      ? `No affected custom roles found at school ${TARGET_SCHOOL}.`
      : 'No affected custom roles found across any school.');
  } else {
    console.log(`Found ${totalFlagged} custom role(s) across ${totalUsersAffected} user account(s) still on the legacy 'assigned' fallback.`);
    console.log('No changes were made — this is a report only. To fix one: Settings -> Roles & Permissions ->');
    console.log('Edit Role -> Data visibility -> "Whole school" (or "Assigned classes only" if it genuinely should stay class-scoped).');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
