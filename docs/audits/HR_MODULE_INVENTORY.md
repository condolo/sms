# HR Module — Evidence-Based Inventory

**Date:** 2026-07-26
**Status:** Research only. No code changed.
**Method:** Direct code reads across `server/routes/hr.js`, `server/routes/teachers.js`, `server/routes/departments.js`, `server/routes/attendance.js`, `server/routes/import-export.js`, `server/config/moduleRegistry.js`, `server/utils/notif-settings.js`, `client/src/pages/hr/*`. Every claim below traces to a specific file:line. This mirrors the audit-before-build discipline that made the Report Card Consolidation Plan and Payroll Phase 1 work: understand what exists before deciding what to build.

---

## 1. Capability Inventory

### Employee Management — **Partial**

**What exists:** `server/routes/teachers.js` is a full, tenant-scoped (`tenantModel`, ADR-0001-compliant) CRUD module — `GET/POST/PUT/DELETE /api/teachers`, bulk delete, self-service `GET/PUT /api/teachers/me`, optimistic locking on update. `TeacherCreateSchema` (teachers.js:23-58) is rich: identity fields, `title`, `qualifications`, `specialization`, `subjects[]`, `classes[]`, `houseId`, `joinDate`, `contractType` (enum), `status`, `staffType`, `departmentId`, `formClassId`, `extraRoles[]` (incl. `hod`/`class_teacher`/`deputy`/`principal`), sensitive fields (`nationalId`, `nssfNo`, `shaNo`, `kraPinNo`), `nextOfKin{}`. Sensitive-field stripping by role exists (`_stripSensitive`, teachers.js:78-99). Client: `StaffFormModal.jsx` / `StaffDetailPanel.jsx` expose essentially the full schema.

**What's missing / inconsistent:**
- **Two collections both partly model "staff."** `teachers` holds the rich HR profile but is *teaching-staff-only*; `payroll`/`documents`/`leave` key off `staffId` against the broader `users` population (hr.js:141-143 says so explicitly). A non-teaching staff member has nowhere to hold a KRA PIN. This is the same gap the Payroll Phase 1 architectural review already found and *deliberately did not fix* — correctly, per that review's own reasoning (no calculation currently reads those fields) — but it's still open, and every new HR feature that touches "the employee" will hit it again.
- No formal employment history — `contractType`/role changes overwrite the field in place (teachers.js:307-351); only `payroll_history` preserves any kind of record, and that's payroll-specific.

### Departments — **Partial**

**What exists:** `server/routes/departments.js`, fully tenant-scoped, full CRUD, soft-delete blocked if active subjects reference it. `DeptSchema` includes `hodId`/`hodName`. Linked to employees via `teacher.departmentId`.

**What's missing / inconsistent:**
- **HOD is modeled twice, never synced.** `departments.hodId/hodName` (set directly on the department doc) vs. a teacher's own `extraRoles: ['hod']` flag — no route cross-updates one when the other changes.
- **Permission registry gap (real bug):** `departments.js` gates create/update/delete via `rbac('departments', 'create'|'update'|'delete')`, but `moduleRegistry.js` has **no `'departments'` module entry at all** — only a combined `subjects` entry with one shared sub-permission. Since `rbac()` denies when the module key doesn't exist in a role's permission set, **no admin can currently grant a custom role department-management rights through the Roles & Permissions UI** — only superadmin (which bypasses RBAC entirely) can manage departments.

### Positions / Designations — **Missing**

No entity exists. "Job title" is a free-text `title` field or the `staffType` string, which is directly conflated with system *role* (the same value drives permissions). No `reportsTo`/`managerId` field, no org-chart concept, anywhere in the codebase.

### Leave — **Production Ready**

Full submit → configurable multi-step approval chain → HR final confirmation, reusing the generic `workflow-config.js` engine (same engine Payroll's approval chain reuses — good, no duplication). Platform floor of ≥2 configured steps enforced. Non-HR staff see their own requests plus any pending request they're currently eligible to act on. Well-built.

**One inconsistency worth naming:** notifications for Leave go through a bespoke internal mechanism (`_sendSystemMessage`, writing to the `messages` collection directly — hr.js:225-272), not the platform-standard `dispatchNotification`/`notif-settings.js` pathway that Payroll, Behaviour, Report Cards, and Finance all use. It works, but it's a second, parallel notification system.

### Staff Attendance — **Missing**

`server/routes/attendance.js` tracks **only students** (`AttendanceRecordSchema` requires `studentId`+`classId`). No staff clock-in, attendance log, or leave-balance concept exists anywhere. The HR dashboard's "On Leave" stat is derived from a static `teachers.status` field, not any real attendance signal — there is nothing to be "on leave" *from*, attendance-wise.

### Staff Documents — **Partial**

Full CRUD (`hr.js`), tenant-scoped, `staffId`-keyed. `fileUrl` is a validated URL string — **metadata only, no actual file-storage integration**. No server-side expiry automation: the client computes an "Expired" badge purely in the browser from `expiryDate`; nothing server-side transitions `status` or notifies anyone when a document expires.

### Payroll — **Production Ready**

Full lifecycle (`draft → confirmed → paid`), Kenyan statutory deductions (PAYE/NSSF/SHIF/Housing Levy), school-configurable approval workflow (reusing `workflow-config.js`), payslip PDF + HTML generation, a `payroll_history` audit trail preserved whenever a locked record is edited, CSV export gated by its own dedicated permission, self-service payslip access. This is the one area of HR that's been through a full build-out (Payroll Phase 1, Steps 1-8) and it shows.

### Recruitment — **Missing**

Exhaustive search (server + client) for recruitment/applicant/candidate/job-posting/vacancy/interview/hiring found nothing. No routes, no models, no UI. Confirmed absent, not partial.

### Performance Management — **Missing**

`staff_documents`' `type` enum includes `'appraisal'` as one of five allowed document-type tags — but that's it: no ratings, goals, review cycles, or manager sign-off fields anywhere. It's a file-upload label, not a review workflow. **`client/src/pages/website/PlatformPage.jsx:39` markets "appraisal tracking"** — that copy overstates what actually exists and should be corrected regardless of whether a real Performance module gets built.

### Reports (beyond the dashboard) — **Missing**

No headcount-over-time, payroll-totals-trend, leave-utilization, staff-turnover, or department-breakdown report exists anywhere. Only the one summary endpoint below.

### Dashboard — **Partial**

`GET /api/hr/summary` returns five numbers (`totalStaff`, `activeStaff`, `onLeave`, `pendingLeaves`, `totalNetPayroll`, `payrollCount`) via three parallel aggregations. Client renders exactly five `StatCard` tiles — no charts, no trends. Functional but minimal.

### Notifications — **Partial**

`notif-settings.js`'s `EVENT_REGISTRY` has exactly **one** HR-group event: `payroll_status_changed` — registered *and* correctly wired (fired from `PATCH /payroll/:id/status`). Leave has no registered event (uses the bespoke internal mechanism noted above). Document expiry has **zero** notification of any kind, registered or otherwise.

### Permissions — **Broken** (the most consequential finding)

`moduleRegistry.js`'s `hr` module declares 6 sub-permissions: `staff`, `leave_view`, `leave_approve`, `payroll_view`, `payroll_export`, `documents`.

- **5 of the 6 are dead** — `staff`, `leave_view`, `leave_approve`, `payroll_view`, `documents` are never passed to any `rbac()` call anywhere in `hr.js`. (Confirmed by direct grep across all of `server/`, not just `hr.js`.)
- **`payroll_export` is the one exception and *is* correctly wired** — but in `import-export.js` (built this session, Payroll Phase 1 Step 8), not `hr.js`. Worth noting precisely because it shows the pattern *can* work when a route deliberately uses a declared key — the other 5 simply never got connected.
- **Every actual `rbac('hr', …)` call in `hr.js` uses a key that isn't declared in `moduleRegistry.js` at all** — `read`, `create`, `update`, `delete`, `manage_workflow`. These aren't sub-permissions a school admin can see or toggle in the Roles & Permissions UI; they're just generic CRUD verbs that happen to always resolve however the role's blanket `hr` grant is configured.
- **Several routes have no RBAC check beyond `authMiddleware`** — any authenticated user can hit `GET /leave`, `POST /leave`, `PATCH /leave/:id/advance`, `GET /payroll/mine`, `PATCH /payroll/:id/advance`, `GET /payroll/:id/pdf`, `GET /documents` (each has its own narrower internal ownership check where it matters, e.g. "only your own leave/payslip," but there's no coarse module-level gate).
- Combined with Departments' missing `moduleRegistry` entry, the practical effect today is: **a school admin cannot meaningfully delegate HR permissions to a custom role at all** — the permission model that's supposed to control this is almost entirely disconnected from what the routes actually check.

Note: `teachers` is a *separate* module in `moduleRegistry.js` (`list`/`detail`/`create`/`edit`/`delete`/`export`/`import`) from `hr` — that one wasn't audited for enforcement in this pass but wasn't flagged as broken either.

---

## 2. Classification Summary

| Area | Status |
|---|---|
| Payroll | **Production Ready** |
| Leave | **Production Ready** |
| Employee Management | Partial |
| Departments | Partial |
| Staff Documents | Partial |
| Dashboard | Partial |
| Notifications | Partial |
| Positions / Designations | Missing |
| Staff Attendance | Missing |
| Reports (beyond dashboard) | Missing |
| Recruitment | Missing |
| Performance Management | Missing |
| **Permissions** | **Broken** |

---

## 3. Architectural Inconsistencies (ranked by how many future features they'll bite)

1. **Permission registry vs. actual enforcement are almost entirely disconnected** — for both `hr.js` and `departments.js`. This isn't cosmetic: it means custom-role delegation for the entire HR domain doesn't really work today. Every new HR route added on top of this pattern inherits the same gap.
2. **Two "employee" models** (`teachers` = rich profile, teaching-only; `users` = broad population, thin profile) with no unifying entity — already worked around once (Payroll), will need working around again for Attendance/Recruitment/Performance if those get built.
3. **HOD modeled twice** (`departments.hodId` vs. `teacher.extraRoles`), never synced.
4. **Two parallel notification pathways** — the platform-standard `dispatchNotification`/`notif-settings.js` system (Payroll, Behaviour, Report Cards, Finance) vs. Leave's bespoke internal messaging.
5. **"Appraisal" document tag creates a false impression of a Performance module**, and public marketing copy actively overstates it — a documentation/reality gap independent of whether the real feature gets built.
6. **Positions/Designations conflated with system role** (`staffType` drives both "what this person's job is" and "what they're allowed to do in the system") — fine today, would become a real problem the moment Recruitment or an org chart needs "job title" independent of "system permission tier."

---

## 4. Roadmap — Ordered by Dependency

This is a proposed sequencing, not a commitment — per your instruction, implementation waits for your review of this order.

1. **Permissions/RBAC reconciliation.** Reconcile `moduleRegistry.js`'s declared HR/Departments sub-permissions with what `hr.js`/`departments.js` actually check; add the missing `departments` module entry; close the routes that currently have no module-level gate. Foundational — every other HR feature either inherits this gap or has to route around it individually. Cheapest, highest-leverage fix on this list.
2. **Departments HOD desync.** Small, contained, naturally bundled with #1 since it's the same file.
3. **Employee Management — targeted fixes only**, not a redesign. Decide, with evidence (not assumption), whether the `teachers`/`users` split needs a real bridging concept yet, mirroring how Payroll Phase 1 Step 5 correctly declined to build a speculative Employee Profile. Only build what a concrete next feature (below) actually needs.
4. **Staff Attendance.** Genuinely large, greenfield — deserves its own scoping pass (like Payroll got before Payroll Phase 1 started) before any code, including a decision on how big a first version should be (simple leave-day tracking vs. full clock-in system).
5. **Notification standardization.** Fold Leave onto `dispatchNotification`/`notif-settings.js`; add document-expiry notifications. Depends on Employee/Attendance being stable enough that "who gets notified" is well-defined.
6. **Reports/Dashboard expansion.** Trend reports, department breakdown, leave utilization — these aggregate across Employee/Departments/Attendance/Payroll, so they naturally come after those are correct, not before.
7. **Recruitment** — large, greenfield, no existing foundation to build on. Per the standing customer-driven-development filter, this needs an explicit "does this unblock a customer today" check before starting, not an assumption that it should be built next just because it's on the capability list.
8. **Performance Management** — same treatment as Recruitment: explicit go/no-go first. Independent of that decision, the "appraisal tracking" marketing copy should be corrected to match reality regardless.

Positions/Designations isn't its own phase — build it only when Recruitment or an org-chart need actually requires it, per the same "don't build ahead of demonstrated need" reasoning already applied successfully in Payroll Phase 1.
