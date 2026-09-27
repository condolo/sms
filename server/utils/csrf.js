/* ============================================================
   CSRF — double-submit cookie (security review, 2026-09, category 1)

   Real gap this closes: cookie-authenticated state-changing requests
   relied on SameSite=Strict alone (see auth.js's own login-cookie
   comment). That is NOT sufficient here specifically — the CORS layer
   (server/index.js) deliberately trusts any `*.msingi.io` subdomain as a
   legitimate school portal origin, but SameSite's own "site" concept is
   the registrable domain (msingi.io), not the subdomain — so a
   compromised, abandoned, or attacker-registered sibling subdomain is
   SAME-SITE, and its cookies (including the real auth cookie, host-only
   or not) are sent by the browser to the real API exactly as if the
   request came from a legitimate school portal. SameSite=Strict blocks
   cross-SITE forgery; it was never going to block this.

   Design: classic double-submit. A second cookie (`csrf_token`,
   deliberately NOT httpOnly — legitimate same-origin JS must be able to
   read it to echo it back) is issued alongside every real auth cookie.
   Every state-changing request must repeat that same value in a custom
   header (`X-CSRF-Token`) — something a same-site attacker's plain HTML
   form can never do (forms can't set custom headers), and something
   their JS can't fake either: a HOST-ONLY cookie (no explicit `Domain`
   attribute — this app never sets one) is invisible to `document.cookie`
   on any OTHER host, sibling subdomain included, even though the browser
   still automatically ATTACHES it to same-site requests. The attacker's
   request carries the cookie (same-site, so it's sent) but never the
   matching header (they can't read the cookie's value to produce it) —
   exactly the asymmetry this defense needs.

   Stateless by design — no server-side token store, just "does this
   request's header match this request's own cookie."

   Rollout: missing csrf_token cookie entirely PASSES THROUGH — same
   "missing claim passes through" convention middleware/auth.js already
   uses for tv/itv/absoluteExpiry. A session issued before this shipped
   (or a non-browser Bearer-token caller, which never gets this cookie at
   all) is not held to a check it never had the chance to satisfy; every
   login from here on gets the cookie, so coverage is complete within one
   absolute-session-lifetime (8h) of deploying this. Once the cookie IS
   present, a missing or mismatched header is rejected outright — that
   combination only happens for a forged request or a client bug, never
   for an old session.
   ============================================================ */
'use strict';

const crypto = require('crypto');

const CSRF_COOKIE_NAME = 'csrf_token';
// Platform-operator sessions get their own token/cookie under a distinct
// name (mirrors platform_token vs. the school-tenant token cookie) —
// logically separate contexts, kept separate rather than reusing one
// cookie across both, even though double-submit itself wouldn't care.
const PLATFORM_CSRF_COOKIE_NAME = 'platform_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

function _cookieOpts(maxAge) {
  return {
    httpOnly: false, // must be readable by same-origin JS to echo back — see module comment
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/** Issues a fresh random CSRF cookie alongside a real login/session cookie. Returns the value (rarely needed — the client reads it back from the cookie itself). */
function issueCsrfCookie(res, maxAge, cookieName = CSRF_COOKIE_NAME) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(cookieName, token, _cookieOpts(maxAge));
  return token;
}

function clearCsrfCookie(res, cookieName = CSRF_COOKIE_NAME) {
  res.clearCookie(cookieName, _cookieOpts());
}

/** GET/HEAD/OPTIONS are exempt (read-only, not a state-changing forgery target). No CSRF cookie on the request at all → pass (see rollout note above). Otherwise the X-CSRF-Token header must exactly match the cookie. */
function csrfOk(req, cookieName = CSRF_COOKIE_NAME) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  const cookieToken = req.cookies?.[cookieName];
  if (!cookieToken) return true;

  const headerToken = req.headers[CSRF_HEADER_NAME];
  if (typeof headerToken !== 'string' || headerToken.length !== cookieToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken));
}

module.exports = { issueCsrfCookie, clearCsrfCookie, csrfOk, CSRF_COOKIE_NAME, PLATFORM_CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
