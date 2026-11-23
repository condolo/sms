/* ============================================================
   rbac — accounts that hold more than one role (v5.278.3)

   Sign-in and the sidebar combine every role an account holds
   (auth.js _loadMergedPermissions); the server checked only the PRIMARY
   role. Reported at Trinity (2026-11-23): a teacher whose account also
   holds a parent role saw the Markbook, but the server refused every
   assessment, so it read "none scheduled". Pins:
     - a single-role account gets exactly what it got before;
     - a two-role account gets what EITHER role allows, and nothing
       neither role allows;
     - personal overrides still apply on top;
     - hasExplicitSubGrant follows the same rule.
   ============================================================ */
'use strict';

jest.mock('../utils/model', () => ({ _model: jest.fn() }));

const { _model } = require('../utils/model');
const { rbac, hasExplicitSubGrant, invalidatePermCache } = require('../middleware/rbac');

const ROLES = {
  teacher: { assessment: ['read'], grades: ['read', 'create'], grades__enter_marks: ['read', 'create', 'update'] },
  parent:  { parent_portal: ['read'] },
};
let mockUserOverride = null;

function setup() {
  _model.mockImplementation((collection) => {
    if (collection !== 'role_permissions') return { findOne: () => ({ lean: async () => null }) };
    return {
      findOne: (filter) => ({
        lean: async () => {
          if (filter.userId) return mockUserOverride ? { permissions: mockUserOverride } : null;
          return ROLES[filter.roleKey] ? { permissions: ROLES[filter.roleKey] } : null;
        },
      }),
    };
  });
}

async function allowed(jwtUser, mod, action, subKey) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await rbac(mod, action, subKey)({ jwtUser }, res, next);
  return next.mock.calls.length === 1;
}

let n = 0;
const school = () => `sch_multi_${++n}`;   // fresh school per test: no cache carry-over

beforeEach(() => { jest.clearAllMocks(); mockUserOverride = null; setup(); });

test('single-role accounts are unchanged', async () => {
  const s = school(); invalidatePermCache(s);
  const teacher = { schoolId: s, userId: 'u1', role: 'teacher', roles: ['teacher'] };
  expect(await allowed(teacher, 'assessment', 'read')).toBe(true);
  expect(await allowed(teacher, 'parent_portal', 'read')).toBe(false);
  const parent = { schoolId: s, userId: 'u2', role: 'parent', roles: [] };
  expect(await allowed(parent, 'assessment', 'read')).toBe(false);
  expect(await allowed(parent, 'parent_portal', 'read')).toBe(true);
});

test('parent-first account that also teaches: gets the teacher\'s rights, and nothing neither role has', async () => {
  const s = school(); invalidatePermCache(s);
  const kibi = { schoolId: s, userId: 'u3', role: 'parent', roles: ['parent', 'teacher'] };
  expect(await allowed(kibi, 'assessment', 'read')).toBe(true);        // the bug: was refused
  expect(await allowed(kibi, 'parent_portal', 'read')).toBe(true);
  expect(await allowed(kibi, 'grades', 'delete')).toBe(false);          // neither role has it
  expect(await allowed(kibi, 'settings', 'read')).toBe(false);
});

test('personal overrides still apply on top of the combined roles', async () => {
  const s = school(); invalidatePermCache(s);
  mockUserOverride = { grades__enter_marks: ['read'] };                  // narrowed for this person
  const kibi = { schoolId: s, userId: 'u4', role: 'parent', roles: ['parent', 'teacher'] };
  expect(await allowed(kibi, 'grades', 'update', 'enter_marks')).toBe(false);
  expect(await allowed(kibi, 'grades', 'read', 'enter_marks')).toBe(true);
});

test('hasExplicitSubGrant follows the same rule', async () => {
  const s = school(); invalidatePermCache(s);
  const kibi = { schoolId: s, userId: 'u5', role: 'parent', roles: ['parent', 'teacher'] };
  expect(await hasExplicitSubGrant({ jwtUser: kibi }, 'grades', 'enter_marks', 'update')).toBe(true);
  expect(await hasExplicitSubGrant({ jwtUser: kibi }, 'grades', 'enter_marks', 'delete')).toBe(false);
  const parentOnly = { schoolId: s, userId: 'u6', role: 'parent', roles: ['parent'] };
  expect(await hasExplicitSubGrant({ jwtUser: parentOnly }, 'grades', 'enter_marks', 'update')).toBe(false);
});
