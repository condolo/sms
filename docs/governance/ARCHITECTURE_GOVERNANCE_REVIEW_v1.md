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
| Related Documents | `ARCHITECTURE_CONSTITUTION.md`, `PLATFORM_OPERATING_MODEL.md`, `PLATFORM_ENGINEERING_STANDARDS.md` |
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
| D-001 | Multi-membership identity model (one identity, many school memberships) | Pending |
| D-002 | Token-revocation fail-open/closed policy, and whether it's role-sensitive | Pending |
| D-003 | Identity ownership (proposed: the user, not platform/school/org) | Pending — proposed, not ratified |
| D-004 | Session/JWT storage architecture (HttpOnly cookie vs. Constitution §7's sessionStorage-per-tab model) | Pending — same fork as D-001 |

---

## 1. Contradictions

| ID | Statement | Owner | Affected Documents | Resolution |
|---|---|---|---|---|
| C1 | Operating Model: *"a user belongs to exactly one school, immutable."* Constitution: one identity, many memberships. Same underlying question as D-004. | Chief Architect | `PLATFORM_OPERATING_MODEL.md §9`, `ARCHITECTURE_CONSTITUTION.md §6-8` | Pending ADR (D-001) |

---

## 2. Documentation Drift

| ID | Statement | Severity | Resolution |
|---|---|---|---|
| D1 | P2 claims tenant isolation is enforced at the data layer. Implementation currently differs from the approved invariant — `server/utils/model.js` has no data-layer enforcement; scoping is route-layer convention. | High | Correct wording or relabel as target-state, pending clarification of original intent |
| D2 | Operating Model's AuditService list names 6 actions, calls two "next"; code already implements ~20, including both. | Low | One-line refresh |

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

## 4. Assumption Register

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

## 5. Architecture Traceability Matrix

| Principle | ADR | Implementation | Tests |
|---|---|---|---|
| Constitution Inv 1 — Single active school context | N/A — established, pre-dates ADR process | `server/middleware/auth.js:54` | None dedicated; implicitly exercised by every route test |
| Constitution Inv 2 — Cross-school isolation | Pending (D-001 scope) | Convention only, no structural layer | `report-cards.test.js:315`, `routes/students.test.js:147` — per-module spot checks, not a centralized suite |
| Constitution Inv 3 — RBAC/DataScope separation | N/A — established | `rbac.js`, `scopeMiddleware.js` | Not verified this review |
| Constitution Inv 4 — Identity/Employment/Academic independence | Pending (D-001) | Not yet built | N/A — not yet built |
| Constitution Inv 7 — Auth fails open | Pending (D-002) | `authMiddleware` — currently does not | None found |
| Operating Model P2 — Tenant isolation at data layer | Pending (D1 resolution) | Claimed; `model.js` has none | Same as Inv 2, above |

---

## 6. Migration Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Rollback | Exit Criteria |
|---|---|---|---|---|---|---|
| MR-001 | Identity migration | Medium | Critical | Shadow migration — write both shapes in parallel before cutover | Supported — drop new collection, fall back to `users.schoolId` | All users have memberships · dual-write verified · read path switched · old index removed · rollback window closed |
| MR-002 | AuditService schema extension | Low | Low | Standard additive migration | Trivial | New fields present on all post-migration writes; no read path depends on their absence |

**Migration blast radius (MR-001) — verified floor, not exhaustive:** 10 files directly query or write `users` filtered or set by `schoolId`: `students.js`, `platform.js`, `auth.js`, `billing-cron.js`, `settings.js`, `elearning.js`, `users.js`, `onboard.js`, `messages.js`, `import-export.js`. Found via multiline-aware regex over literal object braces — a verified floor, not a provably exhaustive ceiling, since variable-built filter objects (`const filter = {schoolId}; User.find(filter)`) would not be caught by pattern matching. **Before MR-001 implementation begins, this must be re-derived via AST-based/semantic code indexing, not regex.** Regex is appropriate for reconnaissance; it is not sufficient for migration execution planning.

---

## 7. Constitution Amendments Needed

| Section | Affected By | Status |
|---|---|---|
| §7 — Session Architecture | Pending ADR (D-004) | Pending |
| §9 — Identity guarantees | Pending ADR (D-001) | Pending |

---

## 8. Open Product Decisions

- D-002's role-sensitivity question (should admin/finance sessions be treated differently from teacher sessions) — resolved inside the eventual ADR.
- D-003 — identity ownership. Proposed (the user owns identity, schools own memberships), **not ratified**.

---

## 9. Non-Decisions

Items intentionally postponed, recorded so they are not mistaken for open gaps or reopened without cause:

| Item | Reason |
|---|---|
| Organization-level billing | Out of scope for this review |
| Cross-school analytics | Depends on D-001 |
| Feature flags for canary rollout | Separate initiative |
| Identity federation across organizations | Future ADR, not this one |

---

## 10. Recommended Sequence

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
- Migration risks have mitigation plans.
- Traceability has been established.
- No implementation has begun.

Only then may Phase 1 (ADR drafting) commence.

---

*This document is a governance artifact, not an ADR. It reviews alignment between principles and reality; it does not decide architecture. Decisions recorded here as "Pending" become binding only once their governing ADR is approved, per the Decision Register above.*
