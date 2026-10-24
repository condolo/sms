# Exams

## What the Exams module does

Exams records the sitting: its name, class, subject, date/time, room, and scheduling status. **Marks are entered in Exams → Markbook**, not on the exam record. The Markbook is the source used by report cards.

## Teacher workflow

1. Open **Exams** and review the exam timetable or sitting details for your class/subject.
2. If your role permits it, update the exam's permitted scheduling status as the sitting proceeds. Use the status history to see who made a status change and when.
3. Enter student results in **Exams → Markbook**, using the correct academic year, term, class, subject, assessment window/type, and instance.
4. Check the Markbook's save confirmation and resolve any conflicts. Use the explicit mark states for absent, missing, exempt, or incomplete students.
5. Report errors in the sitting details or schedule to the exams officer/administrator. Report-card publication is a separate workflow and locks the relevant marks.

The current exam lifecycle is a scheduling tracker, not a result-approval chain. Do not follow older instructions that describe entering `exam_results`, approving exam results, or publishing marks from the exam record.

## Setup, updates, and verification

Before a sitting, confirm the academic period, class, subject, date/time, room, and assessment type. Assessment windows and weights are configured separately under Assessment/Grades configuration. A scheduled window closing does not itself mean marks were published; an explicit lock or report-card publication may prevent further edits. Follow the current Markbook message and ask an administrator about a locked mark.

If historical marks appear missing, determine whether they were entered through the retired Exams → Results flow. The repository includes a dry-run-first migration from `exam_results` into `assessment_marks`; a school administrator/developer must review its findings and conflicts before any migration is applied.

**Access:** Exams and Grades use separate permission keys. Scheduling actions, mark entry, configuration, publication, and post-publication correction may require different grants.

**Sources:** `client/src/pages/exams/ExamsPage.jsx`; `server/routes/exams.js`, `assessment.js`, `mark-submissions.js`; `server/scripts/migrate-exam-results-to-markbook.js`; [Exams Officer Guide](../EXAMS_OFFICER_GUIDE.md).

**Recent change notes:** always check [CHANGELOG.md](../../CHANGELOG.md) before changing the assessment workflow. Relevant changes include v5.166.0–v5.168.0 (legacy year reads and Markbook consolidation), v5.170.3 (Review tab for the mark-submission queue), v5.173.0 and v5.177.0 (Kindergarten mark locking and publish-time locking), v5.181.0 (Kindergarten Templates moved under Exams), v5.184.0 (template subjects limited to class curriculum), and v5.186.0–v5.188.0 (stream diagnostics and curriculum guards).
