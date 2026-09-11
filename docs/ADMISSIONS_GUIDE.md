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

**Enquiry through Acceptance are working stages — Enrolled, Withdrawn, and Rejected are permanent.** An application that reaches Enrolled stays in that column forever, the same way a "Closed Won" column works in a sales pipeline — it's not a queue that clears out once the student is created. That's deliberate: the application record is the enrolled student's history (see §7 below), so it stays visible and traceable rather than disappearing the moment it's no longer "in progress." The Enrolled *count* on the board only ever grows.

---

## 4. Creating a New Application

Click **New Application**. The form is organised into: Applicant Details, House (optional), Mother/Father, Emergency Contact, Previous School (optional), Pipeline, and Fee Discounts.

A unique **application reference** is generated automatically on save — you don't set this yourself.

**Fee Discounts** (Director's family / Referred family): tick either that applies now, at application stage, rather than after enrolling — if your school has an active Director's or Referral discount policy in Finance, ticking here means it's already reflected on the admission draft invoice, not something Accounts has to notice and correct later. Sibling discounts don't need a checkbox at all — if the same parent email is already on file for an older sibling, Msingi links the family and applies the discount automatically the moment you enroll.

---

## 5. Required Fields

**First Name** and **Last Name** are always mandatory. Beyond that, your school decides:

- **Gender**
- **Date of Birth**
- **At least one parent** — Mother or Father named at all
- **A named parent's email** — Mother or Father, once named, given an email (see §6)

All four are **on by default** — this is the same behaviour Msingi has always had. To change any of them for your school, go to **Settings → School Profile → Admission Requirements**. Each is an independent toggle: you can, for example, require Date of Birth but not Gender, or accept a phone-only parent contact while still requiring at least one to be named. Whatever you choose applies identically here, on the student bulk-import CSV, and at the enroll step — one setting, everywhere.

Everything else — middle name, House, Allergies, Emergency Contact, ID/Passport numbers, previous school, target class/stream, intake term — is always optional and can be filled in later by editing the application.

> If you're editing an application that predates a change to these settings (or predates your school's Msingi setup entirely) and it's missing something your school currently requires, you'll need to fill that in before the application can be enrolled (§8) — the enroll step blocks with a clear error naming exactly what's missing, rather than creating an incomplete student record.

---

## 6. Mother and Father — Entered Separately

There is no single "parent" field. Mother and Father each get their own **name, email, phone, and ID/Passport number**.

**By default, email is required for any parent you name** — phone is optional, but a parent entered with a name and no email will be rejected when you try to save (unless your school has turned this off in Settings — see §5). This is deliberate: email is what lets that parent get their own independent portal login later, once the child is enrolled (see the School Administrator Guide, §7, "Mother and Father can each have their own independent login"). A parent you never plan to give portal access to still needs an email on file to satisfy this rule, unless it's been relaxed — use any address they check, even if they'll never log in.

**Primary Contact** picks which parent drives day-to-day school communications (letters, the "registration" contact). It does **not** limit which parent can later get a portal account — both can, independently, once enrolled, regardless of which one is Primary Contact.

---

## 7. Moving an Application Through Stages

Open the application (from Board or List) and change its stage. Each stage change is logged in the application's **stage history** with who made the change, when, and any notes you add — useful for tracking "why did this applicant drop from Interview to Withdrawn" months later.

A stage-only change (e.g. Enquiry → Application) never re-checks or touches the Mother/Father fields. Editing a guardian field on an existing application **does** re-check the email-required rule at that point — if the application predates that rule and is missing an email for a named parent, you'll need to add it before that particular save goes through.

---

## 8. Enrolling an Accepted Applicant

Once an application reaches **Acceptance**, open it — its detail panel shows an **Enroll Student** button.

This is a deliberate, explicit action, not something that happens automatically when you change the stage dropdown, because it creates a real, permanent student record. *(2026-09)* The **Move Applicant** dialog (§3) no longer offers "Enrolled" as a destination at all — moving an application there any other way used to silently set the label with none of the real work behind it (no student record, no admission number, no invoice), leaving a card in the Enrolled column that Students had never heard of. If you ever see an application at Enrolled with no linked student, opening it and clicking Enroll Student fixes it — the button still appears, and enrolling is safe to retry. Clicking it:

- Assigns the student's **permanent admission number** at that exact moment — never earlier, and never on the application itself.
- Carries every field across automatically: names, DOB, gender, class/stream/house, both parents' full details, Allergies and Emergency Contact (filed under the new student's Medical tab).
- Is safe to click more than once — enrolling an already-enrolled application returns the same student record rather than creating a duplicate, so a double-click or a retried request can't create two students for one applicant.
- Is blocked with a clear error if the application is missing Date of Birth or Gender (see the note in §5) — fix the application, then enroll.
- If your school has a Finance → Fee Structure (e.g. "New Admission Package" — Admission Fee, Caution Money, etc.) marked to auto-generate on enrollment, a **draft invoice** is created for the new student at the same moment — already correctly discounted if they're a sibling, or Director's/Referral family (see §4), not left at full price for Accounts to notice and fix. It's a draft, not a live invoice — Finance still reviews it and issues it (visible to the parent) from the Invoices tab. Nothing changes here if your school hasn't set one up.

The application and the resulting student stay linked (the application records the new student's ID), so you can always trace an enrolled student back to their original application and its full stage history.

---

## 9. Alternative: Bulk Import Instead of the Pipeline

If a school is migrating many students at once rather than running them through the enquiry-to-offer pipeline, **Students → Import** accepts a CSV that mirrors this form's fields exactly — same required Date of Birth/Gender, same Mother/Father-with-mandatory-email rule (or use the older combined `parentName` + phone/email columns instead, if that's what your existing records use). Every row is validated before anything is saved, and you get a report of exactly which rows succeeded and which were skipped, with a reason. See the School Administrator Guide, §7, for the full column list.

---

## 10. The Admissions Funnel

The Dashboard's **Admissions Pipeline** bar chart shows applicant counts by stage at a glance. For full detail on every active application, the Admissions Board (§3) shows everything grouped by stage in one place.

---

*Last reviewed: 2026-09-11 — Confirmed the fix below closes every write path: `admissions.js` is the only file in the codebase that ever writes to this collection, and creating a brand-new application directly at "Enrolled" (the third of three paths) is now blocked the same way. A live, read-only check across every school on the platform (with this organisation's authorization) found the same gap at one other real school, Mascit Lab Academy, and in internal demo data — confirming the bug was genuinely systemic, not a one-off. Earlier the same day: §3 and §8 updated: "Enrolled" can no longer be set from the Move Applicant dialog or a plain field update — confirmed live (a real Trinitas school's data) that it previously could, leaving three real applicants "Enrolled" with no linked Student record at all — checked directly against `server/routes/admissions.js` and `client/src/pages/admissions/components/StageModal.jsx`. Earlier: 2026-09-08 — §4 and §8 updated for the billing-sequence fix: Fee Discounts (Director's/Referral) are now set on the application itself, and sibling discounts link automatically before the draft admission invoice is generated (`server/utils/guardian-linking.js`, `server/utils/admission-billing.js`), checked directly against `server/routes/admissions.js`.*
