/* ============================================================
   POST /api/platform/schools/:id/impersonate — unit tests with mocked DB.

   Regression coverage for two real bugs found from live usage:

   1. The response never included the school doc, only `{ token, user }`.
      platform.html's doImpersonate() then wrote a hardcoded `school: {}`
      into the session it hands the client SPA, so every session field the
      client reads off `session.school` (plan, logoUrl, primaryColor,
      moduleConfig) came back undefined for the whole impersonated session
      — visibly, TopBar's plan badge fell through to the literal 'core'
      fallback regardless of the school's real plan. Fixed by returning
      `school` in the response, mirroring /api/auth/login's shape.

   2. The route hand-rolled its own JWT payload instead of reusing
      auth.js's _buildTokenPayload, so it never carried orgId/membershipId
      (C9) or identityId/itv (ADR-0003) — meaning the School Switcher
      (gated on availableSchools.length > 0, itself gated on
      payload.orgId/identityId) could never appear for an impersonated
      session, even for an org with multiSchoolEnabled on. Fixed by
      building the token via the same _buildTokenPayload/_availableSchools
      auth.js uses for a real login (exposed on its router export, same
      in-process reuse convention as qa-health.js's
      _identityMigrationStatus), and returning availableSchools too.

   3. The response never included moduleRegistry, unlike every other
      session-establishing response (login/verify-otp/force-change/
      exchange/org-login) — this route hand-builds its own response instead
      of reusing auth.js's, and was missed when moduleRegistry embedding
      was wired up. platform.html's doImpersonate() also wrote the RAW,
      unsliced user/school docs straight into the localStorage session
      (bypassing client/src/store/auth.js's _slimUser/_slimSchool), which
      both dropped moduleRegistry parity and persisted extra sensitive
      fields (e.g. the school's Mpesa keys) that no real login session ever
      writes to localStorage. Fixed by adding moduleRegistry to this
      response and rewriting platform.html's session write to mirror
      _slimUser/_slimSchool's exact field list.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => { req.platformOperatorTier = 'owner'; next(); },
  requireOwnerTier: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn((p) => 'signed:' + JSON.stringify(p)) }));
jest.mock('../../utils/email', () => ({ sendImpersonationNotice: jest.fn() }));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-organizations', () => ({
  provisionOrganizationForSchool: jest.fn(),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

// PLAT-01 remediation — impersonation now creates a real, tracked session
// (server/services/sessionService.js's createImpersonationSession) instead
// of a bare uuidv4() with nothing behind it. Mocked here with a real
// in-memory counter so sessionId is still verifiably unique per call,
// same property the old raw-uuid test coverage relied on.
let mockSessionCounter = 0;
const mockCreateImpersonationSession = jest.fn(async () => {
  mockSessionCounter += 1;
  return { sessionId: `sess_mock_impersonation_session_${mockSessionCounter}`, absoluteExpiry: '2026-01-01T01:00:00.000Z' };
});
jest.mock('../../services/sessionService', () => ({
  createImpersonationSession: (...args) => mockCreateImpersonationSession(...args),
}));

// Mirrors auth.js's real _buildTokenPayload/_availableSchools contract
// closely enough to exercise platform.js's reuse of them, without pulling
// in auth.js's full dependency graph (SecurityService, SessionService, …).
const mockBuildTokenPayload = jest.fn(async (user, schoolId) => ({
  userId: user.id, schoolId, email: user.email, role: user.role, roles: [user.role],
  ...(user.orgId       ? { orgId: user.orgId }             : {}),
  ...(user.identityId  ? { identityId: user.identityId }   : {}),
}));
const mockAvailableSchools = jest.fn(async (payload) => {
  if (!payload.orgId || !payload.identityId) return [];
  return [{ id: 'sch_other_campus', name: 'Other Campus' }];
});
jest.mock('../../routes/auth', () => ({
  _buildTokenPayload: (...args) => mockBuildTokenPayload(...args),
  _availableSchools:  (...args) => mockAvailableSchools(...args),
}));

let mockSchoolDoc = {
  id: 'sch_trinitas', slug: 'trinitas-tis', name: 'Trinitas International SChool',
  plan: 'family', logoUrl: null, primaryColor: '#4f46e5', moduleConfig: { library: true },
};
let mockAdminDoc = {
  id: 'usr_admin1', role: 'superadmin', email: 'admin@trinitas-tis.example', schoolId: 'sch_trinitas',
};

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return { findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) };
      }
      if (col === 'users') {
        return { findOne: () => ({ lean: () => Promise.resolve(mockAdminDoc) }) };
      }
      return { find: () => ({ lean: () => Promise.resolve([]) }) };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

describe('POST /api/platform/schools/:id/impersonate', () => {
  const prevAllow = process.env.ALLOW_IMPERSONATION;
  const prevEnv   = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionCounter = 0;
    process.env.ALLOW_IMPERSONATION = 'true';
    mockSchoolDoc = {
      id: 'sch_trinitas', slug: 'trinitas-tis', name: 'Trinitas International SChool',
      plan: 'family', logoUrl: null, primaryColor: '#4f46e5', moduleConfig: { library: true },
    };
    mockAdminDoc = {
      id: 'usr_admin1', name: 'Head Teacher', role: 'superadmin', email: 'admin@trinitas-tis.example', schoolId: 'sch_trinitas',
    };
  });
  afterAll(() => {
    process.env.ALLOW_IMPERSONATION = prevAllow;
    process.env.NODE_ENV = prevEnv;
  });

  test('response includes the full school doc, not just token/user', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support investigation — ticket #123' });
    expect(res.status).toBe(200);
    expect(res.body.school).toBeDefined();
    expect(res.body.school.plan).toBe('family');
    expect(res.body.school.id).toBe('sch_trinitas');
  });

  test('builds the token via auth.js\'s _buildTokenPayload, not a hand-rolled payload', async () => {
    await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support investigation — ticket #123' });
    expect(mockBuildTokenPayload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'usr_admin1' }),
      'sch_trinitas',
    );
  });

  test('multi-school org (orgId + identityId present) → availableSchools included in response', async () => {
    mockAdminDoc = { ...mockAdminDoc, orgId: 'org_trinity_group', identityId: 'idn_1' };
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support investigation — ticket #123' });
    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toEqual([{ id: 'sch_other_campus', name: 'Other Campus' }]);
  });

  test('single-school org (no orgId) → availableSchools omitted, not an empty-array footgun', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support investigation — ticket #123' });
    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toBeUndefined();
  });

  test('response includes moduleRegistry, matching every other session-establishing response', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support investigation — ticket #123' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.moduleRegistry)).toBe(true);
    expect(res.body.moduleRegistry.length).toBeGreaterThan(0);
    expect(res.body.moduleRegistry[0]).toHaveProperty('key');
  });

  test('still 403s in production without ALLOW_IMPERSONATION', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_IMPERSONATION = '';
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support investigation — ticket #123' });
    expect(res.status).toBe(403);
    process.env.NODE_ENV = 'test';
  });

  /* ── Security Baseline Register, PLAT-02 / PLAT-03 ──────────── */
  describe('reason requirement and impersonation audit trail (PLAT-02 / PLAT-03)', () => {
    test('no reason in the body → 400, no impersonation granted', async () => {
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reason/i);
      expect(mockBuildTokenPayload).not.toHaveBeenCalled();
    });

    test('a blank/whitespace-only reason is also rejected', async () => {
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: '   ' });
      expect(res.status).toBe(400);
      expect(mockBuildTokenPayload).not.toHaveBeenCalled();
    });

    test('a real reason is granted, and the SAME reason is recorded on the platform.impersonate audit entry', async () => {
      const AuditService = require('../../services/audit');
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate')
        .send({ reason: 'Investigating a support ticket re: fee balance discrepancy' });
      expect(res.status).toBe(200);
      expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'platform.impersonate',
        details: expect.objectContaining({ reason: 'Investigating a support ticket re: fee balance discrepancy' }),
      }));
    });

    test('the issued token carries impersonated:true and a fresh impersonationId', async () => {
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support case #42' });
      expect(res.status).toBe(200);
      // the mocked sign() returns 'signed:' + JSON.stringify(payload) — inspect what was about to be signed
      const signedPayload = JSON.parse(res.body.token.replace(/^signed:/, ''));
      expect(signedPayload.impersonated).toBe(true);
      expect(typeof signedPayload.impersonationId).toBe('string');
      expect(signedPayload.impersonationId.length).toBeGreaterThan(10);
    });

    test('the same impersonationId that was put on the token is also on the platform.impersonate audit entry — the correlation this fix depends on', async () => {
      const AuditService = require('../../services/audit');
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Support case #43' });
      const signedPayload = JSON.parse(res.body.token.replace(/^signed:/, ''));
      const loggedCall = AuditService.log.mock.calls.find(([c]) => c.action === 'platform.impersonate');
      expect(loggedCall[0].details.impersonationId).toBe(signedPayload.impersonationId);
    });

    test('two separate impersonation grants get two DIFFERENT impersonationIds', async () => {
      const res1 = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'First grant' });
      const res2 = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Second grant' });
      const id1 = JSON.parse(res1.body.token.replace(/^signed:/, '')).impersonationId;
      const id2 = JSON.parse(res2.body.token.replace(/^signed:/, '')).impersonationId;
      expect(id1).not.toBe(id2);
    });
  });

  /* ── PLAT-01 remediation — tracked session, shorter lifetime, notification ── */
  describe('tracked session + notification (PLAT-01)', () => {
    test('creates a real tracked session via SessionService, not a bare uuid', async () => {
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Ticket #99' });
      expect(res.status).toBe(200);
      expect(mockCreateImpersonationSession).toHaveBeenCalledWith(
        'usr_admin1', 'sch_trinitas', 'superadmin',
        expect.anything(), expect.anything(),
        expect.objectContaining({
          reason: 'Ticket #99',
          timeoutMs: expect.any(Number),
          impersonatedBy: expect.objectContaining({ tier: 'owner' }),
        }),
      );
    });

    test('sessionId doubles as impersonationId — no second, disconnected id', async () => {
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Ticket #100' });
      const signedPayload = JSON.parse(res.body.token.replace(/^signed:/, ''));
      expect(signedPayload.impersonationId).toBe(signedPayload.sessionId);
      expect(res.body.impersonationId).toBe(signedPayload.sessionId);
    });

    test('response includes expiresAt, matching the session\'s own shorter lifetime', async () => {
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Ticket #101' });
      expect(res.body.expiresAt).toBe('2026-01-01T01:00:00.000Z');
    });

    test('the impersonated admin is notified — both in-app and email, via the existing dispatch mechanism, not a parallel one', async () => {
      const { dispatchNotification } = require('../../utils/notify-dispatch');
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Ticket #102' });
      expect(res.status).toBe(200);
      expect(dispatchNotification).toHaveBeenCalledWith(expect.objectContaining({
        schoolId: 'sch_trinitas',
        eventKey: 'platform_impersonation',
        recipients: [expect.objectContaining({ userId: 'usr_admin1', email: 'admin@trinitas-tis.example' })],
      }));
    });

    test('a notification dispatch failure does not block the response — access is already granted, must not be undone by a side effect failing', async () => {
      const { dispatchNotification } = require('../../utils/notify-dispatch');
      dispatchNotification.mockRejectedValueOnce(new Error('email service down'));
      const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate').send({ reason: 'Ticket #103' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });
  });
});
