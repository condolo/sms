/* ============================================================
   GET /api/attendance/summary — school-wide fields.

   ReportsPage.jsx's Attendance tab reads attSummary.avgRate,
   .daysRecorded, .chronicAbsent, and .byClass — none of which this
   route ever computed. It showed "Attendance summary not yet
   available" for every school regardless of real data volume, since
   this was a field-name/shape mismatch, not a data gap. This pins the
   new fields' values and confirms the pre-existing shape (relied on by
   Dashboard.jsx's own widget) is untouched.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'u1', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({
  scopeMiddleware: (req, _res, next) => { req.scope = null; next(); },
}));

let mockFacetResult, mockClasses;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes') {
      const c = { select: () => c, lean: () => Promise.resolve(mockClasses) };
      return { find: () => c };
    }
    if (collection === 'attendance') {
      return { aggregate: () => Promise.resolve(mockFacetResult) };
    }
    return { find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) };
  },
}));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRouter);
  return app;
}

beforeEach(() => {
  mockClasses = [{ id: 'cls_1', name: 'Year 7' }, { id: 'cls_2', name: 'Year 8' }];
  mockFacetResult = [{
    overall: [{ total: 100, present: 90, absent: 8, late: 2, authorised: 0 }],
    byClass: [
      { _id: 'cls_1', total: 60, present: 57 }, // 95%
      { _id: 'cls_2', total: 40, present: 33 }, // 82.5%
    ],
    byStudent: [
      { _id: 'stu_1', total: 10, present: 10 }, // 100% — fine
      { _id: 'stu_2', total: 10, present: 7 },  // 70% — chronic
      { _id: 'stu_3', total: 10, present: 9 },  // 90% — fine
    ],
    days: [{ _id: '2026-09-01' }, { _id: '2026-09-02' }, { _id: '2026-09-03' }],
  }];
});

describe('GET /api/attendance/summary — school-wide, no classId/studentId', () => {
  test('pre-existing fields (Dashboard.jsx dependency) are unchanged', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/summary');
    expect(res.body.data).toMatchObject({ total: 100, present: 90, absent: 8, late: 2, authorised: 0, attendanceRate: 90 });
  });

  test('avgRate is a 0–1 fraction, not a 0–100 percentage', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/summary');
    expect(res.body.data.avgRate).toBeCloseTo(0.9);
  });

  test('daysRecorded counts distinct dates', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/summary');
    expect(res.body.data.daysRecorded).toBe(3);
  });

  test('chronicAbsent counts students below 80% individually, not the school average', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/summary');
    expect(res.body.data.chronicAbsent).toBe(1); // only stu_2 (70%)
  });

  test('byClass is keyed by class NAME with a 0–1 fraction rate, ready for ReportsPage.jsx\'s chart', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/summary');
    expect(res.body.data.byClass['Year 7']).toBeCloseTo(0.95);
    expect(res.body.data.byClass['Year 8']).toBeCloseTo(0.825);
  });

  test('empty school (no attendance data at all) degrades to zeros, not a crash', async () => {
    mockFacetResult = [{ overall: [], byClass: [], byStudent: [], days: [] }];
    const res = await supertest(buildApp()).get('/api/attendance/summary');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 0, present: 0, avgRate: null, daysRecorded: 0, chronicAbsent: 0, byClass: {} });
  });
});
