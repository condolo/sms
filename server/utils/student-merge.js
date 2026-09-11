/* ============================================================
   Msingi — Student Record Merge (2026-09)

   When two student records turn out to be the same real child (see
   duplicate-admission-number detection, v5.76.0), simply deleting the
   "losing" record would either:
     - orphan every one of its attendance/exam/behaviour/etc. rows —
       nothing at the DB layer stops this (students_admission is a
       lookup index, not a unique one — the same root issue that let
       the duplicate exist at all), or
     - permanently destroy that child's real history, if the deletion
       cascaded into those collections too.

   Neither is acceptable for a genuine duplicate: the two records are
   the SAME child, so their combined history belongs together under one
   canonical id. mergeStudentData() re-points every reference from the
   removed record onto the kept one FIRST — the removed student document
   is only ever deleted once nothing else points at it (see
   server/routes/students.js's duplicate-resolve routes).

   Known, disclosed limitation: a collection meant to hold at most one
   row per student (e.g. growth_aspirations, or an invoice for the same
   fee item billed twice) can end up with two rows for the kept student
   if BOTH original records already had their own. Re-pointing doesn't
   de-duplicate — resolving that well needs collection-specific
   knowledge (which row to prefer, whether to sum or drop) that a
   generic merge can't have, so it's surfaced via the returned counts
   for the caller to report, not silently guessed at. This is a rare,
   visible-and-fixable inconsistency (an admin can spot and merge/void
   the extra row by hand), not data loss or an invisible orphan.

   NOT covered here: elearning_sessions.attendees[].studentId — a
   sub-document inside an array, not a top-level reference. Left alone
   deliberately: virtual-class attendance is ephemeral, session-scoped
   data (Emergency Online Learning Mode) with no independent value once
   the session has passed.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

// Every collection with a top-level `studentId` reference to a Student
// document, confirmed directly against each route file (2026-09 audit —
// see CHANGELOG.md v5.79.0). Keep this in sync when a new studentId-
// bearing collection is introduced elsewhere in the app.
const REFERENCING_COLLECTIONS = [
  'attendance',
  'exam_results',
  'grades',
  'mark_audit_log',
  'behaviour_incidents',
  'behaviour_appeals',
  'behaviour_points_resets',
  'student_subjects',
  'growth_activities',
  'growth_aspirations',
  'growth_awards',
  'growth_leadership',
  'growth_projects',
  'growth_recommendations',
  'growth_service',
  'hostel_assignments',
  'transport_assignments',
  'medical_visits',
  'report_card_snapshots',
  'weekly_snapshots',
  'assessment_marks',
  'invoices',
  'payments',
];

/**
 * Re-points every studentId reference from `oldStudent` onto
 * `newStudentId`, across every collection above, within one school.
 * Matches BOTH possible stored forms of the old student's identifier —
 * its UUID `id` and its Mongo `_id` string — per the dual-ID-forms
 * reality already handled elsewhere in this codebase (tenant-model.js).
 *
 * @param {string} schoolId
 * @param {object} ctx           tenantContext(req) — the same context
 *                                the caller's own tenantModel() calls use
 * @param {{id?: string, _id?: any}} oldStudent  the record being removed
 * @param {string} newStudentId  the kept record's canonical id
 * @returns {Promise<Record<string, number>>} rows re-pointed, per collection
 *          (a collection is omitted entirely when it had nothing to move)
 */
async function mergeStudentData(schoolId, ctx, oldStudent, newStudentId) {
  const oldForms = [oldStudent?.id, oldStudent?._id ? String(oldStudent._id) : null].filter(Boolean);
  if (oldForms.length === 0 || !newStudentId) return {};

  const counts = {};
  for (const collection of REFERENCING_COLLECTIONS) {
    const Model  = tenantModel(collection, ctx);
    const result = await Model.updateMany(
      { studentId: { $in: oldForms } },
      { $set: { studentId: newStudentId } }
    );
    const modified = result?.modifiedCount ?? result?.nModified ?? 0;
    if (modified > 0) counts[collection] = modified;
  }
  return counts;
}

module.exports = { mergeStudentData, REFERENCING_COLLECTIONS };
