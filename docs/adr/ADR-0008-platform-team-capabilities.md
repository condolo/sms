# ADR-0008: Platform Team — scoped operator accounts with capabilities

**Status:** Accepted — implemented 2026-10-21 in the same session the design was approved.
**Date:** 2026-10-21
**Change class:** Kernel (per `PLATFORM_OPERATING_MODEL.md` §10) — changes how platform authorisation works (`middleware/auth.js`, the single gate in `routes/platform.js`) and adds new collections/fields to Identity (`platform_operators`). Auth-related and multi-tenant-adjacent, so it takes the full-recovery bar.
**Related:** PLAT-01 (named platform operators + the binary `support`/`owner` tier gate), PLAT-04 (real actor attribution in audit), ADR-0003 (Identity Separation — the school-side analogue of "one credential, many scopes"), `docs/PLATFORM_ADMIN_GUIDE.md`.

---

## Context

PLAT-01 replaced a single shared env-var platform credential with named `platform_operators` accounts. That closed the attribution gap (PLAT-04) but left exactly **one unit of permission**: a binary `tier`.

The gate in `server/routes/platform.js` was one line:

```js
router.use((req, res, next) => (req.method === 'GET' ? next() : requireOwnerTier(req, res, next)));
```

Consequences, all observed in the actual console:

1. **A "team member" was impossible.** The only options were *full owner* — delete schools, wipe a tenant, impersonate a user, grant entitlements — or *read everything and write nothing*. The realistic middle case ("Sam handles tickets and onboarding") could not be expressed.
2. **Accounts could only be created from a shell.** `scripts/create-platform-operator.js` was the only path; there was no list, no edit, no suspension, no password reset without SSH and a script.
3. **The GET gate was too coarse.** Every read — including cross-school user search — was open to any tier; there was no way to say "this person may see tickets but not the billing book."
4. **No work assignment.** Tickets carried a free-text `assignee` field with no UI, no rule, and no "my work" view.

The product requirement was explicit: Msingi staff ("super admin team members") with scoped duties — tickets, onboarding, provisioning — created by **email invite**, with permissions assigned by **role template plus per-capability overrides**.

---

## Decision

### 1. A capability registry is the single source of truth

`server/config/platformCapabilities.js` defines:

- **`CAPABILITIES`** — the atomic permissions (`tickets.manage`, `onboarding.manage`, `schools.delete`, `impersonate`, `operators.manage`, …).
- **`TEMPLATES`** — named starting points (`owner`, `support_agent`, `onboarding`, `billing`, `content`, `viewer`, `custom`).
- **`POLICY`** — a `(method, path) → capability` table, matched most-specific-first.
- **`resolveCapabilities(op)`** — template caps ∪ per-operator overrides; `owner` is always `['*']`.

Adding a capability or a guard is a one-line change in this file and nowhere else.

### 2. Backward compatibility is the default, and never widens an account

`LEGACY_TIER_TEMPLATE = { owner: 'owner', support: 'viewer' }`. An operator with **no** `template` field keeps exactly the access its tier already had: `support` maps to **viewer** (read-only), *deliberately not* to `support_agent`, so shipping the capability layer cannot silently grant an existing human write access. Existing `owner` rows resolve to `['*']` through the same path `requireOwnerTier` always used.

The legacy env-var credential remains owner-tier. It is still only reachable while no active operator exists — and, importantly, an **invited** operator is created with `isActive:false`, so a pending invite does not disable the bootstrap path before it is accepted.

### 3. One enforcement point, driven by the policy table

`middleware/auth.js` gains `requirePlatformCapability`, wired once in `routes/platform.js`, replacing the blanket verb check. Unmatched routes keep the historical default (`GET` allowed, everything else owner-only) so a route added later is never accidentally opened up.

`platformSession` now hydrates the caller's capabilities from the live operator record (30 s cache; `invalidateOperatorCache()` clears it on any write), and rejects `suspended`/`removed` accounts and tokens older than a `sessionsRevokedAt` stamp — so revocation and suspension take effect on the next request rather than on the next two-hour token. When no record can be read, capabilities fall back to the tier claim, which is the pre-capability semantics; an unknown tier resolves to *no* capabilities rather than to owner.

### 4. Invites, not one-time passwords

Creation is by email invite — the option chosen over the shown-once password the bootstrap script uses, because a team will grow and the link is self-service:

- `POST /operators/invite` creates the account `status:'invited'`, `isActive:false`, and emails a `${APP_URL}/platform?invite=<token>` link.
- The token is 32 random bytes; only its **SHA-256 hash** is stored. Single-use, 72-hour expiry.
- `POST /auth/accept-invite` (public, rate-limited) exchanges token + chosen password for an active account and a session.
- If delivery fails, the API returns the link to the inviter (and only then) so a human can pass it on — never on a successful send.

### 5. Three refusals that protect the platform

`server/services/platformOperators.js` (pure, unit-tested) + route guards enforce:

| Guarantee | Rule |
|---|---|
| **No escalation** | You cannot grant a capability — or the `*` owner sentinel — that you do not yourself hold. |
| **No last-owner-out** | Suspending, demoting or removing the final active owner is refused. |
| **No self-lockout** | You cannot remove your own `operators.manage`, suspend yourself, or delete your own account. |

Every mutation is audit-logged against the real actor (`_platformActor`), continuing PLAT-04.

### 6. The console renders only what you can use

`GET /me` (readable by any authenticated operator) returns identity + resolved capabilities. `platform.html` hides nav sections and actions the operator lacks, shows who is signed in with their role, and carries the invite-acceptance panel. This is presentation only; the server remains the enforcement point.

### 7. Assignment, and a "My Work" queue

Work items are claimed explicitly, not auto-routed: `POST /tickets/:id/assign`, `POST /schools/:id/assign` (pending approvals) and `POST /demo-requests/:id/assign`, each storing `assigneeId` + `assigneeName` and keeping the legacy free-text `assignee` in sync. `GET /my-work` returns the caller's own tickets *and* onboarding approvals, plus the unassigned backlog, past-SLA items and pending counts. It is readable by any authenticated operator because it only ever returns the caller's own work plus aggregates — never a colleague's queue. `GET /operators/directory` exposes just `id`/`name`/`email` of active operators so an assignee picker works for a support agent who cannot read the full team list.

---

## Consequences

**Easier / safer**
- A team member can be scoped precisely (e.g. `support_agent`) and onboarded by email with no shell access.
- Every authorisation decision for the platform layer is now readable in one table, and testable without HTTP.
- Revocation is immediate: suspension, removal and session-revoke all land on the next request.

**Harder / newly constrained**
- One extra `platform_operators` read per platform session per 30 s. Acceptable for this traffic class; if the console ever becomes high-QPS, the cache TTL is the dial.
- `platformSession` is now `async` (it hydrates capabilities). Its three direct-call tests were updated to `await` — a real contract change, recorded rather than hidden.
- Two grants now have to be reasoned about together (template + overrides). The UI shows the resolved set, and `effectiveCaps` is exposed on every operator in the list response, so this stays inspectable.
- The capability list is a new surface to keep honest. Mitigated by `operations.manage` being itself a capability, so who can widen the surface is bounded.

**Explicitly not covered**
- No per-operator audit-log *viewer* beyond the existing Governance section.
- No automatic assignment rules or round-robin — claiming is explicit
  (`tickets/:id/assign`, `schools/:id/assign`, `demo-requests/:id/assign`).
- No notification to an operator when work is assigned to them.
- No SSO/identity-provider integration for operators.
- School-side RBAC (`role_permissions`) is untouched — this ADR is about the platform layer only.

---

## Ship list

| Area | Files |
|---|---|
| Registry | `server/config/platformCapabilities.js` (new) |
| Enforcement | `server/middleware/auth.js` (`requirePlatformCapability`, capability hydration, `invalidateOperatorCache`), `server/routes/platform.js` (single gate) |
| Service | `server/services/platformOperators.js` (new) |
| API | `server/routes/platform.js` — `GET /me`, `GET /operators`, `GET /operators/capabilities`, `GET /operators/directory`, `POST /operators/invite`, `POST /operators/:id/resend-invite`, `PATCH /operators/:id`, `POST /operators/:id/{suspend,reactivate,revoke-sessions}`, `DELETE /operators/:id`, `POST /auth/accept-invite`, `POST /tickets/:id/assign`, `POST /schools/:id/assign`, `POST /demo-requests/:id/assign`, `GET /my-work` |
| Email | `server/utils/email.js` — `sendPlatformOperatorInvite` |
| Indexes | `server/utils/indexes.js` — `platform_operators.status`, `.template` |
| Console | `platform.html`, `css/platform.css` — Team view, capability-gated nav, identity block, invite-acceptance panel |
| Tests | `server/__tests__/platform-capabilities.test.js`, `server/__tests__/services/platformOperators.test.js`, `server/__tests__/routes/platform-capability-gate.test.js`, `server/__tests__/routes/platform-operators-api.test.js` |

**Bugs found and fixed during implementation** (recorded because they are exactly the class this layer exists to prevent):
1. `POST /operators/invite` originally destructured the invitee's address as `email`, shadowing the module-scope mailer — `.sendPlatformOperatorInvite` was being called on a string. Caught by the operator-API suite; renamed to `toEmail`.
2. The first version of the team gate tested only `req.platformCaps`, so any code path that reached it without hydration (a stubbed session, a future mount) denied *everything* — including owners. Fixed by making `requirePlatformCapability`/`requireOwnerTier` fall back to the tier claim via `_effectiveCaps`.
