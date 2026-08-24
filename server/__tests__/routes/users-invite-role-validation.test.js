/* ============================================================
   POST /api/users/invite and /api/users/bulk-invite — role validation

   Found live during the staffType/role separation audit: routes/users.js
   is a SEPARATE, independently-mounted route file (server/index.js:
   app.use('/api/users', require('./routes/users'))) — not the same as
   /api/settings/users/* (already validated). Its own POST /invite and
   POST /bulk-invite had NO role validation at all: `const safeRole =
   role || 'teacher'`, accepting any string, with only a superadmin-only
   check for the literal string 'superadmin' — not even 'admin'. The
   product's client never calls these two endpoints (only /settings/
   users/invite and /settings/users/bulk-invite), but they were live,
   mounted, and directly callable by anyone who cleared rbac('settings',
   'users') — which turned out to itself be an unreachable action key for
   every role except superadmin (repairPermissions.js's ROLE_DEFAULTS
   never grants a 'users' action, only read/create/update/delete), an
   accidental protection that happened to fail closed but was never a
   deliberate one and shouldn't be relied on.

   Both routes now use the same shared validateAssignableRole() as every
   other role-assigning route in the app.

   Real authMiddleware + real rbac() — not mocked away.
   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_ID = 'sch_demo_001';

function mockChainObj(obj) {
  return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) };
}

let mockUsers, mockCustomRoles, mockRolePerms;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'role_permissions') {
      return { findOne: (filter) => mockChainObj(mockRolePerms.find(d => d.schoolId === filter.schoolId && d.roleKey === filter.roleKey) ?? null) };
    }
    if (col === 'schools') return { findOne: () => mockChainObj({ id: SCHOOL_ID, name: 'Demo School' }) };
    return { findOne: () => mockChainObj(null) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'users') {
      return {
        findOne: (filter) => mockChainObj(mockUsers.find(d => d.schoolId === filter.schoolId && d.email === filter.email) ?? null),
        create: (doc) => { const d = { ...doc, toObject: () => d }; mockUsers.push(d); return Promise.resolve(d); },
      };
    }
    if (col === 'custom_roles') {
      return { findOne: (filter) => mockChainObj(mockCustomRoles.find(d => d.schoolId === filter.schoolId && d.key === filter.key) ?? null) };
    }
    return { findOne: () => mockChainObj(null) };
  }),
}));

jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');
const usersRouter = require('../../routes/users');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/users', usersRouter);
  return app;
}

function cookieFor(role) {
  return `token=${sign({ userId: 'usr_caller', schoolId: SCHOOL_ID, role, roles: [role] })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers = [];
  mockCustomRoles = [{ schoolId: SCHOOL_ID, key: 'front_office', label: 'Front Office' }];
  // rbac('settings','users') — real behaviour: only superadmin bypasses
  // (no ROLE_DEFAULTS grant ever includes a 'users' action), so grant
  // nothing to 'admin' here — matches production exactly, not a workaround.
  mockRolePerms = [];
});

describe('POST /api/users/invite — role validation (as superadmin, the only role that clears rbac here)', () => {
  test('rejects a garbage/free-text role', async () => {
    const res = await supertest(buildApp())
      .post('/api/users/invite')
      .set('Cookie', cookieFor('superadmin'))
      .send({ name: 'Someone', email: 'someone@demo.school', role: 'Marketing Coordinator' });

    expect(res.status).toBe(400);
    expect(mockUsers.find(u => u.email === 'someone@demo.school')).toBeUndefined();
  });

  test('accepts a real built-in role', async () => {
    const res = await supertest(buildApp())
      .post('/api/users/invite')
      .set('Cookie', cookieFor('superadmin'))
      .send({ name: 'A Teacher', email: 'teacher@demo.school', role: 'teacher' });

    expect(res.status).toBe(201);
    expect(mockUsers.find(u => u.email === 'teacher@demo.school')?.role).toBe('teacher');
  });

  test('accepts a real custom role', async () => {
    const res = await supertest(buildApp())
      .post('/api/users/invite')
      .set('Cookie', cookieFor('superadmin'))
      .send({ name: 'Front Desk', email: 'front@demo.school', role: 'front_office' });

    expect(res.status).toBe(201);
    expect(mockUsers.find(u => u.email === 'front@demo.school')?.role).toBe('front_office');
  });
});

describe('POST /api/users/bulk-invite — role validation', () => {
  test('rejects a garbage role per-row instead of silently creating a locked-out account', async () => {
    const res = await supertest(buildApp())
      .post('/api/users/bulk-invite')
      .set('Cookie', cookieFor('superadmin'))
      .send([{ name: 'Bad Row', email: 'bad@demo.school', role: 'Whatever Free Text' }]);

    expect(res.status).toBe(201); // batch endpoint, per-row rejection
    expect(res.body.created).toEqual([]);
    expect(res.body.errors.length).toBe(1);
    expect(mockUsers.find(u => u.email === 'bad@demo.school')).toBeUndefined();
  });

  test('a plain admin cannot self-grant admin via bulk-invite (previously only blocked literal "superadmin", never "admin")', async () => {
    mockRolePerms = [{ schoolId: SCHOOL_ID, roleKey: 'admin', permissions: { settings: ['read', 'create', 'update', 'delete', 'users'] } }];
    const res = await supertest(buildApp())
      .post('/api/users/bulk-invite')
      .set('Cookie', cookieFor('admin'))
      .send([{ name: 'Sneaky', email: 'sneaky@demo.school', role: 'admin' }]);

    expect(res.body.created).toEqual([]);
    expect(mockUsers.find(u => u.email === 'sneaky@demo.school')).toBeUndefined();
  });
});
