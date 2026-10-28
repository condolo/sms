/* ============================================================
   server/utils/password-ticket.js — the primitive behind
   POST /auth/force-change and the forgot/reset flow.

   It replaced an endpoint that set a password from a bare client-supplied
   `userId` with no proof at all, so the properties that matter here are the
   ones that make that impossible:
     - unguessable, and never stored in plaintext
     - single-use (spent by clearing the fields)
     - expiring, decided by the stored timestamp
     - purpose-scoped, so one kind cannot be replayed as the other
   ============================================================ */
'use strict';

const crypto = require('crypto');
const ticket = require('../../utils/password-ticket');
const {
  issueTicket, ticketFilter, clearTicketSet, isLiveTicket, hashTicket,
  FIELD_HASH, FIELD_PURPOSE, FIELD_EXPIRY,
} = ticket;

describe('issueTicket', () => {
  test('returns a 64-hex CSPRNG token and stores only its hash', () => {
    const { token, set } = issueTicket('reset');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(set[FIELD_HASH]).toBe(hashTicket(token));
    // The plaintext must not appear anywhere in what gets stored.
    expect(JSON.stringify(set)).not.toContain(token);
    expect(set[FIELD_PURPOSE]).toBe('reset');
  });

  test('two tickets for the same user are different', () => {
    const a = issueTicket('reset');
    const b = issueTicket('reset');
    expect(a.token).not.toBe(b.token);
    expect(a.set[FIELD_HASH]).not.toBe(b.set[FIELD_HASH]);
  });

  test('reset outlives forceChange — one sits in an inbox, the other does not', () => {
    const now = Date.now();
    const reset = issueTicket('reset', { now });
    const force = issueTicket('forceChange', { now });

    expect(new Date(reset.set[FIELD_EXPIRY]).getTime()).toBeGreaterThan(
      new Date(force.set[FIELD_EXPIRY]).getTime(),
    );
  });

  test('rejects an unknown purpose rather than minting something unscoped', () => {
    expect(() => issueTicket('anything-else')).toThrow(/unknown purpose/);
  });
});

describe('ticketFilter', () => {
  test('selects on hash, purpose and an unexpired window — all three', () => {
    const { token, set } = issueTicket('reset', { now: 1_000_000 });
    const f = ticketFilter(token, 'reset', { now: 1_000_000 + 1000 });

    expect(f[FIELD_HASH]).toBe(set[FIELD_HASH]);
    expect(f[FIELD_PURPOSE]).toBe('reset');
    expect(f[FIELD_EXPIRY].$gt).toBeDefined();
  });

  test('an expired ticket produces a window that cannot match', () => {
    const { token } = issueTicket('reset', { now: 1_000_000 });
    // "now" is past that ticket's expiry.
    const f = ticketFilter(token, 'reset', { now: 1_000_000 + 60 * 60 * 1000 + 1 });
    const expiry = new Date(f[FIELD_EXPIRY].$gt).getTime();
    expect(expiry).toBeGreaterThan(1_000_000);
  });

  test('a different purpose yields a different filter (no cross-purpose replay)', () => {
    const { token } = issueTicket('reset');
    expect(ticketFilter(token, 'reset')[FIELD_HASH]).toBe(ticketFilter(token, 'reset')[FIELD_HASH]);
    // same token, wrong purpose => the purpose field differs, so no match
    expect(ticketFilter(token, 'reset')[FIELD_PURPOSE]).not.toBe(
      ticketFilter(token, 'forceChange')[FIELD_PURPOSE],
    );
  });

  test('a missing or non-string token yields no filter at all', () => {
    expect(ticketFilter(null, 'reset')).toBeNull();
    expect(ticketFilter('', 'reset')).toBeNull();
    expect(ticketFilter(123, 'reset')).toBeNull();
  });
});

describe('isLiveTicket', () => {
  const NOW = 1_700_000_000_000;

  function userWith(opts) {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: opts.ttlMs });
    return { ...set, ...(opts.overrides || {}) };
  }

  test('accepts a matching, unexpired, correctly-purposed ticket', () => {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    expect(isLiveTicket({ ...set }, token, 'reset', { now: NOW + 30_000 })).toBe(true);
  });

  test('rejects once expired', () => {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: 1_000 });
    expect(isLiveTicket({ ...set }, token, 'reset', { now: NOW + 1_001 })).toBe(false);
  });

  test('rejects the right token used for the WRONG purpose', () => {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    expect(isLiveTicket({ ...set }, token, 'forceChange', { now: NOW })).toBe(false);
  });

  test('rejects a different token', () => {
    const { set } = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    const other = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    expect(isLiveTicket({ ...set }, other.token, 'reset', { now: NOW })).toBe(false);
  });

  test('rejects a spent ticket (cleared fields)', () => {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    const spent = { ...set, ...clearTicketSet() };
    expect(isLiveTicket(spent, token, 'reset', { now: NOW })).toBe(false);
  });

  test('rejects an empty stored hash without comparing — no timingSafeEqual throw', () => {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    // Differing lengths must be rejected before timingSafeEqual, which throws.
    expect(isLiveTicket({ ...set, [FIELD_HASH]: '' }, token, 'reset', { now: NOW })).toBe(false);
    expect(isLiveTicket({ ...set, [FIELD_HASH]: 'abc' }, token, 'reset', { now: NOW })).toBe(false);
  });

  test('rejects a missing user, token or expiry', () => {
    const { token, set } = issueTicket('reset', { now: NOW, ttlMs: 60_000 });
    expect(isLiveTicket(null, token, 'reset', { now: NOW })).toBe(false);
    expect(isLiveTicket({ ...set }, null, 'reset', { now: NOW })).toBe(false);
    expect(isLiveTicket({ ...set, [FIELD_EXPIRY]: null }, token, 'reset', { now: NOW })).toBe(false);
  });
});

describe('clearTicketSet', () => {
  test('nulls all three fields', () => {
    const cleared = clearTicketSet();
    expect(cleared[FIELD_HASH]).toBeNull();
    expect(cleared[FIELD_PURPOSE]).toBeNull();
    expect(cleared[FIELD_EXPIRY]).toBeNull();
  });
});

describe('hashTicket', () => {
  test('is stable, and is not the input', () => {
    const t = crypto.randomBytes(32).toString('hex');
    expect(hashTicket(t)).toBe(hashTicket(t));
    expect(hashTicket(t)).not.toBe(t);
    expect(hashTicket(t)).toHaveLength(64);
  });

  test('handles empty input without throwing', () => {
    expect(() => hashTicket('')).not.toThrow();
    expect(() => hashTicket(undefined)).not.toThrow();
  });
});
