/* ============================================================
   Integration tests — settings.js AuditService instrumentation
   (Audit Instrumentation sprint, 2026-07-29)

   Verifies the newly-added AuditService.log() calls actually fire with
   the right action/target/details for the highest-value settings.js
   mutations: user create/role-change/deactivate, school profile update
   (incl. permission/module-config escalation), and custom-role
   create/delete. Not exhaustive over every route touched this sprint —
   the branding/SMTP asset routes share the same one-line call shape and
   are lower stakes, so they're left to the manual smoke pass.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
}));
jest.mock('../../middleware/module-gate', () => ({
  invalidateModuleConfigCache: jest.fn(),
}));
jest.mock('../../utils/email', () => ({
  sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
const mockInvalidateScopeCache = jest.fn();
jest.mock('../../middleware/scopeMiddleware', () => ({
  invalidateScopeCache: (...args) => mockInvalidateScopeCache(...args),
  invalidateScopeCacheForRole: jest.fn(),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockUsers, mockSchools, mockCustomRoles, mockRolePerms, mockTeachers;

function mockMakeCollection(store) {
  return {
    // .lean() always returns a fresh snapshot copy in real Mongoose — a
    // live reference here would let a later updateOne() mutate a
    // caller's already-resolved "prior state" object out from under it
    // (settings.js's PUT /users/:id relies on precisely that
    // before/after distinction for its role-changed audit check).
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue((() => { const d = store.find(filter); return d ? { ...d } : null; })()),
    })),
    updateOne: jest.fn((filter, update) => {
      const doc = store.find(filter);
      if (doc) store.apply(doc, update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    create: jest.fn((doc) => { store.docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const doc = store.find(filter);
      if (doc) store.apply(doc, update);
      return { lean: jest.fn().mockResolvedValue(doc ?? null) };
    }),
    findOneAndDelete: jest.fn((filter) => {
      const doc = store.find(filter);
      if (doc) store.docs = store.docs.filter(d => d !== doc);
      return Promise.resolve(doc ?? null);
    }),
    deleteOne: jest.fn(() => Promise.resolve({ deletedCount: 1 })),
    find: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(store.docs) })),
  };
}

function mockMakeStore(initialDocs, matcher) {
  return {
    docs: [...initialDocs],
    find(filter) { return this.docs.find(d => matcher(d, filter)); },
    apply(doc, update) {
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    },
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return mockMakeCollection(mockSchools);
    return mockMakeCollection(mockMakeStore([], () => false));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'users') return mockMakeCollection(mockUsers);
    if (collection === 'custom_roles') return mockMakeCollection(mockCustomRoles);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    if (collection === 'teachers') return mockMakeCollection(mockTeachers);
    return mockMakeCollection(mockMakeStore([], () => false));
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

function authCookie(payload) {
  return `token=${sign({ role: 'admin', ...payload })}`;
}

const SCHOOL_ID = 'sch_demo_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers = mockMakeStore(
    [{ id: 'usr_admin_001', email: 'admin@demo.school', role: 'admin', schoolId: SCHOOL_ID, isActive: true }],
    (d, f) => (f.id ? d.id === f.id : false) || (f.email ? d.email === f.email : false)
      || (f.$or ? f.$or.some(c => (c.id && d.id === c.id) || (c.email && d.email === c.email)) : false)
  );
  mockSchools = mockMakeStore(
    [{ id: SCHOOL_ID, name: 'Demo School' }],
    (d, f) => d.id === f.id
  );
  mockCustomRoles = mockMakeStore([], (d, f) => d.schoolId === f.schoolId && d.key === f.key);
  mockRolePerms = mockMakeStore(
    [{ schoolId: SCHOOL_ID, roleKey: 'teacher', permissions: { library: ['read'] } }],
    (d, f) => d.schoolId === f.schoolId && d.roleKey === f.roleKey
  );
  mockTeachers = mockMakeStore([], () => false);
});

describe('POST /api/settings/users/invite', () => {
  test('logs user.created with the invited role', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ email: 'new.teacher@demo.school', name: 'New Teacher', role: 'teacher' });

    expect(res.status).toBe(201);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.created',
      details: expect.objectContaining({ role: 'teacher' }),
    }));
  });
});

describe('PUT /api/settings/users/:id', () => {
  test('role actually changing logs user.role_changed with old and new role', async () => {
    mockUsers.docs.push({ id: 'usr_target_001', email: 't@demo.school', role: 'teacher', schoolId: SCHOOL_ID });
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings/users/usr_target_001')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ role: 'finance' });

    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.role_changed',
      details: expect.objectContaining({ oldRole: 'teacher', newRole: 'finance' }),
    }));
  });

  test('role changing busts the per-user scope cache — not just the token', async () => {
    // The token revocation alone forces a fresh JWT on the next request,
    // but scopeMiddleware's own cache is a SEPARATE 5-minute entry keyed
    // by userId::schoolId — someone moving between two different scoped
    // roles within that window could otherwise see stale classIds despite
    // an already-correct token. See settings.js's PUT /users/:id comment.
    mockUsers.docs.push({ id: 'usr_target_001', email: 't@demo.school', role: 'teacher', schoolId: SCHOOL_ID });
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings/users/usr_target_001')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ role: 'finance' });

    expect(res.status).toBe(200);
    expect(mockInvalidateScopeCache).toHaveBeenCalledWith('usr_target_001', SCHOOL_ID);
  });

  test('role field resent unchanged does NOT log a role change', async () => {
    mockUsers.docs.push({ id: 'usr_target_001', email: 't@demo.school', role: 'teacher', schoolId: SCHOOL_ID });
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings/users/usr_target_001')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ role: 'teacher' });

    expect(res.status).toBe(200);
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'user.role_changed' }));
  });
});

describe('DELETE /api/settings/users/:id', () => {
  test('logs user.deactivated for the removed user', async () => {
    mockUsers.docs.push({ id: 'usr_target_001', email: 't@demo.school', role: 'teacher', schoolId: SCHOOL_ID });
    const app = buildApp();
    const res = await supertest(app)
      .delete('/api/settings/users/usr_target_001')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.deactivated',
      target: expect.objectContaining({ id: 'usr_target_001' }),
    }));
  });
});

describe('PUT /api/settings/school', () => {
  test('a plain profile field change logs settings.school_updated at default severity', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings/school')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ tagline: 'New tagline' });

    expect(res.status).toBe(200);
    const call = mockAuditLog.mock.calls.find(([c]) => c.action === 'settings.school_updated');
    expect(call).toBeDefined();
    expect(call[0].severity).toBeUndefined();
    expect(call[0].details.touchesPermissions).toBe(false);
  });

  test('a moduleConfig (module on/off) change escalates to warn severity', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings/school')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ moduleConfig: { library: { enabled: false } } });

    expect(res.status).toBe(200);
    const call = mockAuditLog.mock.calls.find(([c]) => c.action === 'settings.school_updated');
    expect(call[0].severity).toBe('warn');
    expect(call[0].details.touchesModuleConfig).toBe(true);
  });
});

describe('Custom roles', () => {
  test('POST /custom-roles logs settings.custom_role_created', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/custom-roles')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ label: 'Head Librarian', baseRole: 'teacher' });

    expect(res.status).toBe(201);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'settings.custom_role_created',
      target: expect.objectContaining({ id: 'head_librarian' }),
    }));
  });

  test('DELETE /custom-roles/:key logs settings.custom_role_deleted (catalog default severity: warn)', async () => {
    mockCustomRoles.docs.push({ id: 'cr_1', schoolId: SCHOOL_ID, key: 'head_librarian', label: 'Head Librarian' });
    const app = buildApp();
    const res = await supertest(app)
      .delete('/api/settings/custom-roles/head_librarian')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    const call = mockAuditLog.mock.calls.find(([c]) => c.action === 'settings.custom_role_deleted');
    expect(call).toBeDefined();
    expect(call[0].target).toEqual(expect.objectContaining({ id: 'head_librarian', label: 'Head Librarian' }));
    // No explicit severity override — relies on the ACTIONS catalog default
    // ('warn' for this action, see server/services/audit.js), same
    // convention as hr.js's payroll.deleted default-severity case.
    expect(call[0].severity).toBeUndefined();
  });
});
