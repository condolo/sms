/* ============================================================
   Portal read-path regression pins.

   Two defects found while seeding the demo personas, now fixed:

   1. All three portal dashboards read tenantModel('behaviour'). Nothing
      writes that collection — routes/behaviour.js stores in
      'behaviour_incidents' — so it holds 0 documents in every database.
      A read against it returns an empty array, not an error, so the
      behaviour tile, the BPS badge and at-risk detection looked like
      "this school has logged nothing" forever.
   2. parent-portal.js handed the whole `req` to _inboxQuery, which
      destructures { schoolId, userId, role } from req.jwtUser. userId
      came out undefined, so the "addressed to me" half of the inbox
      matched nothing and a parent saw only messages they had sent.

   Both fail silently, which is why these are static pins on the source
   rather than smoke tests: the broken version still returns 200.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', '..', 'routes');

function src(file) {
  return fs.readFileSync(path.join(ROUTES, file), 'utf8');
}

describe('portal dashboards read the collection behaviour is stored in', () => {
  ['student-portal.js', 'parent-portal.js', 'teacher-portal.js'].forEach((file) => {
    test(`${file} uses 'behaviour_incidents', never the empty 'behaviour'`, () => {
      const text = src(file);
      expect(text).toMatch(/tenantModel\(\s*'behaviour_incidents'/);
      expect(text).not.toMatch(/tenantModel\(\s*'behaviour'\s*,/);
      expect(text).not.toMatch(/_model\(\s*'behaviour'\s*\)/);
    });
  });
});

describe('_inboxQuery gets its contract, not the request', () => {
  const files = ['messages.js', 'parent-portal.js', 'teacher-portal.js'];

  files.forEach((file) => {
    test(`${file} never passes a bare req`, () => {
      expect(src(file)).not.toMatch(/_inboxQuery\(\s*req\s*\)/);
    });
  });

  test('every call site passes schoolId, userId and role', () => {
    const passed = files
      .flatMap((f) => [...src(f).matchAll(/_inboxQuery\(\s*\{([^}]*)\}/g)])
      .map((m) => m[1]);
    expect(passed.length).toBeGreaterThan(0);
    passed.forEach((arg) => {
      ['schoolId', 'userId', 'role'].forEach((key) => {
        expect(arg).toContain(key);
      });
    });
  });
});
