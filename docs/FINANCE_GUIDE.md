# Msingi — Finance Officer Guide

> **Audience:** Staff assigned the **Finance** role. Covers fee structures, invoicing, term billing, transport and extra-curricular charges, recording payments, early payment, M-Pesa, and the Overdue and Summary views. Every plan includes the full Finance module — access here is a role permission, not a subscription tier (see the School Administrator Guide, §9).

---

## Table of Contents

1. [What You Can Access](#1-what-you-can-access)
2. [Fee Structures](#2-fee-structures)
3. [Term Billing](#3-term-billing)
4. [Early Payment](#4-early-payment)
5. [Transport Fares](#5-transport-fares)
6. [Extra-Curricular Activities](#6-extra-curricular-activities)
7. [Invoices](#7-invoices)
8. [Recording Payments](#8-recording-payments)
9. [Opening Balances](#9-opening-balances)
10. [M-Pesa Integration](#10-m-pesa-integration)
11. [Overdue Accounts and Reminders](#11-overdue-accounts-and-reminders)
12. [Summary Dashboard](#12-summary-dashboard)
13. [Exporting Finance Data](#13-exporting-finance-data)

---

## 1. What You Can Access

The **Finance** role has full access (view, create, update, delete) to the **Finance** module, plus view-only access to Students, Report Cards, Events, Library, Hostel, and Transport, and messaging access for parent/staff communication. You do not have access to Grades, Exams, HR, Attendance, or Behaviour by default — ask your School Admin (Settings → Roles & Permissions) if your school has customised this.

The Finance module has these tabs: **Summary, Invoices, Overdue, Payments, Fee Structure, Extra-Curricular, Term Billing.**

Three finance actions need their own permission, which the general finance rights do not cover. Ask your School Admin to grant them under Settings → Roles & Permissions → Finance if you need them:

- **Run Term Billing** — preview and create term invoices.
- **Confirm Early Payment** — confirm early payment, and change its deadline or percentage before confirming.
- **Manage Extra-Curricular Activities & Enrolments** — create or change activities, and enrol or end students.

If you can't see one of these actions, your role doesn't have that permission yet. Your School Admin can grant it.

---

## 2. Fee Structures

Go to **Finance → Fee Structure**.

A fee structure is a reusable template — a term's tuition, a trip fee, a uniform charge — that you generate invoices *from*, rather than typing the same amount onto every student one at a time.

1. Click **Add Fee Structure**
2. Name it clearly (e.g. `Term 2 2025 — Full Fee`) and add a description
3. Add one or more **line items** (e.g. `Tuition Fee` — amount)
4. Choose who it applies to:
   - **All active students**
   - **Specific classes**
   - **Specific sections**
   - **Specific students**
5. Save

**Fee structures do not repeat by themselves.** There is no "one-time" or "per term" setting. A termly fee is created by generating the structure again for that term. A one-time fee is generated once.

### Generating invoices from a structure

Click **Generate Invoices**. This creates one invoice per matching active student. Students who **already have an invoice from that same structure are skipped**, so it's safe to re-run after adding new students mid-term.

### Admission charges (automatic on enrolment)

A fee structure can be set to **generate automatically when a student is enrolled**. This only works for structures that apply to all students. Each new admission then gets a **draft** invoice, which you review and issue. Nothing reaches the parent until you issue it.

A few things are not handled by the system: the admission fee is not marked non-refundable or non-transferable, there is no refund process for the caution fee (it is marked refundable, but nothing tracks a refund), and admission charges can't be limited to one class.

---

## 3. Term Billing

Go to **Finance → Term Billing**. Term billing adds each student's **transport fare** and **extra-curricular activities** to their invoice for one term.

1. Choose the **academic year and term**.
2. Click **Preview**. Nothing is created yet. The preview lists:
   - **Will be billed** — each student, the charges, and the total. It also shows the **due date**, which is the end of the term's first week (the seventh day counting the term's first day as day 1).
   - **Not billed** — each student who was left out, with the reason, for example: no transport fare type chosen, the route has no fare for it, or the activity is inactive.
3. Check the list. Fix anything under **Not billed** in Transport or Extra-Curricular, then preview again.
4. Click **Create term invoices**. Each billed student gets one invoice for the term.

**Running it again is safe.** Students already billed for that term are skipped. Changes made after a run — a new enrolment or a changed fare — are **not** added to the invoice for that term. A new invoice is needed for those.

Each new term invoice notifies guardians through the school's notification settings, as a normal invoice does.

---

## 4. Early Payment

Early payment is paid **by the first day of the term**. It gives a discount on the term's invoice.

- Each term invoice has an early-payment deadline, which is the **term's first day**, and a discount percentage from the school's early-payment policy.
- **A payment does not apply the discount automatically** for term invoices. The bursar confirms it.
- The panel **Early payment (bursar confirms)**, under **Term Billing**, lists each term invoice with its deadline, discount and status.
  - **Change date** moves the deadline, before the discount is confirmed.
  - **Confirm early payment** applies the discount. The system checks that a payment was received on or before the deadline. If none was, confirmation is refused, with the date in the message.
- After confirmation, the discount and deadline are locked.

For fee-structure invoices (not term invoices), early payment still applies automatically when a payment lands before the deadline.

---

## 5. Transport Fares

Transport charges come from the **route**, and each student takes one of two fare types.

- **Routes** (Transport page, **Routes** tab) have a **one-way fare** and a **two-way fare** per term. Set one or both. A route with no fare for a type can't bill students who choose that type.
- **Assigning students** (Transport page, **Assignments** tab, then **Assign Student to Route**) requires a **fare type** (one-way or two-way), offered only if the route has that fare. The **Direction** (to school, from school, both) is only a pickup label and does not change the amount.
- **Several students at once:** choose a class, search by name or admission number, tick the students, and save. Each student gets their own assignment. Students already on the route are skipped and reported. The route's seats must cover everyone you save.

A transport assignment with no fare type, or a route with no fare for it, is never billed silently. It appears under **Not billed** in Term Billing with the reason.

---

## 6. Extra-Curricular Activities

Go to **Finance → Extra-Curricular**.

- **Activities and amounts:** each activity has a name and an amount per term. Add an activity with **Add activity**. Use **Deactivate** to stop an activity from being billed. Deactivating does not remove existing enrolments.
- **Students enrolled:** choose a class, search, and tick one or more students. Choose the activity, the **From** date and an optional **To** date, and click **Enrol**. Each student gets their own enrolment. Students already in that activity are skipped and reported.
- **End an enrolment** with **End** and a date. The record is kept for history and is no longer billed from that date.

Enrolled students are billed in Term Billing for each term they're enrolled in.

---

## 7. Invoices

Go to **Finance → Invoices**.

Each invoice shows its status: **unpaid**, **partial**, **paid**, or **void**. Status is computed automatically from `amountPaid` against the invoice total — you never set it directly.

Invoices created by **Term Billing** show the title *Term billing — [term name]*. A balance brought forward from before, if your school has one, appears as a separate invoice.

### Voiding an invoice

Available on any invoice that is **not already paid or void**. Click the void icon → confirm. **This cannot be undone** — use it for a genuine billing error (wrong student, duplicate, wrong amount), not as a way to "cancel" a payment plan. A voided invoice keeps its full history but stops counting toward totals or appearing as overdue.

---

## 8. Recording Payments

Go to **Finance → Payments → Record Payment**, or from a specific invoice.

Fields: student/invoice, **Amount**, **Payment Method** (Cash, M-Pesa, Bank Transfer, Cheque, Card, Other), **Payment Date**, and optional notes. Save — the invoice's `amountPaid` and status update immediately, and a receipt is available from the Payments list.

> **M-Pesa payments made via STK Push or paybill are reconciled automatically** (see §10) and appear here without manual entry — only record a payment by hand for cash, bank transfer, cheque, or a manual M-Pesa entry that wasn't auto-matched.

Balances are worked out from the payment records. A payment you record is what changes the balance, so always record a payment rather than changing an invoice's amount paid by any other means.

---

## 9. Opening Balances

**Not yet available as an import.** The system does not keep an opening balance for each student. What exists today:

- **New students** imported with the student CSV can have an opening-fee amount, which creates one invoice for them. This does not work for students who are already in the system: their rows are skipped.
- **Students already in the system** who owe from before the current term can only be given a balance by creating an invoice for them by hand, one at a time, in **Finance → Invoices**. That invoice notifies the guardian.

A balance-only import for existing students is designed and waiting for decisions. See `docs/design/opening-balance-import.md`.

---

## 10. M-Pesa Integration

Configured once by a School Admin at **Settings → School Profile → M-Pesa Integration** (Daraja API). If you need this set up or changed, that's who to ask — Finance staff use it day-to-day but the credentials themselves are an admin-level setting.

What it enables: **STK Push** payments (parent enters their M-Pesa PIN on their phone to pay directly) and **automatic C2B reconciliation** (a parent paying your paybill/till number directly is matched to the right invoice without anyone typing it in).

Fields an admin configures: Consumer Key, Consumer Secret, Paybill/Till Number, STK Push Passkey, Environment (Sandbox for testing / Production for live), and a Public Callback Base URL. Credentials are stored encrypted per school. Safaricom's callback URL for C2B registration is `/api/mpesa/callback`.

---

## 11. Overdue Accounts and Reminders

Go to **Finance → Overdue** for a live list of every unpaid or partially-paid invoice past its due date, sorted so the most overdue balances surface first. Use this for fee-collection follow-up calls or reminder messages, rather than filtering the full Invoices list by hand.

**Automatic guardian reminders** are sent on the schedule in **Finance → Fee Settings → Overdue Invoice Reminders**: a reminder before the due date, one on the due date, then repeats while still unpaid.

- **Term invoices are not included in automatic reminders by default.** To include them, turn on **Also remind guardians about term invoices** in the same settings. Turn it on only if you want guardians emailed about term invoices.
- Reminders follow each school's notification settings for the channel (email or in-app).

---

## 12. Summary Dashboard

Go to **Finance → Summary** for the headline numbers: total invoiced, total collected, total outstanding, and the collection rate for the current period — the same figures that feed the platform Dashboard's Fee Collection card.

---

## 13. Exporting Finance Data

Each list (Invoices, Payments) has an **Export** button that downloads a CSV. Exports respect whatever filters are currently applied on screen — filter to a class or date range first, and the export matches exactly what you see.

---

*Last updated: 2026-10-05 — checked against `client/src/pages/finance/` and `server/routes/finance.js`, `transport.js`, `extracurricular.js` and `utils/term-billing.js`.*
