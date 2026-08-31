/* ============================================================
   server/routes/timetable.js — stream-aware conflict detection

   _checkConflicts' class-collision check used to key purely on
   {classId, day, period} — so two different streams of the same class
   (e.g. 7i and 7ii, each with a different Maths teacher, per the
   compulsory-subject stream rule in teaching-assignments.js) could
   never have simultaneous lessons: the second slot always looked like
   "this class already has a lesson at this time", even though they're
   two independent groups of students. This proves the fix: different
   streams don't conflict, the same stream still does, and a
   whole-class slot (no streamId) still conflicts with anything since
   it covers every stream by definition.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../routes/bell-schedule', () => ({
  resolveBellSchedule: jest.fn().mockResolvedValue({ periods: [] }),
}));

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
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
    }
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
  };
}

let mockAcademicYears, mockTimetable, mockClasses;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_years') return mockAcademicYears;
    if (c === 'timetable')      return mockTimetable;
    if (c === 'classes')        return mockClasses;
    if (c === 'academic_config') return { findOne: jest.fn(() => mockChainObj({ archivedAcademicYears: [] })) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express       = require('express');
const supertest     = require('supertest');
const timetableRouter = require('../../routes/timetable');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetableRouter);
  return app;
}

function dateOffset(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const CURRENT_YEAR = {
  id: 'ay_2026', schoolId: SCHOOL_A, name: '2026', isCurrent: true,
  startDate: dateOffset(-100), endDate: dateOffset(100),
  terms: [{ id: 'term_2026_2', name: 'Term 2', startDate: dateOffset(-10), endDate: dateOffset(60) }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAcademicYears = makeFakeCollection([CURRENT_YEAR]);
  mockClasses        = makeFakeCollection([{ id: 'cls_yr7', schoolId: SCHOOL_A, name: 'Year 7' }]);
});

const EXISTING_7I = {
  id: 'slot_7i', schoolId: SCHOOL_A, classId: 'cls_yr7', streamId: 'strm_7i',
  day: 'monday', period: '1', isActive: true, academicYearId: 'ay_2026', teacherId: 'tch_a',
};

describe('POST /api/timetable — stream-aware class-slot conflict', () => {
  test('a DIFFERENT stream of the same class, same day/period, does NOT conflict', async () => {
    mockTimetable = makeFakeCollection([EXISTING_7I]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', streamId: 'strm_7ii', day: 'monday', period: '1', teacherId: 'tch_b' });
    expect(res.status).toBe(201); // not 409 — this is the fix
    expect(res.body.data.streamId).toBe('strm_7ii');
  });

  test('the SAME stream, same day/period, still correctly conflicts', async () => {
    mockTimetable = makeFakeCollection([EXISTING_7I]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', streamId: 'strm_7i', day: 'monday', period: '1', teacherId: 'tch_c' });
    expect(res.status).toBe(409);
  });

  test('a new WHOLE-CLASS slot (no streamId) still conflicts with an existing stream-specific slot — it covers every stream', async () => {
    mockTimetable = makeFakeCollection([EXISTING_7I]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'monday', period: '1', teacherId: 'tch_d' }); // no streamId
    expect(res.status).toBe(409);
  });

  test('a new stream-specific slot conflicts with an EXISTING whole-class slot at the same period', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_whole', schoolId: SCHOOL_A, classId: 'cls_yr7', // no streamId — whole class
      day: 'monday', period: '1', isActive: true, academicYearId: 'ay_2026', teacherId: 'tch_a',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', streamId: 'strm_7i', day: 'monday', period: '1', teacherId: 'tch_b' });
    expect(res.status).toBe(409);
  });

  test('a teacher already booked in one stream still cannot be double-booked in the OTHER stream at the same time — teacher check is unaffected by streams', async () => {
    mockTimetable = makeFakeCollection([EXISTING_7I]); // tch_a, 7i, monday period 1
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', streamId: 'strm_7ii', day: 'monday', period: '1', teacherId: 'tch_a' });
    expect(res.status).toBe(409);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/teacher/i);
  });
});
