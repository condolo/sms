# Grades & Marks

## Enter marks in the Markbook

For classes assigned a Kindergarten competency template, the Markbook switches to indicator-based entry; follow the [Kindergarten Teacher Guide](../KINDERGARTEN_TEACHER_GUIDE.md). The standard numeric instructions below apply to subjects using the numeric grid.

The Markbook is the single current source for numeric assessment marks and the source used by report-card calculations. Exams records the scheduled sitting; teachers do not enter marks in an exam-results screen.

1. Open **Exams → Markbook** and choose the academic year, term, class, subject, assessment window/type, and instance.
2. If the selected class/subject has more than one stream assigned to you, select the intended stream and verify the roster.
3. Enter scores using the scale shown. Use **Absent**, **Missing**, **Exempt**, or **Incomplete** when appropriate; do not substitute a numeric zero for a mark state.
4. Select **Save All Marks**. Wait for confirmation and review any conflict warning before leaving the page.
5. Reopen the same year, term, class, subject, stream, type, and instance to verify the saved values.

Marks remain editable until the report card is published for that class and term. Publishing locks the marks. If a published mark needs correction, ask an authorized administrator to use the controlled unlock/correction workflow and provide the required reason.

## Enter comments

Subject comments are separate from marks. When the selected assessment window has comments enabled, use the Markbook's **Comment** column and save the student's comment separately. Saving marks does not save the comment. The comment is stored per student, subject, and term, not per assessment instance. **Known integrity gap:** the current draft-comment key omits academic year, so a recurring term number can collide with an earlier year's draft; preserve and review existing comments before re-entry or migration. Class/form-teacher remarks and any observation ratings are managed from the Report Cards workflow by users with the required role and assignment.

## Before a reporting cycle

Ask the authorized administrator to confirm assessment types, weights, grade boundaries, academic year, and term setup. Review missing/incomplete marks and any save conflicts. Preview report cards and resolve provisional or validation warnings before publication. Published snapshots preserve the published result; a later configuration change does not automatically rewrite them.

## Missing data checks

If a mark appears missing, confirm the full Markbook selection (year, term, class, stream, subject, assessment, instance), student roster, and elective enrollment. Older marks may be stored without an academic-year tag or in the retired `exam_results` collection. Do not bulk re-enter or migrate them without an administrator's read-only reconciliation and conflict review.

**Access:** Mark entry and grade reads use `grades` permissions; assessment configuration uses the separate `assessment` permission. Publication, unlock, and export actions may have additional permission requirements. See [Exams](exams.md) and [Report Cards](report-cards.md).

**Sources:** `client/src/pages/exams/ExamsPage.jsx`; `client/src/pages/grades/`; `server/routes/assessment.js`, `mark-submissions.js`, `report-cards.js`; [User Guide](../USER_GUIDE.md#8a-grades--assessment-system-ca--hw--mt--et).

**Recent change notes:** always check [CHANGELOG.md](../../CHANGELOG.md) before entering or repairing marks. Relevant changes include v5.166.0–v5.168.0 (legacy year reads and Markbook consolidation), v5.170.2 (subject comments are not locked by mark submission), v5.173.0 and v5.177.0 (Kindergarten marks and numeric Markbook submission/locking behavior), v5.186.0 (stream assignment diagnostics), v5.187.0–v5.189.0 (curriculum integrity and elective enrollment), and v5.193.0 (prevent silent clearing of unseen comment fields).
