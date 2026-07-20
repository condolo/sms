# ADR-0001: Tenant Context & Structural Tenant Enforcement

**Status:** Accepted
**Date:** 2026-07-16 (proposed) · 2026-07-16 (accepted)
**Implementation:** Complete as of 2026-07-18 — ratchet at 24 direct-usage sites (from a baseline of 722), all reviewed exceptions (§4) or platform-admin routes out of scope by design. See `CHANGELOG.md` v4.68.0. This closes Governance Review D1.
**Change class:** Kernel (per `PLATFORM_OPERATING_MODEL.md §10`) — changes how every tenant-scoped query is written. Requires Architecture Review sign-off before implementation.
**Unblocks:** C4 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` (the highest-fan-out root).
**Related:** Governance Review D1 (P2 not reflected in code — now closed, see Implementation above), SPC-001, MR-001; `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §11/§17.1/Principle 4.

---

## Context

Tenant isolation is Msingi's most important security property and, today, its least structurally protected. `PLATFORM_OPERATING_MODEL.md` Principle P2 states isolation is *"enforced at the data layer, not assumed at the route layer."* The code does the opposite: `server/utils/model.js` `_model()` is a bare, schema-less Mongoose factory with no tenant plugin and no query middleware. Every route hand-writes `{ schoolId: req.jwtUser.schoolId, ... }` into its own filters, by convention, with no backstop if a developer forgets or mistypes it. (Recorded as Governance Review D1, severity High.)

Today the blast radius is bounded — one `schoolId` per token, one filter pattern repeated. The multi-school evolution multiplies it: the number of places a single missed filter could leak data across a **real customer boundary** grows with every new tenant-scoped feature, and it does so at the exact moment a director is viewing two of their own schools side by side and has no reason to notice a leak. This is why C4 is a root in the dependency graph — everything built after it inherits whatever isolation guarantee it provides, and anything built before it becomes retrofit debt.

**Honest constraint (non-negotiable framing):** in Node/Mongoose, no wrapper can make tenant isolation *fully* structural while raw driver access, `.populate()`, and aggregation exist in the runtime. Anyone who claims otherwise is overselling. The realistic, defensible goal is **defense in depth**: prevent the accidental 95% at the data layer, name the residual explicitly, and cover the residual with a cross-tenant regression suite. This ADR is written to that honest standard, not to an absolute one — consistent with the wording correction already recorded against Evolution Plan Principle 4.

## Decision

### 1. A validated Tenant Context, established once per request

Introduce `req.tenantContext`, set by a middleware that runs immediately after `authMiddleware`. Today it is `{ schoolId }`, read from the already-trusted JWT (`req.jwtUser.schoolId`). It is forward-designed to grow — `{ schoolId, membershipId, organizationId }` — as the membership model lands (C7/C8), without changing its consumers. The context is **validated and singular**: exactly one school, per Constitution Invariant 1. If it is absent, tenant data access **fails closed**.

> Note the deliberate asymmetry with SPC-001: *authentication/revocation* fails **open** on infrastructure error (availability), but *tenant scoping* fails **closed** on missing context (isolation). These are different trust decisions for different failure modes, and both are correct.

### 2. `tenantModel(collection, tenantContext)` — the enforced accessor

A thin wrapper around `_model()` that returns a model whose query surface is force-scoped to `tenantContext.schoolId`:

- `find` / `findOne` / `updateOne` / `updateMany` / `deleteOne` / `countDocuments` — `schoolId` is injected into the filter by the wrapper, not the caller. If the caller passes a **conflicting** `schoolId`, the call is rejected (throws), never silently honored.
- `aggregate` — the wrapper prepends a mandatory `$match: { schoolId }` as the first stage and rejects a caller `$match` targeting a different school.
- Missing `tenantContext` or missing `schoolId` → throw (fail closed). A tenant query with no validated tenant is a bug, not a broad query.

The caller can no longer get `schoolId` wrong because the caller no longer supplies it — the wrapper owns extraction from the validated context.

### 3. Tenant-owned vs platform-level collections

`tenantModel()` applies only to **tenant-owned** collections. Platform-level collections that legitimately have no `schoolId` — `schools`, `organizations`, `release_certificates`, `audit_logs`, `platform_settings`, `landing_content`, `system_announcements`, `queue_jobs` (C11/ADR-0006), `identities` (C8/MR-001, added 2026-07-18 — see §4) — are exempt and continue through `_model()`. A `PLATFORM_COLLECTIONS` set (`server/utils/tenant-model.js`) defines the exemptions; everything not in it is tenant-owned and must be accessed via `tenantModel()`. 

**Special case — `users`:** currently school-scoped (`{schoolId, email}` index, `indexes.js:155`), but its tenancy is exactly what decision **D-001** resolves (platform-global identity vs org-scoped). Until D-001 is ratified, `users` stays school-scoped and is treated as tenant-owned. This ADR does not pre-empt D-001.

### 4. What this explicitly does NOT structurally cover

Named, not hidden — each becomes a reviewed exception, not a silent gap:

- **`.populate()`** — a populated reference pulls from another collection without the wrapper's scoping. Cross-collection populates on tenant data must be scoped manually and are flagged in review.
- **Raw driver access** — `mongoose.connection.db.collection(...)` bypasses the wrapper entirely. Permitted only in audited platform/migration code, never in tenant request paths.
- **Transactions** dropping to the raw session API — same rule.
- **Filters using `$or` where the tenant-matching condition isn't the same on every branch** — found during the C4 migration (`platform.js`'s `/schools/:id/approve`, `/impersonate`, and both `DELETE /schools` routes). `_scopedFilter()` only recognizes a *top-level* `schoolId` key; it doesn't inspect `$or`. A filter like `{ $or: [{schoolId: X}, {email: Y}] }` (admin-recovery-by-email for accounts with a missing/mismatched `schoolId`) or `{ $or: [{schoolId: X}, {schoolId: legacyObjectIdStr}] }` (dual-ID-forms) relies on a branch that does *not* require `schoolId === X`. Wrapping it in `tenantModel(coll, {schoolId: X})` AND-injects `schoolId: X` at the top level, silently making that branch unreachable — the exact records these queries exist to recover become invisible. Left on `_model()`, each site documented inline with why. Before wrapping any filter containing `$or`, check whether every branch already implies the same `schoolId`; if not, don't wrap it.
- **Platform-admin routes** (`platformSession`-protected — `server/routes/platform.js`, `server/routes/qa-health.js` — not school-JWT) are out of scope for `tenantModel()` entirely, not merely unmigrated. `IDENTITY_DOMAIN_MODEL_v1.md`'s cross-boundary rule table places Platform Admin outside this model: it's a different actor with a legitimate need to see across schools (provisioning, billing rollups, health/integrity scanning, orphan detection). Only the sites within `platform.js` where a *specific* school's data is being read (a per-school loop, a `_seedBaseData(schoolId)` helper) were migrated; the genuinely cross-school views were not, and should not be.
- **`identities` (C8/MR-001) — a collection-level exemption, not a route-type one, added 2026-07-18.** Every real call site filters by `{id: identityId}` (auth.js, settings.js) or runs an unscoped platform-wide migration-status aggregate (qa-health.js) — none filter by `schoolId`, because the collection itself is org/credential-scoped by design (ADR-0003 Decision 1), not tenant-scoped. Wrapping these in `tenantModel()` would force-inject a `schoolId` field the documents don't carry, either breaking the query or silently coupling a credential shared across an org's schools to one of them. Added to `PLATFORM_COLLECTIONS` outright, discovered and fixed when the tenant-isolation ratchet (`scripts/verify-tenant-coverage.js`) regressed 24→47 as C8/C9/C10's work landed without the exemption list keeping pace.
- **`memberships`/`entitlements` remaining exceptions** — unlike `identities`, these collections' documents DO carry a real `schoolId`, so they are **not** blanket-exempted; `auth.js`'s `_buildTokenPayload` and `POST /api/auth/switch-school` migrated their single-tenant membership lookups to `tenantModel('memberships', {schoolId})` for the structural guarantee (2026-07-18). What remains on `_model()` is genuinely cross-school: `auth.js`'s `_availableSchools()` (lists every *other* school a user belongs to in an org — inherently multi-school), and `platform.js`'s membership-grant and entitlement CRUD routes (a platform admin acting on an arbitrary target school by `:id`, not their own tenant — same platform-admin carve-out as above).
- **`mark-submissions.js`'s `_autoRelock` job handler (Governance Spec §3, 2026-07-20)** — the 24h auto-relock job runs from `job-queue.js`'s cron worker, with no `req`/JWT and therefore no `tenantContext()` to build. Its two `_model()` calls (`mark_submissions`, `assessment_marks`) filter by an explicit `schoolId` taken from the job's own payload (captured at `enqueueJob()` time, from the authenticated unlock request that scheduled it) — the same manual-scoping posture every other background job in this codebase already uses (e.g. `audit.js`'s security-alert webhook handler). Two sites, ratchet baseline raised 34→36.

### 5. The backstop — a cross-tenant regression suite

Because §4 exists, the wrapper alone is insufficient by design. A dedicated cross-tenant test suite seeds two schools' data, exercises every tenant-scoped endpoint authenticated as School A, and asserts School B's data never appears in any response. This is the safety net for exactly the paths the wrapper cannot reach, and it is a **required deliverable of C4**, not optional.

### 6. Incremental, reversible adoption — never a big-bang rewrite

- `tenantModel()` ships **alongside** `_model()`; nothing is forced to migrate on day one.
- Routes adopt it one at a time, highest-risk tenant data first (students, finance, exams, report-cards), each change independently testable and revertible.
- A CI lint flags **new** direct `_model()` use on tenant-owned collections, so the unprotected surface only ever shrinks.
- No route's external behavior changes — a correctly-scoped query returns exactly what it returns today.

## Consequences

**Easier / safer:**
- The accidental-forgotten-filter class of cross-tenant leak is structurally prevented on the common query path — P2 becomes true instead of aspirational.
- De-risks MR-001: structural isolation exists *before* the identity migration multiplies the tenant count.
- Gives the multi-school phases (C6, C7, C11) a safe substrate to build on rather than retrofit.

**Harder / newly constrained:**
- Every tenant-scoped query must route through `tenantModel()` — a new, enforced discipline.
- `.populate()`, raw driver, and transaction paths carry explicit review obligations.
- New code using `_model()` directly on a tenant-owned collection is **not permitted** (CI-enforced).

**Explicit non-guarantee:** this makes isolation *progressively harder to violate*, not impossible. The wrapper plus the regression suite together are the guarantee; neither alone is.

## Adoption gate

Implementation of C4 may begin once this ADR is **Accepted**. It is decision-independent — it does **not** wait on D-001, D-002, or D-004, and it protects the current single-school product on its own merits.
