const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] JWT_SECRET env var is not set in production. Refusing to start with insecure default.');
  process.exit(1);
}

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

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
