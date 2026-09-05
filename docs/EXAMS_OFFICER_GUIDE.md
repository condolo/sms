# Msingi — Exams Officer Guide

> **Audience:** Staff assigned the **Exams Officer** role. Covers scheduling exams, the Markbook, assessment configuration, and reminders. Every plan includes the full Exams module — access here is a role permission, not a subscription tier (see the School Administrator Guide, §9).

---

## Table of Contents

1. [What You Can Access](#1-what-you-can-access)
2. [Exam Status Lifecycle](#2-exam-status-lifecycle)
3. [Creating and Scheduling an Exam](#3-creating-and-scheduling-an-exam)
4. [Markbook](#4-markbook)
5. [Configuration](#5-configuration)
6. [Reminders](#6-reminders)
7. [A Known Limit on This Role Today](#7-a-known-limit-on-this-role-today)

---

## 1. What You Can Access

The **Exams Officer** role has full access (view, create, update, delete) to **Exams, Grades, and Assessment**. You also have view-only access to Students, Classes, Report Cards, Growth Profile, Events, Library, Hostel, and Transport, and messaging access.

The Exams module has four tabs: **Exams, Markbook, Reminders, Configuration.**

---

## 2. Exam Status Lifecycle

Every exam moves through a fixed sequence of statuses, each unlocking the next available action:

| Status | What it means | Action available |
|---|---|---|
| **Draft** | Being set up, not yet scheduled | — |
| **Scheduled** | Date/class/subject confirmed | Start Exam |
| **In Progress** | Being sat | Mark Completed |
| **Completed** | Sat, marks being entered | Moderate, Lock *(admin only — see §7)* |
| **Moderated** | Reviewed for consistency | Approve, Reopen *(admin only)* |
| **Approved** | Signed off | Lock *(admin only)* |
| **Locked** | Marks frozen — no further edits | Publish Results, Unlock *(admin only)* |
| **Published** | Visible to students/parents | Archive *(admin only)* |
| **Archived** | Read-only, historical | — |

You can move an exam from **Scheduled → In Progress → Completed** yourself. Everything from **Moderate onward is currently restricted to Admin/Superadmin** in the app's interface — see §7.

---

## 3. Creating and Scheduling an Exam

Go to **Exams → Exams → Add Exam**. Set the class, subject, exam type/assessment type, date, and maximum score. The exam starts in **Draft**, then move it to **Scheduled** once the date is confirmed.

---

## 4. Markbook

Go to **Exams → Markbook** to enter scores for a class/subject/exam in a spreadsheet-style grid. Each student's mark can also be flagged instead of scored: **Absent, Missing, Exempted,** or **Incomplete** — use these rather than leaving a blank or entering a 0, since they're treated differently in report-card averaging.

Marks can only be entered/edited while the exam is **not yet Locked, Published, or Archived** — once locked, the Markbook for that exam becomes read-only.

---

## 5. Configuration

Go to **Exams → Configuration** to manage:

- **Grading Scales** — the grade boundary bands your school uses (e.g. A ≥ 80, B ≥ 70…), each with a letter grade, points value, and label.
- **Assessment Types** — the weighted components that make up a final grade (e.g. CATs, Exams, Assignments). **Weights must total 100%** — the page won't let you save otherwise.
- **Assessment Schedule** — which assessment types are expected in which term, for tracking completion.

---

## 6. Reminders

Go to **Exams → Reminders** for upcoming exam dates and outstanding marking/moderation tasks, so nothing slips past its own status deadline.

---

## 7. A Known Limit on This Role Today

Confirmed directly in the app's code, not assumed: although the Exams Officer role is granted full create/update/delete permission on Exams at the system level, the **Moderate, Lock, Approve, Unlock, Publish, and Archive** buttons are currently shown only to users with the literal **Admin** or **Superadmin** role — not to Exams Officer, regardless of permission grants in Settings → Roles & Permissions. In practice, an Exams Officer can schedule exams, run them, and enter marks, but finishing the pipeline (moderating, locking, and publishing results) needs an Admin or Superadmin today.

If your school wants Exams Officers to complete that final stage themselves, flag it to your Msingi contact — it's a real, addressable gap in the interface, not something you're missing in Settings.

---

*Last reviewed: 2026-09-05 — checked directly against `client/src/pages/exams/ExamsPage.jsx`, `client/src/pages/grades/components/ConfigTab.jsx`, and `server/utils/repairPermissions.js`.*
