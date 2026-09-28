# Assessment Scheduling

Assessment Scheduling is a permission module embedded in the Grades/Exams experience rather than a separate sidebar page.

1. Open the Grades/Exams configuration area and select the assessment schedule.
2. Configure assessment types, terms, date windows, and instances to match the school's assessment calendar.
3. Check configured weights and required completeness before teachers begin entry; weights must satisfy the validation shown in the UI.
4. Use the reminders view to identify upcoming, open, or overdue assessment windows and notify teachers when appropriate.
5. If a schedule must be frozen or reopened, use the schedule lock workflow and provide the requested reason.

Do not confuse assessment schedule locking with exam locking: they are separate operations and permissions.


## Setup, updates, and verification

### Set up or change the assessment calendar

Before term starts, verify the academic year, terms, assessment types, weights, date windows, and expected instances in Grades/Exams configuration. Save and inspect the schedule/reminders view to confirm the right classes and dates appear. If changing a schedule already in use, check the status and lock state first; use the assessment schedule lock with its reason when closing the window. Do not use exam lock/unlock to manage the schedule.

**Access:** Assessment Scheduling has a distinct lock permission. Assessment configuration and mark-entry permissions are managed separately.

**Sources:** `client/src/pages/grades/components/ConfigTab.jsx`, `RemindersTab.jsx`; `server/routes/assessment.js`; module definitions in `server/config/moduleRegistry.js`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.106.0–v5.107.0 for academic record scope and configuration permission behavior.
