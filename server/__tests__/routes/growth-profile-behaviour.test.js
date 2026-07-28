/* ============================================================
   GET /api/growth-profile/:studentId/behaviour — the permanent,
   never-reset behaviour record, grouped by academic year.

   Confirms this is genuinely different from Behaviour's own
   /incidents/summary: no points-reset window applied here — a
   student's Year 1 totals stay visible in Growth Profile forever,
   even after Behaviour's own running total has been reset to zero
   for Year 2.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}

const mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockStudents, mockIncidents, mockAcademicYears;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'students')            return mockStudents;
    if (c === 'behaviour_incidents') return mockIncidents;
    if (c === 'academic_years')      return mockAcademicYears;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const growthProfileRouter = require('../../routes/growth-profile');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-profile', growthProfileRouter);
  return app;
}

function makeIncidentsAggregate(docs) {
  return {
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    aggregate: jest.fn((pipeline) => {
      const match = pipeline.find(s => s.$match)?.$match ?? {};
      const filtered = docs.filter(d => matchesFilter(d, match));
      const byYear = {};
      for (const d of filtered) {
        const key = d.academicYearId ?? null;
        byYear[key] ??= { _id: key, merits: 0, demerits: 0, points: 0, total: 0, firstDate: d.date, lastDate: d.date };
        const g = byYear[key];
        if (d.type === 'merit')   g.merits++;
        if (d.type === 'demerit') g.demerits++;
        g.points += d.points || 0;
        g.total  += 1;
        if (d.date < g.firstDate) g.firstDate = d.date;
        if (d.date > g.lastDate)  g.lastDate  = d.date;
      }
      return Promise.resolve(Object.values(byYear));
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudents = { findOne: jest.fn(() => mockChainObj({ id: 'stu_1', schoolId: SCHOOL_A, firstName: 'A', lastName: 'One' })) };
  mockAcademicYears = { find: jest.fn(() => mockChainArr([
    { id: 'ay_2025', schoolId: SCHOOL_A, name: '2025' },
    { id: 'ay_2026', schoolId: SCHOOL_A, name: '2026' },
  ])) };
});

test('groups all-time incidents by academic year with resolved year names', async () => {
  mockIncidents = makeIncidentsAggregate([
    { schoolId: SCHOOL_A, studentId: 'stu_1', academicYearId: 'ay_2025', type: 'demerit', points: -2, date: '2025-03-01' },
    { schoolId: SCHOOL_A, studentId: 'stu_1', academicYearId: 'ay_2025', type: 'merit',   points: 3,  date: '2025-06-01' },
    { schoolId: SCHOOL_A, studentId: 'stu_1', academicYearId: 'ay_2026', type: 'merit',   points: 2,  date: '2026-02-01' },
  ]);

  const res = await supertest(buildApp()).get('/api/growth-profile/stu_1/behaviour');
  expect(res.status).toBe(200);

  const y2025 = res.body.data.history.find(h => h.academicYearId === 'ay_2025');
  const y2026 = res.body.data.history.find(h => h.academicYearId === 'ay_2026');
  expect(y2025.academicYearName).toBe('2025');
  expect(y2025.points).toBe(1); // -2 + 3
  expect(y2025.total).toBe(2);
  expect(y2026.points).toBe(2);
  expect(res.body.data.allTime.total).toBe(3);
});

test('a Year 1 record stays visible here even though it would be invisible to Behaviour\'s own reset-windowed summary', async () => {
  // Simulates: Year 1 incidents happened, a points-reset then fired for Year 2 —
  // Behaviour's /incidents/summary would floor at the reset date and show
  // nothing for Year 1, but this route applies no such window at all.
  mockIncidents = makeIncidentsAggregate([
    { schoolId: SCHOOL_A, studentId: 'stu_1', academicYearId: 'ay_2025', type: 'demerit', points: -5, date: '2025-01-15' },
  ]);
  const res = await supertest(buildApp()).get('/api/growth-profile/stu_1/behaviour');
  expect(res.status).toBe(200);
  expect(res.body.data.history).toHaveLength(1);
  expect(res.body.data.history[0].points).toBe(-5);
});

test('incidents with no academicYearId (legacy data) group under "Unassigned", not dropped', async () => {
  mockIncidents = makeIncidentsAggregate([
    { schoolId: SCHOOL_A, studentId: 'stu_1', academicYearId: null, type: 'merit', points: 1, date: '2024-01-01' },
  ]);
  const res = await supertest(buildApp()).get('/api/growth-profile/stu_1/behaviour');
  expect(res.status).toBe(200);
  expect(res.body.data.history[0].academicYearName).toBe('Unassigned');
});

test('404s for a student that does not exist at this school', async () => {
  mockStudents = { findOne: jest.fn(() => mockChainObj(null)) };
  mockIncidents = makeIncidentsAggregate([]);
  const res = await supertest(buildApp()).get('/api/growth-profile/stu_missing/behaviour');
  expect(res.status).toBe(404);
});
