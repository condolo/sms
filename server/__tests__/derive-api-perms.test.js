/* ============================================================
   Unit tests — server/routes/settings.js's _deriveApiPerms()

   Translates the R&P screen's per-sub V/E/D checkboxes into the
   role_permissions.permissions shape actually persisted. Pins the
   sub-level emission added for the "Settings is the real control
   panel" fix: alongside the pre-existing coarse module-level union
   (permissions.<mod>, unchanged — every rbac(mod, action) call site
   that doesn't opt into a subKey keeps working exactly as before),
   it now also writes permissions.<mod>__<sub> for each individual
   sub row, so rbac(mod, action, subKey) can grant one sub-feature
   (e.g. "View Leave Requests") without also granting a sibling
   sub-feature (e.g. "View Payroll") under the same module.
   ============================================================ */

jest.mock('../middleware/auth', () => ({ authMiddleware: (_req, _res, next) => next() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), invalidatePermCache: jest.fn() }));
jest.mock('../middleware/module-gate', () => ({ invalidateModuleConfigCache: jest.fn() }));
jest.mock('../utils/model', () => ({ _model: jest.fn() }));

const settingsRouter = require('../routes/settings');
const { _deriveApiPerms } = settingsRouter;

describe('_deriveApiPerms — coarse module-level union (unchanged behavior)', () => {
  test('a single checked sub still produces the expected module-level RCUD-style array', () => {
    const derived = _deriveApiPerms({ 'hr__leave_view': { v: true, e: false, d: false } });
    expect(derived.hr).toEqual(['read']);
  });

  test('multiple subs under the same module union into one module-level array', () => {
    const derived = _deriveApiPerms({
      'hr__leave_view':   { v: true,  e: false, d: false },
      'hr__payroll_view': { v: true,  e: true,  d: false },
      'hr__documents':    { v: false, e: false, d: true  },
    });
    expect(derived.hr.sort()).toEqual(['create', 'delete', 'read', 'update']);
  });

  test('every registered module key is always present, even with no cells at all (empty array, not missing)', () => {
    const derived = _deriveApiPerms({});
    expect(derived.hr).toEqual([]);
    expect(derived.students).toEqual([]);
  });
});

describe('_deriveApiPerms — sub-level grants (the actual fix)', () => {
  test('"View Leave Requests" checked alone does NOT imply "View Payroll" is also checked', () => {
    const derived = _deriveApiPerms({
      'hr__leave_view':   { v: true,  e: false, d: false },
      'hr__payroll_view': { v: false, e: false, d: false },
    });
    expect(derived['hr__leave_view']).toEqual(['read']);
    expect(derived['hr__payroll_view']).toEqual([]);
    // but the coarse module-level union still reflects "at least one sub grants read"
    expect(derived.hr).toEqual(['read']);
  });

  test('each sub captures its own V/E/D combination independently', () => {
    const derived = _deriveApiPerms({
      'hr__staff':          { v: true,  e: false, d: false }, // view only
      'hr__leave_approve':  { v: true,  e: true,  d: false }, // view + edit
      'hr__documents':      { v: true,  e: true,  d: true  }, // full
    });
    expect(derived['hr__staff']).toEqual(['read']);
    expect(derived['hr__leave_approve'].sort()).toEqual(['create', 'read', 'update']);
    expect(derived['hr__documents'].sort()).toEqual(['create', 'delete', 'read', 'update']);
  });

  test('sub-level keys from a different module are not cross-contaminated', () => {
    const derived = _deriveApiPerms({
      'hr__payroll_view':      { v: true, e: false, d: false },
      'finance__void_invoice': { v: true, e: true,  d: false },
    });
    expect(derived['hr__payroll_view']).toEqual(['read']);
    expect(derived.finance).toEqual(['read', 'create', 'update']);
    expect(derived['hr__payroll_view']).not.toEqual(derived.finance);
  });
});
