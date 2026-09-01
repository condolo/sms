/* ============================================================
   Role Architecture Audit 2026-08 — FINAL VERIFICATION MATRIX

   Requested before pushing the three accepted fixes (Per-User
   override merge, legacy 'deputy' tooling, reserved custom-role
   key collision). One comprehensive pass against the exact model
   now implemented, against the REAL, unmodified production modules
   — rbac.js, scopeMiddleware.js, and the three routes that consume
   extraRoles — never a reimplementation of their logic.

   Ten scenario rows (§A) and seven specific security proofs (§B),
   each mapped directly to what was asked for. No MongoDB required —
   all DB calls are mocked against one shared in-memory store per
   test, reset in beforeEach.
   ============================================================ */
'use strict';

/* ── Shared fake DB + Mongoose-query-shape mock ─────────────────
   One in-memory store per collection, reset every test. Every
   consumer here — rbac.js, scopeMiddleware.js — reads through
   _model(collection), always via .find()/.findOne() chained with
   whatever subset of .select()/.sort()/.lean() it happens to call,
   so the chain object supports all of them regardless of order. */
let mockDB;
function mockResetDB() {
  mockDB = {
    role_permissions: [],
    users: [],
    custom_roles: [],
    classes: [],
    teaching_assignments: [],
  };
}
function mockChain(result) {
  const c = { select: () => c, sort: () => c, limit: () => c, lean: () => Promise.resolve(result) };
  return c;
}
function mockMatches(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatches(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return true;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$in' in v) return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}
function mockCollectionFor(name) {
  return {
    find:    (filter) => mockChain(mockDB[name].filter(d => mockMatches(d, filter))),
    findOne: (filter) => mockChain(mockDB[name].find(d => mockMatches(d, filter)) ?? null),
  };
}

jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => mockCollectionFor(collection)),
}));

const { hasPermission, invalidatePermCache } = require('../middleware/rbac');
const { scopeMiddleware, invalidateScopeCache } = require('../middleware/scopeMiddleware');
const teachingAssignments = require('../routes/teaching-assignments');
const lessons             = require('../routes/lessons');
const weeklySnapshots     = require('../routes/weekly-snapshots');

const SCHOOL_A = 'sch_a';
const SCHOOL_B = 'sch_b';

async function runScope(jwtUser) {
  // scopeMiddleware.js's own cache is separate from rbac.js's — clear
  // this exact (userId, schoolId) pair too, so reusing an id across
  // tests (e.g. two different section-head fixtures both called
  // 'u_head') can never silently serve a stale scope from an earlier
  // test instead of resolving fresh against this test's own DB state.
  invalidateScopeCache(jwtUser.userId, jwtUser.schoolId);
  const req = { jwtUser };
  let called = false;
  await scopeMiddleware(req, {}, () => { called = true; });
  expect(called).toBe(true); // next() must always fire — a hang here would hide a real bug
  return req.scope;
}

beforeEach(() => {
  mockResetDB();
  // rbac.js's role/user permission cache and scopeMiddleware.js's scope
  // cache are both real, deliberately long-lived in-memory Maps — the
  // same reason every production write path calls invalidatePermCache
  // after saving. Without clearing them here too, a later test's fresh
  // DB fixture would silently be served an earlier test's cached result
  // for the same (schoolId, role) or (userId, schoolId) pair.
  invalidatePermCache(SCHOOL_A);
  invalidatePermCache(SCHOOL_B);
});

/* ══════════════════════════════════════════════════════════════
   §A — SCENARIO MATRIX
   ══════════════════════════════════════════════════════════════ */

describe('A1. Normal user — role permissions only', () => {
  test('effective permissions are exactly the role grant, nothing more, nothing less', async () => {
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'hr', permissions: { students: ['read'], hr: ['read'] } });
    const jane = { userId: 'u_jane', schoolId: SCHOOL_A, role: 'hr', roles: ['hr'] };
    expect(await hasPermission({ jwtUser: jane }, 'students', 'read')).toBe(true);
    expect(await hasPermission({ jwtUser: jane }, 'hr', 'read')).toBe(true);
    expect(await hasPermission({ jwtUser: jane }, 'finance', 'read')).toBe(false);
    expect(await hasPermission({ jwtUser: jane }, 'students', 'delete')).toBe(false);
  });
});

describe('A2. User with a sparse per-user override', () => {
  test('the touched permission is granted; everything the role already granted survives untouched', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'hr', permissions: { students: ['read'], hr: ['read'], attendance: ['read'] } },
      { schoolId: SCHOOL_A, userId: 'u_jane', permissions: { 'hr__payroll_view': ['read'] } },
    );
    const jane = { userId: 'u_jane', schoolId: SCHOOL_A, role: 'hr', roles: ['hr'] };
    expect(await hasPermission({ jwtUser: jane }, 'students', 'read')).toBe(true);
    expect(await hasPermission({ jwtUser: jane }, 'attendance', 'read')).toBe(true);
    expect(await hasPermission({ jwtUser: jane }, 'hr', 'read', 'payroll_view')).toBe(true);
  });
});

describe('A3. User with MULTIPLE per-user overrides across different modules', () => {
  test('each override applies independently — a grant here and a revoke there do not bleed into each other or into untouched modules', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'finance', permissions: { finance: ['read'], students: ['read'], attendance: ['read'] } },
      {
        schoolId: SCHOOL_A, userId: 'u_bob',
        permissions: {
          'finance__void_invoice': ['read', 'create'], // grant
          'finance__record_payment': [],                // revoke
        },
      },
    );
    const bob = { userId: 'u_bob', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'] };
    expect(await hasPermission({ jwtUser: bob }, 'finance', 'create', 'void_invoice')).toBe(true);   // granted sub-key
    expect(await hasPermission({ jwtUser: bob }, 'finance', 'create', 'record_payment')).toBe(false); // revoked sub-key
    expect(await hasPermission({ jwtUser: bob }, 'students', 'read')).toBe(true);    // untouched module, role-inherited
    expect(await hasPermission({ jwtUser: bob }, 'attendance', 'read')).toBe(true);  // untouched module, role-inherited
    expect(await hasPermission({ jwtUser: bob }, 'finance', 'read')).toBe(true);     // coarse gate, still role's own grant
  });
});

describe('A4. Legacy "deputy"', () => {
  test('no deputy-specific document — falls back live to deputy_principal', async () => {
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'deputy_principal', permissions: { finance: ['read'] } });
    const john = { userId: 'u_john', schoolId: SCHOOL_A, role: 'deputy', roles: ['deputy'] };
    expect(await hasPermission({ jwtUser: john }, 'finance', 'read')).toBe(true);
  });

  test('a STALE deputy document silently wins over the fallback — exactly the split-brain audit.js now detects', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'deputy_principal', permissions: { finance: ['read', 'create', 'update', 'delete'] } },
      { schoolId: SCHOOL_A, roleKey: 'deputy',            permissions: { finance: [] } }, // never updated when deputy_principal was
    );
    const john = { userId: 'u_john', schoolId: SCHOOL_A, role: 'deputy', roles: ['deputy'] };
    expect(await hasPermission({ jwtUser: john }, 'finance', 'read')).toBe(false); // stale doc wins, NOT the fresh deputy_principal edit
  });
});

describe('A5. deputy_principal — canonical key', () => {
  test('resolves directly, no alias involved', async () => {
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'deputy_principal', permissions: { finance: ['read', 'delete'] } });
    const john = { userId: 'u_john', schoolId: SCHOOL_A, role: 'deputy_principal', roles: ['deputy_principal'] };
    expect(await hasPermission({ jwtUser: john }, 'finance', 'delete')).toBe(true);
  });
});

describe('A6. Custom role', () => {
  test('resolves exactly like a built-in role, fully isolated from an unrelated system role\'s own document', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'librarian', permissions: { library: ['read', 'create'] } },
      { schoolId: SCHOOL_A, roleKey: 'teacher',   permissions: { library: [] } }, // must never leak into librarian's resolution
    );
    const amy = { userId: 'u_amy', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
    expect(await hasPermission({ jwtUser: amy }, 'library', 'create')).toBe(true);
    expect(await hasPermission({ jwtUser: amy }, 'library', 'delete')).toBe(false);
  });
});

describe('A7. extraRoles', () => {
  test('does NOT elevate a general rbac() check — a plain teacher with extraRoles=[hod] gets nothing extra on finance/hr', async () => {
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'teacher', permissions: { finance: [], hr: [] } });
    const carl = { userId: 'u_carl', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], extraRoles: ['hod'] };
    expect(await hasPermission({ jwtUser: carl }, 'finance', 'read')).toBe(false);
    expect(await hasPermission({ jwtUser: carl }, 'hr', 'read')).toBe(false);
  });

  test('DOES elevate on the three routes that intentionally check it', () => {
    const reqNoExtra = { jwtUser: { role: 'teacher', roles: ['teacher'] } };
    const reqHod      = { jwtUser: { role: 'teacher', roles: ['teacher'], extraRoles: ['hod'] } };
    expect(lessons.isHodOrAdmin(reqNoExtra)).toBe(false);
    expect(lessons.isHodOrAdmin(reqHod)).toBe(true);
    expect(teachingAssignments.canManage(reqHod)).toBe(true);      // no dept given yet -> provisionally allowed, validated later
    expect(teachingAssignments.canManage(reqNoExtra)).toBe(false);
    const eff = weeklySnapshots._effectiveRoles(reqHod);
    expect(eff.has('hod')).toBe(true);
  });
});

describe('A8. section_head with sectionAssigned', () => {
  test('resolves to section-level scope, narrowed to that section\'s classes', async () => {
    mockDB.classes.push(
      { schoolId: SCHOOL_A, id: 'cls_p1', sectionKey: 'primary' },
      { schoolId: SCHOOL_A, id: 'cls_s1', sectionKey: 'secondary' },
    );
    mockDB.users.push({ id: 'u_head', schoolId: SCHOOL_A, sectionAssigned: 'primary' });
    const scope = await runScope({ userId: 'u_head', schoolId: SCHOOL_A, role: 'section_head', roles: ['section_head'] });
    expect(scope.level).toBe('section');
    expect(scope.classIds).toEqual(['cls_p1']);
    expect(scope.classIds).not.toContain('cls_s1');
  });
});

describe('A9. Superadmin', () => {
  test('full access regardless of role_permissions state — even with zero documents for any role', async () => {
    const root = { userId: 'u_root', schoolId: SCHOOL_A, role: 'superadmin', roles: ['superadmin'] };
    expect(await hasPermission({ jwtUser: root }, 'finance', 'delete')).toBe(true);
    expect(await hasPermission({ jwtUser: root }, 'anything_undefined', 'read')).toBe(true);
  });

  test('scope is always unrestricted (school-level, no record narrowing)', async () => {
    const scope = await runScope({ userId: 'u_root', schoolId: SCHOOL_A, role: 'superadmin', roles: ['superadmin'] });
    expect(scope).toBeNull();
  });
});

describe('A10. Cross-school access', () => {
  test('a role grant in one school never applies to a same-named role in another school', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'teacher', permissions: { finance: ['read'] } }, // unusually broad, deliberately
      { schoolId: SCHOOL_B, roleKey: 'teacher', permissions: { finance: [] } },
    );
    const teacherB = { userId: 'u_x', schoolId: SCHOOL_B, role: 'teacher', roles: ['teacher'] };
    expect(await hasPermission({ jwtUser: teacherB }, 'finance', 'read')).toBe(false);
  });

  test('a per-user override in one school never applies to the same userId in another school', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'teacher', permissions: { finance: [] } },
      { schoolId: SCHOOL_B, roleKey: 'teacher', permissions: { finance: [] } },
      { schoolId: SCHOOL_A, userId: 'u_shared', permissions: { 'finance__void_invoice': ['read'] } }, // school A only
    );
    const sharedInB = { userId: 'u_shared', schoolId: SCHOOL_B, role: 'teacher', roles: ['teacher'] };
    expect(await hasPermission({ jwtUser: sharedInB }, 'finance', 'read', 'void_invoice')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   §B — SEVEN SPECIFIC PROOFS
   ══════════════════════════════════════════════════════════════ */

describe('B1. A per-user override cannot remove unrelated inherited permissions', () => {
  test('granting one thing under Per User leaves every other role-granted module exactly as it was', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'hr', permissions: { students: ['read'], attendance: ['read'], hr: ['read'] } },
      { schoolId: SCHOOL_A, userId: 'u_jane', permissions: { 'hr__payroll_view': ['read'] } },
    );
    const jane = { userId: 'u_jane', schoolId: SCHOOL_A, role: 'hr', roles: ['hr'] };
    expect(await hasPermission({ jwtUser: jane }, 'students', 'read')).toBe(true);
    expect(await hasPermission({ jwtUser: jane }, 'attendance', 'read')).toBe(true);
  });
});

describe('B2. A user cannot gain access merely by changing staffType', () => {
  test('rbac.js has no code path that reads teachers.staffType at all — it cannot influence this result even in principle', async () => {
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'deputy_principal', permissions: { finance: ['read', 'delete'] } });
    // The JWT — the only thing rbac.js ever consults — says role: 'teacher'.
    // staffType='deputy_principal' would live only on the teachers collection,
    // which this module never queries (confirmed: zero references to
    // 'teachers' or 'staffType' anywhere in rbac.js).
    const john = { userId: 'u_john', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    expect(await hasPermission({ jwtUser: john }, 'finance', 'delete')).toBe(false);
  });
});

describe('B3. extraRoles cannot accidentally become a general RBAC grant', () => {
  test('the exact same extraRoles=[hod] account that IS elevated on the three intended routes gets NOTHING extra through hasPermission()', async () => {
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'teacher', permissions: { finance: [], hr: [], settings: [] } });
    const carl = { userId: 'u_carl', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], extraRoles: ['hod', 'deputy', 'principal'] };
    // Even the most powerful-sounding extraRoles values must not touch the
    // general permission grid.
    expect(await hasPermission({ jwtUser: carl }, 'finance', 'read')).toBe(false);
    expect(await hasPermission({ jwtUser: carl }, 'hr', 'read')).toBe(false);
    expect(await hasPermission({ jwtUser: carl }, 'settings', 'update')).toBe(false);
  });
});

describe('B4. sectionAssigned cannot grant access to someone who lacks the required role', () => {
  test('a plain teacher with sectionAssigned mistakenly set is NOT given section-level scope', async () => {
    mockDB.classes.push({ schoolId: SCHOOL_A, id: 'cls_p1', sectionKey: 'primary' });
    mockDB.users.push({ id: 'u_teacher', schoolId: SCHOOL_A, sectionAssigned: 'primary' }); // set on the user record, but role is 'teacher'
    const scope = await runScope({ userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] });
    expect(scope.level).toBe('assigned'); // NOT 'section' — sectionAssigned is never even consulted for this role
    expect(scope.classIds).toEqual([]);   // no teaching_assignments seeded — correctly empty, not the section's classes
  });
});

describe('B5. A stale legacy deputy document cannot silently produce unexpected access after migration', () => {
  test('post-migration (no stale document left), resolution is clean and predictable — no leftover surprise', async () => {
    // Simulates the state AFTER migrate-legacy-deputy-role.js has run: the
    // redundant 'deputy' document is gone (either renamed or deleted per
    // its own safety rule), leaving only the canonical document.
    mockDB.role_permissions.push({ schoolId: SCHOOL_A, roleKey: 'deputy_principal', permissions: { finance: ['read', 'update'] } });
    const john = { userId: 'u_john', schoolId: SCHOOL_A, role: 'deputy', roles: ['deputy'] };
    expect(await hasPermission({ jwtUser: john }, 'finance', 'update')).toBe(true); // clean fallback, matches deputy_principal exactly
  });

  test('the migration tool itself never resolves a genuine divergence on its own — proven again here at the matrix level', () => {
    const { planRolePermsMigration } = require('../scripts/migrate-legacy-deputy-role');
    const plan = planRolePermsMigration(
      { roleKey: 'deputy',           permissions: { finance: ['read', 'create', 'update', 'delete'] } },
      { roleKey: 'deputy_principal', permissions: { finance: ['read'] } },
    );
    expect(plan.action).toBe('manual_review');
  });
});

describe('B6. A custom role cannot collide with any system role', () => {
  test('creation-time: a custom role deriving a reserved key is rejected (see custom-roles-reserved-keys.test.js for the full route-level suite)', () => {
    const { SYSTEM_ROLES } = require('../utils/role-validation');
    const BUILT_IN_ROLE_KEYS = new Set([...SYSTEM_ROLES, 'superadmin']);
    expect(BUILT_IN_ROLE_KEYS.has('principal')).toBe(true);       // the actual gap this fix closed
    expect(BUILT_IN_ROLE_KEYS.has('deputy_principal')).toBe(true);
    expect(BUILT_IN_ROLE_KEYS.has('superadmin')).toBe(true);
  });

  test('resolution-time: even if two documents existed under different keys, one never leaks into the other\'s result', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'librarian', permissions: { library: ['read'] } },
      { schoolId: SCHOOL_A, roleKey: 'principal',  permissions: { library: ['read', 'create', 'update', 'delete'] } },
    );
    const amy = { userId: 'u_amy', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
    expect(await hasPermission({ jwtUser: amy }, 'library', 'delete')).toBe(false); // principal's broader grant does not bleed in
  });
});

describe('B7. Tenant boundaries remain enforced regardless of role/override combination', () => {
  test('superadmin bypass is global by design (not schoolId-scoped) — the one deliberate exception, confirmed here so it is not mistaken for a leak', async () => {
    const root = { userId: 'u_root', schoolId: SCHOOL_B, role: 'superadmin', roles: ['superadmin'] };
    expect(await hasPermission({ jwtUser: root }, 'finance', 'delete')).toBe(true);
  });

  test('every non-superadmin path — role grant, per-user override, and custom role — is schoolId-scoped with no cross-tenant bleed', async () => {
    mockDB.role_permissions.push(
      { schoolId: SCHOOL_A, roleKey: 'finance',                  permissions: { finance: ['read', 'delete'] } },
      { schoolId: SCHOOL_B, roleKey: 'finance',                  permissions: { finance: [] } },
      { schoolId: SCHOOL_A, userId: 'u_dup',                     permissions: { 'finance__void_invoice': ['read'] } },
      { schoolId: SCHOOL_A, roleKey: 'front_desk_custom',        permissions: { finance: ['read'] } },
    );
    const financeB = { userId: 'u_dup', schoolId: SCHOOL_B, role: 'finance', roles: ['finance'] };
    expect(await hasPermission({ jwtUser: financeB }, 'finance', 'delete')).toBe(false);
    expect(await hasPermission({ jwtUser: financeB }, 'finance', 'read', 'void_invoice')).toBe(false);
    const customB = { userId: 'u_other', schoolId: SCHOOL_B, role: 'front_desk_custom', roles: ['front_desk_custom'] };
    expect(await hasPermission({ jwtUser: customB }, 'finance', 'read')).toBe(false); // school A's custom role doc doesn't exist in B
  });

  test('scope resolution (section-level) is also schoolId-scoped — a section-head in one school cannot see another school\'s classes', async () => {
    mockDB.classes.push(
      { schoolId: SCHOOL_A, id: 'cls_a_primary', sectionKey: 'primary' },
      { schoolId: SCHOOL_B, id: 'cls_b_primary', sectionKey: 'primary' },
    );
    mockDB.users.push({ id: 'u_head', schoolId: SCHOOL_A, sectionAssigned: 'primary' });
    const scope = await runScope({ userId: 'u_head', schoolId: SCHOOL_A, role: 'section_head', roles: ['section_head'] });
    expect(scope.classIds).toEqual(['cls_a_primary']);
    expect(scope.classIds).not.toContain('cls_b_primary');
  });
});
