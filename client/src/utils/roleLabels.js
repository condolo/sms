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
