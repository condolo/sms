/* ============================================================
   System-wide RBAC resource-key audit (2026-09)

   Prompted directly, after fixing the assessment.js 'settings' vs
   'assessment' mismatch: "is this really working across the system...
   my assumption is if a user is assigned full access... they access
   even the configuration... i have also noted that when investigating
   you assume some things which comes back to haunt us." A full,
   exhaustive audit (not a sample) of every rbac() call across every
   route file found three more clusters of the exact same bug class —
   an action (or subKey) string that Settings → Roles & Permissions'
   own UI can NEVER produce, since settings.js's _deriveApiPerms only
   ever writes 'read'/'create'/'update'/'delete' into a role's
   permission array:

     - server/routes/users.js: rbac('settings', 'users') × 3
       ('users' passed as the ACTION — should be 'create'/'update')
     - server/routes/bell-schedule.js: rbac('timetable', 'bell_schedule') × 2
       ('bell_schedule' passed as the ACTION — it's actually the SUBKEY,
       moduleRegistry.js's own 'timetable.bell_schedule' sub)
     - server/routes/elearning.js: rbac('elearning', 'view') × 8,
       rbac('elearning', 'edit') × 1
       ('view'/'edit' aren't real action strings at all)

   Each was permanently inaccessible to every role except superadmin
   (which bypasses RBAC entirely) — no permission grant from ANY role
   configuration could ever satisfy them. This file asserts the actual
   registered (resource, action, subKey) for each fixed route, since
   every existing test for these files mocks rbac() as a bare no-op
   and could never have caught a resource/action-key mismatch like
   this (confirmed: no test anywhere referenced the old, broken
   strings before this fix).

   rbac(mod, action, subKey) is a FACTORY called once per route at
   module-load time — the call happens when router.METHOD(...) is
   evaluated, not per-request — so this records every call by
   requiring each router fresh, rather than firing HTTP requests.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function freshRbacCalls(routerPath) {
  jest.resetModules();
  const calls = [];
  jest.doMock('../middleware/rbac', () => ({
    rbac: (mod, action, subKey) => { calls.push({ mod, action, subKey }); return (_req, _res, next) => next(); },
    hasExplicitSubGrant: jest.fn().mockResolvedValue(false),
  }));
  jest.doMock('../middleware/auth', () => ({ authMiddleware: (_req, _res, next) => next() }));
  jest.doMock('../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
  jest.doMock('../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
  jest.doMock('../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
  jest.doMock('../utils/model', () => ({ _model: jest.fn() }));
  jest.doMock('../utils/tenant-model', () => ({ tenantContext: jest.fn(), tenantModel: jest.fn() }));
  jest.doMock('../utils/email', () => ({}));
  jest.doMock('../utils/archival', () => ({ isYearArchived: jest.fn(), firstArchivedYear: jest.fn() }));
  jest.isolateModules(() => { require(routerPath); });
  return calls;
}

// A valid action string can ONLY ever be one of these four — the exact
// set _deriveApiPerms (server/routes/settings.js) can write into a role's
// permission array from the Roles & Permissions UI.
const VALID_ACTIONS = new Set(['read', 'create', 'update', 'delete']);

describe('server/routes/users.js — invite/bulk-invite/role-change no longer check a phantom "users" action', () => {
  const calls = freshRbacCalls('../routes/users');

  test('every rbac() call in this file uses a real action string', () => {
    for (const c of calls) expect(VALID_ACTIONS.has(c.action)).toBe(true);
  });

  test('POST /invite and /bulk-invite check settings:create; /:id/role-change checks settings:update', () => {
    const settingsCalls = calls.filter(c => c.mod === 'settings').map(c => c.action);
    expect(settingsCalls).toEqual(expect.arrayContaining(['create', 'update']));
    expect(settingsCalls).not.toContain('users');
  });
});

describe('server/routes/bell-schedule.js — PUT/DELETE use "bell_schedule" as a subKey, not an action', () => {
  const calls = freshRbacCalls('../routes/bell-schedule');

  test('every rbac() call in this file uses a real action string', () => {
    for (const c of calls) expect(VALID_ACTIONS.has(c.action)).toBe(true);
  });

  test('bell_schedule appears only as subKey (3rd arg), never as action', () => {
    expect(calls.some(c => c.subKey === 'bell_schedule')).toBe(true);
    expect(calls.some(c => c.action === 'bell_schedule')).toBe(false);
  });
});

describe('server/routes/elearning.js — "view"/"edit" replaced with "read"/"update"', () => {
  const calls = freshRbacCalls('../routes/elearning');

  test('every rbac() call in this file uses a real action string', () => {
    for (const c of calls) expect(VALID_ACTIONS.has(c.action)).toBe(true);
  });

  test('no route checks the phantom "view" or "edit" actions', () => {
    expect(calls.some(c => c.action === 'view')).toBe(false);
    expect(calls.some(c => c.action === 'edit')).toBe(false);
  });

  test('at least 7 elearning:read and 1 elearning:update call registered (the fixed GET/PATCH routes)', () => {
    const reads   = calls.filter(c => c.mod === 'elearning' && c.action === 'read');
    const updates = calls.filter(c => c.mod === 'elearning' && c.action === 'update');
    expect(reads.length).toBeGreaterThanOrEqual(7);
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });
});
