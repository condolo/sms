# Students

## Common workflows

### Find and review a student
1. Open **Students** and search by name, admission number, class, or available filters.
2. Open the student row to view the profile and its tabs (for example academic, attendance, behaviour, family, and medical details where enabled).
3. Use the profile actions to edit permitted fields. Student records are school-scoped; the list may also be narrowed by a user's class or section assignment.

### Add or import students
1. Choose **Add Student** for one record, or **Import** for a CSV batch.
2. Complete the required identity and placement fields; check the import template for exact column names.
3. Review validation results before relying on the new records. Resolve rejected rows and check for duplicates.

### Deactivate or permanently remove
Use the normal deactivate action for a student who has left. Permanent purge is a separate elevated capability; confirm the student and understand linked academic/history data before using it.


## Setup, updates, and verification

### Maintain student records and placements

Before creating a student, search by name/admission number and review duplicates. Use the current import template for bulk work, validate the preview/errors, then confirm a sample of imported records and class/stream placement. Use promotion or transfer workflows for year changes and verify the resulting class membership. Deactivate a leaver through the normal action; duplicate resolution and permanent purge are separate elevated tasks with potential history impact.

**Access:** Students read/create/update/delete permissions; import, promotion, duplicate resolution, portal-account management, and permanent purge have additional permission controls.

**Sources:** `client/src/pages/students/StudentList.jsx`, `StudentProfile.jsx`; `server/routes/students.js`, `import-export.js`; [School Administrator Guide](../SCHOOL_ADMIN_GUIDE.md#7-student-enrollment).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.115.0–v5.115.1 for grant-controlled student actions and v5.76.0–v5.79.0 for duplicate resolution.
