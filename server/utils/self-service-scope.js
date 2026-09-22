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
   unrestricted by THIS function — staff scoping, where it applies, is a
   separate concern handled by ScopeEngine/scopeMiddleware in the route
   itself (see growth-profile.js's own isClassInScope calls), not by
   this ownership check. (Historical note: this comment used to claim
   attendance/grades leave staff access unbounded by class — that was
   never actually true and is doubly wrong now; both are scoped via
   ScopeEngine, and growth-profile.js's routes were fixed to match in
   2026-09 after being the one remaining unscoped module.) Parent/student
   seeing someone else's child is unambiguously wrong regardless of any
   staff-scoping question — this function closes exactly that gap, and
   only that gap; it deliberately says nothing about staff at all.
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

/* ── GROWTH_PROFILE_STAFF_ROLES ───────────────────────────────
   Which roles may write (create/update/delete) a growth_profile
   record, checked IN-ROUTE — not derived from the flat `growth_profile`
   RBAC array alone.

   Why this exists: SettingsPage.jsx's Roles & Permissions grid computes
   ONE flat action array per module as the UNION of every sub-checkbox
   under it (_deriveApiPerms in settings.js) — e.g. student's "view"
   (read) + "aspirations" (read/create/update) checkboxes union into a
   flat `growth_profile: ['read','create','update']` the moment an
   admin saves. growth-records.js's and growth-projects.js's POST/PUT/
   DELETE historically trusted that flat array alone (`rbac('growth_profile',
   'update')`, no subKey) — meaning granting a self-service role like
   student ANY write capability anywhere under growth_profile (even just
   editing their own aspirations) would, via that same flat array, also
   satisfy the RBAC check on unrelated routes like "edit any student's
   leadership record." Confirmed by reading every write route in both
   files — none had an in-route role check beyond RBAC before this.

   This constant is the explicit, route-level staff allowlist those
   write routes now check directly, independent of whatever the flat
   RBAC array says — the same membership already used by both files'
   pre-existing PATCH /verify handlers (verbatim, not reinterpreted).
   Belongs here (not duplicated per file) for the same drift-prevention
   reason as forbiddenForSelfServiceRole above. */
const GROWTH_PROFILE_STAFF_ROLES = ['admin', 'superadmin', 'teacher', 'section_head', 'deputy_principal'];

module.exports = { forbiddenForSelfServiceRole, GROWTH_PROFILE_STAFF_ROLES };
