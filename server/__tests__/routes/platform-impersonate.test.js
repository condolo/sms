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

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn((p) => 'signed:' + JSON.stringify(p)) }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({
  provisionOrganizationForSchool: jest.fn(),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

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
    process.env.ALLOW_IMPERSONATION = 'true';
    mockSchoolDoc = {
      id: 'sch_trinitas', slug: 'trinitas-tis', name: 'Trinitas International SChool',
      plan: 'family', logoUrl: null, primaryColor: '#4f46e5', moduleConfig: { library: true },
    };
    mockAdminDoc = {
      id: 'usr_admin1', role: 'superadmin', email: 'admin@trinitas-tis.example', schoolId: 'sch_trinitas',
    };
  });
  afterAll(() => {
    process.env.ALLOW_IMPERSONATION = prevAllow;
    process.env.NODE_ENV = prevEnv;
  });

  test('response includes the full school doc, not just token/user', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate');
    expect(res.status).toBe(200);
    expect(res.body.school).toBeDefined();
    expect(res.body.school.plan).toBe('family');
    expect(res.body.school.id).toBe('sch_trinitas');
  });

  test('builds the token via auth.js\'s _buildTokenPayload, not a hand-rolled payload', async () => {
    await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate');
    expect(mockBuildTokenPayload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'usr_admin1' }),
      'sch_trinitas',
    );
  });

  test('multi-school org (orgId + identityId present) → availableSchools included in response', async () => {
    mockAdminDoc = { ...mockAdminDoc, orgId: 'org_trinity_group', identityId: 'idn_1' };
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate');
    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toEqual([{ id: 'sch_other_campus', name: 'Other Campus' }]);
  });

  test('single-school org (no orgId) → availableSchools omitted, not an empty-array footgun', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate');
    expect(res.status).toBe(200);
    expect(res.body.availableSchools).toBeUndefined();
  });

  test('still 403s in production without ALLOW_IMPERSONATION', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_IMPERSONATION = '';
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate');
    expect(res.status).toBe(403);
    process.env.NODE_ENV = 'test';
  });
});
