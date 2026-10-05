# Design: Balance-only import (opening balances for existing students)

Status: **proposal, not built.** Every point marked **DECIDE** needs an answer before implementation. Facts marked **Verified** were checked against the code on 2026-10-05.

## 1. Problem

Some students owe money from before the current term, and invoices for the current term have already been sent. Today:

- No student record stores a balance. A balance is invoices minus payments (**Verified**: `routes/finance.js`, `_calcBalance`).
- The only way to bring a balance in is the student CSV import's `openingFee*` columns. They create an invoice only when the student is new. An existing admission number is skipped (**Verified**: `routes/import-export.js`, "already exists" branch).
- So an existing student's balance can't be imported at all. No screen adds a single invoice to an existing student either (the single-invoice create endpoint exists, but the interface does not use it), so there is no manual route today.

## 2. Goal

A separate, balance-only import that:

1. matches each row to an **existing** active student by admission number, and never creates or edits students;
2. creates one clearly labelled **balance invoice** per row (and a payment record for any amount already paid), so the balance becomes part of the student's invoice balance;
3. can be previewed in full before anything is written;
4. refuses to run until the setup checklist (section 4) is complete;
5. is safe to run twice.

## 3. The file

One row per student per balance. Columns:

| Column | Required | Rule |
|---|---|---|
| `admissionNumber` | yes | Must match exactly one **active** student in this school. Zero matches or two matches = row error. |
| `balanceTitle` | no | Default `Balance brought forward`. Shown on the invoice. |
| `academicYear` | yes | Exact name of an academic year in this school, e.g. `2025-2026`. Refused if that year is archived (locked). **DECIDE 1** |
| `term` | no | Exact term name within that year. Blank means the whole year. |
| `amountOwed` | yes | Positive number. Two decimal places max. |
| `amountPaid` | no | Default 0. Must not exceed `amountOwed`. Becomes a payment record. |
| `dueDate` | no | `YYYY-MM-DD`. Blank means no due date, so no reminders are sent (see section 6). |
| `note` | no | Stored on the invoice. |

Why `academicYear` is required: the invoice is filtered by academic year in Finance and reports. An invoice with no year is invisible to year-filtered views. The earlier opening-fee import deliberately left the year blank, which is a gap, not a choice to copy (**Verified**: the code comment says so).

## 4. Setup checklist (shown before upload; upload is blocked until all pass)

Each item shows pass or fail, the number of rows that depend on it, and a link to fix it.

1. **You can run this import.** You hold the finance `import` permission (explicit grant). Superadmin passes.
2. **School currency is set** (`schools.currency`). Without it the invoice has no currency, and guardian and display text show `undefined`.
3. **Every academic year named in the file exists and is not archived.** Checked per year named in the file once it is uploaded. Also: a current academic year exists.
4. **Terms exist** for any `term` named in the file.
5. **Students are matched.** Count of roster students with an admission number; count of duplicate admission numbers in the school (duplicates block their rows).
6. **Reminder decision made** (section 6): whether these invoices are included in overdue reminders. Default: excluded.
7. **Notification decision made** (section 6). Default: guardians are not notified.
8. **Finance is enabled for the school** (module and plan gate).

Upload is refused, with the failing items listed, until 1 to 4 and 8 pass. Items 6 and 7 must be answered explicitly, so no default is applied silently.

## 5. Process

1. **Upload.** The file is parsed. Nothing is written.
2. **Preview** (required before commit). For each row:
   - status: `ready`, or `error` with the exact reason;
   - student name and current outstanding balance;
   - the balance after import;
   - `warning` if the same student already has a term-billing invoice or any invoice for the same term (see risk R1).
   The preview also shows totals: number of rows, total amount owed, total already paid, total outstanding after import.
3. **Confirm.** The bursar confirms. Only `ready` rows are written. Rows with a `warning` need an explicit tick per row.
4. **Write.** All invoices and payment records in one batch (section 7). A batch record is stored with the file name, the batch ID, the user, the time, and the row results.
5. **Result.** Created, skipped (already imported, with reason), and errors. Opens the batch record.

## 6. Notifications and reminders

- **Guardian notification:** none on import, as the existing opening-fee import does. Reason: a backdated balance sent without context would confuse a parent. **DECIDE 2:** keep this, or send one notice per student after confirmation.
- **Overdue reminders:** these invoices are excluded unless a due date is given and the school has opted in. The exclusion must be a separate flag from term billing, so the two can be set independently. **DECIDE 3:** include these invoices in reminders when they have a due date? Default: no.

## 7. Writes, idempotency and consistency

- **Invoice fields** written explicitly, not left to defaults: `schoolId`, `invoiceNumber` (from the counter), `studentId`, `studentName`, `title`, one line item (`description`, `quantity` 1, `unitPrice` = `amountOwed`, `total`), `subtotal`, `discountPct` 0, `taxPct` 0, `total`, `amountPaid`, `balance`, `status`, `academicYearId`, `termId` if given, `currency` (school currency), `dueDate` if given, `importedBalance: true`, `balanceImportBatchId`, `createdBy`, `updatedBy`.
- **Payment record** for `amountPaid` > 0: `invoiceId`, `studentId`, `amount`, `method` `other`, `reference` `Balance import <batch ID>`, `paidAt` = import time, `createdBy`.
- **Invoice and payment written in one database transaction.** Fallback when transactions are unavailable (standalone database): see R3.
- **Idempotency:** a unique index on `(schoolId, studentId, academicYearId, termId, importedBalance)` where `importedBalance` is true. A second run of the same file skips rows already imported and says so.
- **Audit:** one entry per batch with counts, plus the batch record.
- **Undo:** allowed only for a batch whose invoices have no payment other than the import's own. The undo deletes those invoices and payments and records the undo in the audit log. After any other payment, correction is by a new invoice, not by undo (**DECIDE 4**: is undo wanted at all?).

## 8. Risks

| # | Risk | Effect | Mitigation in design |
|---|---|---|---|
| R1 | **Double billing.** The balance is for a term already billed by term billing or fee structures. | A student owes twice for one term. | Preview warns on any existing invoice for that student and term. Per-row confirmation. Fee-structure invoices without a term ID cannot be checked automatically (see open point 5). |
| R2 | **Balance can silently reset.** Balances are recalculated from payment records only (**Verified**). If the paid amount has no payment record, the next payment resets the balance to that new payment's total. | Money appears owed again. | The paid amount is always a payment record, written in the same transaction. No invoice is created with `amountPaid` and no payment. |
| R3 | **No transactions on a standalone database.** The report-cards code falls back to non-transactional writes. | A crash between invoice and payment leaves them out of step (R2). | On a standalone database the batch is refused, with the reason shown. It runs only on a replica set (Atlas). **DECIDE 5:** accept refusal on standalone databases, or accept the R2 risk there. |
| R4 | **Invisible invoices.** No academic year, so year-filtered views and reports miss them. | Balances look missing. | `academicYear` is required (section 3). |
| R5 | **Archived year.** Writing into a locked year breaks the lock's purpose. | Historical records change after lock. | Rows for archived years are refused, not written. |
| R6 | **Duplicate students.** Two students share an admission number. | Balance on the wrong child. | Zero or two matches are a row error. The setup checklist counts duplicates. |
| R7 | **Inactive or transferred students.** A balance can belong to a student who has left. | Balance on a student no longer on the roster. | **DECIDE 6:** allow rows for students who have left, or refuse them? Default: refuse, so the bursar handles those by hand. |
| R8 | **Currency missing.** | Shows `undefined`. | Currency is set explicitly from the school, and setup check 2 blocks upload. |
| R9 | **Existing opening-fee invoices have no currency or year.** | Those invoices already have R4 and currency problems. | Not changed by this design. Listed as a cleanup item (**DECIDE 7**: clean them up later?). |
| R10 | **Permission.** Anyone with finance create could import balances. | Unauthorised balance changes. | Uses the finance `import` sub-permission, checked explicitly, like the other explicit finance rights. |
| R11 | **Discounts and early payment.** These could be applied to a balance, changing what is owed. | Wrong amount owed. | Not applied. The file states the exact amount owed. |
| R12 | **Partial failure.** Some rows written, some not. | Hard to reconcile. | Single batch. All or nothing per confirm, in one transaction. Rows that fail preview are never written. |
| R13 | **Amount precision.** | Rounding drift. | Two decimal places, rounded once, checked that `amountPaid` ≤ `amountOwed`. |

## 9. Open points (not decided, no default assumed)

1. **DECIDE 1.** Is `academicYear` required for every row, or may a balance be entered against the whole roster with no year? (Recommended: required.)
2. **DECIDE 2.** Guardian notification on import: none, or one per student after confirmation?
3. **DECIDE 3.** Overdue reminders for balance invoices with a due date: include or exclude? (Recommended: exclude by default, opt in.)
4. **DECIDE 4.** Undo of a whole batch: wanted, or correction only by a new invoice?
5. **DECIDE 5.** Standalone databases (development): refuse the import, or allow it with risk R2?
6. **DECIDE 6.** Balances for students who have left: refuse, or accept?
7. **DECIDE 7.** Clean up existing opening-fee invoices (no year, no currency) as a separate step?
8. **Open point 5.** Fee-structure invoices carry a due date but no term ID, so the term check in R1 cannot see them. Option: require the bursar to confirm each row in that situation.

## 10. What is not in this design

- Editing or creating students (that is the student import, which is paused).
- Admission-package invoices for imported students.
- Refunds of balances.
