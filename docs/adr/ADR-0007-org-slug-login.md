# ADR-0007: Organization Shared-Slug Login (C13)

**Status:** Proposed — drafted 2026-07-19, awaiting explicit acceptance, separate from approval of the Phase 0/Phase 1 plan that produced this document.
**Date:** 2026-07-19 (drafted)
**Implementation:** Not started. Phase 0 (slug-collision fix) and Phase 1 (platform-admin visibility, `multiSchoolEnabled`/`orgSlugLoginEnabled` toggles) have already shipped, additively, with no new credential-check code — see `CHANGELOG.md`. This ADR covers only the remaining credential-flow work described below.
**Change class:** Kernel (per `PLATFORM_OPERATING_MODEL.md` §10) — introduces a second, brand-new public credential-verification endpoint alongside `/login`, and a new tenant-resolution outcome (`organization`, not just `school`/`none`). Independently hits **both** of the Constitution's explicit ADR-trigger categories: "Authentication or JWT payload" and "Multi-tenancy or school context resolution." Requires Architecture Review sign-off before implementation, same bar as ADR-0001/ADR-0003/ADR-0004 — not eligible for the lighter, bundled treatment ADR-0002/ADR-0005/ADR-0006 received.
**Unblocks:** C13 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` (new row, to be added on acceptance).
**Related:** ADR-0003 (Identity Separation, C8/MR-001 — this ADR's org-login flow is unusable until `IDENTITY_CUTOVER_ENABLED` is live, a hard dependency, not a formality), C9 (School Switching, D-004 — `_issueExchangeCode`/`POST /exchange` reused here, and `multiSchoolEnabled`/`orgId`/`membershipId` JWT enrichment is the foundation this builds on), the Phase 0/Phase 1 work this ADR follows (`schools.slug` unique index, cross-collection collision checks, `organizations.orgSlugLoginEnabled`, the `enable/disable-multi-school` and `enable/disable-org-slug-login` platform-admin routes).

---

## Context

The user asked for organizations to use one shared URL slug across all their schools, reflected in platform admin, describing it as something "planned" — an exhaustive governance-corpus search found no prior written plan for this anywhere; it is net-new design. The clarified shape: one shared org URL (e.g. `green-valley.msingi.io`), login there, and a post-authentication school picker for multi-membership users, built on top of the already-shipped C9 switcher.

Direct code reads (`server/middleware/tenant.js`, `server/routes/auth.js`'s full `/login`/`/exchange`/`/switch-school` flow, `server/utils/identity-cutover.js`, `server/utils/provision-identities.js`, `server/utils/indexes.js`) plus a Plan-agent pressure-test established the ground truth this ADR is built on:

- **No partial "authenticate before knowing school" mechanism exists anywhere today.** Every credential check (`/login`, `/verify-otp`, `/force-change`, `PUT /settings`, admin reset) is hard-scoped to `tenantModel('users', {schoolId: req.school.id})`; `tenantMiddleware` itself 400s immediately if no single school resolves from JWT/header/subdomain/customDomain. C9's `POST /switch-school` is `authMiddleware`-protected — it requires an *already-valid* session and structurally cannot serve as a first-login path. A genuinely new login mechanism is required; nothing existing can be thinly wrapped.
- **`identities` (C8/MR-001), scoped `{orgId, email}`, is the only thing that can safely check a password without a school already known** — but it's only consulted when `IDENTITY_CUTOVER_ENABLED=true` (a platform-global env var, off everywhere today, never flipped in any real deployment, unverifiable in this sandbox with no live MongoDB). Without cutover live, there is no single authoritative password to check org-wide. This is why Phase 1 shipped `orgSlugLoginEnabled` as a *separate* flag from `multiSchoolEnabled`, and why this ADR's flow is fail-closed by construction until an operator flips the global env var, informed by `qa-health.js`'s existing `identity` gate.
- **`memberships` cannot answer "which schools can this identity log into."** It's keyed by per-school-scoped `users.id`, and one identity can correspond to multiple different `users.id` values across schools (`provision-identities.js:166`). The correct query is a direct fan-out: `users.find({identityId, schoolId: {$in: orgSchoolIds}, isActive: {$ne:false}})`. This is a genuinely new query pattern — `indexes.js` documents `users.identityId` today is looked up FROM a resolved identity, never queried in reverse. A new `{identityId:1, schoolId:1}` index on `users` is required, not optional.
- **Reusing `_issueExchangeCode`/`_exchangeCodes` (built for OAuth, reused for C9) directly for the picker step is unsafe.** That Map's entries are always full signed JWTs, consumed by the unmodified `/exchange` route. A partially-verified "identity confirmed, no school chosen yet" code must be structurally incapable of being redeemed there. This ADR specifies a separate Map with no JWT inside it at all.
- **`org.slug === school.slug` is the deliberate, universal state for every 1:1-genesis org today** (`provision-organizations.js:61`) — Phase 0 already fixed the real gap (no DB-level uniqueness on `schools.slug`, no cross-collection check at either creation route), so this ADR does not need to re-litigate slug collisions.

## Decision

### 1. New public resolution endpoint: `GET /api/public/resolve-portal?slug=`

A new endpoint, not an extension of the existing `GET /api/public/school-info` (keeps that endpoint's contract untouched — Compatibility Level 2). Resolution order: check `schools` first (unchanged — a 1:1 org's slug is indistinguishable from its one school's slug and should resolve as a school, not a one-entry picker). Only if no school matches, check `organizations`, and only return `type: 'organization'` when `multiSchoolEnabled && orgSlugLoginEnabled` are both true **and** the org has 2+ schools. If the org exists but isn't opted in, return the same 404 shape as "no such school/org" — response-shape differences must not leak org existence to an unauthenticated caller guessing a slug.

Response shape (org type), minimal disclosure, no school list:
```
{ type: 'organization', slug, name, logoUrl, primaryColor, tagline }
```
`organizations.logoUrl`/`primaryColor`/`tagline` already exist as optional fields (added in Phase 1) for exactly this purpose — additive, unconsumed until this endpoint ships.

### 2. Credential flow: `POST /api/auth/org-login`, `POST /api/auth/complete-org-login`

`POST /api/auth/org-login {orgSlug, email, password}`:
- Resolve org by slug; require `multiSchoolEnabled && orgSlugLoginEnabled && IDENTITY_CUTOVER_ENABLED`, else the *same* 404 shape as "not found" — the route must be indistinguishable from nonexistent when inert, mirroring `switch-school`'s provably-inert pattern.
- Rate-limit via the existing `SecurityService.checkAccountLock`/`recordFail`/`clearFail` — reusable unmodified, since `_key()` is a string composite, not schema-bound to real school IDs. Passing `orgId` in the `schoolId` parameter slot works correctly, though the parameter name is slightly misleading — noted, not fixed, out of scope.
- Check `identities.findOne({orgId, email})`, require `status === 'active'` (never `collision_pending`), bcrypt-compare `passwordHash` — same pattern as `auth.js`'s existing cutover branch.
- Find eligible schools via the new fan-out query (Context, above), requiring the new `{identityId, schoolId}` index on `users`.
- **0 eligible → 403.** **Exactly 1 eligible → mint the full session directly** (existing `_buildTokenPayload` + `_issueExchangeCode`, existing `/exchange` unchanged), applying the MFA branch inline (Decision 3). **2+ eligible → issue a picker code** in a new, separate `_orgPickCodes` Map — entries shaped `{identityId, orgId, allowedSchools: [{schoolId, userId, slug, name}], expiresAt}`, no JWT inside. TTL ~120s (longer than the existing 30s exchange-code TTL, since this one requires a human click, not an immediate machine redemption), with its own sweep-on-issue cleanup mirroring the existing pattern. Response: `{code, schools: [{id, name, slug}]}`.

`POST /api/auth/complete-org-login {code, schoolId}`:
- Look up in `_orgPickCodes` only — never `_exchangeCodes`, structurally can never cross-redeem.
- **Validate `schoolId` is literally present in `entry.allowedSchools`** — the server never trusts the client's `schoolId` for eligibility, only as a selector into a fixed set computed and locked in at `org-login` time. Reject with 403 if not present — the same fail-closed posture ADR-0003 mandated for a dangling `identityId`.
- Single-use: delete the code from the Map regardless of outcome.
- Re-fetch the specific `users` doc fresh (via the `userId` captured in the allowlist entry) rather than trusting the snapshot verbatim, to catch deactivation in the gap between `org-login` and `complete-org-login`.
- Apply the MFA branch here if not already handled at `org-login` (Decision 3), then `_buildTokenPayload` + `SessionService.createSession` + `_setAuthCookie` directly (this endpoint is the terminal step, no further exchange needed) + `AuditService.log({action: 'auth.org_login_complete', ...})`.

### 3. MFA/OTP: applied at the point a school becomes known, using the existing mechanism unmodified

Role is per-Membership, not per-Identity (Constitution §2) — the same identity can hold different roles at different schools, so "does this login need OTP" cannot be answered until a school is chosen. Design: apply the existing `MFA_ROLES` check inline in `org-login` for the single-school fast path, inline in `complete-org-login` for the picker path, reusing the *existing, unmodified* `{mfaRequired, userId, schoolId, hint}` response shape and the *existing, unmodified* `POST /api/auth/verify-otp` route. `identity.mfaEnabled` (identity-level, ADR-0003) still gates whether MFA is configured at all; `MFA_ROLES` (role-level, per chosen school) still gates whether it's required. No new OTP mechanism.

**Load-bearing client detail:** `verify-otp` is `tenantMiddleware`-gated, which resolves the school via JWT → `X-School-Slug` header → subdomain. On the org's shared subdomain, subdomain auto-detection resolves to nothing useful. The client must explicitly send `X-School-Slug: <chosen school's slug>` on the `verify-otp` call — the picker response's `slug` field (not just `id`/`name`) exists specifically to make this possible. Flagged explicitly since it's easy to drop silently during implementation.

### 4. Client changes

`detectSchool()` (`client/src/utils/schoolDetect.js`) stays synchronous and unchanged (Compatibility Level 2) — it remains a local heuristic, not a source of truth. `Login.jsx` fires `GET /api/public/resolve-portal` using the detected slug and gates rendering on the async `type` response: `school` → existing flow, unchanged; `organization` → new `OrgLoginPage`; `unknown`/404 → existing `SchoolFinderPage`, unchanged. This is a bigger structural change than swapping a component — today `isSchool` drives a synchronous render decision; it becomes a loading-state-gated async one.

New `OrgLoginPage` (parallel to `SchoolFinderPage`) holds the credential form and, on a multi-school response, an inline picker. Not built by reusing `TopBar.jsx`'s switcher wholesale — that component operates **post-session** (calls `switch-school` + `/exchange` against an already-authenticated user); `OrgLoginPage` operates **pre-session** (holds only an opaque `_orgPickCodes` code, no token). A small presentational-only list component (school name/logo → click handler prop) may be shared between both; the network/data logic stays separate, to avoid the exact code-kind confusion Decision 2's allowlist validation exists to prevent.

## What this explicitly does NOT cover (non-goals)

- **Does not flip `IDENTITY_CUTOVER_ENABLED` anywhere**, nor decide when to. That remains a platform-global operator decision informed by `qa-health.js`'s `identity` gate, unchanged by this ADR.
- **Does not change `/login`, `/verify-otp`, `/force-change`, `PUT /settings`, or admin reset-password.** All existing credential-check code paths are untouched; `org-login`/`complete-org-login` are additive, parallel routes.
- **Does not touch `_exchangeCodes` or `POST /exchange`.** The new `_orgPickCodes` Map is entirely separate, by design (Decision 2's central safety property).
- **Does not build a central Organization Billing Account or any other Evolution-doc aspiration** — unrelated to this ADR, already correctly scoped out by ADR-0005/C12.
- **Does not build a "remember my last school" or default-school shortcut** for multi-membership users — every login with 2+ eligible schools always shows the picker. A default/skip mechanism is real, separate future work, not requested by the clarified design.
- **Does not add rate-limiting or lockout logic beyond reusing the existing `SecurityService`** — no new anti-abuse mechanism is designed here.
- **Ships no code.** This document proposes a design; the Adoption gate states implementation is a separate, later step.

## Consequences

**Easier / safer:**
- Organizations that opt in (via the already-shipped `multiSchoolEnabled` + `orgSlugLoginEnabled` toggles) get a single login surface for all their schools once the operator also flips the global `IDENTITY_CUTOVER_ENABLED` — the actual feature request, delivered without touching any existing, working credential-check code path.
- The picker-code design (Decision 2) closes the specific vulnerability class this ADR was asked to close explicitly: a verified identity can never be redeemed against a school outside its own, server-computed, locked-in allowlist.
- Zero behavior change for every organization until all three gates (`multiSchoolEnabled`, `orgSlugLoginEnabled`, `IDENTITY_CUTOVER_ENABLED`) are true — verified structurally, the same "provably inert" posture every prior Kernel-tier ADR in this codebase has shipped with.

**Harder / newly constrained:**
- A second, parallel credential-verification code path now exists in the codebase (`org-login`) alongside `/login`. Both must be kept in sync for anything that affects password verification correctness going forward (e.g., a future change to hashing parameters) — a real, ongoing maintenance cost this ADR accepts rather than eliminates, since unifying them would mean routing `/login` itself through the org-resolution ambiguity, a larger change not requested here.
- The new `{identityId, schoolId}` index on `users` is the first index on that field in the reverse direction — a genuinely new query shape against a collection every school's login already depends on; must be added and verified before `org-login` ships, not after.
- `verify-otp`'s reliance on an explicit `X-School-Slug` header (Decision 3) is a subtle, easy-to-regress contract between the picker response and the OTP call — flagged here specifically so it isn't lost during implementation.

**Explicit non-guarantee:** this ADR makes org-slug login *possible*, not automatically live for any real organization — it remains gated behind three independent switches, one of which (`IDENTITY_CUTOVER_ENABLED`) is entirely outside this ADR's or Phase 1's control, and cannot be verified as safe to flip in this sandbox (no live MongoDB).

## Adoption gate

**This ADR requires explicit approval, separate from approval of the plan or analysis that produced this document, before any implementation begins.** Approving "go draft this ADR" is not approving its contents — same bar as ADR-0001/ADR-0003/ADR-0004, because this design independently hits both of the Constitution's explicit ADR-trigger categories and introduces a second public credential-verification code path, regardless of how inert it ships.

Once accepted: implementation covers `server/routes/public.js` (Decision 1), `server/routes/auth.js` (Decision 2 — new routes, new `_orgPickCodes` Map, MFA wiring per Decision 3), `server/utils/indexes.js` (the new `{identityId, schoolId}` index on `users`), `client/src/utils/schoolDetect.js`/`client/src/pages/Login.jsx`/a new `OrgLoginPage` component (Decision 4), and new test coverage for: the resolution endpoint's disclosure boundary (org-exists-but-not-opted-in returns the same shape as not-found), the 0/1/2+-eligible-schools branches of `org-login`, the allowlist-validation rejection in `complete-org-login` (the load-bearing security test — attempting to redeem a valid code against a `schoolId` outside the locked-in allowlist must 403), and the MFA branch firing correctly from both entry points.
