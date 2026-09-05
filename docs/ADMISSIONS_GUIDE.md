# Msingi — Admissions Guide

> **Audience:** Staff assigned the **Admissions Officer** role, or anyone running a school's application-to-enrollment process. Covers the full pipeline, the application form's required and optional fields, the Mother/Father guardian rule, converting an accepted applicant into a student, and bulk import as an alternative path. Every plan includes the full Admissions module — access here is a role permission, not a subscription tier (see the School Administrator Guide, §9).

---

## Table of Contents

1. [What You Can Access](#1-what-you-can-access)
2. [The Pipeline](#2-the-pipeline)
3. [Board and List Views](#3-board-and-list-views)
4. [Creating a New Application](#4-creating-a-new-application)
5. [Required Fields](#5-required-fields)
6. [Mother and Father — Entered Separately](#6-mother-and-father--entered-separately)
7. [Moving an Application Through Stages](#7-moving-an-application-through-stages)
8. [Enrolling an Accepted Applicant](#8-enrolling-an-accepted-applicant)
9. [Alternative: Bulk Import Instead of the Pipeline](#9-alternative-bulk-import-instead-of-the-pipeline)
10. [The Admissions Funnel](#10-the-admissions-funnel)

---

## 1. What You Can Access

The **Admissions Officer** role has full access (view, create, update, delete) to **Admissions**, plus **read/create/update** on **Students** (needed for the enroll step, §8), view-only on Classes, and messaging/resources access for communicating with applicant families.

---

## 2. The Pipeline

Every application sits in exactly one of nine stages:

**Enquiry → Application → Assessment → Interview → Offer → Acceptance → Enrolled**, with **Withdrawn** and **Rejected** available at any point to close the pipeline without deleting the record.

There's no forced order beyond what makes sense for your process — you can move an application forward or back, and skip a stage your school doesn't use (e.g. no Assessment step).

---

## 3. Board and List Views

Go to **Admissions**. Two ways to work:

- **Board** — a kanban view, one column per stage, cards you drag (or move via the card's own controls) between columns. Best for a quick visual sense of where every applicant currently sits.
- **List** — a filterable, sortable table. Best for searching a specific applicant or exporting the full pipeline.

---

## 4. Creating a New Application

Click **New Application**. The form is organised into: Applicant Details, House (optional), Mother/Father, Emergency Contact, and Previous School (optional).

A unique **application reference** is generated automatically on save — you don't set this yourself.

---

## 5. Required Fields

Only four things are mandatory to save any application:

- **First Name** and **Last Name**
- **Gender**
- **Date of Birth**
- **At least one parent** — Mother or Father, each with a name **and email** (see §6)

Everything else — middle name, House, Allergies, Emergency Contact, ID/Passport numbers, previous school, target class/stream, intake term — is optional and can be filled in later by editing the application.

> If you're editing an application that predates your school's Msingi setup and it's missing Date of Birth or Gender, you'll need to fill those in before that application can be enrolled (§8) — the enroll step blocks with a clear error naming exactly what's missing, rather than creating an incomplete student record.

---

## 6. Mother and Father — Entered Separately

There is no single "parent" field. Mother and Father each get their own **name, email, phone, and ID/Passport number**.

**Email is required for any parent you name** — phone is optional, but a parent entered with a name and no email will be rejected when you try to save. This is deliberate: email is what lets that parent get their own independent portal login later, once the child is enrolled (see the School Administrator Guide, §7, "Mother and Father can each have their own independent login"). A parent you never plan to give portal access to still needs an email on file to satisfy this rule — use any address they check, even if they'll never log in.

**Primary Contact** picks which parent drives day-to-day school communications (letters, the "registration" contact). It does **not** limit which parent can later get a portal account — both can, independently, once enrolled, regardless of which one is Primary Contact.

---

## 7. Moving an Application Through Stages

Open the application (from Board or List) and change its stage. Each stage change is logged in the application's **stage history** with who made the change, when, and any notes you add — useful for tracking "why did this applicant drop from Interview to Withdrawn" months later.

A stage-only change (e.g. Enquiry → Application) never re-checks or touches the Mother/Father fields. Editing a guardian field on an existing application **does** re-check the email-required rule at that point — if the application predates that rule and is missing an email for a named parent, you'll need to add it before that particular save goes through.

---

## 8. Enrolling an Accepted Applicant

Once an application reaches **Acceptance**, open it — its detail panel shows an **Enroll Student** button.

This is a deliberate, explicit action, not something that happens automatically when you change the stage dropdown, because it creates a real, permanent student record. Clicking it:

- Assigns the student's **permanent admission number** at that exact moment — never earlier, and never on the application itself.
- Carries every field across automatically: names, DOB, gender, class/stream/house, both parents' full details, Allergies and Emergency Contact (filed under the new student's Medical tab).
- Is safe to click more than once — enrolling an already-enrolled application returns the same student record rather than creating a duplicate, so a double-click or a retried request can't create two students for one applicant.
- Is blocked with a clear error if the application is missing Date of Birth or Gender (see the note in §5) — fix the application, then enroll.

The application and the resulting student stay linked (the application records the new student's ID), so you can always trace an enrolled student back to their original application and its full stage history.

---

## 9. Alternative: Bulk Import Instead of the Pipeline

If a school is migrating many students at once rather than running them through the enquiry-to-offer pipeline, **Students → Import** accepts a CSV that mirrors this form's fields exactly — same required Date of Birth/Gender, same Mother/Father-with-mandatory-email rule (or use the older combined `parentName` + phone/email columns instead, if that's what your existing records use). Every row is validated before anything is saved, and you get a report of exactly which rows succeeded and which were skipped, with a reason. See the School Administrator Guide, §7, for the full column list.

---

## 10. The Admissions Funnel

The Dashboard's **Admissions Pipeline** bar chart shows applicant counts by stage at a glance. For full detail on every active application, the Admissions Board (§3) shows everything grouped by stage in one place.

---

*Last reviewed: 2026-09-05 — checked directly against `server/routes/admissions.js`, `server/utils/guardian-contact.js`, and `client/src/pages/admissions/`.*
