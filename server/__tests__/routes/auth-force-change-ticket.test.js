/* ============================================================
   POST /api/auth/force-change — the ticket IS the authorization

   This route used to take a bare client-supplied `userId` and set that
   account's password with no proof of anything, then hand back a session —
   an anonymous takeover of any account whose id could be guessed or obtained.

   These tests exist so that cannot come back. The users mock below HONOURS
   the query filter (unlike the fixture-based mocks elsewhere, which return a
   user regardless), because the whole fix is that the database only matches
   a live ticket of the right purpose — a mock that ignores the filter would
   pass even if the route regressed to a bare id lookup.
   ============================================================ */

jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => { req.school = { id: 'sch_1', slug: 'demo', name: 'Demo', systemEmail: 'demo@demo.school' }; next(); },
  _mapSchoolDoc: jest.fn(),
  CURRENCY_SYMBOLS: {},
}));
jest.mock('../../utils/email', () => ({
  sendPasswordChanged: jest.fn().mockResolvedValue(true),
  sendLoginOTP:        jest.fn().mockResolvedValue(true),
  sendPasswordReset:   jest.fn().mockResolvedValue(true),
}));
jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({ sessionId: 'sess_1', absoluteExpiry: new Date(Date.now() + 86_400_000).toISOString() }),
}));
jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail: jest.fn(), clearFail: jest.fn(),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
  getIdentityTokenVersion: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/identity-cutover', () => ({ isIdentityCutoverEnabled: () => false }));
jest.mock('../../middleware/rbac', () => ({ _mergeUserOverrides: jest.fn() }));
jest.mock('../../utils/csrf', () => ({ issueCsrfCookie: jest.fn(), clearCsrfCookie: jest.fn() }));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: jest.fn().mockResolvedValue('https://demo.msingi.io') }));

const ticket = require('../../utils/password-ticket');

/* ── Filter-aware model double ───────────────────────────────── */
let mockUserDoc = null;

function mockMatchesFilter(doc, filter) {
  if (!doc) return false;
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$gt' in v) return doc[k] > v.$gt;          // ISO strings compare lexicographically
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$exists' in v) return v.$exists ? doc[k] !== undefined : doc[k] === undefined;
      return true;
    }
    return doc[k] === v;
  });
}
function mockChain(value) {
  const q = { select: () => q, sort: () => q, limit: () => q, lean: () => Promise.resolve(value), catch: (fn) => Promise.resolve(value).catch(fn) };
  return q;
}
const mockModel = (getDoc) => ({
  findOne: jest.fn((filter) => mockChain(mockMatchesFilter(getDoc(), filter) ? getDoc() : null)),
  updateOne: jest.fn(() => Promise.resolve({})),
  find: jest.fn(() => mockChain([])),
  countDocuments: jest.fn(() => Promise.resolve(0)),
});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => (c === 'schools'
    ? {
        findOne: jest.fn(() => {
          const doc = { id: 'sch_1', name: 'Demo', slug: 'demo', systemEmail: 'demo@demo.school' };
          const q = { select: () => q, lean: () => Promise.resolve(doc) };
          return q;
        }),
        updateOne: jest.fn(),
      }
    : mockModel(() => null))),
}));
/* One instance per collection, so a test can inspect what the route wrote.
   (A fresh mock per call would hide the update from the assertion.) */
let mockUsersModel = null;

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: () => ({ schoolId: 'sch_1' }),
  tenantModel: (c) => {
    if (c !== 'users') return mockModel(() => null);
    if (!mockUsersModel) mockUsersModel = mockModel(() => mockUserDoc);
    return mockUsersModel;
  },
}));

const express = require('express');
const supertest = require('supertest');
const authRouter = require('../../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

function forceChange(body) {
  return supertest(app).post('/api/auth/force-change').set('X-School-Slug', 'demo').send(body);
}

function userWithTicket(purpose = 'forceChange', ttlMs = 60_000) {
  const { token, set } = ticket.issueTicket(purpose, { ttlMs });
  return {
    token,
    doc: {
      _id: '507f1f77bcf86cd799439011', id: 'usr_1', schoolId: 'sch_1',
      name: 'Demo Admin', email: 'admin@demo.school', role: 'admin', primaryRole: 'admin',
      roles: ['admin'], isActive: true, ...set,
    },
  };
}

beforeEach(() => { jest.clearAllMocks(); mockUserDoc = null; });

describe('POST /auth/force-change — refuses anything but a live ticket', () => {
  test('no ticket at all is a 400, not a password change', async () => {
    const res = await forceChange({ newPassword: 'BrandNewPass1!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ticket/i);
  });

  test('a bare userId no longer authorizes anything (the old exploit)', async () => {
    mockUserDoc = userWithTicket().doc;
    const res = await forceChange({ userId: 'usr_1', schoolId: 'sch_1', newPassword: 'BrandNewPass1!' });
    expect(res.status).toBe(400);   // no `ticket` field => rejected before any lookup
  });

  test('an unknown/guessed ticket is rejected by the QUERY (401)', async () => {
    mockUserDoc = userWithTicket().doc;
    const res = await forceChange({ ticket: 'a'.repeat(64), newPassword: 'BrandNewPass1!' });
    expect(res.status).toBe(401);
  });

  test('an EXPIRED ticket is rejected', async () => {
    mockUserDoc = userWithTicket('forceChange', -1_000).doc;   // already past
    const res = await forceChange({ ticket: 'b'.repeat(64), newPassword: 'BrandNewPass1!' });
    expect(res.status).toBe(401);
  });

  test("a reset ticket cannot be replayed as a force-change ticket", async () => {
    const { token, doc } = userWithTicket('reset');
    mockUserDoc = doc;
    const res = await forceChange({ ticket: token, newPassword: 'BrandNewPass1!' });
    expect(res.status).toBe(401);
  });

  test('a short password is rejected before any lookup', async () => {
    const { token, doc } = userWithTicket();
    mockUserDoc = doc;
    const res = await forceChange({ ticket: token, newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  test('a live force-change ticket is accepted, and is spent', async () => {
    const { token, doc } = userWithTicket();
    mockUserDoc = doc;

    const res = await forceChange({ ticket: token, newPassword: 'BrandNewPass1!' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();

    // Single use: the same stored fields must be cleared as part of the write.
    const tenantModel = require('../../utils/tenant-model');
    const users = tenantModel.tenantModel('users', { schoolId: 'sch_1' });
    const written = users.updateOne.mock.calls.at(-1)[1];
    expect(written[ticket.FIELD_HASH]).toBeNull();
    expect(written[ticket.FIELD_PURPOSE]).toBeNull();
    expect(written[ticket.FIELD_EXPIRY]).toBeNull();
  });
});
