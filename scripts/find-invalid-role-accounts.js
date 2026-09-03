/**
 * find-invalid-role-accounts.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * POST /api/settings/users/bulk-invite (HR module's "Create Login
 * Accounts" bulk action) previously did `const role = s.role || 'teacher'`
 * with NO validation — unlike its single-item sibling POST /users/invite,
 * which has always validated the role against the real built-in role list
 * plus the school's custom roles. The client sends `role: staffType`, a
 * free-text HR job-title field ("Marketing", "Front Office Assistant",
 * ...), not a controlled vocabulary — so any staff member bulk-invited
 * while their staffType didn't happen to exactly match a real role key
 * got a login account created with a garbage `role`.
 *
 * That account authenticates fine (password matches) but fails EVERY
 * RBAC check silently — `_loadPerms()` returns {} for an unrecognized
 * role, so every permission check resolves to false. It's a fully
 * locked-out ghost account: valid credentials, zero access anywhere, no
 * error ever shown to the admin or the person themselves.
 *
 * Both the bulk-invite validation gap and the client's naive derivation
 * are now fixed (see server/routes/settings.js's _validateInviteRole and
 * client/src/pages/hr/HRPage.jsx's CreateLoginModal) — new bulk invites
 * can't create this state anymore. This script finds anyone this already
 * happened to, across every already-onboarded school, before the fix.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes. For each school, lists every
 * active `users` doc whose `role` matches neither a built-in system role
 * nor any of that school's `custom_roles` keys, with their lastLogin (a
 * blank one is the strongest signal nobody's ever tried using it; a set
 * one means someone logged in to a completely broken account and likely
 * gave up or is still confused right now). Does not guess what role they
 * SHOULD have — that's a real decision (what does this person actually
 * do?) only a human at that school can make; use PUT /users/:id via
 * Settings -> Users, or the client-side fix's per-row Create Login flow,
 * to correct one.
 *
 * Usage:
 *   node scripts/find-invalid-role-accounts.js                  # all schools
 *   node scripts/find-invalid-role-accounts.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TARGET_SCHOOL = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

// Mirrors server/routes/settings.js's BUILTIN_INVITE_ROLES exactly.
const BUILTIN_INVITE_ROLES = new Set([
  'admin', 'superadmin', 'principal', 'deputy_principal', 'deputy', 'section_head', 'teacher',
  'exams_officer', 'timetabler', 'admissions_officer',
  'finance', 'hr', 'discipline_committee', 'parent', 'guardian', 'student',
]);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  // Mirrors server/config/db.js exactly — without an explicit dbName, the
  // driver defaults to the "test" database, not the app's real one, when
  // the connection string's own path segment is empty.
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'innolearn',
  });
  console.log('Connected [READ-ONLY — this script makes no writes]\n');

  const Schools     = _model('schools');
  const Users       = _model('users');
  const CustomRoles = _model('custom_roles');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let totalFlagged = 0;

  for (const school of schools) {
    const users = await Users.find({ schoolId: school.id, isActive: { $ne: false } })
      .select('id name email role lastLogin createdAt').lean();
    if (!users.length) continue;

    const customRoleKeys = new Set(
      (await CustomRoles.find({ schoolId: school.id }).select('key').lean()).map(r => r.key)
    );

    const invalid = users.filter(u => u.role && !BUILTIN_INVITE_ROLES.has(u.role) && !customRoleKeys.has(u.role));
    if (!invalid.length) continue;

    console.log(`── ${school.name} (${school.id}) ──`);
    for (const u of invalid) {
      totalFlagged++;
      const loginStatus = u.lastLogin
        ? `logged in at least once (last: ${u.lastLogin})`
        : 'never successfully logged in (or never noticed anything was wrong)';
      console.log(
        `  "${u.name ?? '(no name)'}" <${u.email}>  role="${u.role}" (not a real role or custom role)  ` +
        `${loginStatus}  created=${u.createdAt ?? '(unknown)'}  id=${u.id ?? '—'}`
      );
    }
    console.log('');
  }

  if (totalFlagged === 0) {
    console.log(TARGET_SCHOOL
      ? `No invalid-role accounts found at school ${TARGET_SCHOOL}.`
      : 'No invalid-role accounts found across any school.');
  } else {
    console.log(`Found ${totalFlagged} account(s) with a role that matches neither a built-in role nor a custom role.`);
    console.log('No changes were made — this is a report only. To fix one: Settings -> Users -> click their role pill -> pick the correct role.');
    console.log('This immediately revokes their stale session and applies the corrected role on next login.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
