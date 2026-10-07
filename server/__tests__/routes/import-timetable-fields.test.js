/* ============================================================
   POST /api/import-export/timetable — three real gaps found while
   confirming whether timetable import actually works end to end

   1. Never resolved/stamped academicYearId/termId — every other write
      path in this module was fixed for this (Academic Year & Term
      Dependency Map, commit e99ec43), and _importStudents already gets
      the identical treatment for the identical reason, but the
      timetable importer was missed. Imported slots were invisible to
      year-scoped conflict detection and archival locking.
   2. No streamName column/resolution at all, and the upsert filter
      keyed only on {classId, day, period} — importing two different
      streams' schedules for the same class/day/period (e.g. 7i and
      7ii's own Maths teachers) as two CSV rows silently overwrote the
      first with the second instead of creating two slots.
   3. _buildTeacherMap's id fallback chain skipped straight from
      userId to the raw Mongo _id, missing the teacher's own `id` in
      between — the same chain AddSlotSlideOver/teaching-
      assignments.js/TimetablePage.jsx's teacherKey() all use. A
      teacher with no linked login account got a teacherId matching
      none of those forms — invisible to Teacher View, Cover/Subs, and
      Emergency Online Mode despite the row "importing successfully".

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}
function matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v === null) return doc[k] === null || doc[k] === undefined;
    return doc[k] === v;
  });
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) ?? null),
    findOneAndUpdate: async (filter, update) => {
      const existing = docs.find(d => matches(d, filter));
      if (existing) {
        Object.assign(existing, update.$set);
        return { lastErrorObject: { updatedExisting: true }, value: existing };
      }
      const created = { ...filter, ...update.$set, ...update.$setOnInsert };
      docs.push(created);
      return { lastErrorObject: { updatedExisting: false }, value: created };
    },
    _docs: () => docs,
  };
}

const SCHOOL = 'school_test_001';

let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((col) => mockStores[col]),
}));
jest.mock('../../utils/counters', () => ({
  reserveAdmissionNumbers: jest.fn(), reserveStaffIds: jest.fn(), reserveInvoiceNumbers: jest.fn(),
}));

let mockCurrentPeriod;
jest.mock('../../utils/academic-period', () => ({
  resolveAcademicPeriod: jest.fn(() => Promise.resolve(mockCurrentPeriod)),
}));

const express   = require('express');
const supertest = require('supertest');
const importExportRouter = require('../../routes/import-export');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));
  app.use('/api/import-export', importExportRouter);
  return app;
}

const AGNES = { id: 'tch_agnes', userId: 'usr_agnes', schoolId: SCHOOL, firstName: 'Agnes', lastName: 'Otieno', status: 'active' };
// No linked login account — this is exactly the case the id-fallback bug hit.
const BRIAN = { id: 'tch_brian', schoolId: SCHOOL, firstName: 'Brian', lastName: 'Kamau', status: 'active' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser  = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockCurrentPeriod = { academicYearId: 'ay_2026', termId: 'term_1' };
  mockStores = {
    // The change mark that makes Publish available (utils/timetable-publish.js).
    schools: { updateOne: jest.fn(() => Promise.resolve({ matchedCount: 1 })) },
    // No saved schedules: the resolver falls back to the built-in periods, which the fixtures use.
    bell_schedules: { find: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) })), findOne: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(null) }), lean: () => Promise.resolve(null) })) },
    timetable: makeStore([]),
    classes:   makeStore([{ id: 'cls_yr7', schoolId: SCHOOL, name: 'Year 7' }]),
    streams:   makeStore([
      { id: 'strm_7i',  schoolId: SCHOOL, classId: 'cls_yr7', name: '7i' },
      { id: 'strm_7ii', schoolId: SCHOOL, classId: 'cls_yr7', name: '7ii' },
    ]),
    teachers:  makeStore([AGNES, BRIAN]),
  };
});

function row(overrides = {}) {
  return { className: 'Year 7', day: 'monday', period: '1', subject: 'Mathematics', ...overrides };
}

// Year 7 runs its own bell schedule, with lessons at 08:15 and 09:20. Period 1 is in it; period 9 is not.
const YEAR7_SCHEDULE = {
  id: 'bs_year7', section: 'all', name: 'Year 7', classIds: ['cls_yr7'],
  periods: [
    { p: '1', start: '08:15', end: '09:10', label: 'Period 1', isBreak: false },
    { p: 'B', start: '09:10', end: '09:20', label: 'Break', isBreak: true },
    { p: '2', start: '09:20', end: '10:15', label: 'Period 2', isBreak: false },
  ],
};
function useSavedSchedule() {
  mockStores.bell_schedules = {
    // resolveBellSchedule's class lookup now matches against BOTH id forms
    // of the class at once ({ classIds: { $in: [...] } }) rather than a
    // single literal value — this mock checks membership the same way.
    findOne: jest.fn((f) => ({
      lean: () => Promise.resolve(f.classIds?.$in?.includes('cls_yr7') ? YEAR7_SCHEDULE : null),
    })),
  };
}

describe('POST /api/import-export/timetable — lesson times come from the class\'s own bell schedule', () => {
  test('an imported lesson takes the start and end of its period in the class schedule, and records the schedule', async () => {
    useSavedSchedule();
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ period: '1' })] });
    expect(res.status).toBe(201);
    const slot = mockStores.timetable._docs()[0];
    expect(slot.startTime).toBe('08:15');
    expect(slot.endTime).toBe('09:10');
    expect(slot.bellScheduleId).toBe('bs_year7');
    expect(slot.scheduleStale).toBe(false);
  });

  test('a period the class schedule does not have is refused, and no lesson is written for it', async () => {
    useSavedSchedule();
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ period: '9' })] });
    expect(res.status).toBe(422);
    expect(mockStores.timetable._docs()).toHaveLength(0);
    expect(res.body.data.errors[0].message).toMatch(/not a lesson period in Year 7's bell schedule/);
  });

  test('a break cannot be used as a lesson period', async () => {
    useSavedSchedule();
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ period: 'B' })] });
    expect(res.status).toBe(422);
    expect(mockStores.timetable._docs()).toHaveLength(0);
    expect(res.body.data.errors[0].message).toMatch(/period/);
  });
});

describe('POST /api/import-export/timetable — academic year/term stamping', () => {
  test('an imported slot is stamped with the school\'s live-resolved current year/term', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.timetable._docs()[0].academicYearId).toBe('ay_2026');
    expect(mockStores.timetable._docs()[0].termId).toBe('term_1');
  });

  test('a school with no academic years configured yet still imports (nulls, not a hard failure)', async () => {
    mockCurrentPeriod = { academicYearId: null, termId: null };
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.timetable._docs()[0].academicYearId).toBeUndefined();
  });
});

describe('POST /api/import-export/timetable — streamName', () => {
  test('two different streams\' schedules for the same class/day/period create TWO slots, not one overwriting the other', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [
        row({ streamName: '7i',  teacherName: 'Agnes Otieno' }),
        row({ streamName: '7ii', teacherName: 'Brian Kamau' }),
      ] });

    expect(res.status).toBe(201);
    expect(mockStores.timetable._docs()).toHaveLength(2);
    const byStream = Object.fromEntries(mockStores.timetable._docs().map(d => [d.streamId, d]));
    expect(byStream['strm_7i'].teacherName).toBe('Agnes Otieno');
    expect(byStream['strm_7ii'].teacherName).toBe('Brian Kamau');
  });

  test('a whole-class row (no streamName) still works exactly as before', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.timetable._docs()[0].streamId).toBeNull();
  });

  test('an unknown stream name is rejected with a clear, actionable error', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ streamName: 'NoSuchStream' })] });

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors[0].field).toBe('streamName');
    expect(mockStores.timetable._docs()).toHaveLength(0);
  });

  test('re-importing the SAME class/stream/day/period updates the existing slot rather than duplicating it', async () => {
    await supertest(buildApp()).post('/api/import-export/timetable').set('Content-Type', 'application/json')
      .send({ rows: [row({ streamName: '7i', room: 'Room 101' })] });
    const res = await supertest(buildApp()).post('/api/import-export/timetable').set('Content-Type', 'application/json')
      .send({ rows: [row({ streamName: '7i', room: 'Room 202' })] });

    expect(res.status).toBe(201);
    expect(mockStores.timetable._docs()).toHaveLength(1);
    expect(mockStores.timetable._docs()[0].room).toBe('Room 202');
  });
});

describe('POST /api/import-export/timetable — teacher id resolution', () => {
  test('a teacher WITH a linked login account resolves to their userId (matches what Teacher View/Cover expect)', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ teacherName: 'Agnes Otieno' })] });

    expect(res.status).toBe(201);
    expect(mockStores.timetable._docs()[0].teacherId).toBe('usr_agnes');
  });

  test('a teacher with NO linked login account resolves to their own staff id, not the raw Mongo _id', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/timetable')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ teacherName: 'Brian Kamau' })] });

    expect(res.status).toBe(201);
    // The exact bug: this used to be String(t._id) — some ObjectId-shaped
    // string matching nothing else in the system computes for this teacher.
    expect(mockStores.timetable._docs()[0].teacherId).toBe('tch_brian');
  });
});
