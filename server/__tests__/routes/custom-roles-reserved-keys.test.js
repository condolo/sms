/* ============================================================
   POST /api/settings/custom-roles — reserved system-role key
   collision guard

   Role Architecture Audit 2026-08 §5: BUILT_IN_ROLE_KEYS used to be
   its own locally-maintained list, independently drifted from
   role-validation.js's SYSTEM_ROLES (the file explicitly built to be
   "one list, one validator" so this class of drift can't happen). It
   had drifted — missing 'principal' entirely — so a school could
   create a custom role literally keyed 'principal', colliding with
   the real system role's own role_permissions document the moment
   both existed under the same key.

   Fixed to derive BUILT_IN_ROLE_KEYS from SYSTEM_ROLES (plus
   'superadmin', deliberately excluded from SYSTEM_ROLES for a
   different reason — never assignable via these routes, but still
   must be reserved from custom-role key reuse).

   These tests call the REAL authMiddleware with a REAL signed JWT and
   the real rbac() stack, per this session's established convention for
   verifying actual backend authorization behaviour.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/module-gate', () => ({
  invalidateModuleConfigCache: jest.fn(),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn() }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockCustomRoles, mockRolePerms;

function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue((() => { const d = store.find(filter); return d ? { ...d } : null; })()),
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
function mockMakeStore(initialDocs, matcher) {
  return { docs: [...initialDocs], find(filter) { return this.docs.find(d => matcher(d, filter)); } };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    return mockMakeCollection(mockMakeStore([], () => false));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'custom_roles')     return mockMakeCollection(mockCustomRoles);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
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
  mockCustomRoles = mockMakeStore([], (d, f) => d.schoolId === f.schoolId && d.key === f.key);
  mockRolePerms = mockMakeStore(
    [
      { schoolId: SCHOOL_ID, roleKey: 'admin', permissions: { settings: ['read', 'create', 'update', 'delete'] } },
      { schoolId: SCHOOL_ID, roleKey: 'teacher', permissions: { students: ['read'] } },
    ],
    (d, f) => d.schoolId === f.schoolId && d.roleKey === f.roleKey,
  );
});

describe('POST /api/settings/custom-roles — reserved key collisions', () => {
  test('THE FIX: a custom role deriving the key "principal" is now rejected — this used to be the actual gap', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
      .send({ label: 'Principal', baseRole: 'teacher' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/reserved/i);
    expect(mockCustomRoles.docs).toHaveLength(0);
  });

  test('a custom role deriving "superadmin" is still rejected (unchanged, was already covered)', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
      .send({ label: 'Superadmin', baseRole: 'teacher' });

    expect(res.status).toBe(409);
  });

  test('a custom role deriving "deputy_principal" is still rejected (unchanged, was already covered)', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
      .send({ label: 'Deputy Principal', baseRole: 'teacher' });

    expect(res.status).toBe(409);
  });

  test('the legacy "deputy" alias key is also rejected — it is still a real, reserved role key even though hidden from the UI', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
      .send({ label: 'Deputy', baseRole: 'teacher' });

    expect(res.status).toBe(409);
  });

  test('a genuinely new role name with no collision is still allowed', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/custom-roles')
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
      .send({ label: 'Librarian', baseRole: 'teacher' });

    expect(res.status).toBe(201);
    expect(mockCustomRoles.docs).toHaveLength(1);
    expect(mockCustomRoles.docs[0].key).toBe('librarian');
  });
});
