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

The first draft of this spec under-scoped this: it made *who* fills a step configurable but assumed the *steps themselves* (a fixed HOD → Principal → HR chain) were the same for every school. Real schools differ — a school might not have a Principal in the approval chain at all, might call the role something else entirely, or might want three steps instead of two. The chain's shape has to be configurable too, not just its occupants.

Introduce a **workflow configuration** concept, stored the same way `role_permissions` already is (a school-scoped collection, same tenant-isolation posture, same caching approach) — but as an ordered, school-authored list of steps rather than a fixed set of named slots:

```
workflow_configs
  { id, schoolId, workflowKey, steps: [
      { order: 1, label: 'First Approval', assigneeType: 'role' | 'user', assigneeValue, fallback: { assigneeType, assigneeValue } | null },
      { order: 2, label: 'Second Approval', assigneeType: 'role' | 'user', assigneeValue, fallback: null },
      ... (school-defined, minimum enforced per workflow — see §1)
    ],
    notifyOnly: [ { assigneeType, assigneeValue, trigger: 'every_decision' | 'final_decision' } ],
    updatedBy, updatedAt }
```

- `workflowKey` — e.g. `'leave_approval'`, `'marks_unlock'`.
- `steps` — an **ordered array the school itself authors**, not a fixed set of named slots (`hod`/`principal`/etc. no longer appear as required keys anywhere in code). Each step's `label` is free text the school chooses ("Department Head", "Deputy Head", "Section Lead" — whatever they actually call the role); `assigneeValue` is picked from that school's own real role catalogue (`role_permissions` roleKeys, including any custom roles) or a specific named user — never a role name the platform assumes exists.
- `assigneeType: 'role'` resolves to whoever holds that `roleKey` at the relevant scope; `assigneeType: 'user'` is a specific named person (covers ad hoc roles like "Director" that a school may not want to formalize as an RBAC role at all).
- `fallback` — per-step, optional. Used when a step's primary resolution finds nobody assigned (a vacant-role case) — the school configures what/who a given step falls back to, if anything; there's no platform-wide default fallback chain.
- `notifyOnly` — parties who are informed but never gate the workflow (the "Director copied" case) — kept separate from the approval `steps` array precisely so a notify-only party can never accidentally become a required approver by a config mistake.

A school's own workflow-owner (HR, for the leave workflow — see §1) configures this once, in Settings, populated from a picker over that school's actual role catalogue, not a hardcoded dropdown of platform-assumed role names. New business logic resolves *"who acts at step N"* by reading this collection's `steps` array in order — never by checking `role === 'hod'` or any other specific name in code. This is additive (`role_permissions` and `rbac()` are untouched), reuses the exact tenant-scoping and caching pattern already proven there, and is the concrete mechanism that makes "future modules — procurement, disciplinary cases, inventories, finance — follow the same flexible governance model" actually true rather than aspirational.

**What this principle does NOT require:** it does not require retrofitting the ~55 existing hardcoded role checks found in the audit above. Those are pre-existing, working code outside this spec's scope — flagged here for honesty, not proposed for a cleanup pass. The principle applies going forward, starting with the workflows in this document.

---

## 1. Leave Management Workflow

### What exists today

A working, single-step leave system already exists: `server/routes/hr.js`, collection `leave_requests`, status `pending → approved/rejected`. Teacher submits (`POST /api/hr/leave`), whoever holds `hr` RBAC permission resolves it directly (`PATCH /:id/resolve`) — no chain, no HOD/Principal step. No audit log call exists on any of the three leave handlers today. The client UI (`HRPage.jsx`'s Leave tab) has approve/reject buttons calling this single-step endpoint.

**Role reality check:** "HOD" is not an RBAC role today — it's a value inside a teacher's `extraRoles` array, checked ad hoc in a few places (not via `rbac()`). "Section Coordinator" doesn't exist as a role; `section_head` is the closest match. "Director" doesn't exist at all. "Principal" and "HR" are real, existing roles with real permission docs.

### Specification

**The chain itself is school-configured, not fixed.** HR (or whoever holds permission to manage this in Settings — see §0) defines the leave approval chain for their own school: an ordered list of approval steps drawn from that school's own role catalogue, each with a school-chosen label. The platform enforces exactly one structural rule — **a minimum of two approval steps before HR's final confirmation** — and nothing about *which* roles fill them, whether a Principal is involved at all, or what they're called. A school with no Principal role, or one that calls its department heads something else entirely, configures a chain that reflects that, and the workflow logic never assumes otherwise.

**State machine** (extends `leave_requests.status` from a binary field to a position in the school's own configured chain, plus a fixed trailing HR step):

```
step[1] → step[2] → ... → step[N]   (N ≥ 2, school-defined, school-labeled)
   ↓          ↓               ↓
rejected   rejected        rejected           → then hr_final → confirmed
                                                        ↓
                                                    rejected  (HR may still reject here even after every configured step approved)
```

- Step resolution uses the workflow-configuration mechanism from §0, `workflowKey: 'leave_approval'`. `leave_requests` stores `currentStepOrder` (an integer index into the school's configured `steps` array) instead of a step-name field — the request document itself never contains a role name, only a position.
- **Configured steps** (1..N, N≥2): each resolves via that step's own `assigneeType`/`assigneeValue`/`fallback` exactly as defined in §0 — e.g. a school might scope its first step to "whoever holds the role this school calls 'Department Head' in the requester's department" (reusing `departments.js`'s existing `hodId`-style department-owner field as one *possible* resolution pattern a school can pick, not a required one), and its second step to any other role or specific person the school chooses. The department-head-with-vacancy-fallback example from the first draft of this spec is now just that — one illustrative configuration a school *can* set up, not the platform's assumed default.
- **HR final step**: fixed, always present, always last — not part of the school-configured `steps` array. This matches "HR performs the final confirmation" as a non-negotiable anchor while everything before it flexes.
- **Notify-only parties** (e.g. a "Director" a school wants copied on outcomes): configured via `notifyOnly` (§0), never as a gating step — they cannot block or be mistaken for an approver.

**Business rules:**
- Every step transition (approve or reject) writes an `AuditService.log()` entry — `action: 'leave.step_approved' | 'leave.step_rejected' | 'leave.hr_confirmed' | 'leave.hr_rejected'`, `actor`, `target: {type:'leave_request', id}`, `details: {comment, stepOrder, stepLabel}`. This is new — no leave action is audited today. Rejection comment is mandatory at the API layer (400 if omitted on a reject action), matching the mandatory-reason pattern already used by `mark-submissions.js`'s unlock endpoint.
- If an early step rejects: the record still advances to visible-to-later-steps (not silently closed) — anyone at a later configured step, and HR, can see the rejection reason and, since every step is now audited, the full trail via a query against `audit_logs` filtered by `target.id`. This reuses `AuditService.query()` (already built, already used by the school-scoped `/api/audit` endpoint) rather than inventing a second history mechanism.
- HR's "reject even after every configured step approved" is simply the normal HR-step rejection — nothing special-cased, because the chain never skips HR regardless of how many earlier steps a school has configured.
- **Notification mechanism**: no generic notification service exists in the codebase today (confirmed — no `notifications` collection, no bell icon). "Notify the next step on a rejection" and any configured `notifyOnly` party are implemented by auto-generating a `messages.js`-style message (existing infrastructure — collection `messages`, targeted at a specific `userId`, already triggers the existing email side-channel via `notif-settings.js`/`email-queue.js`) rather than building a new notification primitive. This is the "work within approved architecture" answer — flagged explicitly since it's a real design choice, not a formality.
- **Config-time validation**: saving a `workflow_configs` doc for `leave_approval` with fewer than 2 `steps` is rejected (400) — this is the one place the platform enforces structure rather than leaving it entirely to the school.

**What's reused vs. new:**
- Reused: `leave_requests` collection (extended with `currentStepOrder` instead of a fixed status enum, not restructured), `hr.js`'s existing submit route, `departments.js`'s existing `hodId` field as one *available* resolution option (not required), `AuditService.log/query` (unused today, now wired in), `messages.js`'s existing send+email infrastructure.
- New: the configurable-chain state machine itself, the `workflow_configs` collection (§0) and its Settings UI (a step-builder populated from the school's own role catalogue), the minimum-2-steps validation rule, audit wiring on every leave transition, the auto-generated notification calls.

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

- **Reframe "request → approve → unlock" on top of the existing state machine**, not a new one: adds a `pending_unlock_request` sub-state (or a parallel `unlock_requests` collection referencing the submission) ahead of the existing unilateral `/unlock` action. Teacher requests via a new endpoint; the approver — resolved via the same school-configured `workflow_configs` mechanism from §0 (`workflowKey: 'marks_unlock'`), a single step here rather than a chain (the ≥2-step minimum in §1 is specific to leave; this workflow doesn't inherit it) — approves; **on approval, the existing `/unlock` logic runs exactly as it does today** — this spec doesn't touch what unlock *does*, only what's allowed to trigger it. Which role that single step resolves to (a department head, a section lead, whatever a given school actually calls it, with an optional configured fallback for a vacant role) is entirely school-configured, same as §1 — nothing here assumes "HOD" or "Section Coordinator" as fixed names either.
- **24-hour expiry**: on unlock, enqueue a job via the existing `job-queue.js` (`enqueueJob({type:'marks_relock', payload:{submissionId}, ...})`, handled by a new `registerHandler('marks_relock', ...)` that re-runs the existing lock logic). No new cron file, no new polling mechanism — this is exactly what the queue already exists for.
- **Notification on request**: same mechanism as §1's `notifyOnly` concept — whoever the school configures to be informed of unlock requests (need not be a role literally called "Principal") gets an auto-generated `messages.js` message on every unlock *request* (not just on approval), since the spec asks for that visibility as requests happen, not only on resolution.
- **Audit trail**: every request/approve/reject/auto-relock event goes through `AuditService.log()` — this is new (none of the three existing lock mechanisms use it today) but is purely additive; nothing about the existing lock/unlock logic changes, only that it now also calls `AuditService.log()` alongside whatever it already does.

**Open question this spec surfaces rather than assumes:** the platform has *three* independent lock mechanisms today (mark-submission level, assessment-schedule level, exam-moderation level). This spec's "marks editing" workflow applies to the mark-submission lock specifically, since that's the one directly tied to the teacher-facing Markbook UI. Whether the assessment-schedule and exam-moderation locks need the same request-based treatment is a separate decision this spec doesn't make — flagged for explicit confirmation before the implementation plan, not silently assumed either way.

**What's reused vs. new:**
- Reused: the entire existing `draft→submitted→approved→locked` state machine and its `/unlock` action logic, verbatim.
- New: a request-gate in front of the existing unlock action, `job-queue.js` wiring for the 24h auto-relock, `AuditService` wiring (currently absent), the notification call, and the `workflow_configs` step for this workflow.

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
2. **`workflow_configs` (§0) is new infrastructure**, even though it's modeled directly on the existing `role_permissions` pattern. Both §1 and §3 depend on it existing before either can be built — including its Settings UI (a step-builder over the school's own role catalogue), since §1's per-school-configurable chain is meaningless without a way for HR to actually build it.
3. **`job-queue.js` is proven infrastructure** (already running in production for the security-alert webhook, per this session's earlier work) — §3's 24-hour auto-relock is a new job *type* registered against existing, already-working queue machinery, not a new subsystem.

---

## 7. Open Questions Requiring Explicit Confirmation

Not decided in this spec — surfaced for you (and your reviewer) to settle before an implementation plan is written:

1. **§3 — Marks locking scope.** Does the request-based unlock workflow apply only to the mark-submission-level lock, or also to the assessment-schedule and exam-moderation locks (three independent mechanisms exist today)?
2. **§4 — Per-request authorization enforcement.** Should `isActive` be checked defensively on every authenticated request (a hot-path change), or is the "deactivation always revokes tokens" guarantee (closing the gap without touching the hot path) sufficient?
3. **§1 — Director assignment.** Confirm whether "Director" should ever become a real RBAC role in the catalogue, or stay purely a `workflow_configs`-configured person/role per school (this spec's default assumption, requiring no RBAC catalogue change).
4. **§2 — Where the points-reset lives.** Confirm whether the reset is a manual admin-triggered action per school (matching how e.g. the existing academic-year rollover concept doesn't exist as an automatic process anywhere today) or should be automatic on a date, which would require new scheduling infrastructure this spec hasn't scoped.
5. **§1 — Who may edit the leave chain, and is there a maximum step count.** This spec assumes "HR" (whoever holds `hr` RBAC permission at that school) owns the chain configuration, and enforces only a floor (≥2 steps), no ceiling. Confirm both: should chain-editing be restricted further (e.g. to `admin`/`superadmin` only, not every HR-permission holder), and is an unbounded number of steps actually desired or should there be a sane maximum (e.g. 5) to prevent an unusably long chain being configured by mistake?

---

## 8. Explicitly Not Changing

- The RBAC engine itself (`rbac.js`), its caching, its per-user override mechanism.
- Any of the ~55 existing hardcoded role-name checks found in the audit for §0 — out of scope, not touched.
- The mark-submission state machine's actual lock/unlock *logic* (§3) — only what's allowed to trigger unlock changes.
- The Growth Profile's and Behaviour module's existing data shapes, routes, and UI (§2) — only the delete semantics on the currently-hard-deleting Growth Profile collections, and the addition of a reset mechanism that doesn't touch history.
- The existing `/login` 403 response shape and message text (§4) — only where/how it's displayed client-side.
- `tenantModel`, `AuditService`, `job-queue.js`, and `messages.js` as subsystems — all reused as-is, none redesigned.
