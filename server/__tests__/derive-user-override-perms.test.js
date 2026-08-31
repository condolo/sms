/* ============================================================
   Unit tests — server/routes/settings.js's _deriveUserOverridePerms()

   Role Architecture Audit 2026-08 §2d — the Per-User override bug.
   This function exists specifically because the OTHER derivation
   function, _deriveApiPerms (see derive-api-perms.test.js), is correct
   for a ROLE's complete definition but wrong for a per-user override,
   which must be a sparse DELTA: only the exact keys an admin actually
   touched, nothing manufactured for anything they didn't.
   ============================================================ */

jest.mock('../middleware/auth', () => ({ authMiddleware: (_req, _res, next) => next() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), invalidatePermCache: jest.fn() }));
jest.mock('../middleware/module-gate', () => ({ invalidateModuleConfigCache: jest.fn() }));
jest.mock('../utils/model', () => ({ _model: jest.fn() }));

const settingsRouter = require('../routes/settings');
const { _deriveUserOverridePerms } = settingsRouter;

describe('_deriveUserOverridePerms — sparse delta, not a full definition', () => {
  test('one touched sub-key produces ONLY that key — no other module or key appears at all', () => {
    const derived = _deriveUserOverridePerms({ 'hr__payroll_view': { v: true, e: false, d: false } });
    expect(Object.keys(derived)).toEqual(['hr__payroll_view']);
    expect(derived['hr__payroll_view']).toEqual(['read']);
    // The critical assertion: no coarse module key, no other module's
    // key, nothing else at all — unlike _deriveApiPerms, this must
    // never manufacture an empty array for anything untouched.
    expect(derived.hr).toBeUndefined();
    expect(derived.students).toBeUndefined();
    expect(derived.finance).toBeUndefined();
  });

  test('an empty input produces an empty output — not a "deny everything" document', () => {
    const derived = _deriveUserOverridePerms({});
    expect(derived).toEqual({});
  });

  test('a null/undefined input produces an empty output, same as empty', () => {
    expect(_deriveUserOverridePerms(null)).toEqual({});
    expect(_deriveUserOverridePerms(undefined)).toEqual({});
  });

  test('multiple touched sub-keys across different modules each appear independently', () => {
    const derived = _deriveUserOverridePerms({
      'hr__payroll_view':      { v: true,  e: false, d: false },
      'finance__void_invoice': { v: false, e: false, d: false },
    });
    expect(Object.keys(derived).sort()).toEqual(['finance__void_invoice', 'hr__payroll_view']);
    expect(derived['hr__payroll_view']).toEqual(['read']);
    expect(derived['finance__void_invoice']).toEqual([]);
  });

  test('each touched key still gets its own full V/E/D-derived action set', () => {
    const derived = _deriveUserOverridePerms({ 'hr__documents': { v: true, e: true, d: true } });
    expect(derived['hr__documents'].sort()).toEqual(['create', 'delete', 'read', 'update']);
  });
});
