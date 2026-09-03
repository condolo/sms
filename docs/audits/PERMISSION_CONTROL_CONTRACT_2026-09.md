# Msingi — Permission Control Contract — 2026-09-03

Documentation only. **No application code was changed to produce this
document.** Every classification below is cited to a specific file:line,
or was confirmed by reading the actual code path end to end — never
assumed from a UI label or a comment alone.

This document exists because of a real production incident: an admin
enabled Admissions permissions for a role in Settings → Roles &
Permissions, and it had no visible effect for one specific person (Ann
Wanjiku). That root cause is fixed (see
[PLAT-01/RBAC session addendum below](#appendix-the-incident-that-triggered-this-document)),
but answering it exposed a broader question: **does Settings actually
control everything it appears to control?** This is the definitive
answer.

---

## 1. Classification method

Every control in Settings → Modules and Settings → Roles & Permissions is
classified as exactly one of:

| Classification | Meaning |
|---|---|
| 🟢 **REAL** | Changing this control changes the corresponding backend authorization. Verified by finding the real route(s) it gates and confirming they check the exact action/sub-key this control writes. |
| 🟡 **PARTIAL** | The control affects *some* of the operations a reasonable admin would expect it to, but not all of them. |
| 🔴 **DECORATIVE** | The UI displays the control and lets an admin toggle it, but no route independently checks the specific thing it claims to gate — toggling it has an effect only insofar as it happens to be unioned into a *different*, coarser check. |

A DECORATIVE sub-row is not necessarily *inert* — see §2 below. It means
the row does not do what its own label implies in isolation.

---

## 2. The two layers, and why they get different verdicts

Every module in `MODULE_REGISTRY` (`server/config/moduleRegistry.js`, 29
modules) has two things Settings can control:

**A. The module's coarse grant** — whether a role/user can `read` /
`create` / `update` / `delete` *anything* in this module at all. This is
computed by `_deriveApiPerms` (`server/routes/settings.js:76-92`) as the
**union** of every sub-row's V/E/D, and is what any route calling
`rbac(module, action)` with no third argument reads.

**B. Individual sub-row independence** — whether toggling *one specific
row* (e.g. "Export Students" without "View Student List") has an effect
*different* from toggling any other row in the same module. This
requires the actual route to call `rbac(module, action, subKey)` with
that row's exact key. Most routes don't.

**Verdict for A, universally, every module: 🟢 REAL.** Proven by the
100%-coverage RBAC audit (`scripts/verify-rbac-coverage.js`, 481/481
endpoints gated) and directly, repeatedly, mutation-tested this session.
Turning every row in a module off genuinely removes access to that
module's routes; turning any row on genuinely grants the coarse action it
maps to. **This is not in question anywhere in this document.**

**Verdict for B varies per module** — this is what the rest of this
document classifies, row by row, because it's the one an admin can
easily misread as "I granted X but not Y" when the backend doesn't
actually distinguish X from Y.

---

## 3. Module-by-module sub-row classification

Legend: 🟢 REAL sub-row (independently enforced) · 🔴 DECORATIVE sub-row
(collapses into the module's coarse grant, same as every other row in
that module).

### 🟢 Fully real (every declared row independently enforced)

| Module | Rows | Evidence |
|---|---|---|
| **medical** | view 🟢 · record 🟢 · delete 🟢 · alerts 🟢 · reports 🟢 | `server/routes/medical.js:78,111,122,170,206,254` — every route passes its row's exact sub-key. `alerts` is the deliberately narrower one (condition flags only, not the full record) — genuinely, independently gateable from the rest. |
| **inventory** | view 🟢 · manage 🟢 · transact 🟢 · requisition 🟢 · workflow 🟢 | `server/routes/inventory.js` — all 5 rows used across categories/items/transactions/requisitions/workflow-config routes. |

### 🟡 Partial (some rows real, some decorative)

| Module | Real rows | Decorative rows | Evidence |
|---|---|---|---|
| **hr** | leave_approve 🟢, payroll_view 🟢, payroll_export 🟢, documents 🟢 | staff 🔴, leave_view 🔴 | `server/routes/hr.js:459,592,687,1221,1248,1309,1339,1357`; `payroll_export` via `server/routes/import-export.js:1552` (its own `EXPORT_MODULE` map). **`GET /leave` and `GET /documents` have no `rbac()` call at all** (`hr.js:186,1283`) — self-scoped in-handler instead ("own record, or HR_ROLES for any"), meaning `leave_view` isn't just decorative, it's **not governed by Settings in any form** for that endpoint. |
| **library** | issue 🟢, manage 🟢, delete 🟢, reports 🟢 | view 🔴 | `server/routes/library.js:131,199,223,250,309,364,412,447,464`. Every `GET` list/detail route (`:119,160,186,276`) uses plain `rbac('library','read')` — no sub-key. |
| **hostel** | manage 🟢, assign 🟢, delete 🟢 | view 🔴 | `server/routes/hostel.js:113,136,159,221,255,287,344,406`. Every `GET` route (`:79,100,185,208,312,443`) is coarse-only. |
| **transport** | manage 🟢, assign 🟢, delete 🟢 | view 🔴 | `server/routes/transport.js:108,131,154,211,265,293`. Every `GET` route (`:71,95,180,307`) is coarse-only. |
| **timetable** | rooms 🟢 (via `server/routes/rooms.js:76,107,136`) | view 🔴, edit 🔴, bell_schedule 🔴, assignments 🔴, import 🔴, export 🔴 | Only "Manage Rooms" is independently gated; the other 6 rows shown for Timetable all collapse into the module's shared coarse grant. |
| **growth_profile** | aspirations 🟢 (via `server/routes/growth-recommendations.js:155,181`) | view 🔴, add_records 🔴, edit_records 🔴, delete_records 🔴, projects 🔴, recommendations 🔴, verify 🔴 | Only 1 of 8 declared rows is real. |
| **settings** | *(see note)* | school 🔴\*, users 🔴, permissions 🔴, system 🔴 | \*A `rbac('settings', action, 'school')` sub-key genuinely exists — but it's used exclusively by `server/routes/sections.js:194,224,262` (Classes → Sections), an unrelated feature that happens to reuse the `settings`/`school` key pair. **None of Settings' own routes** — `PUT /school` (`settings.js:316`), `PUT/POST /users/*`, custom roles, SMTP, notifications — pass any sub-key; all are coarse `rbac('settings', action)`. So every row an admin actually sees under "Settings" in the R&P grid is decorative for what it visibly labels. |

### 🔴 Fully decorative (every declared row collapses into the coarse grant)

**students, teachers, classes, attendance, subjects, lessons, grades,
exams, assessment, report_cards, elearning, admissions, behaviour,
finance, messages, events, resources, weekly_snapshot, reports,
analytics** — 20 modules, confirmed by an exhaustive sweep of every
`rbac(...)` call across the entire `server/` tree: none of these
modules' names appear anywhere with a third (sub-key) argument in
production code.

Notable because it's easy to assume otherwise: **`finance`** has 9
declared rows (`invoices`, `create_invoice`, `void_invoice`, `payments`,
`record_payment`, `print`, `fee_structure`, `import`, `mpesa`) —
including exactly the kind of row a school would most want isolated
("View Invoices" without "Void Invoice" access). **None are wired.**
Every `finance.js` route uses plain `rbac('finance', action)`
(`server/routes/finance.js` — 21 call sites, zero sub-keys). A test file
(`role-architecture-verification-matrix.test.js`) exercises
`hasPermission(..., 'finance', 'create', 'void_invoice')` directly — this
proves the *mechanism* works generically, not that any real Finance
route enforces it. Don't read that test as evidence Finance is wired;
it isn't.

**students** and **teachers** each have 7 rows (List / Profile / Create /
Edit / Delete / Export / Import) — the exact scenario from this
session's original question. All 7 are decorative for both modules.

### Summary count

- 🟢 Fully real: **2 modules** (medical, inventory)
- 🟡 Partial: **7 modules** (hr, library, hostel, transport, timetable,
  growth_profile, settings)
- 🔴 Fully decorative: **20 modules**
- **Total sub-rows across the registry: 143. Independently enforced: 21
  (14.7%).**

---

## 4. Per-user overrides

🟢 **REAL, as of the 2026-09 fix in this same session.** Previously
🔴 in one specific, real-data-confirmed failure mode: a legacy per-user
override document (predating the 2026-08 remediation) containing a bare,
zero-filled coarse key with no matching sub-key could silently suppress
a role's real grant. Fixed in `server/middleware/rbac.js`'s
`_mergeUserOverrides`, and the previously-independent sidebar/session
copy in `server/routes/auth.js` now delegates to that same function —
see the commits immediately preceding this document
(`c78d09f`, `fe4270a`, `a957aed`).

---

## 5. Authorization mechanisms that exist entirely outside Settings

These are not bugs — each is a deliberate, separate mechanism — but none
of them appear anywhere in Settings → Roles & Permissions, and an admin
using that screen as their only reference will not see them.

### `extraRoles[]` — narrow, route-specific grants

- **What it grants:** HOD (department-scoped assignment management),
  Class Teacher, Timetabler, Exam Officer, Deputy, Principal — checked
  directly against the JWT's `extraRoles` array in exactly **three**
  route files: `server/routes/lessons.js:49-50`,
  `server/routes/teaching-assignments.js:53-54`,
  `server/routes/weekly-snapshots.js:45-46` (each builds an "effective
  roles" set of `role + roles[] + extraRoles[]` for its own internal
  checks). A fourth, narrower usage:
  `server/routes/hr.js:287` matches a leave-workflow approval step's
  configured "assignee" against a user's `extraRoles`, `role`, or
  `roles` — a routing rule, not a general grant.
- **Where configured:** HR → Add/Edit Staff Member → "Roles &
  Responsibilities" checkboxes (`teachers.extraRoles[]`,
  `server/routes/teachers.js:56,86-95`).
- **Does NOT touch:** `role_permissions` at all. Revoking someone's role
  in Settings → Users does not clear their `extraRoles` — a former HOD
  who's since been changed to `teacher` in Settings keeps HOD-scoped
  access in those three routes until someone separately unchecks it in
  HR.

### `sectionAssigned` — data-scoping, not a grant

- **What it does:** Narrows *which records* a `section_head`-role user
  can see — it doesn't grant a new action, it scopes an already-granted
  one. Read by `server/middleware/scopeMiddleware.js:126-132` to filter
  queries to the assigned section's class/subject ids.
- **Where configured:** Classes → Sections → assign a Section Head
  (`server/routes/sections.js`).
- **Does NOT touch:** `role_permissions`, and is not cleared
  automatically when the person's role changes elsewhere
  (`sections.js:92-99` only clears it when someone else is assigned to
  that section, per the PLAT/RBAC audit's earlier finding).

### Platform operator tier

- **What it grants:** Full cross-school access (impersonation, school
  creation/deletion, billing) for `support`/`owner`-tier platform staff.
  Entirely separate authentication (`platform_token` cookie,
  `PLATFORM_JWT_SECRET`), separate from any school's JWT.
- **Where configured:** The Platform Console (`platform.html`), not
  Settings. **This is intentionally separate** — a school's own Settings
  screen should not be able to grant platform-level power, and doesn't.

### Subscription / plan gates

- **What it restricts:** Whether a module is available *at all*,
  independent of role permissions — `planGate(moduleKey)` checked before
  `rbac()` on every gated route (e.g. `admissions` requires only the
  `core` tier; others require higher tiers — see
  `server/middleware/plan.js`'s `FEATURE_PLAN` map).
- **Where configured:** Billing/subscription management, not Settings →
  Roles & Permissions. **Also intentionally separate** — a school admin
  correctly cannot grant themselves a higher plan tier from their own
  Settings screen.

---

## 6. The direct question

> **Can a normal school administrator safely use Settings → Modules and
> Settings → Roles & Permissions as the *authoritative* interface for
> managing staff access?**

**For whole-module access: yes.** Turning a module off, or a role's V/E/D
for that module off, reliably removes access — this is the one thing
Settings is completely, verifiably authoritative over, and it's the
control most schools will actually use most of the time.

**As a complete, granular map of every access decision in the system: no.**
Three concrete reasons, in order of how likely each is to actually
mislead an admin:

1. **85% of the sub-row granularity Settings displays doesn't exist in
   enforcement.** An admin who unchecks "Void Invoice" while leaving
   "View Invoices" checked, believing they've narrowed a Finance
   clerk's access, has changed nothing — that person still has full
   Finance create/update/delete, because Finance was never
   independently enforced at the sub-row level at all. This is the
   single highest-risk case in the whole document: it's not merely
   *incomplete*, it actively invites an admin to believe they performed
   a restriction they did not perform.
2. **`extraRoles[]` is a second, invisible authorization channel.** An
   admin who changes someone's role in Settings, or revokes a module
   grant, may reasonably believe that removed all of that person's
   access — while a leftover HOD/Class Teacher/Timetabler/Exam Officer
   checkbox in HR still grants real access in three specific,
   department- or class-scoped routes, with no corresponding row
   anywhere in Settings to show it.
3. **`sectionAssigned` can silently survive a role change.** Same shape
   of problem as #2, for Section Head data-scoping specifically.

Platform-tier access and plan gates are correctly, deliberately outside
this picture — not a finding, a design choice this document endorses.

---

## 7. UI controls that currently create a false impression of granular control

Every 🔴 row in §3's tables. Concretely, by module, the specific rows a
school admin can click today that do not do what their label says in
isolation:

- **Students** (all 7): List, Profile, Create, Edit, Delete, Export,
  Import
- **Teachers** (all 7): same shape as Students
- **Finance** (all 9): View Invoices, Create Invoice, **Void Invoice**,
  View Payments, Record Payment, Print Receipts, Manage Fee Structures,
  Import, Configure M-Pesa
- **Grades** (all 6): including "Review/Approve Mark Submissions" and
  "Generate/Publish Report Cards" — both sound like exactly the kind of
  sensitive, separately-gateable action a school would want isolated;
  neither is
- **Admissions** (all 6): including "Move Pipeline Stage" and "Delete
  Applicant"
- **Behaviour** (all 4), **Exams** (all 5), **Attendance** (all 4),
  **Classes** (all 7), **Messages** (all 3), **Events** (all 5),
  **Report Cards Settings** (all 3, including the approval-workflow row),
  **Assessment Scheduling** (its 1 row), **eLearning** (all 5),
  **Resources** (all 4), **Weekly Snapshot** (both), **Reports** (both),
  **Analytics** (its 1 row)
- **HR**: "View Staff Records", "View Leave Requests"
- **Library**: "View Catalogue & Records"
- **Hostel**: "View Rooms & Allocations"
- **Transport**: "View Routes & Vehicles"
- **Timetable**: View, Edit, Bell Schedule, Manage Teaching Assignments,
  Import, Export (only "Manage Rooms" is real)
- **Growth Profile**: View, Add Records, Edit Own Records, Delete
  Records, Projects, Write Recommendations, Verify/Approve (only "Edit
  Aspirations" is real)
- **Settings**: Edit School Settings, Manage Users/Invites, Manage Roles
  & Permissions, View System Info (all 4 — the one real `school` sub-key
  in the codebase serves an unrelated feature, not this row)

---

## 8. What this document does not recommend

Per instruction, no scope decision is made here. In particular: this
document does **not** recommend threading `subKey` through all 122
currently-decorative rows. That's a large, module-by-module effort, and
before any of it starts, someone needs to decide — module by module —
what each row is actually *supposed* to mean operationally, not just
which string to pass to `rbac()`. This document is the baseline that
decision would start from, not the decision itself.

---

## Appendix — the incident that triggered this document

Full trace: `docs/audits/ROLE_ARCHITECTURE_AUDIT_2026-08.md` (the
original staffType/role separation and per-user-override architecture)
and this session's fix commits `c78d09f`, `fe4270a`, `a957aed` (the
bare-coarse-key merge gap, the auth.js/rbac.js duplicate-implementation
fix, and the tooling fixes that came with tracing it).
