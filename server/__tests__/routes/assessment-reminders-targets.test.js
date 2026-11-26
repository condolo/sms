/* ============================================================
   GET /api/assessment/reminders — per-target rows (2026-11-26)

   The reminder feed used to aggregate every schedule across all of the
   teacher's assignments and return no classId/subjectId. The mobile app
   only opens a row when classId is present, so every "Review" was a dead
   end. These tests pin the contract the app now depends on: one row per
   (schedule × class × subject), with the names needed to open LogToday.
   ============================================================ */

'use strict';

const SCHOOL = 'school_test_001';
const TEACHER = 'usr_teacher_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/model', () => ({ _model: jest.fn(() => mockCollection([])) }));

let mockJwtUser;
let mockAssignments;
let mockStudents;
let mockMarks;
let mockSchedules;
let mockClasses;
let mockSubjects;

function chain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c,
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
  };
  return c;
}

function mockCollection(seed = []) {
  return {
    find: jest.fn(() => chain(seed)),
    findOne: jest.fn(() => chain(seed[0] ?? null)),
    countDocuments: jest.fn((filter = {}) => Promise.resolve(
      seed.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)).length,
    )),
  };
}

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments') return mockCollection(mockAssignments);
    if (collection === 'students')             return mockCollection(mockStudents);
    if (collection === 'assessment_marks')     return mockCollection(mockMarks);
    if (collection === 'assessment_schedule')  return mockCollection(mockSchedules);
    if (collection === 'classes')              return mockCollection(mockClasses);
    if (collection === 'subjects')             return mockCollection(mockSubjects);
    return mockCollection([]);
  },
}));

const express = require('express');
const supertest = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: TEACHER, schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };

  mockAssignments = [
    { schoolId: SCHOOL, teacherId: TEACHER, classId: 'cls_a', subjectId: 'subj_math' },
    // Same class+subject in two streams: one marking target, not two rows.
    { schoolId: SCHOOL, teacherId: TEACHER, classId: 'cls_a', subjectId: 'subj_math', streamId: 'strm_1' },
    { schoolId: SCHOOL, teacherId: TEACHER, classId: 'cls_b', subjectId: 'subj_eng' },
  ];
  mockStudents = [
    { schoolId: SCHOOL, classId: 'cls_a', status: 'active' },
    { schoolId: SCHOOL, classId: 'cls_a', status: 'active' },
    { schoolId: SCHOOL, classId: 'cls_a', status: 'active' },
    { schoolId: SCHOOL, classId: 'cls_b', status: 'active' },
    { schoolId: SCHOOL, classId: 'cls_b', status: 'active' },
    { schoolId: SCHOOL, classId: 'cls_b', status: 'active' },
    { schoolId: SCHOOL, classId: 'cls_b', status: 'active' },
  ];
  // One HW mark filed for cls_a / maths, none for cls_b / English.
  mockMarks = [
    { schoolId: SCHOOL, classId: 'cls_a', subjectId: 'subj_math', assessmentType: 'HW', instance: 1, termNumber: 1, academicYearId: 'ay_1' },
  ];
  mockClasses = [
    { id: 'cls_a', schoolId: SCHOOL, name: 'Form 1A' },
    { id: 'cls_b', schoolId: SCHOOL, name: 'Form 2A' },
  ];
  mockSubjects = [
    { id: 'subj_math', schoolId: SCHOOL, name: 'Mathematics' },
    { id: 'subj_eng', schoolId: SCHOOL, name: 'English' },
  ];
  mockSchedules = [
    {
      id: 'sch_hw', schoolId: SCHOOL, termNumber: 1, assessmentType: 'HW', instance: 1,
      label: 'HW 1', dateFrom: iso(-5), dateTo: iso(-1), academicYearId: 'ay_1',
    },
    {
      id: 'sch_et', schoolId: SCHOOL, termNumber: 1, assessmentType: 'ET', instance: 1,
      label: 'End Term', dateFrom: iso(20), dateTo: iso(30), academicYearId: 'ay_1',
    },
  ];
});

describe('GET /api/assessment/reminders — teacher targets', () => {
  test('returns one row per class+subject with the ids and names the app opens', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/reminders').query({ days: 14 });

    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(rows).toHaveLength(2);

    const maths = rows.find((r) => r.classId === 'cls_a');
    expect(maths).toMatchObject({
      scheduleId: 'sch_hw',
      assessmentType: 'HW',
      instance: 1,
      classId: 'cls_a',
      className: 'Form 1A',
      subjectId: 'subj_math',
      subject: 'Mathematics',
      status: 'overdue',
      expectedCount: 3,
      marksEntered: 1,
      missingCount: 2,
    });

    const english = rows.find((r) => r.classId === 'cls_b');
    expect(english).toMatchObject({
      classId: 'cls_b',
      className: 'Form 2A',
      subjectId: 'subj_eng',
      subject: 'English',
      expectedCount: 4,
      marksEntered: 0,
      missingCount: 4,
    });
  });

  test('collapses duplicate stream assignments for the same class+subject', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/reminders').query({ days: 14 });
    expect(res.body.data.filter((r) => r.classId === 'cls_a')).toHaveLength(1);
  });

  test('a schedule outside the requested window (End Term, +20 days) is not a reminder', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/reminders').query({ days: 14 });
    expect(res.body.data.some((r) => r.assessmentType === 'ET')).toBe(false);
  });

  test('honours the classId filter', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/reminders')
      .query({ days: 14, classId: 'cls_b' });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].classId).toBe('cls_b');
  });
});

describe('GET /api/assessment/reminders — oversight roles', () => {
  test('keeps one school-wide row per schedule, without inventing a class', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    const res = await supertest(buildApp()).get('/api/assessment/reminders').query({ days: 14 });

    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scheduleId: 'sch_hw',
      assessmentType: 'HW',
      classId: null,
      subjectId: null,
      missingCount: null,
      expectedCount: null,
    });
  });
});
