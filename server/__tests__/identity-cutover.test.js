/* ============================================================
   Unit tests — server/utils/identity-cutover.js  (C8/MR-001 Phase 3)

   The kill switch gating whether auth.js/settings.js read
   identities.passwordHash/mfaEnabled instead of users.password/
   mfaEnabled. Must default to disabled (safe) and only enable on the
   exact string 'true' — no truthy-string leniency that could
   accidentally activate a Kernel-tier credential-check change.
   ============================================================ */

const { isIdentityCutoverEnabled } = require('../utils/identity-cutover');

// Always restore to unset (not whatever was captured at module-load time —
// that could itself be polluted if another test file in the same jest
// worker left the var set). Every test in this codebase's suite expects
// IDENTITY_CUTOVER_ENABLED to default to unset/disabled.
beforeEach(() => {
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});
afterEach(() => {
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

describe('isIdentityCutoverEnabled', () => {
  test('defaults to disabled when the env var is unset', () => {
    delete process.env.IDENTITY_CUTOVER_ENABLED;
    expect(isIdentityCutoverEnabled()).toBe(false);
  });

  test('enabled only on the exact string "true"', () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    expect(isIdentityCutoverEnabled()).toBe(true);
  });

  test('disabled on "false"', () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'false';
    expect(isIdentityCutoverEnabled()).toBe(false);
  });

  test('disabled on truthy-but-not-"true" strings — no leniency for a Kernel-tier switch', () => {
    for (const v of ['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ']) {
      process.env.IDENTITY_CUTOVER_ENABLED = v;
      expect(isIdentityCutoverEnabled()).toBe(false);
    }
  });

  test('disabled on empty string', () => {
    process.env.IDENTITY_CUTOVER_ENABLED = '';
    expect(isIdentityCutoverEnabled()).toBe(false);
  });
});
