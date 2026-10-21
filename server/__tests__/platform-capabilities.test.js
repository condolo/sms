/* ============================================================
   server/config/platformCapabilities.js — unit tests

   The capability registry is the single source of truth for what a
   platform operator may do, and the POLICY table decides which
   capability each (method, path) requires. Both are pure functions,
   so they are exercised directly here — no DB, no HTTP.
   ============================================================ */

const caps = require('../config/platformCapabilities');

describe('capability registry', () => {
  test('every capability key is unique and non-empty', () => {
    const keys = caps.CAPABILITIES.map(c => c.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach(k => expect(typeof k).toBe('string'));
    keys.forEach(k => expect(k).toMatch(/^[a-z]+(\.[a-z_]+)?$/));
  });

  test('every template references only known capabilities', () => {
    for (const [name, t] of Object.entries(caps.TEMPLATES)) {
      for (const c of t.caps) {
        if (c === '*') continue; // owner sentinel
        expect(caps.CAPABILITY_KEYS.has(c)).toBe(true);
      }
      expect(typeof t.label).toBe('string');
    }
    // sanity: templates we ship actually exist
    expect(Object.keys(caps.TEMPLATES)).toEqual(
      expect.arrayContaining(['owner', 'support_agent', 'onboarding', 'billing', 'content', 'viewer', 'custom'])
    );
  });

  test('every POLICY rule maps to a known capability or the owner/public sentinels', () => {
    for (const rule of caps.POLICY) {
      expect(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).toContain(rule.method);
      if (rule.cap === null) continue;               // any authenticated operator
      expect(caps.CAPABILITY_KEYS.has(rule.cap) || rule.cap === '*').toBe(true);
    }
  });
});

describe('resolveCapabilities()', () => {
  test('owner tier resolves to the wildcard regardless of stored fields', () => {
    expect(caps.resolveCapabilities({ tier: 'owner' })).toEqual(['*']);
    // even a deliberately wrong template cannot demote an owner
    expect(caps.resolveCapabilities({ tier: 'owner', template: 'viewer', capabilities: [] })).toEqual(['*']);
  });

  test('legacy support tier maps to the read-only viewer set (no escalation)', () => {
    const resolved = caps.resolveCapabilities({ tier: 'support' });
    expect(resolved).toEqual(expect.arrayContaining(['tickets.view', 'schools.view', 'billing.view', 'diagnostics.view']));
    // the whole point: creating this layer must not widen an existing account
    expect(resolved).not.toContain('tickets.manage');
    expect(resolved).not.toContain('onboarding.manage');
    expect(resolved).not.toContain('schools.manage');
    expect(resolved).not.toContain('impersonate');
    expect(resolved).not.toContain('*');
  });

  test('an explicit template is used and per-operator overrides are unioned on top', () => {
    const resolved = caps.resolveCapabilities({
      tier: 'support',
      template: 'onboarding',
      capabilities: ['billing.view'], // an extra grant beyond the template
    });
    expect(resolved).toEqual(expect.arrayContaining(['onboarding.manage', 'tickets.view', 'schools.view', 'billing.view']));
    expect(resolved).not.toContain('tickets.manage'); // not in the onboarding template, not granted
  });

  test('unknown capability strings in the stored override list are dropped', () => {
    const resolved = caps.resolveCapabilities({ tier: 'support', template: 'custom', capabilities: ['tickets.manage', 'not.a.real.cap', 42] });
    expect(resolved).toEqual(['tickets.manage']);
  });

  test('an operator with no template and no recognised tier falls back to custom (nothing)', () => {
    expect(caps.resolveCapabilities({})).toEqual([]);
  });
});

describe('hasCapability()', () => {
  test('a falsy requirement is always satisfied', () => {
    expect(caps.hasCapability([], null)).toBe(true);
    expect(caps.hasCapability(null, undefined)).toBe(true);
  });
  test('the wildcard satisfies any requirement', () => {
    expect(caps.hasCapability(['*'], 'schools.delete')).toBe(true);
  });
  test('a specific capability satisfies only itself', () => {
    expect(caps.hasCapability(['tickets.view'], 'tickets.view')).toBe(true);
    expect(caps.hasCapability(['tickets.view'], 'tickets.manage')).toBe(false);
  });
  test('a missing/!array capability set denies', () => {
    expect(caps.hasCapability(undefined, 'tickets.view')).toBe(false);
  });
});

describe('sanitizeCapabilities()', () => {
  test('filters to known keys and de-duplicates', () => {
    expect(caps.sanitizeCapabilities(['tickets.view', 'tickets.view', 'nope', null])).toEqual(['tickets.view']);
  });
  test('non-arrays become an empty list', () => {
    expect(caps.sanitizeCapabilities('tickets.view')).toEqual([]);
    expect(caps.sanitizeCapabilities(undefined)).toEqual([]);
  });
});

describe('requiredCapability() — the route policy table', () => {
  test('tickets: reads need tickets.view, writes need tickets.manage', () => {
    expect(caps.requiredCapability('GET', '/tickets')).toBe('tickets.view');
    expect(caps.requiredCapability('GET', '/tickets/tck_1')).toBe('tickets.view');
    expect(caps.requiredCapability('POST', '/tickets')).toBe('tickets.manage');
    expect(caps.requiredCapability('PATCH', '/tickets/tck_1')).toBe('tickets.manage');
    expect(caps.requiredCapability('POST', '/tickets/tck_1/messages')).toBe('tickets.manage');
  });

  test('onboarding: viewing vs approving are separate capabilities', () => {
    expect(caps.requiredCapability('GET', '/demo-requests')).toBe('onboarding.view');
    expect(caps.requiredCapability('POST', '/demo-requests/dr_1/approve')).toBe('onboarding.manage');
    expect(caps.requiredCapability('GET', '/schools/pending')).toBe('onboarding.view');
    expect(caps.requiredCapability('POST', '/schools/sch_1/approve')).toBe('onboarding.manage');
  });

  test('a specific rule wins over a broader one on the same path', () => {
    // DELETE /schools/all is destructive → schools.delete, not schools.manage,
    // and must not be shadowed by the /schools/:id rule.
    expect(caps.requiredCapability('DELETE', '/schools/all')).toBe('schools.delete');
    expect(caps.requiredCapability('DELETE', '/schools/sch_1')).toBe('schools.delete');
    expect(caps.requiredCapability('PATCH', '/schools/sch_1')).toBe('schools.manage');
  });

  test('impersonation and cross-school search are their own capabilities', () => {
    expect(caps.requiredCapability('POST', '/schools/sch_1/impersonate')).toBe('impersonate');
    expect(caps.requiredCapability('GET', '/users/search')).toBe('users.search');
  });

  test('the work queue is explicitly open to any authenticated operator', () => {
    expect(caps.requiredCapability('GET', '/my-work')).toBe(null);
  });

  test('trailing slashes and query strings do not defeat matching', () => {
    expect(caps.requiredCapability('GET', '/tickets/')).toBe('tickets.view');
    expect(caps.requiredCapability('GET', '/tickets?status=open')).toBe('tickets.view');
  });

  test('an unknown route returns undefined so the caller can apply the legacy default', () => {
    expect(caps.requiredCapability('POST', '/some/new/route')).toBeUndefined();
    expect(caps.requiredCapability('GET', '/some/new/route')).toBeUndefined();
  });
});

describe('template boundary — the intent of each shipped role', () => {
  test('support_agent can work tickets and onboarding but cannot impersonate, delete schools or manage entitlements', () => {
    const c = caps.resolveCapabilities({ tier: 'support', template: 'support_agent' });
    expect(caps.hasCapability(c, 'tickets.manage')).toBe(true);
    expect(caps.hasCapability(c, 'onboarding.manage')).toBe(true);
    expect(caps.hasCapability(c, 'impersonate')).toBe(false);
    expect(caps.hasCapability(c, 'schools.delete')).toBe(false);
    expect(caps.hasCapability(c, 'schools.manage')).toBe(false);
    expect(caps.hasCapability(c, 'operators.manage')).toBe(false);
  });

  test('billing and content roles are narrowly scoped', () => {
    const billing = caps.resolveCapabilities({ tier: 'support', template: 'billing' });
    expect(caps.hasCapability(billing, 'billing.view')).toBe(true);
    expect(caps.hasCapability(billing, 'tickets.manage')).toBe(false);
    const content = caps.resolveCapabilities({ tier: 'support', template: 'content' });
    expect(caps.hasCapability(content, 'content.manage')).toBe(true);
    expect(caps.hasCapability(content, 'billing.view')).toBe(false);
  });
});
