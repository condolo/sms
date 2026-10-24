# Msingi — Inventory and Library Manager Guide

**Audience:** Staff responsible for school inventory and library operations. This is one operating guide for both modules. Your school may use different role names, approval chains, categories, and local procedures.

**Purpose:** Use Msingi to maintain the inventory catalogue and stock movement ledger, process requisitions, maintain the library catalogue, and track book loans. Follow the steps in order and confirm the saved result after every change that affects stock, a loan, or a student/staff record.

> Access is controlled separately for Inventory and Library. Being able to open a module does not mean you can perform every action in it. If a tab or button is missing, ask the administrator to check the exact module permission and plan access. Do not share accounts or bypass a missing action with a database edit.

## Contents

1. [Access and responsibilities](#1-access-and-responsibilities)
2. [Inventory setup](#2-inventory-setup)
3. [Manage stock](#3-manage-stock)
4. [Requisitions and approvals](#4-requisitions-and-approvals)
5. [Inventory CSV import and export](#5-inventory-csv-import-and-export)
6. [Library setup](#6-library-setup)
7. [Add and maintain books](#7-add-and-maintain-books)
8. [Issue, return, overdue, and lost books](#8-issue-return-overdue-and-lost-books)
9. [Library CSV import and export](#9-library-csv-import-and-export)
10. [Routine checks and reconciliation](#10-routine-checks-and-reconciliation)
11. [Troubleshooting](#11-troubleshooting)
12. [System owner and administrator notes](#12-system-owner-and-administrator-notes)

## 1. Access and responsibilities

### Permission map

The labels below correspond to separately checked capabilities in the current server routes. A custom role may have only some of them. The module must also be enabled for the school's plan.

| Work | Inventory capability | Library capability |
|---|---|---|
| View catalogues and records | Inventory: View | Library: View Catalogue & Records |
| Add/edit items or books | Inventory: Manage | Library: Manage Catalogue Items |
| Delete a category/item | Inventory: Manage/Delete, subject to usage/history checks | Library: Delete Catalogue Items, with active-loan check |
| Record stock received, issued, returned, or adjusted | Inventory: Transact | Not applicable |
| Raise and view requisitions | Inventory: Requisition | Not applicable |
| Edit requisition approval-chain configuration | Inventory: Workflow | Not applicable |
| Approve/reject a requisition step | Must be the current step's configured approver | Not applicable |
| Fulfill an approved requisition | Inventory: Transact | Not applicable |
| Issue or return a book; mark a currently borrowed copy lost; sync overdue status | Not applicable | Library: Issue / Return |
| View library summary reports | Not applicable | Library: Reports |
| Import or export catalogue CSV | Inventory import/export permission | Library import/export permission |

**Important:** Requisition approval is assigned per workflow step; a general Inventory role does not by itself make someone the approver. Library readers without the Issue / Return capability see their own loan records in **My Loans**; the operational library role can see and manage the school's loans. Configure narrow roles for the person’s actual duties rather than granting broad admin access.

### Sign in

1. Open the school’s Msingi sign-in link and use your own account.
2. Confirm the school name and your profile before changing records.
3. Open **Inventory** or **Library** from the navigation. If a page or action is missing, note the exact action and ask the administrator to verify your grants.

## 2. Inventory setup

### Create categories

1. Open **Inventory → Categories**.
2. Choose the add-category action and enter a clear category name (for example, ICT, Laboratory, Furniture, or Cleaning Supplies).
3. Save and confirm the category appears in the list.
4. Keep the category list consistent. Search existing categories before creating a near-duplicate such as “ICT” and “I.C.T.”

A category that is already used by items cannot be deleted. Reassign or otherwise resolve the items first. Prefer editing a category label when that preserves the intended grouping.

### Add an item

1. Open **Inventory → Items → Add Item**.
2. Enter the unique item code and item name; select an existing category.
3. Enter the unit (such as pcs, boxes, or litres), location, and status. Use a consistent unit for each item so transactions are comparable.
4. If available, complete the optional purchase details: date, origin (local, imported from China, or imported from another location), supplier/company, value paid, and photo.
5. Save. Search the item code or name and reopen it to confirm the record.

The supplier is free text, not a linked vendor record. Purchase details are one snapshot on the item, not a history of each purchase or restock. **Change quantity through Stock Transactions, not by editing the item form.**

## 3. Manage stock

### Record a transaction

1. Open **Inventory → Stock Transactions → Record Transaction**.
2. Select the item and verify its current available quantity and unit.
3. Choose the correct movement type: **Receive**, **Issue**, **Return**, or **Adjustment**.
4. Enter a positive whole quantity. For an adjustment, also choose **Increase** or **Decrease** and enter the reason; the system requires a reason for adjustments.
5. Enter or confirm the transaction date and add a useful reference/reason where the form allows it (for example, delivery note, issue voucher, or stocktake reference).
6. Review the item, movement, quantity, and resulting balance, then save.
7. Confirm the success message. Reopen the item and transaction history to check that the balance changed once and the transaction is present.

The system blocks a stock decrease when the available quantity is insufficient. Do not split one real movement into duplicate transactions to work around a validation message. Check the physical count and ledger, then use an authorized adjustment with a reason if a correction is appropriate.

### Correct a mistake

Inventory movements are recorded as transactions; do not silently edit a balance to erase history. If an incorrect movement was recorded, follow the school’s correction process: confirm the original transaction, make a properly referenced correcting movement/adjustment if permitted, and retain the supporting evidence. Notify the administrator if the incorrect transaction cannot be corrected through the UI.

## 4. Requisitions and approvals

### Raise a request

1. Open **Inventory → Requisitions → Raise Requisition**.
2. Select a catalogue item when it exists. For an item not yet in the catalogue, enter the requested item description as allowed by the form.
3. Enter quantity, unit, department if applicable, and a clear business reason.
4. Check the request and submit it once.
5. Reopen the requisition list and check the status and current approval step. A submitted request is not yet approved and is not yet stock received.

### Approve or reject a step

1. Open the request that is waiting for your assigned workflow step.
2. Confirm the item/description, quantity, requester, and reason.
3. Approve to move it to the next configured step, or reject with a clear reason (a rejection reason is required).
4. Confirm the new status. Only after all configured approval steps does the request become **Approved**.

### Fulfill an approved request

1. Confirm the purchase/delivery has actually arrived and verify the physical quantity.
2. If the requisition was for a new item, create the catalogue item first.
3. Open the approved requisition and choose **Fulfill** / the receive-stock action. Link the correct catalogue item if prompted.
4. Confirm the quantity and submit. Fulfillment creates a **Receive** stock transaction and updates inventory.
5. Verify that the requisition is **Fulfilled**, the receive transaction exists, and the item balance matches the quantity received.

Do not fulfill a request just because it is approved. Approval authorizes procurement; fulfillment represents stock physically received into the school’s inventory.

### Configure the approval chain

Only a user with the Inventory Workflow capability should change the requisition approval chain. Before saving, confirm step order, eligible approvers, and notification recipients with the school’s procurement policy. Check an existing pending request after any workflow change; do not assume a configuration edit approves or reroutes old requests.

## 5. Inventory CSV import and export

1. Open **Inventory → Items → Import / Export**.
2. Download the current template from the screen and keep a copy of the original source file.
3. Create required categories in Msingi before importing. The `categoryName` value must match an existing category name.
4. Check required `itemCode`, `name`, and `categoryName`; confirm quantities are non-negative whole numbers and dates use `YYYY-MM-DD`.
5. Upload the CSV, inspect the row-level errors/skipped/created counts, and resolve invalid rows before relying on the imported records.
6. Search for a sample of imported item codes and check category and quantity. The same item code already in the school is skipped, not updated.
7. Use **Export** to download the catalogue CSV when you need a spreadsheet copy.

The current importer accepts up to 500 data rows per file. The quantity column imports an opening quantity; it does not create a detailed transaction history for those opening balances. Reconcile the physical opening count and retain the approved source schedule. CSV export excludes item photos and does not export the transaction ledger or requisition approval history; **it is not a full backup**.

## 6. Library setup

### Configure categories

1. Open **Library** and the library configuration/settings control available to your role.
2. Add or edit the school's category list (for example, Textbook, Fiction, Reference, or Periodical).
3. Save and verify the category options appear in the Add Book form.

If the configuration control is not available, ask an administrator with Library Manage permission. Imported book categories are free text and are not required to exist in this category list, so use consistent spelling in the file and in routine entry.

## 7. Add and maintain books

### Add a book

1. Open **Library → Books → Add Book**.
2. Enter the title and total number of copies. Add author, ISBN, category, publisher, publication year, shelf/location, and description when known.
3. Optionally tag one or more classes for cataloguing/filtering. **Class tags do not restrict who may borrow the book.**
4. Add purchase date, origin, supplier/company, purchase value, and cover photo when relevant. The photo picker accepts an image under 5 MB and resizes it before storage.
5. Save and search the title or ISBN to verify it appears. Confirm total and available copies are correct.

Purchase details describe one snapshot for the catalogue record, not each later purchase or restock. Supplier/company is free text, not a vendor-management module. Keep invoices and formal financial evidence in the school’s approved finance/procurement record system.

### Edit catalogue data or remove a book

- Use **Edit Book** to correct metadata, location, or total copies. The application recalculates available copies using the number it believes are currently on loan; review the result carefully after changing total copies.
- Search before creating another record. Similar titles may be distinct editions, but duplicate records make stock counts and search harder.
- Deletion is blocked while any copy is on loan. Prefer preserving catalogue history and correcting metadata where possible; delete only when authorized and the record is genuinely erroneous or obsolete.

## 8. Issue, return, overdue, and lost books

### Issue a book

1. Choose **Issue Book**.
2. Search for and select the exact book by title, author, or ISBN. Confirm there is an available copy.
3. Choose borrower type (**Student** or **Staff**) and search for the correct person. Check the borrower identity and, for students, class/admission details.
4. Set the due date according to school policy and issue the book.
5. Confirm the success message, then check the Loans list for the new borrower, book, due date, and active status. Confirm available copies decreased by one.

The system checks that the borrower exists, that a copy is available, and that the borrower does not already have that title on an active loan. If a request fails, verify the actual borrower and catalogue record; do not create a second record to bypass it.

### Return a book

1. Find the active or overdue loan and confirm the borrower and exact title.
2. Physically inspect the returned copy and choose **Return** only when it has actually been returned.
3. Confirm the loan status is **Returned** and available copies increased by one. If overdue, verify the calculated overdue days and fine shown in the record.

The current server default calculates an overdue fine at 10 currency units per day unless another rate is explicitly supplied by the calling workflow. Confirm the school’s approved rate and currency policy; do not treat the fine field as proof that money was collected. Use the school’s finance process for any payment receipt and reconciliation.

### Sync overdue loans

Use **Sync Overdue** to mark active loans whose due date has passed as overdue. Review the resulting list and check the date before notifying borrowers. A loan marked overdue can still be returned through the Return action.

### Mark a book lost

1. Confirm the book is actually missing and follow the school’s lost-property process first.
2. Verify the correct active/overdue loan and borrower.
3. Choose **Mark Lost** only after authorization. This is a permanent loss action: the loan becomes lost and the book’s total copy count decreases; available copies are not restored.
4. Recheck the loan status and catalogue counts. Do not use this action for a book that has been returned or whose location is merely unknown.

## 9. Library CSV import and export

1. Open **Library → Import / Export**.
2. Download the current library template. Fill required title and available metadata; use `YYYY-MM-DD` for purchase dates and one of the supported origin values if supplied.
3. Upload the CSV and review the import result and row errors. Verify a sample of imported records in the catalogue.
4. Export the catalogue CSV when a spreadsheet copy is needed.

The current importer accepts up to 500 data rows per file. Each row creates a new book record; there is no duplicate-title check, so search first and inspect the file for duplicate rows before importing. Copies imported are catalogue totals/opening availability, not individual loan records. Export omits photos and does not include loans, fine collection history, or a complete operational audit trail; **it is not a full backup**.

## 10. Routine checks and reconciliation

### Daily or per transaction

- Verify the saved item/book, status, and quantity or loan state after each operation.
- For stock changes, compare the item balance with the transaction ledger and the signed source document.
- For loans, check borrower, title, due date, status, and available-copy count.
- Keep receipts, issue vouchers, stocktake counts, and return evidence in approved school records.

### Periodic stocktake / library audit

1. Agree a count date and the responsible staff with the school administrator.
2. Count physical inventory and books by item/code, location, and condition.
3. Compare counts with Msingi balances and active loans. Investigate discrepancies before recording adjustments or lost items.
4. Record approved stock discrepancies through a reasoned adjustment; do not silently change quantity fields.
5. Reconcile open requisitions against orders and deliveries; confirm fulfilled quantities correspond to stock received.
6. Retain a dated reconciliation report and supporting evidence according to school policy.

## 11. Troubleshooting

| Symptom | Checks |
|---|---|
| Inventory category missing in Add Item/import | Confirm you are in the correct school; check category permissions; create the category first and use the exact name in import. |
| Import says a row was skipped | Review row number, required fields, validation errors, and duplicate item code. Correct the source CSV and import only the unresolved rows. |
| Inventory balance seems wrong | Compare recent transactions and physical count. Check for duplicate receive/issue entries before correcting with an authorized, reasoned adjustment. |
| Requisition is stuck | Check current step, configured approver, and whether the assigned person can access the request. A pending request has not yet been fulfilled. |
| Book is unavailable | Check total/available copies and active loans. Confirm whether a copy is physically returned before increasing availability. |
| Borrower cannot be found | Check whether the student/staff record belongs to this school and the correct name is active. Ask the administrator to resolve the identity record. |
| Loan appears overdue after return | Confirm Return was saved; refresh/reopen the Loans list. Provide loan ID and exact time to the administrator if status and counts disagree. |
| Book/catalogue import created duplicates | Library import creates one record per row; identify the correct records and ask an authorized manager to resolve them without deleting loan history. |
| Report or export is missing | Confirm you have the specific Library Reports or import/export capability. Exports cover catalogue data only, not every transaction or loan. |

When reporting an issue, include the school, module, item code or book title/ISBN, transaction or loan reference, date/time, what you expected, what the screen showed, and whether a save confirmation appeared. Do not send passwords or unnecessary student details in an unapproved channel.

## 12. System owner and administrator notes

- Inventory and Library are separate modules and plan gates. Access to one does not grant access to the other.
- Inventory has distinct view, manage, transact, requisition, and workflow capabilities. Library separates catalogue management, issuing/returning, deletion, and reports.
- Set up a requisition approval chain and test a request before relying on it operationally. Approver eligibility is checked against the configured step.
- CSV imports/exports are catalogue tools, not full-fidelity backups. They omit photos; inventory transaction records, requisition workflow history, and library loan records are not included in those exports. Maintain and periodically test platform-level backups separately.
- Purchase date/origin/supplier/value and photos on an inventory item or library book are metadata snapshots, not purchase-order, supplier, or accounting ledgers. The supplier field is free text.
- Library overdue fine calculation currently defaults to 10 currency units per day if no rate is passed. Confirm this behavior against school policy before communicating fines or collecting money.
- Library issue/return/lost operations update multiple records. Check the success response and then reconcile loan status and available/copy counts. Escalate any mismatch with the record IDs; do not retry blindly, because a repeated action could compound a discrepancy.

## References and source notes

- [Inventory module workflow](module-flows/inventory.md)
- [Library module workflow](module-flows/library.md)
- [User Guide](USER_GUIDE.md)
- [School Administrator Guide](SCHOOL_ADMIN_GUIDE.md)
- [CHANGELOG.md](../CHANGELOG.md)

**Code and documentation checked:** Inventory and Library screens, route authorization and validation, CSV import/export templates and handlers, `server/config/moduleRegistry.js`, and role defaults. `CHANGELOG.md` checked through v5.194.0; relevant module entries include v5.30.0 (library categories, search, lost-book and borrower views), v5.33.0 (inventory stock and requisitions), and v5.60.0 (purchase details, photos, and catalogue CSV import/export). Checked 2026-10-18. This is an operating guide, not a live audit of an individual school's custom permissions or configured policies.
