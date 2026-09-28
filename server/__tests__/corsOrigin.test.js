/* ============================================================
   utils/corsOrigin.js — origin allowlist (security review, 2026-09)
   ============================================================ */
'use strict';

let mockSchools;
let mockOrgs;
jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return {
        find: () => ({
          select: () => ({ lean: () => Promise.resolve(mockSchools) }),
        }),
      };
    }
    if (collection === 'organizations') {
      return {
        // Real query filters { multiSchoolEnabled: true } server-side —
        // mirror that here so a test seeding a non-multi-school org into
        // mockOrgs would actually catch a regression, not just happen to
        // pass because the mock ignores the filter.
        find: (filter) => ({
          select: () => ({ lean: () => Promise.resolve(mockOrgs.filter(o => o.multiSchoolEnabled === filter.multiSchoolEnabled)) }),
        }),
      };
    }
    throw new Error('unexpected collection: ' + collection);
  }),
}));

const corsOrigin = require('../utils/corsOrigin');
const { isAllowedOrigin, _resetSlugCacheForTests, _setSlugCacheForTests, _refreshKnownSchoolSlugs } = corsOrigin;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  _resetSlugCacheForTests();
  mockSchools = [{ slug: 'trinitas' }, { slug: 'trinity' }];
  mockOrgs = [];
  process.env.NODE_ENV = 'production';
});
afterAll(() => { process.env.NODE_ENV = ORIGINAL_NODE_ENV; });

describe('the explicit ALLOWED_ORIGINS list', () => {
  test('the platform\'s own marketing/app domains are always allowed', () => {
    expect(isAllowedOrigin('https://msingi.io')).toBe(true);
    expect(isAllowedOrigin('https://www.msingi.io')).toBe(true);
  });

  test('a completely unrelated origin is rejected', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });
});

describe('NODE_ENV — the fail-open bug this closes', () => {
  test('an unrelated/misconfigured origin is rejected when NODE_ENV is exactly "production"', () => {
    process.env.NODE_ENV = 'production';
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  test('the same origin is ALSO rejected for an unset NODE_ENV — the actual bug: the old check (!== "production") would have allowed this', () => {
    delete process.env.NODE_ENV;
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  test('...and for a misspelled/unexpected value like "staging" or wrong-case "Production"', () => {
    process.env.NODE_ENV = 'staging';
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    process.env.NODE_ENV = 'Production';
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  test('only an explicit "development" or "test" value relaxes the check', () => {
    process.env.NODE_ENV = 'development';
    expect(isAllowedOrigin('https://evil.example.com')).toBe(true);
    process.env.NODE_ENV = 'test';
    expect(isAllowedOrigin('https://evil.example.com')).toBe(true);
  });
});

describe('*.msingi.io subdomain — cold cache (never loaded / DB unreachable)', () => {
  test('any shape-correct subdomain is allowed while the slug cache has never successfully loaded — must never lock out every real school over a DB hiccup', () => {
    expect(isAllowedOrigin('https://trinitas.msingi.io')).toBe(true);
    expect(isAllowedOrigin('https://totally-made-up-slug.msingi.io')).toBe(true); // the exact gap being closed, but only once the cache DOES load
  });

  test('a malformed subdomain shape is still rejected even cold (e.g. a bare msingi.io with no subdomain, or http not https)', () => {
    expect(isAllowedOrigin('https://msingi.io.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://trinitas.msingi.io')).toBe(false);
  });
});

describe('*.msingi.io subdomain — warm cache (the real fix)', () => {
  test('a real, currently-provisioned school slug is allowed', () => {
    _setSlugCacheForTests(['trinitas', 'trinity']);
    expect(isAllowedOrigin('https://trinitas.msingi.io')).toBe(true);
  });

  test('a shape-correct but NOT real/provisioned subdomain is now rejected — the actual hardening', () => {
    _setSlugCacheForTests(['trinitas', 'trinity']);
    expect(isAllowedOrigin('https://abandoned-or-attacker-registered.msingi.io')).toBe(false);
  });

  test('a stale cache (past TTL) still enforces against its last-known data for THIS request — "cold" only ever means "never loaded", not "old" — while a background refresh is kicked off for the next one', () => {
    _setSlugCacheForTests(['trinitas'], Date.now() - 10 * 60 * 1000); // 10 min old, TTL is 5
    expect(isAllowedOrigin('https://trinitas.msingi.io')).toBe(true);
    expect(isAllowedOrigin('https://some-newly-provisioned-school.msingi.io')).toBe(false);
  });
});

describe('_refreshKnownSchoolSlugs — the real DB-backed refresh', () => {
  test('populates the cache from real school documents', async () => {
    mockSchools = [{ slug: 'trinitas' }, { slug: 'trinity' }, { slug: null }]; // a null slug must never become a literal accepted subdomain
    await _refreshKnownSchoolSlugs();
    expect(isAllowedOrigin('https://trinitas.msingi.io')).toBe(true);
    expect(isAllowedOrigin('https://ghost-school.msingi.io')).toBe(false);
  });

  test('a DB failure leaves the cache cold (fail-open on shape only) rather than throwing', async () => {
    const model = require('../utils/model');
    model._model.mockImplementationOnce(() => ({ find: () => ({ select: () => ({ lean: () => Promise.reject(new Error('DB down')) }) }) }));
    await expect(_refreshKnownSchoolSlugs()).resolves.toBeUndefined();
    expect(isAllowedOrigin('https://anything-at-all.msingi.io')).toBe(true); // still cold — never locked every school out
  });
});

/* 2026-09-28 real production incident — see this file's header comment
   for the full story. A multi-school organization's own shared-portal
   slug (distinct from any of its member schools' slugs) was never in
   this cache, so once it warmed up in production, the org's real,
   currently-active portal subdomain got REJECTED by the exact hardening
   this file's own header describes as protecting against an ABANDONED
   subdomain — the opposite of what it's for. Reproduced live via
   `curl -H "Origin: https://tis.msingi.io"` against a real asset URL:
   500 with the header present, 200 without it or for a real school's
   origin — proving the origin check itself, not the deployed code or
   DNS, was rejecting a legitimate, currently-live production origin. */
describe('*.msingi.io subdomain — an ORGANIZATION\'s own shared-portal slug (2026-09-28 incident)', () => {
  test('a multi-school-enabled organization\'s own slug is allowed, even though it is not any member school\'s slug', async () => {
    mockOrgs = [{ slug: 'tis', multiSchoolEnabled: true }];
    await _refreshKnownSchoolSlugs();
    expect(isAllowedOrigin('https://tis.msingi.io')).toBe(true);
  });

  test('an organization that exists but has NOT opted into multiSchoolEnabled does not get a free pass at its slug', async () => {
    mockOrgs = [{ slug: 'not-yet-activated', multiSchoolEnabled: false }];
    await _refreshKnownSchoolSlugs();
    expect(isAllowedOrigin('https://not-yet-activated.msingi.io')).toBe(false);
  });

  test('a real school slug and a real org-portal slug are BOTH allowed from the same warm cache', async () => {
    mockOrgs = [{ slug: 'tis', multiSchoolEnabled: true }];
    await _refreshKnownSchoolSlugs();
    expect(isAllowedOrigin('https://trinitas.msingi.io')).toBe(true); // school
    expect(isAllowedOrigin('https://tis.msingi.io')).toBe(true);      // org portal
    expect(isAllowedOrigin('https://neither-one.msingi.io')).toBe(false);
  });
});
