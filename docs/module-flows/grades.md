# Grades & Marks

## Enter marks

1. Open **Exams / Grades → Mark Entry** and select class, subject, academic year/term, assessment type, and instance. If you teach more than one stream of that class/subject, use the stream picker and enter one stream's roster at a time.
2. Enter scores using the expected scale and use the defined absent, missing, exempt, or incomplete states rather than substituting a zero.
3. Review the grid and save. Check the class statistics and resolve missing/incomplete entries before report approval.
4. Use the grade/report views to review student progress. Keep comments in the intended subject or class-teacher fields.

## Before publishing results

Check assessment weights, grade boundaries, and exam status with the school administrator. Published snapshots preserve the values used at publication; changing settings later does not retroactively recalculate an existing snapshot.


## Setup, updates, and verification

### Configure, amend, and verify marks

Before a marking period, confirm assessment types/weights and grade boundaries with the authorized administrator. Use the right class, subject, term, instance, and student before entering scores. Save and reopen a sample record to verify persistence; review absent/missing/exempt/incomplete states separately from numeric zeroes. For corrections after submission, use the submission/review workflow and retain the reason. Changes to grading configuration may affect future calculations; verify published snapshots through the report-card workflow.

**Access:** `grades` controls mark entry and report access. Mark-submission review, report generation/publication, and export may require specific grants. Exams also has its own permission module; see [Exams](exams.md).

**Sources:** `client/src/pages/grades/`, `client/src/pages/exams/ExamsPage.jsx`; `server/routes/grades.js`, `assessment.js`, `mark-submissions.js`, `report-cards.js`; [User Guide](../USER_GUIDE.md#8a-grades--assessment-system-ca--hw--mt--et).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.106.0–v5.107.0 for mark/report scope and configuration grants, and v5.130.0 for the Markbook stream picker when a teacher teaches more than one stream.
