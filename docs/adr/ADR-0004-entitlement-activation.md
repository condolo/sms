# ADR-0004: Entitlement Activation — Dual-Read Plan Gate (C10)

**Status:** Accepted — approved 2026-07-18, explicitly and separately from the plan that drafted it.
**Date:** 2026-07-18 (drafted and accepted)
**Implementation:** In progress — see `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`'s C10 row for current status.
**Change class:** Kernel (per `PLATFORM_OPERATING_MODEL.md` §10) — changes the access-control decision path on every plan-gated route in the application. Requires Architecture Review sign-off before implementation, same bar as ADR-0001 and ADR-0003. Not eligible for the lighter, bundled treatment ADR-0002 received — ADR-0002 explicitly self-declared it does *not* meet the Kernel-tier bar; this ADR's own dependency-graph row uses the word "Kernel-tier" that ADR-0002 disclaims.
**Unblocks:** C10 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`.
**Related:** C3 (Entitlement registry — `server/utils/entitlements.js`, `server/routes/platform.js`'s entitlement CRUD, `server/__tests__/entitlements.test.js`, `server/__tests__/routes/platform-entitlements.test.js` — shipped, tested, currently unused), `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` row R3 ("Plans vs Entitlements decoupling... Own ADR (Kernel-tier); not 'foundation,' sequence deliberately"), `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §8 ("Plans and features must never be coupled... Plans never determine permissions. Entitlements determine capabilities."), `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` §3(b) (the dual-read obligation this ADR exists to satisfy).

---

## Context

`server/middleware/plan.js`'s `FEATURE_PLAN` map hard-couples a school's commercial plan tier to every feature it can access, and `planGate(feature)` enforces it on every gated route. C3 built a parallel `entitlements` collection — a per-school, per-capability grant independent of plan tier, for enterprise contracts, promos, or grandfathering — but nothing in the application reads it. `server/utils/entitlements.js`'s own header comment names this exact gap as future work: "dependency graph C10 — flipping the plan gate to a dual-read entitlement check."

C10 is the last piece connecting that split. Its only dependency, C3, is done. But per the dependency graph (`IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md:25`) and the Governance Review (row R3), C10 is independently classified **Kernel-tier**, not eligible for the lighter treatment C3 (additive table) and C7 (additive shadow collection) received — those were "implemented directly following the plan approved in-session"; this is not. This ADR is that separate gate.

**Blast-radius research** (direct grep across every `server/routes/*.js`, cross-checked against `FEATURE_PLAN`'s definitions): 33 `planGate(...)` invocations across 29 route files reach the middleware at runtime, spanning 21 distinct feature keys (`students, attendance, classes, teachers, grades, admissions, behaviour, timetable, bell_schedule, exams, exam_series, mark_submissions, finance, growth_profile, library, transport, hostel, lessons, elearning, analytics, hr` — some routes gate on a shared key rather than their own name, e.g. `assessment.js`/`comment-banks.js`/`report-cards.js` all call `planGate('grades')`). **Every one of these 21 keys resolves to `'core'`** in `FEATURE_PLAN` (`server/middleware/plan.js:33-68`) — the lowest tier, which every school holds by default. Only `student_portal` (`standard`) and `parent_portal` (`premium`) are gated above core, and neither is ever passed to `planGate()` anywhere in the codebase today (enforced elsewhere, out of scope here). This means `planGate()`'s deny branch has never fired in production for any real route — activation is near-zero-risk in practice.

That finding does not change the classification. "Low practical risk today" and "Kernel-tier per governance classification" answer different questions; this ADR treats the dual-read obligation as a structural requirement of the design, not a risk-based one that low practical risk would excuse.

This document was drafted after a direct-code-read research pass (`plan.js`, `entitlements.js`, every `planGate` call site, `platform.js`'s entitlement routes, `indexes.js`'s entitlement index block) and a Plan-agent pressure-test of the proposed design against those same files, including verifying `_planCache`'s existing call sites, the entitlement grant/revoke routes' index shape, and every test file that currently touches `planGate` (all of which stub the entire `middleware/plan` module and never exercise its real internals — confirmed there is no existing direct test of `plan.js` today).

## Decision

### 1. Entitlements are strictly additive over plan — never subtractive

`planGate(feature)`'s logic changes from a single plan-tier comparison to a two-step check:

1. Compute `schoolLevel`/`requiredLevel` exactly as today (unchanged: `_getSchoolPlan`, `PLAN_LEVELS`, the 5-minute `_planCache`).
2. **If `schoolLevel >= requiredLevel`, grant access immediately — no entitlement lookup at all.** The plan alone already grants it; nothing about entitlements needs to be consulted, checked, or reasoned about on this path.
3. **Only when the plan alone would deny** (`schoolLevel < requiredLevel`) does the middleware consult `hasEntitlement(schoolId, feature)` (`server/utils/entitlements.js`, already built, DI-able, tested) as an override. An active, unexpired entitlement for that exact feature key grants access; anything else — no doc, revoked, expired, or a lookup error — denies, exactly as today.

This is the minimal-risk reading of the governance text. `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §8 describes entitlements only through additive examples ("might separately hold entitlements for AI Reports, Payroll, an SMS bundle, or a QuickBooks integration") — never a subtractive one. The `entitlements` collection's own schema (`status: 'active'|'revoked'` only, no "denied" state) structurally cannot express "this school is explicitly forbidden from a feature its plan would otherwise grant" — building that state now would be new schema and new semantics beyond what C10's own description ("flip plan.js's gate... dual-read fallback") asks for, and no governance text requests it.

**Why this design satisfies the dual-read requirement structurally, not just at rollout.** `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` §3(b): *"the registry, when a school has no explicit entitlement, must fall back to exactly what FEATURE_PLAN grants today. Without that, a school silently loses access to a feature the moment the gate flips."* Because step 2 above short-circuits before any entitlement lookup whenever plan alone already grants access, there is no code path — on the first request after this ships, or the millionth, or after any future entitlement grant/revoke — where a school ends up with *less* access than plan alone would give it. The fallback isn't a migration-window property; it's permanent, by construction.

### 2. Entitlement-lookup errors resolve to today's denial, never a new failure mode

If `hasEntitlement()` throws (a transient DB error, for example) on the deny-path override check, that error is caught locally inside `planGate()` and treated as `granted = false` — falling through to the same 403 the route would have returned before this ADR, not a 500. Without this, an entitlement-lookup failure would fall through to `planGate()`'s existing outer catch and surface as a brand-new `PLAN_CHECK_ERROR` 500 on a code path that, pre-C10, could only ever cleanly 403 — itself a regression against the dual-read guarantee (a lookup failure must degrade to "exactly what FEATURE_PLAN grants today," not to a new error class).

### 3. No caching layer for `hasEntitlement()` in this design

Unlike `_getSchoolPlan`'s `_planCache`, entitlement lookups are not cached. Reasoning: (a) `hasEntitlement()`'s query is a single indexed `{schoolId, key}` point read (`ent_school_key`, `server/utils/indexes.js`) — cheap; (b) per the blast-radius finding above, the deny path this lookup lives on is cold today — no real route currently reaches it; (c) `_planCache` itself is already flagged in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` as *"a fourth in-memory per-process cache... same single-instance staleness risk"* as the RBAC/scope/token-version caches — a known, already-recorded platform limitation. Adding a fifth such cache to solve a problem that doesn't exist yet (no route has real deny-path traffic) would compound a recorded issue rather than address one. Revisit if entitlement grants start covering routes with genuine deny traffic.

### 4. Unknown feature keys stay fail-closed, unchanged, entitlements never consulted

`planGate()`'s existing behavior for an unregistered `FEATURE_PLAN` key — 403 `PLAN_UPGRADE_REQUIRED`, logged as a configuration error — is untouched and happens *before* any plan-tier or entitlement check. This ADR does not weaken that guard; an entitlement can never rescue a route that references a feature key nobody registered.

### 5. Entitlement keys remain unvalidated against `FEATURE_PLAN`'s key set

`POST /schools/:id/entitlements` (`platform.js`) validates a granted `key` only against a slug-shape regex (`/^[a-z][a-z0-9_]{1,49}$/`), not against `FEATURE_PLAN`'s registered keys — this is existing, unchanged behavior. A platform admin can grant an entitlement for a key with no matching `planGate()` call site anywhere; such a grant is inert (never consulted by anything), not an error. This ADR does not tighten that validation — see Non-goals.

## What this explicitly does NOT cover (non-goals)

- **No "denied" or subtractive entitlement state.** The registry only ever grants access beyond what plan provides; it can never suppress access plan already grants. Building a denial mechanism is future work, not requested by any governance text, and out of scope here.
- **No caching layer for `hasEntitlement()`.** See Decision 3.
- **No change to `student_portal`/`parent_portal` gating.** Neither key is ever passed to `planGate()` today; whatever mechanism enforces portal-tier access today is untouched.
- **No tightening of the entitlement-key validation regex** to check membership in `FEATURE_PLAN`'s key set. Freeform (shape-validated) keys stay forward-compatible with future entitlement kinds that may never go through `planGate()` at all.
- **No new UI.** The grant/revoke UI in `platform.html`'s Schools table (built under C3) is unchanged — it becomes functionally live (grants now actually gate something) without any interface change.
- **Ships no code.** This document proposes a design; §Adoption gate states plainly that implementation is a separate, later step.

## Consequences

**Easier / safer:**
- The existing entitlement grant/revoke UI (built under C3, previously inert) becomes functionally live — enterprise contracts, promotional access, and grandfathering are now possible without minting new plan tiers, the exact capability `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §8 describes.
- The dual-read guarantee holds permanently and structurally (Decision 1), not just for a migration window — there is no future state, including after any number of entitlement grants or revocations, where a school has less access than its plan alone provides.
- Zero behavior change for every school today (verified via the blast-radius finding: every real gated feature already passes at the plan level alone).

**Harder / newly constrained:**
- `planGate()`'s deny path now performs one additional DB read (only when plan tier alone would already deny) — currently cold in production, but worth monitoring if entitlement grants start covering routes with real deny traffic, at which point the no-cache decision (Decision 3) should be revisited.
- Entitlement keys stay in a namespace independent of `FEATURE_PLAN`'s keys (Decision 5) — a platform admin granting a typo'd or non-existent key gets no error and no effect, silently. This was already true before this ADR (the grant route never validated against `FEATURE_PLAN`); this ADR does not change or worsen it, but activation makes a silent no-op grant more consequential to notice, since an admin may now expect a grant to do something.

**Explicit non-guarantee:** this makes entitlements consultable, not comprehensive. It does not build a denial mechanism, a caching layer, or key-namespace validation — each is a real, separate design question this ADR intentionally leaves open rather than folding in as scope creep.

## Adoption gate

**This ADR requires explicit approval, separate from approval of the plan or analysis that produced this document, before any implementation begins.** Approving "go draft this ADR" is not approving its contents — same bar as ADR-0001 and ADR-0003, because the dependency graph and the Governance Review both classify C10 as Kernel-tier, independent of how low its practical risk turns out to be.

Once accepted: implementation proceeds as a single change, not a phased rollout — unlike ADR-0003/C8, there is no shadow/dual-write period here, because the "dual-read" behavior described in Decision 1 *is* the permanent runtime design, not a transitional migration state. Implementation covers `server/middleware/plan.js` (the `planGate()` body changes in Decisions 1-2), `server/routes/platform.js` (updating the now-stale "not yet consulted by any feature gate" response note), comment-hygiene updates in `entitlements.js`/`indexes.js` (currently say "NOT YET WIRED UP"/"NOT YET CONSULTED"), a new `server/__tests__/plan.test.js` covering every case in this ADR's Decision section (including the no-lookup-when-plan-grants and lookup-throws-resolves-to-403 cases, since both are load-bearing invariants a future "simplification" could silently break), and an update to `platform-entitlements.test.js`'s stale note-text assertion.
