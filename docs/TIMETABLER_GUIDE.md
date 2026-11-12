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
10. [Working Days](#10-working-days)
11. [Locking a Lesson](#11-locking-a-lesson)
12. [Importing a Timetable](#12-importing-a-timetable)

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

## 10. Working Days

Click **Days** to choose the days lessons can go on. The default is Monday to Friday; tick **Saturday** if the school teaches on Saturdays. The grids, the day picker when adding a lesson, and the import all follow this setting.

Removing a day doesn't delete anything: lessons already on that day stay visible so you can move or remove them, and you're told how many there are.

---

## 11. Locking a Lesson

Open a lesson and tick **Lock this lesson** to pin it (assembly, games, a shared lab session). A locked lesson shows a padlock, and it can't be edited, moved or removed until you untick the box. Replacing a class's timetable in one go, or importing over it, leaves it alone. The automatic timetable generator planned for later will also plan around locked lessons.

---

## 12. Importing a Timetable

Click **Import** to load lessons from a spreadsheet (template provided, up to 500 rows). Each row goes through the same checks as adding a lesson by hand. A row is skipped, with the reason shown, if it would put a class, teacher or room in two places at once, is on a day that isn't a working day, or would overwrite a locked lesson. The other rows are still imported.

---

*Last reviewed: 2026-11-12 (v5.265.0) — checked directly against `client/src/pages/timetable/` and `server/routes/timetable.js`.*
