# Finance

## Single source of truth

Use the [Finance Officer Guide](../FINANCE_GUIDE.md) for the full accounts-office workflow: fee settings and structures, invoice creation and import, term billing, transport/activity charges, discounts, payments and receipts, M-Pesa, overdue follow-up, and reconciliation. It is the only detailed user-facing Finance procedure; this index page intentionally does not duplicate its steps.

## Quick route map

- **Finance → Overview:** collection totals and current financial summary.
- **Invoices:** search, filter, issue draft admission invoices, void eligible invoices, and import invoice CSVs.
- **Payments:** record payments and print receipts.
- **Fee Structure → Fee Settings:** fee types, discount policies, and overdue reminder schedule.
- **Extra-Curricular:** activity catalogue and student enrolments.
- **Term Billing:** preview and generate term invoices for transport and activity charges; manage eligible term early-payment confirmations.
- **Overdue:** review overdue balances and export the overdue list as CSV.

Role grants are granular. In particular, **Run Term Billing**, **Confirm Early Payment**, and **Manage Extra-Curricular Activities & Enrolments** are explicit grants; a general Finance grant does not imply them. Check the main guide and current Settings permissions when an action is unavailable.

## Sources and change history

Current UI: `client/src/pages/finance/`. Server behavior: `server/routes/finance.js`, `server/routes/import-export.js`, `server/routes/transport.js`, `server/routes/extracurricular.js`, and `server/utils/term-billing.js`.

Always check [CHANGELOG.md](../../CHANGELOG.md) before following or changing this workflow. Finance changes include v5.169.0–v5.169.3 (term billing, reminder/discount rules, explicit permissions, bulk activity enrolment) and v5.179.0–v5.180.0 (permission-save and backfill fixes). The main [Finance Officer Guide](../FINANCE_GUIDE.md) was reconciled through v5.194.0 on 2026-10-16.
