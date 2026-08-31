/* ============================================================
   PUT /api/settings/school (modulePermissions.byUser) → rbac.js
   hasPermission() — full pipeline, end to end

   Role Architecture Audit 2026-08 §2d, "the most serious finding":
   an admin who granted one person ONE additional Per-User permission
   used to silently strip that person's inherited role access to
   every OTHER module — because the sync path fed the sparse toggle
   an admin actually made through the SAME derivation function used
   for a role's complete definition (_deriveApiPerms), which dutifully
   wrote an explicit empty array for every module the admin never
   touched. rbac.js's merge then took those empties as authoritative.

   This exercises the REAL, unmodified save route (settings.js's PUT
   /school) and the REAL, unmodified rbac.js hasPermission() against
   the SAME underlying fake role_permissions store — proving the
   actual save → merge pipeline, not just one half of it in isolation.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/module-gate', () => ({
  invalidateModuleConfigCache: jest.fn(),
}));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn() }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockSchoolsDocs, mockRolePermsDocs;

function _setDotted(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function _matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => doc[k] === v);
}
// One shared implementation used for BOTH _model('role_permissions') (what
// rbac.js reads through) and tenantModel('role_permissions', ...) (what
// settings.js writes through) — same underlying array either way, exactly
// like the real single collection they both actually point at.
function mockRolePermsCollection() {
  return {
    findOne: (filter) => ({
      lean: async () => {
        const d = mockRolePermsDocs.find(x => _matches(x, filter));
        return d ? { ...d } : null;
      },
    }),
    updateOne: (filter, update, opts = {}) => {
      let doc = mockRolePermsDocs.find(x => _matches(x, filter));
      if (!doc && opts.upsert) {
        doc = { ...filter };
        mockRolePermsDocs.push(doc);
      }
      if (doc && update.$set) {
        for (const [path, value] of Object.entries(update.$set)) _setDotted(doc, path, value);
      }
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    },
  };
}
function mockSchoolsCollection() {
  return {
    findOne: (filter) => ({
      lean: async () => {
        const d = mockSchoolsDocs.find(x => _matches(x, filter));
        return d ? { ...d } : null;
      },
    }),
    updateOne: (filter, update) => {
      const doc = mockSchoolsDocs.find(x => _matches(x, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    },
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools')          return mockSchoolsCollection();
    if (collection === 'role_permissions') return mockRolePermsCollection();
    throw new Error('unexpected _model collection: ' + collection);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'role_permissions') return mockRolePermsCollection();
    throw new Error('unexpected tenantModel collection: ' + collection);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');
const { hasPermission } = require('../../middleware/rbac');

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
  mockSchoolsDocs = [{ id: SCHOOL_ID, name: 'Demo School' }];
  // Jane's role ('hr') genuinely grants all three of these before any
  // override is ever saved.
  mockRolePermsDocs = [
    { schoolId: SCHOOL_ID, roleKey: 'admin', permissions: { settings: ['read', 'create', 'update', 'delete'] } },
    { schoolId: SCHOOL_ID, roleKey: 'hr',    permissions: { students: ['read'], hr: ['read'], attendance: ['read'] } },
  ];
});

test('THE BUG, full pipeline: granting Jane one Per-User permission through the real save route no longer erases her unrelated role access', async () => {
  const res = await supertest(buildApp())
    .put('/api/settings/school')
    .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
    .send({
      modulePermissions: {
        byUser: {
          u_jane: { 'hr__payroll_view': { v: true, e: false, d: false } },
        },
      },
    });

  expect(res.status).toBe(200);

  const jane = { jwtUser: { userId: 'u_jane', schoolId: SCHOOL_ID, role: 'hr', roles: ['hr'] } };
  // The actual reported bug: these two used to flip to false the moment
  // ANY per-user override was saved for Jane, regardless of module.
  expect(await hasPermission(jane, 'students', 'read')).toBe(true);
  expect(await hasPermission(jane, 'attendance', 'read')).toBe(true);
  // The thing that was actually granted still works.
  expect(await hasPermission(jane, 'hr', 'read', 'payroll_view')).toBe(true);
});

test('the stored per-user document is sparse — only the touched key exists at all, no manufactured empties', async () => {
  await supertest(buildApp())
    .put('/api/settings/school')
    .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
    .send({ modulePermissions: { byUser: { u_jane: { 'hr__payroll_view': { v: true, e: false, d: false } } } } });

  const stored = mockRolePermsDocs.find(d => d.userId === 'u_jane');
  expect(Object.keys(stored.permissions)).toEqual(['hr__payroll_view']);
});

test('a second, unrelated user with no override at all is completely unaffected by Jane\'s save', async () => {
  await supertest(buildApp())
    .put('/api/settings/school')
    .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }))
    .send({ modulePermissions: { byUser: { u_jane: { 'hr__payroll_view': { v: true, e: false, d: false } } } } });

  const carol = { jwtUser: { userId: 'u_carol', schoolId: SCHOOL_ID, role: 'hr', roles: ['hr'] } };
  expect(await hasPermission(carol, 'students', 'read')).toBe(true);
  // Carol never got an override — no per-user document exists for her at
  // all (not even an empty one), which is itself the point: Jane's save
  // only ever touched Jane's own record.
  expect(mockRolePermsDocs.find(d => d.userId === 'u_carol')).toBeUndefined();
});
