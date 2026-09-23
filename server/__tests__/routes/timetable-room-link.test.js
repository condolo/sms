/* ============================================================
   server/routes/timetable.js — roomId FK linkage (2026-09)

   Raised directly: room was pure free text on a timetable slot, matched
   for double-booking purposes by case-insensitive exact string equality
   against the Rooms registry's own name — so two different spellings of
   the same physical room never registered as a conflict, and renaming a
   room in the registry silently broke matching for every slot scheduled
   before the rename. This proves the fix: a slot can now carry a real
   roomId FK (resolved and denormalised from the live registry at write
   time via _applyRoomLink), conflict-checking matches by that id first,
   and a free-text/unregistered room still falls back to the original
   name-based match so nothing already working regresses.

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
      if ('$in' in v) return v.$in.includes(doc[k]);
      if (v instanceof RegExp) return v.test(doc[k] ?? '');
      return true;
    }
    if (v instanceof RegExp) return v.test(doc[k] ?? '');
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const doc = docs.find(d => matchesFilter(d, filter));
      if (!doc) return mockChainObj(null);
      Object.assign(doc, update);
      return mockChainObj(doc);
    }),
  };
}

let mockAcademicYears, mockTimetable, mockClasses, mockRooms;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_years') return mockAcademicYears;
    if (c === 'timetable')      return mockTimetable;
    if (c === 'classes')        return mockClasses;
    if (c === 'rooms')          return mockRooms;
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
const ROOM_LAB2 = { id: 'room_lab2', schoolId: SCHOOL_A, name: 'Lab 2', isActive: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockAcademicYears = makeFakeCollection([CURRENT_YEAR]);
  mockClasses       = makeFakeCollection([{ id: 'cls_yr7', schoolId: SCHOOL_A, name: 'Year 7' }]);
  mockRooms         = makeFakeCollection([ROOM_LAB2]);
});

describe('POST /api/timetable — roomId resolves and denormalises room', () => {
  test('a valid roomId sets room from the live registry, overriding any client-sent free text', async () => {
    mockTimetable = makeFakeCollection([]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'monday', period: '1', roomId: 'room_lab2', room: 'stale text the client sent' });
    expect(res.status).toBe(201);
    expect(res.body.data.roomId).toBe('room_lab2');
    expect(res.body.data.room).toBe('Lab 2');
  });

  test('an unknown roomId is rejected with 404, not silently dropped', async () => {
    mockTimetable = makeFakeCollection([]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'monday', period: '1', roomId: 'room_does_not_exist' });
    expect(res.status).toBe(404);
  });

  test('no roomId at all still works exactly as before — genuine free-text room', async () => {
    mockTimetable = makeFakeCollection([]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'monday', period: '1', room: 'Portable Block C' });
    expect(res.status).toBe(201);
    expect(res.body.data.room).toBe('Portable Block C');
    expect(res.body.data.roomId ?? null).toBeFalsy();
  });
});

describe('POST /api/timetable — room double-booking matches by roomId, not just text', () => {
  test('two overlapping slots with the SAME roomId conflict even though their stored room TEXT differs (simulating a rename in between)', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_existing', schoolId: SCHOOL_A, classId: 'cls_other', day: 'monday', period: '2',
      isActive: true, academicYearId: 'ay_2026', roomId: 'room_lab2', room: 'Old Name Before Rename',
      startTime: '09:00', endTime: '10:00',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'monday', period: '2', roomId: 'room_lab2', startTime: '09:30', endTime: '10:30' });
    expect(res.status).toBe(409);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/room/i);
  });

  test('a NEW booking against a registered room still catches a conflict from an old, unlinked, free-text slot with the same name', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_legacy', schoolId: SCHOOL_A, classId: 'cls_other', day: 'monday', period: '3',
      isActive: true, academicYearId: 'ay_2026', room: 'Lab 2', // no roomId — pre-fix legacy slot
      startTime: '11:00', endTime: '12:00',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'monday', period: '3', roomId: 'room_lab2', startTime: '11:15', endTime: '12:15' });
    expect(res.status).toBe(409);
  });

  test('two unregistered free-text rooms with different names never conflict', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_a', schoolId: SCHOOL_A, classId: 'cls_other', day: 'tuesday', period: '1',
      isActive: true, academicYearId: 'ay_2026', room: 'Portable A', startTime: '08:00', endTime: '09:00',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'tuesday', period: '1', room: 'Portable B', startTime: '08:00', endTime: '09:00' });
    expect(res.status).toBe(201);
  });

  test('the original free-text exact-name match still works with no roomId on either side', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_a', schoolId: SCHOOL_A, classId: 'cls_other', day: 'tuesday', period: '1',
      isActive: true, academicYearId: 'ay_2026', room: 'Portable A', startTime: '08:00', endTime: '09:00',
    }]);
    const res = await supertest(buildApp()).post('/api/timetable')
      .send({ classId: 'cls_yr7', day: 'tuesday', period: '1', room: 'portable a', startTime: '08:00', endTime: '09:00' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/timetable/:id — roomId link/unlink semantics', () => {
  test('omitting roomId entirely leaves the existing link untouched', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_yr7', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026', roomId: 'room_lab2', room: 'Lab 2',
    }]);
    const res = await supertest(buildApp()).put('/api/timetable/slot_1').send({ subject: 'Biology' });
    expect(res.status).toBe(200);
    expect(res.body.data.roomId).toBe('room_lab2');
    expect(res.body.data.room).toBe('Lab 2');
  });

  test('explicitly sending roomId: "" unlinks the room', async () => {
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_yr7', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026', roomId: 'room_lab2', room: 'Lab 2',
    }]);
    const res = await supertest(buildApp()).put('/api/timetable/slot_1').send({ roomId: '', room: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.roomId).toBeFalsy();
    expect(res.body.data.room).toBe('');
  });

  test('switching to a different registered room re-resolves the denormalised name', async () => {
    mockRooms = makeFakeCollection([ROOM_LAB2, { id: 'room_hall_a', schoolId: SCHOOL_A, name: 'Hall A', isActive: true }]);
    mockTimetable = makeFakeCollection([{
      id: 'slot_1', schoolId: SCHOOL_A, classId: 'cls_yr7', day: 'monday', period: '1',
      isActive: true, academicYearId: 'ay_2026', roomId: 'room_lab2', room: 'Lab 2',
    }]);
    const res = await supertest(buildApp()).put('/api/timetable/slot_1').send({ roomId: 'room_hall_a' });
    expect(res.status).toBe(200);
    expect(res.body.data.roomId).toBe('room_hall_a');
    expect(res.body.data.room).toBe('Hall A');
  });
});

describe('GET /api/timetable/conflicts — room conflicts group by roomId and show the live name', () => {
  test('two overlapping slots sharing a roomId are reported as one conflict, using the CURRENT registry name even though the slots still carry a stale, pre-rename name', async () => {
    mockTimetable = makeFakeCollection([
      {
        id: 'slot_a', schoolId: SCHOOL_A, classId: 'cls_a', day: 'monday', period: '1',
        isActive: true, roomId: 'room_lab2', room: 'Old Lab Name', startTime: '09:00', endTime: '10:00',
      },
      {
        id: 'slot_b', schoolId: SCHOOL_A, classId: 'cls_b', day: 'monday', period: '1',
        isActive: true, roomId: 'room_lab2', room: 'Old Lab Name', startTime: '09:30', endTime: '10:30',
      },
    ]);
    const res = await supertest(buildApp()).get('/api/timetable/conflicts');
    expect(res.status).toBe(200);
    const roomConflicts = res.body.data.conflicts.filter(c => c.type === 'room_double_booked');
    expect(roomConflicts).toHaveLength(1);
    expect(roomConflicts[0].room).toBe('Lab 2'); // live registry name, not the stale "Old Lab Name"
  });

  test('a renamed room does not silently split into two separate never-conflicting groups', async () => {
    // Both slots reference the SAME roomId even though their own stored
    // `room` text differs (one written before a rename, one after) — the
    // pre-fix name-based grouping would have missed this conflict entirely.
    mockTimetable = makeFakeCollection([
      {
        id: 'slot_a', schoolId: SCHOOL_A, classId: 'cls_a', day: 'wednesday', period: '4',
        isActive: true, roomId: 'room_lab2', room: 'Science Lab', startTime: '10:00', endTime: '11:00',
      },
      {
        id: 'slot_b', schoolId: SCHOOL_A, classId: 'cls_b', day: 'wednesday', period: '4',
        isActive: true, roomId: 'room_lab2', room: 'Lab 2', startTime: '10:30', endTime: '11:30',
      },
    ]);
    const res = await supertest(buildApp()).get('/api/timetable/conflicts');
    const roomConflicts = res.body.data.conflicts.filter(c => c.type === 'room_double_booked');
    expect(roomConflicts).toHaveLength(1);
  });
});
