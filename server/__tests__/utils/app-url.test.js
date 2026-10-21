/* ============================================================
   server/utils/app-url.js â€” the single definition of the app's base URL

   THE BUG THIS PINS
   APP_URL was defined separately in email.js and school-url.js, and a
   third copy in routes/platform.js used a DIFFERENT fallback
   ('http://localhost:3005' instead of 'https://msingi.io').

   That difference was not cosmetic. If APP_URL is ever unset in a
   deployment, every other email still links to the real site, while the
   platform-team invite email would contain

       http://localhost:3005/platform?invite=...

   â€” a link that only resolves on the server itself. The invitee could
   never activate their account, and the invite would silently expire. A
   base URL must have exactly one definition, and its fallback must be
   the real site.
   ============================================================ */
'use strict';

describe('app-url', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  test('falls back to the real site when APP_URL is unset', () => {
    delete process.env.APP_URL;
    jest.resetModules();
    const { APP_URL } = require('../../utils/app-url');
    expect(APP_URL).toBe('https://msingi.io');
  });

  test('uses APP_URL when it is set', () => {
    process.env.APP_URL = 'https://app.msingi.io';
    jest.resetModules();
    const { APP_URL } = require('../../utils/app-url');
    expect(APP_URL).toBe('https://app.msingi.io');
  });

  test('trims a trailing slash so paths never double up', () => {
    process.env.APP_URL = 'https://app.msingi.io/';
    jest.resetModules();
    const { APP_URL, appUrl } = require('../../utils/app-url');
    expect(APP_URL).toBe('https://app.msingi.io');
    expect(appUrl('/platform')).toBe('https://app.msingi.io/platform');
  });

  test('appUrl() builds an absolute path with exactly one slash', () => {
    process.env.APP_URL = 'https://app.msingi.io';
    jest.resetModules();
    const { appUrl } = require('../../utils/app-url');
    expect(appUrl('/platform')).toBe('https://app.msingi.io/platform');
    expect(appUrl('platform')).toBe('https://app.msingi.io/platform');
    expect(appUrl('/platform?invite=abc')).toBe('https://app.msingi.io/platform?invite=abc');
    expect(appUrl()).toBe('https://app.msingi.io');
  });

  test('every module that needs the base URL now shares this one definition', () => {
    // Guard against a fourth copy creeping back in: nothing outside
    // app-url.js may read APP_URL straight from the environment.
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        if (path.relative(root, full) === path.join('utils', 'app-url.js')) continue; // the source of truth
        const src = fs.readFileSync(full, 'utf8');
        if (/process\.env\.APP_URL/.test(src)) offenders.push(path.relative(root, full));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

