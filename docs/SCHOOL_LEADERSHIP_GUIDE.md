# Msingi — School Leadership Guide

**Audience:** Principals, Deputy Principals, and Section Heads using Msingi for school oversight. This guide covers common leadership review and decision workflows; it is not a substitute for the detailed specialist guides or the school’s governance policy.

## 1. Know your access level

Leadership titles do not all mean the same system authority. The current built-in defaults give Principals and Deputy Principals broad school-operation permissions across students, attendance, grades, exams, behaviour, timetable, admissions, lessons, resources, medical, inventory, and report cards. The Section Head default is narrower: many modules are read-only, with class/section scope and limited write access to lessons, messages, resources, and Growth Profile.

**A Principal/Deputy is not automatically a Superadmin.** School Settings, user/role grants, data backup, and platform-level controls are governed by their own permissions and should be assigned deliberately. Never assume access based on a title; the visible menu and action-level permission are decisive. A section head may see only the students/classes in their section.

## 2. Start with the dashboard

1. Sign in with your own account and check the school and role shown.
2. Review dashboard KPIs, alerts, current term/year, recent enrolments, upcoming events, and announcements.
3. Treat KPI cards as a prompt to inspect the owning module, not as the underlying source record.
4. If a dashboard figure conflicts with the source module, record the filter/date window and ask the module owner to reconcile it.

## 3. Review student and class information

1. Open **Students** and search by admission number or full name.
2. Confirm class, stream, section, active status, and the relevant student-profile tab.
3. Use the student-specific academic, attendance, behaviour, medical, or support record to review the source details.
4. For a missing or incorrect class/stream, check the placement in the student/class workflow and have an authorized staff member correct it there. Do not use a report or snapshot as the repair point.

Student medical/guardian information is sensitive. Access only the details needed for your responsibility and share through approved channels.

## 4. Monitor teaching, attendance, and curriculum

- **Attendance:** inspect the class/day register and any permitted exceptions; confirm the teacher has saved the correct register before asking for correction.
- **Curriculum and lessons:** review coverage/plans by assigned class and subject. A missing topic or curriculum item should be resolved in the curriculum/lesson workflow, not by duplicating plans.
- **Timetable:** view the published schedule and report conflicts to the Timetabler. Editing/publishing the full school timetable requires the relevant scheduling capability.
- **Weekly Snapshot:** use it as a generated digest. If an entry is wrong, correct the attendance, grade, behaviour, or other source record and wait for the snapshot refresh/process.

## 5. Review behaviour and pastoral cases

1. Open **Behaviour → Appeals** or the relevant incident view.
2. Confirm student identity, incident, evidence, and appeal reason.
3. Follow the school’s pastoral/safeguarding review route and use the decision/escalation action available to your role.
4. Record a concise, factual note and confirm the resulting appeal state.

Do not change an incident or point total solely to clear an alert. The Behaviour Officer Guide describes incident, appeal, stage, and reset workflows in detail.

## 6. Review marks and report cards

1. In **Exams → Markbook**, select the academic year, term, class, subject, stream where needed, assessment, and instance.
2. Check save/conflict status and investigate missing marks before requesting re-entry. The Markbook is the current source for assessment marks; older Exams → Results records are legacy and must be reconciled before migration.
3. Review draft comments through the Report Cards workflow. Subject comments and class/form-teacher remarks have distinct permissions and assignment rules.
4. Before publishing, confirm the class/term, marks, comments, grading settings, validation warnings, and report count.
5. Publish only if your role grants the publish action and school policy assigns you this responsibility. Publishing creates the report snapshot and locks relevant marks; post-publish corrections use the controlled correction/unlock process.

Refer to the [Exams Officer Guide](EXAMS_OFFICER_GUIDE.md), [Teacher Guide](TEACHER_GUIDE.md), and [Grades, Exams, and Report Cards flows](module-flows/README.md) for detailed steps.

## 7. Review admissions and enrollment

Use **Admissions** to review applications and pipeline status; use the Admissions Officer Guide for required fields, guardian information, and enrollment. Before marking an applicant enrolled, verify that the supported workflow has created/linked the correct student record. Check class, stream, and subject curriculum after enrollment. Do not create a second student to work around an incomplete application.

## 8. Manage staff responsibilities through the right authority

Use **Teachers/HR** and role-specific guides for staff details, leave, payroll, or teaching assignments. Do not share HR or payroll data beyond authorized staff. A Deputy/Principal may have some staff views but does not automatically inherit every HR capability or workflow-setting permission.

Settings → Roles & Permissions should be changed only by a user with the explicit authority. Grant the minimum capabilities needed, including any separate sensitive-action grant, then verify with the target role. Avoid using a shared administrator login.

## 9. Communicate decisions

Use **Messages** or the approved school communications process. Confirm the target audience before sending, especially for a class-wide or school-wide notice. Keep student health, discipline, and family details out of broad messages. Parent-to-school messaging uses server-resolved staff categories; never instruct parents to message another parent or share a private staff contact list.

## 10. High-impact actions: check before confirming

Before publishing reports, deleting records, resetting behaviour points, changing grades, altering school roles, changing student placements, updating fees, or changing student medical data:

1. Verify the school, student/class/term, and selected record.
2. Check whether the operation is reversible and whether it has an audit/history record.
3. Confirm the business approval and supporting evidence.
4. Explain the impact to affected staff/families where policy requires it.
5. Reopen the record after saving and confirm the expected status and downstream result.

## 11. What requires School Admin or Platform Admin

- **School Admin/Superadmin:** school setup, user and role administration, school settings, academic-year transitions, backup/export, and other settings available only to those permissions.
- **Platform Admin:** subscription/platform operations and cross-school service controls using separate platform authority.
- **Module specialist:** Finance, HR, Admissions, Exams, Timetabling, Behaviour, Medical, Transport, Hostel, Inventory, and Library operators should use their dedicated guides.

Escalate access or settings changes to the appropriate authorized person instead of using another account.

## Leadership review cadence

- **Daily/weekly:** attendance exceptions, serious behaviour/safeguarding escalation, upcoming exams/events, open admissions, and timetable/coverage issues.
- **Before report publication:** Markbook completeness, comments, validation, term/class selection, and publication authorization.
- **Term/year transition:** class/stream placement, curriculum/subject enrollment, staff assignments, behaviour reset process, report-card policy, and approved backup/recovery checks.

Use each module's own records as the source of truth and record follow-up decisions through the appropriate workflow.

**Sources checked:** `server/utils/repairPermissions.js`, `server/routes/onboard.js`, `server/config/moduleRegistry.js`, dashboard and leadership-facing module flows, `docs/SCHOOL_ADMIN_GUIDE.md`, `docs/PLATFORM_ADMIN_GUIDE.md`, `docs/EXAMS_OFFICER_GUIDE.md`, and `CHANGELOG.md` through v5.194.0. Relevant changes include v5.113.0 (teacher scope), v5.177.0 (publish-time mark locking), v5.190.0 (stream assignment integrity), and v5.193.0 (comment field protection). Checked 2026-10-18. Actual grants may be customized by each school.
