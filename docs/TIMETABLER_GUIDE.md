# Msingi — Timetabler Guide

> **Audience:** Staff assigned the **Timetabler** role. Covers building the class timetable, rooms, cover/substitution, bell schedules, and conflict detection. Every plan includes the full Timetable module — access here is a role permission, not a subscription tier (see the School Administrator Guide, §9).

---

## Table of Contents

1. [What You Can Access](#1-what-you-can-access)
2. [Views](#2-views)
3. [Adding and Editing Slots](#3-adding-and-editing-slots)
4. [Conflict Detection](#4-conflict-detection)
5. [Bell Schedules](#5-bell-schedules)
6. [Rooms](#6-rooms)
7. [Cover / Substitution](#7-cover--substitution)
8. [Publishing](#8-publishing)
9. [Lessons to Place](#9-lessons-to-place)
10. [Days & Rules](#10-days--rules)
11. [Locking a Lesson](#11-locking-a-lesson)
12. [Importing a Timetable](#12-importing-a-timetable)
13. [Teacher Availability](#13-teacher-availability)
14. [Lessons per Week, Double Lessons and Room Types](#14-lessons-per-week-double-lessons-and-room-types)
15. [Generating a Timetable Automatically](#15-generating-a-timetable-automatically)

---

## 1. What You Can Access

The **Timetabler** role has full access (view, create, update, delete) to **Timetable**, plus read/create/update on **Classes**, view-only on **Teachers**, full create/update/delete on **Events**, and messaging access. You do not have access to Grades, Exams, Finance, or HR by default.

The Timetable module has six views: **Class Grid, Lessons to place, Teacher View, Institution, Rooms, Cover/Subs** (Rooms and Cover/Subs are shown to Timetabler and Admin roles only).

---

## 2. Views

- **Class Grid** — the weekly grid for one class at a time: every period, every day, editable directly.
- **Lessons to place** — see §9.
- **Teacher View** — the same grid, but for one teacher across all their classes — read-only, for checking a teacher's own load.
- **Institution** — a school-wide overview across every class at once.
- **Rooms** — see §6.
- **Cover/Subs** — see §7.

---

## 3. Adding and Editing Slots

From **Class Grid**, click an empty period to add a slot, or click an existing one to edit it. Set the subject, teacher, and room. The system checks for conflicts as you save (see §4) — a slot that would put a class, teacher or room in two places at once is refused, with the reason. Saving a lesson without changing its class, day, period, teacher or room (for example, only locking it) is never refused because of an older clash elsewhere.

---

## 4. Conflict Detection

The toolbar always shows a live conflict count — **"No conflicts"** in green, or **"N conflicts"** in amber/red if any exist. Click it to open the Conflicts panel and see exactly which slots clash (a teacher scheduled in two places at once, a room double-booked, etc.) so you can resolve them before publishing.

---

## 5. Bell Schedules

Click **Bell** to define the actual period times each day maps to (start/end time per period). Most schools run one standard schedule for all classes, but a class or section can have its own custom schedule where needed — shown with a small dot marker in the list.

---

## 6. Rooms

Go to **Rooms** to maintain your school's room registry (name, capacity, type) — this is the same list that populates the room dropdown when adding a slot, and it's also viewable per-room via **Room View**, which shows what's scheduled in each room across the week so you can spot idle or over-booked spaces. A room can't be booked for two lessons at once: adding, editing, bulk saving and importing all refuse it. Clashes left over from before this check show in red.

---

## 7. Cover / Substitution

Go to **Cover/Subs** for the substitution sheet — when a teacher is away, assign a covering teacher to their affected slots for that day without permanently editing the timetable itself. Each substitution is tracked against its own version/term, so history isn't lost.

---

## 8. Publishing

Once the timetable for a term is finalized, click **Publish Now** from the Publish Timetable dialog. Publishing makes the current version visible to teachers, students, and parents on their own dashboards — draft changes made after publishing don't show up for them until you publish again.

---

## 9. Lessons to Place

The **Lessons to place** tab is your checklist. For every class (or stream) and subject it shows:

| Column | Meaning |
|---|---|
| **Needed** | Lessons per week, from the teacher's assignment (Teachers → a teacher → Assignments → **Periods/wk**). Two teachers sharing a class and subject are added together. |
| **Placed** | Lessons for that subject on the draft timetable this academic year. A whole-class lesson counts for every stream. |
| **To place** | What's left. |
| **Status** | **To place**, **Too many**, **Done**, or **No target** (no Periods/wk set, so it can't tell). |

- Filter by status, or switch to **By teacher** to see each teacher's total load against their placed lessons.
- Click a row to open that class's grid.
- **On the timetable, but no teaching assignment** lists lessons nobody's assignment asks for — add the assignment, or check the subject name matches.

The list is only as good as the assignments: set **Periods/wk** on every assignment first.

---

## 10. Days & Rules

Click **Days & rules**.

**Working days.** Choose the days lessons can go on. The default is Monday to Friday; tick **Saturday** if the school teaches on Saturdays. The grids, the day picker when adding a lesson, and the import all follow this setting.

Removing a day doesn't delete anything: lessons already on that day stay visible so you can move or remove them, and you're told how many there are.

**Rules.** How a good timetable looks. The automatic timetable (coming next) follows them; editing by hand is never blocked. Each rule can be switched off.

| Rule | Default |
|---|---|
| Most lessons a teacher teaches in a day | On, 6 |
| Most times a class has the same subject in a day (a double counts once) | On, 1 |
| Keep each teacher's lessons together, with few free periods in between | On |
| Spread each subject across the week | On |
| Put chosen subjects in the morning where possible | Off (pick the subjects) |
| Use each teacher's preferred room when it's free | On |

A teacher over the lessons-a-day limit shows as a **rule warning** in the publish bar and the Publish window (with teachers marked unavailable, §13). Publishing still goes ahead.

---

## 11. Locking a Lesson

Open a lesson and tick **Lock this lesson** to pin it (assembly, games, a shared lab session). A locked lesson shows a padlock, and it can't be edited, moved or removed until you untick the box. Replacing a class's timetable in one go, or importing over it, leaves it alone. The automatic timetable generator planned for later will also plan around locked lessons.

---

## 12. Importing a Timetable

Click **Import** to load lessons from a spreadsheet (template provided, up to 500 rows). Each row goes through the same checks as adding a lesson by hand. A row is skipped, with the reason shown, if it would put a class, teacher or room in two places at once, is on a day that isn't a working day, or would overwrite a locked lesson. The other rows are still imported.

---

## 13. Teacher Availability

In **Teacher View**, pick a teacher and click **Availability**. Tick the periods the teacher can't teach, or **Whole day** for a day off (part-time staff, a regular commitment elsewhere). Add a note if useful, then **Save**. The toolbar then shows, for example, "Not available: Mon all day · Fri 07:30–08:30".

Times are saved as clock times, so one entry works for every section's bell schedule. The automatic timetable will keep these times free. If a lesson already sits in an unavailable time, it shows as a rule warning, never as a block.

---

## 14. Lessons per Week, Double Lessons and Room Types

These are set outside the Timetable module, and both the **Lessons to place** list and the automatic timetable read them:

- **Periods / Week and Double lessons** — Teachers → a teacher → **Assignments**. Set them when adding an assignment, or hover an existing one and click the pencil to change them. Each double lesson uses two of the week's periods, so 5 periods with 1 double means one double and three singles. Assignments with no periods set show "periods/wk not set".
- **Room needed** — Subjects → edit a subject → **Room needed** (Lab, Hall, Sports ground, Library, Classroom, Other, or Any room). For example, set Chemistry to Lab. Make sure the rooms themselves have the right type under **Rooms**.

---

## 15. Generating a Timetable Automatically

**Timetable → Generate** builds a section's timetable (or chosen classes') for you, from the teaching assignments.

**Before you start:** set **Periods / Week** (and double lessons) on the assignments you want placed (section 14), mark rooms with their type and subjects with the room they need, enter teacher availability (section 13), and check **Days & rules** (section 10). Lock any lesson that must stay exactly where it is (section 11).

1. Choose **A section** (recommended) or **Chosen classes**, then click **Check**. You'll see:
   - how many lessons will be placed;
   - how many unlocked draft lessons of those subjects will be replaced;
   - how many other lessons (subjects with no periods per week set) stay where they are;
   - anything that can't fit. Red means part of the timetable won't fit, for example a teacher needs more lessons than they have free periods, a class needs more lessons than it has periods, or no room of a needed type exists. Amber means worth knowing, for example assignments left out because they have no periods per week.
2. Click **Generate** (or **Generate anyway** if there are red items: it places everything it can). It takes up to about 10 seconds.
3. Check the result:
   - how many lessons were placed, and how many times a rule had to be bent (a teacher over their daily limit, a subject twice in a day, gaps in a teacher's day);
   - every lesson it couldn't place, with the reason;
   - a preview of each class's week (purple = double lesson).
4. Click **Apply to draft**, then confirm. This replaces the unlocked draft lessons of the subjects it placed, in those classes only.
   - Locked lessons stay.
   - Lessons of subjects with no periods per week stay.
   - Other sections stay.
   - Nothing reaches teachers, students or parents until you **Publish** (section 8).
5. Changed your mind? Under **Recent runs**, **Undo** removes the generated lessons and puts the replaced ones back. Only the most recently applied run can be undone, and undo also removes any generated lesson you edited by hand after applying.

If applying fails part-way (for example a connection drop), the draft is put back as it was and you see "Applying failed, so nothing was changed". Just try again.

**What it never breaks:**
- a class, teacher or room is never in two places at once (a whole-class lesson blocks every stream);
- a teacher is never placed in a time they marked unavailable;
- a subject that needs a lab (or other room type) only gets a free room of that type that is big enough for the class;
- a double lesson always uses two back-to-back periods with no break between them.

If one of these can't be met, the lesson is left unplaced and listed with the reason, rather than placed wrongly.

**Option subjects (electives).** A subject that isn't compulsory for a class (Classes → subjects, "compulsory" unticked) is an option. Its students come from any stream and are the ones enrolled in it under Students → Subjects.
- **The generator schedules each option as one group**, once, even if its assignment was entered once per stream.
- **Two options can run in the same period** (an option block, e.g. Physics | History | Business) when no student takes both. Before this, you couldn't put two lessons of one class in the same period at all, even by hand. Now adding a lesson, bulk save and import all allow it under the same rule.
- **An option never runs beside a whole-class lesson**, nor beside a stream lesson that any of its students are in.
- **If nobody is recorded as taking an option**, Check warns you. The generator then keeps that option apart from every other lesson of the class, so it can never put a student in two places. Enrol students in their options first to get proper option blocks.

**What it tries to follow** (from Days & rules): a teacher's most lessons per day, a subject at most N times a day, no gaps in a teacher's day, subjects spread across the week, chosen subjects in the morning, preferred rooms.

**If the timetable changed after you generated** (for example someone added a lesson in another section that now clashes), **Apply** is refused with the reason. Generate again.

**Who can use it:** the scheduling roles (Admin, Principal, Deputy, Timetabler), or a role that has both **Manage Whole-School Timetable (Admin Console)** and **Generate Timetable (automatic)** ticked under Settings → Roles & Permissions → Timetable.

---

*Last reviewed: 2026-11-12 (v5.269.1) — checked directly against `client/src/pages/timetable/`, `server/routes/timetable.js`, `server/routes/timetable-generate.js` and `server/utils/elective-groups.js`.*
