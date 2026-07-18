# ADR-0003: Identity Separation & Index Migration (C8 / MR-001)

**Status:** Accepted — approved 2026-07-18, explicitly and separately from the plan that drafted it.
**Date:** 2026-07-18 (drafted and accepted)
**Implementation:** **Phases 0-2 complete.** Phase 0 (Shadow): `identities` collection + indexes, `provision-identities.js` (collision policy), boot wiring, inline hooks at all 13 AST-verified `users`-creation sites. Phase 1 (Dual-write): two-tier revocation, `_buildTokenPayload` gains `identityId`/`itv`, all 4 password-write paths dual-write and revoke — closing a pre-existing gap where none of them ever revoked any session. Phase 2 (Verify): `qa-health.js` gained a new `identity` gate (`_identityMigrationStatus()`, mirrors the existing `_migrationStatus()` shape — deliberately excludes `collision_pending` users from the "pending" count, since that status is a permanent safe fallback per Decision 2, not an unfinished migration step) plus two new integrity checks (`_checkDanglingIdentityFK`, `_checkPasswordHashMismatch`, both null-normalized so OAuth users never false-positive). Full suite: 31 test suites, 349/349 passing (46 new tests total across Phases 1-2, first-ever coverage for `qa-health.js`, the 4 password routes, `authMiddleware`'s `tv` check, and `token-version.js`). **Still not consulted for authentication** — `auth.js`'s credential *check* still reads `users.password` exclusively; the write path dual-writes and the verify gate reports on it, but nothing reads `identities` to authenticate anyone yet. Phase 3 (Cutover) has not started; per this ADR's own adoption gate, it may not begin while the new `identity` gate is red.
**Change class:** Kernel (per `PLATFORM_OPERATING_MODEL.md §10`) — changes the login credential-check path for every school. **Critical impact** per the Migration Risk Register (`ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` §7, entry `MR-001`). Requires Architecture Review sign-off before implementation, same bar as ADR-0001.
**Unblocks:** C8 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` (does not unblock C9 — School Switching remains separately gated on C8 being *authoritative*, i.e. cutover complete, not merely designed).
**Related:** ADR-0001 (tenant enforcement — `users` stays under `tenantModel()`, unaffected by this ADR), ADR-0002 (Membership Phase 1 — this ADR does **not** make Membership authoritative for login; that remains explicitly out of scope, see below), Governance Review decisions D-001 (ratified — Organization-Scoped Identity, the scope boundary this ADR operates within), D-002 (Pending — token-revocation policy, partially addressed here, see Decision 4), D-003 (Pending — Identity ownership, this ADR proposes an answer but does not itself ratify it), `IDENTITY_DOMAIN_MODEL_v1.md` (unratified vocabulary source, borrowed narrowly — see Decision 1).

---

## Context

`IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`'s C8 — "Identity separation + index migration (MR-001)" — is the last gated component on the roadmap once C7 (Membership shadow, `ADR-0002`) and C3 (Entitlement registry) shipped. ADR-0002 was explicit that it does not pre-approve this work: *"C8 (making Membership authoritative) is a separate, future ADR and requires its own Architecture Review sign-off before implementation."* This is that ADR.

**What "MR-001" names, precisely** (`ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` §7 Migration Risk Register): relocating the `users` collection's unique `{schoolId,email}` partial index (`server/utils/indexes.js`, `users_school_email_str`) as part of letting one person share access to multiple schools without holding a separate, independent account at each. Rated **Medium likelihood, Critical impact**. Mitigation on record: "shadow migration — write both shapes in parallel before cutover." Rollback on record: "drop new collection, fall back to `users.schoolId`." Exit criteria on record: "all users have memberships · dual-write verified · read path switched · old index removed · rollback window closed."

**The fork this ADR resolves.** Two shapes were possible for what "shared access to multiple schools" even means:
- **Linked accounts** — each school keeps a fully independent account (own password, own MFA) for the same person; Membership is purely a cross-reference for a future switcher UI. Lower risk; arguably not even Kernel-tier, since the `{schoolId,email}` index would never need to move.
- **Unified identity** — one password and one MFA configuration shared across every school a person belongs to, matching `IDENTITY_DOMAIN_MODEL_v1.md`'s (unratified) framing: *"Credential: Owned by Identity, never by Membership. There is exactly one password and one MFA configuration per Identity, regardless of how many memberships it holds."* This is the literal MR-001 migration the governance docs describe, and it is what was explicitly chosen when asked directly: **Unified Identity**, scoped to a person's schools **within one Organization** (per ratified D-001 — this ADR does not adopt `IDENTITY_DOMAIN_MODEL_v1.md`'s broader platform-global framing; see Decision 1).

This document was drafted after two research passes (current login/JWT/index mechanics; the full governance corpus — Constitution §6-10, the Governance Review's D-002/D-003/MR-001 entries, `IDENTITY_DOMAIN_MODEL_v1.md`, the Evolution plan §9-11/§15) and one design pass that pressure-tested the resulting proposal directly against the current file contents of `auth.js`, `middleware/auth.js`, `rbac.js`, `scopeMiddleware.js`, `token-version.js`, `sessionService.js`, both existing `provision-*.js` scripts, and `qa-health.js`.

## Decision

### 1. A new `identities` collection — `users` is not restructured

```
identities {
  id:            "idt_<uuid>"
  orgId:         "org_xxx"                       // D-001's scope boundary — org-scoped, not platform-global
  email:         "person@example.com" | null      // null while status is collision_pending
  passwordHash:  "$2..."
  mfaEnabled:    true|false
  mfaOtp:        "<sha256>" | null                 // ephemeral, mirrors users.mfaOtp today
  mfaExpiry:     ISOString | null
  tokenVersion:  0
  status:        'active'|'collision_pending'|'merged'|'archived'
  mergedInto:    "idt_yyy" | null
  sourceUserIds: ["usr_a","usr_b"]                 // provenance/audit
  createdBy, createdAt, updatedAt
}
```

`users` stays **structurally unchanged**: same collection, same `{schoolId,email}`/`{schoolId,username}` partial-unique indexes (kept, not dropped — they serve per-school account *lookup*, a concern this ADR treats as separate from credential *storage*), same globally-unique `users.id` (already referenced by `teaching_assignments`, `audit_logs`, `sessions`, `messages`, and more — restructuring it into `memberships` would mean either renaming that identifier everywhere or running two competing "user id" concepts, a far larger and less contained blast radius than adding one FK). Only a new `identityId: "idt_xxx" | null` field is added to `users`.

This means **`server/middleware/rbac.js` and `server/middleware/scopeMiddleware.js` require zero changes** — both already read `role`/`roles`/`schoolId` exclusively off `req.jwtUser`, confirmed by direct code read, never re-validating identity against a DB record. Only `auth.js`'s credential-check step changes. This is the single biggest risk-reducer in this design.

Student accounts (no email, login by admission-number `username`) and any `collision_pending` account are unaffected: `identityId` stays `null`, `auth.js` falls back to `users.password` exactly as it does today, permanently — not a transitional state.

**Deliberate scope narrowing from `IDENTITY_DOMAIN_MODEL_v1.md`:** that document (unratified) describes a platform-global Identity — one per human, ever, across unrelated Organizations. This ADR does not adopt that. `identities` is scoped `{orgId, email}`; two people at unrelated Organizations who happen to share an email remain, correctly, two separate Identities, per ratified D-001.

### 2. Collision policy — never auto-merge

Two different schools' admins may have registered the same email as two genuinely different people, since uniqueness today is enforced only per-school. At backfill time, grouped by `{orgId, email}`:

- **Exactly one `users` doc** for that pair → create one Identity, set `identityId`. No ambiguity.
- **Multiple docs, already linked via an existing `memberships` grant** (the shipped Link Identity flow from ADR-0002 — a platform admin already vouched these are the same person) → merge into one Identity. Canonical password comes from the `isPrimary` membership's account (falls back to earliest-created if ambiguous); the other account's holder receives a forced password-reset notification, since their separate password is being retired.
- **Multiple docs, not already linked** → `status: 'collision_pending'`, `email: null` on the Identity record (kept out of the unique index by the same partial-filter trick `users_school_email_str` already uses for email-less students), `users.identityId` stays unset on both. Both accounts keep authenticating against `users.password` exactly as today — permanently safe, not a blocker. A human resolves it later via an extended Link Identity flow (future work, not built by this ADR).

**Named ambiguity this ADR does not resolve:** `POST /memberships` (ADR-0002) grants access to a *school* without creating a `users` doc there. If a separate `users` doc is later independently created at that school with a matching email, there is no structural evidence it's the same person as the grant — the grant's `userId` and the new doc's `id` are different values that happen to share an email. This ADR treats that as its own `collision_pending` case rather than silently trusting the coincidence.

### 3. Phased rollout — shadow, dual-write, verify, cutover

- **Shadow**: new collection + `users.identityId` field + `server/utils/provision-identities.js` (`provisionIdentityForUser()` + batch `provisionIdentities()`, mirroring `provision-memberships.js`'s exact idempotent, dependency-injectable, non-fatal pattern), chained after `provisionMemberships()` at boot. Every account-creation call site gets a synchronous inline call to the same function (mirroring how `platform.js`'s membership-grant route already calls `provisionMembershipForUser` synchronously today) — so new accounts are never "in the migration window" at all.
- **Dual-write**: password-change paths hash the new password **once** and write the identical hash string to both `users.password` and `identities.passwordHash`. This detail is load-bearing: bcrypt is salted per call, so hashing "the same" password twice produces two different valid-but-divergent hashes — hash once, write twice, or verification in the next phase cannot distinguish correct dual-write from silent divergence.
- **Verify**: extend `qa-health.js`'s existing `check()`/gate pattern (not a new mechanism) with hash-mismatch count, dangling-`identityId`-FK count, and a new `identity` gate reporting `{identityBackfillPending: N, status}`. Cutover does not proceed while this gate is red.
- **Cutover**: `auth.js` checks credentials against `identities` when `identityId` is set, falls back to `users.password` otherwise (permanent fallback for `collision_pending`/students, not transitional).
- **Rollback**: dual-write continues **unconditionally** through the entire rollback window, independent of whether reads have cut over — this is what prevents the hazard of a post-cutover password change going stale on `users.password` and silently breaking a rollback. Only after an explicit, deliberately time-boxed closure milestone (duration is a policy call this ADR flags, not sets — see Open Questions) does dual-write stop and `users.password` become vestigial for migrated accounts. Rollback during the window is then just: revert `auth.js`'s read branch to unconditionally read `users.password` — zero data loss, because it was never allowed to go stale.

### 4. D-002 addressed as a scoped decision — two-tier revocation

This ADR does not wait on a separate D-002 ratification; it resolves the specific sub-question C8 creates.

- **`users.tokenVersion` / `revokeUserTokens(userId)`** (existing, three call sites: role-change ×2, deactivation ×1) — **unchanged**. It already only affects one school, by construction (`userId` there has always meant "this school's `users.id`").
- **New `identities.tokenVersion` / `revokeIdentityTokens(identityId)` / `getIdentityTokenVersion(identityId)`** (mirrors the existing pair exactly — same 5-min cache shape) — fires only on credential mutation: password change, MFA enable/disable. Revoking a shared credential correctly revokes every school's sessions at once.
- This also closes a real, pre-existing gap, not introduced by this ADR: `/change-password` today does not revoke any session, not even at the same school. Under this design, it will.
- JWT gains `identityId` and `itv` (identity token version), additive fields; tokens issued before cutover simply lack them and pass through unaffected until natural 8h expiry (`authMiddleware`'s existing "missing claim passes through" convention, unchanged).
- **This inherits, and does not fix**, the existing fail-open/closed inconsistency (`authMiddleware`'s token-version DB check currently fails closed on error, contradicting Constitution Invariant 7). Stated explicitly so it is not mistaken for a resolution of D-002's fail-open/closed question — only its role-sensitivity/granularity sub-question is addressed here.

## What this explicitly does NOT cover

- **Does not make Membership authoritative for authorization.** `rbac.js`/`scopeMiddleware.js` are untouched; a person's role/permissions per school are still exactly what they are today, unrelated to whether their credential is now shared.
- **Does not build the School Switcher (C9, D-004).** That remains gated on C8 being *authoritative* (cutover complete), not merely designed.
- **Does not fix D-002's fail-open/closed policy.** Only decides the two-tier revocation *shape* this migration specifically needs.
- **Does not adopt `IDENTITY_DOMAIN_MODEL_v1.md`'s platform-global Identity scope.** `identities` here is `{orgId,email}`-scoped, per ratified D-001.
- **Does not build the collision-resolution UI** (extending Link Identity with "confirm same person"/"confirm different people" actions) — the data model and policy are specified; the UI is future work.
- **Does not re-verify the 10-file blast-radius list** (`ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s own regex-based scan of files querying `users` by `schoolId`) via AST/semantic search. That re-verification is a prerequisite for *implementation*, not for this ADR's approval.
- **Ships no code.** Zero collections, indexes, routes, or scripts are created by this document.

## Consequences

**Easier / safer:**
- A person's access to multiple schools within one Organization becomes a real, shared-credential fact instead of duplicate unrelated accounts — the actual product capability the whole Membership arc has been building toward.
- Closes a real pre-existing gap (password-change didn't revoke sessions) as a side effect of the design, not a separate fix.
- `rbac.js`/`scopeMiddleware.js`, the two files enforcing every permission check in the app, need zero changes — verified, not assumed.
- Fully staged, with a rollback mechanism that stays safe even for accounts that changed credentials mid-migration.

**Harder / newly constrained:**
- Every account-creation call site must remember to provision an Identity — a new, CI-unenforced discipline (unlike ADR-0001's ratcheted lint, no equivalent enforcement mechanism is proposed here).
- `mfaEnabled` becomes identity-level — a real behavior change for anyone whose per-school MFA settings diverge today.
- An admin resetting a person's password at School A now silently affects that person's access at every other school they hold membership at within the org — a School A admin may not know School B exists. A UX/product decision this ADR surfaces but does not resolve.

**Explicit non-guarantee:** this makes shared-identity access safer to build toward, not risk-free. The blast-radius list is a known-incomplete floor; the fail-open/closed inconsistency is inherited, not fixed; the rollback-window closure criteria are a policy call, not a number, until someone sets one.

## Open questions (must stay explicit, not get silently assumed during implementation)

1. The "10-file blast radius" is a regex-based floor (`ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s own caveat), not a verified ceiling — needs an AST/semantic pass before implementation begins, not before this ADR is approved.
2. In-flight JWTs at cutover lack `identityId`/`itv` — self-heals within one 8h absolute-expiry window via the existing "missing claim passes through" convention; noted here so it isn't rediscovered as a surprise mid-rollout.
3. `mfaEnabled` moving from per-school to identity-level is a real behavior change for accounts with divergent settings today — a decision, not a side effect to discover later.
4. A same-person, two-tabs, two-schools concurrent-OTP race is possible once D-004's multi-tab model is real (both writes hit the same `identities.mfaOtp` field) — accept it, or scope OTP storage per `(identityId, schoolId)` attempt.
5. The membership-grant-vs-independent-account collision case (§Decision 2) needs its resolution rule enforced by an actual UI — named here, not built here.
6. Rollback-window closure criteria (duration, who signs off) is a policy call this ADR flags but does not set.
7. D-002's fail-open/closed policy itself remains unresolved — this ADR's revocation check inherits whatever the existing `tv` check does today.

## Adoption gate

**This ADR requires explicit approval, separate from any plan-mode approval that produced the document itself, before any implementation begins.** Approving "draft this ADR" is not approving its contents. Once approved: implementation proceeds in the phased order under Decision 3, each phase independently verified via `qa-health.js`'s gate mechanism before the next begins, with the AST-based blast-radius re-verification (Open Question 1) as a hard prerequisite for the Shadow phase's file-by-file rollout, not merely a suggestion.
