/* ============================================================
   /api/platform/auth/google — Google OAuth sign-in for the platform

   Mirrors the school-side /api/auth/google flow (auth.js) for the
   platform console:
     GET  /auth/google           → 302 to accounts.google.com (503 when unconfigured)
     GET  /auth/google/callback  → exchange Google code, match operator by email,
                                   302 to /platform?code=<single-use 30s exchange code>
     POST /auth/google/exchange  → mint platform_token cookie from the code

   Global fetch is stubbed so no real Google round-trip happens; the
   platform_operators store is in-memory (same shape as
   platform-operators-api.test.js). bcrypt + jwt are the real packages.
   ============================================================ */

const jwt = require('jsonwebtoken');

jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac',  () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email', () => ({
  sendPlatformOperatorInvite: jest.fn(() => Promise.resolve(true)),
  sendTicketNotice:           jest.fn(() => Promise.resolve(true)),
  sendSupportReply:           jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn() }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships',   () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities',    () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../config/moduleRegistry', () => ({ MODULE_REGISTRY: {} }));

/* ── in-memory platform_operators store ─────────────────────── */
let mockOperators = [];
function mockMatch(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockChain(v) {
  return { lean: () => Promise.resolve(v), select: () => mockChain(v), sort: () => mockChain(v), limit: () => mockChain(v) };
}
function mockOperatorStore() {
  return {
    findOne: (filter) => mockChain(mockOperators.find(o => mockMatch(o, filter)) ?? null),
    find:    (filter = {}) => mockChain(mockOperators.filter(o => mockMatch(o, filter))),
    create:  (doc) => { const d = { ...doc }; mockOperators.push(d); return Promise.resolve(d); },
    updateOne: (filter, update) => {
      const d = mockOperators.find(o => mockMatch(o, filter));
      if (!d) return Promise.resolve({ modifiedCount: 0 });
      if (update.$set) Object.assign(d, update.$set);
      return Promise.resolve({ modifiedCount: 1 });
    },
    exists: () => Promise.resolve(mockOperators.some(o => o.isActive) ? { _id: 'x' } : null),
  };
}
function mockGenericCollection() {
  return {
    find: () => mockChain([]), findOne: () => mockChain(null), findOneAndUpdate: () => mockChain(null),
    exists: () => Promise.resolve(null), countDocuments: () => Promise.resolve(0),
    create: d => Promise.resolve(d), updateOne: () => Promise.resolve({}), deleteOne: () => Promise.resolve({}),
    deleteMany: () => Promise.resolve({}), aggregate: () => ({ toArray: () => Promise.resolve([]) }),
  };
}
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => (col === 'platform_operators' ? mockOperatorStore() : mockGenericCollection())),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel:   jest.fn(() => mockGenericCollection()),
  platformModel: jest.fn(() => mockGenericCollection()),
}));

const express   = require('express');
const supertest = require('supertest');

const ORIGINAL_ENV = { ...process.env };

function buildApp() {
  jest.resetModules();
  const platformRouter = require('../../routes/platform');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = req.headers.cookie ? Object.fromEntries(req.headers.cookie.split('; ').map(c => c.split('='))) : {};
    next();
  });
  app.use('/api/platform', platformRouter);
  return app;
}

/* ── fetch stub ──────────────────────────────────────────────
   token endpoint → { access_token }
   userinfo endpoint → { email, name, picture }
   Flip googleEmail to null to simulate a profile with no email. */
let googleEmail = 'owner@msingi.io';
let googleName  = 'Ollie Owner';
let googlePicture = 'https://lh3.googleusercontent.com/a/ACg8aHtestowner';
let googleFetchFail = false;
function mockFetch(url) {
  if (googleFetchFail) return Promise.resolve({ json: () => Promise.reject(new Error('network down')) });
  if (String(url).includes('oauth2.googleapis.com/token')) {
    return Promise.resolve({ json: () => Promise.resolve({ access_token: 'g-access-token', id_token: 'g-id-token' }) });
  }
  if (String(url).includes('googleapis.com/oauth2/v3/userinfo')) {
    const profile = {};
    if (googleEmail) { profile.email = googleEmail; profile.name = googleName; profile.picture = googlePicture; }
    else profile.name = 'No Email';
    return Promise.resolve({ json: () => Promise.resolve(profile) });
  }
  return Promise.resolve({ json: () => Promise.resolve({}) });
}
global.fetch = jest.fn(mockFetch);

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    PLATFORM_JWT_SECRET: 'test-platform-secret',
    NODE_ENV: 'test',
    APP_URL: 'https://app.msingi.io',
    PUBLIC_URL: 'https://app.msingi.io',
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
  };
  jest.clearAllMocks();
  global.fetch.mockImplementation(mockFetch);
  googleEmail = 'owner@msingi.io';
  googleName  = 'Ollie Owner';
  googlePicture = 'https://lh3.googleusercontent.com/a/ACg8aHtestowner';
  googleFetchFail = false;
  mockOperators = [
    { id: 'op_owner', name: 'Ollie Owner', email: 'owner@msingi.io', tier: 'owner', template: 'owner', isActive: true, status: 'active' },
    { id: 'op_agent', name: 'Ada Agent',  email: 'agent@msingi.io', tier: 'support', template: 'support_agent', isActive: true, status: 'active' },
  ];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

/* ══════════════════════════════════════════════════════════════ */
describe('GET /auth/google — start of the flow', () => {
  test('redirects to accounts.google.com with the platform callback as redirect_uri', async () => {
    const res = await supertest(buildApp()).get('/api/platform/auth/google');
    expect(res.status).toBe(302);
    const target = res.headers.location;
    expect(target).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    const parsed = new URL(target);
    expect(parsed.searchParams.get('client_id')).toBe('test-google-client');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.msingi.io/api/platform/auth/google/callback');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('response_type')).toBe('code');
  });

  test('503s when GOOGLE_CLIENT_ID is unset so the console can hide the button', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await supertest(buildApp()).get('/api/platform/auth/google');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });

  test('is public — no platform session required', async () => {
    const res = await supertest(buildApp()).get('/api/platform/auth/google');
    // Public routes return 302/503, not 401.
    expect([302, 503]).toContain(res.status);
  });
});

/* ══════════════════════════════════════════════════════════════ */
describe('GET /auth/google/callback — Google round-trip', () => {
  test('matches the operator by Google email (case-insensitive) and redirects with a single-use code', async () => {
    googleEmail = 'Owner@Msingi.io'; // uppercase — must still match
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    const target = res.headers.location;
    expect(target).toMatch(/^https:\/\/app\.msingi\.io\/platform\?code=/);
    const code = new URL(target).searchParams.get('code');
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    // The operator's lastLoginAt was stamped. (typeof check — the value is
    // created inside the jest module sandbox, so toBeInstanceOf(String)
    // would spuriously fail on cross-realm identity.)
    const op = mockOperators.find(o => o.id === 'op_owner');
    expect(typeof op.lastLoginAt).toBe('string');
    expect(op.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // fetch was exercised: token endpoint + userinfo endpoint.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('oauth2.googleapis.com/token');
  });

  test('unknown Google email → not_an_operator (no auto-provisioning)', async () => {
    googleEmail = 'stranger@gmail.com';
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.msingi.io/platform?error=not_an_operator');
  });

  test('suspended (non-active) operator → not_an_operator', async () => {
    mockOperators[0].isActive = false;
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.msingi.io/platform?error=not_an_operator');
  });

  test('Google cancelled (error query param) → google_denied', async () => {
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.msingi.io/platform?error=google_denied');
  });

  test('missing both client id + secret → google_not_configured (no fetch at all)', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=google_not_configured');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('Google token endpoint failure → google_failed', async () => {
    googleFetchFail = true;
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.msingi.io/platform?error=google_failed');
  });

  test('profile without an email → google_failed', async () => {
    googleEmail = null;
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.msingi.io/platform?error=google_failed');
  });

  /* Profile picture / name capture: on a matching login the operator's
     `name` and Google-hosted `picture` are persisted; non-Google-hosted
     pictures are dropped; an unknown email writes nothing at all. */
  test('matching login persists the operator name + Google-hosted picture', async () => {
    googleName = 'Ollie the Owner';
    googlePicture = 'https://lh3.googleusercontent.com/a/newavatar/owner';
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    const op = mockOperators.find(o => o.id === 'op_owner');
    expect(op.name).toBe('Ollie the Owner');
    expect(op.picture).toBe('https://lh3.googleusercontent.com/a/newavatar/owner');
    expect(typeof op.lastLoginAt).toBe('string');
  });

  test('a non-Google-hosted picture URL is dropped (name still saved)', async () => {
    googleName = 'Ollie the Owner';
    googlePicture = 'https://example.com/avatar.png'; // not googleusercontent.com
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    const op = mockOperators.find(o => o.id === 'op_owner');
    expect(op.name).toBe('Ollie the Owner');
    expect(op.picture).toBeUndefined();
  });

  test('a http:// (non-https) picture URL is dropped', async () => {
    googlePicture = 'http://lh3.googleusercontent.com/a/x';
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    const op = mockOperators.find(o => o.id === 'op_owner');
    expect(op.picture).toBeUndefined();
  });

  test('unknown Google email → no name/picture write at all (strict)', async () => {
    googleEmail = 'stranger@gmail.com';
    googleName = 'Stranger';
    googlePicture = 'https://lh3.googleusercontent.com/a/newavatar/stranger';
    const res = await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.msingi.io/platform?error=not_an_operator');
    // The owner's record is untouched — no auto-provisioning of name/picture.
    const owner = mockOperators.find(o => o.id === 'op_owner');
    expect(owner.name).toBe('Ollie Owner');
    expect(owner.picture).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════ */
describe('POST /auth/google/exchange — code → platform_token', () => {
  /* One app instance for the whole describe block: the exchange-code Map
     lives in the module, and buildApp() calls jest.resetModules() (which
     re-requires the router with a FRESH empty map), so a code minted on
     one app would be invisible to a second app. */
  let app;
  beforeAll(() => { app = buildApp(); });

  /* Run the callback to mint a code, then feed it to the exchange. */
  async function mintCode() {
    const res = await supertest(app).get('/api/platform/auth/google/callback?code=g-auth-code');
    return new URL(res.headers.location).searchParams.get('code');
  }

  test('exchanges a fresh code for a working platform session', async () => {
    const code = await mintCode();
    const res  = await supertest(app).post('/api/platform/auth/google/exchange').send({ code });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const setCookie = res.headers['set-cookie'] || [];
    const tokenCookie = setCookie.find(c => c.startsWith('platform_token='));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/HttpOnly/);

    // The minted JWT is decodable and carries the operator's identity.
    const tokenValue = tokenCookie.split(';')[0].split('=')[1];
    const decoded = jwt.verify(tokenValue, 'test-platform-secret');
    expect(decoded.sub).toBe('platform-operator');
    expect(decoded.operatorId).toBe('op_owner');
    expect(decoded.email).toBe('owner@msingi.io');
    expect(decoded.tier).toBe('owner');

    // A CSRF cookie is issued alongside, exactly like the password login.
    const csrfCookie = setCookie.find(c => c.startsWith('platform_csrf_token='));
    expect(csrfCookie).toBeDefined();

    // /me works with the minted token.
    const me = await supertest(app)
      .get('/api/platform/me')
      .set('Cookie', tokenCookie.split(';')[0]);
    expect(me.status).toBe(200);
    expect(me.body.operator.email).toBe('owner@msingi.io');
    // The Google picture persisted by the callback is exposed via /me.
    expect(me.body.operator.picture).toBe('https://lh3.googleusercontent.com/a/ACg8aHtestowner');
  });

  test('a code is single-use — the second exchange 410s', async () => {
    const code = await mintCode();
    const first  = await supertest(app).post('/api/platform/auth/google/exchange').send({ code });
    expect(first.status).toBe(200);
    const second = await supertest(app).post('/api/platform/auth/google/exchange').send({ code });
    expect(second.status).toBe(410);
  });

  test('a missing code 400s', async () => {
    const res = await supertest(app).post('/api/platform/auth/google/exchange').send({});
    expect(res.status).toBe(400);
  });

  test('a garbage code 410s (EXCHANGE_GONE)', async () => {
    const res = await supertest(app).post('/api/platform/auth/google/exchange').send({ code: 'nope' });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('EXCHANGE_GONE');
  });
});

/* ══════════════════════════════════════════════════════════════
   Rate limit on /auth/google/exchange (mirrors the school-side
   authLimiter: 10 requests per 15 min per IP). */
describe('POST /auth/google/exchange — rate limiter', () => {
  test('the 11th request within the window 429s', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      const code = await (async () => {
        const r = await supertest(app).get('/api/platform/auth/google/callback?code=g-auth-code');
        return new URL(r.headers.location).searchParams.get('code');
      })();
      const res = await supertest(app).post('/api/platform/auth/google/exchange').send({ code });
      expect(res.status).toBe(200); // each fresh code succeeds
    }
    // 11th request with a fresh, valid code — must be rate-limited.
    const code = (await (async () => {
      const r = await supertest(app).get('/api/platform/auth/google/callback?code=g-auth-code');
      return new URL(r.headers.location).searchParams.get('code');
    })());
    const eleventh = await supertest(app).post('/api/platform/auth/google/exchange').send({ code });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('RATE_LIMIT');
  });

  /* The callback's catch block logs err.message only (not the full error
     object), so a prod log stream never retains an access token or profile
     email pulled from Google's userinfo. */
  test('callback failure logs err.message only (no stack, no full error object)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    googleFetchFail = true;
    await supertest(buildApp()).get('/api/platform/auth/google/callback?code=g-auth-code');
    const calls = spy.mock.calls.filter(args => String(args[0]).includes('[platform/google/callback]'));
    expect(calls.length).toBe(1);
    const loggedArg = calls[0][1];
    // err.message is a string like "network down" — NOT an Error instance
    // (which would carry .stack and could include token/email).
    expect(typeof loggedArg).toBe('string');
    expect(loggedArg).not.toContain('at '); // no stack-trace frame
    spy.mockRestore();
  });
});
