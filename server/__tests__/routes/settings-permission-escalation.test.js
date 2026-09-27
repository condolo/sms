/* ============================================================
   Permission self-escalation guard — security review, 2026-09.

   "Give role and per-user permission management its own explicit
   server-side capability, separate from general settings:update. Check
   every requested grant against the actor's authority. Do not let an
   actor grant permissions they do not hold or create a higher-privilege
   administrator. Validate per-user override targets against active
   users in the same school; reject unknown, inactive, or cross-school
   users. Record permission changes with actor, target, before/after
   values, request ID, timestamp, and school."

   Real gaps this closes, confirmed against the actual code before
   fixing (not assumed):
   - PUT /school wrote role_permissions.byRole/byUser under the same
     generic rbac('settings','update') as trivial fields (logo, SMTP) —
     moduleRegistry.js already listed a 'settings__permissions' sub-
     permission ("Manage Roles & Permissions") but nothing server-side
     ever checked it.
   - The role-permission sync only skipped 'superadmin' — an admin could
     write ANY other role's permissions, including granting something
     the admin itself doesn't hold.
   - POST /custom-roles copied baseRole's permissions as-is with zero
     check on baseRole's legitimacy or the actor's own authority — an
     admin could name baseRole:'admin' (or worse) and get a full copy.
   - Per-user overrides upserted on a raw userId with no check the user
     exists or is active in that school.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';

function _matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    return doc[k] === v;
  });
}
function _setDotted(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function mockMakeStore(initialDocs) {
  return {
    docs: [...initialDocs],
    find(filter) { return this.docs.find(d => _matches(d, filter)); },
    apply(doc, update) {
      if (update.$set) for (const [path, value] of Object.entries(update.$set)) _setDotted(doc, path, value);
    },
  };
}
// Real Mongoose .lean() always returns a fully independent plain object —
// a shallow {...d} here would still share nested objects (e.g.
// `permissions`) with the live store doc, so a later updateOne() mutating
// that doc in place would silently mutate an already-resolved "before"
// snapshot out from under it too (exactly the bug this file's audit-diff
// test exists to catch — the mock has to actually deep-clone, or that
// test would pass for the wrong reason).
function _deepClone(d) { return d ? JSON.parse(JSON.stringify(d)) : d; }
function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue(_deepClone(store.find(filter)) ?? null),
    })),
    find: jest.fn((filter) => ({
      select: () => ({ lean: jest.fn().mockResolvedValue(store.docs.filter(d => _matches(d, filter)).map(_deepClone)) }),
      lean: jest.fn().mockResolvedValue(store.docs.filter(d => _matches(d, filter)).map(_deepClone)),
    })),
    updateOne: jest.fn((filter, update, opts = {}) => {
      let doc = store.find(filter);
      if (!doc && opts.upsert) { doc = { ...filter }; store.docs.push(doc); }
      if (doc && update.$set) store.apply(doc, update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    create: jest.fn((doc) => { store.docs.push(doc); return Promise.resolve(doc); }),
  };
}

const mockActualRbac = jest.requireActual('../../middleware/rbac');
let mockHasExplicitSubGrant;
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
  hasExplicitSubGrant: (...args) => mockHasExplicitSubGrant(...args),
  _mergeUserOverrides: mockActualRbac._mergeUserOverrides,
  _loadPerms: mockActualRbac._loadPerms,
  _loadUserPerms: mockActualRbac._loadUserPerms,
}));
jest.mock('../../middleware/module-gate', () => ({ invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn() }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../middleware/scopeMiddleware', () => ({
  invalidateScopeCache: jest.fn(),
  invalidateScopeCacheForRole: jest.fn(),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockSchools, mockUsers, mockRolePerms, mockCustomRoles;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return mockMakeCollection(mockSchools);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    return mockMakeCollection(mockMakeStore([]));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    if (collection === 'users') return mockMakeCollection(mockUsers);
    if (collection === 'custom_roles') return mockMakeCollection(mockCustomRoles);
    return mockMakeCollection(mockMakeStore([]));
  },
}));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}
function cookieFor(payload) { return `token=${sign(payload)}`; }

beforeEach(() => {
  jest.clearAllMocks();
  mockHasExplicitSubGrant = jest.fn().mockResolvedValue(false);
  mockSchools = mockMakeStore([{ id: SCHOOL_A, name: 'School A' }]);
  mockUsers = mockMakeStore([
    { id: 'u_hr1', schoolId: SCHOOL_A, isActive: true },
    { id: 'u_inactive', schoolId: SCHOOL_A, isActive: false },
  ]);
  mockRolePerms = mockMakeStore([
    { schoolId: SCHOOL_A, roleKey: 'admin', permissions: { students: ['read', 'create', 'update', 'delete'], hr: ['read'] } },
    { schoolId: SCHOOL_A, roleKey: 'hr',    permissions: { hr: ['read'] } },
    { schoolId: SCHOOL_A, roleKey: 'teacher', permissions: { library: ['read'] } },
  ]);
  mockCustomRoles = mockMakeStore([]);
  mockActualRbac.invalidatePermCache(SCHOOL_A);
});

describe('PUT /api/settings/school — dedicated permission-management capability', () => {
  test('a non-floor role without settings__permissions cannot touch modulePermissions.byRole', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_hr1', schoolId: SCHOOL_A, role: 'hr' }))
      .send({ modulePermissions: { byRole: { teacher: { 'library__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(403);
  });

  test('a role WITH the explicit settings__permissions grant can', async () => {
    mockHasExplicitSubGrant = jest.fn().mockResolvedValue(true);
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_hr1', schoolId: SCHOOL_A, role: 'hr' }))
      .send({ modulePermissions: { byRole: { teacher: { 'hr__x': { v: true, e: false, d: false } } } } });
    // hr's own ceiling includes hr:read, so this specific grant is within bounds.
    expect(res.status).toBe(200);
  });

  test('admin (floor) needs no explicit grant', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byRole: { teacher: { 'students__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(200);
    expect(mockHasExplicitSubGrant).not.toHaveBeenCalled();
  });

  test('unrelated fields alone (no modulePermissions) never trigger the new checks at all', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_hr1', schoolId: SCHOOL_A, role: 'hr' }))
      .send({ name: 'New School Name' });
    expect(res.status).toBe(200);
    expect(mockHasExplicitSubGrant).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings/school — self-escalation guard', () => {
  test('admin cannot grant a role something admin does not itself hold', async () => {
    // admin has no 'library' grant at all in the seed above.
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byRole: { teacher: { 'library__x': { v: true, e: true, d: true } } } } });
    expect(res.status).toBe(422);
    // Nothing written — teacher's role_permissions doc is untouched.
    const teacherDoc = mockRolePerms.docs.find(d => d.roleKey === 'teacher');
    expect(teacherDoc.permissions.library__x).toBeUndefined();
  });

  test('admin CAN grant a role a subset of what admin itself holds', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byRole: { teacher: { 'students__view': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(200);
    const teacherDoc = mockRolePerms.docs.find(d => d.roleKey === 'teacher');
    expect(teacherDoc.permissions['students__view']).toEqual(['read']);
  });

  test('an actor cannot escalate their OWN role beyond what they currently hold', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byRole: { admin: { 'library__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(422);
  });

  test('superadmin bypasses the ceiling entirely', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_super', schoolId: SCHOOL_A, role: 'superadmin' }))
      .send({ modulePermissions: { byRole: { teacher: { 'library__x': { v: true, e: true, d: true } } } } });
    expect(res.status).toBe(200);
    const teacherDoc = mockRolePerms.docs.find(d => d.roleKey === 'teacher');
    expect(teacherDoc.permissions['library__x']).toEqual(['read', 'create', 'update', 'delete']);
  });

  test('superadmin\'s OWN role_permissions doc is still never written via this route', async () => {
    mockRolePerms.docs.push({ schoolId: SCHOOL_A, roleKey: 'superadmin', permissions: { hr: ['read'] } });
    await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_super', schoolId: SCHOOL_A, role: 'superadmin' }))
      .send({ modulePermissions: { byRole: { superadmin: { 'hr__x': { v: true, e: false, d: false } } } } });
    const superDoc = mockRolePerms.docs.find(d => d.roleKey === 'superadmin');
    expect(superDoc.permissions['hr__x']).toBeUndefined();
  });
});

describe('PUT /api/settings/school — per-user override target validation', () => {
  test('rejects an override for a user that does not exist in this school', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byUser: { u_ghost: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(400);
  });

  test('rejects an override for a real but INACTIVE user', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byUser: { u_inactive: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(400);
  });

  test('a real, active user within the actor\'s ceiling succeeds', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byUser: { u_hr1: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(200);
    const userDoc = mockRolePerms.docs.find(d => d.userId === 'u_hr1');
    expect(userDoc.permissions['hr__x']).toEqual(['read']);
  });

  test('an override exceeding the actor\'s own ceiling is rejected', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byUser: { u_hr1: { 'library__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/settings/school — permission-change audit diff', () => {
  test('logs settings.permissions_changed with real before/after values', async () => {
    await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ modulePermissions: { byRole: { teacher: { 'students__view': { v: true, e: false, d: false } } } } });

    const call = mockAuditLog.mock.calls.map(([c]) => c).find(c => c.action === 'settings.permissions_changed');
    expect(call).toBeDefined();
    // before = the real prior doc (untouched by this write); after =
    // _deriveApiPerms' full derived set (by design it always includes
    // every registered module, empty array meaning "no access" — see its
    // own comment) — asserting the two specific keys this request
    // actually changed, not the whole shape.
    expect(call.details.byRole.teacher.before).toEqual({ library: ['read'] });
    expect(call.details.byRole.teacher.after['students__view']).toEqual(['read']);
    expect(call.details.byRole.teacher.after['students']).toEqual(['read']);
    expect(call.severity).toBe('warn');
  });

  test('does not fire when the request never touched modulePermissions', async () => {
    await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ name: 'New Name' });
    expect(mockAuditLog.mock.calls.map(([c]) => c.action)).not.toContain('settings.permissions_changed');
  });
});

describe('POST /api/settings/custom-roles — baseRole cannot be used to escalate', () => {
  test('rejects an unknown baseRole', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ label: 'Ghost Role', baseRole: 'not_a_real_role' });
    expect(res.status).toBe(400);
  });

  test('baseRole:"admin" from a non-superadmin actor is capped to the actor\'s own ceiling, not a full admin copy', async () => {
    // Give a non-admin, non-floor actor the explicit management grant, with
    // a narrower ceiling than admin's own (no 'students' at all).
    mockHasExplicitSubGrant = jest.fn().mockResolvedValue(true);
    mockRolePerms.docs.push({ schoolId: SCHOOL_A, roleKey: 'hr', permissions: { hr: ['read'] } });
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', cookieFor({ userId: 'u_hr1', schoolId: SCHOOL_A, role: 'hr' }))
      .send({ label: 'Fake Admin', baseRole: 'admin' });
    expect(res.status).toBe(201);
    const created = mockRolePerms.docs.find(d => d.roleKey === 'fake_admin');
    // admin's real doc has students:[...] AND hr:['read'] — only the part
    // within the hr actor's own ceiling (hr:['read']) should survive.
    expect(created.permissions.students).toEqual([]);
    expect(created.permissions.hr).toEqual(['read']);
  });

  test('a floor admin creating a role based on "teacher" gets the full teacher grant (within admin\'s own ceiling)', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' }))
      .send({ label: 'Head Librarian', baseRole: 'teacher' });
    expect(res.status).toBe(201);
    // admin doesn't hold 'library' itself, so even the floor role's copy is capped.
    const created = mockRolePerms.docs.find(d => d.roleKey === 'head_librarian');
    expect(created.permissions.library).toEqual([]);
  });

  test('non-floor actor without settings__permissions cannot create a custom role at all', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', cookieFor({ userId: 'u_hr1', schoolId: SCHOOL_A, role: 'hr' }))
      .send({ label: 'Some Role', baseRole: 'teacher' });
    expect(res.status).toBe(403);
  });
});
