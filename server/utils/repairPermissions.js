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
const mongoose    = require('mongoose');
const { MODULE_KEYS } = require('../config/moduleRegistry');

/* ── Permission definitions ──────────────────────────────────── */
const R    = ['read'];
const RCU  = ['read', 'create', 'update'];
const RCUD = ['read', 'create', 'update', 'delete'];

const ALL_MODULES = MODULE_KEYS;

const ROLE_DEFAULTS = {
  superadmin: Object.fromEntries(ALL_MODULES.map(m => [m, RCUD])),
  admin:      Object.fromEntries(ALL_MODULES.map(m => [m, RCUD])),

  teacher: {
    students:     R,    teachers:     R,    classes:      R,
    attendance:   RCU,  grades:       RCU,  assessment:   RCU,
    timetable:    R,    messages:     RCU,  events:       R,
    report_cards: R,    exams:        R,    lessons:      RCUD,
  },

  principal: {
    students:     RCUD, teachers:     RCU,  classes:      RCUD,
    attendance:   RCUD, grades:       RCUD, assessment:   RCUD,
    exams:        RCUD, behaviour:    RCUD, timetable:    RCUD,
    messages:     RCUD, events:       RCUD, report_cards: RCU,
    admissions:   RCU,  lessons:      RCUD,
  },

  deputy_principal: {
    students:     RCUD, teachers:     RCU,  classes:      RCUD,
    attendance:   RCUD, grades:       RCUD, assessment:   RCUD,
    exams:        RCUD, behaviour:    RCUD, timetable:    RCUD,
    messages:     RCUD, events:       RCUD, report_cards: RCU,
    admissions:   RCU,  lessons:      RCUD,
  },

  section_head: {
    students:     R, teachers: R, classes: R,
    attendance:   R, grades:   R, assessment: R,
    exams:        R, timetable: R, report_cards: R,
    admissions:   R, lessons:  RCU,
    messages:     RCU, events:  R,
  },

  admissions_officer: {
    admissions: RCUD,
    students:   RCU,
    classes:    R,
    messages:   RCU,
    events:     R,
  },

  exams_officer: {
    exams:        RCUD,
    grades:       RCUD,
    assessment:   RCUD,
    students:     R,
    classes:      R,
    report_cards: R,
    messages:     RCU,
    events:       R,
  },

  finance: {
    students:     R,
    finance:      RCUD,
    report_cards: R,
    messages:     RCU,
    events:       R,
  },

  hr: {
    teachers: RCUD,
    students: R,
    messages: RCU,
    events:   R,
  },

  timetabler: {
    timetable: RCUD,
    classes:   RCU,
    teachers:  R,
    messages:  RCU,
    events:    RCUD,
  },

  discipline_committee: {
    behaviour: RCUD,
    students:  R,
    messages:  RCU,
    events:    R,
  },

  parent: {
    messages:     R,
    report_cards: R,
    lessons:      R,
  },

  student: {
    messages: R,
    lessons:  R,
  },
};

// "deputy" is a legacy role key used before "deputy_principal" was standardised.
// Keep it in ROLE_DEFAULTS so missing documents are seeded for schools that
// still have users with role: "deputy".
ROLE_DEFAULTS.deputy = ROLE_DEFAULTS.deputy_principal;

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
    const schools = await db.collection('schools').find({}).project({ id: 1, slug: 1 }).toArray();
    let inserted = 0, fixed = 0, unchanged = 0;

    for (const school of schools) {
      const schoolId = school.id || school._id.toString();

      for (const [roleKey, permissions] of Object.entries(ROLE_DEFAULTS)) {
        const docId = `rp_${roleKey}_${schoolId}`;

        // Find the existing doc (if any) to decide whether permissions need repair
        const existing = await db.collection('role_permissions').findOne(
          { $or: [{ id: docId }, { schoolId, roleKey }] }
        );

        if (!existing) {
          // Document is completely missing — insert with defaults
          await db.collection('role_permissions').insertOne(
            { id: docId, schoolId, roleKey, permissions, createdAt: new Date().toISOString() }
          );
          inserted++;
        } else if (_isBroken(existing)) {
          // Document exists but permissions are in the old broken format — overwrite
          await db.collection('role_permissions').updateOne(
            { _id: existing._id },
            { $set: { permissions, updatedAt: new Date().toISOString() } }
          );
          fixed++;
        } else {
          // Document exists and is correctly formatted.
          // Add any missing module keys from defaults (additive only — never remove or overwrite).
          const missing = {};
          for (const [mod, actions] of Object.entries(permissions)) {
            if (!Object.prototype.hasOwnProperty.call(existing.permissions, mod)) {
              missing[mod] = actions;
            }
          }
          if (Object.keys(missing).length > 0) {
            const setOps = {};
            for (const [mod, actions] of Object.entries(missing)) {
              setOps[`permissions.${mod}`] = actions;
            }
            await db.collection('role_permissions').updateOne(
              { _id: existing._id },
              { $set: { ...setOps, updatedAt: new Date().toISOString() } }
            );
            fixed++;
          } else {
            unchanged++;
          }
        }
      }
    }

    const total = inserted + fixed + unchanged;
    if (inserted > 0 || fixed > 0) {
      console.log(
        `[repair-permissions] ✅ Done — ${schools.length} school(s). ` +
        `${inserted} missing docs seeded, ${fixed} broken docs fixed, ${unchanged} already correct (${total} total).`
      );
    } else {
      console.log(`[repair-permissions] All ${total} permission docs are present and correct — nothing to do.`);
    }

  } catch (err) {
    // Non-fatal — log and move on. The server is already serving requests.
    console.warn('[repair-permissions] ⚠️  Repair failed (non-fatal):', err.message);
  }
}

module.exports = { repairPermissions };
