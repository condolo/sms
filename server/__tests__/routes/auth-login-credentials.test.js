/* ============================================================
   POST /api/auth/login-credentials — credentials-only sign-in.

   The tenant-scoped /login needs a school (subdomain or X-School-Slug);
   this door discovers the school FROM the credentials. What these tests
   pin, because each is a decision that is easy to regress:

     • A correct email+password signs into the right school with no slug
       at all, and the response is the SAME contract as /login (cookie for
       web, token-in-body for the app).
     • An unknown account, a wrong password and no candidates answer one
       generic 401 — no enumeration.
     • The school list (409) appears only AFTER the password is proved, so
       a stranger learns nothing.
     • Failures still increment the per-school lockout counter.
     • A locked matching account is refused here too.
     • The delegated handler still applies its own policy (pending school,
       inactive user, MFA, expiry).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const bcrypt = require('bcryptjs');

const PASSWORD = 'CorrectHorse1!';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const WRONG = 'nope-nope-nope';

const mockSchoolsById = {
  sch_a: {
    id: 'sch_a', slug: 'school-a', name: 'School A', shortName: 'A',
    isActive: true, isDemo: true, systemEmail: 'office@a.test', plan: 'core',
  },
  sch_b: {
    id: 'sch_b', slug: 'school-b', name: 'School B', shortName: 'B',
    isActive: true, isDemo: true, systemEmail: 'office@b.test', plan: 'core',
  },
};

let mockCandidates = [];
let mockScopedUsers = {}; // schoolId → user document the delegated handler sees
let mockSchoolDoc = null; // raw school doc for the pending/inactive branches

jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => { req.school = mockSchoolsById.sch_a; next(); },
  _findSchool: jest.fn(({ id }) => Promise.resolve(mockSchoolsById[id] ?? null)),
  _rejectExpiredDemo: jest.fn((res) => {
    res.status(403).json({ success: false, error: { code: 'DEMO_EXPIRED', message: 'This demo has ended.' } });
    return true;
  }),
  _mapSchoolDoc: jest.fn(),
  CURRENCY_SYMBOLS: {},
}));

jest.mock('../../utils/identity-cutover', () => ({ isIdentityCutoverEnabled: () => false }));
jest.mock('../../middleware/rbac', () => ({ _mergeUserOverrides: (merged) => merged }));

jest.mock('../../utils/email', () => ({
  sendLoginOTP: jest.fn().mockResolvedValue(true),
  sendTrialReminder: jest.fn().mockResolvedValue(true),
  sendPasswordExpiry: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: 'sess_cred_001',
    absoluteExpiry: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  }),
}));

jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail: jest.fn().mockResolvedValue(undefined),
  clearFail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn(),
  revokeIdentityTokens: jest.fn(),
  getIdentityTokenVersion: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../utils/csrf', () => ({ issueCsrfCookie: jest.fn(), clearCsrfCookie: jest.fn() }));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: jest.fn().mockResolvedValue('https://a.test/login') }));

function mockChain(result) {
  const q = {
    select: () => q,
    collation: () => q,
    sort: () => q,
    limit: () => q,
    lean: () => Promise.resolve(result),
  };
  return q;
}

function mockMatches(filter, doc) {
  const or = filter?.$or;
  if (Array.isArray(or)) {
    return or.some(part => Object.entries(part).every(([k, v]) => doc[k] === v));
  }
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return { find: (filter) => mockChain(mockCandidates.filter(c => mockMatches(filter, c))) };
    }
    if (collection === 'schools') {
      return {
        findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }), lean: () => Promise.resolve(mockSchoolDoc) }),
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.school?.id }),
  tenantModel: jest.fn((collection, ctx) => {
    if (collection === 'users') {
      return {
        findOne: (filter) => mockChain(mockScopedUsers[ctx?.schoolId] ?? null),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
    }
    if (collection === 'role_permissions') return { find: () => mockChain([]), findOne: () => mockChain(null) };
    if (collection === 'teachers') return { findOne: () => mockChain(null) };
    if (collection === 'user_photos') return { findOne: () => mockChain(null) };
    return { findOne: () => mockChain(null), find: () => mockChain([]), updateOne: jest.fn().mockResolvedValue({}) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const SecurityService = require('../../services/securityService');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/auth', require('../../routes/auth'));
  return app;
}

function makeUser(overrides = {}) {
  return {
    _id: `oid_${overrides.id ?? 'x'}`,
    id: 'usr_a_1',
    schoolId: 'sch_a',
    name: 'A User',
    email: 'user@example.com',
    role: 'parent', primaryRole: 'parent', roles: ['parent'],
    isActive: true,
    password: HASH,
    passwordChangedAt: new Date().toISOString(),
    tokenVersion: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCandidates = [];
  mockScopedUsers = {};
  mockSchoolDoc = { id: 'sch_a', status: 'active' };
});

describe('POST /api/auth/login-credentials', () => {
  test('signs in with no school input and issues the web session cookie', async () => {
    const user = makeUser();
    mockCandidates = [user];
    mockScopedUsers = { sch_a: user };

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('usr_a_1');
    expect(res.body.school.id).toBe('sch_a');
    // Web contract: HttpOnly cookie, not a token in the body.
    expect(String(res.headers['set-cookie'])).toContain('token=');
    expect(res.body.token).toBeUndefined();
    expect(SecurityService.clearFail).toHaveBeenCalledWith('sch_a', 'user@example.com');
  });

  test('the app shape (platform: mobile) gets the token in the body and no cookie', async () => {
    const user = makeUser();
    mockCandidates = [user];
    mockScopedUsers = { sch_a: user };

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD, platform: 'mobile' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.school.id).toBe('sch_a');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('an unknown account and a wrong password answer the same generic 401', async () => {
    const res1 = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(res1.status).toBe(401);
    expect(res1.body.error).toBe('Invalid email or password');
    expect(SecurityService.recordFail).not.toHaveBeenCalled();

    const user = makeUser();
    mockCandidates = [user];
    const res2 = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: WRONG });
    expect(res2.status).toBe(401);
    expect(res2.body.error).toBe('Invalid email or password');
    // The per-school lockout counter must still grow, or this endpoint
    // would be a lockout-free bypass.
    expect(SecurityService.recordFail).toHaveBeenCalledWith('sch_a', 'user@example.com', expect.anything(), {});
  });

  test('the same email + password at two schools returns a picker AFTER the password is proved', async () => {
    mockCandidates = [
      makeUser({ id: 'usr_a_1', schoolId: 'sch_a' }),
      makeUser({ id: 'usr_b_1', schoolId: 'sch_b', _id: 'oid_b' }),
    ];

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('multiple_schools');
    expect(res.body.schools.map(s => s.slug).sort()).toEqual(['school-a', 'school-b']);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('the same email with only ONE matching password signs into that school alone', async () => {
    const a = makeUser({ id: 'usr_a_1', schoolId: 'sch_a' });
    const b = makeUser({ id: 'usr_b_1', schoolId: 'sch_b', _id: 'oid_b', password: bcrypt.hashSync('OtherPassword2!', 4) });
    mockCandidates = [a, b];
    mockScopedUsers = { sch_a: a, sch_b: b };

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.school.id).toBe('sch_a');
  });

  test('a locked matching account is refused here too', async () => {
    const user = makeUser();
    mockCandidates = [user];
    SecurityService.checkAccountLock.mockResolvedValueOnce(600);

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBe(600);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('the delegated handler still enforces its own policy (pending school → 403)', async () => {
    const user = makeUser({ isActive: false });
    mockCandidates = [user];
    mockScopedUsers = { sch_a: user };
    mockSchoolDoc = { id: 'sch_a', status: 'pending' };

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('pending_approval');
  });

  test('admission numbers (username) work the same way — app-only flow', async () => {
    const student = makeUser({
      id: 'usr_stu_1', email: undefined, username: 'adm-2023-0001',
      role: 'student', primaryRole: 'student', roles: ['student'],
    });
    mockCandidates = [student];
    mockScopedUsers = { sch_a: student };

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ identifier: 'ADM-2023-0001', password: PASSWORD, platform: 'mobile' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe('usr_stu_1');
  });

  test('a teacher who is also a parent carries guardian links in the token (role switching)', async () => {
    const user = makeUser({
      role: 'teacher', primaryRole: 'teacher', roles: ['teacher', 'parent'],
      guardianOf: ['std_1'], studentIds: ['std_1'],
    });
    mockCandidates = [user];
    mockScopedUsers = { sch_a: user };

    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com', password: PASSWORD, platform: 'mobile' });

    expect(res.status).toBe(200);
    const jwt = require('jsonwebtoken');
    const payload = jwt.decode(res.body.data.token);
    expect(payload.role).toBe('teacher');
    expect(payload.roles).toEqual(['teacher', 'parent']);
    // Without these the parent face would render empty (or 403) even though
    // the account is linked — the server must send them for ANY role list
    // that includes parent/guardian, not only for a parent primary role.
    expect(payload.guardianOf).toEqual(['std_1']);
    expect(payload.studentIds).toEqual(['std_1']);
  });

  test('the MFA challenge names the school so a school-less sign-in can finish', async () => {
    mockSchoolsById.sch_a.isDemo = false;
    try {
      const user = makeUser({ role: 'admin', primaryRole: 'admin', roles: ['admin'], mfaEnabled: true });
      mockCandidates = [user];
      mockScopedUsers = { sch_a: user };

      const res = await supertest(buildApp())
        .post('/api/auth/login-credentials')
        .send({ email: 'user@example.com', password: PASSWORD, platform: 'mobile' });

      expect(res.status).toBe(200);
      expect(res.body.mfaRequired).toBe(true);
      expect(res.body.schoolSlug).toBe('school-a');
      expect(res.body.schoolName).toBe('School A');
    } finally {
      mockSchoolsById.sch_a.isDemo = true;
    }
  });

  test('a missing password is a 400 — the caller’s own input, not an account answer', async () => {
    const res = await supertest(buildApp())
      .post('/api/auth/login-credentials')
      .send({ email: 'user@example.com' });
    expect(res.status).toBe(400);
  });
});
