/* ============================================================
   platformOperators.js — rules for managing platform team members.

   Kept separate from the route handlers so the three guarantees that
   actually matter can be unit-tested without a DB or an HTTP server:

     1. NO ESCALATION — you can never grant a capability you do not
        yourself hold (owners excepted). Otherwise a limited team member
        could mint themselves, or a colleague, an owner account.
     2. NEVER LOCK OUT THE LAST OWNER — suspending, demoting or removing
        the final active owner is refused, so the platform can't end up
        with nobody able to administer it.
     3. NO SELF-LOCKOUT — a member cannot remove their own
        operators.manage capability (the "I edited myself out" footgun).

   Also owns the invite-token helpers: a random token is emailed in the
   clear and only its SHA-256 hash is stored, single-use and expiring.
   ============================================================ */
'use strict';

const crypto = require('crypto');
const {
  TEMPLATES,
  resolveCapabilities,
  sanitizeCapabilities,
} = require('../config/platformCapabilities');

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}
function inviteExpiryFrom(now = Date.now()) {
  return new Date(now + INVITE_TTL_MS).toISOString();
}

/** Which of `granted` does `actorCaps` not itself hold? Owners hold '*'.
 *  The raw list is checked (not sanitized) so the owner sentinel '*' is
 *  itself treated as a grant — a non-owner can never mint an owner. */
function escalationViolations(actorCaps, granted) {
  const caps = Array.isArray(actorCaps) ? actorCaps : [];
  if (caps.includes('*')) return [];
  const have = new Set(caps);
  const list = Array.isArray(granted) ? granted : [];
  return [...new Set(list)].filter(c => !have.has(c));
}

/** The capability set a (template + overrides) pair would produce. */
function projectedCapabilities({ template, capabilities }) {
  return resolveCapabilities({ tier: 'support', template, capabilities });
}

/** Is this operator a full owner? */
function isOwner(op = {}) {
  return op.tier === 'owner' || op.template === 'owner';
}

/**
 * Validate/normalise invite or update input.
 * Returns { ok, value } or { ok:false, error }.
 */
function parseOperatorInput(body = {}, { requireName = false } = {}) {
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const title = String(body.title ?? '').trim().slice(0, 120);
  const template = body.template == null ? (requireName ? 'viewer' : undefined) : String(body.template);
  const capabilities = sanitizeCapabilities(body.capabilities);

  if (requireName) {
    if (!name) return { ok: false, error: 'Name is required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'A valid email address is required' };
  }
  if (template !== undefined && !TEMPLATES[template]) {
    return { ok: false, error: `Unknown role template: ${template}` };
  }
  return { ok: true, value: { name, email, title, template, capabilities } };
}

module.exports = {
  INVITE_TTL_MS,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFrom,
  escalationViolations,
  projectedCapabilities,
  isOwner,
  parseOperatorInput,
};
