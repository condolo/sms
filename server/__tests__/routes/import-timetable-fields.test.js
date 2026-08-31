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
