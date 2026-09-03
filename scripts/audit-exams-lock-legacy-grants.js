/**
 * audit-exams-lock-legacy-grants.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * Priority 0's proposed exams.lock/unlock fix splits the registry's
 * single combined `exams.lock` row ("Lock / Unlock Exam") into two
 * independent rows: `exams.lock` ("Lock Exam") and a new
 * `exams.unlock` ("Unlock Exam"). Today, NEITHER the existing
 * `exams__lock` sub-key NOR any future `exams__unlock` key is checked
 * by any route at all — POST /:id/lock and POST /:id/unlock are gated
 * only by a hardcoded admin/superadmin check, so any existing
 * `exams__lock` grant in role_permissions today is completely inert —
 * toggling that checkbox in Settings currently does nothing
 * distinguishable from any other Exams sub-row.
 *
 * After the fix ships, that changes: `exams__lock` becomes LIVE, and
 * its MEANING narrows from "Lock/Unlock" to "Lock only" — a role or
 * person who already has a non-empty exams__lock grant (however that
 * happened — an admin experimenting with a checkbox that, until now,
 * did nothing) would SILENTLY gain real lock authority the moment the
 * code deploys, without anyone having consciously re-confirmed that
 * decision under the new, live meaning. This is exactly the class of
 * risk behind the Ann Wanjiku incident (docs/audits/
 * PERMISSION_CONTROL_CONTRACT_2026-09.md) — a stale/inert permission
 * document having a real, unexpected effect once code changes
 * underneath it — so it must be checked with real data, not assumed
 * safe.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes. For every school, scans BOTH
 * role-keyed and user-keyed role_permissions documents for a
 * non-empty `exams__lock` array, and reports exactly who/what would
 * gain live "lock exam" authority the moment this fix deploys, with
 * enough detail to judge the real production impact before writing
 * any code.
 *
 * Usage:
 *   node scripts/audit-exams-lock-legacy-grants.js                  # all schools
 *   node scripts/audit-exams-lock-legacy-grants.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TARGET_SCHOOL = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  // Mirrors server/config/db.js exactly — an explicit dbName is required,
  // or the driver silently defaults to the "test" database instead of
  // the app's real one when the connection string's path segment is empty.
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'innolearn',
  });
  console.log('Connected [READ-ONLY — this script makes no writes]\n');

  const Schools    = _model('schools');
  const Users      = _model('users');
  const RolePerms  = _model('role_permissions');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let totalRoleGrants = 0;
  let totalUserGrants  = 0;

  for (const school of schools) {
    // Role-keyed docs with a non-empty exams__lock grant.
    const roleDocs = await RolePerms.find({
      schoolId: school.id,
      roleKey: { $exists: true, $ne: null },
      'permissions.exams__lock.0': { $exists: true }, // array with at least one element
    }).select('roleKey permissions.exams__lock').lean();

    // User-keyed (per-user override) docs with a non-empty exams__lock grant.
    const userDocs = await RolePerms.find({
      schoolId: school.id,
      userId: { $exists: true, $ne: null },
      'permissions.exams__lock.0': { $exists: true },
    }).select('userId permissions.exams__lock').lean();

    if (!roleDocs.length && !userDocs.length) continue;

    console.log(`── ${school.name} (${school.id}) ──`);

    for (const d of roleDocs) {
      totalRoleGrants++;
      console.log(`  ROLE "${d.roleKey}"  exams__lock = ${JSON.stringify(d.permissions.exams__lock)}`);
      console.log(`    → After the fix: EVERY user with role "${d.roleKey}" at this school gains live "lock exam" authority`);
      console.log(`      (narrowed from the old combined meaning — they will NOT gain unlock; that needs a separate, new grant).`);
    }

    for (const d of userDocs) {
      totalUserGrants++;
      const user = await Users.findOne({ $or: [{ id: d.userId }, /^[a-f\d]{24}$/i.test(d.userId) ? { _id: d.userId } : { id: '__never__' }] })
        .select('name email role').lean();
      const label = user ? `"${user.name ?? '(no name)'}" <${user.email}> role="${user.role}"` : `userId=${d.userId} (no matching users doc)`;
      console.log(`  PER-USER ${label}  exams__lock = ${JSON.stringify(d.permissions.exams__lock)}`);
      console.log(`    → After the fix: THIS SPECIFIC PERSON gains live "lock exam" authority (not unlock).`);
    }
    console.log('');
  }

  console.log('── Summary ──────────────────────────────');
  if (totalRoleGrants === 0 && totalUserGrants === 0) {
    console.log(TARGET_SCHOOL
      ? `No existing exams__lock grants found at school ${TARGET_SCHOOL}. The fix introduces no silent privilege change there — every grantee will be a fresh, deliberate choice made after this ships.`
      : 'No existing exams__lock grants found across any school. The fix introduces no silent privilege change anywhere — every grantee going forward will be a fresh, deliberate choice made after this ships.');
  } else {
    console.log(`${totalRoleGrants} role-level and ${totalUserGrants} per-user exams__lock grant(s) found.`);
    console.log('Each one listed above will go from INERT (today) to LIVE lock authority the moment this fix deploys.');
    console.log('No changes made — this is a report only, for a decision before implementation proceeds.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
