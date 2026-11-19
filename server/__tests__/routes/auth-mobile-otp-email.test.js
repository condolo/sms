/* ============================================================
   School-less email-code sign-in (app only)

     POST /api/auth/mobile/otp/request
     POST /api/auth/mobile/otp/verify

   The app's login card asks only for the email. These routes are what
   make that possible without a school picker. What is pinned here:

     • ONE ADDRESS, EVERY SCHOOL. The code is written to every active
       account that holds the address, so a parent with children at two
       schools signs into both with one email and six digits.
     • ONE CODE, ONE EMAIL. Multi-school addresses get a single message
       branded "Msingi", not three near-identical emails.
     • NO ENUMERATION. Unknown addresses answer exactly like known ones.
     • THE CODE IS SPENT EVERYWHERE. Verifying it $unset's it on every
       account it was written to, so neither this route nor the
       tenant-scoped /otp/verify can replay it.
     • PRIVILEGED ROLES STILL STEP UP. A code is a first factor; an
       admin-only address is challenged for the second code instead of
       receiving a silent session — and the challenge names its school.
     • A SILENT SESSION IS NEVER TRADED FOR A STEP-UP. When one school
       can open safely and another needs MFA, the safe session is
       returned; the MFA school is left to the password door.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const crypto = require('crypto');

const SCHOOLS = {
  sch_a: { id: 'sch_a', slug: 'school-a', name: 'School A', isActive: true, isDemo: false, systemEmail: 'office@a.test' },
  sch_b: { id: 'sch_b', slug: 'school-b', name: 'School B', isActive: true, isDemo: false, systemEmail: 'office@b.test' },
  sch_admin: { id: 'sch_admin', slug: 'school-admin', name: 'Admin School', isActive: true, isDemo: false, systemEmail: 'office@admin.test' },
  sch_demo: { id: 'sch_demo', slug: 'demo', name: 'Demo School', isActive: true, isDemo: true, systemEmail: 'office@demo.test' },
  sch_demo2: { id: 'sch_demo2', slug: 'demo-two', name: 'Demo School Two', isActive: true, isDemo: true, systemEmail: 'office@demo2.test' },
};

jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (req, _res, next) => next(),
  _findSchool: jest.fn(({ id }) => Promise.resolve(SCHOOLS[id] ?? null)),
  _rejectExpiredDemo: jest.fn(() => false),
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
    sessionId: 'sess_mobile_otp',
    absoluteExpiry: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  }),
}));

jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail: jest.fn().mockResolvedValue(undefined),
  clearFail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

let mockAccounts = [];

function mockFindAccount(filter) {
  if (!filter) return null;
  if (filter._id !== undefined) {
    return mockAccounts.find(a => String(a._id) === String(filter._id)) ?? null;
  }
  return mockAccounts.find(a => a.id === filter.id && a.schoolId === filter.schoolId) ?? null;
}

function mockApplyUpdate(account, update) {
  if (!account) return;
  if (update.$set) for (const [k, v] of Object.entries(update.$set)) account[k] = v;
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) account[k] = (account[k] || 0) + v;
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete account[k];
}

/** Mongoose query chain: every builder returns itself, lean() resolves. */
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

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        find: (filter) => {
          const email = String(filter?.email || '').toLowerCase();
          const rows = mockAccounts.filter(a =>
            a.email.toLowerCase() === email && a.isActive !== false,
          );
          return mockChain(rows.map(a => ({ ...a })));
        },
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
        findOne: (filter) => mockChain(mockFindAccount({ ...filter, schoolId: ctx?.schoolId })),
        updateOne: jest.fn((filter, update) => {
          mockApplyUpdate(mockFindAccount(filter), update);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      };
    }
    return {
      findOne: () => mockChain(null),
      find: () => mockChain([]),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
  }),
}));

const express = require('express');
const supertest = require('supertest');
const email = require('../../utils/email');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/auth', require('../../routes/auth'));
  return app;
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function makeAccount(overrides = {}) {
  return {
    _id: `oid_${overrides.id ?? 'x'}`,
    id: 'usr_parent_a',
    schoolId: 'sch_a',
    name: 'A Parent',
    email: 'parent@example.com',
    role: 'parent', primaryRole: 'parent', roles: ['parent'],
    isActive: true,
    tokenVersion: 0,
    lastLogin: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function seedCode(code = '123456', overrides = {}) {
  for (const account of mockAccounts) {
    account.loginOtp = sha256(code);
    account.loginOtpExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    account.loginOtpAttempts = 0;
    Object.assign(account, overrides);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccounts = [];
});

/* ── Requesting the code ───────────────────────────────────────── */

describe('POST /api/auth/mobile/otp/request', () => {
  test('one email reaches every school the address belongs to, with one code', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_a', schoolId: 'sch_a', name: 'A Parent' }),
      makeAccount({ id: 'usr_b', schoolId: 'sch_b', name: 'A Parent' }),
    ];

    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/request')
      .send({ email: 'Parent@Example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(JSON.stringify(res.body)).not.toContain('otp');

    // One message, not one per school, and the code spans schools so the
    // branding is the platform's rather than any single school's.
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);
    const sent = email.sendLoginOTP.mock.calls[0][0];
    expect(sent.schoolName).toBe('Msingi');
    expect(sent.schoolId).toBeNull();
    expect(sent.otp).toMatch(/^\d{6}$/);
    expect(sent.ttlMinutes).toBe(10);

    // The SAME hash on both accounts: one code, spendable once everywhere.
    for (const account of mockAccounts) {
      expect(account.loginOtp).toBe(sha256(sent.otp));
      expect(account.loginOtp).not.toBe(sent.otp);
      const ttl = new Date(account.loginOtpExpiry).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
    }
  });

  test('an address at one school is branded for that school', async () => {
    mockAccounts = [makeAccount({ schoolId: 'sch_a' })];

    await supertest(buildApp())
      .post('/api/auth/mobile/otp/request')
      .send({ email: 'parent@example.com' });

    const sent = email.sendLoginOTP.mock.calls[0][0];
    expect(sent.schoolName).toBe('School A');
    expect(sent.schoolId).toBe('sch_a');
  });

  test('an address that exists only at demo schools never sends platform mail', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_demo', schoolId: 'sch_demo' }),
      makeAccount({ id: 'usr_demo2', schoolId: 'sch_demo2' }),
    ];

    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/request')
      .send({ email: 'parent@example.com' });

    // The answer stays opaque, but the sandbox rule holds: no email at all.
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(email.sendLoginOTP).not.toHaveBeenCalled();
    for (const account of mockAccounts) {
      expect(account.loginOtp).toMatch(/^[0-9a-f]{64}$/); // code still staged
    }
  });

  test('a demo + real mix still sends, because the real school needs the code', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_demo', schoolId: 'sch_demo' }),
      makeAccount({ id: 'usr_real', schoolId: 'sch_a' }),
    ];

    await supertest(buildApp())
      .post('/api/auth/mobile/otp/request')
      .send({ email: 'parent@example.com' });

    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);
    expect(email.sendLoginOTP.mock.calls[0][0].schoolId).toBeNull();
  });

  test('an unknown address gets the identical answer and no email', async () => {
    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/request')
      .send({ email: 'stranger@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(email.sendLoginOTP).not.toHaveBeenCalled();
  });

  test('one inbox, one resend window: a second ask sends nothing', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_a', schoolId: 'sch_a' }),
      makeAccount({ id: 'usr_b', schoolId: 'sch_b' }),
    ];

    const app = buildApp();
    await supertest(app).post('/api/auth/mobile/otp/request').send({ email: 'parent@example.com' });
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);

    const res = await supertest(app)
      .post('/api/auth/mobile/otp/request')
      .send({ email: 'parent@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);
  });

  test('no email at all is a 400 — that one is the caller’s business', async () => {
    const res = await supertest(buildApp()).post('/api/auth/mobile/otp/request').send({});
    expect(res.status).toBe(400);
  });
});

/* ── Verifying it ──────────────────────────────────────────────── */

describe('POST /api/auth/mobile/otp/verify', () => {
  test('a correct code signs into every school on the address', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_a', schoolId: 'sch_a', lastLogin: '2026-11-10T08:00:00.000Z' }),
      makeAccount({ id: 'usr_b', schoolId: 'sch_b', lastLogin: '2026-11-01T08:00:00.000Z' }),
    ];
    seedCode('123456');

    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/verify')
      .send({ email: 'parent@example.com', code: '123456', deviceId: 'dev_1' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.school.id).toBe('sch_a'); // most recently used first
    expect(res.body.data.linkedSchools).toHaveLength(1);
    expect(res.body.data.linkedSchools[0].school.id).toBe('sch_b');
    expect(res.headers['set-cookie']).toBeUndefined();

    // Spent on BOTH, so neither door can replay it.
    for (const account of mockAccounts) {
      expect(account.loginOtp).toBeUndefined();
      expect(account.loginOtpExpiry).toBeUndefined();
    }
  });

  test('a wrong code counts one attempt against every live copy', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_a', schoolId: 'sch_a' }),
      makeAccount({ id: 'usr_b', schoolId: 'sch_b' }),
    ];
    seedCode('123456');

    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/verify')
      .send({ email: 'parent@example.com', code: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_OTP');
    for (const account of mockAccounts) {
      expect(account.loginOtpAttempts).toBe(1);
      expect(account.loginOtp).toBe(sha256('123456')); // still usable
    }
  });

  test('an unknown address fails exactly like a wrong code', async () => {
    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/verify')
      .send({ email: 'stranger@example.com', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  test('an admin-only address gets the step-up, and the challenge names its school', async () => {
    mockAccounts = [makeAccount({
      id: 'usr_admin', schoolId: 'sch_admin', name: 'Admin Person',
      role: 'admin', primaryRole: 'admin', roles: ['admin'],
    })];
    seedCode('123456');

    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/verify')
      .send({ email: 'parent@example.com', code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.schoolSlug).toBe('school-admin');
    expect(res.body.data.schoolName).toBe('Admin School');
    expect(mockAccounts[0].mfaOtp).toMatch(/^[0-9a-f]{64}$/); // second code, hashed
    expect(email.sendLoginOTP).toHaveBeenCalledTimes(1);      // …and sent
  });

  test('a safe school opens silently even when another needs the step-up', async () => {
    mockAccounts = [
      makeAccount({ id: 'usr_parent', schoolId: 'sch_a', lastLogin: '2026-11-10T08:00:00.000Z' }),
      makeAccount({
        id: 'usr_admin', schoolId: 'sch_admin', role: 'admin',
        primaryRole: 'admin', roles: ['admin'], lastLogin: '2026-11-11T08:00:00.000Z',
      }),
    ];
    seedCode('123456');

    const res = await supertest(buildApp())
      .post('/api/auth/mobile/otp/verify')
      .send({ email: 'parent@example.com', code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.school.id).toBe('sch_a');
    expect(res.body.data.mfaRequired).toBeUndefined();
    // No second code was sent: the session never stands in for a step-up.
    expect(email.sendLoginOTP).not.toHaveBeenCalled();
  });
});
