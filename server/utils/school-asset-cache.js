/* ============================================================
   In-process cache for public school branding assets.

   /api/public/school-asset/* used to read up to 2MB of base64 from
   MongoDB and decode it synchronously on the event loop on EVERY
   cold request (new device, email client, PDF self-fetch). Cache
   the decoded Buffer plus a content ETag so repeat reads are
   memory-only and browsers can revalidate with a 304.

   Scaling / concurrency contract:
   - LRU, not FIFO: reads touch recency so hot logos survive churn.
   - BOTH an entry cap and a byte cap (a 2MB login background is very
     different from a 5KB favicon).
   - Single-flight: concurrent misses share one Mongo read + decode.
   - Generation-safe invalidation: a read started before an upload/delete
     cannot repopulate the cache with the old asset after invalidation.

   Uploads/clears call invalidate() so an admin change is visible
   immediately in this process. Entries also expire so a stale asset
   cannot live longer than HIT_TTL_MS. Multi-instance invalidation still
   requires a shared pub/sub or versioned key; see docs/perf/*.
   ============================================================ */
'use strict';

const { createHash } = require('crypto');

const HIT_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 30 * 1000;
const MAX_ENTRIES = 500;
const MAX_BYTES = 64 * 1024 * 1024;

const _cache = new Map();       // insertion order = least recently used first
const _inflight = new Map();    // key -> Promise
const _generation = new Map();  // key -> invalidation generation
let _bytes = 0;

function keyOf(schoolId, type) {
  return `${schoolId}|${type}`;
}

function generationOf(key) {
  return _generation.get(key) ?? 0;
}

function _drop(key) {
  const entry = _cache.get(key);
  if (!entry) return;
  _bytes -= entry.bytes || 0;
  _cache.delete(key);
}

function _evictIfNeeded(incomingBytes = 0) {
  while (_cache.size >= MAX_ENTRIES || _bytes + incomingBytes > MAX_BYTES) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _drop(oldestKey);
  }
}

function get(schoolId, type) {
  const key = keyOf(schoolId, type);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _drop(key);
    return null;
  }
  // LRU touch: delete + reinsert moves this key to the newest position.
  _cache.delete(key);
  _cache.set(key, entry);
  return entry;
}

function setHit(schoolId, type, buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_BYTES) return null;
  const key = keyOf(schoolId, type);
  _drop(key);
  _evictIfNeeded(buffer.length);
  const etag = `"${createHash('sha256').update(buffer).digest('base64').slice(0, 24)}"`;
  _cache.set(key, {
    miss: false,
    buffer,
    mime,
    etag,
    bytes: buffer.length,
    expiresAt: Date.now() + HIT_TTL_MS,
  });
  _bytes += buffer.length;
  return etag;
}

function setMiss(schoolId, type) {
  const key = keyOf(schoolId, type);
  _drop(key);
  _evictIfNeeded(0);
  _cache.set(key, { miss: true, bytes: 0, expiresAt: Date.now() + MISS_TTL_MS });
}

/**
 * Return a cached entry or share one in-flight load.
 * loader() resolves to { buffer, mime } or null (a miss).
 */
async function getOrLoad(schoolId, type, loader) {
  const key = keyOf(schoolId, type);
  const hit = get(schoolId, type);
  if (hit) return hit;
  if (_inflight.has(key)) return _inflight.get(key);

  const generation = generationOf(key);
  const promise = Promise.resolve()
    .then(loader)
    .then((entry) => {
      // No await between this check and setHit, so invalidation cannot
      // interleave inside the same Node process.
      if (generationOf(key) !== generation) return null;
      if (!entry?.buffer) {
        setMiss(schoolId, type);
        return { miss: true };
      }
      const etag = setHit(schoolId, type, entry.buffer, entry.mime);
      return get(schoolId, type) || { miss: false, buffer: entry.buffer, mime: entry.mime, etag };
    })
    .finally(() => {
      _inflight.delete(key);
    });
  _inflight.set(key, promise);
  return promise;
}

/** Invalidate one asset type, or all assets for a school when type is omitted. */
function invalidate(schoolId, type) {
  if (!schoolId) return;
  if (type) {
    const key = keyOf(schoolId, type);
    _generation.set(key, generationOf(key) + 1);
    _drop(key);
    return;
  }
  const prefix = `${schoolId}|`;
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _drop(key);
  }
  for (const key of _inflight.keys()) {
    if (key.startsWith(prefix)) _generation.set(key, generationOf(key) + 1);
  }
}

module.exports = {
  get, setHit, setMiss, getOrLoad, invalidate,
  HIT_TTL_MS, MISS_TTL_MS, MAX_ENTRIES, MAX_BYTES,
};
