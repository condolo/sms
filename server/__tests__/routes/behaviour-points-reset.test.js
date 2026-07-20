/* ============================================================
   server/routes/behaviour.js — manual points reset (Governance
   Spec §2). A reset never touches behaviour_incidents history — it
   writes a behaviour_points_resets doc, and /incidents/summary's
   aggregation floors its date range at the most recent reset.
   ============================================================ */

function chain(result, extra = {}) {
  return { select: () => chain(result, extra), sort: () => chain(result, extra), limit: () => chain(result, extra), lean: () => Promise.resolve(result), ...extra };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$gte' in v) return doc[k] >= v.$gte;
      if (v && typeof v === 'object' && '$lte' in v) return doc[k] <= v.$lte;
      return doc[k] === v;
    });
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter)).sort((a, b) => (a.resetAt < b.resetAt ? 1 : -1))),
    create:  async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    aggregate: async (pipeline) => {
      // Merge every leading $match stage (the real tenantModel wrapper
      // prepends its own {$match:{schoolId}} ahead of the route's own
      // $match, mirroring real MongoDB's sequential stage processing).
      const match = Object.assign({}, ...pipeline.filter(s => s.$match).map(s => s.$match));
      const filtered = docs.filter(d => matches(d, match));
      const byStudent = {};
      for (const d of filtered) {
        byStudent[d.studentId] ??= { _id: d.studentId, points: 0, total: 0 };
        byStudent[d.studentId].points += d.points || 0;
        byStudent[d.studentId].total += 1;
      }
      return Object.values(byStudent);
    },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const express   = require('express');
const supertest = require('supertest');
const router    = require('../../routes/behaviour');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviour', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
  mockStores = {
    behaviour_incidents: makeStore([
      { id: 'bi_1', schoolId: SCHOOL, studentId: 'stu_1', type: 'demerit', points: -5, date: '2026-01-10' },
      { id: 'bi_2', schoolId: SCHOOL, studentId: 'stu_1', type: 'merit',   points: 3,  date: '2026-06-15' },
    ]),
    behaviour_points_resets: makeStore([]),
  };
});

test('before any reset, the summary reflects the full incident history', async () => {
  const app = buildApp();
  const res = await supertest(app).get('/api/behaviour/incidents/summary');
  expect(res.body.data.find(s => s._id === 'stu_1').points).toBe(-2); // -5 + 3
});

test('POST /points-reset writes a reset doc without touching incident history', async () => {
  const app = buildApp();
  const res = await supertest(app).post('/api/behaviour/points-reset').send({ note: 'new academic year' });
  expect(res.status).toBe(201);
  expect(mockStores.behaviour_points_resets._docs()).toHaveLength(1);
  expect(mockStores.behaviour_incidents._docs()).toHaveLength(2); // untouched
  expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'behaviour.points_reset' }));
});

test('after a reset, the summary only counts incidents from the reset date forward', async () => {
  const app = buildApp();
  // Reset dated after bi_1 (Jan) but before bi_2 (June) — only bi_2 should count afterwards.
  await mockStores.behaviour_points_resets.create({ id: 'r_1', schoolId: SCHOOL, resetAt: '2026-03-01T00:00:00.000Z', resetBy: 'u_admin' });

  const res = await supertest(app).get('/api/behaviour/incidents/summary');
  const stu1 = res.body.data.find(s => s._id === 'stu_1');
  expect(stu1.points).toBe(3);  // only the June merit counts
  expect(stu1.total).toBe(1);
});

test('an explicit dateFrom query still overrides the reset floor', async () => {
  const app = buildApp();
  await mockStores.behaviour_points_resets.create({ id: 'r_1', schoolId: SCHOOL, resetAt: '2026-03-01T00:00:00.000Z', resetBy: 'u_admin' });

  const res = await supertest(app).get('/api/behaviour/incidents/summary').query({ dateFrom: '2026-01-01' });
  const stu1 = res.body.data.find(s => s._id === 'stu_1');
  expect(stu1.points).toBe(-2); // both incidents counted — explicit range wins
});
