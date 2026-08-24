/* ============================================================
   Msingi — Shared role-assignment validation

   WHY THIS EXISTS (staffType/role separation audit)
   Three independent places accepted a `role` string when creating or
   updating a login account: settings.js's POST /users/invite, PUT
   /users/:id, and POST /users/bulk-invite. Auditing them found:
     - PUT /users/:id's BUILTIN_UPDATE_ROLES and POST /users/invite's
       BUILTIN_INVITE_ROLES were two independently-maintained lists that
       already disagreed (one had 'principal', the other had 'guardian',
       neither had both) — exactly the drift this file exists to end.
     - A completely separate, still-mounted route file (routes/users.js,
       at /api/users — not /api/settings) had its OWN POST /invite and
       POST /bulk-invite with NO role validation at all: `const safeRole
       = role || 'teacher'`, accepting any string. Unreachable from the
       current product UI (nothing in client/src calls /api/users/invite
       or /api/users/bulk-invite — only /api/settings/users/*), but live,
       mounted, and directly callable by anyone who clears its rbac()
       gate. A parallel, unvalidated route to the one already fixed is
       still a real gap, not a hypothetical one.
   One list, one validator, used by every route that assigns a role —
   the same fix class as the invite validation, generalized so a fourth
   copy can't quietly reintroduce this gap somewhere else.

   'superadmin' is deliberately never assignable through any of these
   school-level routes (never was, in either pre-existing list) —
   platform-level and granted through a separate platform-admin
   mechanism, not a school's own user management.
   ============================================================ */
'use strict';

const SYSTEM_ROLES = new Set([
  'admin', 'principal', 'deputy_principal', 'deputy', 'section_head', 'teacher',
  'exams_officer', 'timetabler', 'admissions_officer',
  'finance', 'hr', 'discipline_committee', 'parent', 'guardian', 'student',
]);

/**
 * Validates that `role` is either a real built-in role or a custom role
 * belonging to this school, and — when it's 'admin' — that the caller is
 * superadmin. Returns { ok: true } or { ok: false, status, message }.
 *
 * @param {import('express').Request} req - must have req.jwtUser populated
 * @param {string} role
 * @param {(col: string, ctx: object) => object} tenantModel
 * @param {(req: object) => object} tenantContext
 * @param {(req: object) => boolean} isSuperAdmin
 */
async function validateAssignableRole(req, role, tenantModel, tenantContext, isSuperAdmin) {
  // Reject non-string input outright — role is normally a Set/Array
  // membership check (safely false for any non-string), but the
  // custom-role fallback below runs it through a Mongo query
  // (`{key: role}`). An object like {"$ne": null} would never satisfy
  // this function's own 'admin' string-equality gate (so this was never
  // a privilege-escalation path), but it could match an operator query
  // and let a non-string value slip past the "is this a real role" check
  // into a stored role field, leaving the account broken rather than
  // elevated. Cheap to close outright rather than rely on that reasoning.
  if (typeof role !== 'string') {
    return { ok: false, status: 400, message: 'role must be a string.' };
  }
  if (!SYSTEM_ROLES.has(role)) {
    const customRole = await tenantModel('custom_roles', tenantContext(req))
      .findOne({ schoolId: req.jwtUser.schoolId, key: role }).lean();
    if (!customRole) return { ok: false, status: 400, message: `Invalid role '${role}'.` };
  }
  if (role === 'admin' && !isSuperAdmin(req)) {
    return { ok: false, status: 403, message: 'Only superadmin can grant the admin role.' };
  }
  return { ok: true };
}

module.exports = { SYSTEM_ROLES, validateAssignableRole };
