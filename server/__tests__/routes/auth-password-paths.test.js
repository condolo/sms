/* ============================================================
   Integration tests — POST /api/auth/change-password, /force-change
   (ADR-0003 Phase 1, C8/MR-001 — dual-write + two-tier revocation)

   Zero prior coverage existed for either route before this file.
   Verifies: dual-write only fires when the user has an identityId
   (writes the IDENTICAL hash — never re-hashed — to
   identities.passwordHash), revokeUserTokens always fires (closes a
   pre-existing gap where password change revoked nothing), and
   revokeIdentityTokens fires additionally when identityId is set.
   /force-change also verifies the freshly-issued token's own `tv`
   reflects the post-revocation version (the staleness bug this phase
   had to design around — see the inline comment in auth.js).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const bcrypt = require('bcryptjs');

const MOCK_SCHOOL = { id: 'sch_demo_001', slug: 'demo', name: 'Demo School', systemEmail: 'demo@demo.school', isActive: true };

jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => { req.school = MOCK_SCHOOL; next(); },
  _mapSchoolDoc: jest.fn(),
  CURRENCY_SYMBOLS: {},
}));

jest.mock('../../utils/email', () => ({
  sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: 'sess_test_001',
    absoluteExpiry: new Date(Date.now() + 86_400_000).toISOString(),
  }),
}));

jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail: jest.fn().mockResolvedValue(undefined),
  clearFail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

let mockUserDoc = null;
let mockIdentityDoc = null;

// Mutate the underlying mock doc on $set/$inc, matching real Mongo update
// semantics — a bare jest.fn().mockResolvedValue({}) would silently no-op,
// which would make a subsequent getTokenVersion()/getIdentityTokenVersion()
// read stale data and mask real staleness bugs (this happened once while
// writing this file — the itv assertion failed until this mock was fixed).
function _applyUpdate(doc, update) {
  if (!doc) return;
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
}
const mockUsersUpdateOne = jest.fn((filter, update) => {
  _applyUpdate(mockUserDoc, update);
  return Promise.resolve({});
});
const mockIdentitiesUpdateOne = jest.fn((filter, update) => {
  if (mockIdentityDoc && mockIdentityDoc.id === filter.id) _applyUpdate(mockIdentityDoc, update);
  return Promise.resolve({});
});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        // .lean() must return a fresh snapshot copy, matching real Mongoose
        // semantics — NOT the live mockUserDoc reference. Returning the
        // same object let a later `updateOne({$inc})` mutation silently
        // also mutate the `user` variable the route already fetched,
        // double-counting on top of the route's own post-revocation
        // tokenVersion patch (caught by a real test failure while writing
        // this file — see the /force-change staleness-fix test below).
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockImplementation(() => Promise.resolve(mockUserDoc ? { ...mockUserDoc } : null)) }),
        updateOne: mockUsersUpdateOne,
      };
    }
    if (collection === 'identities') {
      return {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockImplementation(() => Promise.resolve(mockIdentityDoc ? { ...mockIdentityDoc } : null)) }),
        updateOne: mockIdentitiesUpdateOne,
      };
    }
    if (collection === 'schools') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(MOCK_SCHOOL) }) };
    }
    return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const { sign, verify } = require('../../utils/jwt');

function buildApp() {
  jest.resetModules();
  const authRouter = require('../../routes/auth');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/auth', authRouter);
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

beforeEach(() => {
  jest.clearAllMocks();
  mockUserDoc = makeUser();
  mockIdentityDoc = null;
  // C8/MR-001 Phase 3 — guarantee a deterministic "cutover disabled"
  // baseline regardless of any other test file's env state (defense
  // against cross-file process.env leakage within a shared jest worker).
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

describe('POST /api/auth/change-password', () => {
  function authCookie(payload) {
    return `token=${sign(payload)}`;
  }

  test('rejects the wrong current password with no writes at all', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/change-password')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'WrongOne!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(401);
    expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled();
  });

  test('a user with no identityId: writes users.password only, still revokes users.tokenVersion (closes the pre-existing gap)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/change-password')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(200);
    expect(mockUsersUpdateOne).toHaveBeenCalledTimes(2); // the password update itself + revokeUserTokens' $inc
    expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled(); // no identityId — nothing to dual-write

    const revokeCall = mockUsersUpdateOne.mock.calls.find(([, update]) => update.$inc);
    expect(revokeCall[1]).toEqual({ $inc: { tokenVersion: 1 } });
  });

  test('a user WITH an identityId: dual-writes the identical hash and revokes both tiers', async () => {
    mockUserDoc = makeUser({ identityId: 'idt_demo_001' });
    mockIdentityDoc = { id: 'idt_demo_001', tokenVersion: 0 };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/change-password')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(200);

    // Dual-write: the identity's passwordHash write must be the SAME hash as the users.password write.
    const usersHashWrite = mockUsersUpdateOne.mock.calls.find(([, u]) => u.password)[1].password;
    const identityHashWrite = mockIdentitiesUpdateOne.mock.calls.find(([f]) => f.id === 'idt_demo_001')[1].$set.passwordHash;
    expect(identityHashWrite).toBe(usersHashWrite);

    // Both revocation tiers fired.
    expect(mockUsersUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);
    const identityRevokeCall = mockIdentitiesUpdateOne.mock.calls.find(([, u]) => u.$inc);
    expect(identityRevokeCall).toBeDefined();
    expect(identityRevokeCall[1]).toEqual({ $inc: { tokenVersion: 1 } });
  });
});

describe('POST /api/auth/force-change', () => {
  test('a user WITH an identityId: dual-writes, revokes both tiers, and the newly-issued token carries the POST-revocation tv (not stale)', async () => {
    mockUserDoc = makeUser({ identityId: 'idt_demo_001', tokenVersion: 7 });
    mockIdentityDoc = { id: 'idt_demo_001', tokenVersion: 2 };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/force-change')
      .send({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', newPassword: 'BrandNewPassword123!' });

    expect(res.status).toBe(200);

    // Dual-write hash equality, same as change-password.
    const usersHashWrite = mockUsersUpdateOne.mock.calls.find(([, u]) => u.password)?.[1].password;
    const identityHashWrite = mockIdentitiesUpdateOne.mock.calls.find(([f]) => f.id === 'idt_demo_001')?.[1].$set.passwordHash;
    expect(identityHashWrite).toBeDefined();
    expect(identityHashWrite).toBe(usersHashWrite);

    // Both revocations fired.
    expect(mockUsersUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);
    expect(mockIdentitiesUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);

    // The staleness-bug fix: the token this same request just issued must
    // carry tv = 8 (7 + 1, the POST-revocation value), not the stale 7 that
    // was on the `user` object before revokeUserTokens() ran. If this ever
    // regresses, the user's own freshly-issued session would immediately
    // reject itself on its very next authenticated request.
    const cookies = [].concat(res.headers['set-cookie'] || []);
    const tokenCookie = cookies.find(c => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
    const token = tokenCookie.split(';')[0].split('=')[1];
    const payload = verify(token);
    expect(payload.tv).toBe(8);
    expect(payload.identityId).toBe('idt_demo_001');
    // itv is resolved via a fresh, cache-invalidated DB read inside
    // _buildTokenPayload — not from the stale `user` object — so it
    // correctly reflects the post-revocation value without needing the
    // same manual patch tv required.
    expect(payload.itv).toBe(3);
  });

  test('a user with no identityId: no identities writes, but users.tokenVersion is still revoked', async () => {
    mockUserDoc = makeUser({ tokenVersion: 0 });

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/force-change')
      .send({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', newPassword: 'BrandNewPassword123!' });

    expect(res.status).toBe(200);
    expect(mockIdentitiesUpdateOne).not.toHaveBeenCalled();
    expect(mockUsersUpdateOne.mock.calls.some(([, u]) => u.$inc?.tokenVersion === 1)).toBe(true);

    const cookies = [].concat(res.headers['set-cookie'] || []);
    const token = cookies.find(c => c.startsWith('token=')).split(';')[0].split('=')[1];
    const payload = verify(token);
    expect(payload.tv).toBe(1);
    expect(payload.identityId).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/change-password — C8/MR-001 Phase 3 (Cutover)
   Same identityLookupAttempted/fail-closed pattern as /login
   (auth-session.test.js), applied to the currentPassword check here.
══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/change-password — C8/MR-001 Phase 3 cutover', () => {
  function authCookie(payload) {
    return `token=${sign(payload)}`;
  }
  let IDENTITY_HASHED_PASSWORD;
  beforeAll(async () => {
    IDENTITY_HASHED_PASSWORD = await bcrypt.hash('IdentityCurrentPassword!', 10);
  });

  test('cutover disabled (default): the users.password hash is authoritative even with a diverging identity', async () => {
    mockUserDoc = makeUser({ identityId: 'idt_demo_001' }); // password: 'OldPassword123!'
    mockIdentityDoc = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/change-password')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' }); // the USERS password

    expect(res.status).toBe(200);
  });

  test('cutover enabled, identity hash does NOT match — 401 even though users.password would have', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDoc = makeUser({ identityId: 'idt_demo_001' }); // password: 'OldPassword123!'
    mockIdentityDoc = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD }; // different password

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/change-password')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' }); // matches users.password only

    expect(res.status).toBe(401);
    expect(mockUsersUpdateOne).not.toHaveBeenCalled();
  });

  test('cutover enabled, dangling identityId (no matching identity doc): 401, not a silent fallback', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDoc = makeUser({ identityId: 'idt_missing' }); // password: 'OldPassword123!' — would match
    mockIdentityDoc = null;

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/change-password')
      .set('Cookie', authCookie({ userId: 'usr_demo_001', schoolId: 'sch_demo_001', tv: 0 }))
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(401);
  });
});
