/* ============================================================
   InnoLearn — In-Memory TTL Cache  (js/cache.js)

   Prevents redundant API fetches when navigating between pages.
   Default TTL: 2 minutes per collection.

   Usage:
     Cache.set('students', rows, 120000);   // 2 minutes
     const rows = Cache.get('students');    // null if expired
     Cache.invalidate('students');          // bust one key
     Cache.invalidate();                    // bust everything
     Cache.invalidatePrefix('behaviour_'); // bust all behaviour_*
   ============================================================ */

const Cache = (() => {
  const _store  = new Map();             // key → { data, expiresAt }
  const DEFAULT = 2 * 60 * 1000;        // 2 minutes

  function set(key, data, ttl = DEFAULT) {
    _store.set(key, { data, expiresAt: Date.now() + ttl });
  }

  function get(key) {
    const entry = _store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { _store.delete(key); return null; }
    return entry.data;
  }

  function has(key) {
    const entry = _store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { _store.delete(key); return false; }
    return true;
  }

  /**
   * Remove one key or all keys.
   * @param {string} [key] - Omit to clear everything.
   */
  function invalidate(key) {
    if (key !== undefined) _store.delete(key);
    else _store.clear();
  }

  /**
   * Remove all keys that start with the given prefix.
   * e.g., invalidatePrefix('behaviour_') removes behaviour_incidents, behaviour_appeals, etc.
   */
  function invalidatePrefix(prefix) {
    for (const k of _store.keys()) {
      if (k.startsWith(prefix)) _store.delete(k);
    }
  }

  /** Debug: list all live cache keys with TTL remaining */
  function debug() {
    const now = Date.now();
    const keys = [];
    for (const [k, v] of _store.entries()) {
      const remaining = Math.max(0, Math.round((v.expiresAt - now) / 1000));
      keys.push(`${k} (${remaining}s left)`);
    }
    console.log('[Cache]', keys.length ? keys.join(' | ') : 'empty');
  }

  return { set, get, has, invalidate, invalidatePrefix, debug };
})();
