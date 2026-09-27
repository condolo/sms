/* ============================================================
   CORS origin validation (security review, 2026-09) — extracted from
   server/index.js so this logic is independently testable, the same way
   utils/csrf.js was pulled out of routes/auth.js.

   Two real gaps closed here, both confirmed against the actual code
   before fixing (not assumed):

   1. The old check was `process.env.NODE_ENV !== 'production'` — that
      FAILS OPEN (disables the entire allowlist) for an unset, misspelled,
      or unexpected value ('staging', '', 'Production' wrong-case, or
      simply never having been set on a real deployment) instead of the
      intended "only relax this on a real developer's machine." Only
      'development'/'test' now relax it — everything else, including a
      misconfigured env var, fails CLOSED.

   2. The *.msingi.io wildcard only proved an origin LOOKS like a school
      portal (regex shape match), never that it IS one — the review's own
      ask: "review subdomain ownership... for abandoned or user-
      controlled subdomains." Backed now by a real, periodically-
      refreshed set of this platform's own active school slugs. An origin
      only needs to match the shape while that cache is still cold (right
      after a restart, or during a DB hiccup) — a database blip must
      never lock every real school out at once — but once the cache has
      successfully loaded at least once, the subdomain must also be a
      real, currently-provisioned school slug, not just shape-correct.

   Neither of these touches the CSRF gap (utils/csrf.js) — a perfect CORS
   allowlist does not stop a plain HTML form POST from a same-site
   origin; CORS only controls whether JS can READ a cross-origin
   response, not whether a browser sends the request with cookies
   attached in the first place. The two are separate defenses for
   separate parts of the same attack surface, fixed together here because
   the review raised them together, not because one implies the other.
   ============================================================ */
'use strict';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
ALLOWED_ORIGINS.push(
  'https://school-management-ecosystem.onrender.com',
  'https://msingi.io',
  'https://www.msingi.io',
  'http://localhost:3005',
  'http://localhost:3000',
  'http://127.0.0.1:3005',
);

// Shape-matches any *.msingi.io subdomain — captures the slug for the
// real-slug cache check below.
const MSINGI_SUBDOMAIN_RE = /^https:\/\/([a-z0-9][a-z0-9-]*)\.msingi\.io$/;

const SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
let _knownSchoolSlugs = null; // null = cache never successfully populated yet
let _slugCacheLoadedAt = 0;
let _slugCacheRefreshing = false;

async function _refreshKnownSchoolSlugs() {
  if (_slugCacheRefreshing) return;
  _slugCacheRefreshing = true;
  try {
    const { _model } = require('./model');
    const schools = await _model('schools').find({}).select('slug').lean();
    _knownSchoolSlugs = new Set(schools.map(s => s.slug).filter(Boolean));
    _slugCacheLoadedAt = Date.now();
  } catch (err) {
    console.error('[CORS] Failed to refresh school slug cache (falling back to shape-only subdomain match):', err.message);
  } finally {
    _slugCacheRefreshing = false;
  }
}

function _isAllowedMsingiSubdomain(origin) {
  const match = MSINGI_SUBDOMAIN_RE.exec(origin);
  if (!match) return false;
  if (_knownSchoolSlugs === null || Date.now() - _slugCacheLoadedAt > SLUG_CACHE_TTL_MS) {
    _refreshKnownSchoolSlugs(); // fire-and-forget — this request uses whatever we have right now
  }
  if (_knownSchoolSlugs === null) return true; // cache cold — fail open on shape match only, never block every school over a DB hiccup
  return _knownSchoolSlugs.has(match[1]);
}

const DEV_ENVS = new Set(['development', 'test']);

/** True if this origin should be allowed. `origin` is a real, non-empty origin string — the caller (index.js) handles the separate "no Origin header at all" pass-through, since that's a different question (a non-browser client) from "is this origin string trustworthy." */
function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || _isAllowedMsingiSubdomain(origin) || DEV_ENVS.has(process.env.NODE_ENV);
}

// Test-only hooks — reset the module-level cache between tests, and
// inspect it without waiting on the real TTL/DB.
function _resetSlugCacheForTests() {
  _knownSchoolSlugs = null;
  _slugCacheLoadedAt = 0;
  _slugCacheRefreshing = false;
}
function _setSlugCacheForTests(slugs, loadedAt = Date.now()) {
  _knownSchoolSlugs = new Set(slugs);
  _slugCacheLoadedAt = loadedAt;
}

module.exports = {
  isAllowedOrigin,
  ALLOWED_ORIGINS,
  MSINGI_SUBDOMAIN_RE,
  _refreshKnownSchoolSlugs,
  _resetSlugCacheForTests,
  _setSlugCacheForTests,
};
