/* ============================================================
   Shared system-role display names (2026-09)

   Single source of truth for a built-in role's DEFAULT display name —
   extracted out of SettingsPage.jsx so every page that shows a role's
   name (HR, a user's own Profile, Settings itself) reads the same list
   and, more importantly, respects the same school-level rename
   (`school.roleLabels`, set in Settings -> Roles & Permissions) instead
   of each page keeping its own hardcoded copy that could drift or
   simply never learn about a rename at all.

   A role's machine key never changes — this is display only.
   ============================================================ */

export const SYSTEM_ROLE_LABELS = {
  superadmin:           'Super Admin',
  admin:                'Admin',
  principal:            'Principal',
  deputy_principal:     'Deputy Principal',
  deputy:               'Deputy',               // legacy alias
  section_head:         'Section Head',
  teacher:              'Teacher',
  exams_officer:        'Exams Officer',
  timetabler:           'Timetabler',
  admissions_officer:   'Admissions Officer',
  finance:              'Finance',
  hr:                   'HR',
  discipline_committee: 'Discipline Committee',
  parent:               'Parent',
  guardian:             'Parent', // legacy alias — same portal role as 'parent'
  student:              'Student',
};

/**
 * Resolves what to actually show for a role key: the school's own
 * rename if it's set one (`overrides`, i.e. `school.roleLabels`), else
 * the default label above, else a readable fallback for anything not
 * in either (a custom role key, most likely — pass its own `label`
 * field instead of this function for those).
 */
export function roleLabel(key, overrides) {
  return overrides?.[key] || SYSTEM_ROLE_LABELS[key] || (key ? key.replace(/_/g, ' ') : '');
}

/* ── Canonical STAFF role keys (2026-09) ─────────────────────────
   Single source of truth for "which built-in roles are real, grantable
   system roles" — mirrors server/utils/role-validation.js's own
   SYSTEM_ROLES exactly (minus parent/guardian/student, which aren't
   staff, and superadmin, which is platform-granted, never assignable
   from here). Extracted after a real gap was found live: HR's own
   "Add Staff" role dropdown had independently drifted from this list
   for who knows how long and was missing 'principal' entirely — a
   real school's own Principal (a former superadmin, reassigned via the
   platform console's Change Role) had no way to be entered into HR at
   all, since the option to even select "Principal" as their staff type
   didn't exist. HR (`HRPage.jsx`) and Payroll (`PayrollSettingsModal.jsx`)
   both build their role list from this now; Settings' own user-role
   dropdown (`SettingsPage.jsx`) adds 'parent'/'student' on top for its
   different purpose (listing/filtering every account type, not just
   staff). Two other role pickers — behaviour escalation assignees
   (`CategoriesTab.jsx`) and the report-comment approval chain
   (`reportcards/SettingsPanel.jsx`) — are DELIBERATELY narrower,
   feature-specific subsets (not every system role makes sense as a
   behaviour-escalation or report-approval step) and were left alone;
   don't "fix" those to match this list without a specific reason to. */
export const STAFF_ROLE_KEYS = [
  'admin', 'principal', 'deputy_principal', 'section_head', 'teacher',
  'exams_officer', 'timetabler', 'admissions_officer', 'finance', 'hr',
  'discipline_committee',
];
