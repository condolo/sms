/* ============================================================
   Cross-source consistency guard: repairPermissions.js's ROLE_DEFAULTS
   vs. onboard.js's _defaultPerms().

   This is the third confirmed recurrence this session of the same bug
   class: a role/module's default permission silently drifts between the
   independent sources that are all supposed to describe "what this role
   gets by default" — first for the 'teachers' module (hr/timetabler/
   section_head, commit 3c7c717), then for 'resources'/'messages'/
   'events' across ten roles (this commit), each time discovered only
   after a customer hit the resulting bug in production.

   ROLE_DEFAULTS (repairPermissions.js) is the server-authoritative
   source — it runs on every server restart and additively repairs any
   role_permissions document missing a module key. onboard.js's
   _defaultPerms() independently seeds a NEW school's initial
   role_permissions at signup time. If a module is added to
   ROLE_DEFAULTS but never added to _defaultPerms(), the gap is normally
   harmless (repairPermissions.js's next restart silently fills it in) —
   UNLESS an admin opens Settings → Roles & Permissions and saves before
   that restart happens, which resends the ENTIRE permissions object
   computed from the CLIENT's own separate defaults (SettingsPage.jsx's
   DEFS), permanently overwriting the correct value with whatever the
   client guessed. This test only guards the server-side pair
   (ROLE_DEFAULTS vs. onboard.js) — SettingsPage.jsx is a React
   component file with no Node/Jest-requirable module boundary today, so
   it can't be included in this same automated check without a larger
   refactor (extracting DEFS into a standalone, dependency-free module).
   Fixed manually and re-verified by hand for this commit; flagged as a
   recommended follow-up so this specific gap (the one every real
   incident so far has actually gone through) gets the same automated
   guard eventually.

   No real MongoDB required — both modules are pure/self-contained.
   ============================================================ */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { ROLE_DEFAULTS } = require('../utils/repairPermissions');
const onboardRouter     = require('../routes/onboard');

// Roles intentionally excluded from this comparison, with reasons:
//  - admin/superadmin: RBAC-bypassed entirely (rbac.js checks role first,
//    before ever consulting permissions) — the actual array never gates
//    anything for these two roles, so onboard.js's smaller hardcoded list
//    is harmless, not a bug.
//  - deputy: a legacy role-key alias (pre deputy_principal rename) kept in
//    ROLE_DEFAULTS only so repairPermissions.js can heal EXISTING users
//    with that old role value. New schools onboarding today never create
//    a 'deputy' user, so onboard.js correctly has no case for it.
const EXCLUDED_ROLES = new Set(['admin', 'superadmin', 'deputy']);

function sameActionSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return [...a].sort().join(',') === [...b].sort().join(',');
}

describe('onboard.js _defaultPerms() vs repairPermissions.js ROLE_DEFAULTS', () => {
  const rolesToCheck = Object.keys(ROLE_DEFAULTS).filter(r => !EXCLUDED_ROLES.has(r));

  test('every role checked actually has a non-empty default from onboard.js (sanity: not silently hitting the switch\'s default case)', () => {
    for (const role of rolesToCheck) {
      const perms = onboardRouter._defaultPerms(role);
      expect(Object.keys(perms).length).toBeGreaterThan(0);
    }
  });

  describe.each(rolesToCheck)('role: %s', (role) => {
    const serverDefault  = ROLE_DEFAULTS[role];
    const onboardDefault = onboardRouter._defaultPerms(role);

    test('every module ROLE_DEFAULTS grants is also present in onboard.js\'s default, with the same action set', () => {
      const missing = [];
      const mismatched = [];
      for (const [mod, actions] of Object.entries(serverDefault)) {
        if (!(mod in onboardDefault)) {
          missing.push(mod);
          continue;
        }
        if (!sameActionSet(onboardDefault[mod], actions)) {
          mismatched.push(`${mod}: server=${JSON.stringify(actions)} onboard=${JSON.stringify(onboardDefault[mod])}`);
        }
      }
      if (missing.length || mismatched.length) {
        throw new Error(
          `onboard.js's _defaultPerms('${role}') has drifted from repairPermissions.js's ROLE_DEFAULTS.${role}.\n` +
          (missing.length ? `  Missing modules: ${missing.join(', ')}\n` : '') +
          (mismatched.length ? `  Mismatched action sets:\n    ${mismatched.join('\n    ')}\n` : '') +
          `  Fix: add/correct these keys in server/routes/onboard.js's _defaultPerms('${role}') case ` +
          `to match repairPermissions.js's ROLE_DEFAULTS.${role} exactly.`
        );
      }
    });
  });
});
