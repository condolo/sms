# Architecture Governance Review v1.0

**Status:** Approved
**Date:** 2026-07-15

**Purpose:** This document audits the current alignment between Msingi's architecture governance documents and the implementation. It does not define architecture, approve design decisions, or replace ADRs. Its role is to identify and classify inconsistencies that require governance decisions.

**Metadata**

| Field | Value |
|---|---|
| Owner | Chief Architect |
| Review Frequency | Before every major architectural initiative |
| Next Review | After D-001 is ratified |
| Related Documents | `ARCHITECTURE_CONSTITUTION.md`, `PLATFORM_OPERATING_MODEL.md`, `PLATFORM_ENGINEERING_STANDARDS.md`, `IDENTITY_DOMAIN_MODEL_v1.md`, `PLATFORM_CONCURRENCY_MODEL.md`, `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` (target-state authority) |
| Supersedes | None |

---

## Governance Principles

- Governance documents never silently contradict one another.
- ADRs amend governing documents; they never replace them.
- Security policy decisions require explicit approval.
- Production code may not become the source of architectural truth.
- Implementation must remain traceable to approved principles.

---

## Decision Register

**No implementation work may begin for any item marked "Pending" until its governing ADR has been approved.**

| ID | Decision | Status |
|---|---|---|
| D-001 | Multi-membership identity model (one identity, many school memberships) | **Ratified 2026-07-18 — Organization-Scoped Identity**, per `ARCHITECTURE_CONSTITUTION.md` §6-10: one Identity per person per Organization; the same person at two unrelated Organizations holds two independent Identities. Resolves C1 (below). Gates C8 (`IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`) — the authoritative identity migration — not C7 (the additive Membership shadow collection), which depends only on C1/C4 and is unblocked regardless of this ratification. |
| D-002 | Token-revocation fail-open/closed policy, and whether it's role-sensitive | Pending |
| D-003 | Identity ownership (proposed: the user, not platform/school/org) | **Ratified 2026-07-18** via `ADR-0003-identity-separation-index-migration.md` (Accepted) — Unified Identity: one password/MFA shared across a person's schools within one Organization, owned by a new `identities` collection, not by `users`/school/platform. ADR-0003's Phase 0 (Shadow) is implemented; Phases 1-3 (Dual-write/Verify/Cutover) remain, each independently gated per the ADR's own adoption clause. |
| D-004 | Session/JWT storage architecture (HttpOnly cookie vs. Constitution §7's sessionStorage-per-tab model) | **Resolves with D-001** — same fork, same ratification. Constitution §7's `sessionStorage`-per-tab, many-context-sessions model is the approved implementation once Membership becomes authoritative (C8/C9); not yet built. |

---

## 1. Contradictions

| ID | Statement | Owner | Affected Documents | Resolution |
|---|---|---|---|---|
| C1 | Operating Model: *"a user belongs to exactly one school, immutable."* Constitution: one identity, many memberships. Same underlying question as D-004. | Chief Architect | `PLATFORM_OPERATING_MODEL.md §9`, `ARCHITECTURE_CONSTITUTION.md §6-8` | Pending ADR (D-001) |

---

## 2. Documentation Drift

| ID | Statement | Severity | Resolution |
|---|---|---|---|
| D1 | P2 claims tenant isolation is enforced at the data layer. Implementation currently differs from the approved invariant — `server/utils/model.js` has no data-layer enforcement; scoping is route-layer convention. | High | **Resolved 2026-07-18** — ADR-0001/C4 (`tenantModel()`) implemented and adopted platform-wide; ratchet at 24 direct-usage sites (from 722), all reviewed exceptions or platform-admin routes explicitly out of scope. P2's wording now matches the implementation. See `docs/adr/ADR-0001-tenant-context-enforcement.md` and `CHANGELOG.md` v4.68.0. |
| D2 | Operating Model's AuditService list names 6 actions, calls two "next"; code already implements ~20, including both. | Low | One-line refresh |
| D3 | Constitution §9's Organization schema documents a `schools: [String]` array on Organization. The actual implementation (`server/utils/provision-organizations.js`, Phase A/C1-C2) deliberately does not do this — a single authoritative FK on the School (`school.organizationId`) only, with an explicit in-code design note citing Operating Model Principle 6 ("one authoritative source per datum") as the reason for the deviation. Found 2026-07-18 while building the platform-admin Organizations dashboard panel, which queries by the FK (the actual schema), not the array (the documented one). | Medium | Constitution §9 needs correcting to match the implemented (and arguably better-reasoned) schema — requires an ADR per the Constitution's own amendment rule ("changes require an ADR"), not a silent edit. Not yet drafted. |

---

## 3. Security Policy Conflicts

| Field | SPC-001 |
|---|---|
| Question | Should token-revocation checking fail open or closed when its DB call errors? |
| Decision Owner | Chief Architect |
| Security Review | Required before D-002 is ratified |
| Operational Risk | High — sole enforcement point for immediate deactivation/role-revocation |
| Default Policy | Undecided |
| Related Decision | D-002 |

**Evidence:** `revokeUserTokens` has exactly three call sites — role change (`server/routes/users.js:235`, `server/routes/settings.js:668`) and account deactivation (`server/routes/settings.js:720`). `authMiddleware` (`server/middleware/auth.js`) never re-checks `isActive` per request; it only touches the DB for the token-version comparison. If that DB call throws, the current implementation's shared catch-all fails closed, contradicting Constitution Invariant 7 ("Auth Services Must Fail Open"). Token-version checking is therefore the sole mechanism making deactivation and role-revocation take effect before a token's natural 8-hour expiry — a security control, not session-management convenience. No fix has been implemented pending D-002.

---

## 4. Production Defects

Unlike Security Policy Conflicts (§3), these have no legitimate trade-off or policy question behind them — they are straightforward correctness gaps with an unambiguous fix. They do not depend on D-001–D-004 and should not wait on the ADR sequence. Full evidence and context in `PLATFORM_CONCURRENCY_MODEL.md`.

| ID | Defect | Severity | Status |
|---|---|---|---|
| BUG-002 | `POST /api/mpesa/callback` creates a Payment record unconditionally on every successful callback delivery, with no check that the transaction wasn't already marked completed. A retried callback (a documented Safaricom behavior, not a hypothetical) creates a duplicate Payment record for the same money. The parallel `subscription/callback` path had the same missing guard. | **Critical** | **Fixed** — both callbacks now atomically claim the transaction via `findOneAndUpdate({status: {$ne: 'completed'}})` before proceeding; a second delivery matches nothing and is skipped. Regression test: `server/__tests__/routes/mpesa-idempotency.test.js` |
| BUG-003 | Exam mark-entry (`POST /api/exams/:id/results`) bulk-upserts with no version check. Two teachers saving marks for the same student within the same window silently last-write-wins — no conflict surfaced to either party, no audit trail of the overwritten value. | High | **Fixed (server-side half)** — `ResultSchema` gained an optional `_v`; a stale version is excluded from the write and reported in a new `conflicts` field instead of silently overwriting. Omitting `_v` (every client today) is unchanged behavior. **Follow-up still needed:** the Markbook UI must read and send `_v` per cell, and surface `conflicts` to the teacher, for this to be a complete fix end to end — not done in this pass. Regression test: `server/__tests__/routes/exams-mark-conflict.test.js` |

---

## 5. Assumption Register

**Technical:**
- `users` carries a DB-level unique index on `{schoolId: 1, email: 1}` (`server/utils/indexes.js:155`) — a hard constraint, not a soft convention.
- The client auth store models school context as a single object (`useAuthStore(s => s.session?.school)`) — foundational to the store, not a scattered pattern.
- RBAC cache (`schoolId::role`) and scope cache (`userId::schoolId`) both assume one active school per request.
- `getTokenVersion`'s cache, keyed by `userId` alone — already correctly identity-scoped for a multi-membership model; needs no change.
- Upload/S3 path structure — unverified, not confirmed either way.

**Business:**
- Onboarding (`/api/onboard`) creates exactly one school + one superadmin per registration; no "join an existing school" path exists.
- Licensing/plans (`planGate()`, module registry) key access by `schoolId`; no organization-level subscription exists yet.
- Pricing (`server/config/pricing.js`) computes billing per-school, per-student-count only.
- HR/payroll fields are meant to be per-membership by design, but every current staff-creation path is single-school-flat.
- Reports (rankings, attendance, report cards) compute strictly within one school.
- No path exists to invite an *existing* identity into a second school; every user-creation route assumes a brand-new document.

**Security:**
- The JWT's signature can be trusted without a DB round-trip (`jwt.verify`, self-contained, `server/utils/jwt.js`).
- The token-version check assumes the database is reachable; when it isn't, D-002/SPC-001 governs behavior.
- Server and client clocks are assumed synchronized (`absoluteExpiry` comparison has no drift tolerance).
- TLS is assumed to terminate before the app layer.
- `req.jwtUser.schoolId` is assumed present by every downstream consumer once `authMiddleware` succeeds; nothing re-validates this.

---

## 6. Architecture Traceability Matrix

| Principle | ADR | Implementation | Tests |
|---|---|---|---|
| Constitution Inv 1 — Single active school context | N/A — established, pre-dates ADR process | `server/middleware/auth.js:54` | None dedicated; implicitly exercised by every route test |
| Constitution Inv 2 — Cross-school isolation | **ADR-0001** (Proposed) — tenant context + `tenantModel()` | Convention only today, no structural layer; ADR-0001 specifies the fix (C4) | `report-cards.test.js:315`, `routes/students.test.js:147` — per-module spot checks; ADR-0001 mandates a centralized cross-tenant suite as a C4 deliverable |
| Constitution Inv 3 — RBAC/DataScope separation | N/A — established | `rbac.js`, `scopeMiddleware.js` | Not verified this review |
| Constitution Inv 4 — Identity/Employment/Academic independence | Pending (D-001) | Not yet built | N/A — not yet built |
| Constitution Inv 7 — Auth fails open | Pending (D-002) | `authMiddleware` — currently does not | None found |
| Operating Model P2 — Tenant isolation at data layer | **ADR-0001** (Proposed) | Claimed; `model.js` has none — ADR-0001 makes P2 true | Same as Inv 2, above |

---

## 7. Migration Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Rollback | Exit Criteria |
|---|---|---|---|---|---|---|
| MR-001 | Identity migration | Medium | Critical | Shadow migration — write both shapes in parallel before cutover | Supported — drop new collection, fall back to `users.schoolId` | All users have memberships · dual-write verified · read path switched · old index removed · rollback window closed |
| MR-002 | AuditService schema extension | Low | Low | Standard additive migration | Trivial | New fields present on all post-migration writes; no read path depends on their absence |

**Migration blast radius (MR-001) — verified floor, not exhaustive:** 10 files directly query or write `users` filtered or set by `schoolId`: `students.js`, `platform.js`, `auth.js`, `billing-cron.js`, `settings.js`, `elearning.js`, `users.js`, `onboard.js`, `messages.js`, `import-export.js`. Found via multiline-aware regex over literal object braces — a verified floor, not a provably exhaustive ceiling, since variable-built filter objects (`const filter = {schoolId}; User.find(filter)`) would not be caught by pattern matching. **Before MR-001 implementation begins, this must be re-derived via AST-based/semantic code indexing, not regex.** Regex is appropriate for reconnaissance; it is not sufficient for migration execution planning.

---

## 8. Constitution Amendments Needed

| Section | Affected By | Status |
|---|---|---|
| §7 — Session Architecture | Pending ADR (D-004) | Pending |
| §9 — Identity guarantees | Pending ADR (D-001) | Pending |
| §12 — Billing and Licensing Model | Architecture Evolution Plan §7/§16 (subscription belongs to School, not Organization) — matches current code (`plan.js:106`, `mpesa.js:598`); Constitution now vests subscription in the School | **Resolved — ADR-0005**, 2026-07-18. Constitution §12 rewritten, superseded banner removed. |

---

## 9. Open Product Decisions

- D-002's role-sensitivity question (should admin/finance sessions be treated differently from teacher sessions) — resolved inside the eventual ADR.
- D-003 — identity ownership. **Ratified** via `ADR-0003-identity-separation-index-migration.md` (a new `identities` collection owns credentials, `users`/schools own employment/role data). Phase 0 (Shadow) shipped; Phases 1-3 remain, gated behind independent per-phase verification.

---

## 10. Non-Decisions

Items intentionally postponed, recorded so they are not mistaken for open gaps or reopened without cause:

| Item | Reason |
|---|---|
| Organization-level billing | Out of scope for this review |
| Cross-school analytics | Depends on D-001 |
| Feature flags for canary rollout | Separate initiative |
| Identity federation across organizations | Future ADR, not this one |

---

## 11. Recommended Sequence

**In parallel, gated by nothing above:** BUG-002 and BUG-003 — server-side fixes shipped, both with regression tests. BUG-003's Markbook UI follow-up (send/surface `_v` and `conflicts`) remains open and should be scheduled independently of D-001–D-004.

1. Resolve D-001 (resolves D-004 simultaneously — same underlying fork).
2. Write the ADR — Organizations/Memberships, with MR-001 (Identity Migration) as its own linked-but-separate ADR given its distinct risk profile.
3. Security review of both.
4. Ratify D-002.
5. Documentation amendments (D1, D2, Constitution §7/§9 markers).
6. Code.

---

## Exit Criteria for Phase 0

Phase 0 is complete only when:
- All contradictions have owners.
- All pending decisions have corresponding ADRs scheduled.
- Security policy conflicts have assigned reviewers.
- Production defects have a tracked fix status (independent of ADR sequencing).
- Migration risks have mitigation plans.
- Traceability has been established.
- No implementation has begun.

Only then may Phase 1 (ADR drafting) commence.

---

## 12. Reconciliation with the Architecture Evolution Plan

`PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` is adopted as the **target-state authority** — the direction the ADR sequence serves. It agrees with roughly 80% of the committed corpus; the deltas below are what "aligning the governance docs to the plan" concretely requires. Each is classified the same way as everything else in this review.

| # | Plan element | Relationship to committed docs | Action |
|---|---|---|---|
| R1 | Identity / Membership / Authorization split (§9–11), security invariants 1/9/10 (§17) | **Already aligned** with `IDENTITY_DOMAIN_MODEL_v1.md` and `PLATFORM_CONCURRENCY_MODEL.md` | None — confirm and proceed |
| R2 | Subscription belongs to School (§7, §16) | **Resolved.** Matched current code (`plan.js:106`, `mpesa.js:598`) all along; Constitution §12 now agrees, via ADR-0005 (2026-07-18) | Done — no further action |
| R3 | Plans vs Entitlements decoupling (§8) | **Net-new** — today `plan.js:33-80` hard-couples plan→feature in one static map | Own ADR (Kernel-tier); not "foundation," sequence deliberately |
| R4 | Integration as a foundation domain (§13) | **Partially resolved.** *Corrected 2026-07-18: this row previously cited a "Non-Decisions register... Integration Marketplace/Public API deferred" entry that does not actually exist in §10's table (checked directly — that citation was never real; removed rather than perpetuated).* The other half of the original reasoning — `PLATFORM_CONCURRENCY_MODEL.md`'s "no queue infra exists" — was accurate and is now partially addressed: ADR-0006 (C11 Phase 1, 2026-07-18) built a scoped queue (`server/utils/job-queue.js`) for one job type. The full Integration Domain (Connector Registry, OAuth Framework, Webhook Engine, API Gateway, Sync Engine, Monitoring, Rate Limiting) remains deferred. | C11 Phase 1 shipped via ADR-0006; the rest of the domain stays deferred until a concrete integration justifies it |
| R5 | Nine-domain taxonomy (§3–4) | **Overlaps/collides** with `PLATFORM_OPERATING_MODEL.md §2`'s seven Platform Kernel subsystems | Reconcile taxonomies explicitly — one must absorb or supersede the other |
| R6 | "No migration, no duplicate accounts" (§14) | **Over-claim** — the identity/index split IS `MR-001` (Critical) | Correct the plan's framing; MR-001 stays gated by shadow-migration + rollback |
| R7 | "Context switch, not new login" (§15) | **Unresolved** — this is D-004, dependent on D-001; the plan is silent on the identity-scope fork | Still requires D-001 ratification; the plan does not settle it |

**Important:** adopting the plan as the direction does **not** resolve D-001 (platform-global vs organization-scoped identity). The plan is silent on that fork — §19's "cross-organization identities" non-goal is compatible with either model. D-001 remains Pending and remains the gate for the whole sequence.

**New finding surfaced while reconciling** (add to `PLATFORM_CONCURRENCY_MODEL.md §5`): `plan.js:83` `_planCache` is a **fourth** in-memory per-process cache alongside RBAC / scope / token-version — same single-instance assumption, same multi-instance staleness risk.

---

*This document is a governance artifact, not an ADR. It reviews alignment between principles and reality; it does not decide architecture. Decisions recorded here as "Pending" become binding only once their governing ADR is approved, per the Decision Register above.*
