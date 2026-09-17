#!/usr/bin/env node
/* ============================================================
   Msingi — Staff Responsibility value rename ('deputy'/'principal')
   Security fix, 2026-09.

   'deputy' and 'principal' used to be two of the six built-in
   teacher.extraRoles responsibility values (Settings -> Staff Roles &
   Responsibilities) — the EXACT SAME STRINGS server/utils/role-
   validation.js's SYSTEM_ROLES uses for the real Deputy Principal /
   Principal account roles. Three authorization checks
   (teaching-assignments.js, lessons.js, weekly-snapshots.js) merge
   extraRoles into the same Set as a user's real role/roles and check
   broad-access membership against it, so a teacher merely TAGGED
   "Deputy Principal" as a responsibility — no different, from an
   admin's point of view, than tagging someone "Timetabler" — was
   silently granted the same broad access as an account actually
   holding that RBAC role, without ever going through Roles &
   Permissions. Renamed the two colliding values to 'acting_deputy'
   and 'head_of_school' (see server/config/staffResponsibilities.js)
   so no extraRoles value can ever equal a SYSTEM_ROLES value again.

   This script migrates the two places the OLD values can already be
   persisted, so existing data matches what the renamed code now
   expects:
     - teachers.extraRoles arrays containing 'deputy' or 'principal'
     - schools.staffResponsibilities entries whose value is 'deputy'
       or 'principal' (a school's own persisted customization of the
       picker — most schools have never saved one and fall back to
       the client's own default list, already updated in code, so
       nothing to migrate for them)

   Both are a straight, lossless rename — 'deputy' really does mean
   "this teacher has deputy-level responsibilities," identical in
   meaning to the new 'acting_deputy' value, and likewise for
   'principal' -> 'head_of_school'. There is no scenario where this
   loses information or requires a human decision, unlike the
   role_permissions reconciliation migrate-legacy-deputy-role.js does
   — there is no separate "acting_deputy-keyed document" to conflict
   with, since these values only ever lived in an array field.

   Usage:
     node server/scripts/migrate-staff-responsibility-rename.js            # dry run (default) — reports only, writes nothing
     node server/scripts/migrate-staff-responsibility-rename.js --apply    # perform the rename
     node server/scripts/migrate-staff-responsibility-rename.js --schoolId=sch_xxx [--apply]

   Output: JSON report to stdout + a human summary to stderr.
   Exit code: 0 always (nothing here is ever a manual-review case) —
   2 on a script error.
   ============================================================ */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { _model } = require('../utils/model');

const RENAME = { deputy: 'acting_deputy', principal: 'head_of_school' };

/* ── Pure decision logic — exported for unit testing without a DB ── */

/**
 * Given a teacher document, decide the new extraRoles array (or null if
 * no rename is needed). Renames in place, preserves order and any other
 * values (e.g. 'hod') untouched.
 */
function planTeacherMigration(teacher) {
  const extraRoles = Array.isArray(teacher.extraRoles) ? teacher.extraRoles : [];
  if (!extraRoles.some(r => RENAME[r])) return { action: 'none' };
  return {
    action: 'rename',
    from: extraRoles,
    to:   extraRoles.map(r => RENAME[r] ?? r),
  };
}

/**
 * Given a school's staffResponsibilities array, decide the new array (or
 * null if no rename is needed). Renames each matching entry's `value`
 * only — `label` is left exactly as the school set it (a school that
 * customized the label away from the default keeps their own wording).
 */
function planSchoolMigration(school) {
  const list = Array.isArray(school.staffResponsibilities) ? school.staffResponsibilities : [];
  if (!list.some(r => r && RENAME[r.value])) return { action: 'none' };
  return {
    action: 'rename',
    from: list,
    to:   list.map(r => (r && RENAME[r.value] ? { ...r, value: RENAME[r.value] } : r)),
  };
}

/* ── Everything below only runs when this file is executed directly,
   never when required by a test. ────────────────────────────────── */
if (require.main === module) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('[migrate-staff-responsibility-rename] MONGODB_URI not set in environment. Exiting.');
    process.exit(2);
  }

  const args      = process.argv.slice(2);
  const apply     = args.includes('--apply');
  const schoolArg = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;

  const findings = { teachersRenamed: [], schoolsRenamed: [] };

  async function run() {
    console.error(`[migrate-staff-responsibility-rename] Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (reporting only)'}`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

    const schoolFilter = schoolArg ? { id: schoolArg } : {};
    if (schoolArg) {
      const exists = await _model('schools').findOne(schoolFilter).lean();
      if (!exists) { console.error(`[migrate-staff-responsibility-rename] School not found: ${schoolArg}`); process.exit(2); }
    }

    // ── teachers.extraRoles ─────────────────────────────────────
    const teacherFilter = {
      extraRoles: { $in: Object.keys(RENAME) },
      ...(schoolArg ? { schoolId: schoolArg } : {}),
    };
    const teachers = await _model('teachers').find(teacherFilter).lean();
    for (const teacher of teachers) {
      const plan = planTeacherMigration(teacher);
      if (plan.action === 'none') continue;
      findings.teachersRenamed.push({
        schoolId: teacher.schoolId, teacherId: teacher.id ?? String(teacher._id),
        name: `${teacher.firstName ?? ''} ${teacher.lastName ?? ''}`.trim(),
        from: plan.from, to: plan.to,
      });
      if (apply) {
        const filter = teacher.id ? { id: teacher.id } : { _id: teacher._id };
        await _model('teachers').updateOne(filter, { $set: { extraRoles: plan.to, updatedAt: new Date().toISOString() } });
      }
    }

    // ── schools.staffResponsibilities ───────────────────────────
    const schools = await _model('schools').find(schoolFilter).lean();
    for (const school of schools) {
      const plan = planSchoolMigration(school);
      if (plan.action === 'none') continue;
      findings.schoolsRenamed.push({ schoolId: school.id, from: plan.from, to: plan.to });
      if (apply) {
        await _model('schools').updateOne({ id: school.id }, { $set: { staffResponsibilities: plan.to, updatedAt: new Date().toISOString() } });
      }
    }

    await mongoose.disconnect();

    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  Staff responsibility rename (deputy/principal) — summary');
    console.error('═══════════════════════════════════════════════════════');
    console.error(`  Teachers renamed${apply ? '' : ' (would rename)'} : ${findings.teachersRenamed.length}`);
    console.error(`  Schools renamed${apply ? '' : ' (would rename)'}  : ${findings.schoolsRenamed.length}`);
    for (const t of findings.teachersRenamed) {
      console.error(`     teacher ${t.name || t.teacherId} (${t.schoolId}): [${t.from.join(', ')}] -> [${t.to.join(', ')}]`);
    }
    for (const s of findings.schoolsRenamed) {
      console.error(`     school ${s.schoolId}: staffResponsibilities values updated`);
    }
    console.error('═══════════════════════════════════════════════════════\n');

    process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...findings }, null, 2) + '\n');
    process.exit(0);
  }

  run().catch(err => {
    console.error(`[migrate-staff-responsibility-rename] Fatal error: ${err.message}\n${err.stack}`);
    mongoose.disconnect().finally(() => process.exit(2));
  });
}

module.exports = { planTeacherMigration, planSchoolMigration, RENAME };
