/* ============================================================
   GET /api/audit/stats — the KPI row behind Settings → Audit Log.

   Two things are proven here:

   1. The route is school-scoped exactly like GET /api/audit: a caller
      only ever sees their own school's counters, and a schoolId query
      param cannot widen it. The date window is passed straight
      through so the cards agree with the filter bar above them.

   2. The free-text search (?q=) reaches AuditService.query().

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockJwtUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = mockJwtUser;
    next();
  },
}));

const mockQuery = jest.fn().mockResolvedValue({ docs: [], total: 0 });
const mockStats = jest.fn().mockResolvedValue({
  total: 0, bySeverity: { info: 0, warn: 0, critical: 0 },
  uniqueActors: 0, last24h: 0, topActions: [], topAction: null,
});
jest.mock('../../services/audit', () => ({
  query: (...args) => mockQuery(...args),
  stats: (...args) => mockStats(...args),
  ACTIONS: {},
}));

const express   = require('express');
const supertest = require('supertest');
const auditRouter = require('../../routes/audit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/audit', auditRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', role: 'admin', schoolId: 'sch_a' };
  mockStats.mockResolvedValue({
    total: 42, bySeverity: { info: 40, warn: 2, critical: 0 },
    uniqueActors: 7, last24h: 12,
    topActions: [{ action: 'auth.login', count: 40 }],
    topAction: { action: 'auth.login', count: 40 },
  });
});

describe('GET /api/audit/stats', () => {
  test('returns the aggregate counters the KPI row renders', async () => {
    const res = await supertest(buildApp()).get('/api/audit/stats');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(42);
    expect(res.body.data.bySeverity.warn).toBe(2);
    expect(res.body.data.uniqueActors).toBe(7);
    expect(res.body.data.topAction.action).toBe('auth.login');
  });

  test("is locked to the caller's own school — a schoolId param cannot widen it", async () => {
    mockJwtUser = { userId: 'usr_admin', role: 'admin', schoolId: 'sch_a' };

    await supertest(buildApp()).get('/api/audit/stats').query({ schoolId: 'sch_other' });

    expect(mockStats).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'sch_a' }));
  });

  test('passes the date window through so the cards match the filters', async () => {
    await supertest(buildApp())
      .get('/api/audit/stats')
      .query({ from: '2026-10-14', to: '2026-10-20' });

    expect(mockStats).toHaveBeenCalledWith(expect.objectContaining({
      from: '2026-10-14',
      to:   '2026-10-20',
    }));
  });

  test('is admin-only — a non-admin gets 403', async () => {
    mockJwtUser = { userId: 'usr_teacher', role: 'teacher', schoolId: 'sch_a' };

    const res = await supertest(buildApp()).get('/api/audit/stats');

    expect(res.status).toBe(403);
    expect(mockStats).not.toHaveBeenCalled();
  });
});

describe('GET /api/audit — free-text search', () => {
  test('passes ?q through to the service so action/actor/target can be searched', async () => {
    await supertest(buildApp()).get('/api/audit').query({ q: 'teacher@demo' });

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ q: 'teacher@demo' }));
  });

  test('omits ?q when it is not supplied', async () => {
    await supertest(buildApp()).get('/api/audit');

    expect(mockQuery.mock.calls[0][0].q).toBeUndefined();
  });
});
