/* ============================================================
   Msingi — Password tickets

   The missing primitive behind two things that were wrong:

   1. POST /auth/force-change set a new password from nothing but a
      client-supplied `userId`. It had no authMiddleware, no rbac() and no
      token, so an anonymous caller could take over any account by guessing
      an id. It now demands a ticket — which only exists after something was
      actually proved.

   2. There was no forgot-password flow at all.

   A ticket is a single-use secret that says "whoever holds this has already
   proved they may set this account's password, once, until <time>".

   Storage is on the user document, HASHED — a database read does not hand
   the holder a working link, the same rule link-codes.js follows for child
   link codes. `purpose` keeps the two kinds apart so a ticket minted for an
   in-request password change cannot be replayed as an emailed reset, or the
   reverse.

   Deliberately NOT reused from auth.js's _exchangeCodes: that store is an
   in-process Map with a 30-second TTL, fine for carrying a JWT across one
   redirect and useless for a link that sits in an inbox.
   ============================================================ */
'use strict';

const crypto = require('crypto');

/* One field per concept, so the filter and the $set can never drift. */
const FIELD_HASH    = 'pwdTicketHash';
const FIELD_PURPOSE = 'pwdTicketPurpose';
const FIELD_EXPIRY  = 'pwdTicketExpiresAt';

const PURPOSES = {
  /* Minted in-request (login said the password expired, or a 2FA code was
     just accepted) and used within the same sitting. */
  forceChange: { ttlMs: 15 * 60 * 1000 },
  /* Emailed. Has to survive an inbox, a mail scanner prefetching the link,
     and a human reading it later. */
  reset:       { ttlMs: 60 * 60 * 1000 },
};

/** sha256 of the raw token — what actually lands in the database. */
function hashTicket(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/**
 * Mint a ticket. Returns the RAW token (the only time it exists in plaintext)
 * and the fields to $set on the user document.
 *
 * @param {'forceChange'|'reset'} purpose
 * @param {{ ttlMs?: number, now?: number }} [opts] ttlMs/now are for tests.
 */
function issueTicket(purpose, opts = {}) {
  const spec = PURPOSES[purpose];
  if (!spec) throw new Error(`[password-ticket] unknown purpose '${purpose}'`);

  // 32 bytes = 64 hex chars, CSPRNG — not guessable, not enumerable.
  const token   = crypto.randomBytes(32).toString('hex');
  const ttlMs   = opts.ttlMs ?? spec.ttlMs;
  const nowMs   = opts.now   ?? Date.now();

  return {
    token,
    set: {
      [FIELD_HASH]:    hashTicket(token),
      [FIELD_PURPOSE]: purpose,
      [FIELD_EXPIRY]:  new Date(nowMs + ttlMs).toISOString(),
    },
  };
}

/**
 * Query filter that selects ONLY the user holding this live ticket for this
 * purpose. Expiry is decided by the database, not by the caller, so a stale
 * ticket cannot be resurrected by a clock skew on the app server.
 *
 * @param {string} token
 * @param {'forceChange'|'reset'} purpose
 * @param {{ now?: number }} [opts]
 */
function ticketFilter(token, purpose, opts = {}) {
  if (!token || typeof token !== 'string') return null;
  const nowMs = opts.now ?? Date.now();
  return {
    [FIELD_HASH]:    hashTicket(token),
    [FIELD_PURPOSE]: purpose,
    [FIELD_EXPIRY]:  { $gt: new Date(nowMs).toISOString() },
  };
}

/** Fields to $set when the ticket is spent, or when it must be invalidated. */
function clearTicketSet() {
  return {
    [FIELD_HASH]:    null,
    [FIELD_PURPOSE]: null,
    [FIELD_EXPIRY]:  null,
  };
}

/** True when the stored ticket matches this token AND is still live. */
function isLiveTicket(user, token, purpose, opts = {}) {
  if (!user || !token) return false;
  if (user[FIELD_PURPOSE] !== purpose) return false;

  const stored = user[FIELD_HASH];
  if (typeof stored !== 'string' || stored.length === 0) return false;

  // Constant-time: a length mismatch is rejected without comparing.
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(hashTicket(token), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const expiry = user[FIELD_EXPIRY];
  if (!expiry) return false;
  const nowMs = opts.now ?? Date.now();
  return new Date(expiry).getTime() > nowMs;
}

module.exports = {
  PURPOSES,
  FIELD_HASH, FIELD_PURPOSE, FIELD_EXPIRY,
  hashTicket, issueTicket, ticketFilter, clearTicketSet, isLiveTicket,
};
