/* ============================================================
   server/routes/timetable.js — optional assistantTeacherId/
   assistantTeacherName on a slot (2026-09)

   Prompted directly: confirming the subject→teacher auto-fill workflow
   (already existed, see AddSlotSlideOver.jsx's teaching_assignments
   lookup) and asked to also allow an assistant teacher to be recorded
   on a slot. Scoped, on request, as display/scheduling only — NOT part
   of conflict detection (_checkConflicts only ever reads teacherId) and
   grants no attendance/grading access (that stays governed entirely by
   teaching_assignments, unchanged).

   This suite proves: the field round-trips through create and update,
   a slot with no assistant teacher is unaffected, and — the one
   deliberate non-behavior — an assistant teacher busy elsewhere at the
   same time does NOT block creation (conflict detection stays
   teacherId-only, by design).

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

const express         = require('express');
const supertest       = require('supertest');
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
  mockTimetable      = makeFakeCollection();
  mockClasses        = makeFakeCollection([{ id: 'cls_1', schoolId: SCHOOL_A, name: 'Year 1' }]);
});

const baseSlot = { classId: 'cls_1', streamId: 'strm_1a', day: 'monday', period: '1', teacherId: 'tch_primary' };

describe('POST / — assistantTeacherId/assistantTeacherName', () => {
  test('round-trips through create when provided', async () => {
    const res = await supertest(buildApp()).post('/api/timetable').send({
      ...baseSlot,
      assistantTeacherId: 'tch_assistant',
      assistantTeacherName: 'Jane Doe',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.assistantTeacherId).toBe('tch_assistant');
    expect(res.body.data.assistantTeacherName).toBe('Jane Doe');
  });

  test('a slot with no assistant teacher is created exactly as before — field is simply absent', async () => {
    const res = await supertest(buildApp()).post('/api/timetable').send(baseSlot);
    expect(res.status).toBe(201);
    expect(res.body.data.assistantTeacherId).toBeUndefined();
  });

  test('an assistant teacher already booked elsewhere at the same time does NOT block creation — conflict detection is deliberately teacherId-only', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_other', schoolId: SCHOOL_A, classId: 'cls_other', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026', teacherId: 'tch_assistant',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable').send({
      ...baseSlot,
      assistantTeacherId: 'tch_assistant',
    });
    expect(res.status).toBe(201); // not 409 — assistant teacher isn't checked for double-booking, by design
  });
});

describe('PUT /:id — assistantTeacherId/assistantTeacherName', () => {
  test('can be added to an existing slot that had none', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_1', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026', teacherId: 'tch_primary',
    }]);
    const res = await supertest(buildApp()).put('/api/timetable/slot_1').send({
      assistantTeacherId: 'tch_assistant',
      assistantTeacherName: 'Jane Doe',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.assistantTeacherId).toBe('tch_assistant');
  });
});
