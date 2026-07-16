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
| C10 | **Entitlement activation** (flip `plan.js` gate from `FEATURE_PLAN` to entitlements) | C3 populated | — | **Migratory** — Kernel-tier behavior change on every gated route; safe *only* with dual-read (fall back to plan-derived default) | Yes — revert to `FEATURE_PLAN` | No, if defaults preserve current access |
| C11 | **Integration framework** (connector registry, OAuth, webhook engine, retry queue, sync) | **C4**, C3, **+ queue infra that does not exist today** | — | Additive but **large net-new** | Yes | No (framework only) |
| C12 | **Billing** (org billing account, central invoicing) | C1, **Billing ADR** (Constitution §12 amendment) | — | Additive (new billing-account concept) | Yes | Yes — deferred |

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

**Phase D — Enterprise (deferred):** C11 (integration framework — needs queue infra first), C12 (billing — needs Billing ADR).

---

## 5. Freeze rule

No component may begin before every prerequisite in its "Depends on" column exists and is verified. C8 additionally may not begin before decision D-001 is ratified. This graph is the engineering roadmap; changing it requires the same review as any governance change.

---

*Companion to `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` (what to build) — this is the order to build it in. Decisions remain gated per `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`.*
