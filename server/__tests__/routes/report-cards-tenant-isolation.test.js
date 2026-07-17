/* ============================================================
   Cross-tenant isolation regression — server/routes/report-cards.js
   (C4 · ADR-0001 §5)

   The most complex tenant route: transactions, cross-collection reads,
   three schoolId-only helpers, AND a PUBLIC verify endpoint that is an
   INTENTIONAL cross-tenant lookup (ADR-0001 §4 exception). This test's
   most important job is proving that exception is preserved — verify
   must still query by globally-unique reportId with NO schoolId (it
   would 500 if wrongly routed through tenantModel) — while the
   authenticated handlers are scoped to the active school.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

const seen = { snapFind: [], snapCount: [], snapFindOne: [] };

function mockChain(result) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(result) };
  return c;
}

const mockSnapshots = {
  find:           jest.fn((f) => { seen.snapFind.push(f); return mockChain([]); }),
  countDocuments: jest.fn((f) => { seen.snapCount.push(f); return Promise.resolve(0); }),
  findOne:        jest.fn((f) => { seen.snapFindOne.push(f); return mockChain(null); }),
};

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'report_card_snapshots') return mockSnapshots;
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(seen)) seen[k] = []; });

describe('report-cards — cross-tenant isolation (authenticated as School A)', () => {
  test('GET / scopes the snapshot list find + count to School A', async () => {
    await supertest(buildApp()).get('/api/report-cards');
    expect(seen.snapFind[0].schoolId).toBe(SCHOOL_A);
    expect(seen.snapCount[0].schoolId).toBe(SCHOOL_A);
  });

  test('GET /:id can only match a snapshot within School A', async () => {
    await supertest(buildApp()).get('/api/report-cards/snap_belonging_to_B');
    expect(seen.snapFindOne[0].schoolId).toBe(SCHOOL_A);
    expect(seen.snapFindOne[0].id).toBe('snap_belonging_to_B');
  });

  test('GET /verify/:reportId is the preserved public cross-tenant exception — queries by reportId with NO schoolId', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/verify/RC-2026-2-000001');
    // 404 because the mock returns null — the point is HOW it queried:
    expect(res.status).toBe(404);
    expect(seen.snapFindOne).toHaveLength(1);
    expect(seen.snapFindOne[0]).toEqual({ reportId: 'RC-2026-2-000001' });
    // critically: NO schoolId was injected — the exception is intact
    expect(seen.snapFindOne[0].schoolId).toBeUndefined();
  });
});
