/* ============================================================
   Integration tests — mobile sign-in (PLAN.md §3)

     POST /api/auth/otp/request   email a 6-digit code
     POST /api/auth/otp/verify    code → session (Bearer, no cookies)
     POST /api/auth/mobile/google Firebase ID token → session
     POST /api/auth/verify-otp    existing 2FA step, mobile branch

   What these pin, because each one is a decision that is easy to
   regress silently:

   - NO ACCOUNT ENUMERATION. Requesting a code answers identically for a
     known, unknown or inactive email; a wrong code fails exactly like an
     unknown address. A school's parent list is not probeable.
   - APP SESSIONS CARRY NO COOKIES. The token is in the body (the app keeps
     it in the device keystore) and no Set-Cookie is emitted — which is also
     why the app never trips the CSRF double-submit check.
   - THE CODE IS CONSUMED BEFORE ANYTHING ELSE CAN FAIL, so it can never be
     replayed.
   - PRIVILEGED ROLES STILL GET THEIR STEP-UP (admin/deputy/principal/
     finance), through the same mfaOtp fields and /verify-otp endpoint the
     password flow uses. Demo tenants are exempt, as on web.
   - UNKNOWN GOOGLE EMAILS ARE REFUSED, never auto-provisioned.
   - WEB BEHAVIOUR IS UNTOUCHED: the same endpoint without the mobile flag
     still sets the HttpOnly cookie and still omits the token.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const crypto = require('crypto');

const mockSchool = {
  id: 'sch_demo_001', slug: 'riverside', name: 'Riverside Academy',
  systemEmail: 'office@riverside.school', isActive: true,
};

jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => { req.school = mockSchool; next(); },
  _mapSchoolDoc: jest.fn(),
  CURRENCY_SYMBOLS: {},
}));

jest.mock('../../utils/email', () => ({
  sendLoginOTP: jest.fn().mockResolvedValue(true),
  sendTrialReminder: jest.fn().mockResolvedValue(true),
  sendPasswordExpiry: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: 'sess_mobile_001',
    absoluteExpiry: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  }),
}));

jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail: jest.fn().mockResolvedValue(undefined),
  clearFail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

/** Firebase is stubbed — these tests must never need a real service account. */
jest.mock('../../utils/firebase', () => ({
  getFirebaseAdmin: jest.fn(() => null),
  isFirebaseConfigured: jest.fn(() => false),
  verifyIdToken: jest.fn(),
}));

const firebase = require('../../utils/firebase');
const email    = require('../../utils/email');

let mockUserDoc = null;

/** Real Mongo update semantics, applied to the one mock document. */
function _applyUpdate(doc, update) {
  if (!doc) return;
  if (update.$set) for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
}

/** Mongoose documents (no .lean()) have toObject(); lean ones are plain. */
function mockAsDoc(doc) {
  return doc ? { ...doc, toObject: () => ({ ...doc }) } : null;
}

const mockUsersUpdateOne = jest.fn((filter, update) => {
  _applyUpdate(mockUserDoc, update);
  return Promise.resolve({ modifiedCount: 1 });
});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        findOne: jest.fn((filter, projection) => {
          if (projection) return { lean: () => Promise.resolve(mockUserDoc ? { ...mockUserDoc } : null) };
          const result = mockAsDoc(mockUserDoc);
          return Object.assign(Promise.resolve(result), { lean: () => Promise.resolve(mockUserDoc ? { ...mockUserDoc } : null) });
        }),
        updateOne: mockUsersUpdateOne,
      };
    }
    if (collection === 'schools') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockSchool) }) };
    }
    if (collection === 'teachers') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) };
    }
    return {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    };
  }),
}));

const express   = require('express');
const supertest = require('supertest');

function buildApp() {
  const authRouter = require('../../routes/auth');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/auth', authRouter);
  return app;
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function makeUser(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    id: 'usr_parent_001',
    schoolId: mockSchool.id,
    name: 'Mrs. Kamau',
    email: 'kamau@example.com',
    role: 'parent', primaryRole: 'parent', roles: ['parent'],
    isActive: true,
    tokenVersion: 0,
    guardianOf: ['std_1'],
    studentIds: ['std_1'],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserDoc = makeUser();
  firebase.verifyIdToken.mockReset();
});

/* ── Requesting a code ─────────────────────────────────────────── */

describe('POST /api/auth/otp/request', () => {
  test('emails a code to a known active user and never returns the code itself', async () => {
    const res = await supertest(buildApp()).post('/api/auth/otp/request').send({ email: 'kamau@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(JSON.stringify(res.body)).not.toContain('otp');

    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);
    const sent = email.sendLoginOTP.mock.calls[0][0];
    expect(sent.email).toBe('kamau@example.com');
    expect(sent.ttlMinutes).toBe(10);
    expect(sent.otp).toMatch(/^\d{6}$/);

    // stored as a HASH with a 10-minute expiry — never plaintext
    expect(mockUserDoc.loginOtp).toBe(sha256(sent.otp));
    expect(mockUserDoc.loginOtp).not.toBe(sent.otp);
    const ttl = new Date(mockUserDoc.loginOtpExpiry).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  test('an unknown email gets the identical answer and no email', async () => {
    mockUserDoc = null;
    const res = await supertest(buildApp()).post('/api/auth/otp/request').send({ email: 'stranger@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(email.sendLoginOTP).not.toHaveBeenCalled();
  });

  test('an inactive account gets the identical answer and no email', async () => {
    mockUserDoc = makeUser({ isActive: false });
    const res = await supertest(buildApp()).post('/api/auth/otp/request').send({ email: 'kamau@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(email.sendLoginOTP).not.toHaveBeenCalled();
  });

  /* Deliberately the opposite policy to /login's 2FA step (which refuses the
     challenge when the mail fails): this route is unauthenticated and
     passwordless, so "delivered" and "not delivered" must be
     indistinguishable — a difference would say whether the address is
     enrolled. The failure is logged, never answered. */
  test('a delivery failure is still answered with the same generic success', async () => {
    email.sendLoginOTP.mockResolvedValueOnce(false);
    const res = await supertest(buildApp()).post('/api/auth/otp/request').send({ email: 'kamau@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 600 });
  });

  test('a second request inside the resend window answers the same but sends nothing', async () => {
    const app = buildApp();
    await supertest(app).post('/api/auth/otp/request').send({ email: 'kamau@example.com' });
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);

    const res = await supertest(app).post('/api/auth/otp/request').send({ email: 'kamau@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);          // still opaque
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1); // …but silent
  });

  test('the hourly cap stops inbox bombing without telling the caller', async () => {
    const now = Date.now();
    mockUserDoc = makeUser({
      loginOtpSentAt: new Date(now - 5 * 60 * 1000).toISOString(), // past the 60s window
      loginOtpSends: Array.from({ length: 5 }, (_, i) => new Date(now - (i + 1) * 60 * 1000).toISOString()),
    });

    const res = await supertest(buildApp()).post('/api/auth/otp/request').send({ email: 'kamau@example.com' });
    expect(res.status).toBe(200);
    expect(email.sendLoginOTP).not.toHaveBeenCalled();
  });

  test('no email at all is a 400 — that one IS the caller’s own business', async () => {
    const res = await supertest(buildApp()).post('/api/auth/otp/request').send({});
    expect(res.status).toBe(400);
  });
});

/* ── Verifying it ──────────────────────────────────────────────── */

describe('POST /api/auth/otp/verify', () => {
  function seedCode(code = '123456', overrides = {}) {
    mockUserDoc = makeUser({
      loginOtp: sha256(code),
      loginOtpExpiry: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      loginOtpAttempts: 0,
      ...overrides,
    });
  }

  test('a correct code returns a session token in the body and sets no cookies', async () => {
    seedCode('123456');
    const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'kamau@example.com', code: '123456', deviceId: 'dev_abc' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('parent');
    expect(res.body.data.school.id).toBe(mockSchool.id);
    // The app stores the token itself — a cookie here would be a second,
    // unreachable copy (and would re-arm the CSRF check on every POST).
    expect(res.headers['set-cookie']).toBeUndefined();
    // …and the code is consumed, so it can never be replayed.
    expect(mockUserDoc.loginOtp).toBeUndefined();
    expect(mockUserDoc.loginOtpExpiry).toBeUndefined();
  });

  test('a wrong code fails, counts the attempt, and does not consume the code', async () => {
    seedCode('123456');
    const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'kamau@example.com', code: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_OTP');
    expect(mockUserDoc.loginOtpAttempts).toBe(1);
    expect(mockUserDoc.loginOtp).toBe(sha256('123456'));
  });

  test('an unknown email is indistinguishable from a wrong code', async () => {
    mockUserDoc = null;
    const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'stranger@example.com', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  test('an expired code is refused and cleared', async () => {
    seedCode('123456', { loginOtpExpiry: new Date(Date.now() - 1000).toISOString() });
    const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'kamau@example.com', code: '123456' });

    expect(res.status).toBe(401);
    expect(mockUserDoc.loginOtp).toBeUndefined();
  });

  test('attempts are capped so a code cannot be brute-forced', async () => {
    seedCode('123456', { loginOtpAttempts: 5 });
    const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'kamau@example.com', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  test('a privileged role still completes the step-up before any token exists', async () => {
    seedCode('123456', { role: 'finance', primaryRole: 'finance', roles: ['finance'] });
    const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'kamau@example.com', code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.token).toBeUndefined();       // no session yet
    expect(mockUserDoc.mfaOtp).toMatch(/^[0-9a-f]{64}$/); // second code, hashed
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);  // …and actually sent
  });

  test('a demo tenant is exempt from the step-up, exactly like web password login', async () => {
    const demoSlug = mockSchool.slug;
    mockSchool.slug = 'demo';
    try {
      seedCode('123456', { role: 'admin', primaryRole: 'admin', roles: ['admin'] });
      const res = await supertest(buildApp()).post('/api/auth/otp/verify').send({ email: 'kamau@example.com', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeTruthy();
      expect(res.body.data.mfaRequired).toBeUndefined();
    } finally {
      mockSchool.slug = demoSlug;
    }
  });
});

/* ── Google ────────────────────────────────────────────────────── */

describe('POST /api/auth/mobile/google', () => {
  test('without Firebase configured the answer is an honest 503', async () => {
    const err = Object.assign(new Error('nope'), { code: 'GOOGLE_NOT_CONFIGURED' });
    firebase.verifyIdToken.mockRejectedValue(err);

    const res = await supertest(buildApp()).post('/api/auth/mobile/google').send({ idToken: 'token' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });

  test('an unverifiable token is a 401, not a 500', async () => {
    firebase.verifyIdToken.mockRejectedValue(new Error('bad signature'));
    const res = await supertest(buildApp()).post('/api/auth/mobile/google').send({ idToken: 'token' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  test('an unverified Google email is refused', async () => {
    firebase.verifyIdToken.mockResolvedValue({ uid: 'g_1', email: 'kamau@example.com', email_verified: false });
    const res = await supertest(buildApp()).post('/api/auth/mobile/google').send({ idToken: 'token' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });

  test('an email the school never added is refused — never auto-provisioned', async () => {
    firebase.verifyIdToken.mockResolvedValue({ uid: 'g_1', email: 'stranger@example.com', email_verified: true });
    mockUserDoc = null;
    const res = await supertest(buildApp()).post('/api/auth/mobile/google').send({ idToken: 'token' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
    expect(mockUsersUpdateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ role: expect.anything() }) }),
    );
  });

  test('a known, verified user gets a session and the provider link is recorded', async () => {
    firebase.verifyIdToken.mockResolvedValue({ uid: 'g_42', email: 'KAMAU@example.com', email_verified: true });
    mockUserDoc = makeUser({ googleId: undefined });

    const res = await supertest(buildApp()).post('/api/auth/mobile/google').send({ idToken: 'token', deviceId: 'dev_1' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(mockUserDoc.googleId).toBe('g_42');
  });
});

/* ── The web path must not have moved ──────────────────────────── */

describe('POST /api/auth/verify-otp', () => {
  function seedMfa(code = '654321') {
    mockUserDoc = makeUser({
      mfaOtp: sha256(code),
      mfaExpiry: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  }

  test('web keeps the HttpOnly cookie and never exposes the token to JS', async () => {
    seedMfa('654321');
    const res = await supertest(buildApp()).post('/api/auth/verify-otp').send({ userId: 'usr_parent_001', otp: '654321' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.data).toBeUndefined();
    const cookies = (res.headers['set-cookie'] || []).join(';');
    expect(cookies).toContain('token=');
    expect(cookies).toContain('HttpOnly');
  });

  test('the mobile branch returns the token in the body and sets no cookies', async () => {
    seedMfa('654321');
    const res = await supertest(buildApp())
      .post('/api/auth/verify-otp')
      .send({ userId: 'usr_parent_001', otp: '654321', platform: 'mobile' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
