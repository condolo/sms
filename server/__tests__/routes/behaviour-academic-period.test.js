/* ============================================================
   resolveAcademicPeriod wired into behaviour.js incidents

   Mirrors finance-academic-period.test.js — same shared helper
   (server/utils/academic-period.js), now reused by a second module.
   Confirms incidents resolve/validate academicYearId/termId the same
   way invoices and fee structures do, and that PUT only touches the
   period when the caller actually sends those fields.

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
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
  };
}

/** UTC-day offset, matching resolveCurrentPeriod's date-range matching basis. */
function dateOffset(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

let mockAcademicYears, mockIncidents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_years')      return mockAcademicYears;
    if (c === 'behaviour_incidents') return mockIncidents;
    if (c === 'students')            return { findOne: jest.fn(() => mockChainObj(null)) };
    if (c === 'schools')             return { findOne: jest.fn(() => mockChainObj(null)) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const behaviourRouter = require('../../routes/behaviour');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviour', behaviourRouter);
  return app;
}

const CURRENT_YEAR = {
  id: 'ay_2026', schoolId: SCHOOL_A, name: '2026', isCurrent: true,
  startDate: dateOffset(-100), endDate: dateOffset(100),
  terms: [{ id: 'term_2026_2', name: 'Term 2', startDate: dateOffset(-10), endDate: dateOffset(60) }],
};
const OTHER_YEAR = {
  id: 'ay_2025', schoolId: SCHOOL_A, name: '2025', isCurrent: false,
  startDate: '2025-01-01', endDate: '2025-12-15',
  terms: [{ id: 'term_2025_1', name: 'Term 1', startDate: '2025-01-06', endDate: '2025-04-04' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAcademicYears = makeFakeCollection([CURRENT_YEAR, OTHER_YEAR]);
  mockIncidents      = makeFakeCollection([]);
});

test('POST /incidents with no academicYearId/termId defaults to the live-resolved current period', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/incidents').send({
    studentId: 'stu_1', type: 'demerit', title: 'Late', points: -2,
  });
  expect(res.status).toBe(201);
  expect(res.body.data.academicYearId).toBe('ay_2026');
  expect(res.body.data.termId).toBe('term_2026_2');
});

test('POST /incidents honours an explicit valid academicYearId + termId', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/incidents').send({
    studentId: 'stu_1', type: 'merit', title: 'Great work', points: 2,
    academicYearId: 'ay_2025', termId: 'term_2025_1',
  });
  expect(res.status).toBe(201);
  expect(res.body.data.academicYearId).toBe('ay_2025');
  expect(res.body.data.termId).toBe('term_2025_1');
});

test('POST /incidents rejects an unknown academicYearId', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/incidents').send({
    studentId: 'stu_1', type: 'demerit', title: 'Late', points: -2,
    academicYearId: 'not_real',
  });
  expect(res.status).toBe(400);
  expect(mockIncidents.create).not.toHaveBeenCalled();
});

test('PUT /incidents/:id without academicYearId/termId in the body leaves the stored period untouched', async () => {
  mockIncidents = makeFakeCollection([{
    id: 'bi_1', schoolId: SCHOOL_A, studentId: 'stu_1', type: 'demerit', title: 'Late', points: -2,
    academicYearId: 'ay_2025', termId: 'term_2025_1',
  }]);
  const res = await supertest(buildApp()).put('/api/behaviour/incidents/bi_1').send({ note: 'follow-up added' });
  expect(res.status).toBe(200);
  expect(res.body.data.academicYearId).toBe('ay_2025');
  expect(res.body.data.termId).toBe('term_2025_1');
});
