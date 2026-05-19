/**
 * repairPermissions.js
 * ─────────────────────────────────────────────────────────────
 * Self-healing startup task — runs automatically after DB connects.
 *
 * WHAT IT FIXES
 * Legacy onboard.js provisioned role_permissions in the old object
 * format { view: true, edit: true }. The RBAC middleware expects
 * the array format { students: ['read','create','update'] }.
 * Schools with the old format had 100% of non-admin RBAC checks fail.
 *
 * HOW IT RUNS
 * Called from server/index.js after DB connect, non-blocking.
 * Uses the already-open mongoose connection — no new connection opened.
 * Safe to run on every restart (idempotent $set, skips if nothing broken).
 * Fails gracefully — logs a warning but never crashes the server.
 *
 * WHEN IT BECOMES A NO-OP
 * Once all schools are repaired the fast-path query finds no broken docs
 * and returns in < 1ms. You can leave it wired in forever.
 */
'use strict';
const mongoose = require('mongoose');

/* ── Permission definitions ──────────────────────────────────── */
const R    = ['read'];
const RCU  = ['read', 'create', 'update'];
const RCUD = ['read', 'create', 'update', 'delete'];

const ALL_MODULES = [
  'students', 'teachers', 'classes', 'attendance', 'finance', 'behaviour',
  'exams', 'grades', 'admissions', 'timetable', 'messages', 'settings',
  'assessment', 'report_cards',
];

const ROLE_DEFAULTS = {
  superadmin: Object.fromEntries(ALL_MODULES.map(m => [m, RCUD])),
  admin:      Object.fromEntries(ALL_MODULES.map(m => [m, RCUD])),

  teacher: {
    students:     R,    teachers:     R,    classes:      R,
    attendance:   RCU,  grades:       RCU,  assessment:   RCU,
    timetable:    R,    messages:     RCU,  report_cards: R,
    exams:        R,
  },

  deputy_principal: {
    students:     RCUD, teachers:     RCU,  classes:      RCUD,
    attendance:   RCUD, grades:       RCUD, assessment:   RCUD,
    exams:        RCUD, behaviour:    RCUD, timetable:    RCUD,
    messages:     RCUD, report_cards: RCU,  admissions:   RCU,
  },

  section_head: {
    students:     R, teachers: R, classes: R,
    attendance:   R, grades:   R, assessment: R,
    exams:        R, timetable: R, report_cards: R,
    admissions:   R,
  },

  admissions_officer: {
    admissions: RCUD,
    students:   RCU,
    classes:    R,
  },

  exams_officer: {
    exams:        RCUD,
    grades:       RCUD,
    assessment:   RCUD,
    students:     R,
    classes:      R,
    report_cards: R,
  },

  finance: {
    students:     R,
    finance:      RCUD,
    report_cards: R,
  },

  hr: {
    teachers: RCUD,
    students: R,
  },

  timetabler: {
    timetable: RCUD,
    classes:   RCU,
    teachers:  R,
  },

  discipline_committee: {
    behaviour: RCUD,
    students:  R,
  },

  parent: {
    messages:     R,
    report_cards: R,
  },

  student: {
    messages: R,
  },
};

/* ── Helper: is a permissions value the broken legacy format? ── */
function _isBroken(doc) {
  if (!doc?.permissions) return true;
  // Old format: { view: true } — values are booleans, not arrays
  const vals = Object.values(doc.permissions);
  if (vals.length === 0) return true;
  return vals.some(v => !Array.isArray(v));
}

/* ── Main export ─────────────────────────────────────────────── */
async function repairPermissions() {
  // Only run if DB is connected
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    console.log('[repair-permissions] No DB connection — skipping.');
    return;
  }

  const db = mongoose.connection.db;

  try {
    // Fast-path: check if ANY doc is in the broken format
    // Array permissions have array values; broken ones have boolean/object values.
    // We detect this by checking if the permissions field contains no arrays.
    const brokenSample = await db.collection('role_permissions').findOne({
      $or: [
        { permissions: { $exists: false } },
        { 'permissions.students': { $type: 'bool' } },
        { 'permissions.students': { $type: 'object', $not: { $type: 'array' } } },
      ]
    });

    if (!brokenSample) {
      console.log('[repair-permissions] All permissions are in correct format — skipping.');
      return;
    }

    // Something is broken — do a full repair across all schools
    console.log('[repair-permissions] Broken permission format detected — starting repair…');

    const schools = await db.collection('schools').find({}).project({ id: 1, slug: 1 }).toArray();
    let inserted = 0, updated = 0, unchanged = 0;

    for (const school of schools) {
      const schoolId = school.id || school._id.toString();

      for (const [roleKey, permissions] of Object.entries(ROLE_DEFAULTS)) {
        const docId = `rp_${roleKey}_${schoolId}`;
        const result = await db.collection('role_permissions').updateOne(
          { $or: [{ id: docId }, { schoolId, roleKey }] },
          { $set: { id: docId, schoolId, roleKey, permissions } },
          { upsert: true }
        );
        if (result.upsertedCount > 0) inserted++;
        else if (result.modifiedCount > 0) updated++;
        else unchanged++;
      }
    }

    const total = inserted + updated + unchanged;
    console.log(
      `[repair-permissions] ✅ Done — ${schools.length} school(s) processed. ` +
      `${inserted} inserted, ${updated} fixed, ${unchanged} already correct (${total} total docs).`
    );

  } catch (err) {
    // Non-fatal — log and move on. The server is already serving requests.
    console.warn('[repair-permissions] ⚠️  Repair failed (non-fatal):', err.message);
  }
}

module.exports = { repairPermissions };
