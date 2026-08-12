/* ============================================================
   Msingi — Self-service ownership scoping

   Shared by any aggregate/read endpoint that a parent or student role
   might reach directly (growth-profile.js, weekly-snapshots.js, and any
   future one) — extracted specifically so the check lives in exactly one
   place instead of being copy-pasted per route file, which is the same
   "silently drifts between independent copies" bug class this session
   has already hit repeatedly for permission defaults (see
   permission-defaults-consistency.test.js's own docstring). A fix here
   (e.g. a future guardianOf edge case) now reaches every consumer at
   once instead of needing to be re-applied file by file.

   Coarser roles (teacher, admin, etc.) are intentionally left
   unrestricted by this check — this app's convention elsewhere
   (attendance, grades) is that staff access is bounded by RBAC, not
   hard-coded to "my own class only," and narrowing that further is a
   separate, bigger product decision, not an access-control bug fix.
   Parent/student seeing someone else's child, however, is unambiguously
   wrong regardless of that convention — this closes exactly that gap,
   nothing broader.
   ============================================================ */
'use strict';

/**
 * @param {object} req - Express request with req.jwtUser populated
 * @param {{id: string}} target - the record being accessed; must expose
 *   the student's id as `.id` (a lean student doc, or any object that
 *   carries the student's own id under that key)
 * @returns {boolean} true if this self-service role must be denied access
 */
function forbiddenForSelfServiceRole(req, target) {
  const role = req.jwtUser?.role;
  if (role === 'student') {
    return req.jwtUser.studentId !== target.id;
  }
  if (role === 'parent' || role === 'guardian') {
    const owned = new Set([...(req.jwtUser.studentIds ?? []), ...(req.jwtUser.guardianOf ?? [])]);
    return !owned.has(target.id);
  }
  return false; // any other role — module-level RBAC already gates this
}

module.exports = { forbiddenForSelfServiceRole };
