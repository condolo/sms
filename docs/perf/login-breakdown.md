# Credential login — where the time goes

`POST /api/auth/login-credentials` does **not** do a fuzzy search. The path is:

1. Normalize the identifier to lowercase/trim.
2. Run two indexed lookups in parallel:
   - `users.email` with the `users_email_ci` case-insensitive collation;
   - `users.username` with `users_username_lookup`.
3. Merge/dedupe results, capped at five candidates.
4. Verify bounded candidates in parallel in the password worker pool.
5. Check account lock, resolve school, reload the full tenant-scoped user.
6. Create session + token payload + merged permissions in parallel.

## Measured local breakdown

`npm run test:auth:breakdown` connects to `msingi_perf` and times each stage.
With the demo teacher account:

| Stage | Before native bcrypt | After native bcrypt |
|---|---:|---:|
| Candidate search | ~5–7 ms | ~4–8 ms |
| Password compare | ~235 ms p50 | ~114 ms p50 |
| Full user read | ~3 ms | ~3 ms |
| School read | ~4 ms | ~4 ms |
| Lock read | ~3 ms | ~2 ms |

The explain plan shows `COLLSCAN` only because the fixture has six users;
the indexes exist and Mongo chooses a scan for a collection that small. At
production scale the same queries use `users_email_ci` and
`users_username_lookup`.

**Conclusion: user search is not the bottleneck. Bcrypt is.**

## Changes made

- Removed the duplicate account-lock read: `/login-credentials` checks it,
  then `_handleLogin` checked it again. `_handleLogin` now accepts
  `lockChecked` and skips the duplicate only for that pre-checked path.
- Password comparisons now use `@node-rs/bcrypt` (native, same bcrypt hash
  format) inside the existing worker pool. Hash generation remains on
  `bcryptjs`, so no stored credential migration is needed.
- Added opt-in, PII-free stage timing: set `AUTH_LOGIN_TIMING=1` to log
  `[auth/login-credentials:timing]` with `searchMs`, `passwordMs`, `lockMs`,
  `schoolMs`, `fullUserMs`, `handleLoginMs`, and `totalMs`.

## Concurrent profiler result

`npm run test:auth:load-breakdown` starts an isolated API, drives 60 logins
at concurrency 10, and summarises the server-stage timings:

| Stage | p50 | p95 |
|---|---:|---:|
| Candidate search | 21.6 ms | 35.6 ms |
| Password verification | 251.3 ms | 469.1 ms |
| Account lock | 10.2 ms | 24.7 ms |
| School resolution | 11.2 ms | 27.0 ms |
| Full user read | 11.6 ms | 33.1 ms |
| Session/token/permissions | 42.5 ms | 81.8 ms |
| **Total** | **371.8 ms** | **542.4 ms** |

Password verification is ~70% of p95. Pool-size tests at concurrency 10:

| Configuration | Client p95 |
|---|---:|
| 4 workers | 1,712 ms |
| **6 workers (current default on this 8-core host)** | **566 ms** |
| 8 workers | 1,025 ms |
| Direct native compare, no worker pool | 750 ms |

Six workers is the best tested setting; fewer queues, more oversubscribes.
The pool is now warmed before the API starts listening.

## What to watch next

- On a 0.5–1 CPU deployment, worker-pool size is CPU-bound. More workers do
  not create more CPU; native bcrypt still reduces work per comparison.
- If production cost-12 hashes remain slow, benchmark cost/hosting tradeoffs
  before changing the work factor. Do not silently weaken password storage.
- Keep `AUTH_HASH_POOL_SIZE` deliberate and watch queue depth / 503s under
  login bursts. A warm pool can remove first-request worker startup cost.
