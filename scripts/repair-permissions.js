/**
 * repair-permissions.js
 * ─────────────────────────────────────────────────────────────
 * One-off migration: overwrites ALL role_permissions documents
 * across ALL schools with the CURRENT array format expected by
 * server/middleware/rbac.js.
 *
 * PROBLEM: onboard.js and seedSchool.js used to seed the legacy
 * object format { view: true, edit: true } but rbac.js expects
 * the array format { students: ['read', 'create', 'update'] }.
 * This caused 100% of non-admin roles to fail every RBAC check.
 *
 * SAFE TO RE-RUN — uses $set, idempotent.
 * Custom per-role permissions will be reset to defaults.
 *
 * Usage:
 *   node scripts/repair-permissions.js
 */
const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

/* ── Actions ─────────────────────────────────────────────────── */
const R    = ['read'];
const RCU  = ['read', 'create', 'update'];
const RCUD = ['read', 'create', 'update', 'delete'];

const ALL_MODULES = [
  'students', 'teachers', 'classes', 'attendance', 'finance', 'behaviour',
  'exams', 'grades', 'admissions', 'timetable', 'messages', 'settings',
  'assessment', 'report_cards'
];

/* ── Role permission definitions (matches onboard.js) ────────── */
const ROLE_DEFAULTS = {
  superadmin: Object.fromEntries(ALL_MODULES.map(m => [m, RCUD])),
  admin:      Object.fromEntries(ALL_MODULES.map(m => [m, RCUD])),

  teacher: {
    students:     R,    teachers:     R,    classes:      R,
    attendance:   RCU,  grades:       RCU,  assessment:   RCU,
    timetable:    R,    messages:     RCU,  report_cards: R,
    exams:        R,
  },

  finance: {
    students:     R,
    finance:      RCUD,
    report_cards: R,
  },

  hr: {
    teachers:     RCUD,
    students:     R,
  },

  admissions_officer: {
    admissions:   RCUD,
    students:     RCU,
    classes:      R,
  },

  exams_officer: {
    exams:        RCUD,
    grades:       RCUD,
    assessment:   RCUD,
    students:     R,
    classes:      R,
    report_cards: R,
  },

  timetabler: {
    timetable:    RCUD,
    classes:      RCU,
    teachers:     R,
  },

  section_head: {
    students:     R,   teachers:     R,   classes:      R,
    attendance:   R,   grades:       R,   assessment:   R,
    exams:        R,   timetable:    R,   report_cards: R,
    admissions:   R,
  },

  deputy_principal: {
    students:     RCUD, teachers:     RCU,  classes:      RCUD,
    attendance:   RCUD, grades:       RCUD, assessment:   RCUD,
    exams:        RCUD, behaviour:    RCUD, timetable:    RCUD,
    messages:     RCUD, report_cards: RCU,  admissions:   RCU,
  },

  discipline_committee: {
    behaviour:    RCUD,
    students:     R,
  },

  parent: {
    messages:     R,
    report_cards: R,
  },

  student: {
    messages:     R,
  },
};

/* ── Main ────────────────────────────────────────────────────── */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('ERROR: MONGODB_URI not set'); process.exit(1); }

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || 'innolearn' });
  const db = mongoose.connection.db;

  const schools = await db.collection('schools').find({}).project({ id: 1, slug: 1 }).toArray();
  console.log(`\n🔧 repair-permissions — ${schools.length} school(s) found\n`);

  let totalUpdated = 0;
  let totalInserted = 0;

  for (const school of schools) {
    const schoolId = school.id || school._id.toString();
    const label    = school.slug || schoolId;
    console.log(`[${label}]`);

    for (const [roleKey, permissions] of Object.entries(ROLE_DEFAULTS)) {
      const docId = `rp_${roleKey}_${schoolId}`;
      const result = await db.collection('role_permissions').updateOne(
        { $or: [{ id: docId }, { schoolId, roleKey }] },
        { $set: { id: docId, schoolId, roleKey, permissions } },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        console.log(`  ✚ ${roleKey} — inserted`);
        totalInserted++;
      } else if (result.modifiedCount > 0) {
        console.log(`  ✓ ${roleKey} — updated`);
        totalUpdated++;
      } else {
        console.log(`  = ${roleKey} — unchanged (already correct)`);
      }
    }
  }

  console.log(`\n✅ Done — ${totalInserted} inserted, ${totalUpdated} updated across ${schools.length} school(s)`);
  await mongoose.disconnect();
}

main().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
