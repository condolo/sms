/* ============================================================
   POST /api/settings/users/bulk-invite — role validation (Issue B)

   Root cause: unlike POST /users/invite and PUT /users/:id (both of which
   validate `role` against BUILTIN_INVITE_ROLES ∪ custom_roles before
   creating/updating a user), bulk-invite did `const role = s.role || 'teacher'`
   with NO validation at all. The client (HRPage.jsx's bulkInviteStaff)
   sends `role: t.staffType` — a free-text HR job-title field, not a
   controlled vocabulary — so any staff member whose staffType wasn't
   coincidentally a real role key got a login account created with a
   garbage `role`. That account authenticates fine (password matches) but
   fails EVERY RBAC check silently (`_loadPerms` returns {} for an
   unrecognized role), producing a fully locked-out ghost account with no
   error ever shown to the admin or the user.

   These tests call the REAL authMiddleware with a REAL signed JWT (not
   mocked away) and hit the actual rbac() middleware against a real
   role_permissions fixture — per the audit's requirement to verify actual
   backend authorization behaviour, not just that a function returns the
   right boolean in isolation.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/module-gate', () => ({
  invalidateModuleConfigCache: jest.fn(),
  moduleGate: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockUsers, mockSchools, mockCustomRoles, mockRolePerms, mockTeachers;

function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue((() => { const d = store.find(filter); return d ? { ...d } : null; })()),
    })),
    updateOne: jest.fn((filter, update) => {
      const doc = store.find(filter);
      if (doc) store.apply(doc, update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    create: jest.fn((doc) => { store.docs.push(doc); return Promise.resolve(doc); }),
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
  // rbac.js's own permission lookup goes through _model('role_permissions')
  // directly (not tenantModel) — must route here too, or every rbac()
  // check 403s before the route handler is ever reached.
  _model: jest.fn((collection) => {
    if (collection === 'schools')          return mockMakeCollection(mockSchools);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    return mockMakeCollection(mockMakeStore([], () => false));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'users')          return mockMakeCollection(mockUsers);
    if (collection === 'custom_roles')   return mockMakeCollection(mockCustomRoles);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    if (collection === 'teachers')       return mockMakeCollection(mockTeachers);
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
  );
  mockSchools = mockMakeStore([{ id: SCHOOL_ID, name: 'Demo School' }], (d, f) => d.id === f.id);
  mockCustomRoles = mockMakeStore(
    [{ schoolId: SCHOOL_ID, key: 'front_office', label: 'Front Office', baseRole: 'teacher' }],
    (d, f) => d.schoolId === f.schoolId && d.key === f.key
  );
  // Real rbac() middleware runs in this file (deliberately not mocked away —
  // the audit's requirement is to verify actual backend authorization
  // behaviour), so the signed-in 'admin' caller needs a real role_permissions
  // grant for settings:create, exactly as repairPermissions.js provisions
  // for every real school. Admin does NOT bypass rbac() (only superadmin
  // does — see rbac.js's own header comment), so without this every request
  // 403s before reaching the bulk-invite handler at all.
  mockRolePerms = mockMakeStore(
    [{ schoolId: SCHOOL_ID, roleKey: 'admin', permissions: { settings: ['read', 'create', 'update', 'delete'] } }],
    (d, f) => d.schoolId === f.schoolId && d.roleKey === f.roleKey
  );
  mockTeachers = mockMakeStore([], () => false);
});

describe('POST /api/settings/users/bulk-invite — role validation', () => {
  test('rejects a garbage/free-text role instead of silently creating a locked-out account', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [
        { name: 'Random Staffer', email: 'random@demo.school', role: 'Front Office Assistant' }, // free-text staffType, not a real key
      ] });

    expect(res.status).toBe(201); // batch endpoint: still 201, but this row must be rejected
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'random@demo.school' })])
    );
    // The critical assertion: no user document was actually created for the garbage role.
    expect(mockUsers.docs.find(u => u.email === 'random@demo.school')).toBeUndefined();
  });

  test('accepts a real built-in role', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [{ name: 'A Teacher', email: 'teacher@demo.school', role: 'teacher' }] });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    expect(mockUsers.docs.find(u => u.email === 'teacher@demo.school')?.role).toBe('teacher');
  });

  test('accepts a real custom role — custom roles must continue to work', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [{ name: 'Front Desk', email: 'frontdesk@demo.school', role: 'front_office' }] });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    expect(mockUsers.docs.find(u => u.email === 'frontdesk@demo.school')?.role).toBe('front_office');
  });

  test('non-admin cannot be smuggled in via bulk-invite (superadmin-only guard applies here too)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID })) // signed in as plain admin, not superadmin
      .send({ staff: [{ name: 'Sneaky', email: 'sneaky@demo.school', role: 'admin' }] });

    expect(res.body.data.created).toBe(0);
    expect(mockUsers.docs.find(u => u.email === 'sneaky@demo.school')).toBeUndefined();
  });

  test('mixed batch: valid rows created, invalid rows rejected, independently', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [
        { name: 'Good Teacher', email: 'good@demo.school', role: 'teacher' },
        { name: 'Bad Row', email: 'bad@demo.school', role: 'Marketing' },
      ] });

    expect(res.body.data.created).toBe(1);
    expect(res.body.data.errors.length).toBe(1);
    expect(mockUsers.docs.find(u => u.email === 'good@demo.school')).toBeDefined();
    expect(mockUsers.docs.find(u => u.email === 'bad@demo.school')).toBeUndefined();
  });

  test('END-TO-END: a user created via bulk-invite with a valid role can actually pass a real protected-endpoint RBAC check', async () => {
    mockRolePerms.docs.push({ schoolId: SCHOOL_ID, roleKey: 'teacher', permissions: { students: ['read'] } });
    const app = buildApp();

    await supertest(app)
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [{ name: 'Real Teacher', email: 'real@demo.school', role: 'teacher' }] });

    const created = mockUsers.docs.find(u => u.email === 'real@demo.school');
    expect(created).toBeDefined();

    // Now authenticate AS that created user and hit a real rbac()-gated route
    // to prove the resulting account's authorization actually works end-to-end,
    // not just that the DB row looks right.
    const { rbac } = require('../../middleware/rbac');
    const probeApp = express();
    probeApp.use(express.json());
    probeApp.use(require('cookie-parser')());
    const { authMiddleware } = require('../../middleware/auth');
    probeApp.get('/probe', authMiddleware, rbac('students', 'read'), (req, res) => res.json({ ok: true }));

    const probeRes = await supertest(probeApp)
      .get('/probe')
      .set('Cookie', `token=${sign({ userId: created.id, schoolId: SCHOOL_ID, role: created.role, roles: created.roles })}`);

    expect(probeRes.status).toBe(200);
  });
});
