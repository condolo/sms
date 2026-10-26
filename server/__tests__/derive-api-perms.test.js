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

describe('_deriveApiPerms — hr__workflow special case (2026-09, Priority-0 audit fix)', () => {
  // hr.js's 4 workflow-config routes check the literal string
  // 'manage_workflow' in the COARSE 'hr' array — a deliberately separate,
  // more restrictive grant from general hr RCUD (Governance Spec §0), not
  // expressible via the standard mod__sub subKey mechanism (which falls
  // back to the coarse grant and would have silently handed every
  // hr:update-holding role this capability). Only this sub's Edit
  // checkbox may ever add/remove it, and only for the role being saved.
  test('"Configure Leave/Payroll Approval Workflow" Edit checked adds manage_workflow to the coarse hr array', () => {
    const derived = _deriveApiPerms({ 'hr__workflow': { v: true, e: true, d: false } });
    expect(derived.hr).toEqual(expect.arrayContaining(['manage_workflow']));
  });

  test('View-only (no Edit) on hr__workflow does NOT add manage_workflow', () => {
    const derived = _deriveApiPerms({ 'hr__workflow': { v: true, e: false, d: false } });
    expect(derived.hr).not.toContain('manage_workflow');
  });

  test('manage_workflow is never added when hr__workflow is absent entirely', () => {
    const derived = _deriveApiPerms({ 'hr__leave_view': { v: true, e: true, d: true } });
    expect(derived.hr).not.toContain('manage_workflow');
  });

  test('checking Edit on a DIFFERENT hr sub does not add manage_workflow', () => {
    const derived = _deriveApiPerms({ 'hr__payroll_view': { v: true, e: true, d: false } });
    expect(derived.hr).not.toContain('manage_workflow');
    expect(derived.hr.sort()).toEqual(['create', 'read', 'update']);
  });

  test('manage_workflow coexists correctly with other hr subs\' normal RCUD contributions', () => {
    const derived = _deriveApiPerms({
      'hr__staff':    { v: true, e: false, d: false },
      'hr__workflow': { v: true, e: true,  d: false },
    });
    expect(derived.hr.sort()).toEqual(['create', 'manage_workflow', 'read', 'update']);
    expect(derived['hr__workflow'].sort()).toEqual(['create', 'read', 'update']); // sub-level array unaffected by the special case
  });
});

describe('_deriveApiPerms — explicit finance sub-permissions clamped to their real action set (2026-10-13)', () => {
  // finance__term_billing/early_payment/activities each support only the
  // 2 actions their real routes check (FINANCE_SUB_GRANTS in
  // middleware/explicit-sub.js) — never the generic V/E/D model's full
  // 4. Before this fix, checking every box (as the UI's own blanket
  // admin/superadmin default did) produced 'update'/'delete' for
  // term_billing and 'read'/'delete' for early_payment/activities —
  // actions nothing, not even an admin, could ever hold, which tripped
  // the self-escalation ceiling check in settings.js on every save.
  test('term_billing: all 4 boxes checked still yields only read + create, never update or delete', () => {
    const derived = _deriveApiPerms({ 'finance__term_billing': { v: true, e: true, d: true } });
    expect(derived['finance__term_billing'].sort()).toEqual(['create', 'read']);
  });

  test('early_payment: all 4 boxes checked still yields only create + update, never read or delete', () => {
    const derived = _deriveApiPerms({ 'finance__early_payment': { v: true, e: true, d: true } });
    expect(derived['finance__early_payment'].sort()).toEqual(['create', 'update']);
  });

  test('activities: all 4 boxes checked still yields only create + update, never read or delete', () => {
    const derived = _deriveApiPerms({ 'finance__activities': { v: true, e: true, d: true } });
    expect(derived['finance__activities'].sort()).toEqual(['create', 'update']);
  });

  test('the coarse finance array is clamped too, so it never gains delete from these 3 keys alone', () => {
    const derived = _deriveApiPerms({
      'finance__term_billing':  { v: true, e: true, d: true },
      'finance__early_payment': { v: true, e: true, d: true },
      'finance__activities':    { v: true, e: true, d: true },
    });
    expect(derived.finance.sort()).toEqual(['create', 'read', 'update']);
  });

  test('a sibling finance sub-key not in FINANCE_SUB_GRANTS is completely unaffected', () => {
    const derived = _deriveApiPerms({ 'finance__void_invoice': { v: true, e: true, d: true } });
    expect(derived['finance__void_invoice'].sort()).toEqual(['create', 'delete', 'read', 'update']);
  });
});

describe('_deriveApiPerms — Reports & Analytics tab split (2026-10-25)', () => {
  // Granting one dashboard tab (e.g. Finance analytics) must not silently
  // hand over the sibling tabs (Attendance/Behaviour/Enrollment) — the
  // exact bug reported: assigning a role the Reports & Analytics module
  // showed it every tab at once with no way to scope down.
  test('checking only Finance analytics does not imply Attendance/Behaviour/Enrollment', () => {
    const derived = _deriveApiPerms({
      'reports__finance_analytics':    { v: true,  e: false, d: false },
      'reports__attendance_analytics': { v: false, e: false, d: false },
      'reports__behaviour_analytics':  { v: false, e: false, d: false },
      'reports__enrollment_analytics': { v: false, e: false, d: false },
    });
    expect(derived['reports__finance_analytics']).toEqual(['read']);
    expect(derived['reports__attendance_analytics']).toEqual([]);
    expect(derived['reports__behaviour_analytics']).toEqual([]);
    expect(derived['reports__enrollment_analytics']).toEqual([]);
  });

  test('each of the 4 new tabs captures its own grant independently', () => {
    const derived = _deriveApiPerms({
      'reports__attendance_analytics': { v: true, e: false, d: false },
      'reports__finance_analytics':    { v: false, e: false, d: false },
      'reports__behaviour_analytics':  { v: true, e: false, d: false },
      'reports__enrollment_analytics': { v: false, e: false, d: false },
    });
    expect(derived['reports__attendance_analytics']).toEqual(['read']);
    expect(derived['reports__finance_analytics']).toEqual([]);
    expect(derived['reports__behaviour_analytics']).toEqual(['read']);
    expect(derived['reports__enrollment_analytics']).toEqual([]);
  });

  test('the coarse reports array still unions across tabs (unchanged pre-existing behavior)', () => {
    const derived = _deriveApiPerms({ 'reports__attendance_analytics': { v: true, e: false, d: false } });
    expect(derived.reports).toEqual(['read']);
  });

  test('all 4 new sub-keys resolve to an explicit empty array when sent unchecked (the real Settings UI always sends every registered sub row)', () => {
    const derived = _deriveApiPerms({
      'reports__view':               { v: false, e: false, d: false },
      'reports__attendance_analytics': { v: false, e: false, d: false },
      'reports__finance_analytics':    { v: false, e: false, d: false },
      'reports__behaviour_analytics':  { v: false, e: false, d: false },
      'reports__enrollment_analytics': { v: false, e: false, d: false },
    });
    expect(derived['reports__attendance_analytics']).toEqual([]);
    expect(derived['reports__finance_analytics']).toEqual([]);
    expect(derived['reports__behaviour_analytics']).toEqual([]);
    expect(derived['reports__enrollment_analytics']).toEqual([]);
    expect(derived.reports).toEqual([]);
  });
});
