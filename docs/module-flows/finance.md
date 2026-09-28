# Finance

Use the detailed [Finance Guide](../FINANCE_GUIDE.md) for fee structures, invoice generation, payments, M-Pesa, overdue accounts, and exports.

1. Set up fee types and a fee structure for the right year/term and student/class scope.
2. Review the structure, then generate invoices and inspect totals before issuing them.
3. Open the student's invoice to record a payment with amount, date, method, and reference. Confirm the resulting balance/status.
4. Review overdue and summary views; use export only for authorized business purposes and store downloaded files securely.
5. Configure M-Pesa only with verified platform credentials and test the payment flow before relying on it operationally.


## Setup, updates, and verification

### Set up fees and maintain balances

Before generating invoices, confirm the academic period, fee items, fee structure, student/class scope, discounts, and any auto-generation rules. Preview totals and invoice counts; issue only after checking a sample student and approving the batch. Record receipts against the correct invoice and verify the remaining balance. Correct mistakes through the supported void/refund/adjustment process with an audit reason; do not overwrite balances directly. Reconcile payment-provider transactions before treating an online payment as settled.

**Access:** Finance role permissions govern invoices, payments, fee structures, imports, exports, and M-Pesa configuration. Void/payment correction actions are more sensitive than read access.

**Sources:** `client/src/pages/finance/`; `server/routes/finance.js`, `mpesa.js`, `billing.js`; [School Administrator Guide](../SCHOOL_ADMIN_GUIDE.md#13-data-export--backup).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.61.0–v5.68.0 for fee items, discounts, admission invoices, and payment display.
