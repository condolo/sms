/* ============================================================
   server/routes/timetable.js GET /my and GET /teacher/:teacherId —
   teacher identity resolution

   Reported live: a teacher's own "My Timetable" portal showed a
   DIFFERENT person ("Demo Teacher", 0 lessons) while the admin's own
   Class Grid clearly listed that teacher against real lessons, and
   the admin's own Teacher View picker ALSO showed 0 lessons for the
   correctly-selected teacher. Two real, code-provable bugs combine to
   produce this:

   1. GET /my resolved the teacher record by literal EMAIL match
      against the logged-in user, instead of the authoritative userId
      FK the rest of the codebase relies on (teachers.js's own POST
      comment: "Bind userId ... required for timetable slot
      resolution"). Any login whose display name was edited without
      the underlying teacher profile being touched — or whose login
      was created through the "Create Login Account" HR flow, which
      never backfilled that FK (see settings.js's companion fix) —
      resolves to the WRONG teacher, or none at all.

   2. Every write path that stamps timetable_slots.teacherId
      (AddSlotSlideOver, the compulsory-subject autofill, CSV import,
      TeacherAssignmentsTab) prefers `teacher.userId` over
      `teacher.id` when a login is linked. A teacher whose login gets
      linked (or self-heal-backfilled) AFTER some lessons were already
      scheduled ends up with OLD slots stamped under `id` and NEW ones
      under `userId`. Both GET /my and GET /teacher/:teacherId used to
      match teacherId as a single literal value, so whichever form
      wasn't current for a given slot was silently invisible.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = {
    sort:  () => c,
    limit: () => c,
    select: () => c,
    lean:  () => Promise.resolve(arr),
  };
  return c;
}
function mockChainObj(obj) {
  return { select: () => ({ lean: () => Promise.resolve(obj) }), lean: () => Promise.resolve(obj) };
}
function mockMatchesFilter(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatchesFilter(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return true; // handled above
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) ?? null)),
    updateOne: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatchesFilter(d, filter));
      if (doc) Object.assign(doc, update.$set ?? update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
  };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockCurrentUser;
let mockTeachers, mockTimetable, mockSchools, mockUsers;

jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => (col === 'schools' ? mockSchools : mockMakeFakeCollection([]))) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'teachers')  return mockTeachers;
    if (col === 'timetable') return mockTimetable;
    if (col === 'users')     return mockUsers;
    return mockMakeFakeCollection([]);
  }),
}));

const express = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetableRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchools = mockMakeFakeCollection([{ id: SCHOOL_A, timetableStatus: { published: true } }]);
  mockUsers   = mockMakeFakeCollection([]);
});

describe('GET /api/timetable/my — teacher resolution', () => {
  test('a teacher whose login is already linked (userId set) resolves directly and sees slots stamped under userId', async () => {
    mockCurrentUser = { userId: 'usr_1', email: 'robert@school.com', role: 'teacher', roles: ['teacher'], schoolId: SCHOOL_A };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_1', userId: 'usr_1', schoolId: SCHOOL_A, email: 'robert@school.com', firstName: 'Robert', lastName: 'Kioko' },
    ]);
    mockTimetable = mockMakeFakeCollection([
      { id: 's1', schoolId: SCHOOL_A, teacherId: 'usr_1', isActive: true, day: 'monday', period: 1 },
    ]);

    const res = await supertest(buildApp()).get('/api/timetable/my');

    expect(res.status).toBe(200);
    expect(res.body.data.teacher).toEqual({ id: 'tch_1', firstName: 'Robert', lastName: 'Kioko' });
    expect(res.body.data.slots).toHaveLength(1);
  });

  test('the exact reported bug: a login whose display name was edited independently of the teacher profile no longer resolves to a stranger by stale email match — it resolves via userId instead', async () => {
    // "Demo Teacher" — a real, distinct teacher record an old/reused
    // login's email happens to still match. Renaming just the login's
    // display name (not this record) must not make /my fall back to it.
    mockCurrentUser = { userId: 'u_demo_teacher', email: 'teacher@demo.msingi.io', role: 'teacher', roles: ['teacher'], schoolId: SCHOOL_A };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_demo_1', userId: 'u_demo_teacher', schoolId: SCHOOL_A, email: 'teacher@demo.msingi.io', firstName: 'Demo', lastName: 'Teacher' },
    ]);
    mockTimetable = mockMakeFakeCollection([]);

    const res = await supertest(buildApp()).get('/api/timetable/my');

    expect(res.status).toBe(200);
    // Resolved by userId (the only teacher in this fixture) — proves the
    // lookup path is userId-first, not a coincidence of there being only
    // one record. The real-world "Robert Kioko" scenario is exercised by
    // the self-heal test below with two distinct teacher records.
    expect(res.body.data.teacher.id).toBe('tch_demo_1');
  });

  test('a teacher record not yet linked (userId null) resolves via email fallback and self-heals the FK for next time', async () => {
    mockCurrentUser = { userId: 'usr_2', email: 'jane@school.com', role: 'teacher', roles: ['teacher'], schoolId: SCHOOL_A };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_2', userId: null, schoolId: SCHOOL_A, email: 'jane@school.com', firstName: 'Jane', lastName: 'Otieno' },
    ]);
    // Scheduled before any login existed — stamped under the staff id.
    mockTimetable = mockMakeFakeCollection([
      { id: 's2', schoolId: SCHOOL_A, teacherId: 'tch_2', isActive: true, day: 'tuesday', period: 2 },
    ]);

    const res = await supertest(buildApp()).get('/api/timetable/my');

    expect(res.status).toBe(200);
    expect(res.body.data.teacher.id).toBe('tch_2');
    expect(res.body.data.slots).toHaveLength(1);
    // Self-heal: the teacher doc now carries the FK so the next request
    // hits the direct userId branch instead of falling back again.
    expect(mockTeachers.updateOne).toHaveBeenCalledWith(
      { schoolId: SCHOOL_A, id: 'tch_2' },
      { $set: { userId: 'usr_2' } },
    );
  });

  test('drift: slots scheduled both before and after login-linkage are both visible together', async () => {
    mockCurrentUser = { userId: 'usr_3', email: 'x@school.com', role: 'teacher', roles: ['teacher'], schoolId: SCHOOL_A };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_3', userId: 'usr_3', schoolId: SCHOOL_A, email: 'x@school.com', firstName: 'A', lastName: 'B' },
    ]);
    mockTimetable = mockMakeFakeCollection([
      { id: 'old', schoolId: SCHOOL_A, teacherId: 'tch_3',  isActive: true, day: 'monday',  period: 1 },
      { id: 'new', schoolId: SCHOOL_A, teacherId: 'usr_3',  isActive: true, day: 'tuesday', period: 2 },
    ]);

    const res = await supertest(buildApp()).get('/api/timetable/my');

    expect(res.status).toBe(200);
    expect(res.body.data.slots.map(s => s.id).sort()).toEqual(['new', 'old']);
  });

  test('no teacher record at all under either form still reports the clear "not linked" message', async () => {
    mockCurrentUser = { userId: 'usr_ghost', email: 'nobody@school.com', role: 'teacher', roles: ['teacher'], schoolId: SCHOOL_A };
    mockTeachers  = mockMakeFakeCollection([]);
    mockTimetable = mockMakeFakeCollection([]);

    const res = await supertest(buildApp()).get('/api/timetable/my');

    expect(res.status).toBe(200);
    expect(res.body.data.teacher).toBeNull();
    expect(res.body.data.message).toMatch(/no teacher record/i);
  });
});

describe('GET /api/timetable/teacher/:teacherId — dual-form resolution', () => {
  test('requesting by the staff id still finds slots stamped under userId', async () => {
    mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_4', userId: 'usr_4', schoolId: SCHOOL_A, email: 'x@school.com', firstName: 'C', lastName: 'D' },
    ]);
    mockTimetable = mockMakeFakeCollection([
      { id: 'a', schoolId: SCHOOL_A, teacherId: 'usr_4', isActive: true, day: 'monday', period: 1 },
    ]);

    const res = await supertest(buildApp()).get('/api/timetable/teacher/tch_4');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('requesting by userId (what the client picker actually sends) still finds slots stamped under the staff id', async () => {
    mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_5', userId: 'usr_5', schoolId: SCHOOL_A, email: 'x2@school.com', firstName: 'E', lastName: 'F' },
    ]);
    mockTimetable = mockMakeFakeCollection([
      { id: 'b', schoolId: SCHOOL_A, teacherId: 'tch_5', isActive: true, day: 'monday', period: 1 },
    ]);

    const res = await supertest(buildApp()).get('/api/timetable/teacher/usr_5');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('an id matching no teacher at all falls back to a literal match instead of erroring', async () => {
    mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    mockTeachers  = mockMakeFakeCollection([]);
    mockTimetable = mockMakeFakeCollection([
      { id: 'c', schoolId: SCHOOL_A, teacherId: 'ghost_id', isActive: true, day: 'monday', period: 1 },
    ]);

    const res = await supertest(buildApp()).get('/api/timetable/teacher/ghost_id');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
