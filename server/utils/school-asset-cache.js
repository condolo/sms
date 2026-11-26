/* ============================================================
   In-process cache for public school branding assets.

   /api/public/school-asset/* used to read up to 2MB of base64 from
   MongoDB and decode it synchronously on the event loop on EVERY
   cold request (new device, email client, PDF self-fetch). Cache
   the decoded Buffer plus a content ETag so repeat reads are
   memory-only and browsers can revalidate with a 304.

   Uploads/clears call invalidate() so an admin change is visible
   immediately. Entries expire even without an invalidation so a
   stale asset can never live longer than HIT_TTL_MS.
   ============================================================ */
'use strict';

const { createHash } = require('crypto');

const HIT_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 30 * 1000;
const MAX_ENTRIES = 500;

const _cache = new Map();

function keyOf(schoolId, type) {
  return `${schoolId}|${type}`;
}

function get(schoolId, type) {
  const key = keyOf(schoolId, type);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _cache.delete(key);
    return null;
  }
  return entry;
}

function _remember(key, entry) {
  if (_cache.size >= MAX_ENTRIES) {
    _cache.delete(_cache.keys().next().value);
  }
  _cache.set(key, entry);
}

function setHit(schoolId, type, buffer, mime) {
  const etag = `"${createHash('sha256').update(buffer).digest('base64').slice(0, 24)}"`;
  _remember(keyOf(schoolId, type), {
    miss: false,
    buffer,
    mime,
    etag,
    expiresAt: Date.now() + HIT_TTL_MS,
  });
  return etag;
}

function setMiss(schoolId, type) {
  _remember(keyOf(schoolId, type), {
    miss: true,
    expiresAt: Date.now() + MISS_TTL_MS,
  });
}

/** Invalidate one asset type, or all assets for a school when type is omitted. */
function invalidate(schoolId, type) {
  if (!schoolId) return;
  if (type) {
    _cache.delete(keyOf(schoolId, type));
    return;
  }
  const prefix = `${schoolId}|`;
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

module.exports = { get, setHit, setMiss, invalidate, HIT_TTL_MS, MISS_TTL_MS };
