/* ============================================================
   POST /api/platform/schools/:id/impersonate — unit tests with mocked DB.

   Regression coverage for a real bug: the response never included the
   school doc, only `{ token, user }`. platform.html's doImpersonate()
   then wrote a hardcoded `school: {}` into the session it hands the
   client SPA, so every session field the client reads off
   `session.school` (plan, logoUrl, primaryColor, moduleConfig) came back
   undefined for the whole impersonated session — visibly, TopBar's plan
   badge falls through both its nullish-coalescing checks straight to the
   literal 'core' fallback, showing the oldest legacy tier name regardless
   of the school's real plan. Fixed by returning `school` in the response,
   mirroring /api/auth/login's `school: req.school` shape exactly.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn(() => 'signed.jwt.token') }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({
  provisionOrganizationForSchool: jest.fn(),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

const mockSchoolDoc = {
  id: 'sch_trinitas', slug: 'trinitas-tis', name: 'Trinitas International SChool',
  plan: 'family', logoUrl: null, primaryColor: '#4f46e5', moduleConfig: { library: true },
};
const mockAdminDoc = {
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
    process.env.ALLOW_IMPERSONATION = 'true';
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

  test('still 403s in production without ALLOW_IMPERSONATION', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_IMPERSONATION = '';
    const res = await supertest(app()).post('/api/platform/schools/sch_trinitas/impersonate');
    expect(res.status).toBe(403);
    process.env.NODE_ENV = 'test';
  });
});
