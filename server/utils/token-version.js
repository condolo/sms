/* ============================================================
   Token Version Cache — lightweight JWT revocation via
   per-user AND per-identity version counters.

   Every issued JWT carries a `tv` (token version) integer, scoped to
   one school's `users` doc. Calling revokeUserTokens(userId) increments
   that user's stored version in the DB, making all previously issued
   tokens for that (school-scoped) account return 401 on their next
   request.

   Tokens for a user with a shared credential (ADR-0003, C8/MR-001
   Phase 1) additionally carry `itv` (identity token version), scoped
   to their `identities` doc. Calling revokeIdentityTokens(identityId)
   invalidates every token across every school sharing that credential
   — the correct behavior for a password/MFA change, since the
   credential itself changed. revokeUserTokens stays exactly as it was
   — role-change/deactivation revocation is intentionally still
   school-scoped, not identity-scoped (Decision 4).

   The in-process cache (5-minute TTL) avoids a DB hit on every
   authenticated request.  Cache invalidation on revocation ensures
   the demotion takes effect within milliseconds.
   ============================================================ */
'use strict';

const { _model } = require('./model');

// Map<userId, { version: number, fetchedAt: number }>
const _cache = new Map();
// Map<identityId, { version: number, fetchedAt: number }>
const _identityCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Return the current tokenVersion for a user.
 * Falls back to 0 if the field is not yet set (pre-existing users).
 */
async function getTokenVersion(userId) {
  const hit = _cache.get(userId);
  if (hit && (Date.now() - hit.fetchedAt) < CACHE_TTL) {
    return hit.version;
  }

  const doc     = await _model('users').findOne({ id: userId }, { tokenVersion: 1 }).lean();
  const version = doc?.tokenVersion ?? 0;
  _cache.set(userId, { version, fetchedAt: Date.now() });
  return version;
}

/**
 * Invalidate all outstanding tokens for a user.
 * Call this after role changes, account suspension, etc.
 * The cache entry is deleted so the next auth check re-reads from DB.
 */
async function revokeUserTokens(userId) {
  await _model('users').updateOne({ id: userId }, { $inc: { tokenVersion: 1 } });
  _cache.delete(userId);
}

/**
 * Return the current tokenVersion for an Identity (shared credential).
 * Falls back to 0 if the field is not yet set.
 */
async function getIdentityTokenVersion(identityId) {
  const hit = _identityCache.get(identityId);
  if (hit && (Date.now() - hit.fetchedAt) < CACHE_TTL) {
    return hit.version;
  }

  const doc     = await _model('identities').findOne({ id: identityId }, { tokenVersion: 1 }).lean();
  const version = doc?.tokenVersion ?? 0;
  _identityCache.set(identityId, { version, fetchedAt: Date.now() });
  return version;
}

/**
 * Invalidate every outstanding token for an Identity, across every
 * school sharing its credential. Call this after a password/MFA change.
 */
async function revokeIdentityTokens(identityId) {
  await _model('identities').updateOne({ id: identityId }, { $inc: { tokenVersion: 1 } });
  _identityCache.delete(identityId);
}

module.exports = { getTokenVersion, revokeUserTokens, getIdentityTokenVersion, revokeIdentityTokens };
