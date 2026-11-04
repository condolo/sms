/* ============================================================
   server/utils/email.js — per-school branded email header (2026-11-04)

   Reported directly: every school-facing email showed the generic
   "🎓 Msingi" header regardless of the school's own identity. Also
   bundled: a real parent-reported staleness bug ("the parent's name
   we changed on our side hasn't reflected on her dashboard") traced
   separately to students.js's guardian-name sync (see
   students-guardian-name-sync.test.js for that fix) — this file only
   covers the branding half of that session's work: the school's own
   uploaded logo (Settings → School Profile) should appear in the
   header of its own emails instead of the Msingi mark, with
   "Powered by Msingi" moved to the footer.

   All DB calls mocked — no MongoDB required.
   ============================================================ */
'use strict';

process.env.SMTP_USER = 'platform@example.com';
process.env.SMTP_PASS = 'platformpass';
process.env.APP_URL   = 'https://app.example.test';

let mockSchoolDoc = null;

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: (_filter, _proj) => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
  })),
}));

const { _wrap, invalidateLogoCache } = require('../utils/email');

beforeEach(() => {
  mockSchoolDoc = null;
});

describe('_wrap — per-school logo header', () => {
  test('no schoolId at all (platform email) — generic Msingi header, unchanged', async () => {
    const html = await _wrap('<p>hi</p>', null, null);
    expect(html).toContain('🎓 Msingi');
    expect(html).toContain('School Management Platform');
    expect(html).not.toMatch(/<img/);
  });

  test('schoolId given, school has NO logo uploaded — falls back to the Msingi mark + school name, never a broken image', async () => {
    invalidateLogoCache('sch_nologo');
    mockSchoolDoc = { id: 'sch_nologo', logoUrl: null };
    const html = await _wrap('<p>hi</p>', 'Riverside Academy', 'sch_nologo');
    expect(html).toContain('🎓 Msingi');
    expect(html).toContain('Riverside Academy');
    expect(html).not.toMatch(/<img/);
  });

  test("schoolId given, school HAS a logo — the school's own logo renders in the header, not the Msingi mark", async () => {
    invalidateLogoCache('sch_logo');
    mockSchoolDoc = { id: 'sch_logo', logoUrl: '/api/public/school-asset/logo?slug=sch_logo' };
    const html = await _wrap('<p>hi</p>', 'Trinitas International School', 'sch_logo');
    expect(html).toContain('<img src="https://app.example.test/api/public/school-asset/logo?slug=sch_logo"');
    expect(html).toContain('Trinitas International School');
    // The Msingi wordmark no longer dominates the header once a real logo exists —
    // it still appears in the footer ("Powered by Msingi"), just not as the <h1>.
    expect(html).not.toMatch(/<h1[^>]*>🎓 Msingi/);
  });

  test('an already-absolute logoUrl (e.g. a CDN URL set directly on the school doc) is used unchanged, not double-prefixed', async () => {
    invalidateLogoCache('sch_cdn');
    mockSchoolDoc = { id: 'sch_cdn', logoUrl: 'https://cdn.example.com/logo.png' };
    const html = await _wrap('<p>hi</p>', 'CDN School', 'sch_cdn');
    expect(html).toContain('<img src="https://cdn.example.com/logo.png"');
  });

  test('footer always says "Powered by Msingi", for every email regardless of branding', async () => {
    const platformHtml = await _wrap('<p>hi</p>', null, null);
    expect(platformHtml).toContain('Powered by');
    expect(platformHtml).toContain('Msingi');

    invalidateLogoCache('sch_logo2');
    mockSchoolDoc = { id: 'sch_logo2', logoUrl: '/api/public/school-asset/logo?slug=sch_logo2' };
    const brandedHtml = await _wrap('<p>hi</p>', 'Some School', 'sch_logo2');
    expect(brandedHtml).toContain('Powered by');
  });

  test('a school-doc lookup failure resolves to the safe fallback, never throws', async () => {
    const { _model } = require('../utils/model');
    _model.mockImplementationOnce(() => ({ findOne: () => ({ lean: () => Promise.reject(new Error('down')) }) }));
    invalidateLogoCache('sch_broken');
    await expect(_wrap('<p>hi</p>', 'Broken Lookup School', 'sch_broken')).resolves.toContain('Broken Lookup School');
  });

  test('the logo lookup result is cached — a second call for the same school does not re-query', async () => {
    const { _model } = require('../utils/model');
    invalidateLogoCache('sch_cache');
    mockSchoolDoc = { id: 'sch_cache', logoUrl: '/api/public/school-asset/logo?slug=sch_cache' };
    await _wrap('<p>one</p>', 'Cache School', 'sch_cache');
    const callsAfterFirst = _model.mock.calls.length;
    mockSchoolDoc = { id: 'sch_cache', logoUrl: null }; // would change the result if re-queried
    const html = await _wrap('<p>two</p>', 'Cache School', 'sch_cache');
    expect(_model.mock.calls.length).toBe(callsAfterFirst); // no new _model('schools') call
    expect(html).toContain('<img'); // still the cached (logo-present) result
  });

  test('invalidateLogoCache forces a fresh lookup on the next call', async () => {
    invalidateLogoCache('sch_invalidate');
    mockSchoolDoc = { id: 'sch_invalidate', logoUrl: '/api/public/school-asset/logo?slug=sch_invalidate' };
    const withLogo = await _wrap('<p>one</p>', 'Invalidate School', 'sch_invalidate');
    expect(withLogo).toMatch(/<img/);

    invalidateLogoCache('sch_invalidate');
    mockSchoolDoc = { id: 'sch_invalidate', logoUrl: null };
    const withoutLogo = await _wrap('<p>two</p>', 'Invalidate School', 'sch_invalidate');
    expect(withoutLogo).not.toMatch(/<img/);
  });
});
