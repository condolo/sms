# Implementation Dependency Graph v1.0

**Status:** Draft — pending review. Freeze this before any production code.
**Purpose:** The build-order artifact. For every major component of the Architecture Evolution, it records what it depends on, what depends on it, whether it is additive or migratory, whether it is reversible, and whether it is user-visible. Sequencing is derived from dependency structure — not from the order users would see features, and not from opinion.

**Governing principle (adopted):** *Implement infrastructure in the order dependencies require it, not the order users will see it.* Never expose partially-complete architecture to users. Nothing a school uses today may break.

---

## 1. Component matrix

| # | Component | Depends on | Depended on by | Additive / Migratory | Reversible | User-visible |
|---|---|---|---|---|---|---|
| C1 | **Organization collection** | — (nothing) | C2, C6, C12 | Additive (new collection) | Yes — drop collection | No |
| C2 | **Organization provisioning** (backfill `organizationId` onto every school, 1:1) | C1 | C6, C7, C12 | Additive (nullable field, idempotent backfill) | Yes — unset field | No |
| C3 | **Capability/Entitlement registry** (ONE mechanism — see §3) | — (school-scoped table) | C6, C10, C11 | Additive as a table | Yes | No (until activated) |
| C4 | **Tenant enforcement** (`tenantModel()` + cross-tenant regression suite) | — (works on today's single-school model) | C6, C7, C8, C11 — *everything that queries tenant data* | Migratory in surface (rewrites query call-sites) but **per-route, independent, testable** | Yes — per route | No (behavior identical when correct; the point is it *prevents* invisible cross-tenant bugs) |
| C5 | **Audit extensions** (correlation ID; membership/org fields — MR-002) | Partial: correlation ID independent; membership/org fields need C7 | — (governance consumer) | Additive | Yes | No |
| C6 | **Organization services** (shared calendar, docs, announcements, exec reporting) | C1, C2, **C4**, C3 | — | Additive (new features) | Yes — disable | Yes, but only for multi-school orgs; single schools unaffected |
| C7 | **Membership collection** | C1, **C4** | C8, C9 | Additive while shadow (created alongside users, not yet authoritative) | Yes, while shadow | No, while shadow |
| C8 | **Identity separation + index migration (MR-001)** | C7 populated, **C4**, **decision D-001** | C9 | **Migratory — Critical** (relocates the `{schoolId,email}` unique index, `indexes.js:155`) | Yes during shadow/dual-write; hard cutover at index swap | Potentially (login) if botched; invisible if done right |
| C9 | **School switching (D-004)** | C8 authoritative | — | Additive (new UI, multi-membership users only) | Yes — flag | Yes, multi-membership users only |

> **Deviation from this table, recorded 2026-07-18:** C9 was implemented *before* its stated dependency (C8 authoritative) was satisfied — a deliberate operator choice, since C8 cannot become authoritative in this sandbox (no live MongoDB to safely flip `IDENTITY_CUTOVER_ENABLED` against). C9 instead ships **self-gated on `organizations.multiSchoolEnabled`** (hardcoded `false` everywhere today, genuinely unreachable by any code path), not on C8's own activation flag — see the Build status row below for what that means in practice. This is a one-time recorded exception, not a change to the freeze rule (§6): future components still may not begin before their stated dependencies are satisfied without an equivalent explicit, recorded exception.

> **C12's original description was inaccurate, corrected 2026-07-18 (ADR-0005).** This table originally described C12 as "org billing account, central invoicing" — that was never built and, per ADR-0005, isn't what R2 (the governance decision this component resolves) actually asked for. Every billing code path already implemented (`billing.js`, `billing-cron.js`, `mpesa.js`'s subscription flow, `plan.js`) independently arrived at a **School**-owned subscription model, not an Organization one. C12 turned out to be a documentation-only ratification of already-correct code, not a new build — see `docs/adr/ADR-0005-billing-ratification.md`.
| C10 | **Entitlement activation** (flip `plan.js` gate from `FEATURE_PLAN` to entitlements) | C3 populated | — | **Migratory** — Kernel-tier behavior change on every gated route; safe *only* with dual-read (fall back to plan-derived default) | Yes — revert to `FEATURE_PLAN` | No, if defaults preserve current access |
| C11 | **Integration framework** (connector registry, OAuth, webhook engine, retry queue, sync) | **C4**, C3, **+ queue infra that does not exist today** | — | Additive but **large net-new** | Yes | No (framework only) |

> **C11's queue-infra sub-dependency is partially satisfied, 2026-07-18 (ADR-0006).** A scoped, MongoDB-backed retry queue (`server/utils/job-queue.js`) now exists, proven against one real use case (`audit.js`'s security-alert webhook, previously fire-and-forget). This is not the Connector Registry, OAuth Framework, Webhook Engine, API Gateway, Sync Engine, or Rate Limiting `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §13 describes for the full domain — all of that remains deferred. Also corrected: Governance Review row R4's citation of a "Non-Decisions register" entry for "Integration Marketplace/Public API" — checked directly, that entry never existed; the citation was dropped rather than perpetuated. See `docs/adr/ADR-0006-job-queue-phase1.md`.
| C12 | **Billing** (ratify School-owned subscription model) | C1, **Billing ADR** (Constitution §12 amendment) | — | Ratification — no new schema or code (see deviation note below) | Yes — revert §12's text | Already true in production; nothing user-visible changed |

---

## 2. What the graph makes obvious (critical path)

Ranked by dependency structure, two facts fall out that resolve the sequencing debate on evidence:

**Roots (depend on nothing, so nothing blocks them) — start here, in parallel:**
- **C1 Organization collection** — trivially safe, additive, reversible, invisible. Correct first step.
- **C4 Tenant enforcement** — depends on nothing, but has the **highest fan-out in the entire graph** (C6, C7, C8, C11 all depend on it). This is the evidence-based reason it belongs *early*, not batched mid-foundation: every component built before it is written against the leaky convention-only pattern and becomes retrofit debt when it lands. Build it right after C2, before Organization *services* (C6) — because C6 depends on it.

**High fan-in (depend on the most) — necessarily last:**
- **C8 Identity separation** depends on C7 populated + C4 + the D-001 decision. It is correctly near-last. You do not touch identity until membership, tenant enforcement, and the identity-scope decision all already exist beneath it. *(Skyscraper: don't install the elevator while pouring the foundation.)*

The graph vindicates both positions in the review: **Organization first, Identity last** (reviewer) **and** **tenant enforcement early** (prior recommendation) are not in conflict once drawn — C4 is a root with high fan-out (early), C8 is high fan-in (late).

---

## 3. Two corrections the graph forces

**(a) Capability flags and entitlements must be ONE mechanism, not two.** The reviewer's `school_capabilities` and the plan's entitlements (§8) are the same concept — "what can this school do, independent of plan and code." Building both violates the plan's own Principle 2 (*every capability has exactly one owner; ownership is never duplicated*). Merged into C3 as a single registry. A capability flag is a boolean projection of an entitlement; entitlements/integrations/enterprise contracts all resolve to the same table.

**(b) Entitlement activation (C10) is not "invisible zero-risk."** Building the registry (C3) is additive. But flipping `plan.js`'s gate from the static `FEATURE_PLAN` map to the registry is a Kernel-tier behavior change on every plan-gated route. It is only safe with dual-read — the registry, when a school has no explicit entitlement, must fall back to exactly what `FEATURE_PLAN` grants today. Without that, a school silently loses access to a feature the moment the gate flips. C3 (table) is Phase 1; C10 (activation) is a later, dual-read, reversible step.

---

## 4. Phasing (derived from §1–2, not from user-visibility)

**Phase A — Roots (zero-to-low risk, decision-independent, parallel):** C1, C2, C4, C3 (table), C5 (correlation ID portion).
Foundation that changes nothing a school sees. C4 is the load-bearing one and must lead within this phase, since C6/C7 depend on it.

**Phase B — Structural (additive, shadow-first):** C7 (membership, shadow), C6 (org services), C10 (entitlement activation, dual-read).
Depends on Phase A. Still no identity migration.

**Phase C — Identity (the one Critical migration):** C8 (identity split + MR-001), C9 (switching).
Gated by decision D-001 and by all of Phase A/B existing beneath it.

**Phase D — Enterprise:** C11 (integration framework — still deferred, needs queue infra first), ~~C12 (billing — needs Billing ADR)~~ **C12 done** (ADR-0005 ratified the already-shipped School-owned model — turned out not to need net-new work).

---

## 5. Build status (live)

| Component | Status |
|---|---|
| C1 Organization collection | ✅ Done — `31a3f1b` |
| C2 Organization provisioning | ✅ Done — `31a3f1b`; `provisionOrganizationForSchool()` also called immediately (not just at boot) from platform.js/onboard.js provisioning paths |
| C4 Tenant enforcement | ✅ **Done** — ADR-0001 Accepted, `tenantModel()` rolled out across all mechanical/dynamic route files, CI ratchet down from baseline 822 to **24** documented platform-level exceptions (all in platform.js/qa-health.js, each reviewed). See `ADR-0001-tenant-context-enforcement.md`. |
| C7 Membership collection (shadow) | ✅ Done (Phase 1 scope) — `provision-memberships.js` (idempotent, additive backfill, chained after `provisionOrganizations()` in boot), `memberships` indexes, platform-admin `GET /users/search` + `POST /memberships` routes (organization-scoped grant, 409 on cross-org or duplicate), "Link Identity" UI in the Organizations panel. **Still non-authoritative** — auth.js/JWT/rbac.js/scopeMiddleware.js unchanged; nothing reads this collection for login yet. See ADR-0002. |
| C3 Capability/Entitlement registry | ✅ Done (registry only) — `entitlements` collection + indexes, `hasEntitlement()` read primitive (`server/utils/entitlements.js`, unused so far — exists for C10 to call), platform-admin `GET/POST/DELETE .../entitlements` routes (freeform key, soft-revoke, re-activates instead of duplicating), Entitlements UI on the Schools list. **Not consulted anywhere** — `plan.js`'s `FEATURE_PLAN`/`planGate()` are untouched; a grant here has zero effect on what a school can access until C10. |
| C5 Audit extensions (correlation ID; membership/org fields — MR-002) | ✅ **Done.** `server/utils/correlation-id.js` (new) assigns every request a correlation ID (reuses a shape-safe incoming `x-request-id`/`x-correlation-id` header, else generates one), wired as the first middleware in `server/index.js`. `AuditService.log()` now writes `correlationId` plus `orgId`/`membershipId` (via a non-fatal `{userId,schoolId}` membership lookup) on every entry — zero call-site changes across all 20 existing `AuditService.log()` sites, since both are derived from params every call site already passes. `AuditService.query()`/`GET /api/audit` gain matching optional filters. No response header echoes the correlation ID back to the client — a deliberate scope boundary (write-side/internal-tracing only). No ADR required (MR-002 rated Low/Low in the Migration Risk Register). 24 new tests across `correlation-id.test.js`, `audit.test.js` (first-ever `AuditService` coverage), and `routes/audit.test.js` (first-ever route coverage), verified via a mutation test on the membership-lookup-skip guard. Full suite: 37/37 suites, 415/415 tests. |
| C6 Organization services | ⬜ Explicitly paused — schools stay operationally independent for now; only Identity/Membership is shared across an org (C7), not shared calendars/docs/announcements. |
| C8 Identity separation + index migration | 🟢 **Code-complete, all 4 phases.** Phases 0-2 as before (Shadow, Dual-write, Verify). Phase 3 (Cutover): `/login`, `/change-password`, and `PUT /api/settings` now read `identities.passwordHash`/`mfaEnabled` when a user has an `identityId` — gated behind `IDENTITY_CUTOVER_ENABLED`, an opt-in kill switch (`server/utils/identity-cutover.js`) **disabled by default**. A dangling `identityId` or bad hash fails closed to a mismatch, not a silent fallback (a real bug in the first draft, caught by this phase's own tests — see ADR-0003 Consequences). **"Code-complete" ≠ "live"**: merging this changed nothing in any deployment; the actual behavioral cutover is a separate, later, operator decision gated on the `identity` gate reporting `complete` against real data. 63 new tests total across Phases 1-3. Full suite: 32/32 suites, 366/366 tests. |
| C9 (School Switching, D-004) | 🟢 **Code-complete, shipped ahead of its stated dependency (see deviation note in §1) — self-gated, provably inert today.** `_buildTokenPayload` adds `orgId`/`membershipId` to the JWT only when the user's school's organization has `multiSchoolEnabled: true` (hardcoded `false` at every provisioning site today, so no JWT issued anywhere carries these fields right now). `POST /api/auth/switch-school` (new route) validates same-organization membership, mints a re-scoped token via the existing OAuth exchange-code mechanism (`_issueExchangeCode`/`POST /exchange` — reused, not duplicated), and fails closed (404) if a Membership grant exists but no per-school `users` doc does. Login/verify-otp/force-change/exchange responses gain an optional `availableSchools` field (list of other switchable schools), consumed by a minimal "Switch School" menu in `TopBar.jsx` — absent from every response today since it's itself gated on the same `orgId` presence. Constitution §7/§8/§10 Stage 4 corrected alongside the code: the original "sessionStorage holds the JWT per-tab" design was found to be architecturally impossible against the codebase's own HttpOnly-cookie-only security model (confirmed by direct code read, not inference) and replaced with the actual exchange-code mechanism description. 13 new tests (9 route-level + 4 JWT-field). Full suite: 33/33 suites, 383/383 tests. **Activation is still a separate, later, per-organization operator decision** — flipping `multiSchoolEnabled` on a real organization, which nothing in this codebase does automatically. |
| C10 Entitlement activation | 🟢 **Done — ADR-0004 accepted and implemented.** `planGate()` (`server/middleware/plan.js`) now consults the C3 entitlement registry (`hasEntitlement()`) as a strictly additive override: consulted only when the school's plan tier alone would deny a feature, never when plan already grants it, so the dual-read guarantee (§3b) holds structurally, not just at rollout. An entitlement-lookup failure resolves to the pre-existing 403, never a new 500. The platform-admin grant/revoke UI (built under C3) is now functionally live. 8 new tests (`server/__tests__/plan.test.js`, first direct coverage of this middleware), verified via a mutation test proving the plan-grants fast path is actually exercised, not decorative. Full suite: 34/34 suites, 391/391 tests. See `docs/adr/ADR-0004-entitlement-activation.md`. |
| C12 Billing | 🟢 **Done — ADR-0005 accepted, docs-only.** Turned out to be a ratification, not a build: `billing.js`/`billing-cron.js`/`mpesa.js`'s subscription flow/`plan.js` already implemented a School-owned subscription model; Constitution §12 previously described an unbuilt Organization-owned model and carried a `SUPERSEDED PENDING BILLING ADR` banner. ADR-0005 formally adopts the School-owned model, §12 rewritten (banner removed), Governance Review row R2 marked resolved. No code changed — nothing was inaccurate about the running system, only the Constitution's description of it. See `docs/adr/ADR-0005-billing-ratification.md`. |
| C11 Integration framework | 🟡 **Phase 1 done — ADR-0006, 2026-07-18.** Queue-infra sub-dependency scoped and built: `server/utils/job-queue.js` (Mongo-backed, `enqueueJob`/`registerHandler`/`processQueueOnce`/`startQueueWorker`, exponential backoff, `dead_letter` terminal state, atomic claim mirroring `mpesa.js`'s proven idiom), `queue_jobs` platform collection. One real integration: `audit.js`'s security-alert webhook, previously fire-and-forget, now retried. `monitoring.js`'s crash-path webhook sender deliberately left alone (queue-ifying it would make a crash-exit alert less reliable, not more). Found and corrected two stale governance-doc claims while grounding this work: `PLATFORM_CONCURRENCY_MODEL.md`'s BUG-002 text (already fixed, doc said otherwise) and Governance Review row R4's phantom Non-Decisions citation. 13 new tests (`job-queue.test.js`, extended `audit.test.js`), mutation-tested. Full suite: 38/38 suites, 428/428 tests. **The rest of the domain — Connector Registry, OAuth Framework, Webhook Engine, API Gateway, Sync Engine, Monitoring, Rate Limiting — remains deferred**, not started, no concrete driving use case yet. |

## 6. Freeze rule

No component may begin before every prerequisite in its "Depends on" column exists and is verified. C8 additionally may not begin before decision D-001 is ratified. This graph is the engineering roadmap; changing it requires the same review as any governance change.

---

*Companion to `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` (what to build) — this is the order to build it in. Decisions remain gated per `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`.*
