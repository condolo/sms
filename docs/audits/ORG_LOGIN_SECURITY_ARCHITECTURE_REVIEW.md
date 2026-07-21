# Organization Login — Security & Architecture Review

**Date:** 2026-07-21
**Trigger:** External review of the `IDENTITY_CUTOVER_ENABLED` gate removal from `POST /api/auth/org-login` (see `CHANGELOG.md` [v5.2.1] and `docs/adr/ADR-0007-org-slug-login.md` correction 7).
**Status:** Research only. No code changed as part of this document.
**Method:** Every claim below is traced to a specific file:line. Where something cannot be verified without a live database, browser, or production environment, that is stated explicitly rather than assumed.

---

## 1. Why was `IDENTITY_CUTOVER_ENABLED` there, and does removing it from `org-login` create a bypass?

### 1.1 Complete inventory — every reference to the flag in the codebase

Grep for `IDENTITY_CUTOVER_ENABLED` / `isIdentityCutoverEnabled` across `server/` returns exactly **6 production call sites** (everything else is test setup/teardown or comments). Each is listed with what it actually gates:

| # | Site | What it gates | Still gated after this fix? |
|---|---|---|---|
| 1 | `server/routes/auth.js:350` (`POST /login`) | Whether the password comparison reads `identities.passwordHash` or `users.password` **for that one school's login**, and whether the MFA-enabled read comes from `identity.mfaEnabled` or `user.mfaEnabled` | **Yes — untouched** |
| 2 | `server/routes/auth.js:1140` (`POST /change-password`) | Whether the `currentPassword` verification reads `identities.passwordHash` or `users.password` | **Yes — untouched** |
| 3 | `server/routes/settings.js:146` (`PUT /settings`) | Same as #2, for the settings-page password-change form | **Yes — untouched** |
| 4 | `server/routes/qa-health.js:391` | Reports the flag's current boolean value inside the `identityMigration` block of `GET /api/qa/health`'s JSON response | Informational only — never gated anything |
| 5 | `server/routes/platform.js:514` | A human-readable `note` string in `POST /organizations/:id/enable-multi-school`'s response, telling a platform admin that org-login *also* depends on this flag | Informational only — never gated anything |
| 6 | `server/routes/auth.js` (`POST /org-login`) | **Removed by this fix** — previously gated the org-login credential check | **No — this is the change under review** |

Two routes never touch the flag at all and never did: `POST /force-change` and `POST /users/:id/reset-password` (admin reset). Verified directly — neither reads an existing password (they overwrite unconditionally), so there is nothing for a cutover-gated *read* to apply to.

### 1.2 What the flag is actually protecting (with evidence, not restated assumption)

`server/utils/identity-cutover.js` is 23 lines: `isIdentityCutoverEnabled()` returns `process.env.IDENTITY_CUTOVER_ENABLED === 'true'`, nothing else. It is a single boolean switch with no per-organization or per-school scoping — it is either on for the entire platform or off for the entire platform.

Every one of sites #1-#3 follows the **identical code shape**, confirmed by direct read of each:

```
const identityLookupAttempted = isIdentityCutoverEnabled() && !!user.identityId;
let identity = null;
if (identityLookupAttempted) {
  identity = await _model('identities').findOne({ id: user.identityId }).lean();
}
const match = identityLookupAttempted
  ? (identity?.passwordHash?.startsWith('$2') ? await bcrypt.compare(input, identity.passwordHash) : false)
  : (user.password?.startsWith('$2') ? await bcrypt.compare(input, user.password) : false);
```

This is a **read-source switch**, not a correctness gate: with the flag off, all three routes read `users.password` (today's original, always-correct behavior, unchanged since before ADR-0003 existed). With the flag on, they read `identities.passwordHash` instead — which is only *safe* to do because a separate, unconditional mechanism (§1.3) keeps that field correct regardless of the flag.

### 1.3 Why org-login never needed this flag — the mechanism that makes it safe

Dual-write, added in ADR-0003 Phase 1 and **not conditioned on `IDENTITY_CUTOVER_ENABLED` anywhere** — confirmed by reading all four password-write paths:

- `POST /change-password` (`auth.js:1164-1169`) — writes `identities.passwordHash` unconditionally when `user.identityId` is set, no `isIdentityCutoverEnabled()` check in the write path.
- `POST /force-change` (`auth.js:687-693`) — same, unconditional.
- `PUT /settings` (`settings.js:177-183`) — same, unconditional.
- `POST /users/:id/reset-password` (`settings.js`, confirmed by reading the route) — same, unconditional.

This means: **the moment a person's `identityId` is set, `identities.passwordHash` is kept in lockstep with whatever school's password they last changed, on every server in every environment, with or without cutover.** Cutover only controls whether that already-correct field gets *read* by the three single-school routes above.

`org-login` has no alternative to reading `identities.passwordHash` in the first place — it cannot know which school's `users.password` to check, because no school is known yet (that's the entire premise of the feature: authenticate before a school is chosen). So `org-login` was never in the "flag off → read `users.password`" branch that #1-#3 have — it always read `identities.passwordHash`, flag or not. **The flag, applied to org-login, was not switching between two data sources — there was only ever one possible source for this route.** It was purely an additional boolean AND'd onto the gate, with no corresponding second code path behind it.

### 1.4 Direct proof there is no bypass

The claim to verify: removing the flag from `org-login` cannot let anyone authenticate who couldn't authenticate correctly before, and cannot let cutover-off single-school accounts skip any check they'd otherwise be subject to.

- **`org-login`'s actual credential check is unchanged** — still `bcrypt.compare(password, identity.passwordHash)` against a `status:'active'` identity (`auth.js`, the line immediately after the gate). Removing the flag changed *whether the route is reachable at all*, not *what it checks once reached*.
- **A `collision_pending` identity still cannot org-login** — the query is `Identities.findOne({orgId, email, status:'active'})`; `collision_pending` never matches, by construction (confirmed: this is the exact mechanism the code comment cites for closing the account-enumeration side-channel, unrelated to cutover).
- **An account with no `identityId` at all cannot org-login** — there is no code path in `org-login` that ever looks at `users.password`; it only ever queries `identities`. An unprovisioned account (e.g. a `collision_pending` sibling) simply produces "no identity found" → the same 401 as a wrong password.
- **Single-school `/login` for that same account is completely unaffected** — sites #1-#3 above still read their gate independently; nothing about removing gate #6 changes what `isIdentityCutoverEnabled()` returns or how #1-#3 behave. Confirmed by the full test suite (611/611 passing after the change, including all pre-existing cutover-on/off tests for `/login`, `/change-password`, and `PUT /settings`).

**Conclusion, stated as a claim that can be checked against the evidence above, not asserted on authority:** the flag's role for org-login was never "prevent an incorrect credential source" (dual-write already guarantees the source is correct) — its own design comment, present in the code before this fix (`auth.js`, original text, quoted verbatim in ADR-0007 correction 4), says exactly this: *"requiring it anyway is a deliberate, near-zero-cost conservative choice... an extra circuit breaker, not a technical requirement."* Removing an admitted-non-technical circuit breaker, after confirming (not assuming) that the mechanism it was double-checking is unconditional, is not the same claim as "nothing was protecting anything" — it is the narrower, evidenced claim that *this specific gate, on this specific route*, had no correctness dependency, which the four write-path reads above and the test suite both confirm.

---

## 2. Does this create two authentication paths? Full comparison.

### 2.1 Sequence — `POST /login` (single-school)

```
Client                          Server
  │  POST /login                  │
  │  {email, password}            │
  │  Host: schoolslug.msingi.io   │
  ├───────────────────────────────►
  │                    loginIpLimiter (IP, 100/15min, CF-aware)
  │                    tenantMiddleware — resolves req.school from
  │                      subdomain/header/JWT. 400s if none resolves.
  │                    SecurityService.checkAccountLock(schoolId, loginId)
  │                      → 429 if locked
  │                    User.findOne({email|username, schoolId})
  │                      → 401 (generic) if not found
  │                    user.isActive check → 403 (pending/rejected/inactive)
  │                    isIdentityCutoverEnabled() && user.identityId ?
  │                      → read identities.passwordHash : read users.password
  │                    bcrypt.compare
  │                      → 401 (generic) + SecurityService.recordFail if no match
  │                    mustChangePassword / 90-day rotation check
  │                      → 200 {passwordExpired:true, reason, userId, schoolId} (no session yet)
  │                    MFA_ROLES.has(role) && mfaEnabled !== false ?
  │                      → write mfaOtp/mfaExpiry, email OTP,
  │                        200 {mfaRequired:true, userId, schoolId, hint}
  │                        (no cookie, no session)
  │                    else:
  │                      lastLogin update
  │                      AuditService.log('auth.login')
  │                      SessionService.createSession
  │                      _buildTokenPayload → sign JWT
  │                      SecurityService.clearFail
  │                      _setAuthCookie (HttpOnly)
  │                      200 {user, school, absoluteExpiry, availableSchools?}
  ◄───────────────────────────────┤
```

If `mfaRequired`, client calls `POST /verify-otp {userId, otp}` (own rate limiter, own 5-min OTP expiry, timing-safe compare) → same session-creation tail as above on success.

### 2.2 Sequence — `POST /org-login` (organization-shared)

```
Client                          Server
  │  GET /resolve-portal?slug=    │   (before the login form even renders)
  ├───────────────────────────────►
  │                    Schools.findOne({slug}) → school ? return type:'school'
  │                    else Org.findOne({slug}); org.multiSchoolEnabled &&
  │                      schoolCount>=2 ? return type:'organization' : 404
  ◄───────────────────────────────┤
  │  POST /org-login              │
  │  {orgSlug, email, password}   │
  ├───────────────────────────────►
  │                    orgLoginLimiter (IP, 20/15min — NOT CF-aware, §6.1)
  │                    Org.findOne({slug:orgSlug})
  │                    org?.multiSchoolEnabled ? continue : 404 "Portal not found"
  │                    SecurityService.checkAccountLock(org.id, email)
  │                      → 429 if locked  [separate counter from /login's — §3.5]
  │                    Identities.findOne({orgId, email, status:'active'})
  │                    bcrypt.compare(password, identity.passwordHash)
  │                      → 401 "Invalid email or password" (byte-identical
  │                        whether: no identity, collision_pending identity,
  │                        or wrong password) + SecurityService.recordFail
  │                    _resolveIdentitySchools(identity.id, org.id)
  │                      — users.find({identityId, schoolId:{$in:orgSchools},
  │                        isActive:{$ne:false}}), schools also isActive-filtered
  │                    0 eligible → 403
  │                    1 eligible → TargetUsers.findOne(userId, schoolId, isActive)
  │                      → 403 if somehow missing
  │                      → _completeOrgLoginSession(user, school, identity)
  │                    2+ eligible → mint _orgPickCodes entry (~120s TTL),
  │                      200 {code, schools:[{id,name,slug}]}  (no cookie yet)
  ◄───────────────────────────────┤
```

`_completeOrgLoginSession` (shared by the 1-eligible fast path above AND by `complete-org-login` below):

```
  isDemo? skip MFA. MFA_ROLES.has(role) && mfaEnabled !== false ?
    (mfaEnabled always read from `identity.mfaEnabled` here — never
     `user.mfaEnabled`, because org-login always has a resolved identity
     by this point — see §2.4 for why this is a real, if narrow, divergence)
    → write mfaOtp/mfaExpiry, email OTP,
      200 {mfaRequired:true, userId, schoolId, schoolSlug, hint}
  else:
    lastLogin update
    AuditService.log('auth.login', details:{via:'org_login'})
    SessionService.createSession
    _buildTokenPayload → sign JWT
    _setAuthCookie (HttpOnly)
    200 {user, school, absoluteExpiry, availableSchools?}
```

If `mfaRequired`, client calls the **existing, unmodified** `POST /verify-otp` — same route `/login`'s MFA branch calls, same OTP mechanism, no parallel implementation.

### 2.3 Sequence — `POST /complete-org-login` (picker redemption, 2+ eligible schools)

```
Client                          Server
  │  POST /complete-org-login     │
  │  {code, schoolId}             │
  ├───────────────────────────────►
  │                    _orgPickCodes.get(code); delete regardless of outcome
  │                      → 400 if missing/expired
  │                    schoolId ∈ entry.allowedSchools ?  → 403 if not
  │                      (server-locked set from org-login time — client
  │                       choice is a SELECTOR into a fixed set, never trusted
  │                       as the eligibility decision itself)
  │                    Schools.findOne({id:schoolId}); .organizationId === entry.orgId ?
  │                      → 403 if re-parented since the code was minted (TOCTOU close)
  │                    TargetUsers.findOne({id:match.userId, schoolId, isActive})
  │                      → 403 if deactivated since org-login ran
  │                    Identities.findOne({id:entry.identityId})
  │                    _completeOrgLoginSession(user, school, identity)
  │                      (same tail as §2.2 — MFA branch, session, cookie)
  ◄───────────────────────────────┤
```

### 2.4 Behavior-by-behavior comparison table

| Dimension | `/login` | `/org-login` + `/complete-org-login` | Identical? |
|---|---|---|---|
| Tenant/school resolution | `tenantMiddleware`, subdomain/header/JWT — infrastructure-level, not client-body input | `orgSlug` from request body → DB lookup; school itself resolved only *after* credential check, from the identity's real accounts | **Intentionally different** — org-login structurally cannot know the school first; this is the feature's premise, not drift |
| Credential source | `users.password` OR `identities.passwordHash`, per cutover flag | Always `identities.passwordHash` | **Intentionally different**, evidenced in §1.3 |
| Rate limiting (IP layer) | `loginIpLimiter`: 100/15min, `keyGenerator: cf-connecting-ip \|\| req.ip` | `orgLoginLimiter`: 20/15min, **no `keyGenerator` — defaults to `req.ip` only** | **Drift found — see §6.1** |
| Rate limiting (account layer) | `SecurityService.checkAccountLock(schoolId, loginId)` | `SecurityService.checkAccountLock(org.id, email)` | Same mechanism, **different, independent counter** — see §3.5 |
| Failure response shape | Generic 401 "Invalid email or password" for not-found/wrong-password (no distinct collision-adjacent state exists at single-school level) | Generic 401, explicitly proven byte-identical across no-identity / `collision_pending` / wrong-password (dedicated test) | Same posture, org-login's is more rigorously tested for this specific property |
| MFA trigger condition | `MFA_ROLES.has(role) && mfaEnabled !== false`, `mfaEnabled` from `identity` only if cutover on AND `user.identityId` set, else `user.mfaEnabled` | Same condition, but `mfaEnabled` **always** from `identity.mfaEnabled` (identity is a hard prerequisite to reach this code at all) | **Narrow, real divergence — see below** |
| MFA mechanism once triggered | `_genOTP`/`_hashOTP`, 5-min expiry, `sendLoginOTP`, `POST /verify-otp` | Identical calls, identical response shape (`mfaRequired`, `userId`, `schoolId`, `hint`) plus `schoolSlug` (needed for org-login's header-priming, per ADR-0007 correction 5) | Same mechanism, same route handles both |
| Session creation | `SessionService.createSession(userId, schoolId, role, ip, ua)` | Identical call shape | Identical |
| Token building | `_buildTokenPayload(user, schoolId)` → `sign({...payload, sessionId, absoluteExpiry})` | Identical | Identical |
| Cookie | `_setAuthCookie(res, token, absoluteExpiry)` (HttpOnly) | Identical | Identical |
| Response body | `{user, school, absoluteExpiry, availableSchools?}` | Identical shape | Identical |
| Audit event | `AuditService.log({action:'auth.login', actor, schoolId, req})` | Identical action name, `+ details:{via:'org_login'}` | Same event type, correctly tagged origin — see §5 |
| Successful-login side effects | `lastLogin` update, `_checkTrialAndNotify`, `SecurityService.clearFail` | Identical (`_checkTrialAndNotify` called in `_completeOrgLoginSession` too) | Identical |
| Trial/expiry notification | `_checkTrialAndNotify(req.school)` | `_checkTrialAndNotify(school)` | Identical |

### 2.5 The one real divergence worth naming precisely: MFA source

For `/login`, whether a user's MFA challenge is driven by their **per-school** `user.mfaEnabled` or their **shared** `identity.mfaEnabled` depends on the cutover flag and on whether `identityId` is set. For org-login, it is **always** `identity.mfaEnabled` — there is no other option, since org-login only ever has an `identity` object, never a raw `user.mfaEnabled` read.

This only produces different *user-visible behavior* if a specific precondition holds: **a person's `user.mfaEnabled` (at some school) and their `identity.mfaEnabled` (shared) were set to different values, and cutover is currently off.** Checked directly: **no route anywhere in `server/routes/` ever writes `mfaEnabled` after account creation** (grepped the entire routes directory — zero matches for an `mfaEnabled` write outside `provision-identities.js`'s one-time seed at identity-creation). So this divergence cannot be *caused* by any in-app action today; it can only exist if two of a person's accounts were created with different `mfaEnabled` values at creation time (e.g. via CSV import or admin account creation with the field set explicitly), and their identity was seeded from whichever account was processed first (§3 covers exactly this same first-processed-wins mechanic for passwords). **This is real, narrow, and not exploitable as a security bypass** (in the divergent case, org-login is if anything *more* likely to require MFA, since the identity inherits from provisioning order, not a weaker fallback) — but it is a genuine behavioral inconsistency a security reviewer should have on record, not discover independently later.

### 2.6 School switching after org-login

Once a session exists (from either path), `POST /switch-school` behaves **identically regardless of how the session was created** — it reads `req.jwtUser.identityId`/`orgId` from the JWT (populated the same way by `_buildTokenPayload` on both paths) and calls the same `_resolveIdentitySchools` resolver org-login itself uses. There is no code branch anywhere that distinguishes "this session came from org-login" from "this session came from /login" once the JWT exists — confirmed by reading `switch-school`'s full implementation (`auth.js:1278+`), which never checks `via` or any org-login-specific marker.

---

## 3. Password synchronization architecture — full audit, no implementation

### 3.1 Which password is authoritative

There is no single, universal "authoritative password." Authority is **per credential surface**:

- **Single-school `/login` for a given school**, cutover off (today's actual production state, confirmed nowhere in this repo is `IDENTITY_CUTOVER_ENABLED=true` set by default — it is opt-in only): `users.password` **for that school** is authoritative.
- **Single-school `/login`, cutover on**: `identities.passwordHash` is authoritative, `users.password` is a mirror kept in sync by dual-write but not read.
- **`org-login` (any state)**: `identities.passwordHash` is always authoritative — it is the only password org-login can check.

For a person with accounts at two schools under the same org, this means: **as long as cutover stays off (its current default), her two schools' `users.password` values can independently diverge from each other with zero system-level correction** — nothing keeps School A's and School B's `users.password` for the same person in sync with *each other*; dual-write only keeps each of them in sync with the *shared identity* at the moment each is individually changed.

### 3.2 When synchronization occurs

Exactly four write paths dual-write, all unconditional (§1.3): `POST /change-password`, `POST /force-change`, `PUT /settings`, `POST /users/:id/reset-password`. Each writes the identical bcrypt hash (never re-hashed — bcrypt is salted per call, so hashing "the same" password twice would produce different, mismatching hashes; the code is explicit about hashing once and writing the same string to both places) to `users.password` (the acting school) and, if `user.identityId` is set, to `identities.passwordHash` (the shared record) in the same request.

**Synchronization is one-directional per event**: changing your password at School A updates the shared identity; it does **not** update School B's `users.password`. If she later logs into School A directly (not via org-login), she uses her new password. If she logs into School B directly, she still needs her old School B password — School B's stored hash was never touched. Org-login, meanwhile, immediately reflects the School-A change (it always reads the identity).

### 3.3 What happens if passwords differ

Confirmed by reading the actual credential-check code (not inferred): nothing in the platform detects this state at write time or blocks it. It is only detectable *after the fact*, via `server/routes/qa-health.js`'s `_checkPasswordHashMismatch` (ADR-0003 Phase 2) — which compares `users.password` (per school) against the linked identity's `passwordHash` and reports a count, platform-wide, in `GET /api/qa/health`'s integrity checks. This is a **diagnostic**, not a **prevention or correction mechanism** — it tells an operator the condition exists somewhere; it does not identify which specific accounts, notify affected users, or offer a remediation flow. Confirmed no such flow exists by grepping for any "password mismatch" resolution route — none found.

### 3.4 What happens during Link Identity — traced precisely, not assumed

This required tracing the actual merge code path, because the outcome is more specific than "arbitrary" — it is **deterministic, but undocumented and unannounced**:

`POST /api/platform/memberships` (`platform.js:604`, the "Link Identity" action) creates a `memberships` grant, then calls `provisionIdentityForUser(user, ...)` where `user` is the account the admin was already looking at (the one whose `userId` was passed in). Tracing `provisionIdentityForUser` (`provision-identities.js:71`):

- **If `user.identityId` is already set** (the common case — this account likely already has a singleton identity from being provisioned earlier as an unlinked account), the function's very first check (`if (user.identityId) { const already = ...; if (already) return already; }`) returns **immediately** — this specific call does nothing further.
- The actual merge happens on the **next server restart's boot-time re-scan** (`provisionIdentities()`, `server/index.js`'s boot sequence), which re-scans every user with no `identityId` set — this includes the sibling account at the *other* school, which was `collision_pending` and therefore has no `identityId` (confirmed: the collision branch deliberately leaves `users.identityId` unset). When the boot cursor reaches that sibling, it now finds a vouching `memberships` doc (the one just created) and merges — via `Identities.findOneAndUpdate({id: existingIdentityId}, {$addToSet:{sourceUserIds}, $set:{updatedAt}}, {upsert:true})`.
- **Critically: this upsert targets an already-existing identity document** (matched by `id`), so its `$setOnInsert` block — which is the only place `passwordHash`/`mfaEnabled` are ever written from `user.password`/`_mfaTriState(user)` — **does not fire** (Mongo only applies `$setOnInsert` fields on a genuine insert, never on a match against an existing document). The sibling's own password is **never adopted**, silently. The identity's password stays whatever it already was, from whenever the *original* singleton identity was first created.

**Precise, evidenced conclusion**: it is not "random" — it is **"whichever of a person's accounts had its identity provisioned first, chronologically, wins permanently, and every later-linked account's original password is silently discarded from org-login's perspective."** The discarded account's holder gets no forced password reset, no notification, and no visible indicator anywhere in the product that their School-B password no longer "counts" for org-login. They would only discover this by attempting org-login and having their School-B password rejected — indistinguishable, from their point of view, from having mistyped it.

### 3.5 What happens after password reset

Admin-triggered `POST /users/:id/reset-password` is the **one clean, unambiguous synchronization event** in this architecture: it does not compare or verify an old password (it is an overwrite, not a change), so there is no ambiguity about "which one wins" — the new password becomes canonical everywhere the dual-write reaches, deterministically, by design. This is worth stating as a positive finding, not just gaps: admin-initiated resets do not inherit any of §3.4's ambiguity.

### 3.6 Race conditions

Checked concretely, not asserted:

- **The dual-write itself** is two independent `updateOne` calls (`users` then `identities`), not wrapped in a transaction. If two different password-change requests for the same identity land on different server processes at nearly the same moment (extremely rare in practice — same person, two devices, simultaneous password changes), the two `identities.updateOne` calls race at the database level; MongoDB resolves this via last-write-wins on the document, no corruption, but the "losing" request's `users.password` (already committed at that point, since it's written *before* the identity update in each route's own sequence) would be a real password whose corresponding identity write got overwritten by the other request's — meaning that user's own most-recent change might not be reflected in the shared identity, until they change it again. **Narrow window, no data corruption, correctness impact bounded to "occasionally the shared password reflects the other of two near-simultaneous changes, not a stale or invalid one."**
- **`provisionIdentityForUser`'s read-then-decide-then-write sequence** (read siblings → determine vouched set → upsert) is not transactional either. Two concurrent provisioning calls for accounts that should merge into the same identity could theoretically both decide "no existing identityId among current siblings" before either writes — but since both ultimately upsert against the same deterministic key (`{orgId, email}` for the no-existing-identity case, or `{id: existingIdentityId}` when one is known), Mongo's `upsert:true` still resolves to a single document; the practical risk is a redundant/idempotent second write, not two divergent identities being created for the same person. **No confirmed correctness violation found; a formal document-level lock is not present, and this has not been load-tested — stated as a theoretical gap, not a proven bug.**

### 3.7 Can a user accidentally lock themselves out?

**No — not entirely, and this is a genuine positive finding, not a gap.** Because `SecurityService.checkAccountLock`'s key is `fail:${schoolId}:${loginId}` (`securityService.js:37`) and org-login passes `org.id` in the `schoolId` parameter slot, **a lockout accumulated on one path does not affect the other.** A person who fails org-login five times has an org-scoped lockout only; her direct `/login` at either individual school remains fully usable, and vice versa. The inverse framing the reviewer should also be aware of: **this means an attacker locked out on one path gets a fresh attempt budget on the other** — same underlying account, two independent counters. This is the flip side of the same fact: good for accidental self-lockout, worth naming as a rate-limiting gap for a determined attacker (see §6.2).

---

## 4. Migration impact

**Direct answer: no, this cannot have affected any organization "already using the feature," because the feature could not previously be used by anyone with `IDENTITY_CUTOVER_ENABLED` unset.**

Reasoning, from the code, not inference about intent: prior to this fix, `org-login`'s gate was `!org?.multiSchoolEnabled || !isIdentityCutoverEnabled()`. Since no default value or any code path in this repository sets `IDENTITY_CUTOVER_ENABLED=true` (it is read exclusively from `process.env`, an operator-set deployment variable, confirmed absent from `.env.example`/any committed config — grepped, not found), **every organization with `multiSchoolEnabled:true` and this env var unset was already 100% blocked from org-login before this fix**, identically to Trinity-Trinitas. There is no prior "working" state this change could have regressed for org-login specifically.

**What this change does NOT touch, confirmed by scope of the diff**: `IDENTITY_CUTOVER_ENABLED`'s effect on `/login`, `/change-password`, and `PUT /settings` (§1) is completely unmodified — any organization or school currently relying on cutover-on behavior for those three routes (if any exist in production — unverifiable from this sandbox, no live DB access) is unaffected, because those three call sites were not touched.

**Is any migration required?** No data migration, no backfill, no schema change. This was a single conditional expression removed from one route. Existing `identities` documents, `users.identityId` values, and `memberships` records are all read exactly as before.

---

## 5. Audit logging — org-login vs school login

Grepped every `AuditService.log` call in `auth.js`. There are exactly three:

| Action | Fired by | Fields |
|---|---|---|
| `auth.login` | `/login` success (line 440) | `actor:{userId,role,email}`, `schoolId`, `req` (IP/UA captured by `AuditService.log` internally via `req`) |
| `auth.login` | `_completeOrgLoginSession` success — reached by both org-login's 1-eligible fast path and complete-org-login's picker redemption (line 1658) | Identical fields **plus** `details:{via:'org_login'}` |
| `auth.school_switch` | `POST /switch-school` (line 1380) | `actor`, `schoolId` (target), `target:{type:'school',id,label}`, `details:{fromSchoolId}` |

**Confirmed identical where it should be**: both successful login paths log the *same action name* (`auth.login`), so any downstream audit query/report filtering on `action:'auth.login'` sees both without needing to know two routes exist — this is correct design, and org-login's `via:'org_login'` tag is a real, useful enrichment, not a divergence, since it lets an operator distinguish origin without changing the event taxonomy.

**A gap that exists identically in both paths, not introduced by org-login**: **neither `/login` nor `/org-login` writes an audit event on a *failed* login attempt.** Failures only reach `SecurityService.recordFail()`, which writes to a separate `login_failures` collection (used solely for lockout math, not queryable via `GET /api/audit`). This means the `audit_logs` collection contains no record of failed authentication attempts at all — confirmed by reading every failure branch in both routes; none call `AuditService.log`. **This is a pre-existing, platform-wide gap, not something org-login made worse** — but it directly bears on the reviewer's "log both successful and blocked actions" principle from the audit mandate, and is worth surfacing here rather than treating as out of scope because it predates this fix.

`complete-org-login`'s own 403 branches (outside-allowlist, TOCTOU re-parent, deactivated user) also do not call `AuditService.log` — same gap, same severity class as above, not new.

---

## 6. QA coverage — automated vs what could not be verified here

### 6.1 A concrete gap found while building this comparison, not previously reported

`orgLoginLimiter` (`auth.js`, defined immediately above `POST /org-login`) has **no `keyGenerator`**, so `express-rate-limit` defaults to `req.ip`. `loginIpLimiter` (single-school `/login`) explicitly sets `keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip`. If this platform runs behind Cloudflare in production (the naming convention `cf-connecting-ip` throughout the codebase strongly implies it does, though this sandbox cannot confirm live infrastructure), **`orgLoginLimiter` is rate-limiting by Cloudflare's edge-node IP, not the real client IP** — every request through that edge node shares one bucket. Depending on Cloudflare's edge topology this either (a) causes unrelated legitimate users behind the same edge to trip each other's rate limit, or (b) is simply ineffective as a per-client throttle. **This is a real, previously-undocumented finding from this review, not part of the original bug fix, and not yet corrected** — flagged here per the "no implementation" instruction, not fixed.

### 6.2 Rate-limiting/lockout gap, restated precisely from §3.7

An attacker who exhausts `SecurityService`'s account-lock threshold via `/login` still has a fresh, independent attempt budget via `org-login` for the same underlying account (and vice versa), because the two paths key the lockout differently (`schoolId` vs `org.id`). This does not defeat bcrypt or leak credentials, but it does mean the platform's *effective* brute-force budget for one person's password is roughly double what either counter alone suggests, if the org-login surface is reachable for their organization.

### 6.3 Test matrix — what the automated suite (`auth-org-login.test.js`, 22 tests) actually proves, evidenced by reading every test, not summarized from memory

| Scenario | Automated coverage | Notes |
|---|---|---|
| Single-school user, correct password, no MFA | ✅ `exactly one eligible school, no MFA: mints a session directly and sets the cookie` | Asserts cookie set, correct user/school in response |
| Single-school user, MFA enabled | ✅ `exactly one eligible school, MFA required: no cookie set, response mirrors /login's mfaRequired shape plus schoolSlug` | Asserts no cookie, correct `mfaRequired` shape |
| Two-school user, picker flow | ✅ `2+ eligible schools: returns a picker code and school list, mints nothing` + `happy path: valid pick, no MFA` | Full round-trip covered |
| Wrong password | ✅ Part of the `LOAD-BEARING` enumeration test — proven byte-identical to no-identity and collision_pending | |
| Locked account | ✅ `429s when the account is locked out` | Mocks `SecurityService.checkAccountLock` directly |
| Disabled school (school-level `isActive:false`) | ⚠️ **Not directly tested in this file** — but `_resolveIdentitySchools` (the shared resolver) has its own dedicated coverage per the code comment citing "found live (real-DB production validation)" — that validation happened in an earlier session phase with a real MongoDB instance, not this sandbox. Not re-verified here. | |
| Disabled organization | ❌ **Cannot be tested — the concept does not exist.** Grepped the entire codebase for `organizations.isActive` or any suspend mechanism on organizations; none exists. Only individual schools can be disabled. This is a genuine platform gap worth the reviewer's attention independent of org-login: **there is currently no way to suspend an organization's access as a unit**, only school-by-school. | |
| MFA enabled / disabled | ✅ Both branches directly tested (see above) | |
| Password reset | ❌ Not covered by `auth-org-login.test.js` (out of that file's scope — password-reset dual-write is covered by `settings-password-paths.test.js`/`auth-password-paths.test.js`, which test the write side, not org-login's subsequent read of the result) | No test directly proves "reset a password, then org-login with the new one" end-to-end |
| Different browsers | ❌ **Cannot be verified in this sandbox** — no live browser matrix exists for this session; would require manual QA or an E2E suite this repo does not currently have for auth flows | |
| Expired session | ⚠️ Session/JWT expiry is a generic `authMiddleware` concern applying identically regardless of login path (confirmed: `authMiddleware` reads only the JWT's own `exp`/`itv`/`tv` claims, with no branch distinguishing how the session was created) — covered by existing `middleware/auth`-focused tests, not specific to org-login, not re-verified here | |
| School switching after org-login | ⚠️ Not tested end-to-end starting from an org-login-created session specifically — but §2.6 traces the code path showing `switch-school` cannot distinguish session origin, and `switch-school` has its own dedicated test file (`auth-switch-school.test.js`) exercising the same resolver org-login uses | Reasoned from code, not run live |

**Honest summary of this section**: the automated suite is strong on the security-critical boundary checks (allowlist enforcement, TOCTOU, single-use codes, lockout, enumeration-resistance) — these are exactly the properties a unit/integration test can prove deterministically. It is, correctly, silent on cross-browser behavior, real-database disabled-school validation, and true concurrent-request race conditions, because those require infrastructure (a live browser matrix, a real MongoDB replica set under load) this sandbox does not have. That gap should be closed by manual/staging verification before broader rollout, not assumed covered by "611 tests passing."

---

## 7. Complete authentication error matrix

Built from reading every response branch in `/login`, `/verify-otp`, `/org-login`, and `/complete-org-login` directly — not reconstructed from memory.

| Internal condition | Route | HTTP | Body | User-facing message | Security justification |
|---|---|---|---|---|---|
| Missing email/password | `/login` | 400 | `{error}` | "Email or admission number and password required" | Input validation, no enumeration risk (pre-lookup) |
| Missing orgSlug/email/password | `/org-login` | 400 | `{error}` | "orgSlug, email, and password are required" | Same |
| IP rate limit exceeded | `/login` | 429 (via middleware) | `{error}` | "Too many requests from this network. Please try again in 15 minutes." | Volumetric abuse throttle |
| IP rate limit exceeded | `/org-login` | 429 (via middleware) | `{error}` | "Too many login attempts. Please try again in 15 minutes." | Same purpose, **weaker key — §6.1** |
| Account locked (progressive) | `/login` | 429 | `{error, retryAfter}` | "Too many failed login attempts. Please wait before trying again." | Per-account brute-force defense |
| Account locked (progressive) | `/org-login` | 429 | `{error, retryAfter}` | Identical text | Same mechanism, **independent counter — §3.7** |
| Org slug matches nothing | `/org-login` | 404 | `{error}` | `Portal '{slug}' not found` | No existence leakage — same shape as next row |
| Org exists, `multiSchoolEnabled:false` | `/org-login` | 404 | `{error}` | Identical shape/text to above | Deliberately indistinguishable from "doesn't exist" |
| User not found (single-school) | `/login` | 401 | `{error}` | "Invalid email or password" | Standard generic-failure posture |
| No identity for email in org | `/org-login` | 401 | `{error}` | "Invalid email or password" | Proven byte-identical to next two rows (dedicated test) |
| Identity exists but `collision_pending` | `/org-login` | 401 | `{error}` | Identical | Closes an enumeration side-channel a distinct message would open |
| Wrong password | both | 401 | `{error}` | "Invalid email or password" (`/org-login`) / same (`/login`) | Generic, standard |
| Account inactive, school pending approval | `/login` | 403 | `{error:'pending_approval', message}` | "Your school is currently under review..." | **Not** generic — deliberately informative (school-level state, not a credential signal) |
| Account inactive, school rejected | `/login` | 403 | `{error:'rejected', message}` | "Your school registration was not approved..." | Same reasoning |
| Account inactive, other | `/login` | 403 | `{error}` | "Account inactive. Please contact your school administrator." | Same reasoning |
| Identity resolves, but zero eligible schools in this org | `/org-login` | 403 | `{error}` | "No school access found for this account in this organization." | Distinguishable from wrong-password *after* successful auth — reasonable, since credential correctness has already been proven at this point, so there's no enumeration value left to protect |
| Password expired (first login / 90-day) | `/login` | 200 | `{passwordExpired:true, reason, userId, schoolId, hint}` | Reason-specific hint text | Not an error status — a soft redirect to force-change, by design |
| MFA required | `/login` | 200 | `{mfaRequired:true, userId, schoolId, hint}` | "A 6-digit code has been sent to j***e@..." (masked) | Not an error status; email partially masked in the hint itself |
| MFA required | org-login paths | 200 | `{mfaRequired:true, userId, schoolId, schoolSlug, hint}` | Identical masking | Same posture, `schoolSlug` addition is functional (header-priming), not a security relaxation |
| No pending OTP | `/verify-otp` | 400 | `{error}` | "No pending OTP. Please sign in again." | |
| OTP expired | `/verify-otp` | 400 | `{error}` | "Code expired. Please sign in again to get a new code." | |
| OTP incorrect | `/verify-otp` | 401 | `{error}` | "Incorrect code. Please check your email and try again." | Timing-safe comparison used |
| Picker code missing/unknown/expired | `/complete-org-login` | 400 | `{error}` | "code and schoolId are required" / "This selection has expired. Please sign in again." | Not 403 — this is a UX-flow error, not an authorization decision |
| Picker `schoolId` outside locked allowlist | `/complete-org-login` | 403 | `{error}` | "That school is not available for this account." | **Load-bearing security boundary**, not enumerable — same message whether the school exists elsewhere or not |
| Picker target re-parented to a different org (TOCTOU) | `/complete-org-login` | 403 | `{error}` | Identical to above | Closes the timing window without a distinct message |
| Picker target user deactivated since org-login | `/complete-org-login` | 403 | `{error}` | Identical to above | Same reasoning |
| Server/unexpected error | all routes | 500 | `{error}` | Generic ("Login failed" / "Failed to fetch account" etc.) | No stack traces or internals ever returned to the client (confirmed — every catch block logs server-side via `console.error` and returns a fixed string) |

**On the reviewer's specific concern about "Portal not found" sounding like a routing problem**: this table shows the message is applied consistently and deliberately — as a **byte-identical, no-leakage 404** whenever the *org itself* cannot be reached, exactly mirroring how `resolve-portal` (the page-render check) already behaves. The confusion in the original incident was not that the message was wrong for what it represented — it correctly represents "this org-login surface is not currently reachable." The actual defect (now fixed) was that the surface was rendering as reachable (a working-looking login page) while the *credential-check route behind it* was not, for a reason invisible to anyone outside platform operations. The message itself remains appropriate for its literal condition; the bug was the condition existing in a state indistinguishable from broken to the customer.

---

## 8. Final assessment — is Organization Authentication production-ready?

Answering the reviewer's direct question honestly, as an external review would, not as agreement-seeking.

**Would I approve this for production onboarding of more schools without reservations? No.** Not because the fix in this session was wrong — the evidence above supports it was correct and narrowly scoped — but because this review surfaced several items that were true *before* this fix and remain true *after* it, which a platform handling real student/financial records should not carry into wider rollout unexamined.

### Prioritized weaknesses (not fixed here, per instruction)

**High risk — should be resolved before onboarding organizations at meaningful scale:**

1. **Password-merge tie-break has no deterministic notification path (§3.4).** A real person can have a password that silently stops working on org-login, with zero indication why, and no reset flow triggered automatically. This is a support-burden and trust risk, not just a technical gap — a parent or teacher locked out with no explanation will assume the platform is broken.
2. **No audit trail for failed authentication attempts, on either path (§5).** For a platform holding academic and financial records, the inability to answer "who tried to log in as this person and failed, and when" from the audit log (as opposed to the lockout-only `login_failures` collection) is a real investigative gap if an account compromise is ever suspected.
3. **Organizations have no disable/suspend mechanism at all (§6.3).** Only individual schools can be deactivated. If a customer relationship ends at the organization level, there is currently no single action that revokes org-wide access — an operator would have to remember to disable every school under it individually, and the org-login surface itself has no corresponding "off" switch beyond `multiSchoolEnabled`.

**Medium risk — worth fixing soon, lower urgency:**

4. **`orgLoginLimiter` is not Cloudflare-aware (§6.1)**, unlike its sibling `loginIpLimiter`. Likely reduces the effectiveness of IP-based throttling on this specific route in production if the platform sits behind Cloudflare, as its own code conventions suggest it does.
5. **Independent lockout counters across `/login` and `/org-login` for the same account (§3.7, §6.2)** effectively double the brute-force attempt budget for any account reachable via both paths.
6. **`mfaEnabled` divergence between per-school and shared-identity values is possible at account-creation time and never reconciled (§2.5).** Narrow precondition, but currently invisible and unmonitored.

**Low risk — worth tracking, not urgent:**

7. **Dual-write and identity-provisioning are not transactional (§3.6).** No confirmed correctness violation, but no formal guarantee either, under genuine concurrent load this platform has not yet been tested against.
8. **Manual/cross-browser/live-database verification of several scenarios (disabled school under real Mongo, true concurrent password changes, end-to-end password-reset-then-org-login) has not been performed in this sandbox (§6.3)** — the automated suite is strong where it can be, but does not substitute for that verification before scaling up organization count.

### What is genuinely solid, and should not be re-litigated

The security-critical boundary logic — picker-allowlist enforcement, the TOCTOU re-parent check, single-use code redemption, the enumeration-resistant identical-response design across not-found/collision/wrong-password, and the session/token/cookie mechanics themselves — is well-designed, deliberately reasoned in its own code comments (not just happened-upon), and has targeted, load-bearing test coverage proving the specific properties that matter (not just "does it return 200"). The fix reviewed here removed a non-technical circuit breaker after confirming, not assuming, that the mechanism it duplicated was already unconditional. That is a defensible, narrowly-scoped change — the broader subsystem it sits inside has more work ahead of it before "production-ready without reservations" is the honest answer.
