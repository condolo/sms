# Exams

The detailed exam lifecycle and role exceptions are in the [Exams Officer Guide](../EXAMS_OFFICER_GUIDE.md). The usual sequence is:

1. Create/schedule an exam with class, subject, type, date, start/end time, and maximum mark.
2. Move it through the permitted status transitions as it is sat and results are entered.
3. Enter results in the markbook; use the system's explicit absent/exempt/missing states where appropriate.
4. Complete moderation and approval. Locking freezes entry; unlocking is deliberately more restricted.
5. Publish only after verifying results and approval, then archive when the exam is complete.

Use status history to understand who changed an exam and when. Do not bypass the lifecycle by editing data through generic data tools.


## Setup, updates, and verification

### Prepare and maintain an exam

Before creating an exam, verify the academic period, class, subject, assessment type, and maximum mark. Set a start and end time if the sitting has one — the exams officer's own Add Exam form and the subject teacher's Announce Sitting form both collect it, and it is what students and staff see on their Upcoming Exams dashboards. Save it as a draft first; check the detail page and status before scheduling. As the exam progresses, use the supported status actions and review the Markbook for missing/invalid entries before moderation and approval. After publication, verify the intended audience/result visibility. If a button is unavailable, consult the Exams Officer Guide for status and grant requirements; do not edit exam status through generic tools.

Scheduling an assessment-type window (e.g. Mid-Term) in Assessment Scheduling (see [assessment.md](assessment.md)) does not need a separate "activate" step: the window is automatically open the moment today's date falls inside it, and a teacher can still enter results after it closes — closing only nags via reminders, it never blocks entry. Only an explicit schedule lock blocks entry, and that lock can be reopened with a recorded reason.

**Access:** Exams and Grades are separate permission keys. Lock/unlock, result entry, deletion, and publication are not necessarily granted together.

**Sources:** `client/src/pages/exams/ExamsPage.jsx`; `server/routes/exams.js`, `exam-series.js`, `mark-submissions.js`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.58.0, v5.106.0–v5.107.0 for exam lifecycle permissions and class/subject scope, and v5.145.0 for start/end time on the Add Exam form and its display on Upcoming Exams dashboards.
