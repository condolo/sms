# HR & Payroll — Architectural Review

**Date:** 2026-07-23
**Status:** Research only — no code changed as part of this document.
**Scope:** Every proposal named in the review request (ownership, engine, configuration,
settings placement, documents, payslips, notifications, workflow, country logic,
dependencies), evaluated against the codebase as it exists today.
**Method:** Direct reads of the actual route files, schemas, index definitions, and
client code that already exist — not the discussion that prompted this review. File:line
references are given throughout so every claim below is checkable. Two research passes
(finance/money-handling architecture; document storage + country/locale architecture)
were run in parallel and their findings cross-checked against my own direct reads before
being included here.

---

## 0. Executive Summary

The single most important finding, and the one that should reframe the rest of this
document: **Payroll is not a proposal. It already exists, shipped, in production**,
as a sub-feature of [`server/routes/hr.js`](../../server/routes/hr.js). Every question
below about "should we build X" needs to first ask "does hr.js already do this, and if
so, does the evidence say extend it or replace it" — and in almost every section, the
answer is extend, not green-field design.

Ten findings worth knowing before reading the sections in detail:

1. **Payroll already exists as flat CRUD, not an engine.** `PayrollSchema`
   ([hr.js:47-55](../../server/routes/hr.js#L47)) is `{staffId, staffName, payPeriod,
   basicSalary, allowances, deductions, notes}` — single numbers, no tax bands, no
   itemized allowance/deduction types, **no currency field**, and gross/net computed
   inline (`grossSalary = basicSalary + allowances; netSalary = grossSalary -
   deductions`, [hr.js:438-439](../../server/routes/hr.js#L438)) rather than in a
   reusable, testable function.

2. **"Employee Documents via Google Drive links" is not a proposal — it's the shipped
   implementation**, and not just for HR. `staff_documents.fileUrl` is a plain
   `z.string().url()` ([hr.js:65](../../server/routes/hr.js#L65)), and the client UI
   literally says: *"Paste a shareable link to the document stored in Google Drive,
   OneDrive, or Dropbox"*
   ([HRPage.jsx:302-305](../../client/src/pages/hr/HRPage.jsx#L302)). The identical
   URL-only pattern repeats in `growth-projects.js` (`evidenceUrls`),
   `growth-records.js` (`evidenceUrl`), `library.js` (`coverUrl`), and `resources.js`
   (`url`) — this is a deliberate, platform-wide convention, not an HR shortcut.

3. **Payroll is already classified as HR, not Finance, by every signal the codebase
   has.** Module registry: `{key:'hr', label:'HR & Payroll', ...}`
   ([moduleRegistry.js:136](../../server/config/moduleRegistry.js#L136)) with
   `payroll_view`/`payroll_export` as HR subs. RBAC resource key on every payroll route
   is `'hr'`, never `'finance'`. Client routing binds `payroll.*` under `/hr/payroll*`.
   `finance.js` is a structurally separate module (invoices/payments/fee_structures —
   parent → school receivables only) with zero code or collection overlap.

4. **A config-driven, banded-calculation precedent already exists and is directly
   reusable in *shape*** — `academic-config.js`'s grading schema (Zod array-of-bands,
   overlap validation, per-school upsert-with-defaults-merge, exported pure resolver
   `resolveGrade(score, gradingSchema)`,
   [academic-config.js:816-841](../../server/routes/academic-config.js#L816)) — but
   **there is no existing precedent for a *tenant-editable* statutory rate table**, and
   naively copying academic-config's per-school scope would be architecturally wrong
   for tax bands (see §3).

5. **A generic, proven approval-workflow engine already exists**
   ([workflow-config.js](../../server/utils/workflow-config.js)) and is live in
   production for leave approval. It is genuinely reusable for payroll approval with
   **zero new engine code** — just a new `workflowKey`.

6. **Report cards already prove the exact pattern the payslip proposal is asking
   for** — versioned, superseded-never-deleted structured snapshots
   ([report-cards.js:17](../../server/routes/report-cards.js#L17)), PDF generated on
   demand from that stored data, for a document with equivalent legal weight to a
   payslip. This is not a best-practices argument; it's already-shipped, already
   security-reviewed prior art in this exact codebase.

7. **No payment-disbursement (B2C/payout) capability exists anywhere.**
   `server/utils/mpesa.js` implements only Daraja STK-push and C2B (money flowing
   customer → school). There is no B2C integration, and no generic "payment provider"
   abstraction — M-Pesa is hardcoded throughout. Actually *paying* staff through the
   platform is genuinely new integration work, not a wiring exercise.

8. **No accounting/ledger primitive exists anywhere** (confirmed by exhaustive grep —
   no journal entries, no chart of accounts, no double-entry model). `payroll.status =
   'paid'` today is a manual admin flag with no linkage to any actual money-movement
   record. If real disbursement/reconciliation is ever wanted, there's nothing to
   extend — that's genuinely new territory, and out of scope for this review unless
   explicitly requested.

9. **Kenya-specific statutory fields already exist, but only as inert identity
   strings, on the wrong collection.** `teachers.js` has `nationalId`, `nssfNo`,
   `shaNo`, `kraPinNo` ([teachers.js:49-52](../../server/routes/teachers.js#L49)),
   protected by a real sensitivity model (`_stripSensitive`, `FULL_ACCESS_ROLES`,
   query-level `LIMITED_PROJECTION`) — but **no calculation anywhere reads them**, and
   they live on `teachers`, a *teaching-staff-only* collection, while `hr.js`'s own
   `staffId` already correctly spans the broader `users` population — confirmed by
   `GET /payroll/mine`'s self-service filter, `{schoolId, staffId: userId}`
   ([hr.js:393](../../server/routes/hr.js#L393)), proving payroll's own `staffId`
   values are `userId` values, not `teachers.id` values. A non-teaching employee (an
   accountant, a driver) has nowhere today to hold statutory numbers.

10. **The current payroll implementation has real, independently-fixable gaps
    regardless of any redesign decision**: zero `AuditService` calls anywhere in the
    payroll routes (all 3 audit call sites in hr.js are leave-only —
    [hr.js:287,304,364](../../server/routes/hr.js#L287)); zero notification wiring;
    **no database-level unique index** backing its own `{schoolId, staffId,
    payPeriod}` upsert key (confirmed absent from `indexes.js` — contrast with
    `billing_snapshots`, which *does* have `unique: true` on its equivalent key,
    [indexes.js:432](../../server/utils/indexes.js#L432)); no currency field, while
    `finance.js` invoices explicitly carry one.

None of this means "start over." It means: read hr.js's existing payroll feature as
the baseline, close its concrete gaps first, and extend it along lines the codebase has
already proven elsewhere — rather than treating any of the six proposals as a
green-field design problem.

---

## 1. Payroll Ownership — HR submodule, or a Financial domain?

**Evidence.** `moduleRegistry.js` defines `hr` and `finance` as two structurally
separate top-level permission modules:

```js
// server/config/moduleRegistry.js:113-123
{ key: 'finance', label: 'Finance', section: 'Operations', subs: [
  { key: 'invoices', ... }, { key: 'create_invoice', ... }, { key: 'void_invoice', ... },
  { key: 'payments', ... }, { key: 'record_payment', ... }, { key: 'print', ... },
  { key: 'fee_structure', label: 'Manage Fee Structures' },
  { key: 'import', ... }, { key: 'mpesa', label: 'Configure M-Pesa Integration' },
]},
// server/config/moduleRegistry.js:136-143
{ key: 'hr', label: 'HR & Payroll', section: 'Operations', subs: [
  { key: 'staff', ... }, { key: 'leave_view', ... }, { key: 'leave_approve', ... },
  { key: 'payroll_view', label: 'View Payroll' },
  { key: 'payroll_export', label: 'Export Payroll (CSV)' },
  { key: 'documents', label: 'Manage Staff Documents' },
]},
```

Payroll's own routes gate on `rbac('hr', ...)`, never `rbac('finance', ...)`
([hr.js:408,431,477,506,559](../../server/routes/hr.js#L408)). Both modules are plan-gated
at the same tier (`finance: 'core'`, `hr: 'core'` — no signal there). Client-side, the
API bindings are `client/src/api/client.js`'s `payroll.*` → `/hr/payroll*`, and the UI
lives entirely in `client/src/pages/hr/HRPage.jsx` — no finance-page involvement.

`finance.js` itself is scoped exclusively to **money owed *to* the school** (student
fee invoices/payments, `_calcInvoiceTotals`/`_calcBalance`,
[finance.js:34-50](../../server/routes/finance.js#L34)). There is no field, endpoint, or
aggregation anywhere in finance.js representing money the school owes a person — that
direction (school → staff) exists nowhere except in hr.js's payroll feature.

**Verdict: stays under HR.** Reclassifying Payroll into a separate "Financial domain
that HR consumes" would fight three independent, already-shipped signals at once: the
module registry's classification, the RBAC resource key, and the client routing. It
would also blur a real permission boundary that currently *works correctly*: a Finance
Officer with `finance` permissions (invoices, payments, fee structures) has no implicit
reason to see salary data, and a school that wants HR staff to manage payroll without
touching parent billing (or vice versa) is well-served by the current split. Merging
Payroll into `finance` would either grant Finance staff salary visibility by default or
require a second layer of sub-permissioning that doesn't exist today and isn't needed
if the boundary is simply left alone.

**Where I'd push back on the premise, in the other direction:** the discussion's framing
("should Payroll evolve into a larger Financial domain") presumes Payroll and Finance
are the same *kind* of problem because both involve money. The evidence says they are
opposite directions of the same underlying discipline — Finance is a receivables
engine (invoice → payment → balance), Payroll is fundamentally an
employee-compensation record with no receivables shape at all. If actual **disbursement**
(the platform executing a real payment to a staff member) is ever built, that specific
capability is closer to being "financial" in the reconciliation sense — but per finding
8, no ledger/reconciliation primitive exists in *either* module today, so that piece
would be new regardless of which module's name it's filed under. Recommend deciding
that question only when disbursement is actually being built, not now.

---

## 2. Payroll Engine — screens, or a computation engine?

**Evidence the current implementation is "a collection of screens."** Every payroll
route in `hr.js` is a thin, independent CRUD handler. The one piece of "calculation"
that exists is two lines, inline, inside the `POST /payroll` handler, not exported or
reusable:

```js
// server/routes/hr.js:438-439
const grossSalary = data.basicSalary + data.allowances;
const netSalary   = grossSalary - data.deductions;
```

There is no shared, pure, independently-testable payroll calculation function anywhere
— if a payslip renderer, a bulk-run action, and the create/update route all need
"compute this person's pay for this period," today that logic would need to be
copy-pasted three times or extracted for the first time.

**Directly relevant precedent, already built in this codebase, for exactly this
problem.** `report-cards.js` had the identical issue: one monolithic function did both
"decide what a report card contains" and "draw it with pdfkit." This session's own
RC1/RC2 work split it into `_computeReportSections` (pure function: snapshot + config →
plain-data description, zero pdfkit calls,
[report-cards.js:867](../../server/routes/report-cards.js#L867)) and `_drawReportPage`
(the one adapter that walks that data and draws it,
[report-cards.js:954](../../server/routes/report-cards.js#L954)) — specifically so the
"what" is independently testable and reusable for a second renderer later, and so a
future template change can't retroactively alter what an already-computed record means.
`academic-config.js`'s exported `resolveGrade(score, gradingSchema)`
([academic-config.js:816](../../server/routes/academic-config.js#L816)) is a second,
smaller example of the same discipline: pure function, exported specifically so other
routes don't reimplement the algorithm.

**Verdict: yes, an engine-shaped refactor is justified — but scope it precisely.**
"Engine" here should mean one pure function,
`computePayrollForPeriod(staffProfile, payPeriod, config) → {grossPay, deductions: [...],
allowances: [...], netPay, breakdown}`, callable from the create/update route, a bulk
"run payroll for this period" action, and later a payslip renderer — mirroring
`_computeReportSections`'s role exactly. This is **not** a case for a generalized
rules engine, scripting DSL, or plugin system. Every config-driven feature that already
exists in this codebase resists that: academic-config's grade bands are a flat array +
`.find()`, not a rules engine; workflow-config's steps are an ordered array + a
resolver function, not a DSL; this session's own ADR-0006 (job-queue) explicitly scoped
itself as "not the full Connector Registry... scoped honestly smaller" rather than
building a general framework. Building anything heavier than a typed config document +
one pure calculation function for Payroll would be the first engine of that weight
anywhere in the platform, with no precedent and no demonstrated need for that much
generality.

---

## 3. Configuration-Driven Payroll

**Evidence for the proposal, directionally.** `academic-config.js` is a strong, proven
precedent for exactly this shape of problem: one Zod-validated config document per
school ([academic-config.js:66-109](../../server/routes/academic-config.js#L66)),
upserted with `findOneAndUpdate({schoolId}, {$set:{...}}, {upsert:true})`
([academic-config.js:184-188](../../server/routes/academic-config.js#L184)), always
merged over hardcoded defaults so a school with zero config still works
(`_mergeConfig`, [academic-config.js:118-149](../../server/routes/academic-config.js#L118)),
with custom band-overlap validation before save
([academic-config.js:172-182](../../server/routes/academic-config.js#L172)) and a pure,
exported resolver function. `pricing.js`'s `SETUP_FEE_BANDS`
([pricing.js:58-63](../../server/config/pricing.js#L58)) is a second, simpler
band-lookup precedent (`bands.find(b => count <= b.maxStudents)`).

**Where the proposal, taken uncritically, is architecturally wrong.** Both of those
precedents are the wrong *scope* for statutory tax bands specifically.
`academic-config.js` and `workflow-config.js` are both **per-school** documents, because
grading policy and approval chains genuinely vary school-by-school. PAYE tax bands,
NSSF rates, and SHA (formerly NHIF) contribution rates are **not** school-specific —
they are set by national government and apply identically to every school in that
country. If statutory bands were stored as a per-school config document (the naive
"just copy academic-config.js's shape" move), every single school would need to
independently configure and keep current an identical government tax table, and a
single government rate change would require updating N documents instead of one. That's
real, avoidable duplication and a real maintenance/compliance risk (a school that
forgets to update its copy is now calculating PAYE incorrectly) — not a hypothetical.

**Correct shape, still evidence-grounded:** two tiers of configuration, not one.

- **Platform/country-level statutory config** (PAYE bands, NSSF rates, SHA rates) —
  scoped like `pricing.js`'s `SETUP_FEE_BANDS` (global, not per-tenant) but needs to be
  Mongo-backed and platform-admin-editable rather than hardcoded, since these figures
  change on a government fiscal calendar the platform doesn't control. This belongs in
  the same governance category as `platform_settings` — a `PLATFORM_COLLECTIONS`-exempt
  collection ([tenant-model.js:47-57](../../server/utils/tenant-model.js#L47)), keyed
  by `{country, effectiveDate}`, edited via a platform-admin route (mirroring how plan
  pricing and entitlements are platform-admin-only today), never school-editable.
- **School-level policy config** (which allowance/deduction *types* this school uses,
  school-specific payroll policies like leave-to-payroll interaction) — this genuinely
  mirrors `academic-config.js`'s shape correctly: per-school, Zod-validated,
  upsert-with-defaults-merge.

**Bottom line:** "configuration-driven" is directionally right and matches this
platform's established taste, but "one config, one scope" is wrong. The distinction
between platform/country-level statutory truth and school-level policy is the load-bearing
architectural decision here, and it's only visible by reading how `country`-branching
already works elsewhere (§9) rather than by pattern-matching academic-config.js alone.

---

## 4. HR Settings vs. Payroll Configuration

**Evidence there is no generic "module settings" surface to place Payroll settings
inside or outside of.** `GET/PUT /api/settings` is the current user's own personal
account (name, password) — [settings.js:106-123](../../server/routes/settings.js#L106).
`GET /api/settings/school` is school profile data (name, logo, SMTP, currency,
timezone) — a different, single-purpose endpoint. Neither is a place any module's
business configuration lives. Every module that needs its own config manages its own
dedicated collection instead: `academic-config.js` → `academic_config`;
`workflow-config.js` → `workflow_configs` (keyed by `workflowKey`, not by module);
`notif-settings.js` → its own registry. There is no monolithic "Settings" document that
a "Payroll Settings" page would be nested inside of, or separated from — the premise of
the question assumes a settings surface this codebase doesn't have.

**Verdict: given §3's two-tier finding, the real answer is three things, not one
setting surface, and none of them is "inside a generic HR Settings screen":**

1. A school-level `hr`-RBAC-gated payroll-policy collection (allowance/deduction type
   catalogue, school-specific policy) — genuinely "HR settings" in spirit, reusing
   academic-config.js's exact pattern. Recommend surfacing this as a "Payroll Settings"
   tab **inside** the existing `HRPage.jsx`, alongside the leave-chain builder that
   already lives there — same page, same permission key, not a new top-level nav item.
2. A platform-level statutory-bands collection, editable only by platform admins,
   **not** exposed as a school-facing settings page at all (same posture as plan
   pricing).
3. `workflow_configs`, reused with a new `workflowKey` for payroll approval — no new
   config surface needed (see §8).

---

## 5. Employee Documents (Google Drive links)

This section needs reframing before answering the sub-questions: **this is not a
proposal to evaluate against a blank slate. It is already the shipped
implementation**, and not an HR-specific one.

```js
// server/routes/hr.js:57-67 (DocSchema)
fileUrl: z.union([z.string().url(), z.literal('')]).optional().default(''),
```
```jsx
// client/src/pages/hr/HRPage.jsx:302-305
<label>Document Link <span>(optional)</span></label>
<input type="url" placeholder="https://drive.google.com/… or OneDrive / Dropbox link" />
<p>Paste a shareable link to the document stored in Google Drive, OneDrive, or Dropbox.</p>
```

The identical "store a URL, nothing else" pattern repeats verbatim in
`growth-projects.js` (`evidenceUrls: z.array(z.string().url())`), `growth-records.js`
(`evidenceUrl`), `library.js` (`coverUrl`), and `resources.js` (`url`) — five call
sites across five unrelated features, all bare-URL, none with a provider abstraction.
This is a deliberate, consistent platform convention, not a shortcut anyone should
second-guess in isolation for HR alone.

Answering the specific sub-questions with that framing:

- **Compatible with existing document architecture?** Trivially yes — it *is* the
  existing document architecture, platform-wide, not just for staff documents.
- **Do we already have document abstractions elsewhere?** No. Exhaustive search for a
  generic `documents`/`attachments` collection or registry across the server tree found
  nothing. Every "document" reference is a bespoke, per-feature URL field with no
  shared schema.
- **Would a Document Registry be more appropriate?** Only if the platform decides to
  generalize the pattern across *all five* existing URL-field usages at once. Building
  one for HR/Payroll alone would create a sixth, inconsistent pattern next to the five
  that already exist — worse than staying consistent with the status quo. If a
  Document Registry is ever justified, it's a platform-wide initiative deserving its
  own review, not something to fold into Payroll scope. There's also no evidence in the
  code that anyone has hit a real limitation with the current approach — building a
  registry now would be solving a hypothetical, not an observed problem.
- **URLs, File IDs, or provider abstractions?** Staying consistent with the established
  pattern argues for URL. One real, evidence-backed exception exists though:
  `server/routes/elearning.js` already has a working, OAuth-token-based **real** Google
  Drive upload integration — `POST /api/elearning/drive/upload`
  ([elearning.js:452-494](../../server/routes/elearning.js#L452)), using the
  `drive.file` scope, uploading actual bytes via the school's connected Google account
  and returning a real `{fileId, webViewLink}`. This is a materially heavier mechanism
  than "paste a link you made yourself elsewhere," and nothing in the current Employee
  Documents feature (or the discussion that prompted this review) asks for it — but if
  real upload-to-Drive is ever wanted, this is the mechanism to extend, not reinvent.
- **How would future Drive integration affect this design?** Additively, at low risk:
  `fileUrl` (pasted link) stays for manually-provided links; a new optional
  `driveFileId` field would hold documents uploaded via the elearning.js-style OAuth
  flow, with `fileUrl` becoming a cached/derived `webViewLink`. No breaking migration
  implied by the current schema.
- **Security/permission implications?** Two, both concrete. First, `teachers.js`
  already has a real sensitivity model for exactly this class of data — `nationalId`,
  `nssfNo`, `shaNo`, `kraPinNo` are stripped from non-privileged responses
  (`_stripSensitive`, [teachers.js:78-82](../../server/routes/teachers.js#L78)) and
  excluded **at the database query level**, not just filtered from the response, via
  `LIMITED_PROJECTION` ([teachers.js:97-99](../../server/routes/teachers.js#L97)) —
  `staff_documents` has no equivalent today: any HR-role viewer sees every `fileUrl`
  regardless of `type`, so a `contract` document is exposed identically to an
  `id_copy`. Second, and more fundamental: because `fileUrl` is an external link,
  Msingi's own RBAC is irrelevant to who can actually open the document — if a staff
  member's Google Drive sharing setting is "anyone with the link," the platform's access
  control is bypassed entirely by the target's own sharing settings. This is a real,
  already-present limitation worth documenting explicitly, independent of any Payroll
  decision.

---

## 6. Payslips — stored PDFs, or generate on demand from structured data?

**Direct, already-shipped precedent for exactly this proposal.** `report-cards.js`
already implements "store structured data immutably, render on demand" for a document
with equivalent legal/compliance weight to a payslip (a formal academic record vs. a
formal financial/statutory record):

```
POST /generate    — live preview, NOT persisted
POST /publish     — versioned batch snapshot (admin only); superseded, never deleted
GET  /:id/pdf     — PDF rendered ON DEMAND from the stored snapshot,
                     DRAFT watermark if not yet published
```
([report-cards.js:5-11](../../server/routes/report-cards.js#L5)). This isn't a
best-practices citation — it's the platform's own, already-security-reviewed answer to
the identical problem, in the same codebase.

Evaluating each named concern against that precedent, and against payroll's *current*
implementation:

- **Audit requirements.** Report-card publish/unpublish/moderation-bypass are all
  audited at `severity: 'critical'`. **Payroll has zero audit coverage today** — the
  only 3 `AuditService.log` calls in `hr.js` are leave-related
  ([hr.js:287,304,364](../../server/routes/hr.js#L287)); nothing near the payroll
  routes (430-577) calls it. This must be closed regardless of the payslip-generation
  decision — a `status → 'paid'` transition or a delete of a `confirmed`/`paid` record
  is exactly the class of action this platform already treats as audit-critical
  elsewhere.
- **Immutable payroll records.** Report-cards' answer is *never delete, only supersede
  + version*. **Payroll's current implementation directly contradicts this**: `DELETE
  /api/hr/payroll/:id` permits hard-deleting a `confirmed` or `paid` record, gated only
  on role (`ADMIN_ROLES`, [hr.js:559-577](../../server/routes/hr.js#L559)) — no
  audit trail, no supersede, no trace it ever existed. If payslips are to be immutable
  financial records (which every "audit"/"legal compliance" instinct here says yes),
  this existing capability needs to be removed or restricted, not preserved
  side-by-side with a new "immutable" layer — as coded today, the two are inconsistent.
- **Payroll locking.** hr.js already has a real, working precedent for status-gated
  write locking — `if (['confirmed','paid'].includes(doc.status) &&
  !ADMIN_ROLES.has(role)) return E.forbidden(...)`
  ([hr.js:567-569](../../server/routes/hr.js#L567)), and "only Admin can mark payroll as
  paid" ([hr.js:488-490](../../server/routes/hr.js#L488)). This part is architecturally
  sound and should be preserved/extended (e.g. via the workflow engine, §8), not
  replaced.
- **Historical accuracy, versioning, template evolution.** Report-cards' `version` +
  supersede chain, combined with this session's own RC2 IR/adapter split, directly
  answers "what happens when the template changes": old records render from their own
  stored snapshot, independent of renderer changes made later. That split existed
  specifically to fix a real, previously-discovered bug — two divergent renderers
  producing different output for the same record. Recommend the identical split for
  payslips from day one — `computePayslipSections(payrollRecord, config)` as the pure
  IR, a `drawPayslipPage` adapter — rather than re-learning that lesson the hard way a
  second time.

**Where the proposal, as stated, is incomplete.** "Generate on demand instead of
storing PDFs" is really a three-part discipline, and the report-card precedent shows
all three are load-bearing together: (1) store structured data **immutably and
versioned** — the hard part; (2) render on demand from that data — the easy part,
*given* (1); (3) gate any write to a published/paid record behind an explicit, audited,
override — the moderation-bypass precedent. Adopting only part (2) without (1) and (3)
would produce something weaker than what report-cards.js already proves out, and would
leave the exact hard-delete gap described above unresolved.

---

## 7. Notifications

**Evidence a central mechanism already exists and is actively used.**
`dispatchNotification({ctx, schoolId, eventKey, actorUserId, recipients, inAppSubject,
inAppBody, emailDigestSubject, emailDigestBody, sendEmail})`
([notify-dispatch.js:29](../../server/utils/notify-dispatch.js#L29)) is the single fan-out
helper this session already wired into `report_published`, `exam_results`,
`invoice_created`, `payment_received`, `absence_alert`, and `behaviour_incident`. It
resolves each school's configured channel + frequency preference via
`notif-settings.js`'s registry, so callers never reimplement enabled/frequency
branching.

**Verdict: reuse it, with new eventKeys** (`payroll_confirmed`, `payslip_ready`) —
exactly what the review brief asked to check for, and the evidence is unambiguous that
this already exists and payroll has simply never been connected to it.

**One inconsistency worth flagging rather than repeating.** `hr.js`'s leave workflow
has its *own*, separate, bespoke `_notifyStep`/`_notifyHr`/`_notifyOnlyParties` helper
functions ([hr.js:139-167](../../server/routes/hr.js#L139)) that predate
`notify-dispatch.js` and don't go through it — meaning leave notifications and the
Notif2-era `dispatchNotification`-based notifications are already two separate code
paths coexisting in production. Payroll should use `dispatchNotification` directly, not
copy hr.js's own leave-specific local helpers — doing the latter would add a *third*
notification pattern on top of the two that already coexist, compounding rather than
fixing the inconsistency.

---

## 8. Workflow

**Evidence.** `workflow-config.js` is a genuinely generic, tenant-scoped,
ordered-approval-chain engine: `getWorkflowConfig`/`saveWorkflowConfig`/`resolveStep`/
`resolveAssigneeLabel`, keyed by an arbitrary `workflowKey`, with role-or-user
assignees and a fallback assignee per step
([workflow-config.js:43-101](../../server/utils/workflow-config.js#L43)). It is already
live for `leave_approval` (2-step floor,
[hr.js:26](../../server/routes/hr.js#L26)) and, per this platform's own prior work, for
a single-step `marks_unlock` workflow. Nothing leave-specific is baked into the engine
itself — the leave-specific logic lives entirely in `hr.js`'s route handlers, which
call the generic resolver.

**Verdict: reuse, unambiguously — the cleanest "yes" in this entire review.** Payroll
approval (e.g. draft → confirmed needing HOD + Finance sign-off, or confirmed → paid
needing a second admin) is structurally identical to leave approval: ordered steps,
role-or-user assignees, fallback. Implementation shape: register a new `workflowKey`
(`payroll_approval`), call `getWorkflowConfig`/`resolveStep` exactly as hr.js's leave
routes already do, and adapt `PATCH /payroll/:id/status` to walk the configured chain
instead of its current single `ADMIN_ROLES`-only gate on the `'paid'` transition. Zero
new engine code required — the new route-level chain-walking logic can be modeled
directly on hr.js's own existing leave-approval implementation
(around [hr.js:200-320](../../server/routes/hr.js#L200)) as a copy-adapt, not a fresh
design.

---

## 9. Country-Specific Logic

**Evidence a country-branching precedent already exists, and is the pattern to
follow.** `schools.country` is a real field, flowing through the canonical
tenant-session shape
([tenant.js:104](../../server/middleware/tenant.js#L104)). `onboard.js` already
branches structurally on country at signup — `_currencyForCountry`/`_currencySymbol`/
`_timezoneForCountry` lookup maps covering 11 countries
([onboard.js:615-636](../../server/routes/onboard.js#L615)), and, more significantly,
`_buildAcademicYear(schoolId, country)` branches on `_UK_AU`/`_US_CA` country sets to
build **structurally different term configurations per country**
([onboard.js:396,414](../../server/routes/onboard.js#L396)). This is real precedent for
"country determines the *shape* of a config," not a hypothetical concern to design
from scratch.

**What does NOT exist.** No PAYE, NHIF, or SHIF terms anywhere in the codebase
(confirmed by exhaustive grep). The KRA/NSSF/SHA fields that do exist
(`teachers.js:50-52`) are static identity-record strings, never read by any
calculation — closer to a passport number than a tax input.

**Verdict.** Follow `_buildAcademicYear`'s discipline, not ad-hoc branching: express
"country changes the shape of X" as data-driven resolution in one place — a
`getStatutoryConfig(country, asOfDate)` resolver reading from the platform-level
`{country, effectiveDate}`-keyed collection recommended in §3 — rather than `if
(country === 'KE') { ...inline PAYE math... }` scattered through payroll calculation
code, which is precisely the failure mode the original discussion already correctly
identified as the one to avoid. Build Kenya as the **first row** in that data shape,
not as hardcoded fallback logic with "generalize later" as an afterthought — the data
shape costs nothing extra now, and the alternative is exactly the kind of retrofit debt
this platform's own ADR-0001 tenant-isolation work exists to avoid in other areas.

---

## 10. Dependencies

| Module | Owns today | Payroll's relationship | Boundary that must stay intact |
|---|---|---|---|
| **HR** ([hr.js](../../server/routes/hr.js)) | `leave_requests`, `payroll`, `staff_documents`, `workflow_configs(leave_approval)` | Payroll *is* a sub-feature of this module, today, in production | Stays inside the `'hr'` RBAC/plan/module-registry key (§1) |
| **Finance** ([finance.js](../../server/routes/finance.js)) | `invoices`, `payments`, `fee_structures` — parent → school receivables only | No overlap | Must **not** absorb Payroll's collections/RBAC key (§1); if disbursement is ever built it needs its own primitive, since finance.js models the wrong money direction |
| **Billing** ([billing.js](../../server/routes/billing.js)) | `billing_snapshots` — school → platform subscription | Zero relationship | Cited only to prevent "billing" (subscription) and "payroll" (staff pay) from being conflated — they're easily confused terms for structurally unrelated features |
| **Users/Identity** ([tenant-model.js](../../server/utils/tenant-model.js), provision-identities.js) | The `users` collection | `hr.js`'s `staffId` already correctly equals `userId` (confirmed) | Payroll must consume `users`, not duplicate it with a separate "Employee" entity |
| **Teachers** ([teachers.js](../../server/routes/teachers.js)) | `nationalId`/`nssfNo`/`shaNo`/`kraPinNo` + the `FULL_ACCESS_ROLES`/`_stripSensitive`/`LIMITED_PROJECTION` redaction pattern | Payroll should reuse this redaction *pattern* for its own sensitive fields (bank details, if added) | **Gap, not a clean boundary**: `teachers.js` covers teaching staff only; `hr.js`'s payroll population (any `userId`) is broader. Whether every school's non-teaching staff already get `teachers` records is a business-process question the code doesn't answer — flagging as evidence missing, not assuming either way |
| **Roles & Permissions** ([rbac.js](../../server/middleware/rbac.js), moduleRegistry.js) | The `'hr'` permission key and its subs (already includes `payroll_view`/`payroll_export`) | New granular permissions (`payroll_approve`, `payroll_configure`) belong as new subs under the *existing* `'hr'` key | Not a new top-level module key (consistent with §1) |
| **Settings** ([settings.js](../../server/routes/settings.js)) | Personal account settings + school profile only | Payroll config does **not** belong here (§4) | Follows the academic-config.js/workflow-config.js pattern of dedicated collections instead |
| **Audit** ([services/audit.js](../../server/services/audit.js)) | The `ACTIONS` catalogue + `AuditService.log()` | Payroll currently has **zero** entries/calls — a real, independently-fixable gap (§6) | Must add `payroll.status_changed`/`payroll.deleted`/`payroll.confirmed` entries, mirroring `report_card.publish`'s `critical` treatment for the `'paid'` transition |
| **Notifications** ([notify-dispatch.js](../../server/utils/notify-dispatch.js)) | The single central dispatch mechanism | Must plug in with new `eventKey`s (§7) | Do not build a new mechanism, and do not copy hr.js's own pre-existing bespoke leave-notification helpers either |
| **Workflow** ([workflow-config.js](../../server/utils/workflow-config.js)) | The generic approval-chain engine (§8) | Register a new `workflowKey`; reuse verbatim | Zero new engine code |
| **Reports/Exports** | `moduleRegistry.js` already names `payroll_export` (CSV) as a permission | **Confirmed unimplemented** — `import-export.js` has zero payroll/HR coverage today (grep-confirmed) | The permission key exists ahead of the feature; don't assume `payroll_export` already works because the permission is defined |
| **Accounting (future)** | Does not exist anywhere in the codebase (no ledger, no journal entries, no chart of accounts — confirmed by exhaustive grep) | If disbursement/reconciliation is ever built, this is genuinely new territory | Evidence explicitly missing, per the review brief's own instruction — not assumed to exist, not designed here |
| **API** | Not independently researched in this pass | — | Flagging the gap rather than asserting a finding either way |
| **Document Management** | No generic capability exists (§5) | Payroll should not be the module that invents one | If ever built, it's a platform-wide initiative and a separate review |
| **School Configuration** (academic-config.js precedent; `schools.currency/timezone/country`) | Per-school config | Payroll's platform-level statutory config (§3, §9) is **structurally different in scope** (country-level vs. school-level) | Must not be stored in the same collection/pattern as `academic_config` despite surface similarity — the axis of variation differs |

---

## Closing Recommendation

Don't design Payroll as a green-field module. The evidence across all ten sections
points the same direction: evolve `hr.js`'s existing payroll feature, and where a
proposal calls for new infrastructure, reuse infrastructure this codebase has already
built and proven for a structurally identical problem elsewhere (report-cards' snapshot
discipline, workflow-config's approval engine, academic-config's config-doc shape,
notify-dispatch's fan-out). In priority order, independent of whether every larger
proposal here is pursued:

1. **Close the current implementation's real gaps regardless of any bigger decision** —
   audit logging, notification wiring, a DB-level unique index on `{schoolId, staffId,
   payPeriod}`, a `currency` field. These are correct on their own merits even if none
   of the below happens.
2. **If tax-band configurability is wanted:** two-tier config — platform/country-level
   statutory bands, school-level policy — never a single per-school document naively
   copying academic-config.js's scope (§3).
3. **If approval chains are wanted:** reuse `workflow-config.js` verbatim with a new
   `workflowKey`. Low-risk, low-effort, proven (§8).
4. **If payslip generation is wanted:** follow report-cards.js's three-part discipline
   — immutable versioned data, on-demand rendering, audited status-gated locking — which
   requires first resolving the existing hard-delete-a-paid-record capability, an
   inconsistency that needs a decision either way (§6).
5. **Employee documents: no change needed.** Google Drive/OneDrive/Dropbox links are
   already the shipped, platform-consistent pattern. Do not build a Document Registry
   as part of this work (§5).
6. **Payroll disbursement (actually paying staff) is out of scope for now.** No
   B2C/payout integration and no ledger/reconciliation primitive exists anywhere in the
   codebase. This is the single largest genuinely-new piece of work implied by the word
   "Payroll," and deserves its own dedicated review when the business need is concrete,
   rather than being assumed as part of this scope.
