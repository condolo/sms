const jwt = require('jsonwebtoken');

/* Security Baseline Register, EXP-05 (CRITICAL): this used to fall back to
   a hardcoded literal secret ('dev_secret_change_in_production') whenever
   JWT_SECRET was unset in any environment other than NODE_ENV==='production'
   exactly — that string is now public (shipped in this same public source
   tree, see EXP-01), so it was a live forge-a-session-for-any-user risk in
   any deployment that hit the fallback: an unset NODE_ENV, a value other
   than the literal string 'production' (a staging slot, a fork, a local/ops
   script). There is no safe default for a signing secret — fail closed in
   every environment, not just the one the code happened to special-case.
   Test files that require this module directly get an explicit, clearly-
   labelled test-only value from server/__tests__/jest.setup.js — the same
   pattern already used for PLATFORM_JWT_SECRET in ops.test.js — rather than
   an implicit fallback baked into the module itself. */
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET env var is not set. Refusing to start — there is no safe default for a session-signing secret.');
  process.exit(1);
}

const SECRET = process.env.JWT_SECRET;

/* JWT lifetime = absolute session limit (8 h default).
   JWT identifies who you are. SessionService decides if you're still active.
   Idle timeout is enforced client-side + via lastActivity in the sessions
   collection — NOT by issuing short-lived tokens that require constant renewal. */
const ABSOLUTE_TIMEOUT_MS = parseInt(process.env.JWT_ABSOLUTE_TIMEOUT_MS || '', 10) || 8 * 60 * 60 * 1000; // 8 h
const IDLE_TIMEOUT_MS     = parseInt(process.env.IDLE_TIMEOUT_MS         || '', 10) || 60 * 60 * 1000;      // 60 min (frontend only)

function sign(payload, opts = {}) {
  const expiresIn = opts.expiresIn || Math.floor(ABSOLUTE_TIMEOUT_MS / 1000) + 's';
  return jwt.sign(payload, SECRET, { expiresIn });
}

function verify(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

module.exports = { sign, verify, IDLE_TIMEOUT_MS, ABSOLUTE_TIMEOUT_MS };
