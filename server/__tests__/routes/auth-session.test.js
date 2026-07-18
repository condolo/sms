/* ============================================================
   Integration tests — server/routes/auth.js  (login session shape)

   Verifies that the POST /api/auth/login response includes the
   full school object as produced by _mapSchoolDoc — not a subset.

   Key regression this guards against: if someone adds a school
   field but forgets to add it to _mapSchoolDoc, the login
   response (and therefore every frontend session) will silently
   omit it, causing module-specific fallback bugs.

   Run: npm test
   ============================================================ */

const bcrypt = require('bcryptjs');

/* ── The school shape the tenant middleware would inject ────── */
// Build a full _mapSchoolDoc-shaped object to inject as req.school.
// This matches exactly what _findSchool returns after our refactor.
const MOCK_SCHOOL = {
  id:             'sch_demo_001',
  slug:           'demo',
  name:           'Demo School',
  shortName:      'Demo',
  logoUrl:        null,
  systemEmail:    'demo@demo.school',
  adminEmail:     null,
  plan:           'standard',
  addOns:         [],
  isActive:       true,
  planExpiresAt:  null,
  primaryColor:   '#4f46e5',
  accentColor:    '#7c3aed',
  themePreset:    null,
  currency:       'KES',
  currencySymbol: 'KSh',
  timezone:       'Africa/Nairobi',
  country:        'KE',
  academicYear:   '2025/2026',
  termsPerYear:   3,
};

/* ── Mock tenant middleware — inject the full school shape ──── */
jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => {
    req.school = require('./../routes/auth-session.test.js').__MOCK_SCHOOL__ || MOCK_SCHOOL;
    next();
  },
  _mapSchoolDoc:    jest.fn(),
  CURRENCY_SYMBOLS: {},
}));

// Expose MOCK_SCHOOL for the jest.mock factory above
// (jest.mock is hoisted above require, so we export it separately)
// This pattern works because the mock factory re-evaluates MOCK_SCHOOL at call time.

/* ── Re-declare mock school so middleware closure captures it ── */
// (Node module cache means the mock factory captures the real MOCK_SCHOOL defined above)

/* ── Mock email utility — prevents real SMTP calls ─────────── */
jest.mock('../../utils/email', () => ({
  sendLoginOTP:           jest.fn().mockResolvedValue(undefined),
  sendPasswordExpirySoon: jest.fn().mockResolvedValue(undefined),
  sendTrialExpirySoon:    jest.fn().mockResolvedValue(undefined),
}));

/* ── Mock SessionService — prevents real DB session writes ──── */
jest.mock('../../services/sessionService', () => ({
  createSession:    jest.fn().mockResolvedValue({
    sessionId:       'sess_test_001',
    absoluteExpiry:  new Date(Date.now() + 86_400_000).toISOString(),
  }),
  terminateSession: jest.fn().mockResolvedValue(true),
}));

/* ── Mock SecurityService — prevents real rate-limit DB calls ─ */
jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),   // null = not locked
  recordFail:       jest.fn().mockResolvedValue(undefined),
  clearFail:        jest.fn().mockResolvedValue(undefined),
}));

/* ── Mock AuditService — prevents noise from non-fatal logging ─ */
jest.mock('../../services/audit', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

/* ── Mock _model — returns test doubles for users + schools ─── */
let mockUserDoc = null;         // set per test
let mockIdentityDoc = null;     // C8/MR-001 Phase 3 — set per cutover test, null otherwise
let mockSchoolDoc = { isActive: true }; // C9 — override organizationId per test, null otherwise
let mockOrgDoc = null;          // C9 — set per multi-school test, null otherwise
let mockMembershipDoc = null;   // C9 — set per multi-school test, null otherwise
let mockMembershipDocs = [];    // C9 — .find() results for _availableSchools, [] otherwise
let mockOtherSchoolDocs = [];   // C9 — .find() results for _availableSchools' school lookup, [] otherwise

// Supports both .lean() directly and .select(...).lean() — the two chain
// shapes real Mongoose query builders (and this codebase's call sites)
// actually use.
function mockChain(resolveFn) {
  const lean = jest.fn().mockImplementation(() => Promise.resolve(resolveFn()));
  return { lean, select: jest.fn().mockReturnValue({ lean }) };
}

jest.mock('../../utils/model', () => {
  const mockUpdateOne = jest.fn().mockResolvedValue({});
  return {
    _model: jest.fn((collection) => {
      if (collection === 'users') {
        return {
          findOne:  jest.fn().mockReturnValue({
            lean: jest.fn().mockImplementation(() => Promise.resolve(mockUserDoc)),
          }),
          updateOne: mockUpdateOne,
        };
      }
      if (collection === 'schools') {
        return {
          findOne:  jest.fn(() => mockChain(() => mockSchoolDoc)),
          find:     jest.fn(() => mockChain(() => mockOtherSchoolDocs)),
          updateOne: mockUpdateOne,
        };
      }
      if (collection === 'identities') {
        return {
          findOne: jest.fn().mockReturnValue({
            lean: jest.fn().mockImplementation(() => Promise.resolve(mockIdentityDoc)),
          }),
          updateOne: mockUpdateOne,
        };
      }
      if (collection === 'organizations') {
        return { findOne: jest.fn(() => mockChain(() => mockOrgDoc)) };
      }
      if (collection === 'memberships') {
        return {
          findOne: jest.fn(() => mockChain(() => mockMembershipDoc)),
          find:    jest.fn(() => mockChain(() => mockMembershipDocs)),
        };
      }
      return {
        findOne:   jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        find:      jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        create:    jest.fn().mockResolvedValue({ _id: 'mock_id' }),
        updateOne: mockUpdateOne,
      };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');
const authRouter = require('../../routes/auth');

/* ── Minimal Express app ────────────────────────────────────── */
function buildApp() {
  const app = express();
  app.use(express.json());
  // Disable express-rate-limit in tests by not mounting it at root level;
  // the router mounts it internally, but with max: 20 it won't trigger in unit tests.
  app.use('/api/auth', authRouter);
  return app;
}

/* ── Helper: create a bcrypt hash synchronously for test users ─ */
let HASHED_PASSWORD;
beforeAll(async () => {
  HASHED_PASSWORD = await bcrypt.hash('Password123!', 10);
});

/* ── Factory: valid active user doc ─────────────────────────── */
function makeUser(overrides = {}) {
  return {
    _id:             '507f1f77bcf86cd799439011',
    id:              'usr_demo_001',
    email:           'admin@demo.school',
    password:        HASHED_PASSWORD,
    role:            'admin',
    primaryRole:     'admin',
    roles:           ['admin'],
    isActive:        true,
    schoolId:        'sch_demo_001',
    mustChangePassword: false,
    mfaEnabled:      false,
    passwordChangedAt: new Date().toISOString(), // fresh password (not expired)
    ...overrides,
  };
}

beforeEach(() => {
  mockUserDoc = makeUser();
  mockIdentityDoc = null;
  mockSchoolDoc = { isActive: true }; // C9 — no organizationId by default
  mockOrgDoc = null;
  mockMembershipDoc = null;
  mockMembershipDocs = [];
  mockOtherSchoolDocs = [];
  jest.clearAllMocks();
  // C8/MR-001 Phase 3 — guarantee a deterministic "cutover disabled"
  // baseline regardless of any other test file's env state (defense
  // against cross-file process.env leakage within a shared jest worker).
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/login — school shape in response
══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/login — school shape', () => {
  test('returns 200 on valid credentials', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
  });

  test('response includes school object', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.body).toHaveProperty('school');
    expect(typeof res.body.school).toBe('object');
  });

  test('school.currency is KES — not silently stripped to USD default', async () => {
    // This is the exact regression that was reported: currency showing USD
    // when the school is configured for KES. The root cause was that
    // _findSchool only returned 10 hardcoded fields and stripped currency.
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.body.school.currency).toBe('KES');
    expect(res.body.school.currency).not.toBe('USD');
  });

  test('school.currencySymbol is KSh for a KES school', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.body.school.currencySymbol).toBe('KSh');
  });

  test('school object contains all required client session fields', async () => {
    const REQUIRED = [
      'id', 'slug', 'name', 'shortName',
      'plan', 'addOns', 'isActive',
      'primaryColor', 'accentColor',
      'currency', 'currencySymbol', 'timezone',
      'academicYear',
    ];

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    for (const field of REQUIRED) {
      expect(res.body.school).toHaveProperty(field);
      expect(res.body.school[field]).not.toBeUndefined();
    }
  });

  test('issues the session token as an HttpOnly cookie (not in the JSON body) and includes user', async () => {
    // The JWT is deliberately never returned in the response body — only as
    // an HttpOnly, SameSite=Strict cookie (_setAuthCookie in auth.js), so
    // client-side JS (and therefore XSS) can never read it. The frontend
    // (client/src/pages/Login.jsx) already only reads res.user/res.school —
    // it never reads res.token.
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.body).not.toHaveProperty('token');

    const cookies = [].concat(res.headers['set-cookie'] || []);
    const tokenCookie = cookies.find(c => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/HttpOnly/i);
    expect(tokenCookie).toMatch(/^token=[^;]+/); // non-empty value

    expect(res.body).toHaveProperty('user');
  });

  test('user.password is not present in response (stripped)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    // Critical security: password hash must never be returned
    expect(res.body.user?.password).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/login — error paths
══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/login — error paths', () => {
  test('returns 401 on wrong password', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
  });

  test('returns 401 when user not found', async () => {
    mockUserDoc = null;   // simulate missing user

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'nobody@demo.school', password: 'Password123!' });

    expect(res.status).toBe(401);
  });

  test('returns 400 when email is missing', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ password: 'Password123!' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when password is missing', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school' });

    expect(res.status).toBe(400);
  });

  test('returns 403 for inactive user (not pending school)', async () => {
    // Inactive user at an active school → 403 (not 401 — distinct error)
    mockUserDoc = makeUser({ isActive: false });

    // Override just the next two _model() calls (users, then schools — the
    // exact order /login makes them in) so this test's `status: 'active'`
    // schools shape doesn't leak into later tests. `.mockImplementation()`
    // (no "Once") would persist for the rest of the file, since
    // jest.clearAllMocks() in beforeEach clears call history but does NOT
    // reset a custom implementation back to the base factory — a real bug
    // this exact test caused, caught while adding the C8/MR-001 Phase 3
    // cutover tests below, which need the original `identities`-aware mock.
    const { _model } = require('../../utils/model');
    _model.mockImplementationOnce((collection) => ({
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockUserDoc) }),
      updateOne: jest.fn().mockResolvedValue({}),
    })).mockImplementationOnce((collection) => ({
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ isActive: true, status: 'active' }) }),
      updateOne: jest.fn().mockResolvedValue({}),
    }));

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(403);
  });

  test('mustChangePassword triggers passwordExpired flow (not a token)', async () => {
    mockUserDoc = makeUser({ mustChangePassword: true });

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.passwordExpired).toBe(true);
    expect(res.body.reason).toBe('first_login');
    // No token should be issued — user must change password first
    expect(res.body.token).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/login — C8/MR-001 Phase 3 (ADR-0003, Cutover)
   The credential check switches source of truth from users.password
   to identities.passwordHash when isIdentityCutoverEnabled() and
   user.identityId are both set. Disabled by default — the FIRST test
   below is the specific regression this phase must never break: with
   the flag unset (every real deployment today), behavior must stay
   byte-for-byte identical to before this phase, even for a user whose
   identityId is set and whose linked identity has a totally different
   password.
══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/login — C8/MR-001 Phase 3 cutover', () => {
  let IDENTITY_HASHED_PASSWORD;
  beforeAll(async () => {
    IDENTITY_HASHED_PASSWORD = await bcrypt.hash('IdentityPassword456!', 10);
  });

  test('cutover disabled (default): users.password is authoritative even when identityId is set and the identity has a DIFFERENT password', async () => {
    mockUserDoc = makeUser({ identityId: 'idt_demo_001' }); // password: 'Password123!'
    mockIdentityDoc = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD, mfaEnabled: false }; // different password

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' }); // the USERS password

    expect(res.status).toBe(200); // succeeds — identity is never consulted while disabled
  });

  test('cutover enabled, no identityId: unchanged fallback to users.password', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDoc = makeUser(); // no identityId

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
  });

  test('cutover enabled, identityId set, identity hash MATCHES the candidate: succeeds via identities.passwordHash', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDoc = makeUser({ identityId: 'idt_demo_001', password: 'not-even-a-valid-bcrypt-hash' }); // users.password deliberately broken
    mockIdentityDoc = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD, mfaEnabled: false };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'IdentityPassword456!' }); // the IDENTITY's password

    expect(res.status).toBe(200); // proves identities.passwordHash is what was actually checked
  });

  test('cutover enabled, identityId set, identity hash does NOT match — 401 even though users.password WOULD have matched', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDoc = makeUser({ identityId: 'idt_demo_001' }); // password: 'Password123!' — would succeed under the old check
    mockIdentityDoc = { id: 'idt_demo_001', passwordHash: IDENTITY_HASHED_PASSWORD, mfaEnabled: false }; // a different password

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' }); // matches users.password, NOT identities.passwordHash

    expect(res.status).toBe(401); // identities.passwordHash is now authoritative once cutover is live
  });

  test('cutover enabled, identityId set, no matching identity doc (dangling FK): treated as a mismatch, not a silent fallback', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    mockUserDoc = makeUser({ identityId: 'idt_missing' });
    mockIdentityDoc = null; // dangling FK — findOne resolves null

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' }); // would have matched users.password

    expect(res.status).toBe(401); // fails closed rather than silently falling back
  });

  test('mfaEnabled is read from the identity, not the user, once cutover is live for a linked account', async () => {
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    // Non-demo school so the MFA gate's isDemo skip doesn't mask this test.
    module.exports.__MOCK_SCHOOL__ = { ...MOCK_SCHOOL, slug: 'not-demo' };
    try {
      mockUserDoc = makeUser({ identityId: 'idt_demo_001', mfaEnabled: false, role: 'admin' }); // user says MFA off
      mockIdentityDoc = { id: 'idt_demo_001', passwordHash: HASHED_PASSWORD, mfaEnabled: true }; // identity says MFA on

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/auth/login')
        .set('X-School-Slug', 'not-demo')
        .send({ email: 'admin@demo.school', password: 'Password123!' });

      // If mfaEnabled were still read from the user (false), login would
      // succeed directly with a token. Reading it from the identity (true)
      // means MFA triggers instead — proving the source actually switched.
      expect(res.status).toBe(200);
      expect(res.body.mfaRequired).toBe(true);
    } finally {
      delete module.exports.__MOCK_SCHOOL__;
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/login — C9 (D-004, Constitution §10 Stage 4)
   _buildTokenPayload gains orgId/membershipId, but ONLY when the
   school's organization has multiSchoolEnabled: true. Every
   organization is multiSchoolEnabled:false today (confirmed —
   provision-organizations.js always sets it false; no admin route
   accepts it as input), so the FIRST test below is the specific
   regression this addition must never break: with no organizationId
   on the school (the common case) or multiSchoolEnabled false (every
   real org today), the JWT must be byte-for-byte unaffected — decoded
   here via the real verify(), not inferred from a 200 status alone.
══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/login — C9 multi-school JWT fields', () => {
  const { verify } = require('../../utils/jwt');

  function tokenFromResponse(res) {
    const cookies = [].concat(res.headers['set-cookie'] || []);
    const tokenCookie = cookies.find(c => c.startsWith('token='));
    return verify(tokenCookie.split(';')[0].split('=')[1]);
  }

  test('no organizationId on the school: orgId/membershipId absent, rest of payload unaffected', async () => {
    mockSchoolDoc = { isActive: true }; // no organizationId — the common case today

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    const payload = tokenFromResponse(res);
    expect(payload.orgId).toBeUndefined();
    expect(payload.membershipId).toBeUndefined();
    expect(payload.schoolId).toBe('sch_demo_001');
    expect(payload.userId).toBe('usr_demo_001');
  });

  test('organization exists but multiSchoolEnabled is false (every real org today): orgId/membershipId still absent', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: false };
    mockMembershipDoc = { id: 'mem_demo_001', orgId: 'org_demo' }; // exists, but must not be consulted

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    const payload = tokenFromResponse(res);
    expect(payload.orgId).toBeUndefined();
    expect(payload.membershipId).toBeUndefined();
  });

  test('multiSchoolEnabled true AND an active membership exists: orgId/membershipId are added', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: true };
    mockMembershipDoc = { id: 'mem_demo_001', orgId: 'org_demo' };

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    const payload = tokenFromResponse(res);
    expect(payload.orgId).toBe('org_demo');
    expect(payload.membershipId).toBe('mem_demo_001');
    // Untouched fields stay exactly as before.
    expect(payload.schoolId).toBe('sch_demo_001');
    expect(payload.role).toBe('admin');
  });

  test('multiSchoolEnabled true but NO membership doc for this user/school: orgId/membershipId stay absent, login still succeeds', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: true };
    mockMembershipDoc = null; // no membership record

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200); // never blocks login — additive only
    const payload = tokenFromResponse(res);
    expect(payload.orgId).toBeUndefined();
    expect(payload.membershipId).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/login — C9 availableSchools (School Switcher UI)
══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/login — C9 availableSchools', () => {
  test('multiSchoolEnabled false (every real org today): availableSchools absent from the response', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: false };
    mockMembershipDoc = { id: 'mem_demo_001', orgId: 'org_demo' };
    mockMembershipDocs = [
      { id: 'mem_demo_001', schoolId: 'sch_demo_001', orgId: 'org_demo', isActive: true },
      { id: 'mem_other_001', schoolId: 'sch_other_001', orgId: 'org_demo', isActive: true },
    ];
    mockOtherSchoolDocs = [{ id: 'sch_other_001', name: 'Other Campus' }];

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toBeUndefined();
  });

  test('multiSchoolEnabled true but only one active membership (this school): availableSchools absent', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: true };
    mockMembershipDoc = { id: 'mem_demo_001', orgId: 'org_demo' };
    mockMembershipDocs = [
      { id: 'mem_demo_001', schoolId: 'sch_demo_001', orgId: 'org_demo', isActive: true },
    ];

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toBeUndefined();
  });

  test('multiSchoolEnabled true AND a second active membership exists: availableSchools lists the other school, excluding the current one', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: true };
    mockMembershipDoc = { id: 'mem_demo_001', orgId: 'org_demo' };
    mockMembershipDocs = [
      { id: 'mem_demo_001', schoolId: 'sch_demo_001', orgId: 'org_demo', isActive: true },
      { id: 'mem_other_001', schoolId: 'sch_other_001', orgId: 'org_demo', isActive: true },
    ];
    mockOtherSchoolDocs = [{ id: 'sch_other_001', name: 'Other Campus' }];

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toEqual([{ id: 'sch_other_001', name: 'Other Campus' }]);
  });

  test('a membership doc for the current school only (as an active-filtered query would return) yields no switcher entries', async () => {
    mockSchoolDoc = { isActive: true, organizationId: 'org_demo' };
    mockOrgDoc = { multiSchoolEnabled: true };
    mockMembershipDoc = { id: 'mem_demo_001', orgId: 'org_demo' };
    // Simulates the result of the real query's isActive:{$ne:false} filter
    // already having excluded a revoked membership at the DB layer —
    // _availableSchools then has nothing but the current school to work
    // with, so it must still resolve to no switcher entries.
    mockMembershipDocs = [
      { id: 'mem_demo_001', schoolId: 'sch_demo_001', orgId: 'org_demo', isActive: true },
    ];

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toBeUndefined();
  });
});
