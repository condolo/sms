# Teachers

## Common workflows

### Maintain the teacher directory
1. Open **Teachers** and search/filter the staff list.
2. Open a teacher profile to review the linked staff record and teaching details.
3. Add or edit the teacher record using the available form. Use the import flow for a batch and its current CSV template for field names.

### Link a login
A teacher profile and a login account are related but distinct records. If the profile has no login, use **Create Login Account** from HR when available, or the admin invite flow in Settings. Check that the account's role and the teacher record are linked correctly before the teacher signs in.


## Setup, updates, and verification

### Maintain teacher and account links

Create or import the teacher record and verify the directory entry before linking a login. Assign teaching or form-teacher responsibilities in the appropriate workflow, then verify the teacher sees the expected classes in Attendance, Lessons, and Timetable. When a teacher leaves or changes duties, update assignments and account access separately; disabling one does not necessarily remove the other. Use the HR guide for employment details and Settings for authorized login/role management.

**Access:** Teacher directory permissions govern the record. Login creation, role assignment, and password reset require user-management authority. Functional responsibilities and account roles are different concepts.

**Sources:** `client/src/pages/teachers/TeacherList.jsx`; `server/routes/teachers.js`, `settings.js`, `users.js`; [HR Guide](../HR_GUIDE.md#2-staff-records).; [CHANGELOG.md](../../CHANGELOG.md)
