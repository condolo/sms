/* ============================================================
   Notification links open the item itself, on the school's own address.

   Reported 2026-11-12: "on receiving the notification on a weekly
   snapshot, when going to the site there's nothing" — the "View
   Snapshot" button linked to the bare APP_URL (the msingi.io homepage).
   email.js's _buildSchoolPageUrl now builds
   https://<slug>.<base>/<page>?…&school=<slug>.
   ============================================================ */
'use strict';

function load(appUrl) {
  jest.resetModules();
  process.env.APP_URL = appUrl;
  jest.doMock('../utils/model', () => ({ _model: jest.fn(() => ({ findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) })) }));
  return require('../utils/email');
}

afterAll(() => { delete process.env.APP_URL; });

describe('_buildSchoolPageUrl', () => {
  test('production: school subdomain + page + child + school', () => {
    const { _buildSchoolPageUrl } = load('https://msingi.io');
    const url = _buildSchoolPageUrl('greenwood', '/parent-dashboard', { child: 'stu_1', focus: 'snapshot', week: '2026-11-09' });
    const u = new URL(url);
    expect(u.origin).toBe('https://greenwood.msingi.io');
    expect(u.pathname).toBe('/parent-dashboard');
    expect(u.searchParams.get('child')).toBe('stu_1');
    expect(u.searchParams.get('focus')).toBe('snapshot');
    expect(u.searchParams.get('week')).toBe('2026-11-09');
    expect(u.searchParams.get('school')).toBe('greenwood');
  });

  test('an APP_URL that already has a subdomain is replaced by the school\'s', () => {
    const { _buildSchoolPageUrl } = load('https://app.msingi.io');
    expect(new URL(_buildSchoolPageUrl('greenwood', '/parent-dashboard')).origin).toBe('https://greenwood.msingi.io');
  });

  test('localhost: same host, school carried in the query', () => {
    const { _buildSchoolPageUrl } = load('http://localhost:3005');
    const u = new URL(_buildSchoolPageUrl('demo', '/parent-dashboard', { child: 'stu_9' }));
    expect(u.origin).toBe('http://localhost:3005');
    expect(u.pathname).toBe('/parent-dashboard');
    expect(u.searchParams.get('school')).toBe('demo');
  });

  test('never the bare homepage, even without a slug', () => {
    const { _buildSchoolPageUrl } = load('https://msingi.io');
    const u = new URL(_buildSchoolPageUrl(null, '/parent-dashboard', { child: 'stu_1' }));
    expect(u.pathname).toBe('/parent-dashboard');
    expect(u.searchParams.get('child')).toBe('stu_1');
    expect(u.searchParams.has('school')).toBe(false);
  });

  test('empty params are left out and values are URL-encoded', () => {
    const { _buildSchoolPageUrl } = load('https://msingi.io');
    const url = _buildSchoolPageUrl('greenwood', 'parent-dashboard', { child: 'a b&c', focus: '', week: null });
    expect(url).toContain('/parent-dashboard?child=a+b%26c&school=greenwood');
  });
});
