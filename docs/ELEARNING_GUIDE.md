# Msingi — eLearning Guide

**Audience:** Teachers and coordinators using Google Classroom, Google Meet, Zoom, online sessions, and the student-facing learning views.

**Important:** eLearning is a separate permission/module and external-service setup. It is not automatically available to every Teacher-role account. Google/Zoom access and school settings also apply.

## 1. Know the two kinds of learning workflow

1. **Google Classroom coursework** links a Msingi class/subject to a real Google Classroom course. Classwork, people, and Google Classroom grades are managed through that linked external course.
2. **Online Sessions** schedules a live meeting through a teacher's saved meeting link or the connected Meet/Zoom integration. A scheduled session may also appear in the school calendar and student portal.

These workflows are related but not interchangeable. Google Classroom grades do **not** automatically write Msingi Markbook marks. The current code explicitly blocks Google Classroom-to-Markbook grade writes because it cannot safely map external Google accounts/coursework to Msingi student records (CHANGELOG v5.168.0). If a school wants those marks in Msingi, an authorized teacher must verify the student/assessment and enter them through **Exams → Markbook**.

## 2. Connect an external account

### Google Classroom

1. Open **eLearning** and select **Connect Google Classroom** / sign in with Google.
2. Use the school's approved Google Workspace for Education account and review the access prompt.
3. Return to Msingi and check the connected account/email status.
4. If you connected the wrong Google account, use the authorized disconnect/reconnect workflow and ask the administrator before changing a school integration.

### Google Meet or Zoom

- For teacher-link sessions, first open **My Profile → Online Meeting Links** and save the correct personal Zoom/Meet URL and passcode where applicable. Test the link with an authorized colleague.
- For the integrated Meet flow, connect the Google Workspace account when prompted and confirm the Meet integration status.
- For Zoom integration, the platform administrator must configure Zoom credentials. If Zoom is not configured, teachers cannot fix it by changing the session form; contact the system administrator.

## 3. Link a Google Classroom course

1. In **eLearning**, choose **Link a course**.
2. Select a course returned from your connected Google account.
3. Match it to the correct Msingi class and subject and confirm the mapping.
4. Save and confirm the course appears in the left course list with the correct external course, subject, and class.

Before linking, confirm you have chosen the right Google course; a mistaken mapping can direct classwork to the wrong students. Unlinking removes the Msingi link but, according to the UI confirmation, leaves the external Google Classroom course in place.

## 4. Create and manage classwork

1. Select the linked course and open **Classwork**.
2. Choose **Create Classwork**.
3. Select the appropriate type (Assignment, Question/Short Answer, Quiz/Multiple Choice where supported, or Material).
4. Enter title/instructions and any due date or attachment/resource details shown.
5. Review the course, classwork type, student audience, and due date, then submit.
6. Confirm the item appears in the course and, when applicable, verify it in Google Classroom.

Use the item's own delete action only after confirming the course and item. Deleting classwork may delete the corresponding external Google Classroom item; it is not simply hiding a card in Msingi. For corrections, prefer editing the external item when the supported workflow allows it.

## 5. Review people, coursework, and grades

1. Select the course, then open **People** or **Grades**.
2. Confirm the external course and roster before using any student-level detail.
3. Review submissions/classwork through the linked course's supported views.
4. Use Google Classroom to verify any grades or classwork updates sent to that service.
5. If those results must be part of official Msingi reporting, separately enter/verify them in Msingi **Exams → Markbook** using the exact academic year, term, class, subject, assessment, and instance.

Do not tell students that posting a Google Classroom grade has updated their Msingi report card. It has not unless the score was separately recorded in the Markbook and included in the relevant report-card process.

## 6. Schedule an online session

1. Open **eLearning → Online Sessions** (or the Meet/Zoom view available to you).
2. Choose **Schedule Session**.
3. Select the correct class/course or permitted audience. If scheduling from a linked course, confirm the associated subject and class.
4. Select Meet or Zoom, enter title, date/time, duration, and agenda as requested.
5. Confirm a meeting link is available. The teacher-link flow uses the link saved in My Profile; integrated Meet/Zoom may create or resolve the meeting through the connected provider.
6. Review time zone, audience, course, and link/passcode, then schedule.
7. Confirm the session appears in **Upcoming** and check the related calendar entry if the flow created one.

Use **Edit** or **Cancel** on the original session if plans change. This keeps linked calendar/session records consistent. Do not manually create a duplicate school event for a session that already created a calendar item.

## 7. Join a session as a student

1. Sign in to the Student Portal and check the relevant online session/timetable/dashboard entry.
2. Confirm the class, date, and time.
3. Use the **Join** control at the right time and enter any passcode provided by the teacher.
4. Contact the teacher through the school channel if no link appears or the provider denies access.

Emergency Online Learning Mode may expose scheduled teacher links through the student timetable. This depends on the school setting and a valid teacher meeting link; it does not create a meeting automatically.

## 8. Cancel, unlink, or disconnect safely

- Cancel a live session from its original session record and confirm it is marked cancelled; check the calendar view for expected follow-up.
- Unlink a Google Classroom course only after confirming the course mapping. The course itself remains in Google Classroom, but the Msingi link is removed.
- Disconnect Google only when authorized and when you understand which account/course/session features rely on it. Reconnect and confirm the intended account before resuming work.
- Avoid deleting external coursework to correct an unrelated Msingi Markbook issue.

## Troubleshooting

| Issue | Checks |
|---|---|
| eLearning is missing | Check the specific eLearning permission, plan access, and school module setting. |
| Google course list is empty | Check the connected Google email, Workspace access, teacher account/course membership, and Google Classroom integration status. |
| Course is linked to wrong class/subject | Stop posting new work; ask the eLearning administrator to verify mappings and correct/unlink through the supported workflow. |
| Classroom score missing from Msingi Markbook | This is expected; Google Classroom grade sync into Markbook is not implemented. Verify the student and enter the official mark in Markbook. |
| Meet/Zoom link is blank | Check the teacher's My Profile meeting link, connected account/provider status, and Zoom platform configuration. |
| Session appears twice on the calendar | Check whether a linked eLearning session already created the event; correct/cancel from the source session instead of adding more duplicates. |
| Students cannot join | Confirm session audience, date/time/timezone, link validity, class membership, and student portal access. |

**Sources checked:** `client/src/pages/elearning/ELearningPage.jsx`, `server/routes/elearning.js`, `client/src/pages/profile/ProfilePage.jsx`, `docs/module-flows/elearning.md`, `docs/USER_GUIDE.md`, and `CHANGELOG.md` through v5.194.0. Relevant changes include v4.26.0 (Google Classroom/Meet/Zoom), v4.31.0 (sessions, calendar, emergency mode, student join buttons), and v5.168.0 (Markbook consolidation; Classroom-to-Markbook writes are blocked). Checked 2026-10-18. External provider capabilities depend on school integrations and Google/Zoom accounts.
