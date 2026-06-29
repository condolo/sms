/* ============================================================
   Token Version Cache — lightweight JWT revocation via
   per-user version counter.

   Every issued JWT carries a `tv` (token version) integer.
   Calling revokeUserTokens(userId) increments the user's stored
   version in the DB, making all previously issued tokens for that
   user return 401 on their next request.

   The in-process cache (5-minute TTL) avoids a DB hit on every
   authenticated request.  Cache invalidation on revocation ensures
   the demotion takes effect within milliseconds.
   ============================================================ */
'use strict';

const { _model } = require('./model');

// Map<userId, { version: number, fetchedAt: number }>
const _cache    = new Map();
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

module.exports = { getTokenVersion, revokeUserTokens };
