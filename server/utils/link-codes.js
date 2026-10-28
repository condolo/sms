/* ============================================================
   Child-link codes — the office-issued short code that gives a guardian
   access to ONE child (board flow 03).

   The format lives here, in one file, because two very different routes
   have to agree on it exactly:
     - the office console issues one (POST /api/settings/link-codes)
     - the parent app redeems one  (POST /api/parent-portal/link/*)

   Design notes worth keeping:
   - The alphabet omits I, O, 0 and 1. These codes get read off a slip,
     written on a board, or spelled out over the phone, and "was that an
     O or a zero" is a support ticket every single time.
   - Stored as a SHA-256 hash, never in the clear: a leaked database dump
     must not be a list of working access codes. Single-use and revocable
     through `status`, and every redemption is audit-logged by the caller.
   - 24 hours by default. Long enough that the office can print a slip on
     Friday and the parent can link on Sunday, short enough that a code
     photographed over someone's shoulder is not a permanent key. It is
     env-tunable (LINK_CODE_TTL_HOURS) because the right window depends on
     how a school actually hands these out.
   ============================================================ */
'use strict';

const crypto = require('crypto');

const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const LINK_CODE_LENGTH   = 6;
const LINK_CODE_TTL_HOURS = Number(process.env.LINK_CODE_TTL_HOURS) || 24;

/** 6 characters ≈ 1.07 billion combinations at this alphabet — not guessable. */
function generateLinkCode() {
  const bytes = crypto.randomBytes(LINK_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) {
    out += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Uppercase, strip anything that is not A-Z0-9 (spaces, dashes a parent typed).
 * Normalising on BOTH sides is what makes "4k7-p2m" and "4K7P2M" the same code.
 */
function normaliseLinkCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashLinkCode(code) {
  return crypto.createHash('sha256').update(normaliseLinkCode(code)).digest('hex');
}

function linkCodeExpiry(from = new Date()) {
  return new Date(from.getTime() + LINK_CODE_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

module.exports = {
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_HOURS,
  generateLinkCode,
  normaliseLinkCode,
  hashLinkCode,
  linkCodeExpiry,
};
