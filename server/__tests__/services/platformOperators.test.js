/* ============================================================
   server/services/platformOperators.js — unit tests

   The three guarantees that must never regress:
     1. no escalation (cannot grant what you don't hold)
     2. invite tokens are hashed, single-use and expiring
     3. input parsing rejects role/template values that don't exist
   ============================================================ */

const ops = require('../../services/platformOperators');

describe('invite tokens', () => {
  test('a token is random and its stored hash is a sha256, not the token', () => {
    const a = ops.generateInviteToken();
    const b = ops.generateInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);

    const hash = ops.hashInviteToken(a);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(a);           // the clear token is never stored
    expect(ops.hashInviteToken(a)).toBe(hash); // deterministic
    expect(ops.hashInviteToken(b)).not.toBe(hash);
  });

  test('the expiry is in the future and matches the declared TTL', () => {
    const now = Date.now();
    const expires = new Date(ops.inviteExpiryFrom(now)).getTime();
    expect(expires).toBe(now + ops.INVITE_TTL_MS);
    expect(expires).toBeGreaterThan(now);
  });
});

describe('escalationViolations() — no escalation', () => {
  test('an owner (wildcard) may grant anything', () => {
    expect(ops.escalationViolations(['*'], ['schools.delete', 'operators.manage'])).toEqual([]);
  });

  test('granting capabilities the actor holds is allowed', () => {
    expect(ops.escalationViolations(['tickets.manage', 'tickets.view'], ['tickets.manage'])).toEqual([]);
  });

  test('granting a capability the actor lacks is flagged', () => {
    expect(ops.escalationViolations(['tickets.view'], ['tickets.view', 'schools.delete'])).toEqual(['schools.delete']);
  });

  test('a non-owner can never mint an owner — the wildcard itself is a grant', () => {
    expect(ops.escalationViolations(['tickets.manage', 'operators.manage'], ['*'])).toEqual(['*']);
  });

  test('a missing actor capability set grants nothing', () => {
    expect(ops.escalationViolations(undefined, ['tickets.view'])).toEqual(['tickets.view']);
  });
});

describe('projectedCapabilities()', () => {
  test('resolves a template plus overrides into the effective set', () => {
    expect(ops.projectedCapabilities({ template: 'billing', capabilities: ['tickets.view'] }))
      .toEqual(expect.arrayContaining(['billing.view', 'schools.view', 'tickets.view']));
  });
  test('owner template projects to the wildcard', () => {
    expect(ops.projectedCapabilities({ template: 'owner', capabilities: [] })).toEqual(['*']);
  });
});

describe('isOwner()', () => {
  test('true for either the tier or the owner template', () => {
    expect(ops.isOwner({ tier: 'owner' })).toBe(true);
    expect(ops.isOwner({ tier: 'support', template: 'owner' })).toBe(true);
  });
  test('false for every other role', () => {
    expect(ops.isOwner({ tier: 'support', template: 'support_agent' })).toBe(false);
    expect(ops.isOwner({})).toBe(false);
  });
});

describe('parseOperatorInput()', () => {
  test('invite requires a name and a valid email', () => {
    expect(ops.parseOperatorInput({ email: 'x@msingi.io' }, { requireName: true }).ok).toBe(false);
    expect(ops.parseOperatorInput({ name: 'A', email: 'not-an-email' }, { requireName: true }).ok).toBe(false);
    expect(ops.parseOperatorInput({ name: 'A', email: 'a@msingi.io' }, { requireName: true }).ok).toBe(true);
  });

  test('rejects an unknown role template', () => {
    const r = ops.parseOperatorInput({ name: 'A', email: 'a@msingi.io', template: 'superuser' }, { requireName: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown role template/);
  });

  test('defaults the template for an invite and normalises the email + capabilities', () => {
    const r = ops.parseOperatorInput({ name: '  Ada  ', email: 'ADA@Msingi.IO', capabilities: ['tickets.manage', 'bogus'] }, { requireName: true });
    expect(r.ok).toBe(true);
    expect(r.value.email).toBe('ada@msingi.io');
    expect(r.value.name).toBe('Ada');
    expect(r.value.template).toBe('viewer');
    expect(r.value.capabilities).toEqual(['tickets.manage']); // 'bogus' dropped
  });

  test('an update (no name required) leaves the template undefined when omitted', () => {
    const r = ops.parseOperatorInput({ title: 'Support Lead' });
    expect(r.ok).toBe(true);
    expect(r.value.template).toBeUndefined();
  });
});
