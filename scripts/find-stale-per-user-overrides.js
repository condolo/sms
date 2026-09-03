/**
 * find-stale-per-user-overrides.js — READ-ONLY diagnostic
 *
 * Answers, with real data: is the "Ann Wanjiku / admissions_officer"
 * permission bug (2026-09) a one-off, or does it affect other
 * users/schools/modules?
 *
 * WHY THIS EXISTS
 * Before the 2026-08 RBAC remediation, Settings -> Roles & Permissions'
 * Per User tab wrote a FULL zero-filled snapshot of every module for
 * whichever user was being edited — not just the module(s) actually
 * touched. A module the admin never touched via Per User got an
 * explicit bare `permissions.<mod>: []` in that user's role_permissions
 * document, with NO accompanying `permissions.<mod>__<sub>` key.
 *
 * The 2026-08 fix made new saves sparse (only the exact keys touched),
 * but did nothing to documents already written under the old behavior.
 * Those stale bare-empty keys sat harmless as long as rbac.js's merge
 * only recomputed a module's coarse grant when a sub-key for that same
 * module was also touched — which a stale bare-only key never is. The
 * 2026-09 fix closed that gap in the merge logic itself (server/
 * middleware/rbac.js's _mergeUserOverrides, and server/routes/auth.js's
 * _loadMergedPermissions, which now delegates to the same function) —
 * so EVERY account with this stale shape is now fixed automatically,
 * with no data migration required for correctness.
 *
 * This script exists purely to answer the scope question honestly: how
 * many accounts, at how many schools, on how many modules, actually had
 * this stale shape before the code fix. It changes nothing.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes. For every school, for every
 * per-user override document (role_permissions doc keyed by userId, not
 * roleKey), flags every bare (non "__") module key whose array is empty
 * AND has no "<mod>__<sub>" sibling key anywhere in the same document —
 * the exact fingerprint described above, for any module that actually
 * has sub-rows in MODULE_REGISTRY (a module with no subs at all was
 * never capable of having this specific shape).
 *
 * Usage:
 *   node scripts/find-stale-per-user-overrides.js                  # all schools
 *   node scripts/find-stale-per-user-overrides.js --school <schoolId>
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

  const { MODULE_REGISTRY } = require('../server/config/moduleRegistry');
  const modulesWithSubs = new Set(
    MODULE_REGISTRY.filter(m => Array.isArray(m.subs) && m.subs.length > 0).map(m => m.key)
  );

  const Schools    = _model('schools');
  const Users      = _model('users');
  const RolePerms  = _model('role_permissions');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let totalAffectedUsers = 0;
  let totalAffectedModuleHits = 0;
  const moduleHitCounts = {}; // module key → count of users affected on that module

  for (const school of schools) {
    const overrideDocs = await RolePerms.find({ schoolId: school.id, userId: { $exists: true, $ne: null } })
      .select('userId permissions').lean();
    if (!overrideDocs.length) continue;

    const affectedThisSchool = [];

    for (const doc of overrideDocs) {
      const perms = doc.permissions || {};
      const keys  = Object.keys(perms);
      const subKeysByMod = new Set(keys.filter(k => k.includes('__')).map(k => k.split('__')[0]));

      const staleModules = keys.filter(k =>
        !k.includes('__') &&                    // a bare coarse key
        modulesWithSubs.has(k) &&                // for a module that actually has sub-rows
        Array.isArray(perms[k]) && perms[k].length === 0 && // zero-filled
        !subKeysByMod.has(k)                     // with NO matching mod__sub sibling anywhere in this doc
      );

      if (staleModules.length) {
        affectedThisSchool.push({ userId: doc.userId, staleModules });
        totalAffectedModuleHits += staleModules.length;
        staleModules.forEach(m => { moduleHitCounts[m] = (moduleHitCounts[m] || 0) + 1; });
      }
    }

    if (!affectedThisSchool.length) continue;
    totalAffectedUsers += affectedThisSchool.length;

    console.log(`── ${school.name} (${school.id}) ──`);
    for (const { userId, staleModules } of affectedThisSchool) {
      const user = await Users.findOne({ $or: [{ id: userId }, /^[a-f\d]{24}$/i.test(userId) ? { _id: userId } : { id: '__never__' }] })
        .select('name email role').lean();
      const label = user ? `"${user.name ?? '(no name)'}" <${user.email}> role="${user.role}"` : `userId=${userId} (no matching users doc)`;
      console.log(`  ${label}`);
      console.log(`    stale bare-empty modules (no sub-key touched): ${staleModules.join(', ')}`);
    }
    console.log('');
  }

  console.log('── Summary ──────────────────────────────');
  if (totalAffectedUsers === 0) {
    console.log(TARGET_SCHOOL
      ? `No stale per-user override documents found at school ${TARGET_SCHOOL}. This really was isolated to the account already found.`
      : 'No stale per-user override documents found across any school.');
  } else {
    console.log(`${totalAffectedUsers} user(s) across ${Object.keys(moduleHitCounts).length ? new Set(Object.values(moduleHitCounts)).size : 0} affected module(s), ${totalAffectedModuleHits} total stale module entries.`);
    console.log('Hit count per module (how many users have a stale entry for that specific module):');
    Object.entries(moduleHitCounts).sort((a, b) => b[1] - a[1]).forEach(([mod, count]) => {
      console.log(`  ${mod}: ${count}`);
    });
    console.log('\nThe 2026-09 code fix (rbac.js + auth.js) already neutralizes every one of these — no');
    console.log('data migration is required for correctness. This report is purely to establish scope.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
