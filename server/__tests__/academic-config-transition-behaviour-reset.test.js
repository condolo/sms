/* ============================================================
   POST /academic-config/transition-year — auto-resets behaviour
   points (Step D), added alongside the existing exams/report-cards/
   grades archive cascade. Fires the SAME resetBehaviourPoints()
   behaviour.js exports for its own manual "Reset Points" button —
   this only proves the automatic trigger fires it and that a failure
   there never fails the transition itself.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matchesFilter(doc, sub));
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    updateOne:        jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
    updateMany:       jest.fn(() => Promise.resolve({ modifiedCount: 0 })),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
  };
}

const mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../utils/email', () => ({}));

let mockStores;
jest.mock('../utils/model', () => ({
  _model: jest.fn((c) => mockStores[c] ?? { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)), updateOne: jest.fn(() => Promise.resolve({})) }),
}));

const express   = require('express');
const supertest = require('supertest');
const academicConfigRouter = require('../routes/academic-config');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/academic-config', academicConfigRouter);
  return app;
}

const ACTIVE_YEAR = { id: 'ay_2025', schoolId: SCHOOL, name: '2025', isCurrent: true, terms: [] };
const TARGET_YEAR = { id: 'ay_2026', schoolId: SCHOOL, name: '2026', isCurrent: false, terms: [] };

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    academic_years:          makeFakeCollection([ACTIVE_YEAR, TARGET_YEAR]),
    academic_config:         makeFakeCollection([{ schoolId: SCHOOL, archivedAcademicYears: [] }]),
    exams:                   makeFakeCollection([]),
    report_card_snapshots:   makeFakeCollection([]),
    grades:                  makeFakeCollection([]),
    mark_audit_log:          makeFakeCollection([]),
    schools:                 makeFakeCollection([{ id: SCHOOL, name: 'Test School' }]),
    behaviour_points_resets: makeFakeCollection([]),
  };
});

test('transitioning the academic year writes a behaviour_points_resets marker automatically', async () => {
  const res = await supertest(buildApp()).post('/api/academic-config/transition-year').send({ targetYearId: 'ay_2026' });
  expect(res.status).toBe(200);

  const resets = mockStores.behaviour_points_resets._docs();
  expect(resets).toHaveLength(1);
  expect(resets[0].schoolId).toBe(SCHOOL);
  expect(resets[0].resetBy).toBe('u_admin');
  expect(resets[0].note).toMatch(/2026/);
});

test('a failure writing the behaviour reset never fails the year transition itself', async () => {
  mockStores.behaviour_points_resets.create = jest.fn(() => Promise.reject(new Error('boom')));
  const res = await supertest(buildApp()).post('/api/academic-config/transition-year').send({ targetYearId: 'ay_2026' });
  expect(res.status).toBe(200);
  expect(res.body.data.activatedYear.name).toBe('2026');
});
