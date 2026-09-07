/* ============================================================
   Msingi — Admission Field Requirements (2026-09, per-school)

   WHY THIS EXISTS
   dateOfBirth, gender, and "at least one parent with an email" were
   hardcoded as required across three places that must never drift
   apart — the Admissions application form, the student bulk-import
   CSV, and the enroll guard — because different schools legitimately
   run different admission processes. A boarding school taking
   enquiries months before a family finalizes guardianship, or a
   school that collects DOB at interview rather than at enquiry, has
   no way to say so; the platform decided for them. This makes each
   requirement a per-school Settings toggle instead.

   WHERE IT'S STORED
   school.admissionConfig.requiredFields (a plain sub-object,
   alongside the existing prefix/padding/yearInPrefix admission-number
   settings — same object, same Settings → School Profile save path,
   nothing new to wire up server-side for persistence).

   DEFAULT — UNCHANGED BEHAVIOUR FOR EVERY EXISTING SCHOOL
   Every key defaults to `true` (required) when absent, so a school
   that has never opened this setting sees IDENTICAL behaviour to
   before this feature existed. Only an explicit `false` relaxes a
   requirement. resolveRequiredFields() is the only place this
   default lives — every caller goes through it rather than each
   re-implementing "absent means true".

   guardianEmailRequired only has an effect when guardianRequired is
   also (still) true and at least one parent is actually named — it
   does not, by itself, make a parent mandatory. Turning it off means
   a named parent's email becomes optional again (phone-only is
   accepted), which also means that parent may never be able to get
   their own portal login later (students.js's per-parent account
   creation needs the email) — a school choosing to relax this should
   understand that trade-off; the Settings UI says so.
   ============================================================ */
'use strict';

const DEFAULT_REQUIRED_FIELDS = Object.freeze({
  dateOfBirth:           true,
  gender:                true,
  guardianRequired:      true,  // at least one parent (mother/father, or legacy parentName) must be named
  guardianEmailRequired: true,  // a named parent must have an email on file
});

/**
 * resolveRequiredFields(admissionConfig)
 * `admissionConfig` is the school document's own `admissionConfig`
 * object (may be undefined/null, or missing `requiredFields` entirely
 * — both mean "use the defaults", not "require nothing").
 * Returns a complete { dateOfBirth, gender, guardianRequired,
 * guardianEmailRequired } object — every key always present.
 */
function resolveRequiredFields(admissionConfig) {
  const configured = admissionConfig?.requiredFields || {};
  return {
    dateOfBirth:           configured.dateOfBirth           !== false,
    gender:                configured.gender                !== false,
    guardianRequired:      configured.guardianRequired       !== false,
    guardianEmailRequired: configured.guardianEmailRequired !== false,
  };
}

/**
 * validateRequiredAdmissionFields(row, requiredFields)
 * Checks dateOfBirth/gender against the resolved per-school config.
 * `requiredFields` should already be resolved (pass the result of
 * resolveRequiredFields() — this function does not apply defaults
 * itself, so a caller must not skip that step).
 * Returns a zod-issue-shaped error array, or null if ok.
 */
function validateRequiredAdmissionFields(row, requiredFields) {
  const errors = [];
  if (requiredFields.dateOfBirth && !row.dateOfBirth) {
    errors.push({ field: 'dateOfBirth', message: 'Date of Birth is required' });
  }
  if (requiredFields.gender && !row.gender) {
    errors.push({ field: 'gender', message: 'Gender is required' });
  }
  return errors.length ? errors : null;
}

module.exports = { DEFAULT_REQUIRED_FIELDS, resolveRequiredFields, validateRequiredAdmissionFields };
