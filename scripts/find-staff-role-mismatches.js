/**
 * find-staff-role-mismatches.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * teachers.staffType (set via HR -> Add/Edit Staff Member, "Staff Type /
 * Job Title") and users.role (set via Settings -> Users -> Role dropdown)
 * are deliberately independent fields — see staff-role-separation.test.js
 * and docs/audits/ROLE_ARCHITECTURE_AUDIT_2026-08.md. RBAC reads ONLY
 * users.role; staffType is a cosmetic HR label.
 *
 * That separation is correct and intentional, but it means an admin can
 * set someone's staffType to "Admissions Officer" in HR, see it reflected
 * on the staff card, and reasonably assume that person now has admissions
 * access — when their actual users.role was never changed in Settings ->
 * Users, so nothing changed for them at all. This script finds every
 * staff member currently in that split-brain state: their staffType names
 * a real role (built-in or custom), but their linked login account's role
 * is something else.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes. For each school, joins `teachers`
 * (staffType, userId) against `users` (role) and flags every case where
 * staffType is a real role key that doesn't match the linked user's role.
 * Does not guess which one is "correct" — that's a decision for whoever
 * owns that person's access. To fix one: Settings -> Users -> find them ->
 * Role dropdown -> pick the role that should actually apply. This
 * immediately revokes their stale session and applies the corrected role
 * on next login, and re-syncs staffType to match automatically.
 *
 * Usage:
 *   node scripts/find-staff-role-mismatches.js                  # all schools
 *   node scripts/find-staff-role-mismatches.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TARGET_SCHOOL = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

// Mirrors server/utils/role-validation.js's SYSTEM_ROLES exactly. Deliberately
// does NOT include 'front_office' — per docs/audits/ROLE_ARCHITECTURE_AUDIT_2026-08.md
// §2e, it's not a canonical built-in role; where it's actually assignable it
// exists as a per-school custom_roles document, which the customRoleKeys
// lookup below already covers. Hardcoding it here would risk a false
// "mismatch" at a school where it isn't really a role at all.
const SYSTEM_ROLES = new Set([
  'admin', 'principal', 'deputy_principal', 'deputy', 'section_head', 'teacher',
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
  const Teachers     = _model('teachers');
  const Users        = _model('users');
  const CustomRoles  = _model('custom_roles');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let totalFlagged = 0;

  for (const school of schools) {
    const staff = await Teachers.find({ schoolId: school.id, status: { $ne: 'inactive' }, userId: { $exists: true, $ne: null } })
      .select('id name firstName lastName staffType userId').lean();
    if (!staff.length) continue;

    const customRoleKeys = new Set(
      (await CustomRoles.find({ schoolId: school.id }).select('key').lean()).map(r => r.key)
    );
    const isRealRole = (key) => SYSTEM_ROLES.has(key) || customRoleKeys.has(key);

    const userIds = staff.map(s => s.userId);
    const users = await Users.find({ schoolId: school.id, $or: [{ id: { $in: userIds } }, { _id: { $in: userIds.filter(id => /^[a-f\d]{24}$/i.test(id)) } }] })
      .select('id _id role lastLogin').lean();
    const userById = new Map(users.map(u => [u.id ?? u._id?.toString(), u]));

    const mismatches = [];
    for (const s of staff) {
      if (!s.staffType || !isRealRole(s.staffType)) continue; // not a role-shaped label — nothing to compare
      const user = userById.get(s.userId);
      if (!user) continue; // linked userId doesn't resolve to an active account — separate issue
      if (user.role !== s.staffType) {
        mismatches.push({ staff: s, user });
      }
    }
    if (!mismatches.length) continue;

    console.log(`── ${school.name} (${school.id}) ──`);
    for (const { staff: s, user } of mismatches) {
      totalFlagged++;
      const name = s.name ?? [s.firstName, s.lastName].filter(Boolean).join(' ') ?? '(no name)';
      const loginStatus = user.lastLogin ? `last login: ${user.lastLogin}` : 'never logged in since this mismatch could have started';
      console.log(
        `  "${name}"  HR staffType="${s.staffType}"  but users.role="${user.role}"  ` +
        `(${loginStatus})  userId=${s.userId}`
      );
    }
    console.log('');
  }

  if (totalFlagged === 0) {
    console.log(TARGET_SCHOOL
      ? `No staffType/role mismatches found at school ${TARGET_SCHOOL}.`
      : 'No staffType/role mismatches found across any school.');
  } else {
    console.log(`Found ${totalFlagged} staff member(s) whose HR staff type doesn't match their actual system role.`);
    console.log('No changes were made — this is a report only.');
    console.log('To fix one: Settings -> Users -> find them -> Role dropdown -> pick the role that should actually apply.');
    console.log('This immediately revokes their stale session and applies the corrected role on next login.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
