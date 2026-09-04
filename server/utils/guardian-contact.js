/* ============================================================
   Msingi — Mother/Father → legacy primary-contact fields

   2026-09 field update (school-requested Mother/Father split on
   Admissions and Students). Extracted here, rather than defined once
   in admissions.js and hand-copied into import-export.js's student
   importer, specifically to avoid the exact class of bug this session
   already found and fixed once — two independently-maintained copies
   of the same logic quietly drifting apart (server/middleware/rbac.js
   vs. server/routes/auth.js's permission merge). One implementation,
   used by both.

   parentName/parentEmail/parentPhone/parentRelationship are the ONLY
   guardian fields this system's other, unrelated consumers actually
   read — the parent portal account route (students.js's POST
   /:id/parent-account, which uses parentEmail as the literal login
   email) and birthday emails (birthdays.js). Deriving them from
   whichever parent is primaryContact means both keep working
   completely unchanged — a single shared portal account, fed by
   whichever parent the school designates, exactly matching how the
   portal already works today (one account per student; nothing stops
   both parents using the same login — confirmed with the school).
   ============================================================ */
'use strict';

/**
 * resolvePrimaryContact(merged)
 * `merged` should already combine the incoming request with whatever
 * existing values apply (the caller's job) so a partial update that
 * only touches, say, fatherPhone still resolves correctly against
 * mother/father data already on file, not just what's in this request.
 * Returns { parentName, parentEmail, parentPhone, parentRelationship }
 * or null if neither parent has a name at all.
 */
function resolvePrimaryContact(merged) {
  let primary = merged.primaryContact;
  if (primary !== 'mother' && primary !== 'father') {
    primary = merged.motherName ? 'mother' : (merged.fatherName ? 'father' : null);
  }
  if (!primary) return null;
  return {
    parentName:         (primary === 'father' ? merged.fatherName  : merged.motherName)  || '',
    parentEmail:        (primary === 'father' ? merged.fatherEmail : merged.motherEmail) || '',
    parentPhone:        (primary === 'father' ? merged.fatherPhone : merged.motherPhone) || '',
    parentRelationship: primary === 'father' ? 'Father' : 'Mother',
  };
}

/**
 * validateGuardianRequirement(merged)
 * At least one parent must be identified — a record with neither
 * Mother nor Father filled in has no one the school can actually
 * reach, and no one the eventual parent-portal account could ever be
 * created for. Returns a zod-issue-shaped error array, or null if ok.
 */
function validateGuardianRequirement(merged) {
  const hasMother = !!(merged.motherName && (merged.motherPhone || merged.motherEmail));
  const hasFather = !!(merged.fatherName && (merged.fatherPhone || merged.fatherEmail));
  if (!hasMother && !hasFather) {
    return [{ field: 'motherName', message: 'At least one parent (name + phone or email) is required — Mother or Father' }];
  }
  return null;
}

module.exports = { resolvePrimaryContact, validateGuardianRequirement };
