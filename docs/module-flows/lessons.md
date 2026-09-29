# Lessons

## Set up curriculum and coverage

1. Open **Lessons** and select the class/subject context.
2. Add or copy syllabus topics, then order them to match the teaching sequence. A topic is scoped to its class — the same subject taught to two different classes needs its own topics in each, unless the topic predates class-scoping and is shown to every class as a legacy fallback.
3. Teachers record coverage against the topic when taught; verify class/teacher selection before saving.
4. Use coverage summaries to identify topics not yet covered. Use the template settings only if authorized, since they affect lesson plans school-wide.
5. If the school has an existing term's lesson plans in a Word document, use the Import button (upload → review → commit) instead of re-typing them — it flags each row as ready, invalid, a duplicate, or a scheduling conflict before anything is saved, and requires its own `lessons__import` grant separate from plain create access. Only a real `.docx` or `.csv` file is accepted — a PDF, scan, or other format is rejected up front with a clear message rather than a generic error.
6. If cross-stream plan sharing is turned on for the school (off by default), a teacher can copy a colleague's plan for the same class/subject from a different stream as a starting point — this makes a copy, not a live shared link; editing one plan never changes the other.

## Create a lesson plan

1. Open the lesson-planning view and choose class, subject, date/week, and topic.
2. Enter objectives, activities, resources, and other fields required by the school's template.
3. Save the plan, then update or mark it delivered through its own action when the lesson has taken place.
4. Review pending/weekly summaries for plans that need attention.


## Setup, updates, and verification

### Set up curriculum and update plans

Confirm class, subject, teacher assignment, and timetable before adding syllabus topics. Order topics to match the approved teaching sequence and verify stream/class scope — a topic created for one class does not appear, and cannot be marked covered or planned around, from a different class. Configure lesson-plan required fields in the template before staff start the term; changing it can affect future submissions. When a lesson is taught, update its plan/coverage record and verify it appears in the weekly summary. If plans are missing, check teacher/class scope and template requirements before recreating data. Before running a document import, preview it first and resolve anything flagged invalid, duplicate, or conflicting — only rows explicitly submitted at commit are written.

**Access:** Lessons permissions apply, with separate template/configuration capability. Importing plans needs its own `lessons__import` grant. Class and teacher data must already be assigned. Student/parent class summaries expose only their permitted view.

**Sources:** `client/src/pages/lessons/LessonsPage.jsx`; `server/routes/lessons.js`, `lesson-plans.js`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.117.0–v5.117.5 for lesson plans, configurable templates, required fields, class scope, and timetable-aware reminders; v5.131.0 for document import and cross-stream plan sharing; v5.132.0 for the import's follow-up security fixes and the reminder dead-end fix; v5.135.0 for syllabus topics now being scoped per class, not shared across every class teaching the same subject; and v5.150.0 for uploading a non-.docx/.csv file (e.g. a PDF) now being rejected with a clear message instead of a generic server error.
