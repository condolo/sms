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

## Teacher routines that keep family information current

Parents get the most useful view when teachers save the underlying school records promptly and consistently. Parent visibility still depends on the school's enabled modules and account setup. In particular, parents see published report cards rather than live, in-progress Markbook entries; routine work should not be described to families as immediately visible if the portal does not expose it yet.

### Daily

- **Check today's work:** review your timetable, assigned class/stream, announcements, and messages. Report an incorrect assignment or missing class to the administrator instead of entering records against a different class.
- **Take attendance:** complete and save each assigned register on the day of the lesson. Review the roster and statuses before submitting; reopen the saved register to check it if something looks wrong. This keeps the parent's attendance view current after the school's normal data refresh.
- **Record teaching progress:** use the lesson plan and coverage workflow for the class and subject. Mark the topic or lesson delivered after teaching, and verify it appears in the coverage view. Parent portal curriculum coverage is based on the school's recorded teaching progress.
- **Record relevant learner information:** where your role allows it, enter a factual behaviour record or growth-profile evidence promptly and in the correct student's record. These modules are not granted to every teacher by default; follow the school's safeguarding and confidentiality rules.
- **Communicate carefully:** read and respond to school or family messages through the approved channel available to your role. Check the recipient/audience before sending and do not place sensitive student information in a broad message.
- **Enter marks when due:** follow the assessment schedule. Do not create unofficial daily marks or use a different year, term, class, stream, subject, or assessment instance to make a record appear.

### Weekly

- Review your assigned attendance registers for missing dates, obvious status errors, or unresolved corrections. Fix the original register where permitted; tell the administrator when a correction needs elevated access.
- Review lesson plans and syllabus coverage for the week. Update delivered topics and resolve plans still marked pending if the lesson took place.
- Check messages and follow up on items that need a response. Use approved school communication practices and keep a concise record in the relevant school workflow where one exists.
- Review relevant behaviour and growth-profile entries for accuracy, correct student, date, and appropriate detail. Add information only where it is useful and within your role.
- If your school uses **Weekly Snapshot**, keep its source records accurate. The parent-facing weekly summary is generated automatically on the school's schedule (the current Parent Guide describes Saturday generation); teachers do not edit the snapshot itself. Correct source attendance, coverage, behaviour, or other records in their own modules.

### Each term and reporting cycle

- Check the academic year, term, class, stream, subject, and assessment instance before entering results. Follow the published assessment schedule and use explicit states such as Absent, Missing, Exempt, or Incomplete where appropriate.
- Save marks and comments separately, then reopen the same Markbook selection to verify both. Report-card publication locks marks and comments. If a published value needs correction, use the school's authorized administrator correction/unlock process; do not overwrite a locked record or promise that a draft is already visible to parents.
- Complete class/form-teacher remarks and any configured observation ratings if you are the assigned form teacher and have the required Report Cards access. Save and confirm the result before the school administrator or authorized publisher releases the cards.
- Review lesson coverage and any permitted Growth Profile evidence for the term, so parents receive a useful picture of learning progress as well as final grades. Report missing or inconsistent student/class records before publication.
- For Kindergarten, use the configured template's scoring mode: numeric with optional bands, or band-only. Add this term's indicators in the Markbook, score each child, and check the report preview. Band-only subject and overall grades follow the configured band-point rules; follow the separate [Kindergarten Teacher Guide](KINDERGARTEN_TEACHER_GUIDE.md).

These are working routines, not a requirement to create a record when nothing happened. Follow your school's assessment calendar, communication policy, safeguarding requirements, and role permissions. The parent-facing view and its update timing are described in the [Parent Guide](PARENT_GUIDE.md).

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

### Importing a term's lesson plans from a Word document instead of retyping them

If you already wrote the term's lesson plans in a Word document (a completed version of your school's own lesson-plan template), you can import it instead of retyping every lesson by hand. This needs its own **Import** permission — ask an administrator if you don't see the **Import** button next to **New Lesson Plan**.

**Before you upload:**

1. **Pick the right class, subject, academic year, and term in the Import dialog itself, every time.** This is the single most important step: Msingi files every imported lesson under whatever class/subject/term you select in the dropdowns — it does **not** read the class or subject off the document and file it there automatically. If you select the wrong class, the lessons import under the wrong class even if the document itself correctly says "Year 6" at the top. Double-check your selection before uploading.
2. **Use a real `.docx` file exported from Word** (or a `.csv` — see below), not a PDF, a scan, or a photo. Anything else is rejected immediately with a clear message rather than a confusing error.
3. **Each lesson in the document needs the same label structure your school's template already uses**, specifically:
   - A row whose first cell is literally **TEACHER** (this is how Msingi finds where each lesson starts — it doesn't matter if your document puts every lesson in its own table, or stacks several lessons' rows inside one table).
   - The next row down must have a **DATE** cell. **This must contain an actual calendar date for that specific lesson** — for example `3 September 2026`, `1st September`, or `03/09/2026`. Do **not** leave it as just a lesson number or week number (e.g. a bare `2`) — Msingi cannot tell that apart from a typo and will reject that lesson with an explanation rather than guess.
   - A row whose first cell says **Lesson**, with column headers for Topic/Subtopic, Objectives, Activities, Resources, and Remarks (your school can label and reorder these columns however it likes — Msingi matches them by keyword, not position), followed by one row of actual lesson content underneath.
   - If your template has a **DIFFERENTIATION** row (Low/Middle/High Ability, or similarly named), Msingi reads those by their own column headers too.
   - **ASSESSMENT** and **HOMEWORK**/**LESSON-WEEK ASSIGNMENT** rows, if your template has them.
4. **The TEACHER / CLASS / SUBJECT text written in the document itself is for your own reference only** — it is not what Msingi uses to decide where the lesson goes (step 1 does that). If your document happens to repeat one of these fields twice with two different values (a common copy-paste slip when a template is reused week to week), you'll see a yellow "Conflicting values" warning on the preview screen — it's safe to proceed; Msingi always uses the first value it found and tells you so.

**The import itself:**

5. Open **Lessons**, drill into the class/subject (and stream, if relevant), and click **Import**.
6. Select the academic year and term the document covers, then choose the file.
7. Click **Read Document**. Nothing is saved yet at this point.
8. Review every lesson on the preview screen. Each one is labeled **Ready**, **Invalid** (with the specific reason — fix the document and re-upload if needed), **Already Imported** (a safe no-op if you're re-running the same file), or **Conflict** (an existing plan for that date has different content — review it before deciding whether to include it).
9. Only rows you tick are imported — invalid and already-imported rows are unticked and can't be ticked. Click **Import N Lessons** to finish.

**If every lesson in your document comes back invalid with a date error:** this almost always means the DATE cell in your document isn't formatted the way Msingi expects (see step 3 above) — check what's actually typed in that cell for one lesson, fix it in Word, and re-upload. You do not need to retype the whole document; only the file needs correcting, then you can re-run the same import.

**CSV alternative:** if you'd rather prepare a spreadsheet than use the Word template, export a `.csv` with one row per lesson and a header row using these column names: `Date`, `Topic` and `Subtopic` (or a combined `Topic/Subtopic` column), `Objectives`, `Activities`, `Resources`, `Remarks`, `Low Ability`/`Middle Ability`/`High Ability`, `Assessment`, `Homework`. The `Date` column is required — a `.csv` with no `Date` column is rejected immediately; every other column is optional. Column names are matched by keyword and aren't case-sensitive.

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

### After a Mid-Term report: entering HW 2, CA 2 and the End-Term exam

Many schools set homework (HW) and continuous assessment (CA) more than once a term and publish a Mid-Term report before the End-Term one.

- The assessment schedule decides which report each assessment is on. The Mid-Term report covers what is scheduled up to the end of the Mid-Term exam window, for example HW 1, CA 1 and MT. Publishing it locks only those, and their columns show **Locked**.
- HW 2, CA 2 and ET stay open, even if you entered some marks early. Select the same HW (or CA) assessment, fill in the **HW 2** column, and select **Save All Marks**. The locked HW 1 column is left as it is. Marks are saved even if the assessment window shows **Deadline passed**; that badge is a reminder, not a lock.
- The End-Term report covers the whole term: it averages HW 1 with HW 2, and CA 1 with CA 2, then applies the school's weights together with MT and ET.
- If a locked mark is wrong, don't re-enter it under another instance. Ask an authorized administrator for a correction unlock.

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

The school may disable the comment column for an assessment window, and your subject assignment/permissions determine which students you can update. The saved subject comment is for that student, subject, and term; it is not a separate comment for each assessment instance. If the column is absent or saving is rejected, ask the administrator to check the schedule's comment setting, your subject/stream assignment, and your Report Cards permission. If an old comment appears when starting the same term number in a new academic year, do not overwrite it until the administrator confirms the correct record; current draft comments are not yet keyed by academic year. **After the report card is published, its comments are locked along with its marks.** Only an authorized administrator can unlock a published comment, with a recorded reason; it is automatically re-locked after the correction window. Finish and verify your comment before publication.

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

**Documentation reconciliation completed for this guide:** the standard teacher-module list was checked against the teacher role defaults in `repairPermissions.js` and onboarding; daily, weekly, and termly routines were reconciled with the current teacher workflows and parent-facing data described in `PARENT_GUIDE.md`. Grade, exam, report-card, and Kindergarten guidance was checked against current routes and changelog entries through v5.212.0, including v5.201.0 comment locking at publication, v5.203.0 teacher-owned Kindergarten indicator definitions, v5.207.0 band-only scoring, and v5.208.0–v5.209.1 draft report preview/print options. The User Guide password-rotation statement matches current authentication guidance. Other module-flow pages should still be checked against newer changelog entries when next revised.

**Sources checked:** `docs/USER_GUIDE.md`, `docs/PARENT_GUIDE.md`, `docs/HR_GUIDE.md`, relevant `docs/module-flows/*.md`, and `CHANGELOG.md` through v5.212.0; `server/utils/repairPermissions.js`, `server/routes/onboard.js`, `server/routes/report-cards.js`, `server/routes/attendance.js`, `server/routes/lessons.js`, `server/routes/weekly-snapshots.js`, `client/src/pages/profile/ProfilePage.jsx`, `client/src/pages/exams/ExamsPage.jsx`, `client/src/pages/hr/HRPage.jsx`, and related routes. HR self-service wording was reconciled with v5.154.0–v5.157.0; this guide's daily/weekly/termly routines were updated on 2026-10-26.
