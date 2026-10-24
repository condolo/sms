# Msingi — Teacher Step-by-Step Guide

**Audience:** Teachers and class/form teachers using Msingi for the first time.  
**Purpose:** A practical route from first sign-in through the standard teacher modules, daily teaching work, marks, report comments, and HR self-service.

> Your school controls role permissions, class/subject assignments, academic-year setup, and some workflows. If a tab or action is missing, ask the school administrator to check your login link, role permission, staff record, and teaching/form-teacher assignment. Do not use another person's account.

## Teacher module access at a glance

The standard **Teacher** role is provisioned with the following module permissions in the current code (`server/utils/repairPermissions.js` and `server/routes/onboard.js`). A permission is a ceiling for that module, not a promise that every button is available: assigned class/stream/subject scope, school settings, plan access, workflow state, and more specific action checks still apply. Existing schools may have customized roles, so your own menu and the server's access decision are authoritative.

| Module | Standard teacher permission | What to use it for |
|---|---|---|
| Students | Read | Find assigned learners and review permitted profile details. |
| Teachers | Read | View permitted staff/teacher information. |
| Classes & streams | Read | Check class and stream information and rosters. |
| Attendance | Read, create, update | Take and correct registers within your allowed scope. |
| Grades / Markbook | Read, create, update | Enter marks and, where enabled, subject comments. |
| Assessment scheduling | Read, create, update | Use the assessment area available to your role; school setup and lock actions may have separate checks. |
| Timetable | Read | View your assigned timetable; this is not permission to change the school timetable. |
| Messages | Read, create, update | Read and send permitted messages; audience and recipient checks still apply. |
| Events | Read | View events visible to your account. |
| Report Cards | Read | View permitted report-card information. Editing draft remarks requires additional Report Cards update access and the relevant teacher assignment. |
| Exams | Read | View exam sittings and use the Markbook for marks. |
| Lessons | Read, create, update, delete | Work with lesson plans and coverage within your assigned classes/subjects; follow school rules before deleting. |
| Resources | Read, create, update | View and maintain resources permitted to your role and audience. |
| Library | Read | View permitted library information; lending/stock actions may need additional grants. |
| Hostel | Read | View permitted hostel/student information; this is not hostel-management access. |
| Transport | Read | View permitted transport information; this is not route-management access. |
| Medical alerts | Read alerts only | See limited condition flags (such as severe allergy, asthma, or epilepsy); not full clinic records. |
| Inventory requisitions | Read, create, update own requests | Raise and track your own requisitions; not manage stock or fulfill requests. |
| Weekly Student Snapshot | Read | Review the generated summary; correct underlying records in their owning module. |
| Growth Profile | Read, create, update | Add/update permitted student development records within your scope. |

**HR self-service:** staff can access their own leave and, when available, payslip views through HR/My HR even though HR management is not part of the standard Teacher module grants. **Behaviour, eLearning, Finance, Admissions, Settings, and full Medical/Inventory management are not standard Teacher grants.** A school can make an explicit extra grant; only follow those workflows when the module/action is actually available to you.

## 1. Sign in for the first time

1. Open the Msingi login link sent by your school administrator.
2. Enter your school email or username and the temporary password provided to you.
3. If prompted, set a new password before continuing. A temporary password is for first sign-in only.
4. After the dashboard opens, check that your name and school are correct. If you appear in the wrong school or cannot see your teaching work, stop and contact the administrator.

If you never received a login, ask the administrator to create or link your login account. An HR staff record and a login account are separate records; having one does not guarantee the other exists.

## 2. Complete your profile and password

### Update your profile

1. Open the avatar menu in the top-right corner and choose **My Profile**.
2. Update the personal fields available to you, such as name, phone, bio, address, qualifications, specialization, and next-of-kin information.
3. If you teach online, add your Zoom or Google Meet link under **Online Meeting Links** when that section is available.
4. Save each section and wait for the success message. Reopen the profile to confirm the saved values are still present.

Your profile does not control HR-only employment fields such as contract type, employment status, or payroll/tax identifiers. Ask HR to change those.

### Change your password

1. In **My Profile**, open the **Security** section.
2. Enter your current password, then enter and confirm your new password.
3. Use at least 8 characters and select **Save Password**.
4. Wait for the confirmation message. Keep the new password private and do not reuse a colleague's account.

If you have forgotten the current password, ask the school administrator to issue a temporary reset password. Sign in with that temporary password and set your own password when prompted. Current authentication code and the updated User Guide state a 90-day password age; follow the live prompt if the deployed system presents a different requirement.

## 3. Check your teaching setup before starting work

1. Open **Timetable** and verify the classes, subjects, rooms, and periods assigned to you.
2. Open **Classes** or the relevant module and confirm that your class and stream rosters look right.
3. Check that your assigned subjects appear in **Lessons** and in the Markbook.
4. If you are a class/form teacher, confirm your form-teacher assignment with the administrator. Teaching a subject and being a form teacher are different responsibilities.

If a class or subject is missing, ask the administrator to review the teaching assignment and your role/scope. If a student is missing only for an elective subject, ask whether that student has been enrolled in the elective; attendance and elective Markbook rosters can differ.

## 4. Take attendance

1. Open **Attendance**.
2. Select the correct class, stream, and date. Review the displayed roster before using a bulk action.
3. Mark each student **Present**, **Absent**, **Late**, or **Excused**, using the school's available options.
4. If using **Mark All Present** or **Copy Previous**, check each student's status afterward; these actions prefill a register and should not replace a roster review.
5. Select **Save Register** and wait for confirmation.
6. Reopen the register or review its class/date summary to confirm the saved statuses.

To correct an existing register, open that register and use its edit/correction action if your permission allows it. Do not create a second register for the same class and date. If the class or a student is absent, first check class/stream placement and your assignment.

## 5. Behaviour (only if your school grants it)

Behaviour is not part of the standard Teacher role. If your school has explicitly granted Behaviour access and the module appears in your menu:

1. Open **Behaviour → Incidents** and choose **Log Incident**.
2. Select **Merit** or **Demerit**, then choose the configured category and behaviour.
3. Select the correct student and incident date. Confirm the points displayed before submitting.
4. Add a factual note. A detailed note is required for higher-value incidents; follow the validation shown in the form.
5. Submit and confirm the incident appears in the register with the correct student, type, category, and status.

Use the original incident's edit/review action to correct a mistake if your role permits it. For an appeal or a serious incident, follow the school's pastoral and safeguarding process as well as the in-app workflow. Do not put unnecessary sensitive details in a broad message. If Behaviour is absent, do not treat that as a system error; ask an administrator whether your role should receive it.

## 6. Plan lessons and record coverage

1. Open **Lessons** and select the correct class and subject.
2. Select an existing topic or follow the school's workflow for adding syllabus topics. Topics can be class-specific.
3. Open lesson planning and choose the class, subject, date/week, and topic.
4. Complete the required objectives, activities, resources, and other fields shown in your school's template.
5. Save the plan. After teaching, use the separate coverage/delivered action when available.
6. Check the weekly or coverage view to confirm the plan or topic update appears.

If a required field or topic is missing, ask the administrator or curriculum lead to check the class curriculum and lesson-plan template. Do not re-create a plan before checking whether it is already present.

## 7. Enter marks in the Markbook

> **Current workflow:** Exams records the sitting; marks are entered in the Markbook. Do not use an old Exams → Results workflow if it is still mentioned in older instructions.

1. Open **Exams** and choose the **Markbook** tab.
2. Select the academic year and term, then the class and subject.
3. Select the assessment window/type and instance (for example, CA 1). Assessment windows and types are configured by an authorized administrator.
4. If you teach more than one stream for the selected class and subject, select the intended stream. Check the student roster before entering scores.
5. Enter each score using the scale shown by the school, or select the appropriate state such as **Absent**, **Missing**, **Exempt**, or **Incomplete**. Do not enter zero to mean absent or missing.
6. Select **Save All Marks**. Wait for the success message and check for any conflict warning; a conflict means another user changed one or more marks and the affected cells need review.
7. Reopen or refresh the same year, term, class, subject, stream, assessment, and instance to confirm the marks persisted.

The Markbook protects unsaved edits when you change selectors by asking before discarding them. Save first if you want to keep the entries. A published report card locks its marks; ask an authorized administrator about the correction/unlock process if a published mark is wrong.

### If a mark or student seems missing

- Confirm the academic year, term, class, stream, subject, assessment, and instance are all the ones used when the mark was entered.
- For an elective subject, confirm the student is enrolled in that subject.
- Confirm the assessment schedule exists and is visible for the selected period.
- If the mark was entered through an older Exams → Results screen, tell the administrator which screen and approximate date. Older results may need a reviewed migration into the current Markbook.
- Do not re-enter a whole class until an administrator has checked for existing records and migration conflicts.

## 8. Add subject comments and report-card remarks

### Subject-teacher comment

1. You need **Report Cards: Update** as well as the relevant subject/class assignment. The standard Teacher role has Report Cards read access only; ask the administrator to grant the required access if comments are part of your duties. In the Markbook, select the right class, student roster, subject, term, and assessment window.
2. If the **Comment** column is available, enter the comment for the student and use that row's **Save** action.
3. Wait for the saved confirmation. Mark saving and comment saving are separate actions; saving marks does not automatically save the comment.
4. Reopen the same class/subject/term view to confirm the comment is still displayed.

The school may disable the comment column for an assessment window, and your subject assignment/permissions determine which students you can update. The saved subject comment is for that student, subject, and term; it is not a separate comment for each assessment instance. If the column is absent or saving is rejected, ask the administrator to check the schedule's comment setting, your subject/stream assignment, and your Report Cards permission. If an old comment appears when starting the same term number in a new academic year, do not overwrite it until the administrator confirms the correct record; current draft comments are not yet keyed by academic year.

### Class/form-teacher remark and observation ratings

If you are the assigned form teacher and have **Report Cards: Update** access:

1. Open **Report Cards** and choose the correct class and term.
2. Open the student's report-card/comment editor.
3. Complete the class-teacher remark and any observation ratings enabled by the school.
4. Save and wait for a success message. If the system rejects the save, record the message and ask the administrator to confirm your form-teacher assignment for that stream.

Report-card publishing is a separate, higher-impact step and may be restricted to administrators or staff with a specific permission. Teachers should not assume that saving marks or comments publishes a report card. The administrator checks the preview and publishes the official report for the class/term.

## 9. Apply for leave

1. Open **HR** and choose **My Leaves** (some screens show this as the **Leave** tab).
2. Select **Request Leave**.
3. Choose the leave type offered by your school, enter the start and end dates, and provide the reason or supporting details requested.
4. Review the dates and submit the request.
5. Return to **My Leaves** to check its status and any approver comments. A school may use a multi-step approval chain; a request is not approved until the workflow shows its final approved status.
6. If the dates or reason are wrong, use an available edit/withdraw action or contact HR before submitting a duplicate request.

The **My HR/HR** navigation link is available to staff for self-service even when no HR management capability is granted (changelog v5.157.0). If the page itself fails to load or your request is missing, ask the administrator to check your account and staff linkage. Leave visibility is scoped by role: users see their own requests and may also see requests awaiting a workflow step assigned to them; a separately granted leave-view capability can show all requests. Leave balances and approval routing are managed by the school; do not treat a submitted request as approved leave.

## 10. Other useful teacher workflows

- **Messages:** use **Messages** to contact authorized staff or groups. Check the audience before sending and avoid sharing sensitive student details with a broad group.
- **Timetable changes or cover:** view your timetable; report corrections or request cover through the school's timetable/cover process. Do not edit a published school timetable unless you have that responsibility.
- **Growth Profile / student support:** use the relevant student record or Growth Profile workflow only where your role and student scope allow it. Record factual, appropriate information and follow the school's safeguarding process.
- **Online sessions:** save your meeting link in **My Profile → Online Meeting Links** before scheduling a session that uses your own Zoom or Meet link.
- **My Payslip:** if enabled, view your own payslips in HR. Payroll setup and other employees' records belong to authorized HR staff.
- **Events and resources:** use these when your school has enabled the module and granted access; follow the event/resource workflow rather than sending unapproved school-wide notices.

## 11. Other standard teacher modules

These modules are part of the standard Teacher permission baseline. The actions below describe the teacher-facing use; management actions remain restricted.

### Student, class, and staff information

Use **Students** to find a learner and review the profile information available to your account. Use **Classes** to confirm class/stream and roster details, and **Teachers** to look up permitted staff information. These are read-only grants in the standard role. If a learner is missing, first verify the year, class/stream, and assignment; do not create or reassign a record as a workaround.

### Assessment scheduling

The assessment area is embedded in the Grades/Exams experience. Open the schedule or assessment view available to you and confirm the correct year, term, type, and instance before using it. A schedule is school configuration: do not change weights, close/lock a live window, or alter a calendar unless the screen grants the action and the school has assigned you that responsibility. Use the Markbook section above for marks.

### Resources

Open **Resources** and check the title, class/audience, and link or attachment before sharing. Use the existing item to update a stale link when permitted; verify the intended audience can open it. Do not upload confidential student, HR, or medical information as a general resource.

### Library, hostel, and transport

Open **Library**, **Hostel**, or **Transport** only to view the information exposed to your role. The standard Teacher permission is read-only for these modules. Book issue/return, room assignment, route setup, and student transport changes belong to authorized library, hostel, or transport staff. Report a mismatch to them rather than trying to edit a roster or counter.

### Medical alerts

Where a student's record shows a medical alert, use it only to support safe care and only as needed. The standard Teacher grant exposes limited alert flags, not full clinic visits or treatment history. Contact the authorized medical staff for details or corrections; do not copy clinical information into Messages, Lessons, or general notes.

### Inventory requisitions

If **Inventory → Requisitions** is available, create a request for the needed item and quantity, provide the required reason, and submit it. Reopen **My Requisitions** (or the equivalent request list) to check its workflow status. Submission is not approval or fulfillment. The standard teacher grant does not authorize stock management or recording that stock has been issued.

### Weekly Student Snapshot

Open **Weekly Snapshot** to review the generated summary for the learners/classes visible to you. It is a read-only digest. If a value is wrong or outdated, correct or report the underlying attendance, learning, or other source record through its own module; do not try to edit the snapshot.

### Growth Profile

From the student record or **Growth Profile**, choose the relevant activity, award, project, or recommendation section available to you. Confirm the learner and date/period, enter factual details, attach only relevant evidence, save, and check the resulting verification/visibility state. Use Growth Profile for developmental evidence, not for grades, attendance, behaviour, or clinical records. Some categories and verification actions have separate restrictions.

## 12. End-of-task checklist

Before leaving a page, confirm:

- The correct school, year, term, class, stream, subject, date, and student were selected.
- You used the action that saves that specific item (attendance register, marks, comment, lesson plan, incident, or leave request).
- The application displayed success, and any rejected/conflicted item was resolved.
- A refresh or reopen shows the expected result.
- You did not publish a report, close a year, or make another administrative change unless authorized.

## If something is missing or fails

Send the school administrator the module, screen, school, class/stream, student, period, approximate time, and the exact error or screenshot. For marks/comments, say whether you saw a save confirmation and whether the item appears after reopening. Avoid sending passwords or student information through an unapproved channel.

## Related guides and maintenance notes

- [General User Guide](USER_GUIDE.md)
- [Teacher workflow module notes](module-flows/teachers.md)
- [Attendance](module-flows/attendance.md) · [Behaviour](module-flows/behaviour.md) · [Lessons](module-flows/lessons.md)
- [Grades & Marks](module-flows/grades.md) · [Exams](module-flows/exams.md) · [Report Cards](module-flows/report-cards.md)
- [HR Guide](HR_GUIDE.md) · [Timetabler Guide](TIMETABLER_GUIDE.md)
- [Developer Guide](DEVELOPER_GUIDE.md) for implementation and deployment changes

**Documentation reconciliation completed for this guide:** this guide's standard teacher-module list was checked against the teacher role defaults in `repairPermissions.js` and onboarding; grades/exams/report-card wording was checked against the current routes and changelog, including v5.193.0 comment-field protection and v5.194.0 student display correction. The User Guide password-rotation statement matches current authentication code. Other module-flow pages should still be checked against newer changelog entries when they are next revised.

**Sources checked:** `docs/USER_GUIDE.md`, `docs/HR_GUIDE.md`, the relevant `docs/module-flows/*.md`, `CHANGELOG.md` (through v5.194.0), `server/utils/repairPermissions.js`, `server/routes/onboard.js`, `server/routes/report-cards.js`, `client/src/pages/profile/ProfilePage.jsx`, `client/src/pages/exams/ExamsPage.jsx`, `client/src/pages/hr/HRPage.jsx`, and associated routes. HR self-service wording was reconciled with v5.154.0–v5.157.0 on 2026-10-16; teacher module grants and the guide coverage were rechecked on 2026-10-17.
