# Msingi — Exams Officer Guide

> **Audience:** Exams officers and school staff authorized to manage assessments. Screen access and individual actions depend on the school's role permissions. This guide follows the current Exams/Markbook workflow; check the [changelog](../CHANGELOG.md) for changes after this review.

## 1. The two related workflows

**Exams** records scheduled sittings (title, class, subject, date/time, room and status). **Exams → Markbook** is where teachers enter numeric assessment marks and subject comments. Report Cards reads the Markbook records. The old exam-results entry and approval workflow is retired; do not use it as the normal marks workflow.

The current page can include **Exams, Markbook, Review, Reminders, Configuration**, and **Kindergarten Templates** tabs. Which tabs and actions appear depends on your role and permissions.

## 2. Schedule a sitting

1. Open **Exams → Exams** and choose **Add Exam** or the teacher sitting-announcement flow available for the assigned subject.
2. Select the correct academic year, term, class, subject, assessment type, date/time, and room/details shown by the form.
3. Save, then confirm the sitting appears with the intended class, subject, date/time, and status.
4. Use the schedule status to track the sitting: **Scheduled → In Progress → Completed**, or **Cancelled** where appropriate. Exam status does not approve, publish, or store marks.

Assessment windows, assessment types, and weights are configured separately. A closed window or elapsed deadline does not itself mean marks were submitted or locked.

## 3. Enter and review marks

Teachers enter marks from **Exams → Markbook** using the correct academic year, term, class, stream (when applicable), subject, assessment type/window, and instance. The roster depends on class/stream placement and subject enrollment. If a student or subject is missing, confirm those assignments before entering marks; do not create a substitute record under a different selection.

Mark entry is autonomous before report-card publication. Teachers save marks in the Markbook and should verify them by reopening the same selection. Use the explicit **Absent, Missing, Exempt,** or **Incomplete** states where applicable rather than substituting a numeric zero. Subject comments are separate from marks and can be saved independently; a mark submission does not save a comment.

The **Review** tab is the cross-class mark-submission queue for users who have access. It supports reviewing submissions and applicable approve/reject/lock actions. This moderation queue is not the place teachers enter marks, and the presence or absence of a review action does not change the Markbook source of truth.

## 4. Publish report cards and mark locking

Report-card generation and publication are handled in **Report Cards**, not by changing an exam's status. Review the selected year, term, and class, check validation and preview messages, then use the authorized publish action. Publication creates the report snapshot and automatically locks the relevant marks. Until publication, marks remain editable unless a separate authorized lock is in effect.

For a post-publication correction, use the locked-marks workflow and follow its permission and reason requirements. A correction should be reviewed in the Markbook and report card before the marks are locked again. Do not create duplicate marks or change the exam status to try to unlock a published result.

## 5. Configuration

Use **Exams → Configuration** for the assessment types/weights, grading scales, and assessment schedule controls available to your role. Confirm the active academic year and term before configuring a cycle. A change in configuration does not automatically rewrite an already published report-card snapshot.

**Kindergarten Templates** now lives under **Exams**, not Report Cards or Settings. Assign the intended template to the class or its section default, check that its subjects match the class curriculum, and verify its indicators and grading bands before teachers enter indicator marks. Kindergarten uses its own Markbook and report-card path.

## 6. Reminders and missing-data troubleshooting

Use **Reminders** to see upcoming sittings and marking/moderation tasks. When a teacher reports a missing mark or comment, first write down their exact year, term, class, stream, subject, assessment type/window, and instance selection. Reopen that exact Markbook selection and check the roster, save confirmation, and locked state. Check subject enrollment/curriculum and whether the relevant report card has been published. Do not tell the teacher to re-enter the mark until you have checked whether an existing record is stored under a different selection or legacy year.

Older marks can have yearless records or can exist in the retired `exam_results` collection. Treat any migration or bulk correction as a separate, reviewed data operation; do not attempt it from the normal UI.

## 7. Access and role permissions

Exams, Grades/Markbook, Assessment configuration, Review, Report Cards, and sensitive post-publication correction actions can have distinct permissions. Being an Exams Officer does not by itself guarantee every action. Ask the administrator to check the relevant capability in **Settings → Roles & Permissions** if a tab or action is missing. Never share credentials or work around a missing permission by editing records outside the supported workflow.

**Sources:** `client/src/pages/exams/ExamsPage.jsx`, `client/src/pages/grades/components/ReportCardsTab.jsx`, `server/routes/exams.js`, `assessment.js`, `mark-submissions.js`, and `report-cards.js`.

**Changelog checked:** v5.194.0 (2026-10-15), including v5.166.0–v5.168.0 (Markbook source consolidation), v5.170.3 (Review tab), v5.173.0/v5.177.0 (mark locking and submission workflow), and v5.178.0/v5.181.0/v5.184.0 (Kindergarten workflow and template location/curriculum scope). Check the linked changelog for later changes.
