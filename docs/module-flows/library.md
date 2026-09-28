# Library

## Catalogue and lending

1. Open **Library** and review the catalogue. Search before adding a duplicate book/item.
2. Authorized librarians add or edit catalogue records and verify available copies.
3. Issue a book to the correct student using the issue action and due date.
4. On return, open the loan and mark it returned. Use the lost/overdue action only after confirming the physical status.
5. Review summaries/reports for outstanding loans and stock counts.


## Setup, updates, and verification

### Maintain catalogue and loan records

Before importing or adding books, search the catalogue and check ISBN/title to avoid duplicates. Keep copy counts accurate and use the issue/return workflow so availability follows active loans. When a loan is overdue, confirm the book's actual status before marking lost or charging a fee. Update a catalogue record through its edit action; verify current copies and outstanding loans after bulk imports or corrections.

**Access:** Library permissions distinguish catalogue management, deletion, issuing/returning, and reports. Student/parent views may only show records relevant to that account.

**Sources:** `client/src/pages/library/LibraryPage.jsx`; `server/routes/library.js`; [User Guide](../USER_GUIDE.md#17-role-reference).; [CHANGELOG.md](../../CHANGELOG.md)
