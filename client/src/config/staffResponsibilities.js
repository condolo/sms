/* ============================================================
   Msingi — Staff Roles & Responsibilities Configuration
   Client-side mirror of server/config/staffResponsibilities.js —
   see that file for the full explanation of what this is, how it
   differs from Roles & Permissions, and why the two renamed
   values (acting_deputy, head_of_school) exist. Keep both files'
   values/labels identical.
   ============================================================ */

export const BUILTIN_STAFF_RESPONSIBILITIES = [
  { value: 'hod',            label: 'Head of Department' },
  { value: 'class_teacher',  label: 'Class Teacher / Form Tutor' },
  { value: 'timetabler',     label: 'Timetabler' },
  { value: 'exam_officer',   label: 'Exam Officer' },
  { value: 'acting_deputy',  label: 'Deputy Head' },
  { value: 'head_of_school', label: 'Head of School' },
];

/** value -> label, for rendering a stored extraRoles entry without a lookup loop. */
export const STAFF_RESPONSIBILITY_LABELS = Object.fromEntries(
  BUILTIN_STAFF_RESPONSIBILITIES.map(r => [r.value, r.label])
);
