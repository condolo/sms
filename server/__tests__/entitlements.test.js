/* ============================================================
   Unit tests — server/utils/entitlements.js  (C3)

   Verifies the pure read helper `hasEntitlement()`: active + unexpired
   grants resolve true; revoked, expired, or missing grants resolve
   false. This collection is not yet consulted anywhere in the app —
   these tests pin the primitive's own correctness ahead of that future
   wiring (dependency graph C10).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const { hasEntitlement } = require('../utils/entitlements');

function makeEntitlements(docs) {
  return {
    findOne: (filter) => ({
      lean: () => Promise.resolve(
        docs.find(d => d.schoolId === filter.schoolId && d.key === filter.key) || null
      ),
    }),
  };
}

describe('hasEntitlement', () => {
  test('returns true for an active, unexpired entitlement', async () => {
    const Entitlements = makeEntitlements([
      { schoolId: 'sch_a', key: 'ai_reports', status: 'active' },
    ]);
    await expect(hasEntitlement('sch_a', 'ai_reports', { Entitlements })).resolves.toBe(true);
  });

  test('returns true for an active entitlement with a future expiry', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const Entitlements = makeEntitlements([
      { schoolId: 'sch_a', key: 'payroll', status: 'active', expiresAt: future },
    ]);
    await expect(hasEntitlement('sch_a', 'payroll', { Entitlements })).resolves.toBe(true);
  });

  test('returns false for a revoked entitlement', async () => {
    const Entitlements = makeEntitlements([
      { schoolId: 'sch_a', key: 'ai_reports', status: 'revoked' },
    ]);
    await expect(hasEntitlement('sch_a', 'ai_reports', { Entitlements })).resolves.toBe(false);
  });

  test('returns false for an expired entitlement even if marked active', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const Entitlements = makeEntitlements([
      { schoolId: 'sch_a', key: 'ai_reports', status: 'active', expiresAt: past },
    ]);
    await expect(hasEntitlement('sch_a', 'ai_reports', { Entitlements })).resolves.toBe(false);
  });

  test('returns false when no entitlement doc exists', async () => {
    const Entitlements = makeEntitlements([]);
    await expect(hasEntitlement('sch_a', 'ai_reports', { Entitlements })).resolves.toBe(false);
  });

  test('returns false for a missing schoolId or key rather than crashing', async () => {
    const Entitlements = makeEntitlements([]);
    await expect(hasEntitlement(null, 'ai_reports', { Entitlements })).resolves.toBe(false);
    await expect(hasEntitlement('sch_a', null, { Entitlements })).resolves.toBe(false);
  });

  test('is scoped by both schoolId and key — a match for one school does not leak to another', async () => {
    const Entitlements = makeEntitlements([
      { schoolId: 'sch_a', key: 'ai_reports', status: 'active' },
    ]);
    await expect(hasEntitlement('sch_b', 'ai_reports', { Entitlements })).resolves.toBe(false);
  });
});
