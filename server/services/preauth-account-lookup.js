/**
 * Cross-tenant account discovery for the pre-auth doors.
 *
 * WHY THIS LIVES OUTSIDE server/routes/
 * ─────────────────────────────────────
 * Before a school is known there is no tenant to scope to. `/login-credentials`
 * and the app's school-less email-code routes must find every account that
 * holds an address — the ONE legitimate cross-tenant user read (ADR-0001 §4,
 * reviewed exception). Keeping it here means the tenant ratchet's route count
 * does not grow every time another sign-in door reuses the same read, and the
 * exception is exercised through a single, documented implementation.
 *
 * RULES (must stay true for every caller):
 *   • bounded   — at most MAX_CANDIDATES documents are examined;
 *   • projected — only the fields the caller names are selected;
 *   • email     — matches use the platform-wide case-insensitive index
 *                 collation (users_email_ci), never a scan;
 *   • never echoed — callers must not return these documents to an
 *                 unauthenticated caller.
 *
 * The ratchet still applies everywhere else: new tenant work inside a known
 * school goes through tenantModel(collection, tenantContext(req)).
 */
'use strict';

const { _model } = require('../utils/model');

const MAX_CANDIDATES = 5;

function byEmail(email, projection) {
  return _model('users')
    .find({ email })
    .collation({ locale: 'en', strength: 2 })
    .select(projection)
    .limit(MAX_CANDIDATES)
    .lean();
}

/** Every active-or-inactive account that holds this exact address. */
async function findAccountsByEmail(email, projection) {
  return byEmail(email, projection);
}

/**
 * Candidates for the password door: the address OR the username, deduplicated
 * by account id, capped. This is exactly the read /login-credentials has
 * always done — moved here so the ratchet sees one reviewed site.
 */
async function findLoginCandidates(loginId, projection) {
  const [byEmailRows, byUsernameRows] = await Promise.all([
    byEmail(loginId, projection),
    _model('users')
      .find({ username: loginId })
      .select(projection)
      .limit(MAX_CANDIDATES)
      .lean(),
  ]);

  const seen = new Set();
  const candidates = [];
  for (const doc of [...(byEmailRows || []), ...(byUsernameRows || [])]) {
    const key = doc.id || (doc._id ? String(doc._id) : null);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(doc);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

module.exports = { MAX_CANDIDATES, findAccountsByEmail, findLoginCandidates };
