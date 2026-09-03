# Msingi — Permission Granularity Plan — 2026-09-03

**Design document only. No code changed.** Builds on
`docs/audits/PERMISSION_CONTROL_CONTRACT_2026-09.md` (the baseline: what
Settings currently controls, verified against real code). This document
proposes, module by module, which of the 122 currently-decorative
sub-rows should become genuinely independently enforced, which should
deliberately stay coarse, and how — before any of it is implemented.

Scope, per instruction: **Finance, HR, Admissions, Students, Teachers,
Grades, Exams, Report Cards** — the Contract's Tier 1. Attendance,
Classes, Behaviour, Timetable, Messages, Resources, eLearning, Library,
Transport, Hostel (Tier 2) and Reports, Analytics, Growth Profile
(Tier 3) are out of scope for this pass; the same method applies to them
later.

---

## A key simplification worth stating up front

**No new permission keys need to be invented.** `MODULE_REGISTRY`
(`server/config/moduleRegistry.js`) already declares the exact sub-row
key for every row shown in the UI, and `_deriveApiPerms`
(`server/routes/settings.js:76-92`) already derives a
`permissions.<mod>__<sub>` grant for every one of them on every save,
whether or not any route reads it yet. **Making a row "real" is
therefore never a data-model or frontend change — it is exclusively
adding a third argument to the right `rbac()` call on the right route,
using the key the registry already defines.** This is a low-risk,
additive, per-route change, not an architecture change. The work this
document scopes is entirely about *which* routes, and *whether* a given
row should be threaded through at all.

---

## Decision framework

A row is proposed **REAL** when at least one of these holds:

1. **Separation of duties** — a role that legitimately needs the rest of
   the module should plausibly NOT hold this specific action (the
   classic "can create, cannot approve/void/publish" pattern).
2. **Consequential and hard to reverse** — money movement, permanent
   deletion, or anything a parent/regulator/auditor could see the result
   of.
3. **Meaningfully larger blast radius than the module's other actions** —
   bulk import/export touches many records atomically; a single edit
   touches one.

A row stays **COARSE** (recommended not to implement) when:

- It's a read-only variant of data already visible through another row
  in the same module, with no real duty-separation value in splitting
  it (e.g. "view the list" vs "view one profile").
- It has no distinct backend operation to gate at all (a client-side
  rendering action like "Print").
- Splitting it would add an admin-facing checkbox without a real school
  ever needing to grant one without the other.

---

## Current-state taxonomy (before any of this is implemented)

Every row below is tagged with its **current** status, separate from
the **Verdict** column's *proposed future* recommendation. Collapsing
these two questions into one label was exactly how "decorative" and
"doesn't exist" got blurred together earlier in this investigation — a
missing feature is not a permission bug, and a permission that bypasses
Settings by design is not the same problem as one that was simply never
wired. Six labels, not three:

| Status | Meaning |
|---|---|
| 🟢 **REAL** | Feature exists; this exact permission independently governs it today. |
| 🟡 **PARTIAL** | Feature exists; some of the operations behind this row are independently governed, others aren't. |
| 🟠 **BYPASS** | Feature exists and IS actually restricted today — but not through this row, not through `role_permissions`, and not through Settings at all. The real gate is something else entirely (a hardcoded role check, a different module's permission, or an undocumented in-handler rule) that an admin cannot see or change from Settings. |
| 🔵 **COARSE** | Feature exists; this row's action is deliberately folded into a broader permission and always has been — not a gap, a design choice this document endorses. |
| ⚪ **NOT BUILT** | The UI shows this row, but there is no corresponding backend operation anywhere in the codebase. Nothing to gate; not a permission defect. |
| 🔴 **DECORATIVE** | Feature exists; this row is checkable in the UI but independently governs nothing — it silently collapses into the module's shared coarse grant, same as every other untouched row. |

**BYPASS is the status that matters most and is easiest to miss** — it's
the only one where an admin looking at Settings would reasonably
believe a real, working control exists, when the actual enforcement
(often stricter than what Settings shows, sometimes looser) lives
somewhere they cannot see. Three confirmed instances below:
`report_cards.publication_policy`, `hr.leave_view`, `finance.mpesa`.

---

## 1. Finance (9 rows)

The highest-risk module in the Contract, and the user's own worked
example. Current state: **zero** rows enforced independently — every
route uses plain `rbac('finance', action)`.

| Row (registry key) | Status | Verdict | Business capability | Who normally holds it | V/E/D | Routes | Approval/audit | Notes |
|---|---|---|---|---|---|---|---|---|
| `invoices` (View Invoices) | 🔴 DECORATIVE | COARSE | See invoice list/detail | Finance, front office (view-only), Principal | V | `finance.js:98,132` (`GET`) | — | Foundational read; no duty-separation case for splitting from `payments`. |
| `create_invoice` (Create Invoice) | 🔴 DECORATIVE | **REAL** | Generate a new invoice for a student | Finance clerk, Admissions (opening fees) | E | `finance.js:146` (`POST`) | Already audit-logged elsewhere in this file's pattern | A clerk who invoices but shouldn't touch existing ones is a real role. |
| `void_invoice` (Void Invoice) | 🔴 DECORATIVE | **REAL — highest priority** | Reverse/cancel an invoice (status→`voided`, not a hard delete) | Finance **Manager** only, not a general clerk | D | `finance.js:258` (`DELETE /invoices/:id`) | **Already implemented**: audit-logged as `finance.invoice_voided` (`finance.js:279`), blocked on fully-paid invoices and locked academic years (`:266,271`) | This is the user's exact worked example. The backend safety logic already exists — this is purely a missing `rbac()` third argument, the lowest-risk, highest-value single change in this whole document. Proposed: `rbac('finance', 'delete', 'void_invoice')`. |
| `payments` (View Payments) | 🔴 DECORATIVE | COARSE | See payment history | Finance, front office | V | `finance.js:292` | — | Same reasoning as `invoices` — real duty separation would be *recording* vs *viewing*, not viewing two related things separately. |
| `record_payment` (Record Payment) | 🔴 DECORATIVE | **REAL** | Log a payment against an invoice | Finance clerk, front office cashier | E | `finance.js:327` (`POST /payments`) | Consider requiring a note/reference field if not already present | Should exist independently of `void_invoice` — a cashier who takes payments should very plausibly never be able to void an invoice. This pairing (`create_invoice`+`record_payment` granted, `void_invoice` withheld) is the exact "Accounts Officer" the user described. |
| `print` (Print Receipts/Invoices) | 🔵 COARSE | **COARSE — cannot be otherwise** | Render an already-fetched invoice/payment as PDF | Anyone with `invoices`/`payments` read | — | **No dedicated backend route found.** | — | Client-side rendering of data already returned by a `read`-gated endpoint. There is nothing to independently gate; recommend removing this row from the UI as its own control rather than leaving it decorative. |
| `fee_structure` (Manage Fee Structures) | 🔴 DECORATIVE | **REAL** | Define/edit the fee schedule itself (not individual invoices) | Finance Manager, Principal — not a clerk | E/D | `finance.js:763,776,805,850` (fee-structures CRUD) | Consider requiring approval before a fee-structure change takes effect mid-term | Changing the fee schedule affects every future invoice at the school — materially different blast radius than issuing one invoice. |
| `import` (Import Finance Data, CSV) | 🔴 DECORATIVE | **REAL** | Bulk-create invoices/opening balances from a spreadsheet | Finance Manager, onboarding admin | E | `import-export.js` (`type==='finance'`, `POST /:type`) | Recommend a dry-run/preview step if one doesn't already exist | Bulk import can create or corrupt hundreds of records in one call — real, distinct blast radius from single-invoice create. |
| `mpesa` (Configure M-Pesa Integration) | 🟠 **BYPASS** | **Needs re-attribution, not just a subKey** | Set the school's M-Pesa paybill/API credentials | Principal/Admin, arguably not even Finance role | — | **`server/routes/settings.js:316` (`PUT /school`), gated by `rbac('settings','update')`, not `finance` at all.** | This writes live payment-processor credentials | Genuinely restricted today — just not by anything under Finance. A Finance role with full Finance access cannot configure M-Pesa; a Settings-privileged role can, regardless of their Finance grant. Recommend either (a) moving this row to the Settings module's own list where it visually belongs, or (b) if it must stay under Finance for discoverability, gate `PUT /school`'s handling of the `mpesa` field specifically on `rbac('finance','update','mpesa')` in addition to/instead of `settings`. This is a decision about which module *owns* payment-credential configuration, not a mechanical subKey add. |

**Finance summary:** 5 of 9 rows proposed REAL (`create_invoice`,
`void_invoice`, `record_payment`, `fee_structure`, `import`), 2 stay
coarse (`invoices`, `payments` — read variants), 1 has no backend
operation to gate (`print`), 1 needs an ownership decision before any
implementation (`mpesa`).

---

## 2. HR (6 rows)

Already 4 of 6 real (`leave_approve`, `payroll_view`, `payroll_export`,
`documents` — see the Contract). Only 2 decorative rows remain, and one
of them has a distinct problem worth flagging on its own.

| Row | Status | Verdict | Capability | Who | Routes | Notes |
|---|---|---|---|---|---|---|
| `staff` (View Staff Records) | 🔵 COARSE (alias) | COARSE | See the staff directory | Most HR-adjacent roles | **No dedicated route in `hr.js` at all** — the HR module's "staff" view is the `teachers` module's own data, gated by `rbac('teachers','read')`, not by anything under `hr`. | This row is effectively a relabeled alias for `teachers` module access, not its own capability — recommend against making it independently real, since there is no HR-specific "staff view" operation separate from the Teachers module to gate. |
| `leave_view` (View Leave Requests) | 🟠 **BYPASS** | **REAL — but as a bug fix, not new granularity** | See submitted leave requests | Line managers, HR | **`hr.js:186` (`GET /leave`) has NO `rbac()` call at all** — self-scoped in-handler ("own record, or HR_ROLES for any"), per the Contract | Genuinely restricted today, just not through Settings — a hardcoded in-handler role list, not `role_permissions`. Recommend actually wiring `rbac('hr','read','leave_view')` here rather than leaving it as an undocumented hardcoded role list — this is the one HR row that's a real gap, not a design choice. |

**HR summary:** No new rows proposed for genuine new granularity; one
existing gap (`leave_view`) should be closed as a correctness fix, not a
granularity decision — it currently bypasses Settings' permission model
entirely via a hardcoded in-handler role check.

---

## 3. Admissions (6 rows)

Zero rows currently enforced independently.

| Row | Status | Verdict | Capability | Who | V/E/D | Routes | Notes |
|---|---|---|---|---|---|---|---|
| `view` (View Pipeline) | 🔴 DECORATIVE | COARSE | See the applicant pipeline | Admissions staff, front office | V | `admissions.js:87,124,158` | Foundational read. |
| `create` (Add Applicant) | 🔴 DECORATIVE | COARSE | Register a new applicant | Admissions Officer, front office | E | `admissions.js:168` | No strong duty-separation case against `edit` — intake and updating the same record are usually the same person's job day to day. |
| `edit` (Edit Applicant Details) | 🔴 DECORATIVE | COARSE (bundled with `create`) | Update applicant fields | Admissions Officer | E | `admissions.js:196` | See `move` below — the one edit-shaped action worth separating out is the *stage* change, not general field edits. |
| `move` (Move Pipeline Stage) | 🔴 DECORATIVE | **REAL** | Advance/reject an applicant through enquiry → application → assessment → interview → offer → acceptance → enrolled/withdrawn/rejected | Admissions Officer; **offer/acceptance stages arguably Principal-only** | E | `admissions.js:196` (general `PUT`, stage changes bundled in) and the dedicated `admissions.js:226` (`PATCH /:id/stage`) | Moving someone to `offer` or `enrolled` has real downstream effects (an enrolled applicant likely provisions a student record elsewhere in the system) — worth being independently grantable from routine detail edits. Consider whether the *specific stage* being moved to should itself gate differently (e.g. only Principal can move to `offer`) — that's a business-rule question for whoever owns admissions policy, flagged here, not resolved here. |
| `delete` (Delete Applicant) | 🔴 DECORATIVE | **REAL** | Permanently remove an applicant record | Admissions Manager/Principal, not routine staff | D | `admissions.js:248` | Permanent deletion of a person's application record; standard case for restricting below general edit access. |
| `export` (Export Applicants, CSV) | ⚪ **NOT BUILT** | N/A until built | Bulk-download the pipeline | — | — | **None.** `import-export.js`'s `EXPORT_MODULE` map (its complete list of every exportable type) has no `admissions` entry. | Not a permission defect — there is no export endpoint to gate at all. Recommend either building the export feature first (then gate it per the `create_invoice`-style reasoning) or removing this row from the UI until it does something. |

**Admissions summary:** 2 of 6 rows proposed REAL (`move`, `delete`);
`view`/`create`/`edit` recommended to stay bundled together as one
coarse capability; `export` corresponds to a feature that doesn't exist
in the backend yet, so there's nothing to gate until it's built.

---

## 4. Grades, Exams, Report Cards — treated together (14 rows)

These three modules share the same underlying separation-of-duties
question — **should the person entering marks be able to approve and
publish them?** — so the analysis is combined.

### Grades (6 rows)

| Row | Status | Verdict | Capability | Who | Routes | Notes |
|---|---|---|---|---|---|---|
| `view_grades` | 🔴 DECORATIVE | COARSE | See marks | Teachers, HOD, Principal | grades read routes | Foundational. |
| `enter_marks` | 🔴 DECORATIVE | COARSE (kept as the base "can do gradebook work" action) | Enter/edit marks for own classes | Class/subject teacher | grades write routes | |
| `mark_submissions` (Review/Approve) | 🔴 **DECORATIVE — separation-of-duties defeat** | **REAL** | Approve or reject a teacher's submitted marks | HOD, exams_officer — **explicitly not the submitting teacher** | `mark-submissions.js:196` (`/:id/review`) — currently coarse `rbac('grades','update')`, **the exact same action string as recalling, locking, or unlocking a submission** | This is the single clearest separation-of-duties case in the entire audit: a teacher who can `enter_marks` and a reviewer who can `mark_submissions` are, by definition, meant to be different people for the check to mean anything. Currently `enter_marks` and `review` are indistinguishable at the RBAC layer — anyone with `grades:update` can do both. Tagged DECORATIVE rather than BYPASS because there's no separate hidden gate elsewhere — it's simply not gated independently at all. **Before implementing:** confirm whether `mark-submissions.js`'s `/:id/review` handler already contains an in-code check preventing a submitter from reviewing their own submission (not confirmed in this pass) — if it doesn't, that's a correctness gap independent of RBAC granularity. |
| `comment_banks` | 🔴 DECORATIVE | COARSE | Manage report-card comment templates | HOD, Principal | `comment-banks.js` (not traced in this pass) | Lower stakes than mark approval; template text, not grades themselves. |
| `report_generate` (Generate/Publish) | 🟠 **BYPASS — see correction below, this is the real gate, not `report_cards.publication_policy`** | **REAL** | Actually publish report cards to parents | Principal, Deputy Principal — schools should be able to name who, not be stuck at literally `admin`/`superadmin` | `report-cards.js:487-489` (`POST /publish`) — coarse `rbac('grades','create')` PLUS a hardcoded `if (!['admin','superadmin'].includes(role))` | **Correction (2026-09-03): an earlier version of this document conflated this row with `report_cards.publication_policy` below as "the same action" — they are not.** `publication_policy` governs a genuinely different, already-correctly-gated feature (moderation-bypass config, `_loadPublicationPolicy`/`GET+PATCH /publication-policy`). This row, `grades.report_generate`, is the actual "who can click Publish" gate, and it's the one that's hardcoded. See below for the implementation. |
| `export` (Export Grades CSV) | ⚪ **NOT BUILT** | N/A until built | Bulk-download marks | — | **None.** Not in `import-export.js`'s `EXPORT_MODULE` map, no dedicated export route found in `grades.js`. | Same situation as Admissions' `export` row — build the feature first, or drop the row. |

### Exams (5 rows)

| Row | Status | Verdict | Capability | Who | Routes | Notes |
|---|---|---|---|---|---|---|
| `view` | 🔴 DECORATIVE | COARSE | See exam list/results | Teachers, exams_officer | `exams.js:301,363,577,591,792` | |
| `create` | 🔴 DECORATIVE | COARSE | Create/edit an exam definition | exams_officer, HOD | `exams.js:390,408` | |
| `lock` / `unlock` | 🔴 **DECORATIVE — separation-of-duties defeat** | **REAL** | Freeze an exam so results can no longer be edited (and reverse it) | exams_officer, Principal — **deliberately not the teacher entering results** | `exams.js:516,543` — **currently coarse `rbac('exams','update')`, indistinguishable from editing the exam's own metadata** | The entire point of an exam lock is that the person who can enter results should not also be the person who decides when entry closes. Currently identical RBAC action to any other exam edit — this defeats the control's purpose exactly the way the `mark_submissions` case does above. Same DECORATIVE-not-BYPASS reasoning: no hidden alternate gate, just no independent gate at all. |
| `results` (Enter Exam Results) | 🔴 DECORATIVE | COARSE (kept as the base "can enter results" action) | Enter results for own subject/class | Teacher | `exams.js:624` | |
| `delete` | 🔴 DECORATIVE | **REAL** | Permanently remove an exam and its results | exams_officer/Principal only | `exams.js:498` | Standard delete-separation case, and exam results are the kind of record a school cannot casually lose. |

### Report Cards Settings (3 rows)

| Row | Status | Verdict | Capability | Who | Routes | Notes |
|---|---|---|---|---|---|---|
| `draft_comments` | 🔴 DECORATIVE | COARSE | Manage draft comment workflow config | HOD | (not traced) | |
| `workflow` (Configure Approval Workflow) | 🔴 DECORATIVE | COARSE (the workflow config itself is low-frequency, admin-level already by nature) | Define the approval steps | Principal/Admin | (not traced) | |
| `publication_policy` (Configure Publication Policy) | 🔵 **COARSE — already correct, not a finding** | COARSE (leave as-is) | Configure moderation-bypass rules for publishing (default: moderation required) | Principal, Academic Head | `report-cards.js:1197,1207` (`GET`/`PATCH /publication-policy`) — coarse `rbac('report_cards','read'/'update')` | **Correction (2026-09-03):** this row does NOT govern who can click Publish (see `grades.report_generate` above, which does, and is the real BYPASS). This row governs `_loadPublicationPolicy` — moderation-check bypass settings — and is already correctly gated at the coarse `report_cards` module level with no separate finding. Left coarse deliberately: this is infrequent, admin-level configuration, not a day-to-day action needing separation from other Report Cards Settings rows. |

**Grades/Exams/Report Cards summary:** The real finding here isn't "add
5 more sub-keys" — it's that **`mark_submissions` review and `exams`
lock/unlock are both currently indistinguishable from routine editing**,
which quietly defeats the actual purpose of having a review/lock step at
all, and **`grades.report_generate` (who can publish) is already gated,
but by a hardcoded role check the admin cannot see or configure through
Settings — not `report_cards.publication_policy`, which is a separate,
already-correctly-coarse-gated feature.** These three deserve priority
over Finance's `fee_structure`/`import` rows if only one batch can be
done first.

---

## 5. Students & Teachers (7 rows each, identical shape)

The module from this session's original conversation. Both modules
share the exact same 7-row shape (List / Profile / Create / Edit /
Delete / Export / Import), so treated together.

| Row | Status | Verdict | Capability | Who | Routes (students / teachers) | Notes |
|---|---|---|---|---|---|---|
| `list` | 🔴 DECORATIVE | COARSE | See the roster | Nearly every staff role | `students.js:200` / `teachers.js:193` | No real duty-separation case. |
| `profile` | 🔴 DECORATIVE | COARSE | See one person's full record | Same as above | `students.js:310` / `teachers.js:269` | Splitting "list" from "profile" adds a checkbox with no school ever wanting one without the other. |
| `create` | 🔴 DECORATIVE | COARSE | Register a new student/teacher | Admissions/front office (students), HR (teachers) | `students.js:334` / `teachers.js:289` | |
| `edit` | 🔴 DECORATIVE | COARSE (bundled with `create`) | Update a record | Same | `students.js:375` / `teachers.js:351` | |
| `delete` | 🔴 DECORATIVE | **REAL** | Permanently remove a student/teacher record | Principal/Admin only, not routine staff | `students.js:533` (+`/purge`, `:450`) / `teachers.js:520` (+`/bulk`, `:473`) | Deleting a student or staff record is exactly the "should require a level up from daily data entry" case — and both modules already have a *bulk* delete route (`students.js:450`, `teachers.js:473`) that is more consequential still and could reasonably warrant its own even-narrower grant if this becomes real. |
| `export` | 🔴 DECORATIVE | **REAL** | Bulk-download the full roster (CSV) | Admin/Principal, not general staff | `import-export.js` `GET /export/:type` (`type=students`/`teachers`) | A full roster export is a meaningful PII exposure — a receptionist who can look up one family's contact info on screen should not necessarily be able to download every family's contact info at once. Confirmed BUILT (unlike Admissions/Grades' export rows) — present in `EXPORT_MODULE`. |
| `import` | 🔴 DECORATIVE | **REAL** | Bulk-create/update from CSV | Onboarding admin, HR | `import-export.js` `POST /:type` | Same bulk blast-radius reasoning as Finance's `import` row. A bad CSV can silently create or overwrite hundreds of student/teacher records. |

**Students/Teachers summary:** identical recommendation for both — 3 of
7 rows proposed REAL (`delete`, `export`, `import`); the remaining 4
(`list`/`profile`/`create`/`edit`) recommended to stay bundled as one
coarse "can manage day-to-day records" capability.

---

## 6. Cross-cutting: interaction with `extraRoles[]` and `sectionAssigned`

None of the proposed REAL rows above interact with `extraRoles[]` or
`sectionAssigned` directly — those two mechanisms are scoped to
specific, unrelated route files (lessons/teaching-assignments/
weekly-snapshots for `extraRoles[]`; the section-scoped data filter for
`sectionAssigned`) and don't touch Finance, HR, Admissions, Students,
Teachers, Grades, Exams, or Report Cards today. Worth stating explicitly
so implementation doesn't need to reconcile the two systems for this
batch — they're genuinely orthogonal for these 8 modules. If a future
module's granular permission needs "department-scoped" or
"class-scoped" logic (e.g. an HOD who can only approve mark submissions
for their own department), that would be new interaction surface, not
something already implied by the current `extraRoles[]`/`sectionAssigned`
mechanics — flagged for whoever scopes that work, not resolved here.

---

## 7. Communicating `extraRoles[]` / `sectionAssigned` in the UI

Per instruction: not proposing moving these into the Roles & Permissions
grid. Proposing instead that Settings' user-detail view surface a plain,
readable summary of everything contributing to a person's access, so
"why can they still do this" never requires reading source code. A
worked example, using the shape from the Contract's incident:

```
Ann Wanjiku — Admissions Officer

Base Role
  Admissions Officer  →  Full access to Admissions

Additional Responsibilities  (set in HR, independent of role)
  — none —

Section Scope  (set in Classes → Sections)
  — none —

Effective Module Access
  Admissions    Full (Role)
  Attendance    View, Edit  (Personal override — granted beyond role)
  HR            Partial: Staff Documents  (Personal override)
  Settings      View only  (Personal override)
  Timetable     View, Edit  (Personal override)
```

For a teacher with real `extraRoles[]`/`sectionAssigned`, the same view:

```
John Otieno — Teacher

Base Role
  Teacher  →  Standard teaching access

Additional Responsibilities  (set in HR — grants access beyond the base role)
  Class Teacher       →  Form-tutor access for their assigned class
  Head of Department  →  Science  →  department-scoped assignment management

Section Scope
  — none —

Effective Module Access
  ...(role + per-user override table, same as above)...
```

**Design requirements this implies, not yet built:**

- A single read endpoint that assembles: `users.role`, `teachers.extraRoles[]`
  (with `departmentId` resolved to a name where relevant), `users.sectionAssigned`
  (resolved to a section name), and the person's effective module
  permissions (reusing the now-unified `_mergeUserOverrides`) — one
  call, one source of truth, not four separate lookups the admin has to
  mentally reconcile.
- Each line should say **where it was set** ("set in HR", "set in
  Classes → Sections", "Personal override") so an admin who wants to
  *change* something knows which screen to go to, not just that a
  difference exists.
- This is purely additive/read-only UI — it doesn't change how any of
  these three mechanisms actually grant or restrict access, only how
  their combined effect is explained.

---

## 8. Recommended implementation order, if/when this proceeds

Not a commitment to build any of it. Ordered by priority tier — fix
false security boundaries before adding new granularity, since a BYPASS
or defeated-separation-of-duties finding is a materially worse state
than an honestly-coarse permission:

**Priority 0 — Correctness / security-boundary fixes (not new features)**

- `grades.report_generate` — reconnect the already-working
  admin/superadmin-only publish gate to `role_permissions`/Settings
  instead of the hardcoded role-name check in `report-cards.js:489`.
  (Not `report_cards.publication_policy` — corrected above; that row
  governs a separate, already-correctly-gated feature.)
- `grades.mark_submissions` — separate mark review/approval from
  `enter_marks` (`mark-submissions.js:196`); confirm whether a
  same-person self-approval guard exists independent of RBAC while
  this is touched.
- `exams.lock`/`unlock` — separate from routine exam editing
  (`exams.js:516,543`).
- `hr.leave_view` — give `hr.js:186`'s `GET /leave` an actual
  `rbac()` call instead of its current undocumented in-handler check.
- `extraRoles[]` / `sectionAssigned` visibility (§7) — so an admin can
  see the full picture of a person's access while all of the above is
  being worked on, not after.

**Priority 1 — Financial separation of duties**

- `finance.void_invoice`, `finance.record_payment`,
  `finance.create_invoice`, `finance.fee_structure`, `finance.import`.
- `finance.mpesa`'s module-ownership decision (Finance vs. Settings) —
  a decision to make before any code, not an implementation task
  itself.

**Priority 2 — Admissions**

- `admissions.move`, `admissions.delete` first.
- Then decide, separately, whether `view`/`create`/`edit` genuinely
  need splitting for any real school's workflow — this document
  recommends leaving them coarse, but that's a judgment call worth a
  second look once the higher-priority tiers are done.

**Priority 3 — Academic records**

- `students.delete`/`export`/`import`, `teachers.delete`/`export`/`import`.
- Any remaining Grades/Exams rows not already covered by Priority 0.

**Priority 4 — Everything else**

- Tier 2/3 modules from the Contract (Attendance, Classes, Behaviour,
  Timetable, Messages, Resources, eLearning, Library, Transport,
  Hostel, Reports, Analytics, Growth Profile) — only after this
  document's method has been applied to each, the same way it was
  applied here. Not started, not scoped yet.

No code changes accompany this document.
