/* ============================================================
   server/routes/settings.js — PUT /school's Per-User permission-save
   validation must accept BOTH id forms

   Root cause: found live at a real school. A handful of legacy user
   accounts (identity-cutover era) were created with no `id` (UUID)
   field at all — only Mongo's own `_id`. An admin had previously saved
   a Per-User permission override for exactly such a user, which could
   only ever be keyed by that raw `_id` string (nothing else existed to
   key it by). From that point on, EVERY future Settings -> Roles &
   Permissions save for the WHOLE SCHOOL was rejected with "Not a real,
   active user in this school: <raw ObjectId>" — because the validation
   only ever checked users.id, which this user doesn't have — with no
   way for an admin to self-serve a fix (the byUser map isn't user-
   editable one row at a time; the whole permissions matrix saves
   together).

   Fix: when a userId in modulePermissions.byUser doesn't resolve via
   users.id, and looks like a Mongo ObjectId (24 hex chars), re-check it
   against users._id before rejecting the save.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';
const LEGACY_OID = '6a26bd01b5ae6942d1ae1dd8'; // 24-hex — the exact shape found live

function _matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) {
      // ObjectId-vs-string: compare by string form either side, matching
      // real MongoDB's actual _id equality semantics for this purpose.
      return v.$in.some(x => String(x) === String(doc[k]));
    }
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    return doc[k] === v;
  });
}
function mockMakeStore(initialDocs) {
  return { docs: [...initialDocs], find(filter) { return this.docs.find(d => _matches(d, filter)); } };
}
function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({ lean: jest.fn().mockResolvedValue(store.find(filter) ?? null) })),
    find: jest.fn((filter) => ({
      select: () => ({ lean: jest.fn().mockResolvedValue(store.docs.filter(d => _matches(d, filter))) }),
      lean: jest.fn().mockResolvedValue(store.docs.filter(d => _matches(d, filter))),
    })),
    updateOne: jest.fn((filter, update, opts = {}) => {
      let doc = store.find(filter);
      if (!doc && opts.upsert) { doc = { ...filter }; store.docs.push(doc); }
      if (doc && update.$set) Object.assign(doc, update.$set);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    create: jest.fn((doc) => { store.docs.push(doc); return Promise.resolve(doc); }),
  };
}

const mockActualRbac = jest.requireActual('../../middleware/rbac');
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
  hasExplicitSubGrant: jest.fn().mockResolvedValue(false),
  _mergeUserOverrides: jest.requireActual('../../middleware/rbac')._mergeUserOverrides,
  _loadPerms: jest.requireActual('../../middleware/rbac')._loadPerms,
  _loadUserPerms: jest.requireActual('../../middleware/rbac')._loadUserPerms,
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
  mockSchools = mockMakeStore([{ id: SCHOOL_A, name: 'School A' }]);
  // The legacy shape found live: a real, active user with NO `id` field —
  // only Mongo's own _id. Every other user in this codebase has both.
  mockUsers = mockMakeStore([
    { _id: LEGACY_OID, schoolId: SCHOOL_A, isActive: true, name: 'Ann Wanjiku' },
    { id: 'u_normal', schoolId: SCHOOL_A, isActive: true, name: 'A Normal User' },
  ]);
  mockRolePerms = mockMakeStore([
    { schoolId: SCHOOL_A, roleKey: 'admin', permissions: { hr: ['read'] } },
  ]);
  mockCustomRoles = mockMakeStore([]);
  mockActualRbac.invalidatePermCache(SCHOOL_A);
});

describe('PUT /api/settings/school — byUser validation accepts a legacy _id-only user', () => {
  test('a userId keyed by the legacy user\'s raw _id is accepted, not rejected as unknown', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'superadmin' }))
      .send({ modulePermissions: { byUser: { [LEGACY_OID]: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(200);
  });

  test('an id that genuinely matches nothing (not a real user, not a real _id) is still correctly rejected', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'superadmin' }))
      .send({ modulePermissions: { byUser: { ffffffffffffffffffffffff: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Not a real, active user/);
  });

  test('a normal id-form user still validates via the original path, unaffected', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'superadmin' }))
      .send({ modulePermissions: { byUser: { u_normal: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(200);
  });

  test('an inactive user with a legacy _id is still correctly rejected — the fallback respects isActive too', async () => {
    mockUsers.docs[0].isActive = false;
    const res = await supertest(buildApp())
      .put('/api/settings/school')
      .set('Cookie', cookieFor({ userId: 'u_admin', schoolId: SCHOOL_A, role: 'superadmin' }))
      .send({ modulePermissions: { byUser: { [LEGACY_OID]: { 'hr__x': { v: true, e: false, d: false } } } } });
    expect(res.status).toBe(400);
  });
});
