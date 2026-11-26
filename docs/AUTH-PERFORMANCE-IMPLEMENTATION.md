# Authentication latency and one-time-code correctness

This document records the auth implementation and the fixes applied after code review on 2026-11-26. It is the implementation reference for deployment and the EGM review artifacts.

## Problem and decision record

Users reported slow sign-in. The local reproduction used an isolated MongoDB and API on port 3005. No production account or endpoint was used.

Measured baseline, 10 concurrent requests unless stated:

| Scenario | p95 before | Statuses before |
| --- | ---: | --- |
| Valid `/api/auth/login-credentials` | 9,977.6 ms | 10 × 200 |
| Valid login, single request | 2,322.6 ms | 1 × 200 |
| Invalid `/api/auth/login-credentials` | 2,182.5 ms | 10 × 401 |
| `/api/auth/mobile/otp/request` | 100.9 ms | 10 × 200 |
| `/api/auth/mobile/otp/verify` | 167.0 ms | 2 × 200, 8 × 401 |

Latest isolated-stack measurements:

| Scenario | p50 | p95 | Max | Statuses |
| --- | ---: | ---: | ---: | --- |
| Valid login, single request | 733.8 ms | 733.8 ms | 733.8 ms | 1 × 200 |
| Valid login, 10 concurrent | 1,441.2 ms | 1,970.6 ms | 1,970.6 ms | 10 × 200 |
| Invalid login, 10 concurrent | 428.1 ms | 623.1 ms | 623.1 ms | 10 × 401 |
| OTP request, 10 concurrent | 228.2 ms | 319.3 ms | 319.3 ms | 10 × 200 |
| OTP verify, 10 concurrent | 168.2 ms | 481.8 ms | 481.8 ms | 1 × 200, 9 × 401 |

The OTP verify status change is intentional. One inbox challenge is consumed once, so one of ten simultaneous verifiers receives sessions and nine receive `INVALID_OTP`.

Decisions:

- Keep `bcryptjs`; do not add a native dependency.
- Run password comparisons in a bounded worker pool.
- Reuse verified credentials only after binding the proof to the full user document.
- Store one authoritative OTP challenge per normalized email in `otp_challenges`.
- Keep per-user OTP copies only for older instances during a drained rollout.
- Compare MFA expiry through an expression that accepts both legacy ISO strings and BSON Dates.
- Treat password-worker failures as infrastructure errors, not wrong passwords.
- Keep demo-tenant email suppression; local OTP timings do not include SMTP latency.
- Guard app buttons outside React state so rapid taps cannot create duplicate requests.

Non-goals:

- No production deployment or real-account lockout testing.
- No change to credentials-only mobile login.
- No removal of rate limits, lockouts, MFA step-up, or no-enumeration responses.

## Detailed Implementation Plan

The work is split into six phases. Each phase is independently testable and revertable.

### Phase 1 — Password worker pool

Files:

- `server/services/passwordHash.js` — create.
  - Export `comparePassword`, `closePool`, and `PasswordHashInfrastructureError`.
  - Use inline bcrypt when `NODE_ENV === 'test'` or `AUTH_HASH_INLINE === '1'`; `AUTH_HASH_MODE=worker` forces workers.
  - Pool size defaults to `max(1, min(6, availableParallelism - 1))`, with `os.cpus().length` and `2` as fallbacks. `AUTH_HASH_POOL_SIZE` accepts a positive integer and is capped at 32.
  - `AUTH_HASH_MAX_QUEUE` accepts an integer from 1 to 1000 and defaults to 200. Zero is invalid and falls back to 200.
  - Queue overflow, worker error, worker exit, and shutdown reject with `PasswordHashInfrastructureError`.
  - Each worker tracks one active task. Message completion resolves or rejects the task and drains the queue. Error/exit removes the worker, rejects its task, spawns a replacement unless closing, and drains the queue.
  - `closePool()` returns one shared promise, rejects queued and active tasks, terminates workers, and is wired into SIGTERM/SIGINT shutdown in `server/index.js`.

- `server/services/passwordHashWorker.js` — create.
  - Handle `{ id, password, hash }` and reply with `{ id, ok, value }` or `{ id, ok: false, error }`.

- `server/routes/auth.js` — modify.
  - Replace credential-check `bcrypt.compare` calls with `comparePassword`; `bcrypt.hash` remains cost 12.
  - `_candidatePasswordMatches` rethrows infrastructure errors and returns `{ match: false }` only for credential mismatches.
  - `/login-credentials` returns 503 for infrastructure errors and does not call `recordFail`.

- `server/index.js` — modify.
  - Keep the HTTP server handle, await `closePool()`, close HTTP, disconnect Mongoose, and exit on SIGTERM/SIGINT. A 10-second force timer bounds shutdown.

Tests:

- `server/__tests__/services/passwordHash.test.js` — real workers, ten concurrent correct comparisons and one wrong password.
- `server/__tests__/services/passwordHashFailure.test.js` — mocked worker error/replacement and queue overflow.
- `server/__tests__/routes/auth-login-infrastructure.test.js` — 503 and no failure-counter increment.

Verify: the three test files above.
Rollback: delete the service/test files, restore `bcrypt.compare`, and remove shutdown wiring.

### Phase 2 — Credentials login and token payload

Files:

- `server/routes/auth.js` — modify.
  - `_candidatePasswordMatches` returns `{ match, identity }`.
  - `/login-credentials` verifies projected candidates, resolves schools in parallel, fetches the chosen full user by `id` or `_id`, and re-verifies if the full user's password hash or `identityId` differs from the proved snapshot.
  - `_handleLogin(req, res, { preverifiedUser, identity })` skips duplicate bcrypt only after that binding check. Existing lock, active-status, password-expiry, MFA, cookie, and token-in-body branches remain unchanged.
  - `_buildTokenPayload` runs teacher extras and school organization reads in parallel. Identity token version is read separately with one retry; failure rejects login instead of fabricating `itv: 0` or omitting identity claims.
  - `_issueMobileSession` creates the session and token payload in parallel.
  - `_handleLogin` runs `lastLogin`, session creation, token payload, photo URL, and merged permissions in one `Promise.all`. Destructuring is `[, { sessionId, absoluteExpiry }, tokenPayload, , mergedPerms]`.
  - Mobile `/login` and `/verify-otp` skip `_availableSchools`; web callers still receive it.

- `server/__tests__/routes/auth-login-credentials.test.js` — modify.
  - Assert one bcrypt comparison for a normal single-school login.
  - Assert a password changed between candidate and full-user reads is re-verified and rejected.

Verify: credentials login, token, and merged-permission suites.
Rollback: restore serial reads and the former proof flow.

### Phase 3 — Authoritative OTP inbox challenge

Files:

- `server/services/otpChallengeService.js` — create.
  - Use a dedicated Mongoose model with string `_id`, `codeHash`, `expiresAt: Date`, `attempts`, `accounts`, `lastSentAt: Date`, `sendTimes: [Date]`, `consumedAt`, and `claimId`.
  - `claimEmailCode(email, accounts, { codeHash, expiresAt, sentAt })` performs one `findOneAndUpdate` on `{ _id: email }` with `upsert: true`.
  - The aggregation pipeline computes `canSend` from the current document: `lastSentAt` is missing/null/at least 60 seconds old, and the `$filter` of `sendTimes` newer than one hour has fewer than 5 entries.
  - When `canSend` is true, the pipeline sets a unique `claimId`, code hash, expiry, zero attempts, account references, `lastSentAt`, pruned `sendTimes`, and removes `consumedAt`. When false, existing fields are preserved and `claimId` is removed.
  - Duplicate-key races retry once. The function returns the challenge only when the returned `claimId` matches this claim.
  - `consumeEmailCode(email, codeHash)` reads the challenge, rejects unknown/expired/consumed/attempt-capped codes, increments attempts for a wrong code, and uses `findOneAndUpdate` with `codeHash`, `expiresAt: { $gt: now }`, `consumedAt: { $exists: false }`, and `attempts: { $lt: 5 }` to consume once.

- `server/routes/auth.js` — modify.
  - `/otp/request` and `/mobile/otp/request` claim the email challenge before writing compatibility copies or sending mail.
  - Per-user copies use the same hash and a BSON `Date` expiry. `loginOtpSentAt` and `loginOtpSends` remain ISO strings for older instances.
  - `/otp/verify` consumes the shared challenge, selects the account for `req.school.id`, loads that active user, and issues only that school's session or step-up.
  - `/mobile/otp/verify` consumes the shared challenge once, loads all referenced active users, filters inactive/expired schools, and issues sessions. `linkedSchools` sorting and privileged-role step-up remain unchanged.
  - `_clearChallengeUserCopies` conditionally clears only copies still carrying the consumed hash.
  - `/verify-otp` keeps MFA on the user document but consumes with `isActive: true` and `_dateAfterExpr('mfaExpiry', now)`. `_dateAfterExpr` accepts BSON Dates and ISO strings.
  - Inactive MFA verification returns the same generic 401 as an incorrect code.

- `server/utils/indexes.js` — modify.
  - Add `otp_challenges.expiresAt` TTL index named `otp_challenges_expiry` with `expireAfterSeconds: 0`.
  - Teach `ensureIndexes` to pass `expireAfterSeconds` to `createIndex`.

Tests:

- `server/__tests__/services/otpChallengeService.test.js` — real MongoDB memory server: ten concurrent sends create one challenge, one consume across two school copies, wrong-code attempts, resend window, hourly cap, and Date expiry storage.
- `server/__tests__/routes/auth-mobile.test.js` — tenant request/verify, wrong code, expiry, attempt cap, step-up, and MFA cookie/token shape.
- `server/__tests__/routes/auth-mobile-otp-email.test.js` — multi-school request/verify, ten rapid requests, replay race, unknown email, and step-up.

Verify: the three test files above.
Rollback: do not roll back while old and new instances are mixed. Drain old instances first, then restore the former per-user routes.

### Phase 4 — Failure counters and indexes

Files:

- `server/services/securityService.js` — modify.
  - Use one aggregation-pipeline upsert on `{ key: 'fail:<schoolId>:<loginId>' }`.
  - Stage 1 sets `id`, tenant fields, `count`, `windowStart`, `lastIp`, `updatedAt`, and `expiresAt`. `count` increments a live 24-hour window or resets a stale window to 1.
  - Stage 2 sets `lockedUntil` with `$switch`: 30 failures = 24 hours, 20 = 1 hour, 10 = 15 minutes, 5 = 1 minute, otherwise null. Count and lock are now one atomic write.
  - Duplicate-key upsert races retry once.
  - `security_events` remains `LOGIN_LOCKOUT` on a tier crossing and `LOGIN_FAILURE` otherwise. Admin notification remains `count >= 30 && count % 10 === 0`.
  - `crypto.randomUUID()` is evaluated in Node.js while building the pipeline; MongoDB stores the literal.

- `server/utils/indexes.js` — modify.
  - Deduplicate existing `login_failures` rows by `key`, keeping the newest `updatedAt`, before index creation.
  - Drop old `loginfail_key`.
  - Create unique `loginfail_key_unique` on `{ key: 1 }`.
  - Add `teachers_school_user`, `roleperms_school_role`, `roleperms_school_user`, `userphotos_school_user`, `emailfail_scope_hour`, `emailfail_lastat`, and `schools_custom_domain` with the key/options recorded in the index table below.

| Collection | Name | Key | Options |
| --- | --- | --- | --- |
| `teachers` | `teachers_school_user` | `{ schoolId: 1, userId: 1 }` | sparse |
| `role_permissions` | `roleperms_school_role` | `{ schoolId: 1, roleKey: 1 }` | none |
| `role_permissions` | `roleperms_school_user` | `{ schoolId: 1, userId: 1 }` | sparse |
| `user_photos` | `userphotos_school_user` | `{ schoolId: 1, userId: 1 }` | sparse |
| `login_failures` | `loginfail_key_unique` | `{ key: 1 }` | unique |
| `email_failures` | `emailfail_scope_hour` | `{ scope: 1, hour: 1 }` | none |
| `email_failures` | `emailfail_lastat` | `{ lastAt: 1 }` | none |
| `schools` | `schools_custom_domain` | `{ customDomain: 1 }` | sparse |
| `otp_challenges` | `otp_challenges_expiry` | `{ expiresAt: 1 }` | TTL 0 |

Tests:

- `server/__tests__/services/securityService.test.js` — pipeline shape, stale reset, tier crossing, lock event, and admin alert.
- `server/__tests__/services/securityService.integration.test.js` — real MongoDB: ten concurrent failures produce one row, count 10, and an active lock.
- `server/__tests__/indexes-migration-safety.test.js` — unique index name and old-index drop.

Verify: the three test files above.
Rollback: restore the former service and index definitions only after the unique-index migration is understood; do not recreate duplicate rows intentionally.

### Phase 5 — Speed test

Files:

- `scripts/auth-perf-test.js` — create.
  - `AUTH_PERF_PATH` defaults to `/api/auth/login-credentials`.
  - `AUTH_PERF_PAYLOAD` accepts inline JSON or `@file`; otherwise `AUTH_PERF_IDENTIFIER` and `AUTH_PERF_PASSWORD` build `{ identifier, password, platform: 'mobile' }`.
  - `AUTH_PERF_CONCURRENCY` is an integer 1–100, default 10.
  - `AUTH_PERF_WARMUP` is an integer 0–100. Default is 0 for `/otp/` paths and 2 otherwise.
  - `AUTH_PERF_TIMEOUT_MS` is positive, default 30000.
  - `AUTH_PERF_MAX_P95_MS` is positive, default 5000.
  - `AUTH_PERF_EXPECT_STATUS` is an integer 100–599, default 200.
  - `AUTH_PERF_EXPECT_STATUSES` accepts `status:count` pairs totaling concurrency, for example `200:1,401:9`.
  - Invalid configuration exits 2. Warmup outcomes are reported and checked. Failed status, token, warmup, or p95 assertions exit 1.

- `package.json` — add `test:auth:perf`.

- `server/__tests__/scripts/auth-perf-config.test.js` — invalid status and malformed count configurations exit 2.

Verify: `npm run test:auth:perf` and the config test.
Rollback: remove the script and package entry.

### Phase 6 — Mobile rapid-tap guard

Files:

- `src/lib/single-flight.ts` — create.
  - `run` returns `undefined` only for a coalesced no-op. The first caller receives the task's actual result.
- `src/lib/__tests__/single-flight.test.ts` — create.
  - Rapid runs call once; explicit `true` is distinct from `undefined`; failure allows a later retry.
- `src/screens/auth/LoginScreen.tsx`, `SchoolCodeScreen.tsx`, `OtpScreen.tsx` — modify.
  - Each email task returns `true` after `requestEmailCode` succeeds.
  - `sendCode`/`resend` skip when active and navigate/reset countdown only after a real success.

Verify: `npm run typecheck`, `npm test`, and the browser UX check.
Rollback: restore the three original handlers and remove the helper/test.

## Test plan and evidence

Run from the repository root:

```powershell
npx jest --runInBand --forceExit server/__tests__/services/otpChallengeService.test.js server/__tests__/services/passwordHash.test.js server/__tests__/services/passwordHashFailure.test.js server/__tests__/services/securityService.test.js server/__tests__/services/securityService.integration.test.js server/__tests__/routes/auth-mobile.test.js server/__tests__/routes/auth-mobile-otp-email.test.js server/__tests__/routes/auth-login-credentials.test.js server/__tests__/routes/auth-login-infrastructure.test.js server/__tests__/auth-token.test.js server/__tests__/auth-load-merged-permissions.test.js server/__tests__/indexes-migration-safety.test.js server/__tests__/scripts/auth-perf-config.test.js server/__tests__/routes/parent-portal-lessons-coverage.test.js server/__tests__/routes/student-portal-lessons-coverage.test.js
```

Final focused server run: **15 suites, 120 tests passed**. The token, merged-permission, and two portal-coverage suites are unchanged regression suites.

Mobile checks run from `msingi-mobile`:

```powershell
npm run typecheck
npm test
```

Both passed. The mobile suite contains **372 tests**, including three single-flight tests.

Isolated stack startup:

```powershell
npm run db:local
PORT=3005 NODE_ENV=development ALLOW_DEMO_SEED=1 node server/index.js
```

### App UX race check

The web build of the mobile app was run against the isolated API with `EXPO_PUBLIC_API_URL=http://localhost:3005` and `EXPO_PUBLIC_DEMO=0`. Five synchronous clicks on **Email me a code** produced one POST, navigated to OTP entry, and started the 60-second resend countdown. The challenge was then set to the known local test code, entered in the app, and verified into the parent home screen with no console errors.

### Real SMTP delivery count

A non-demo local school (`otp-email-test`) and parent account were used with the repository's SMTP sink at `127.0.0.1:1025`:

- Ten concurrent `POST /api/auth/mobile/otp/request` calls returned 10 × 200.
- The SMTP sink received exactly **1 email** for the address.
- The delivered six-digit code produced 1 × 200 and a session token.
- Replaying the same code produced 401 and did not send another email.
- OTP request p95 at concurrency 10 was 473.2 ms; verify was 168.6 ms.

A resend after the 60-second window can send one new email, up to five per hour; the newest code replaces the previous code.

## Rollout and rollback

Deploy in this order:

1. Deploy indexes and the failure-counter/worker/login changes. The unique lockout index requires startup deduplication before creation.
2. Patch currently running OTP routes so their `$unset` filters on the live OTP hash and expiry, and so a session is issued only when the update matched. This closes the old-instance replay window.
3. Drain old instances from OTP traffic.
4. Deploy the `otp_challenges` service and new request/verify routes. Existing pending per-user codes are not migrated; users may need one fresh code.
5. Deploy the mobile guard.

Rollback is a per-phase code revert. Never roll back phase 3 while any pre-patch instance still serves OTP traffic.

Staging acceptance criteria:

- All focused server suites pass.
- Mobile typecheck and tests pass.
- Valid login p95 at concurrency 10 is at most 5000 ms with 10 × 200.
- Invalid login p95 is at most 2000 ms with 10 × 401.
- OTP verify at concurrency 10 returns exactly 1 × 200 and 9 × 401.
- Ten concurrent OTP requests produce one challenge and one send time.
- Five rapid app taps produce one POST and successful OTP-screen navigation.

## Residual risks

- `bcryptjs` still uses cost 12. The pool moves work off the event loop but does not reduce CPU work. On a single-core host, pool size 1 gives no parallel gain.
- Each worker loads `bcryptjs` once, so the pool adds memory.
- Compatibility copies can be partially written, but the new verify routes use only the inbox challenge, so partial copies cannot split a successful login.
- A rolling deploy without the compatibility patch and drain can still allow an old instance to replay a code.
- Local OTP timings omit SMTP latency because demo tenants suppress mail.
- App-level single-flight guards cover one mounted screen. The server challenge remains the binding protection.
