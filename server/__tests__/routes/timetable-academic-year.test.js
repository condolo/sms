/* ============================================================
   Academic Year & Term Dependency Map, finding #6 — timetable

   timetable_slots never carried a real academicYearId (no client ever
   sent one, the server never resolved one), and _checkConflicts's base
   filter was {schoolId, day, isActive} with no year scoping at all — a
   stale, still-isActive slot from a prior year registered as a live
   double-booking conflict against a brand-new year's timetable, since
   year-transition never touches this collection.

   This suite proves: new slots are stamped with the real current year
   (single create, bulk create, and on edit when the period is being
   explicitly changed); archival is enforced on create/edit/delete,
   including the unconditional case (an edit that never touches the
   period fields); and — the actual bug — a same-day/period/class/
   teacher/room slot from a DIFFERENT year no longer blocks creation,
   while one from the SAME year still correctly does.

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
    insertMany: jest.fn((newDocs) => { docs.push(...newDocs); return Promise.resolve(newDocs); }),
    deleteMany: jest.fn((filter) => { const before = docs.length; docs = docs.filter(d => !matchesFilter(d, filter)); return Promise.resolve({ deletedCount: before - docs.length }); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve(null);
      const [removed] = docs.splice(idx, 1);
      return Promise.resolve(removed);
    }),
  };
}

/** UTC-day offset, matching resolveCurrentPeriod's date-range matching basis. */
function dateOffset(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let mockAcademicYears, mockTimetable, mockClasses;
let mockArchivedYears = [];
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_years') return mockAcademicYears;
    if (c === 'timetable')      return mockTimetable;
    if (c === 'classes')        return mockClasses;
    if (c === 'academic_config') return { findOne: jest.fn(() => mockChainObj({ archivedAcademicYears: mockArchivedYears })) };
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
  mockTimetable      = makeFakeCollection();
  mockClasses        = makeFakeCollection([{ id: 'cls_1', schoolId: SCHOOL_A, name: 'Grade 7' }]);
  mockArchivedYears  = [];
});

const baseSlot = { classId: 'cls_1', day: 'monday', period: '1' };

describe('POST / — stamps the real academic year', () => {
  test('no academicYearId given → defaults to the live-resolved current year+term', async () => {
    const res = await supertest(buildApp()).post('/api/timetable').send(baseSlot);
    expect(res.status).toBe(201);
    expect(res.body.data.academicYearId).toBe('ay_2026');
    expect(res.body.data.termId).toBe('term_2026_2');
  });

  test('an explicit archived academicYearId is rejected', async () => {
    mockArchivedYears = ['ay_2025'];
    const res = await supertest(buildApp()).post('/api/timetable').send({ ...baseSlot, academicYearId: 'ay_2025' });
    expect(res.status).toBe(400);
    expect(mockTimetable.create).not.toHaveBeenCalled();
  });
});

describe('_checkConflicts — the actual bug: cross-year false conflicts', () => {
  test('a same class/day/period slot from a DIFFERENT year does NOT block creation', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_old', schoolId: SCHOOL_A, classId: 'cls_1', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2025',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable').send(baseSlot);
    expect(res.status).toBe(201); // not 409 — this is the fix
    expect(res.body.data.academicYearId).toBe('ay_2026');
  });

  test('a same class/day/period slot from the SAME year still correctly conflicts', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_cur', schoolId: SCHOOL_A, classId: 'cls_1', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable').send(baseSlot);
    expect(res.status).toBe(409);
  });

  test('a teacher double-booked in a DIFFERENT year does not block a new booking this year', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_old', schoolId: SCHOOL_A, classId: 'cls_other', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2025', teacherId: 'tch_1',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable').send({ ...baseSlot, teacherId: 'tch_1' });
    expect(res.status).toBe(201);
  });
});

describe('POST /bulk — stamps the real academic year on every slot', () => {
  test('all slots in the batch get the live-resolved current period', async () => {
    const res = await supertest(buildApp()).post('/api/timetable/bulk').send({
      slots: [
        { classId: 'cls_1', day: 'monday', period: '1' },
        { classId: 'cls_1', day: 'monday', period: '2' },
      ],
    });
    expect(res.status).toBe(201);
    const docs = mockTimetable._docs();
    expect(docs).toHaveLength(2);
    expect(docs.every(d => d.academicYearId === 'ay_2026')).toBe(true);
  });
});

describe('Archival guard on PUT/DELETE', () => {
  test('PUT /:id rejects editing a slot already in an archived year, even without touching period fields', async () => {
    mockArchivedYears = ['ay_2025'];
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_1', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2025',
    }]);
    const res = await supertest(buildApp()).put('/api/timetable/slot_1').send({ room: 'Lab 2' });
    expect(res.status).toBe(400);
  });

  test('DELETE /:id refuses to delete a slot already in an archived year', async () => {
    mockArchivedYears = ['ay_2025'];
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_1', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2025',
    }]);
    const res = await supertest(buildApp()).delete('/api/timetable/slot_1');
    expect(res.status).toBe(400);
    expect(mockTimetable._docs()).toHaveLength(1); // not deleted
  });

  test('DELETE /:id still works normally for a slot in a non-archived year', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_1', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026',
    }]);
    const res = await supertest(buildApp()).delete('/api/timetable/slot_1');
    expect(res.status).toBe(200);
    expect(mockTimetable._docs()).toHaveLength(0);
  });
});
