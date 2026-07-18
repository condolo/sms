# ADR-0002: Membership Model — Phase 1 (Shadow Collection)

**Status:** Accepted (implementation shipped alongside this ADR — narrow, additive, reversible scope; see `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §18's Domain Ownership Specification recommendation, addressed here via §3 rather than as a separate blocking document, the same precedent Organizations (C1/C2) already set)
**Date:** 2026-07-18 (proposed and accepted same day — narrow, reversible scope; see Adoption gate)
**Implementation:** Complete for Phase 1 scope — `memberships` collection (shadow), `provision-memberships.js`, boot-time backfill, platform-admin `GET /users/search` + `POST /memberships`, "Link Identity" UI in the Organizations panel.
**Change class:** Additive, non-authoritative. Does **not** meet the Kernel-tier bar of ADR-0001 (no query-layer or auth-layer behavior changes) — informational/structural ADR, not a Kernel-tier gate.
**Unblocks:** C7 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`. Does **not** unblock C8 (identity authoritative) — that remains gated on D-001 (ratified, see Governance Review) plus C7 fully populated plus this ADR's own explicit non-goals being revisited in a future ADR.
**Related:** `ARCHITECTURE_CONSTITUTION.md` §6-10 (Organization-Scoped Identity, 5-stage Membership migration), Governance Review D-001 (ratified 2026-07-18 — Organization-Scoped Identity) and D-004 (resolves with D-001), ADR-0001 (tenant enforcement — unaffected by this ADR).

---

## Context

`PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §9-10 describes Identity/Membership as a target-state concept that, as of this ADR, did not exist in any form — confirmed by a full audit of the codebase against that document. `role`/`roles` are read directly off the JWT (`req.jwtUser`) by `rbac.js` and `scopeMiddleware.js`, and by ~21 route files; there is no membership record anywhere, and a person's access to a school is entirely a property of their `users` document's `schoolId` field, one school per user.

The user scoped this phase explicitly: **no self-service organization/school management for customers** — schools and organizations are added exclusively from the platform admin portal, for now. This ADR covers only what was needed to make platform admins able to record that a person has access to a second school under the same organization, without touching how anyone logs in.

## Decision

### 1. A `memberships` collection — additive, non-authoritative

A new platform/org-level collection (no `schoolId` — mirrors `organizations`' platform-level exemption per ADR-0001 §3), schema:

```
{ id, orgId, userId, schoolId, role, roles, isActive, status, isPrimary, source, createdBy, createdAt, updatedAt }
```

Indexed on: unique `{id}`, unique `{userId, schoolId}` (the real-world invariant — a person has at most one membership per school, and the idempotency key for the provisioning upsert), plus `{schoolId}`, `{orgId}`, `{userId}` for lookup.

**Nothing reads this collection for authentication or authorization.** Confirmed by direct inspection: `auth.js`'s login/JWT issuance, `sessionService.js`, `rbac.js:106`, `scopeMiddleware.js:113`, and every route that reads `req.jwtUser.role` are unchanged by this ADR. A person with two Memberships still logs into exactly the one school named on their `users.schoolId` — this ADR records a fact, it does not act on it yet.

### 2. Backfill — one Membership per existing user

`provisionMembershipForUser(user, {Schools, Orgs, Memberships})` (`server/utils/provision-memberships.js`) creates a Membership for a user's current `schoolId`, self-healing a missing `school.organizationId` via the existing `provisionOrganizationForSchool()` (ADR-0001-era code, unchanged). `provisionMemberships()` batch-backfills every user at boot, chained after `provisionOrganizations()`. Same idempotent-upsert, interruption-safe, non-fatal-on-error pattern as the Organizations backfill (`provision-organizations.js`) — this ADR does not introduce a new migration pattern, it reuses the one already reviewed and shipped.

### 3. Domain ownership (scoped — Identity/Membership/Organization/School only)

Addressing `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §18's recommendation for a Domain Ownership Specification, scoped to the four entities this phase actually touches (a full platform-wide spec remains legitimate future work, not a gate on this):

| Entity | Owns | Does not own |
|---|---|---|
| **School** | Its own operational data (`schoolId`-scoped collections, per ADR-0001) | Who has access to it — that is Membership's fact once C8 lands; today it is still `users.schoolId` |
| **Organization** | Grouping of Schools (`school.organizationId` FK, per Governance Review D3 — no reverse array) | Billing, identity, or capability activation — `multiSchoolEnabled` stays `false`; see Non-goals |
| **User** | Credentials, MFA, JWT-issuance identity, `roles` as read at login (unchanged, authoritative today) | A record of *every* school they can access — that's what Membership adds, additively |
| **Membership** | A non-authoritative record of `{user, school, org, role}` — the shadow fact, source of truth for **nothing** yet | Login, session issuance, or RBAC — those remain the User/JWT's job until C8 |

### 4. Platform-admin grant API — organization-scoped, record-only

`GET /api/platform/users/search?email=` (cross-school identity search — something `/api/users` structurally can't do, since it's always school-scoped by ADR-0001 design) and `POST /api/platform/memberships` (`{userId, schoolId, role?}`). The grant route enforces the Constitution §6 boundary **in code, not just in the Constitution**: the target school's organization must match the user's current school's organization, or the request is rejected with 409 — cross-organization identity linking is explicitly out of scope for this phase, not silently allowed. A duplicate membership is also 409'd. Every grant is logged via `AuditService`. The response carries an explicit `note` field stating the grant is record-only and does not yet enable login — surfaced in the API contract, not buried in a code comment, and echoed verbatim by the "Link Identity" UI's success toast.

## What this explicitly does NOT cover (non-goals of Phase 1)

- **No auth.js, JWT, `sessionService.js`, `rbac.js`, or `scopeMiddleware.js` changes.** Login continues to be governed solely by `users.schoolId`.
- **No School Switcher UI.** That is C9, gated on C8.
- **No self-service "add a school to my organization" for customers.** Platform admin portal only, per explicit scope reduction for this phase.
- **No cross-organization identity linking.** 409'd, not silently allowed — Constitution §6's organization boundary is enforced, not aspirational.
- **`multiSchoolEnabled` is never set `true` by this ADR's code.** Per Constitution §10 Stage 3, that flag specifically means "auth begins reading Memberships" — a capability this ADR does not build.
- **No change to `POST /schools` or the Provision School form.** Linking an identity is a separate action against an already-provisioned school, not folded into that already-tested critical path.

## Consequences

**Easier / safer:**
- Platform admins can now record multi-school access for a person ahead of the identity migration, so C8 (when it lands) has real data to read instead of starting from zero.
- The organization-scoped 409 makes the D-001 boundary a runtime-enforced fact, not just a ratified decision on paper.
- Fully reversible: drop the `memberships` collection, remove the two routes and the UI action — nothing else in the system references it.

**Harder / newly constrained:**
- A person can now have a Membership that implies access the login system doesn't yet honor — a deliberate, documented gap (the `note` field), not a hidden one. Anyone reading the API response or the UI toast sees the limitation stated plainly.
- Adds one more collection to keep in sync during the eventual C8 cutover (dual-write / index migration), scoped for that ADR when it's written.

## Adoption gate

This ADR does not require the Kernel-tier Architecture Review sign-off ADR-0001 required, because it makes no query-layer or auth-layer behavior change (per `PLATFORM_OPERATING_MODEL.md` §10's Kernel-tier definition) — it is additive, reversible, and invisible to every existing login/session path. It was implemented directly following the plan approved in-session, per the same precedent Organizations (C1/C2) set. **C8 (making Membership authoritative) is a separate, future ADR** and requires its own Architecture Review sign-off before implementation — this ADR does not pre-approve it.
