# Subjects

## Common workflows

1. Open **Subjects** and review the catalogue before adding a duplicate.
2. Create a subject with its display name, code, curriculum/key-stage values supported by the form.
3. Use the curriculum and enrollment tabs to connect subjects to the appropriate classes/students; use the warnings view to spot missing or inconsistent assignments.
4. If a subject is no longer used, check that it has no timetable, class, student enrollment, or grade dependencies before attempting deletion.

Department and teaching-assignment maintenance may be exposed in their own screens. Create the underlying class, teacher, and subject records first.


## Setup, updates, and verification

### Maintain curriculum and assignments

Create the subject catalogue before linking subjects to classes, students, or teaching assignments. Check the curriculum values and use the curriculum/enrollment views to verify each link. After changing an assignment, confirm it appears for the intended class and teacher in Lessons/Timetable. Before retiring a subject, review active grades, timetable slots, and enrollments and resolve dependencies through their owning screens; do not delete a subject merely to rename it.

**Access:** Subjects permissions govern catalogue actions; class-subject, student-subject, department, and teaching-assignment routes may apply their own module permissions and validation.

**Sources:** `client/src/pages/subjects/`; `server/routes/subjects.js`, `departments.js`, `class-subjects.js`, `student-subjects.js`, `subject-rules.js`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.124.0 for page-level access when Subjects permission is removed.
