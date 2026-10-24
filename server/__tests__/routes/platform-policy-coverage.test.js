/* ============================================================
   The capability POLICY table must stay in step with the routes it
   governs.

   Two failure modes, both worth catching:
     - a MUTATING route with no policy entry. It falls back to
       owner-only (the safe default), so nobody breaks — but nobody can
       use it either, and the mismatch is invisible. If a role is ever
       meant to have it, the table has to say so.
     - a policy entry that matches no route: a dead rule that looks like
       coverage on paper.

   The routes that are legitimately un-policed are the PUBLIC ones,
   registered before the session gate (auth + the public settings and
   landing-content reads). This test names them explicitly, so a new
   public route has to be declared rather than quietly falling through.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { POLICY } = require('../../config/platformCapabilities');

const PLATFORM_ROUTE_FILE = path.join(__dirname, '../../routes/platform.js');

/* Routes registered BEFORE router.use(platformSession) — no session, so no
   capability applies. Declared here so the audit can tell "intentionally
   public" from "I forgot to write a rule". */
const PUBLIC_ROUTES = new Set([
  'GET /settings',
  'GET /landing-content',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/accept-invite',
  /* Google sign-in for the console (v5.206.0). All three sit before the
     platformSession gate: /auth/google issues the OAuth redirect,
     /auth/google/callback finishes the round-trip with a single-use
     exchange code, and /auth/google/exchange mints the session cookie.
     Declared here so the audit can tell "intentionally public" from a
     route that silently fell through the capability gate. */
  'GET /auth/google',
  'GET /auth/google/callback',
  'POST /auth/google/exchange',
]);

function registeredRoutes() {
  const src = fs.readFileSync(PLATFORM_ROUTE_FILE, 'utf8');
  const out = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/gi;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ method: m[1].toUpperCase(), path: m[2] });
  return out;
}

function compile(pattern) {
  const segs = pattern.split('/').filter(Boolean);
  let literals = 0;
  const body = segs.map(s => {
    if (s.startsWith(':')) return '[^/]+';
    if (s === '*') return '.*';
    literals += 1;
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { re: new RegExp(`^/${body}/?$`, 'i'), literals };
}

function bestMatch(compiled, method, p) {
  let best = null;
  for (const rule of compiled) {
    if (rule.method !== method) continue;
    if (!rule.re.test(p)) continue;
    if (!best || rule.literals > best.literals) best = rule;
  }
  return best;
}

describe('the capability policy table covers the platform routes', () => {
  const routes = registeredRoutes();
  const compiled = POLICY.map(r => ({ ...r, ...compile(r.pattern) }));

  test('the route file was actually parsed (guards against a silent regex break)', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  test('every mutating platform route has a capability, or is declared public', () => {
    const unpoliced = routes
      .filter(r => r.method !== 'GET')
      .filter(r => !bestMatch(compiled, r.method, r.path))
      .filter(r => !PUBLIC_ROUTES.has(`${r.method} ${r.path}`))
      .map(r => `${r.method} ${r.path}`);
    expect(unpoliced).toEqual([]);
  });

  test('every read route is either policed or declared public', () => {
    const unpoliced = routes
      .filter(r => r.method === 'GET')
      .filter(r => !bestMatch(compiled, r.method, r.path))
      .filter(r => !PUBLIC_ROUTES.has(`${r.method} ${r.path}`))
      .map(r => `${r.method} ${r.path}`);
    expect(unpoliced).toEqual([]);
  });

  test('no policy rule is dead (every rule matches at least one real route)', () => {
    const dead = POLICY.filter(rule => !routes.some(r => r.method === rule.method && compile(rule.pattern).re.test(r.path)))
      .map(r => `${r.method} ${r.pattern}`);
    expect(dead).toEqual([]);
  });

  test('the declared public routes all still exist', () => {
    const keys = new Set(routes.map(r => `${r.method} ${r.path}`));
    for (const key of PUBLIC_ROUTES) {
      expect(keys.has(key)).toBe(true);
    }
  });
});
