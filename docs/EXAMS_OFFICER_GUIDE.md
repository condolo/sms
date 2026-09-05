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
7. [Locking and Unlocking — the One Step That Needs a Grant](#7-locking-and-unlocking--the-one-step-that-needs-a-grant)

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
| **Completed** | Sat, marks being entered | Moderate, Lock *(needs a grant — see §7)* |
| **Moderated** | Reviewed for consistency | Approve, Reopen |
| **Approved** | Signed off | Lock *(needs a grant — see §7)* |
| **Locked** | Marks frozen — no further edits | Publish Results, Unlock *(needs a grant — see §7)* |
| **Published** | Visible to students/parents | Archive |
| **Archived** | Read-only, historical | — |

As an Exams Officer, you can drive the exam through **every one of these transitions yourself** — Start, Complete, Moderate, Approve, Publish, Archive, and Cancel — the same as Admin/Superadmin. **Locking and unlocking are the one exception**, kept deliberately more restrictive since they freeze/unfreeze results outright — see §7.

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

## 7. Locking and Unlocking — the One Step That Needs a Grant

Locking an exam freezes its results permanently against further edits; unlocking reverses that. Because of how consequential that is, it's held to a higher bar than the rest of the pipeline: by default, only **Admin** and **Superadmin** can lock or unlock an exam.

**Your school can extend that to you specifically.** From **Settings → Roles & Permissions**, an admin can grant the **Exams Officer** role (or you individually) the `exams.lock` and/or `exams.unlock` permission — they're independent, so a grant of one doesn't imply the other. Once granted, the **Lock**/**Unlock** buttons appear for you exactly where you'd expect them (on a Completed/Approved exam, and on a Locked one), both from the exam's detail panel and via a direct status change — either way is respected identically.

Without that grant, you can still do everything else in the pipeline — Moderate, Approve, Publish, Archive — up to the point of actually locking; ask your admin to lock/unlock those specific exams, or request the grant if this is a routine part of your work.

---

*Last reviewed: 2026-09-05 — checked directly against `client/src/pages/exams/ExamsPage.jsx` and `server/routes/exams.js` (TRANSITION_ROLES, `_checkTransition`, `POST /:id/lock`), after fixing the gap this guide originally documented.*
