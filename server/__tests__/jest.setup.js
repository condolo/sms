/* ============================================================
   Jest global setup — runs once per test file, before that file's
   own imports resolve.

   Security Baseline Register, EXP-05: server/utils/jwt.js used to
   fall back to a hardcoded literal secret ('dev_secret_change_in_
   production') whenever JWT_SECRET was unset outside NODE_ENV=
   'production' — that fallback is now removed and jwt.js fails
   closed (process.exit) whenever JWT_SECRET is missing, in every
   environment, including test. 11 test files require jwt.js
   directly (not mocked) and previously relied on that fallback
   working silently. This sets an explicit, clearly-labelled
   test-only secret before any test file's code runs, so those
   files keep working without each one setting it individually —
   same pattern already used for PLATFORM_JWT_SECRET in ops.test.js.
   ============================================================ */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_only_jwt_secret_never_use_in_production';
