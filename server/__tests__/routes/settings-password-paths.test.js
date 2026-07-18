/* ============================================================
   Integration tests — PUT /api/settings (password branch),
   POST /api/settings/users/:id/reset-password
   (ADR-0003 Phase 1, C8/MR-001 — dual-write + two-tier revocation)

   Zero prior coverage existed for either route before this file.
   Same verification shape as auth-password-paths.test.js: dual-write
   only fires when identityId is set (identical hash, never re-hashed),
   revokeUserTokens always fires, revokeIdentityTokens fires
   additionally when identityId is set — and for the admin reset route
   specifically, revocation targets the RESET TARGET, not the admin
   performing the reset.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const bcrypt = require('bcryptjs');

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
}));

jest.mock('../../utils/email', () => ({
  sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined),
}));

let mockUserDocs = {}; // keyed by id
const mockUsersUpdateOne = jest.fn((filter, update) => {
  const doc = mockUserDocs[filter.id];
  if (doc) _applyUpdate(doc, update);
  return Promise.resolve({});
});
let mockIdentityDocs = {}; // keyed by id
const mockIdentitiesUpdateOne = jest.fn((filter, update) => {
  const doc = mockIdentityDocs[filter.id];
  if (doc) _applyUpdate(doc, update);
  return Promise.resolve({});
});

function _applyUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        findOne: jest.fn((filter) => ({
          lean: jest.fn().mockImplementation(() => {
            const doc = mockUserDocs[filter.id] || Object.values(mockUserDocs).find(d => d.id === filter.id || d._id === filter._id);
            return Promise.resolve(doc ? { ...doc } : null); // snapshot copy, not a live reference
          }),
        })),
        updateOne: mockUsersUpdateOne,
      };
    }
    if (collection === 'identities') {
      return {
        findOne: jest.fn((filter) => ({
          lean: jest.fn().mockImplementation(() => Promise.resolve(mockIdentityDocs[filter.id] ? { ...mockIdentityDocs[filter.id] } : null)),
        })),
        updateOne: mockIdentitiesUpdateOne,
      };
    }
    if (collection === 'schools') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ id: 'sch_demo_001', name: 'Demo School' }) }) };
    }
    return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const { sign } = require('../../utils/jwt');

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}

let HASHED_PASSWORD;
beforeAll(async () => {
  HASHED_PASSWORD = await bcrypt.hash('OldPassword123!', 10);
});

function makeUser(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    id: 'usr_demo_001',
    email: 'admin@demo.school',
    password: HASHED_PASSWORD,
    role: 'admin', primaryRole: 'admin', roles: ['admin'],
    isActive: true, schoolId: 'sch_demo_001',
    tokenVersion: 0,
    name: 'Demo Admin',
    ...overrides,
  };
}

function authCookie(payload) {
  return `token=${sign(payload)}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserDocs = { usr_demo_001: makeUser() };
  mockIdentityDocs = {};
  // C8/MR-001 Phase 3 — guarantee a deterministic "cutover disabled"
  // baseline regardless of any other test file's env state (defense
  // against cross-file process.env leakage within a shared jest worker).
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

describe('PUT /api/settings — self-service password change', () => {
  test('a user with no identityId: single-write only, still revokes users.tokenVersion', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(200);
    expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled();
    expect(mockUsersUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);
  });

  test('a user WITH an identityId: dual-writes the identical hash and revokes both tiers', async () => {
    mockUserDocs.usr_demo_001 = makeUser({ identityId: 'idt_demo_001' });
    mockIdentityDocs.idt_demo_001 = { id: 'idt_demo_001', tokenVersion: 0 };

    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(200);

    const usersHashWrite = mockUsersUpdateOne.mock.calls.find(([, u]) => u.$set?.password)?.[1].$set.password;
    const identityHashWrite = mockIdentitiesUpdateOne.mock.calls.find(([f]) => f.id === 'idt_demo_001')?.[1].$set.passwordHash;
    expect(identityHashWrite).toBeDefined();
    expect(identityHashWrite).toBe(usersHashWrite);

    expect(mockUsersUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);
    expect(mockIdentitiesUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);
  });

  test('wrong current password: no writes at all', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'WrongOne!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(400);
    expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/settings/users/:id/reset-password — admin reset', () => {
  test('revokes the TARGET user, not the admin performing the reset', async () => {
    mockUserDocs = {
      usr_admin_001: makeUser({ id: 'usr_admin_001', role: 'superadmin', primaryRole: 'superadmin' }),
      usr_target_001: makeUser({ id: 'usr_target_001', role: 'teacher', primaryRole: 'teacher', identityId: 'idt_target_001', tokenVersion: 4 }),
    };
    mockIdentityDocs.idt_target_001 = { id: 'idt_target_001', tokenVersion: 1 };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/usr_target_001/reset-password')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: 'sch_demo_001', tv: 0, role: 'superadmin' }))
      .send({});

    expect(res.status).toBe(200);

    // The TARGET's tokenVersion was bumped, not the admin's.
    const targetRevoke = mockUsersUpdateOne.mock.calls.find(([f, u]) => f.id === 'usr_target_001' && u.$inc?.tokenVersion === 1);
    expect(targetRevoke).toBeDefined();
    const adminRevoke = mockUsersUpdateOne.mock.calls.find(([f, u]) => f.id === 'usr_admin_001' && u.$inc?.tokenVersion === 1);
    expect(adminRevoke).toBeUndefined();

    // Dual-write hash equality on the TARGET's identity.
    const usersHashWrite = mockUsersUpdateOne.mock.calls.find(([f, u]) => f.id === 'usr_target_001' && u.$set?.password)?.[1].$set.password;
    const identityHashWrite = mockIdentitiesUpdateOne.mock.calls.find(([f]) => f.id === 'idt_target_001')?.[1].$set.passwordHash;
    expect(identityHashWrite).toBeDefined();
    expect(identityHashWrite).toBe(usersHashWrite);
  });

  test('a target with no identityId: no identities writes, target still revoked', async () => {
    mockUserDocs = {
      usr_admin_001: makeUser({ id: 'usr_admin_001', role: 'superadmin', primaryRole: 'superadmin' }),
      usr_target_001: makeUser({ id: 'usr_target_001', role: 'teacher', primaryRole: 'teacher' }),
    };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/settings/users/usr_target_001/reset-password')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: 'sch_demo_001', tv: 0, role: 'superadmin' }))
      .send({});

    expect(res.status).toBe(200);
    expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled();
    expect(mockUsersUpdateOne.mock.calls.some(([f, u]) => f.id === 'usr_target_001' && u.$inc?.tokenVersion === 1)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════
   PUT /api/settings — C8/MR-001 Phase 3 (Cutover)
   Same identityLookupAttempted/fail-closed pattern as auth.js's
   /login and /change-password, applied to this currentPassword check.
══════════════════════════════════════════════════════════════ */
describe('PUT /api/settings — C8/MR-001 Phase 3 cutover', () => {
  let IDENTITY_HASHED_PASSWORD;
  beforeAll(async () => {
    IDENTITY_HASHED_PASSWORD = await bcrypt.hash('IdentityCurrentPassword!', 10);
  });

  test('cutover disabled (default): users.password is authoritative even with a diverging identity', async () => {
    mockUserDocs.usr_demo_001 = makeUser({ identityId: 'idt_demo_001' }); // password: 'OldPassword123!'
    mockIdentityDocs.idt_demo_001 = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD };

    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(200);
  });

  test('cutover enabled, identity hash does NOT match — 400 even though users.password would have', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDocs.usr_demo_001 = makeUser({ identityId: 'idt_demo_001' }); // password: 'OldPassword123!'
    mockIdentityDocs.idt_demo_001 = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD };

    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(400);
    expect(mockUsersUpdateOne).not.toHaveBeenCalled();
  });

  test('cutover enabled, dangling identityId: 400, not a silent fallback', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDocs.usr_demo_001 = makeUser({ identityId: 'idt_missing' }); // password: 'OldPassword123!' — would match

    const app = buildApp();
    const res = await supertest(app)
      .put('/api/settings')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(400);
  });
});
