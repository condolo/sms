/* ============================================================
   Msingi — Staff Roles & Responsibilities Configuration
   Single source of truth for the built-in "extra role" tags a
   school can assign to a teacher (Settings → School → Staff
   Roles & Responsibilities, and the Staff form's own picker).

   ── What this is, and what it is NOT ──────────────────────────
   This is a SEPARATE system from Roles & Permissions (the RBAC
   role a user account holds — server/utils/role-validation.js's
   SYSTEM_ROLES, checked via req.jwtUser.role/roles). This file's
   values live only on a `teachers` document's `extraRoles` array
   and describe organizational RESPONSIBILITIES (who's the HOD of
   a department, who does the timetable) — a teacher's account can
   hold these regardless of their actual RBAC role.

   Some responsibilities (`hod`) are ALSO checked for real, scoped
   authorization decisions (department-limited teaching-assignment
   management in teaching-assignments.js) — that's intentional, by
   original design, the same as any other capability grant.

   ── Why this file exists (found live, 2026-09) ────────────────
   The picker used to include 'deputy' and 'principal' as built-in
   values — the EXACT SAME STRINGS SYSTEM_ROLES uses for the real
   Deputy Principal / Principal account roles. Three files
   (teaching-assignments.js, lessons.js, weekly-snapshots.js) each
   built one merged Set from role + roles + extraRoles and checked
   broad-access membership against it — so a teacher merely TAGGED
   "Deputy Principal" as a responsibility (no different, from an
   admin's point of view, than tagging someone "Timetabler") was
   silently granted the same broad access as an account actually
   holding the Deputy Principal or Principal RBAC role, without
   ever going through Roles & Permissions. Renamed the two
   colliding values (`acting_deputy`, `head_of_school`) so no
   extraRoles value can ever equal a SYSTEM_ROLES value again, and
   the three broad-access checks now list the renamed values
   explicitly alongside the real role check — same functional
   grant as before for anyone who already had the tag, but now an
   explicit, readable decision instead of an accidental string
   match. See server/routes/settings.js's PUT /school for the
   guard that keeps a school from ever recreating this by hand
   with a custom responsibility.

   This was ALSO five hand-copied lists drifting independently
   (client/src/pages/settings/SettingsPage.jsx,
   client/src/pages/hr/HRPage.jsx,
   client/src/pages/hr/StaffFormModal.jsx,
   server/routes/teachers.js, server/routes/import-export.js) —
   exactly the class of bug the v5.96.0 model-factory drift was.
   One file each side (client/src/config/staffResponsibilities.js
   mirrors this one) instead.

   'timetabler' had the EXACT SAME collision, left unfixed in the pass
   above despite the fix's own comment using "tagging someone
   Timetabler" as its own illustrative example of the bug class.
   Reported directly (2026-10-14): a school with this built-in value
   already saved to staffResponsibilities (schools.staffResponsibilities
   entries persist once an admin has ever touched the panel — see
   PUT /school's guard below) could no longer save ANY settings change
   through PUT /school at all, Houses included, since that route
   bundles the whole school document and the guard rejects the request
   on sight — with the actual offending record invisible anywhere in
   the UI to fix. Also a live, unpatched instance of the SAME
   privilege leak the deputy/principal rename closed:
   teaching-assignments.js's _effectiveRoles() merges extraRoles into
   the same set checked against the real 'timetabler' SYSTEM_ROLES key,
   so a teacher merely TAGGED "Timetabler" was silently granted that
   role's broad read access to every other teacher's assignments,
   without ever going through Roles & Permissions. Renamed to
   'timetable_coordinator' — see teaching-assignments.js's own comment
   for how that capability grant is now explicit instead of accidental,
   and server/scripts/migrate-staff-responsibility-rename.js for the
   migration of already-persisted data (same script the deputy/
   principal rename used, extended rather than duplicated). */
'use strict';

const BUILTIN_STAFF_RESPONSIBILITIES = [
  { value: 'hod',                    label: 'Head of Department' },
  { value: 'class_teacher',          label: 'Class Teacher / Form Tutor' },
  { value: 'timetable_coordinator',  label: 'Timetabler' },
  { value: 'exam_officer',           label: 'Exam Officer' },
  { value: 'acting_deputy',          label: 'Deputy Head' },
  { value: 'head_of_school',         label: 'Head of School' },
];

const BUILTIN_EXTRA_ROLE_VALUES = new Set(BUILTIN_STAFF_RESPONSIBILITIES.map(r => r.value));

module.exports = { BUILTIN_STAFF_RESPONSIBILITIES, BUILTIN_EXTRA_ROLE_VALUES };
