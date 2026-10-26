# Analytics Dashboard

Analytics is a permission key that may appear as dashboard cards or embedded analytics rather than a standalone sidebar module.

1. Open the school dashboard or the relevant analytics view.
2. Select the available academic period/class filters and note the reporting date range.
3. Use the cards/charts to identify a trend, then open the underlying module to review individual records.
4. Do not treat a chart as a replacement for a source register, ledger, or published report card.

Some analytics are role-scoped and some use separate group-analytics access. If a panel is missing, check role permissions and the reporting scope; do not broaden a role solely to make one chart appear without reviewing its data exposure.

As of v5.211.0, the Reports & Analytics dashboard's own tabs (Attendance, Finance, Behaviour, Enrollment — not Overview or Academic) are each independently grantable in Settings → Roles & Permissions, under the "Reports & Analytics" module. A role missing one of these simply doesn't see that tab's button, and Overview's own Finance/Behaviour KPI tiles follow the same grants. Granting a role "Reports & Analytics" alone no longer hands it every tab — each one needs its own checkbox.


## Setup, updates, and verification

### Configure and verify analytics

Confirm the academic year/term and the user's intended class or school scope before relying on a chart. If the dashboard offers group analytics configuration, restrict it to the groups and indicators the role should see. After changing source records, reopen or refresh the dashboard and compare a sample against the owning register or report. A missing panel can mean permission/scope restrictions, not missing source data.

**Access:** Analytics dashboard view and Reports view are separate registry permissions.

**Sources:** `client/src/pages/Dashboard.jsx`, `client/src/pages/reports/ReportsPage.jsx`; `server/routes/analytics.js`; `server/config/moduleRegistry.js`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.69.0 for school-wide academic analytics.
