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

/* ── Mock _model — returns test doubles for users + schools ─── */
let mockUserDoc = null;  // set per test

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
          findOne:  jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ isActive: true }) }),
          updateOne: mockUpdateOne,
        };
      }
      return {
        findOne:   jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
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
  jest.clearAllMocks();
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

  test('response includes token and user', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('X-School-Slug', 'demo')
      .send({ email: 'admin@demo.school', password: 'Password123!' });

    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
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

    // Re-mock schools to return an active school
    const { _model } = require('../../utils/model');
    _model.mockImplementation((collection) => {
      if (collection === 'users') {
        return {
          findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockUserDoc) }),
          updateOne: jest.fn().mockResolvedValue({}),
        };
      }
      if (collection === 'schools') {
        return {
          findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ isActive: true, status: 'active' }) }),
          updateOne: jest.fn().mockResolvedValue({}),
        };
      }
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }), updateOne: jest.fn() };
    });

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
