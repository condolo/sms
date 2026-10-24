# Msingi Exams Office Guide

**Audience:** Exams officers, academic administrators, and staff authorized to configure assessments, monitor marking, and coordinate report-card publication. Use this guide to manage the assessment cycle from setup through publication. Msingi has two different Markbook entry modes: the standard numeric Markbook and the Kindergarten competency-indicator Markbook. The class template determines which mode applies to a subject.

## Contents

1. [Understand the assessment workflow](#1-understand-the-assessment-workflow)
2. [Check permissions and academic setup](#2-check-permissions-and-academic-setup)
3. [Configure assessment windows and types](#3-configure-assessment-windows-and-types)
4. [Schedule an exam sitting](#4-schedule-an-exam-sitting)
5. [Monitor standard numeric marks](#5-monitor-standard-numeric-marks)
6. [Monitor Kindergarten indicator marks](#6-monitor-kindergarten-indicator-marks)
7. [Use Mark List and CSV export](#7-use-mark-list-and-csv-export)
8. [Review and correct published work](#8-review-and-correct-published-work)
9. [Prepare and publish report cards](#9-prepare-and-publish-report-cards)
10. [Reminders and troubleshooting](#10-reminders-and-troubleshooting)
11. [Access and safe data handling](#11-access-and-safe-data-handling)
12. [Sources and maintenance](#12-sources-and-maintenance)

## 1. Understand the assessment workflow

**Exams** tracks a sitting: its title, class, subject, date/time, room, and scheduling status. It is not where teachers enter marks. Teachers enter marks in **Exams → Markbook**, and Report Cards calculates results from the current Markbook data.

The selected class and subject determine which Markbook appears:

- **Standard numeric Markbook:** assessment window/type and instance columns, such as CA 1, with numeric scores or explicit mark states.
- **Kindergarten competency Markbook:** indicator definitions for the selected class, subject, and term, followed by per-learner band and/or numeric scoring. The class must resolve to a Kindergarten template, and the subject must be configured for indicator entry.

Report-card publication is a separate action. Publishing creates the report snapshot, makes it available according to the school's portal settings, and locks the relevant marks and remarks. An exam's Scheduled, In Progress, or Completed status does not publish marks.

## 2. Check permissions and academic setup

Before opening an assessment cycle:

1. Confirm the active academic year and term in the school's academic setup.
2. Confirm classes, streams, class curricula, student rosters, and teacher assignments are current.
3. Confirm the relevant subjects and assessment schedules exist.
4. Confirm the Exams Office account has the permissions required for the tasks assigned to it. Exams, Grades/Markbook, Reports/Mark List, Report Cards, and settings may have different permission controls.
5. Check whether a whole-school Mark List view is needed. The `reports__mark_list_school_wide` permission is a separate grant; an Exams Officer does not automatically receive whole-school marks visibility just from the role name.

The interface and server enforce both role permissions and record scope. A staff member may see only their assigned classes, streams, or subjects. If a tab or action is missing, ask an authorized administrator to review the relevant grant and scope instead of sharing credentials.

## 3. Configure assessment windows and types

Use **Exams → Configuration** for the assessment settings available to your account, including assessment types, weights, grading scales, and schedule controls. Exact settings can vary by school and role.

Before teachers enter marks, confirm:

- The year and term are correct.
- Each required assessment window/type and instance is present (for example, CA with its intended instance count).
- Weights and grade boundaries match the school's approved policy.
- The comment option is enabled for an assessment only when numeric subject comments are part of that workflow.
- No window is prematurely locked or archived.

Do not change weights, assessment types, or grading rules mid-cycle without authorization. Configuration changes do not automatically recalculate or replace an already-published snapshot. Kindergarten uses the separate template and indicator setup described in §6.

## 4. Schedule an exam sitting

1. Open **Exams → Exams** and choose **Add Exam** or the available sitting-creation action.
2. Select the year, term, class, subject, assessment type, date/time, and room/details requested by the form.
3. Check that the selected subject belongs to the class curriculum and that the sitting details match the approved timetable.
4. Save and reopen the record to confirm the details.
5. Update the sitting status as it progresses: **Scheduled → In Progress → Completed**, or **Cancelled** if the sitting will not take place.

Changing a sitting's status does not enter, approve, publish, or lock marks. A scheduled assessment window and an exam sitting are related setup, but they serve different purposes.

## 5. Monitor standard numeric marks

1. Open **Exams → Markbook** and select the year, term, class, subject, assessment window/type, and instance.
2. Select the stream if the assigned subject has multiple stream-specific teaching assignments. Review the roster before checking entries.
3. Review numeric cells and explicit mark states such as **Absent**, **Missing**, **Exempt**, or **Incomplete**. A zero is a score, not a substitute for one of those states.
4. Check the Markbook save confirmation and any conflict message. Ask the teacher to review only the affected cells when a concurrent edit conflict appears.
5. Reopen the exact same year, term, class, stream, subject, assessment, and instance when verifying a reported mark.

Teachers can edit marks before report-card publication, unless a separate schedule/year lock applies. Submission for review is no longer the normal pre-publication gate. Do not tell teachers that a mark is final merely because a sitting is Completed or a former submission status says Submitted/Approved.

Numeric subject comments are separate from marks and save separately. They may be disabled per assessment, and they are not Kindergarten subject comments. For an apparent missing value, verify the exact selection, mark state, save result, elective enrollment, and whether the report has been published before asking anyone to re-enter it.

## 6. Monitor Kindergarten indicator marks

Kindergarten templates are managed in **Exams → Kindergarten Templates** by authorized staff. A template can be explicitly assigned to classes or serve as a section default; the system resolves the template from those assignments, not the class name. Its subject list determines which subjects use competency entry, while its performance bands provide the scoring scale. Template subjects should align with the class curriculum.

The teacher creates the actual indicator text in the Markbook for the subject and term, because indicators should describe the content taught. The template is not the source of the current term's indicator wording. The current form supports numeric scoring with optional performance bands or band-only scoring; a subject setting can override the template's scoring default.

To monitor a Kindergarten subject:

1. Confirm the class has the correct template and the subject is assigned to competency entry.
2. Open **Exams → Markbook** and select the correct year, term, class, subject, and stream when applicable.
3. Confirm the **Competency-band entry** label and the intended template appear.
4. Confirm the teacher has added the term's indicators. Check that their descriptions are clear and relevant to the term's taught content.
5. Review the per-learner progress counts and sample saved entries where your permission allows. In numeric mode, check values against each indicator's maximum; in band-only mode, the selected band is the operative entry and Msingi derives its score for calculation.
6. If the wrong layout or bands appear, stop marking and correct the template configuration before publication.

There is no Kindergarten subject-comment field in the Markbook, and the ordinary Mark List is not the completeness report for indicator marks. Check progress in the competency Markbook. Kindergarten report cards use their separate Generate & Publish path and indicator/band layout.

## 7. Use Mark List and CSV export

The **Mark List** tab provides a class/stream overview across subjects for a selected year, term, assessment type, and instance. It is intended to identify missing **standard numeric Markbook** entries:

- A score or mark state appears when a matching numeric mark record included in reporting exists (`isPublished: true`). This does not mean the report card itself has been published.
- **MISSING** means an enrolled student has no mark for that sitting.
- A blank cell means the student is not enrolled in that elective (or the subject is outside the current user's teaching scope), not that a mark is missing.

The screen respects role and subject/stream scope. Some users see only subjects they teach; the configured whole-school Mark List grant can widen visibility. Use the **Download** control to export CSV. The CSV is generated from the same calculation as the displayed table; handle it as student information and store/share it only through approved school channels.

Mark List is based on standard assessment marks. It does not replace the Kindergarten indicator progress panel and should not be used to decide whether Kindergarten indicator entry is complete.

## 8. Review and correct published work

The **Review** tab is restricted to authorized staff and is not the normal teacher mark-entry approval queue. The old submit-for-review step was removed so teachers can enter and edit marks before publication. The Review area remains useful for submission records and controlled post-publication correction/unlock work.

For a mark correction after publication:

1. Confirm the report is published and identify the exact student, class, subject, year, term, assessment/instance, and current value.
2. Obtain the school's approval and a specific correction reason.
3. Use the authorized unlock-request and approval workflow. The decision is permission-controlled and audit-recorded; a required approver may be configured.
4. Correct the existing record in the same Markbook selection. Do not create another assessment, term, or student entry to bypass the lock.
5. Verify the correction in the Markbook and report preview, then re-publish/re-lock using the approved process. Unlocks automatically re-lock after the allowed correction window.

The same publish-time lock principle applies to Kindergarten indicator marks and report remarks. If the correct workflow is not available to your account, escalate to the authorized administrator rather than manipulating the database.

## 9. Prepare and publish report cards

1. Confirm the year, term, class, and stream. Confirm the correct report-card path is selected automatically for the class's resolved template.
2. Use Mark List for numeric completeness and the Kindergarten Markbook progress panel for indicator completeness.
3. Check that expected marks and comments are saved. Numeric subject comments and Kindergarten class-teacher remarks are different data fields and workflows.
4. Open **Report Cards → Generate & Publish** and select the exact year, term, class, and stream.
5. Review the preview, report count, learner identities, grading, comments/remarks, and any validation or provisional warnings. Resolve errors before publishing.
6. Confirm publication only after the school approves the results. Msingi warns that publishing makes reports available and locks marks; publication is not an ordinary save.
7. Verify the published count/status and open representative report cards. Check parent/student access only after confirming the intended release.

Publication creates a versioned snapshot. If corrections require republishing, use the supported correction workflow so the earlier snapshot remains part of the history. Do not assume later grading/template changes automatically rewrite an already-published report.

## 10. Reminders and troubleshooting

Use **Reminders** to review upcoming sittings and marking tasks available to your role. A reminder is not proof that a teacher's mark has or has not saved; verify the Markbook selection and record.

**A teacher says a mark disappeared.** Record the exact year, term, class, stream, subject, assessment type, and instance. Reopen that exact selection. Check for a transient load error, an unsaved edit, conflict, schedule lock, or an entry saved under another year/instance. Do not ask for a whole-class re-entry until existing records have been checked.

**A student or subject is missing.** Check active status, class/stream assignment, curriculum link, teaching assignment, and elective enrollment. Mark List blanks for non-enrolled electives are expected; they are not missing marks.

**A Kindergarten subject shows numeric entry.** Check class/section template resolution, subject inclusion, and academic period. Do not enter Kindergarten competency results in the numeric grid.

**Kindergarten indicators or bands are missing.** Check the selected term, indicator definitions, template assignment, and subject-specific band/scoring override. Ask the teacher or authorized template manager to correct the right configuration; do not create a parallel template as a workaround.

**Published marks or remarks are locked.** Use the controlled correction process in §8. Do not instruct a teacher to repeat the mark under another instance.

**Report preview looks incomplete or will not load.** Capture the exact class/term selection and displayed error, check source records and permissions, then escalate. An empty or failed preview is not evidence that the stored marks are gone.

## 11. Access and safe data handling

Exam sittings, numeric marks, Kindergarten indicators, Mark List, assessment settings, Review, and report-card publication can have distinct permissions. The visible tabs vary by role; the server also enforces access and data scope. Do not grant broad whole-school visibility simply to solve a missing entry. Ask an administrator to confirm the narrowest appropriate permission.

Mark List exports and report cards contain student information. Download only for an approved task, use school-managed storage, and do not send them through personal accounts or informal group chats. Record corrections and publication decisions through the supported workflow.

## 12. Sources and maintenance

Checked against `ExamsPage.jsx`, `IndicatorMarkbook.jsx`, `MarkListTab.jsx`, `RCTemplatesSection.jsx`, `ReportCardsTab.jsx`, `indicator-marks.js`, `assessment.js`, `mark-submissions.js`, and `report-cards.js`, plus the module-flow guides. Changelog checked through v5.204.3. Relevant entries: v5.170.3 (Review tab), v5.172.0 (Kindergarten report generation/publication), v5.177.0 (autonomous mark entry and lock at publication), v5.178.0 (Kindergarten comment restrictions), v5.181.0 (templates moved to Exams), v5.184.0 (template subject scope), v5.193.0 (comment overwrite guard), v5.196.0–v5.197.0 (Mark List and CSV), v5.201.0 (comments lock at publication), and v5.203.0 (teacher-managed term indicators).

The current template form also includes band-only scoring and per-subject overrides; verify the setting in the deployed UI before advising a school. Keep this guide aligned with the current routes, UI, role permissions, and later changelog updates. See [Kindergarten Teacher Guide](KINDERGARTEN_TEACHER_GUIDE.md), [Grades & Marks workflow](module-flows/grades.md), [Exams workflow](module-flows/exams.md), and [Report Card workflow](module-flows/report-cards.md).
