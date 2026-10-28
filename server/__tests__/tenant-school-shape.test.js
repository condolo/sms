/* ============================================================
   Unit tests — server/middleware/tenant.js  (_mapSchoolDoc)

   Verifies the "session-safe school shape" contract:
   every field a frontend module reads from session.school
   must be present and carry a safe default — never undefined.

   Run: npm test
   ============================================================ */

const { _mapSchoolDoc, CURRENCY_SYMBOLS } = require('../middleware/tenant');

/* ── Helper: build a minimal fake Mongoose lean doc ─────────── */
function minimalDoc(overrides = {}) {
  return {
    _id:   '507f1f77bcf86cd799439011',   // ObjectId string (lean always has _id)
    slug:  'demo',
    name:  'Demo School',
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════
   Identity fields
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — identity fields', () => {
  test('returns doc.id when present (custom string id)', () => {
    const doc = minimalDoc({ id: 'sch_demo_001' });
    expect(_mapSchoolDoc(doc).id).toBe('sch_demo_001');
  });

  test('falls back to _id.toString() when doc.id is absent', () => {
    const doc = minimalDoc();                         // no custom id
    expect(_mapSchoolDoc(doc).id).toBe('507f1f77bcf86cd799439011');
  });

  test('returns slug and name as-is', () => {
    const result = _mapSchoolDoc(minimalDoc({ slug: 'greenwood', name: 'Greenwood Academy' }));
    expect(result.slug).toBe('greenwood');
    expect(result.name).toBe('Greenwood Academy');
  });

  test('shortName falls back to name when missing', () => {
    const result = _mapSchoolDoc(minimalDoc());
    expect(result.shortName).toBe('Demo School');
  });

  test('shortName uses doc.shortName when provided', () => {
    const result = _mapSchoolDoc(minimalDoc({ shortName: 'Demo' }));
    expect(result.shortName).toBe('Demo');
  });

  test('logoUrl is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).logoUrl).toBeNull();
  });

  test('systemEmail is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).systemEmail).toBeNull();
  });

  test('adminEmail is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).adminEmail).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Plan / subscription fields
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — plan fields', () => {
  test('plan defaults to "core"', () => {
    expect(_mapSchoolDoc(minimalDoc()).plan).toBe('core');
  });

  test('plan uses doc.plan when provided', () => {
    expect(_mapSchoolDoc(minimalDoc({ plan: 'standard' })).plan).toBe('standard');
  });

  test('addOns defaults to empty array', () => {
    const result = _mapSchoolDoc(minimalDoc());
    expect(Array.isArray(result.addOns)).toBe(true);
    expect(result.addOns).toHaveLength(0);
  });

  test('isActive defaults to true when field is missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).isActive).toBe(true);
  });

  test('isActive is false when doc.isActive is explicitly false', () => {
    expect(_mapSchoolDoc(minimalDoc({ isActive: false })).isActive).toBe(false);
  });

  test('planExpiresAt is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).planExpiresAt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Branding / theme fields
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — branding fields', () => {
  test('primaryColor defaults to #4f46e5', () => {
    expect(_mapSchoolDoc(minimalDoc()).primaryColor).toBe('#4f46e5');
  });

  test('accentColor defaults to #7c3aed', () => {
    expect(_mapSchoolDoc(minimalDoc()).accentColor).toBe('#7c3aed');
  });

  test('themePreset is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).themePreset).toBeNull();
  });

  test('primaryColor and accentColor pass through from doc', () => {
    const doc = minimalDoc({ primaryColor: '#ff0000', accentColor: '#00ff00' });
    const result = _mapSchoolDoc(doc);
    expect(result.primaryColor).toBe('#ff0000');
    expect(result.accentColor).toBe('#00ff00');
  });

  test('themePreset passes through from doc', () => {
    expect(_mapSchoolDoc(minimalDoc({ themePreset: 'ocean' })).themePreset).toBe('ocean');
  });

  test('faviconUrl is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).faviconUrl).toBeNull();
  });

  test('faviconUrl passes through from doc', () => {
    const doc = minimalDoc({ faviconUrl: 'https://cdn.example.com/favicon.ico' });
    expect(_mapSchoolDoc(doc).faviconUrl).toBe('https://cdn.example.com/favicon.ico');
  });

  test('moduleConfig is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).moduleConfig).toBeNull();
  });

  test('moduleConfig passes through from doc when set', () => {
    const cfg = { finance: true, hostel: false };
    const doc = minimalDoc({ moduleConfig: cfg });
    expect(_mapSchoolDoc(doc).moduleConfig).toEqual(cfg);
  });
});

/* ══════════════════════════════════════════════════════════════
   Currency — the field that regressed (USD instead of KES)
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — currency (regression)', () => {
  test('currency defaults to KES, NOT USD', () => {
    // This is the regression: previously _findSchool didn't pass currency through,
    // causing the frontend to silently fall back to its hardcoded default.
    const result = _mapSchoolDoc(minimalDoc());
    expect(result.currency).toBe('KES');
    expect(result.currency).not.toBe('USD');
  });

  test('currencySymbol for KES is "KSh"', () => {
    expect(_mapSchoolDoc(minimalDoc()).currencySymbol).toBe('KSh');
  });

  test('currency passes through from doc when set', () => {
    expect(_mapSchoolDoc(minimalDoc({ currency: 'USD' })).currency).toBe('USD');
  });

  test('currencySymbol is "$" when currency is USD', () => {
    expect(_mapSchoolDoc(minimalDoc({ currency: 'USD' })).currencySymbol).toBe('$');
  });

  test('currencySymbol uses doc.currencySymbol override when provided', () => {
    // Explicit override takes precedence over the derived symbol
    const doc = minimalDoc({ currency: 'KES', currencySymbol: 'KES' });
    expect(_mapSchoolDoc(doc).currencySymbol).toBe('KES');
  });

  test('all common African currencies map to a symbol', () => {
    const africaCodes = ['KES', 'UGX', 'TZS', 'RWF', 'ETB', 'ZAR', 'NGN', 'GHS', 'XOF', 'XAF'];
    for (const code of africaCodes) {
      const result = _mapSchoolDoc(minimalDoc({ currency: code }));
      expect(result.currencySymbol).not.toBe(code); // should be a symbol, not the code itself
      expect(result.currencySymbol.length).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   Regional fields
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — regional fields', () => {
  test('timezone defaults to Africa/Nairobi', () => {
    expect(_mapSchoolDoc(minimalDoc()).timezone).toBe('Africa/Nairobi');
  });

  test('country is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).country).toBeNull();
  });

  test('timezone passes through from doc', () => {
    expect(_mapSchoolDoc(minimalDoc({ timezone: 'Africa/Lagos' })).timezone).toBe('Africa/Lagos');
  });
});

/* ══════════════════════════════════════════════════════════════
   Academic fields
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — academic fields', () => {
  test('academicYear is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).academicYear).toBeNull();
  });

  test('termsPerYear is null when missing', () => {
    expect(_mapSchoolDoc(minimalDoc()).termsPerYear).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Contract completeness — no undefined values for required fields
══════════════════════════════════════════════════════════════ */
describe('_mapSchoolDoc — no undefined required fields', () => {
  // Every field a client module reads must be present (null is ok; undefined is a bug)
  const REQUIRED_FIELDS = [
    'id', 'slug', 'name', 'shortName', 'logoUrl', 'systemEmail', 'adminEmail',
    'plan', 'addOns', 'isActive', 'planExpiresAt', 'planExpired',
    // Demo lifecycle — read by login (MFA bypass / expiry) and by every
    // signed-in request in middleware/auth.js.
    'status', 'isDemo', 'expiresAt', 'demoExpired',
    'primaryColor', 'accentColor', 'themePreset', 'faviconUrl',
    // The school's own line — shown on the app's launch splash.
    'tagline',
    'moduleConfig',
    'portalConfig',
    'admissionConfig',
    'currency', 'currencySymbol', 'timezone', 'country',
    'academicYear', 'termsPerYear',
  ];

  test('demo fields default safely for a non-demo school', () => {
    const result = _mapSchoolDoc(minimalDoc());
    expect(result.isDemo).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(result.demoExpired).toBe(false);
    expect(result.status).toBeNull();
  });

  test('all required fields are present (not undefined) on a minimal doc', () => {
    const result = _mapSchoolDoc(minimalDoc());
    for (const field of REQUIRED_FIELDS) {
      expect(result).toHaveProperty(field);
      expect(result[field]).not.toBeUndefined();
    }
  });

  test('result contains no extra unexpected keys that could indicate structural drift', () => {
    const result = _mapSchoolDoc(minimalDoc());
    const actualKeys = Object.keys(result).sort();
    const expectedKeys = [...REQUIRED_FIELDS].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});

/* ══════════════════════════════════════════════════════════════
   The tenant projection must cover the mapper
   ══════════════════════════════════════════════════════════════
   _findSchool projects the school document rather than pulling it whole —
   an unprojected read dragged logoBase64/loginBgBase64 (1-2MB+) through
   tenantMiddleware on EVERY school-scoped request, which measured ~5-6s per
   request in production.

   The danger of a projection is silence: a field the mapper reads but the
   projection omits resolves to undefined and then to that field's default,
   with no error anywhere — a school's real currency quietly becoming 'KES'.
   The shape tests above cannot catch that, because they feed the mapper a
   hand-built doc and never touch the query. This one reads both lists out of
   the source and asserts the projection is a superset. */
describe('_findSchool projection covers every field _mapSchoolDoc reads', () => {
  const fs   = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'tenant.js'), 'utf8');

  test('no field is read by the mapper but missing from SCHOOL_FIELDS', () => {
    const mapper = src.slice(
      src.indexOf('function _mapSchoolDoc'),
      src.indexOf('const SCHOOL_FIELDS'),
    );
    // _id deliberately needs no entry: MongoDB returns it unless excluded.
    const reads = new Set(
      [...mapper.matchAll(/doc\.([A-Za-z_]+)/g)].map(m => m[1]).filter(f => f !== '_id'),
    );
    const listed = new Set(
      [...(src.match(/const SCHOOL_FIELDS = \[([\s\S]*?)\]/)?.[1] || '')
        .matchAll(/'([^']+)'/g)].map(m => m[1]),
    );

    // Sanity: if either extraction silently failed, the assertion below would
    // pass vacuously — so assert the extractions found something first.
    expect(reads.size).toBeGreaterThan(20);
    expect(listed.size).toBeGreaterThan(20);

    expect([...reads].filter(f => !listed.has(f))).toEqual([]);
  });

  test('_findSchool actually applies the projection', () => {
    expect(src).toMatch(/findOne\(filter\)\.select\(SCHOOL_FIELDS\)\.lean\(\)/);
  });
});

/* ══════════════════════════════════════════════════════════════
   CURRENCY_SYMBOLS export
══════════════════════════════════════════════════════════════ */
describe('CURRENCY_SYMBOLS', () => {
  test('is exported and is a plain object', () => {
    expect(typeof CURRENCY_SYMBOLS).toBe('object');
    expect(CURRENCY_SYMBOLS).not.toBeNull();
  });

  test('contains KES → KSh', () => {
    expect(CURRENCY_SYMBOLS.KES).toBe('KSh');
  });

  test('contains USD → $', () => {
    expect(CURRENCY_SYMBOLS.USD).toBe('$');
  });

  test('contains NGN → ₦', () => {
    expect(CURRENCY_SYMBOLS.NGN).toBe('₦');
  });
});
