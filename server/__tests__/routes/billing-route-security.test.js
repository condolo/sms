/* ============================================================
   server/routes/billing.js — regression coverage for a real, verified
   cross-tenant vulnerability.

   GET /api/billing/all used to be gated only on req.jwtUser.role ===
   'superadmin' — an ordinary per-school session-JWT role that every
   school's own onboarding-created owner account holds by default
   (server/routes/onboard.js seeds every new school's admin with
   role:'superadmin'). Any school's own admin, logged in normally, could
   call this route and receive every OTHER school's billing snapshots.

   The correct, actively-used platform-wide equivalent already lived at
   GET /api/platform/billing/all (server/routes/platform.js), gated on
   platformSession — the real platform-admin credential, separate from
   the school JWT. Nothing in the client or platform.html ever called
   this file's /all route (confirmed by repo-wide grep before removal),
   so it was removed here rather than re-gated, closing the vulnerability
   without leaving a second, duplicate implementation that can drift
   again later.

   This test pins two things:
   1. The vulnerable route is genuinely gone (404, not just re-gated).
   2. The legitimate, school-scoped routes it shares a file with
      (/current, /history, /generate) still work for an admin.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockJwtUser = { userId: 'usr_admin', schoolId: 'sch_a', role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

function mockChain(result) {
  return { sort: () => mockChain(result), select: () => mockChain(result), lean: () => Promise.resolve(result) };
}
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ findOne: () => mockChain(null), find: () => mockChain([]) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ findOne: () => mockChain(null), find: () => mockChain([]), create: jest.fn() })),
  tenantContext: (req) => ({ schoolId: req.jwtUser?.schoolId }),
}));

const express   = require('express');
const supertest = require('supertest');
const billingRouter = require('../../routes/billing');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', billingRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: 'sch_a', role: 'admin', roles: ['admin'] };
});

describe('C-2: the cross-tenant GET /all route no longer exists in this file', () => {
  test('GET /api/billing/all is gone (404), not just re-gated to a different check', async () => {
    // Even a school's own superadmin — the exact role that could exploit the
    // original bug — must not reach a live cross-tenant handler here anymore.
    mockJwtUser = { userId: 'usr_super', schoolId: 'sch_a', role: 'superadmin', roles: ['superadmin'] };
    const res = await supertest(buildApp()).get('/api/billing/all');
    expect(res.status).toBe(404);
  });
});

describe('legitimate school-scoped routes in the same file are unaffected', () => {
  test('GET /api/billing/current still works for an admin', async () => {
    const res = await supertest(buildApp()).get('/api/billing/current');
    expect(res.status).toBe(200);
  });

  test('GET /api/billing/history still works for an admin', async () => {
    const res = await supertest(buildApp()).get('/api/billing/history');
    expect(res.status).toBe(200);
  });

  test('GET /api/billing/current still rejects a non-admin role', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: 'sch_a', role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/billing/current');
    expect(res.status).toBe(403);
  });
});
