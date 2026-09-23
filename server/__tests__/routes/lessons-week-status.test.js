/* ============================================================
   server/routes/lessons.js — GET /plans/week-status (2026-09)

   Requested directly: "once teachers timetable is connected the system
   is aware how many lessons a week needs to be planned for, and reminds
   the teacher [of] the lessons not planned for."

   teaching_assignments only says WHO teaches WHAT — no day/period
   granularity. The TIMETABLE (timetable.js's real, recurring day/period
   slots) is what actually answers "how many lessons a week". This file
   proves: (1) each real 'lesson'-type slot resolves to the correct
   calendar date within the requested week; (2) a slot already covered by
   a real lesson_plans record for that exact date is NOT counted as
   unplanned; (3) a double period (two slots, same day, same class-
   subject) dedupes to ONE required lesson, matching lesson_plans' own
   date-level granularity; (4) non-'lesson' slot types (break/assembly/
   free) are excluded entirely; (5) a slot stored under the teachers-
   collection id (not the account id) is still matched, via the same $or
   pattern teacher-portal.js already established for this exact drift.

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
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$gte' in v || '$lte' in v) {
        if ('$gte' in v && !(doc[k] >= v.$gte)) return false;
        if ('$lte' in v && !(doc[k] <= v.$lte)) return false;
        return true;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return { find: jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))) };
}

let mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], email: 't@x.com' };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockTeacherRecord = null;
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve(mockTeacherRecord)),
}));

let mockTimetable, mockLessonPlans, mockClasses, mockSubjects, mockStreams;
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: () => mockChainArr([]), findOne: () => mockChainObj(null) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'timetable')    return mockTimetable;
    if (collection === 'lesson_plans') return mockLessonPlans;
    if (collection === 'classes')      return mockClasses;
    if (collection === 'subjects')     return mockSubjects;
    if (collection === 'streams')      return mockStreams;
    return mockMakeFakeCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const lessonsRouter = require('../../routes/lessons');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lessons', lessonsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], email: 't@x.com' };
  mockTeacherRecord = null;
  mockTimetable = mockMakeFakeCollection([]);
  mockLessonPlans = mockMakeFakeCollection([]);
  mockClasses = mockMakeFakeCollection([{ id: 'cls_yr2', schoolId: SCHOOL_A, name: 'Year 2' }]);
  mockSubjects = mockMakeFakeCollection([{ id: 'subj_eng', schoolId: SCHOOL_A, name: 'English' }]);
  mockStreams = mockMakeFakeCollection([{ id: 'strm_diamond', schoolId: SCHOOL_A, name: 'Diamond' }]);
});

// A Monday, deliberately, so day-offset math is easy to verify by hand.
const MONDAY = '2026-09-21';
const TUESDAY = '2026-09-22';

describe('GET /api/lessons/plans/week-status', () => {
  test('no timetable slots at all — nothing required, nothing unplanned', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.status).toBe(200);
    expect(res.body.data.totalRequired).toBe(0);
    expect(res.body.data.unplanned).toEqual([]);
  });

  test('a real lesson slot with no matching plan shows up as unplanned, on the correct date', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.status).toBe(200);
    expect(res.body.data.totalRequired).toBe(1);
    expect(res.body.data.totalPlanned).toBe(0);
    expect(res.body.data.unplanned).toHaveLength(1);
    expect(res.body.data.unplanned[0].date).toBe(MONDAY);
    expect(res.body.data.unplanned[0].className).toBe('Year 2');
  });

  test('a slot already covered by a real lesson_plans record for that exact date is NOT unplanned', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
    ]);
    mockLessonPlans = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', date: MONDAY },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalRequired).toBe(1);
    expect(res.body.data.totalPlanned).toBe(1);
    expect(res.body.data.unplanned).toEqual([]);
  });

  test('a plan for a DIFFERENT date in the week does not satisfy Monday\'s slot', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
    ]);
    mockLessonPlans = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', date: TUESDAY },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalPlanned).toBe(0);
    expect(res.body.data.unplanned).toHaveLength(1);
  });

  test('a double period (2 slots, same day, same class-subject) dedupes to ONE required lesson', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalRequired).toBe(1);
  });

  test('a sibling stream is tracked separately from the whole class / other streams', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', streamId: 'strm_diamond', day: 'monday', type: 'lesson', isActive: true },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'tuesday', type: 'lesson', isActive: true }, // whole-class, no stream
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalRequired).toBe(2);
    expect(res.body.data.assignments).toHaveLength(2);
  });

  test('non-"lesson" slot types (break, assembly, free) are excluded entirely', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'break', isActive: true },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', day: 'monday', type: 'registration', isActive: true },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalRequired).toBe(0);
  });

  test('an inactive slot is excluded', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: false },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalRequired).toBe(0);
  });

  test('a slot stored under the teachers-collection id (not the account id) is still matched', async () => {
    mockTeacherRecord = { id: 'tch_1', userId: 'usr_teacher' };
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'tch_1', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: MONDAY });
    expect(res.body.data.totalRequired).toBe(1);
  });

  test('a custom weekStart resolves to that week\'s Monday, not the current week', async () => {
    mockTimetable = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', day: 'monday', type: 'lesson', isActive: true },
    ]);
    // Pass a Wednesday — _weekStartOf should resolve back to that week's Monday.
    const res = await supertest(buildApp()).get('/api/lessons/plans/week-status').query({ weekStart: '2026-09-23' });
    expect(res.body.data.weekStart).toBe(MONDAY);
    expect(res.body.data.unplanned[0].date).toBe(MONDAY);
  });
});
