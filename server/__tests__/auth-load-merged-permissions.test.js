/* ============================================================
   server/routes/auth.js's _loadMergedPermissions — the function that
   feeds the login response and GET /api/auth/permissions (what the
   sidebar actually renders from).

   2026-09 fix — this used to run its own, independent per-user-override
   merge (`{...roleResult, ...userDoc.permissions}`), a second copy of
   the exact logic rbac.js's _isAllowed uses for real API authorization.
   The two drifted: rbac.js was fixed twice (2026-08, then 2026-09 to
   close the bare-coarse-key gap found on a real account, Ann Wanjiku /
   admissions_officer) while this sidebar/login-snapshot path never was.
   Now it delegates to rbac.js's exported _mergeUserOverrides directly —
   one merge implementation, not two that can quietly disagree again.

   These tests prove the delegation is real (not just present in the
   diff): a stale, pre-fix-shaped per-user override document — a bare
   zero-filled coarse key with no accompanying mod__sub key — must NOT
   suppress a role's real grant here, the same property already proven
   for rbac.js itself in rbac-merge-user-overrides.test.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../utils/email', () => ({}));
jest.mock('../services/sessionService', () => ({}));
jest.mock('../services/audit', () => ({ log: jest.fn() }));
jest.mock('../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../utils/identity-cutover', () => ({ isIdentityCutoverEnabled: () => false }));
jest.mock('bcryptjs', () => ({}));

const SCHOOL = 'sch_mla';

// Generic {mod}/{mod__sub}-keyed collection matcher — same convention
// used across this session's other rbac/settings test files.
function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => mockMatchFilter(doc, sub));
    if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
}
let mockRolePermsDocs;
jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection !== 'role_permissions') return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: () => ({ lean: () => Promise.resolve(null) }) };
    return {
      find:    (filter) => ({ lean: () => Promise.resolve(mockRolePermsDocs.filter((d) => mockMatchFilter(d, filter))) }),
      findOne: (filter) => ({ lean: () => Promise.resolve(mockRolePermsDocs.find((d) => mockMatchFilter(d, filter)) ?? null) }),
    };
  }),
}));

const { _loadMergedPermissions } = require('../routes/auth');

beforeEach(() => { mockRolePermsDocs = []; });

describe('_loadMergedPermissions — reuses rbac.js\'s real, fixed _mergeUserOverrides', () => {
  test('THE REAL 2026-09 CASE: a legacy bare zero-filled "admissions" key with no admissions__* sub-key no longer hides the role\'s real grant from the sidebar/login snapshot', async () => {
    mockRolePermsDocs = [
      {
        schoolId: SCHOOL, roleKey: 'admissions_officer',
        permissions: {
          admissions: ['read', 'create', 'update', 'delete'],
          admissions__view: ['read', 'create', 'update', 'delete'],
        },
      },
      // Trimmed real shape of Ann's actual document.
      {
        schoolId: SCHOOL, userId: 'u_ann',
        permissions: { admissions: [], attendance: ['read'], attendance__view: ['read'] },
      },
    ];
    const perms = await _loadMergedPermissions(SCHOOL, ['admissions_officer'], 'u_ann');
    expect(perms.admissions.sort()).toEqual(['create', 'delete', 'read', 'update']);
    expect(perms.attendance).toEqual(['read']);
  });

  test('a user with no per-user override at all gets the pure role union, unaffected', async () => {
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'finance', permissions: { finance: ['read', 'create'] } },
    ];
    const perms = await _loadMergedPermissions(SCHOOL, ['finance'], 'u_carol');
    expect(perms.finance).toEqual(['read', 'create']);
  });

  test('multi-role union still works — most permissive wins across roles, unaffected by the per-user delegation change', async () => {
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'teacher', permissions: { grades: ['read'] } },
      { schoolId: SCHOOL, roleKey: 'hod', permissions: { grades: ['read', 'update'] } },
    ];
    const perms = await _loadMergedPermissions(SCHOOL, ['teacher', 'hod'], null);
    expect(perms.grades.sort()).toEqual(['read', 'update']);
  });

  test('superadmin short-circuits to null (full access) without touching the DB at all', async () => {
    const perms = await _loadMergedPermissions(SCHOOL, ['superadmin'], 'u_root');
    expect(perms).toBeNull();
  });
});
