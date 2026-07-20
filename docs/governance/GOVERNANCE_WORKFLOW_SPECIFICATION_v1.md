# Governance & Workflow Specification v1

**Status:** Draft — for review, not an ADR, not an implementation plan.
**Purpose:** Stabilize the governance model across five product areas (Leave Management, Growth Profile, Marks Editing, Deactivated Users, Resources) plus one platform-wide principle (permission-driven workflows), before any of it is coded.
**Explicitly not in scope:** New architecture, new ADRs, redesigns of existing modules. Every section below states what already exists, what's confirmed-unchanged, and what's genuinely new — grounded in direct reads of the current codebase, not assumption.

---

## 0. Platform Principle — Permission-Driven Workflows

### What "permission-driven, not role-name-driven" actually means here

The RBAC engine itself (`server/middleware/rbac.js`) is already genuinely configurable: permissions live in a `role_permissions` collection keyed by `{schoolId, roleKey}`, with per-user overrides (`{schoolId, userId}`) that win over role defaults. Only `superadmin` is hardcoded as a bypass. This part of the platform already matches the principle.

**The gap is elsewhere.** A direct search across `server/routes/` found roughly 55 places where *privileged or administrative* actions — locking an exam, publishing a report card, approving a mark-unlock request, sending a school-wide broadcast — check a hardcoded role-name list inline (`['admin','superadmin'].includes(role)`, `role === 'principal'`, etc.) instead of going through `rbac()`. The configurable permission system exists; most of the code that matters for *workflow authority* doesn't use it. There is no concept anywhere today of a school-configurable "who is the approver for X" — no `approverRole`, no `workflowRole`, nothing. That's the actual, concrete thing this principle needs to fix, not a restatement of intent.

### The mechanism (additive, reuses existing patterns — no new architecture)

Introduce a **workflow role assignment** concept, stored the same way `role_permissions` already is (a school-scoped collection, same tenant-isolation posture, same caching approach):

```
workflow_assignments
  { id, schoolId, workflowKey, stepKey, assigneeType: 'role' | 'user', assigneeValue, fallback: { assigneeType, assigneeValue } | null }
```

- `workflowKey` — e.g. `'leave_approval'`, `'marks_unlock'`.
- `stepKey` — e.g. `'hod'`, `'principal'`, `'hr_final'`.
- `assigneeType: 'role'` — resolves to whoever holds that `roleKey` at the relevant scope (e.g. the HOD of *this teacher's* department). `assigneeType: 'user'` — a specific named person (covers "Director" — see §1 below, since Director isn't and shouldn't become a full RBAC role just for this).
- `fallback` — used when the primary resolution finds nobody (the HOD-vacancy case in §1).

A school admin configures this once, in Settings, per workflow. New business logic (leave approval, marks-unlock approval) resolves *"who acts at this step"* by reading this collection — never by checking `role === 'hod'` in code. This is additive (`role_permissions` and `rbac()` are untouched), reuses the exact tenant-scoping and caching pattern already proven there, and is the concrete mechanism that makes "future modules — procurement, disciplinary cases, inventories, finance — follow the same flexible governance model" actually true rather than aspirational.

**What this principle does NOT require:** it does not require retrofitting the ~55 existing hardcoded role checks found in the audit above. Those are pre-existing, working code outside this spec's scope — flagged here for honesty, not proposed for a cleanup pass. The principle applies going forward, starting with the workflows in this document.

---

## 1. Leave Management Workflow

### What exists today

A working, single-step leave system already exists: `server/routes/hr.js`, collection `leave_requests`, status `pending → approved/rejected`. Teacher submits (`POST /api/hr/leave`), whoever holds `hr` RBAC permission resolves it directly (`PATCH /:id/resolve`) — no chain, no HOD/Principal step. No audit log call exists on any of the three leave handlers today. The client UI (`HRPage.jsx`'s Leave tab) has approve/reject buttons calling this single-step endpoint.

**Role reality check:** "HOD" is not an RBAC role today — it's a value inside a teacher's `extraRoles` array, checked ad hoc in a few places (not via `rbac()`). "Section Coordinator" doesn't exist as a role; `section_head` is the closest match. "Director" doesn't exist at all. "Principal" and "HR" are real, existing roles with real permission docs.

### Specification

**State machine** (extends `leave_requests.status` from a binary field to a chain position):

```
pending_hod → pending_principal → pending_hr → confirmed
      ↓               ↓                ↓
   rejected        rejected         rejected  (HR may still reject here even after Principal approved)
```

- Step resolution uses the workflow-assignment mechanism from §0, `workflowKey: 'leave_approval'`, steps `hod → principal → hr_final`.
- **HOD step**: resolved via `assigneeType: 'role', assigneeValue: 'hod'` scoped to the requester's department (reusing `departments.js`'s existing `hodId` field on the department doc — already there, just never wired to an approval flow). If the department has no `hodId` set, automatically route to the configured `fallback` (`section_head`, per the school's own assignment config — not hardcoded).
- **Principal step**: `assigneeType: 'role', assigneeValue: 'principal'`.
- **HR final step**: `assigneeType: 'role', assigneeValue: 'hr'`.
- **Director copy**: `assigneeType: 'user'` (a specific person, since "Director" isn't and doesn't need to become an RBAC role for this) or `assigneeType: 'role'` if a school genuinely has a Director role configured — the school decides at configuration time, the code doesn't assume either way.

**Business rules:**
- Every step transition (approve or reject) writes an `AuditService.log()` entry — `action: 'leave.hod_approved' | 'leave.hod_rejected' | 'leave.principal_approved' | ...`, `actor`, `target: {type:'leave_request', id}`, `details: {comment}`. This is new — no leave action is audited today. Rejection comment is mandatory at the API layer (400 if omitted on a reject action), matching the mandatory-reason pattern already used by `mark-submissions.js`'s unlock endpoint.
- If HOD rejects: the record still advances to visible-to-Principal (not silently closed) — Principal sees the rejection reason and, since every step is now audited, the full trail via a query against `audit_logs` filtered by `target.id`. This reuses `AuditService.query()` (already built, already used by the school-scoped `/api/audit` endpoint) rather than inventing a second history mechanism.
- HR's "reject even after Principal approved" is simply the normal HR-step rejection — nothing special-cased, because the chain doesn't skip HR regardless of earlier approvals.
- **Notification mechanism**: no generic notification service exists in the codebase today (confirmed — no `notifications` collection, no bell icon). The specified "Principal notified on HOD rejection" and "Director copied on final decision" are implemented by auto-generating a `messages.js`-style message (existing infrastructure — collection `messages`, targeted at a specific `userId`, already triggers the existing email side-channel via `notif-settings.js`/`email-queue.js`) rather than building a new notification primitive. This is the "work within approved architecture" answer — flagged explicitly since it's a real design choice, not a formality.

**What's reused vs. new:**
- Reused: `leave_requests` collection (extended status enum, not restructured), `hr.js`'s existing submit route, `departments.js`'s existing `hodId` field, `AuditService.log/query` (unused today, now wired in), `messages.js`'s existing send+email infrastructure.
- New: the chain state machine itself, the `workflow_assignments` collection (§0), audit wiring on every leave transition, the auto-generated notification calls.

---

## 2. Growth Profile

### What exists today (this changes the framing of what "confirm" means)

Two separate modules answer to "growth-related history": **Growth Profile** proper (`growth_leadership`, `growth_activities`, `growth_service`, `growth_awards`, `growth_projects`, `growth_recommendations`, `growth_aspirations` — Academic/Leadership/Activities/Projects/Service/Awards/Recommendations/Aspirations) and the separate **Behaviour module** (`behaviour_incidents`, with the actual points field and interventions/support-adjacent data).

The honest finding: **permanence today is incidental, not guaranteed.** No `growth_*` or `behaviour_*` collection has an academic-year field at all — records aren't scoped to a year because the concept was never added, not because permanence was a deliberate, enforced guarantee. There is no academic-year rollover process anywhere in the codebase that touches these collections.

**Behaviour points**: computed live via aggregation (`$sum: '$points'` over matching incidents) every time the summary endpoint is called. There is no stored running balance and **no reset mechanism exists at all** — "resets at end of academic year" is entirely unbuilt today, not a currently-working feature to confirm.

**Real gap found, worth flagging plainly**: `growth_leadership`/`activities`/`service`/`awards`/`projects`/`recommendations` all support genuine hard `DELETE` (author or admin). `behaviour_incidents` already soft-deletes (`status:'resolved'`, `deletedAt`) — it's the more careful of the two today. Student purge (`DELETE /api/students/purge`) doesn't cascade-delete growth/behaviour records, but doesn't protect them either — they're orphaned, not destroyed, which is safe but not intentional.

### Specification

- **Confirm, don't redesign**: the eight listed categories (behaviour history, interventions, awards, leadership, attendance trends, support history, existing growth records) stay in their current collections, current shapes, current query patterns. No restructuring.
- **Make permanence a stated guarantee, not an accident**: hard-delete routes on `growth_leadership`/`activities`/`service`/`awards`/`projects`/`recommendations` (`growth-records.js`, `growth-projects.js`, `growth-recommendations.js`) convert to the same soft-delete pattern `behaviour_incidents` already uses (`status:'resolved'`, `deletedAt`) — bringing the less-careful half of the module up to the standard the other half already meets. This is a consistency fix within the existing module, not a redesign.
- **Behaviour points reset**: add a `behaviour_points_ledger`-style year-scoped balance (or an `academicYearId` field on a new summary/snapshot doc — implementation detail for the later plan, not this spec) so a reset can zero the *current-year running total* without touching the underlying `behaviour_incidents` history, which is never deleted, never modified, never year-filtered. The reset is a new balance snapshot, not a data-destroying operation. This needs an academic-year-transition hook, which doesn't exist anywhere in the codebase yet — this spec names it as new infrastructure required for this one feature, not a broader rollover system for other modules.

**What's reused vs. new:**
- Reused: all eight collections and their existing routes/UI, unchanged.
- New: soft-delete conversion on the growth-records hard-delete routes (consistency fix), a points-balance-reset mechanism, and the academic-year-transition hook it needs to run on.

---

## 3. Marks Editing Workflow

### What exists today (substantially more than "marks are freely editable")

A real state machine already exists and is already wired into the Markbook UI: `server/routes/mark-submissions.js` — `draft → submitted → approved/rejected → locked`. Once locked, `assessment_marks.isLocked = true` blocks further bulk writes; the client's `SubmitPanel` disables grid cells accordingly. There's also a *second*, independent lock at the assessment-schedule level (`assessment.js`'s `/schedule/:id/lock`), and exam-level moderation locking in `exams.js`. None of these three currently call `AuditService` — they log to custom collections (`assessment_audit_log`, `mark_audit_log`) or plain `console.log`.

Unlock, today, is **unilateral admin action with a mandatory reason** (`mark-submissions.js`'s `/unlock`, `exams.js`'s `/unlock`) — not a request-and-approve flow, and not time-boxed. It stays unlocked until someone re-locks it manually.

The 24-hour auto-relock needs a delayed action. The codebase already has the right tool for this: `server/utils/job-queue.js`, a Mongo-backed durable retry queue polled every minute — this is the existing infrastructure to schedule the auto-relock, not a new cron file.

### Specification

- **Reframe "request → approve → unlock" on top of the existing state machine**, not a new one: adds a `pending_unlock_request` sub-state (or a parallel `unlock_requests` collection referencing the submission) ahead of the existing unilateral `/unlock` action. Teacher requests via a new endpoint; the approver (resolved via `workflow_assignments`, §0, `workflowKey: 'marks_unlock'`, `stepKey: 'hod'` — falling back to `section_head` the same way §1's leave chain does) approves; **on approval, the existing `/unlock` logic runs exactly as it does today** — this spec doesn't touch what unlock *does*, only what's allowed to trigger it.
- **24-hour expiry**: on unlock, enqueue a job via the existing `job-queue.js` (`enqueueJob({type:'marks_relock', payload:{submissionId}, ...})`, handled by a new `registerHandler('marks_relock', ...)` that re-runs the existing lock logic). No new cron file, no new polling mechanism — this is exactly what the queue already exists for.
- **Principal notification**: same mechanism as §1 — an auto-generated `messages.js` message on every unlock *request* (not just on approval), since the spec asks for Principal visibility into requests as they happen.
- **Audit trail**: every request/approve/reject/auto-relock event goes through `AuditService.log()` — this is new (none of the three existing lock mechanisms use it today) but is purely additive; nothing about the existing lock/unlock logic changes, only that it now also calls `AuditService.log()` alongside whatever it already does.

**Open question this spec surfaces rather than assumes:** the platform has *three* independent lock mechanisms today (mark-submission level, assessment-schedule level, exam-moderation level). This spec's "marks editing" workflow applies to the mark-submission lock specifically, since that's the one directly tied to the teacher-facing Markbook UI. Whether the assessment-schedule and exam-moderation locks need the same request-based treatment is a separate decision this spec doesn't make — flagged for explicit confirmation before the implementation plan, not silently assumed either way.

**What's reused vs. new:**
- Reused: the entire existing `draft→submitted→approved→locked` state machine and its `/unlock` action logic, verbatim.
- New: a request-gate in front of the existing unlock action, `job-queue.js` wiring for the 24h auto-relock, `AuditService` wiring (currently absent), the notification call, and the `workflow_assignments` step for this workflow.

---

## 4. Deactivated Users

### What exists today

Login-time handling is already reasonably solid and already consistent across staff, student, and parent accounts — there's one shared `/login` route, not per-role paths, and a deactivated user gets a specific (not generic) `403` message today: `"Account inactive. Please contact your school administrator."` The client currently renders this inline (a red alert box on the login form), not as a dedicated page.

**The real gap, and it's a genuine one worth naming plainly:** authorization is *not* actually enforced per-request anywhere in the middleware chain. `authMiddleware`, `rbac.js`, and `scopeMiddleware.js` never check `isActive`. The only reason an already-logged-in user is cut off *today* is that the one route that deactivates a user (`DELETE /api/settings/users/:id`) happens to also call `revokeUserTokens()`, which bumps a token-version counter `authMiddleware` does check. If a user were ever deactivated through a different path that doesn't also revoke tokens, their existing session would keep working until natural expiry (up to 8 hours). "Authentication succeeds, authorization is denied" as a structural guarantee doesn't exist yet — it currently works as an accidental side effect of one specific route's implementation, not a designed control.

### Specification

- **Client**: replace the inline error-box rendering of the deactivation message with a dedicated, full information page (matching the exact wording requested: *"Your account has been deactivated. Please contact your school administration."*), reached whenever the server returns this specific error — applies uniformly to staff, students, parents, and any other account type, since the server-side message is already role-agnostic. No modules or data should be reachable from this page (a dead end, not a dashboard with hidden pieces).
- **Server — the part that needs an explicit decision, not an assumption**: guarantee that *any* path setting `isActive:false` on a user always revokes that user's tokens in the same transaction/operation — not relying on it being the one existing route that happens to do both today. This spec recommends doing this at the data-access layer (a single helper, e.g. `deactivateUser(userId)`, that both routes and any future admin action call, rather than each call site remembering to pair the two operations) — additive, no change to how `authMiddleware` currently checks token versions, just closes the gap where a future or alternate deactivation path could forget the pairing.
- **Whether to add a defensive per-request `isActive` check** to `authMiddleware`/`tenantMiddleware` in addition to the token-revocation approach above is explicitly left as an open question for confirmation before implementation — it's a real behavior change to a hot path (every authenticated request) touching architecture this spec was told not to redesign, so it's named here rather than decided unilaterally.

**What's reused vs. new:**
- Reused: the existing, already-consistent `/login` 403 response and message text.
- New: the dedicated client-side information page; a single deactivation helper guaranteeing token revocation always pairs with `isActive:false`; the per-request enforcement question flagged for explicit decision.

---

## 5. Resources Module

### What exists today

Confirmed genuinely new — there is no existing "resources," "links," or general shared-repository module anywhere in the codebase. The "Library" module (`server/routes/library.js`) is a physical/digital *book* lending system (ISBN, copies, due dates, fines) — unrelated in data model and purpose.

**Audience-targeting precedent is shallow and needs extending, not reusing as-is.** The closest analog is `messages.js`'s `recipients` field — `'all'`, a flat role-group keyword (`teachers`/`parents`/`students`/`staff`), or a single `userId`. It has no concept of class-, section-, or year-level targeting at all, and no support for custom/named groups. `events.js` has an `audience` array field but no enforced shape and no UI to actually set it — a dead precedent, not a working one.

### Specification

- New collection `resources` (tenant-scoped, `tenantModel` pattern, matching every other module in this codebase — no new data-access pattern). Fields per the request: title, description, url, category, visibility, creator, optional `expiresAt`.
- **Visibility model** — this is the one genuinely new subsystem in this spec, since nothing today supports the requested granularity (whole school / section / year / class / parents / teachers / staff / individual users / custom groups). Modeled as a `visibility` object supporting multiple simultaneous targeting dimensions (e.g. `{scope:'all'}` or `{roles:['parent','teacher'], years:['Year 8'], classes:['8A']}` or `{userIds:[...]}` or `{groupId:'...'}` for a school-defined custom group) — generalizes `messages.js`'s existing role-group keyword approach rather than inventing an unrelated targeting language, but has to add the class/section/year/individual/custom-group dimensions that don't exist in that precedent today.
- **Custom groups**: since no "named group of arbitrary users" concept exists anywhere yet, this spec calls for a small new `resource_groups` collection (id, name, memberUserIds) — scoped narrowly to serving Resources visibility rather than a general-purpose grouping primitive, to avoid scope creep into a feature nobody asked for.
- **Permissions**: `rbac('resources','read'/'create'/'update'/'delete')` for the module-level gate (following the existing, working RBAC pattern — not a new mechanism), with Principal/School Admin granted implicit full visibility as a fixed rule (matching how e.g. audit visibility already works for admin roles elsewhere), and everyone else's *read* results filtered by whether they match the resource's `visibility` targeting.
- **Expiry**: `expiresAt` simply excludes a resource from listing queries once past — no special job/cron needed, this is a query-time filter, consistent with how the codebase handles similar cases elsewhere (e.g. trial expiry checks are read-time, not swept by a background job).

**What's reused vs. new:**
- Reused: `tenantModel` data-access pattern, `rbac()` module gate, the *concept* (not the shape) of `messages.js`'s role-group targeting as a starting point.
- New: the entire `resources` collection and UI (confirmed nothing to rename), the multi-dimensional visibility model, and a narrowly-scoped `resource_groups` collection for custom groups.

---

## 6. Cross-Cutting: What This Spec Assumes Exists (and Doesn't)

Three of the five sections above (§1, §3, and implicitly §4/§5) lean on mechanisms that either don't exist yet or exist only partially. Naming them once here rather than repeating the caveat in each section:

1. **No generic notification system exists.** Every "X is notified" / "Y is copied" requirement in this spec is implemented via `messages.js`'s existing send-message + email-side-channel infrastructure, auto-generated by the system rather than typed by a human. This is a deliberate choice to stay within approved architecture rather than build a new notification primitive — flagged for confirmation, since it does mean workflow notifications will look like regular messages in a user's inbox, not a distinct "system alert" surface.
2. **`workflow_assignments` (§0) is new infrastructure**, even though it's modeled directly on the existing `role_permissions` pattern. Both §1 and §3 depend on it existing before either can be built.
3. **`job-queue.js` is proven infrastructure** (already running in production for the security-alert webhook, per this session's earlier work) — §3's 24-hour auto-relock is a new job *type* registered against existing, already-working queue machinery, not a new subsystem.

---

## 7. Open Questions Requiring Explicit Confirmation

Not decided in this spec — surfaced for you (and your reviewer) to settle before an implementation plan is written:

1. **§3 — Marks locking scope.** Does the request-based unlock workflow apply only to the mark-submission-level lock, or also to the assessment-schedule and exam-moderation locks (three independent mechanisms exist today)?
2. **§4 — Per-request authorization enforcement.** Should `isActive` be checked defensively on every authenticated request (a hot-path change), or is the "deactivation always revokes tokens" guarantee (closing the gap without touching the hot path) sufficient?
3. **§1 — Director assignment.** Confirm whether "Director" should ever become a real RBAC role in the catalogue, or stay purely a `workflow_assignments`-configured person/role per school (this spec's default assumption, requiring no RBAC catalogue change).
4. **§2 — Where the points-reset lives.** Confirm whether the reset is a manual admin-triggered action per school (matching how e.g. the existing academic-year rollover concept doesn't exist as an automatic process anywhere today) or should be automatic on a date, which would require new scheduling infrastructure this spec hasn't scoped.

---

## 8. Explicitly Not Changing

- The RBAC engine itself (`rbac.js`), its caching, its per-user override mechanism.
- Any of the ~55 existing hardcoded role-name checks found in the audit for §0 — out of scope, not touched.
- The mark-submission state machine's actual lock/unlock *logic* (§3) — only what's allowed to trigger unlock changes.
- The Growth Profile's and Behaviour module's existing data shapes, routes, and UI (§2) — only the delete semantics on the currently-hard-deleting Growth Profile collections, and the addition of a reset mechanism that doesn't touch history.
- The existing `/login` 403 response shape and message text (§4) — only where/how it's displayed client-side.
- `tenantModel`, `AuditService`, `job-queue.js`, and `messages.js` as subsystems — all reused as-is, none redesigned.
