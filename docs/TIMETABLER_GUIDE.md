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

---

## 1. What You Can Access

The **Timetabler** role has full access (view, create, update, delete) to **Timetable**, plus read/create/update on **Classes**, view-only on **Teachers**, full create/update/delete on **Events**, and messaging access. You do not have access to Grades, Exams, Finance, or HR by default.

The Timetable module has five views: **Class Grid, Teacher View, Institution, Rooms, Cover/Subs** (the last two are shown to Timetabler and Admin roles only).

---

## 2. Views

- **Class Grid** — the weekly grid for one class at a time: every period, every day, editable directly.
- **Teacher View** — the same grid, but for one teacher across all their classes — read-only, for checking a teacher's own load.
- **Institution** — a school-wide overview across every class at once.
- **Rooms** — see §6.
- **Cover/Subs** — see §7.

---

## 3. Adding and Editing Slots

From **Class Grid**, click an empty period to add a slot, or click an existing one to edit it. Set the subject, teacher, and room. The system checks for conflicts as you save (see §4) — a slot that would double-book a teacher or room is flagged, not silently allowed.

---

## 4. Conflict Detection

The toolbar always shows a live conflict count — **"No conflicts"** in green, or **"N conflicts"** in amber/red if any exist. Click it to open the Conflicts panel and see exactly which slots clash (a teacher scheduled in two places at once, a room double-booked, etc.) so you can resolve them before publishing.

---

## 5. Bell Schedules

Click **Bell Schedules** to define the actual period times each day maps to (start/end time per period). Most schools run one standard schedule for all classes, but a class or section can have its own custom schedule where needed — shown with a small dot marker in the list.

---

## 6. Rooms

Go to **Rooms** to maintain your school's room registry (name, capacity, type) — this is the same list that populates the room dropdown when adding a slot, and it's also viewable per-room via **Room View**, which shows what's scheduled in each room across the week so you can spot idle or over-booked spaces.

---

## 7. Cover / Substitution

Go to **Cover/Subs** for the substitution sheet — when a teacher is away, assign a covering teacher to their affected slots for that day without permanently editing the timetable itself. Each substitution is tracked against its own version/term, so history isn't lost.

---

## 8. Publishing

Once the timetable for a term is finalized, click **Publish Now** from the Publish Timetable dialog. Publishing makes the current version visible to teachers, students, and parents on their own dashboards — draft changes made after publishing don't show up for them until you publish again.

---

*Last reviewed: 2026-09-05 — checked directly against `client/src/pages/timetable/` and `server/routes/timetable.js`.*
