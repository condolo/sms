# eLearning

## Connect and schedule a session

1. A teacher first saves a Zoom or Google Meet link in **Profile → Online Meeting Links**.
2. Open **eLearning → Online Sessions**, choose the class/student/parent audience, platform, date, time, duration, and title.
3. Confirm the displayed meeting link and passcode, then schedule. The flow may also create a calendar event.
4. Review upcoming and past sessions; cancel a future session through the provided cancel action so linked calendar data can be updated.

## Assignments (native)

Assignments do not need a Google account. Open **eLearning → Assignments**, choose **New assignment**, then pick the class, subject, due date and points. The subject list is the class's own curriculum, and the server only accepts a class+subject the teacher actually holds.

1. The assignment is published immediately unless a future publish time is set. Students in that class see it on the web student portal (**My assignments**) and in the mobile app; parents see it on the parent portal.
2. A student opens the card, types an answer and submits. One attempt is kept; the teacher can grade it, after which the student cannot resubmit.
3. The teacher opens the assignment to see the full roster — submitted / not submitted / graded — and saves a score per student. Feedback is shown to the student with the grade.
4. Deadlines are enforced on the server in the **school's timezone**, at submission time. Use **Accept late submissions** if work may still come in after the due time; leave it off for a hard deadline. A graded submission cannot be resubmitted.
5. If the assignment was linked to an **assessment window** (the optional "Feeds Markbook" field), the score is written to the Markbook as an unpublished mark and follows the same locks and publish flow as a typed mark. If the window is locked, the grade is kept on the assignment and the reason appears under the amber "could not reach the Markbook" banner.

**Access:** staff need the eLearning grant (`read` to view, `create` to issue, `update` to grade); the canonical teacher role now includes these. A subject teacher only sees their own class+subject pairs; a class teacher sees every subject in their class. Students are self-scoped to their own class.

## Google Classroom content

Connect the school's Google Classroom integration before using course links. Select a course, create classwork/material using the form, and verify it in Classroom. Deletion may affect the external Classroom item, so confirm before proceeding.


## Setup, updates, and verification

### Configure integrations and maintain content

Before scheduling sessions, have each teacher save a usable meeting link in Profile and verify any Google Classroom connection. Test the selected class/audience, timezone, date, and link with an authorized user before sending invitations. If a session changes, edit or cancel it from its originating session record so linked calendar data stays consistent. For Classroom content changes, confirm the course and external item before editing or deleting; verify the change in Classroom as well as Msingi.

**Access:** eLearning permissions govern viewing, content creation/editing/deletion, and enrollment. External Google/Zoom credentials and provider availability are prerequisites for the corresponding integrations.

**Sources:** `client/src/pages/elearning/ELearningPage.jsx`; `server/routes/elearning.js`; [User Guide](../USER_GUIDE.md#11b-elearning--online-sessions-standard-plan).; [CHANGELOG.md](../../CHANGELOG.md)
