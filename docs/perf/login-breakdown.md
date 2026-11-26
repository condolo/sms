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

## What to watch next

- On a 0.5–1 CPU deployment, worker-pool size is CPU-bound. More workers do
  not create more CPU; native bcrypt still reduces work per comparison.
- If production cost-12 hashes remain slow, benchmark cost/hosting tradeoffs
  before changing the work factor. Do not silently weaken password storage.
- Keep `AUTH_HASH_POOL_SIZE` deliberate and watch queue depth / 503s under
  login bursts. A warm pool can remove first-request worker startup cost.
