# Attendance

## Take a register

1. Open **Attendance**, choose the class/stream, and confirm the date.
2. Mark each student present, absent, late, or excused. Use bulk actions only after checking the roster.
3. Review the marked list and save/submit the register.
4. Correct a submitted entry using the edit flow if your role permits it; do not create a second register for the same class/date.

## Review

Use the attendance reports for class or student summaries. The absentees and conflicts panels provide additional views and may expose school-wide or guardian-contact information, so they require their specific permission grants. Parent notifications depend on linked parent accounts and configured notification channels.


## Setup, updates, and verification

### Set up, correct, and verify registers

Before taking attendance, confirm the class/stream roster and teacher assignment are current. Select the exact class, stream, and date; review the roster before using bulk status actions. Reopen an existing register to correct it instead of creating a second one. After saving, confirm the statuses persist and inspect the class/date summary. For missing students or classes, first check stream placement and teaching/form-teacher assignment, then ask an administrator to review Attendance access and scope.

**Access:** Attendance module switch and role permission apply. Teacher views can be limited to assigned classes; whole-school reports, absentees/contact data, and conflict analysis have additional grants.

**Sources:** `client/src/pages/attendance/AttendancePage.jsx` and its `components/`; `server/routes/attendance.js`; [User Guide](../USER_GUIDE.md#7-attendance).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.121.0–v5.122.0 for school-wide report grants and stream-scoped registers.
