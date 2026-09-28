# Settings

## Account and school configuration

1. Open **Settings** and choose the relevant area: account/profile, school profile, academic setup, notifications, branding, users, roles/permissions, or module configuration.
2. Change only the fields you are authorized to manage; review the displayed school context before saving.
3. Save and confirm the success state. For high-impact changes—permissions, academic-year archival, branding, integration credentials—record the reason and verify the effect in the relevant module.

## Users and permissions

Use the dedicated user invite/edit flow for accounts. Assign the minimum role and module permissions required. A role label is a display name; it does not change the underlying authorization role. Module visibility, subscription entitlement, and role permission are separate controls. When configuring a role or a per-user override, you can never hand out more than your own account currently holds — the form only offers what you have; there is no case where a lower-privileged admin can grant a permission back to themselves or anyone else that they don't already have.

If inviting someone returns "an inactive account already exists" instead of creating a new login, they (or someone with that email) were removed before, not new — open the **Removed** panel and use its one-click **Reactivate** instead of treating it as a dead end; reactivating restores login with a fresh temporary password rather than creating a second, disconnected account.


## Setup, updates, and verification

### Change settings safely

Identify whether the setting is school-wide or platform-wide and use the matching administrator guide. Before changing academic years, permissions, integrations, or module availability, record the current value and expected effect. Make one controlled change, save, then verify it in the affected module using an account with the intended role. If a permission change has no effect, inspect the specific action grant, entitlement, and data scope; navigation visibility alone does not prove server authorization. After creating or editing an academic year's terms, verify the new term dates actually appear in Exams, Finance, and Students, not just in Settings itself — a year created or edited here in the past could show blank term dropdowns elsewhere even though the dates were saved correctly.

**Access:** Settings operations have different permissions for school settings, users, roles/permissions, and system information. Platform-wide settings belong to the platform admin, not school settings.

**Sources:** `client/src/pages/settings/SettingsPage.jsx`; `server/routes/settings.js`; [School Administrator Guide](../SCHOOL_ADMIN_GUIDE.md), [Platform Administrator Guide](../PLATFORM_ADMIN_GUIDE.md).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.129.0 for the academic-year term-date normalization fix, v5.133.0 for the permission self-escalation guard, v5.136.0 for the Removed/Reactivate flow, and v5.144.0 for the staff-role list now matching HR's and Payroll's exactly (Principal was missing before). Also see the current [permission control contract](../audits/PERMISSION_CONTROL_CONTRACT_2026-09.md).
