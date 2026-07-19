# ADR-0005: Billing Ratification — Subscription Belongs to the School (C12)

**Status:** Accepted — proposed and accepted in the same pass (ratification of already-shipped behavior, not a new decision under review).
**Date:** 2026-07-18 (drafted and accepted)
**Implementation:** None required by this ADR. `server/routes/billing.js`, `server/utils/billing-cron.js`, `server/config/pricing.js`, `server/middleware/plan.js`, and `server/routes/mpesa.js`'s subscription-payment path already implement exactly the model this ADR ratifies. This document brings `ARCHITECTURE_CONSTITUTION.md` §12 into agreement with code that was already correct.
**Change class:** Documentation/ratification. Not Kernel-tier — `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s Decision Register row R2 (the entry this ADR resolves) carries no "requires separate Architecture Review sign-off" qualifier, unlike R3 (ADR-0004/C10). Does not meet ADR-0001/ADR-0003/ADR-0004's Kernel bar — same lighter class ADR-0002 (C7) was in.
**Unblocks:** C12 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`.
**Related:** `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` Decision Register row R2 and §12 status table (both resolved by this ADR), `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §7 and §16 (the target-state text this ADR formally adopts into the Constitution), ADR-0004 (C10, Entitlement Activation — a separate, already-shipped concern; `plan.js`'s `FEATURE_PLAN`/`planGate()` are untouched by this ADR).

---

## Context

`docs/ARCHITECTURE_CONSTITUTION.md` §12 ("Billing and Licensing Model") has stood since the Constitution was first written, vesting the subscription in the **Organization**: one invoice per Organization, Schools inheriting plan access from it. That model was never built. Instead, every school-provisioning and billing code path built since — `server/middleware/plan.js` (`plan`/`planExpiry` fields directly on the `schools` collection), `server/routes/mpesa.js:577-628` (subscription M-Pesa STK push, keyed per school), and `server/routes/billing.js`/`server/utils/billing-cron.js` (`billing_snapshots`, a `tenantModel('billing_snapshots', {schoolId})` collection — tenant-scoped, no `organizationId` field anywhere in its schema) — independently arrived at the opposite model: **the subscription belongs to the School.**

This divergence was already caught and recorded, not discovered by this ADR. `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §7 states plainly: *"The commercial customer may be an Organization; the subscription belongs to the School... this overrides the currently-approved `ARCHITECTURE_CONSTITUTION.md §12`... The current code already stores the plan per-School, so this direction matches implementation reality; the Constitution is the document that must be amended, via the Billing ADR."* §12 itself already carries a `⚠ SUPERSEDED PENDING BILLING ADR (2026-07-16)` banner pointing at this exact gap. `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s Decision Register, row **R2**: *"Subscription belongs to School (§7, §16)... Matches current code... Amend Constitution §12 via Billing ADR."*

This ADR is that Billing ADR. Its job is narrower than "design a billing model" — the model is already built and already correct. The job is to formally adopt `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §7/§16's direction into the Constitution and remove the superseded banner, closing dependency-graph item C12.

## Decision

### 1. The subscription, plan, and licensing state belong to the School — ratified, not changed

```
School  →  Subscription (plan, planExpiry, addOns, billing_snapshots)
```

Every school carries its own plan tier (`core`/`base`, `standard`/`student`, `premium`/`family`, `enterprise`) independently. There is no Organization-level subscription object anywhere in the schema, and this ADR does not create one. An Organization containing five schools may have five different plan tiers, five independent billing histories, and five independent M-Pesa subscription-payment trails — exactly as `billing.js`/`mpesa.js` already implement.

### 2. The Platform invoices the School directly, not the Organization

Every existing billing mechanism — `createBillingSnapshot()` (`billing.js`), the daily cron-generated snapshot (`billing-cron.js`), and the subscription M-Pesa STK-push flow (`mpesa.js`) — operates entirely within one school's `tenantModel()` context. Nothing today issues one consolidated invoice across an Organization's schools, and this ADR does not ask for that to be built. `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §16 names a *future*, optional "Organization Billing Account" that could aggregate central payment for Organizations that want it — this ADR explicitly does not design or build that (see Non-goals). Today, and under this ADR, every invoice is a School invoice.

### 3. Module licensing stays school-independent within an Organization

Retained from the original §12 text, still accurate: different Schools within the same Organization may have different module configurations (the original example: a Diocese licensing the Hostel module for its boarding school only). This is orthogonal to the subscription-ownership question and required no change.

### 4. Constitution §12 is rewritten, not merely annotated

The `⚠ SUPERSEDED PENDING BILLING ADR` banner is removed. §12's "Ownership" diagram and prose are replaced to state the School-owns-subscription model directly, citing this ADR, rather than continuing to describe a model that was never built and is now formally superseded.

## What this explicitly does NOT cover (non-goals)

- **Does not build a central Organization Billing Account, consolidated cross-school invoicing, or any payment-aggregation mechanism.** `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §16's "Organizations may pay centrally" is aspirational target-state framing, not a decision this ADR ratifies as built or commits to building. If an Organization wants centralized billing in the future, that is new, separate, net-new work requiring its own design — this ADR does not pre-approve or scope it.
- **Does not introduce Stripe, Paystack, or any payment processor beyond the existing M-Pesa integration.** Unrelated to what R2 asked this ADR to resolve.
- **Does not touch `plan.js`'s `FEATURE_PLAN`/`planGate()` or the entitlement-override mechanism.** That's ADR-0004/C10, a separate, already-shipped, already-ratified concern. Plans (commercial tier) and entitlements (technical capability, independent of plan) remain the distinct concepts C10 established; this ADR only concerns *who is billed* for a plan, not what a plan or entitlement unlocks.
- **Does not change pricing** (`server/config/pricing.js`'s `STUDENT_RATE`/`SETUP_FEE` tables) — unrelated commercial-terms question, not a governance/architecture one.
- **Ships no code.** Every file this ADR describes was already correct before this document was written.

## Consequences

**Easier / safer:**
- The Constitution now says what the code actually does — a real, if quiet, correctness gap closed. Anyone reading §12 to understand billing behavior will no longer be misled into designing against an Organization-level model that doesn't exist.
- Closes dependency-graph item C12 without any implementation risk, since nothing executable changes.

**Harder / newly constrained:**
- None. This ADR ratifies existing, already-running behavior; it forecloses nothing that wasn't already true in code.

**Explicit non-guarantee:** this ADR does not make central Organization-level billing easier or harder to build later — it simply declines to design it now, leaving that as genuinely open future work if an Organization customer ever asks for it.

## Adoption gate

This ADR ratifies already-shipped, already-correct behavior — per `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` row R2, it does not carry a Kernel-tier classification or a separate-acceptance-gate requirement (contrast ADR-0001/ADR-0003/ADR-0004, all of which required explicit approval of the ADR's contents separate from the plan that produced it). Proposed and accepted in the same pass, matching ADR-0002's precedent. No implementation phase follows this document — the code this ADR describes already exists.
