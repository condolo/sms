# PLAT-01 — Platform Impersonation Lifecycle Audit — 2026-09-01

Investigation only, as instructed. **No application code was changed to produce
this document.** Every claim below is cited to a specific file:line, or was
confirmed by reading the actual code path end to end — never assumed from a
comment or a variable name alone.

The question this audit actually answers: *what exact power does Msingi retain
over a school's tenant, who can exercise it, how is it granted, how long does
it last, can it be abused, and can the school see that it happened?*

---

## 1. The mechanism, end to end

Three separate credential layers are involved, not one:

| Layer | Cookie | Signed with | Lifetime | Tracked in `sessions`? |
|---|---|---|---|---|
| Platform operator login | `platform_token` | `PLATFORM_JWT_SECRET` | 2h, fixed | No |
| Impersonated school session | `token` | `JWT_SECRET` (same secret every real school login uses) | 8h, fixed | **No** |
| A real school user's own login | `token` | `JWT_SECRET` | 8h, fixed | Yes |

The last row is the important contrast: a genuine login goes through
`SessionService.createSession()` and gets `sessionId` + `absoluteExpiry` baked
into the token ([auth.js:475-502](server/routes/auth.js:475)). **Impersonation does not.**

### 1a. Who can even attempt it

`POST /schools/:id/impersonate` sits behind `router.use(platformSession)`
([platform.js:175](server/routes/platform.js:175)), then a router-level gate that lets `GET`
requests through for any operator but requires owner tier for everything else
([platform.js:184-187](server/routes/platform.js:184)):

```js
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  return requireOwnerTier(req, res, next);
});
```

Since impersonate is a `POST`, only **owner-tier** operators can reach it —
`support`-tier operators are correctly blocked (`requireOwnerTier`,
[auth.js:143-146](server/middleware/auth.js:143)). This matches the comment's own stated
intent and I confirmed it's real, not just asserted.

### 1b. How an operator identity is created in the first place

There is **no API route** for creating, listing, or deactivating
`platform_operators` — confirmed by grep, zero route registrations reference
that collection anywhere except the login check. The only way to create or
retier one is `scripts/create-platform-operator.js`, run by someone with
direct database/deploy access ([create-platform-operator.js:1-134](scripts/create-platform-operator.js:1)).
Deactivation works (`isActive: false` blocks login,
[platform.js:150](server/routes/platform.js:150)) but nothing in the app or the script sets
that flag — it would need a manual database write. This is a real operational
gap, not a security hole per se: expanding *or* revoking who holds this power
already requires the same infrastructure access either way.

### 1c. The impersonate route itself

[platform.js:1300-1420](server/routes/platform.js:1300), in order:

1. Gated off entirely in production unless `ALLOW_IMPERSONATION=true` is
   explicitly set ([platform.js:1302](server/routes/platform.js:1302)).
2. Requires a non-empty `reason` in the body, 400s otherwise
   ([platform.js:1313-1316](server/routes/platform.js:1313)).
3. Resolves the school, then looks up a user matching
   **`{ role: 'superadmin', ... }`** for that school — never an arbitrary role,
   never an arbitrary user picked by ID ([platform.js:1335-1342](server/routes/platform.js:1335)).
4. Builds a token via `auth.js`'s own `_buildTokenPayload()` — the identical
   function a real login uses — then adds `impersonated: true` and a fresh
   `impersonationId` ([platform.js:1356-1371](server/routes/platform.js:1356)).
5. Logs `platform.impersonate` via `AuditService`, with the reason and
   `impersonationId` attached ([platform.js:1375](server/routes/platform.js:1375)).
6. Sets the token as the normal `token` cookie — the exact cookie a real
   school login uses ([platform.js:1378-1383](server/routes/platform.js:1378)).

**What it never calls:** `SessionService.createSession()`. No `sessionId`. No
`absoluteExpiry` field. The 8-hour cap still applies, but only because
`sign()`'s *default* `expiresIn` is 8h ([jwt.js:27-32](server/utils/jwt.js:27)) — enforced purely by
the JWT library's own `exp` claim, completely outside the app's own
session-tracking and revocation apparatus.

---

## 2. Direct answers to the 12 questions

**1. Exactly which platform roles/users can initiate impersonation?**
Only owner-tier `platform_operators`, or the legacy shared credential (which
is always treated as owner tier — [auth.js:128](server/middleware/auth.js:128)). Support tier is
correctly blocked. Confirmed via the router-level gate, not just the
route's own comment.

**2. Is access tenant-specific or can it cross tenants?**
Not tenant-specific at all. Any owner-tier operator can impersonate **any**
school by ID — `platform_operators` has no per-operator school assignment
field ([create-platform-operator.js:122-125](scripts/create-platform-operator.js:122)). One owner-tier
credential = every school on the platform.

**3. Can the target user's role be selected arbitrarily?**
No. The lookup is hardcoded to `role: 'superadmin'` for the target school —
the operator cannot pick a different role or a specific named user
([platform.js:1335](server/routes/platform.js:1335)).

**4. Can impersonation be initiated without the target school/user knowing?**
**Yes.** `platform.impersonate` is in `ALERT_ACTIONS` and fires a webhook
([audit.js:42-46](server/services/audit.js:42), [audit.js:248-250](server/services/audit.js:248)) — but that
webhook is one platform-configured URL (`ALERT_WEBHOOK_URL`), Msingi's own
internal channel, not a per-school notification. **`ALERT_WEBHOOK_URL` is not
declared anywhere in `render.yaml`** — I can't confirm from source whether
it's set manually in the live Render environment, but nothing in the
version-controlled config sets it. No email, no in-app banner, nothing pushed
to the school. The event *is* correctly written under the target school's own
`schoolId` ([platform.js:1375](server/routes/platform.js:1375)), so a school admin who thinks to
check Settings → Audit Log will find it — but nothing prompts them to look.

**5. Maximum session lifetime, and can it be extended?**
8 hours, same default as every session (`ABSOLUTE_TIMEOUT_MS`,
[jwt.js:27](server/utils/jwt.js:27)). Cannot be extended — confirmed structurally:
`/auth/ping`'s own comment states it "Never issues a new JWT — the 8-hour
token stays valid throughout" ([auth.js:771-775](server/routes/auth.js:771)), and this applies
identically to impersonated tokens since they're signed the same way.

**6. Does impersonation survive logout / token refresh?**
Logout clears the browser cookie ([auth.js:806-811](server/routes/auth.js:806)) but has no
server-side session record to terminate for an impersonated token (no
`sessionId` was ever created). If a copy of the JWT existed outside the
browser (a proxy log, a captured request), it would remain valid until its
natural 8-hour expiry regardless of the "logout" click. `/auth/ping`'s
near-real-time revocation check is also silently skipped for impersonated
sessions, since it's gated on `if (sessionId)` and none exists
([auth.js:787-796](server/routes/auth.js:787)).

**7. Can the impersonated session change permissions, create admins, access
HR/payroll/finance, download documents, or modify global settings?**
**Yes, unconditionally, to all of it.** The target is always `role:
'superadmin'`, and `rbac.js`'s `_isSuperRole()` check treats the literal
string `'superadmin'` as a full bypass of every permission check
(`SUPERROLES`, confirmed in the Role Architecture Audit). There is no
narrower "impersonation scope" — it's the real account's full access, in
full.

**8. Is every action attributable to both identities across representative
modules?**
Confirmed for HR, Finance, and Settings/Roles & Permissions: every
`AuditService.log()` call I checked in those three files passes
`actor: req.jwtUser` (11 calls in hr.js/finance.js, 17 in settings.js, zero
exceptions found). Since `AuditService.log()` reads `actor?.impersonated` /
`actor?.impersonationId` generically off whatever's passed
([audit.js:220-233](server/services/audit.js:220)), this propagates correctly wherever the
convention is followed. I did not read all ~50+ call sites individually —
these three were chosen because they're exactly the "sensitive" modules the
question named.

**9. Can impersonation be chained or nested?**
Direct chaining: yes, trivially — the route doesn't check for an existing
impersonated session at all (no `authMiddleware` on it), so an operator can
call it repeatedly for different schools within their 2-hour platform
session; each call simply overwrites the same `token` cookie, no real
stacking. **A separate, currently-dormant path is more concerning**:
`switch-school` ([auth.js:1321-1423](server/routes/auth.js:1321)) mints a *fresh* token via
`_buildTokenPayload()` that does **not** carry forward `impersonated`/
`impersonationId` from the session that called it. Today this is inert for
every organization — the route fails closed unless the org has
`multiSchoolEnabled`, and the code's own comment confirms "currently all of
them" haven't opted in. But the moment multi-school is turned on for an org
whose admin is impersonated, switching to a sibling school in that org would
silently **drop** the impersonation attribution on the new token. Flagging
this now, before it's live, is cheaper than finding it after.

**10. Is there a reliable way to revoke an active impersonation session?**
**No.** This is the sharpest gap. No `sessionId` means the near-real-time
revocation path (`SessionService.refreshSession`) never runs for it. No
`tv`-based purpose-built kill switch exists either — though `_buildTokenPayload`
does set `tv` from the *impersonated user's own* `tokenVersion`
([auth.js](server/routes/auth.js)), so bumping that specific admin's token version (e.g.
via `revokeUserTokens`) would end the session as a side effect — but nothing
gives a platform operator, or the school, a direct "end this impersonation
now" button. It runs its full 8 hours unless something incidental happens to
revoke the underlying account.

**11. Can the school see/review impersonation activity?**
Yes, if they look. `/api/audit` is correctly school-scoped to
`req.jwtUser.schoolId` ([audit.js:40-46](server/routes/audit.js:40)), and the impersonate
event is written under the *target* school's `schoolId`
([platform.js:1375](server/routes/platform.js:1375)) — not hidden in a platform-only store. It
carries `severity: 'critical'` ([audit.js:183](server/services/audit.js:183)). I did not
verify the client-side Audit Log page renders a platform-operator actor
(`platform_owner`/`platform_support`, not a normal school user) legibly rather
than as "Unknown user" — worth a quick UI check before relying on this.

**12. Is the platform operator's own access separately audited?**
Yes — `platform.login.success` / `platform.login.failed` are logged for both
the named-operator and legacy-credential paths
([platform.js:141-165](server/routes/platform.js:141)), with `req` passed through for IP/UA
capture.

---

## 3. One more finding, found while tracing the actual UI path

`platform.html` — the real console operators use — has a confirmation dialog
for impersonation ([platform.html:1164-1173](platform.html:1164)) but its `doImpersonate()`
function calls `api('POST', '/schools/${schoolId}/impersonate')` with **no
third argument** — no body, no reason ([platform.html:1175-1178](platform.html:1178)). The
`api()` helper *does* support a body (used correctly two hundred lines away
for the reject-school reason, [platform.html:512-526](platform.html:512)) — it was
just never wired up for impersonate. Since the server requires a non-empty
`reason` and 400s without one ([platform.js:1313-1316](server/routes/platform.js:1313)), **every
impersonation attempt through the actual admin console today fails with a 400.**
The reason requirement (PLAT-02) is correctly enforced at the API and fully
tested there ([platform-impersonate.test.js](server/__tests__/routes/platform-impersonate.test.js)) — but the one UI that's
supposed to drive it was never updated to collect and send it. Either
impersonation is currently unusable through the intended path, or operators
have found another way to call the API directly, which would itself be worth
knowing.

---

## 4. The minimum control framework, applied

The standard you named — explicit authorization + limited scope + time limit
+ auditability + revocation — against what's actually implemented:

| Control | Status |
|---|---|
| Explicit authorization (reason required) | ✅ Enforced server-side — ⚠️ but unreachable via the actual console UI (§3) |
| Limited scope (can't pick an arbitrary target/role) | ✅ Always exactly the school's own superadmin, nothing narrower and nothing broader |
| Time limit | ⚠️ Present (8h, same as any session) but **not separately bounded** — no shorter default for impersonation specifically, and see revocation below |
| Auditability | ✅ Strong — reason, correlationId-style `impersonationId`, critical severity, propagates across every audited action taken during the session, confirmed in 3 representative modules |
| Revocation | ❌ **Absent.** No session record, no kill switch, no exit-impersonation UI anywhere in the client. Runs its full term or nothing. |
| School notification | ❌ Absent by design today — visible only if the school proactively checks their own Audit Log |

Four of five are real and load-bearing. Revocation is the one that isn't —
and it's the one every "can this be abused" conversation with a school will
eventually land on.

---

## 5. Recommended remediation — not implemented, for your decision

In rough priority order, each independently shippable:

1. **Fix the platform.html reason bug** — this is currently blocking the
   feature from working as designed at all; lowest-risk, highest-certainty
   fix in this list.
2. **Give impersonation a real session record** — call
   `SessionService.createSession()` the same way every other login path does,
   so it gets `sessionId`/`absoluteExpiry` and becomes visible to whatever
   session-management tooling already exists for normal accounts.
3. **A real revocation control** — the cheapest version is exposing "end this
   impersonation" as an explicit action (either the school itself, from their
   own Audit Log entry, or the platform console) that bumps the impersonated
   admin's `tokenVersion` — reusing the existing `revokeUserTokens` mechanism
   rather than inventing a new one.
4. **Shorter default lifetime for impersonation specifically** — 8h matches a
   normal workday session; a support investigation rarely needs that long,
   and a shorter cap reduces the exposure window for free.
5. **Carry `impersonated`/`impersonationId` through `switch-school`** — cheap
   now, before multi-school is live for any org; expensive to remember later.
6. **Some proactive signal to the school** — even a passive one (a banner
   next time the real admin logs in: "Your account was accessed by Msingi
   support on [date] — see Audit Log") would close most of the "can it happen
   without us knowing" concern without needing real-time alerting infrastructure.
7. **A minimal operator-management surface** — even a read-only "list active
   operators + their tier + last login" view would make "who currently holds
   this power" answerable without a database query.

No code changes made. Ready for your call on which of these to act on, and in
what order.

---

## 6. Remediation implemented (2026-09-01)

Reviewer's order, executed in full. Nothing in §5's "not implemented, for
your decision" list is deferred except item 7 (operator-management surface —
out of scope, not requested) and dual-control approval (explicitly deferred
by the reviewer for a future decision).

### What changed

1. **Tracked impersonation sessions, reusing `SessionService`** — no second
   session mechanism. `SessionService.createImpersonationSession()` /
   `getImpersonationSession()` / `revokeImpersonationSession()`
   (`server/services/sessionService.js`) extend the existing `sessions`
   collection with `impersonation: true`, `impersonatedBy`, `reason`. A
   grant is now a real, queryable, revocable row — `sessionId` doubles as
   `impersonationId`, no more disconnected bare uuid.
2. **Shorter lifetime, enforced server-side** — `IMPERSONATION_TIMEOUT_MS`
   (`server/routes/platform.js`), default 60 minutes, env-overridable,
   independent of the normal 8h `ABSOLUTE_TIMEOUT_MS`. Enforced three ways:
   the session's own `absoluteExpiry`, the JWT's `exp` claim, and the cookie
   `maxAge` all shortened to match.
3. **Real-time revocation** — `authMiddleware` (`server/middleware/auth.js`)
   now checks live session status on *every request* for any token carrying
   `impersonated:true`, not just at `/auth/ping`. Deliberately does not
   reuse the per-userId `tv` mechanism, which would also log out the real
   admin's own concurrent session. Two independent revoke routes, matching
   the two different callers/authorization questions: platform-operator side
   (`POST /api/platform/impersonation-sessions/:sessionId/revoke`, any
   owner-tier operator) and school-admin side
   (`POST /api/settings/impersonation/:sessionId/revoke`, strictly scoped to
   the caller's own `schoolId` — an unknown id and a cross-school id return
   an identical 404, proven by a mutation-tested test).
4. **`platform.html`'s broken reason bug fixed** — `confirmImpersonate()` now
   collects a required reason via a textarea; `doImpersonate()` validates it
   client-side and sends it in the POST body (was silently never sent at
   all before this).
5. **Full lifecycle audited** — grant (`platform.impersonate`), every denied
   attempt against an ended session (`platform.impersonate_denied`, logged
   from inside `authMiddleware` itself), and revoke
   (`platform.impersonate_revoked`) are all logged via the existing
   `AuditService`, all correlated by the same `impersonationId`.
6. **School notification, reusing the existing notify-dispatch system** —
   no parallel mechanism. New `platform_impersonation` event in
   `server/utils/notif-settings.js`'s `EVENT_REGISTRY` (`alwaysOn: true` —
   same class of event as `role_changed`/`password_expiry`; a school cannot
   silence it), dispatched via the existing `dispatchNotification()`,
   in-app + `email.sendImpersonationNotice()`.
7. **`switch-school` blocked outright for impersonated sessions** — chosen
   over "preserve impersonation context through the switch," per the
   reviewer's own stated lean. `switch-school` mints a fresh token via the
   same `_buildTokenPayload()` impersonation itself uses, which would
   silently drop attribution; blocking is a one-line, unambiguous invariant
   instead of duplicating impersonation-session machinery in a second code
   path. Currently inert (no organization has `multiSchoolEnabled` yet) but
   cheap to close now rather than risk forgetting later.

### What was proven

- **The reviewer's exact acceptance test, run for real, not simulated**:
  "platform operator starts impersonation → access works → impersonation is
  revoked → the token/session immediately stops working" —
  `server/__tests__/plat01-impersonation-e2e.test.js` exercises the real
  `authMiddleware`, real `SessionService`, real `sign()`/`verify()` (only the
  DB layer is faked) through the complete grant → access → audit →
  notification → revoke → denied-access cycle, in one test.
- Every load-bearing control was mutation-tested (deliberately broken,
  confirmed the right test failed for the right reason, restored, confirmed
  green again): the `authMiddleware` revocation check, the school-side
  revoke route's cross-school scoping, the `switch-school` block, and the
  E2E lifecycle test itself.
- Full server suite: **1718/1718 tests passing** (183 suites, up from
  1716/1716 pre-remediation).
- `scripts/verify-tenant-coverage.js`: held at 35 (no new unprotected tenant
  access introduced).
- `scripts/verify-rbac-coverage.js`: 100.00% (481/481 endpoints), no
  regression.
- `scripts/security-scan.js`: clean.
- `platform_impersonation` is genuinely un-silenceable — a dedicated test
  saves an explicit `{email:false, inApp:false}` school setting and confirms
  `isEnabled()` still returns `true` for both channels.

### What remains unverified

- **No live production verification of the grant→revoke lifecycle.** This
  environment has no platform-operator credentials for the deployed site
  (unlike the RBAC batch, where the site's own demo *school* credentials
  were usable for live smoke-testing). Everything above is proven at the
  code/test level — real middleware, real session service, real JWT
  signing/verification, against a faked DB only — not against the actual
  production database and deployed process.
- **Email delivery itself was not exercised.** `sendImpersonationNotice()`
  is proven to be *called* with the right arguments; whether the configured
  email provider actually delivers it in production is outside what this
  batch could verify.
- **Dual-control approval was explicitly not implemented**, per the
  reviewer's own instruction — not a gap, a deliberate deferral.
- **The `switch-school` block is currently untested in a live multi-school
  org** because no organization has `multiSchoolEnabled` today; the
  invariant is unit-tested (mutation-tested, in fact) but has never fired
  against a real impersonated multi-school session in production, because
  that scenario doesn't yet exist anywhere to test against.
