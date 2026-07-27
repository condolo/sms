/* ============================================================
   server/routes/report-cards.js — POST /generate year/term scoping
   (RCE7)

   `classes` documents are NOT year-scoped (the same classId persists
   across every academic year via student promotion), and
   ReportCardsTab.jsx's only caller of /generate and /publish never
   sends termId/academicYearId — just {classId, termNumber}. Without
   _resolveTermScope() live-resolving the current academic year first,
   aggregateExamResults()/aggregateGrades() would pull exam data across
   EVERY year a class has ever existed, silently mixing an old year's
   results into a new year's report card.

   This test proves the fix: two academic years exist for the same
   class/subject, each with its own exam result for the same student.
   A request with no explicit year/term must resolve to the
   isCurrent-flagged year and include ONLY that year's exam result.

   All DB calls are mocked — no MongoDB required. Only utils/model is
   mocked; the real tenantModel() wrapper (a thin schoolId-scoping
   layer over _model()) and the real resolveCurrentPeriod()/mergeConfig()
   run unmocked, so this exercises the actual resolution logic.
   ============================================================ */
'use strict';

function makeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in v)  return v.$in.includes(doc[k]);
        if ('$ne' in v)  return doc[k] !== v.$ne;
        if ('$nin' in v) return !v.$nin.includes(doc[k]);
      }
      return doc[k] === v;
    });
  }
  function chain(result) {
    return {
      lean:   () => Promise.resolve(result),
      select: () => chain(result),
      sort:   () => chain(result),
      limit:  () => chain(result),
      skip:   () => chain(result),
    };
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    create:  async (doc) => { const d = { ...doc }; docs.push(d); return d; },
    _docs:   () => docs,
  };
}

let mockCurrentUser = { userId: 'usr_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] };
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

// An unseeded collection just returns nothing instead of throwing.
const mockEmptyCollection = {
  find:    () => ({ lean: () => Promise.resolve([]) }),
  findOne: () => ({ lean: () => Promise.resolve(null) }),
  create:  async (doc) => doc,
};
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col] || mockEmptyCollection) }));

const express          = require('express');
const supertest        = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

const SCHOOL = 'sch_1';
const CLASS  = 'cls_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };

  const yearOld = {
    id: 'ay_old', schoolId: SCHOOL, isCurrent: false,
    startDate: '2024-09-01', endDate: '2025-07-01',
    terms: [
      { id: 't_old_1', startDate: '2024-09-01', endDate: '2024-12-01' },
      { id: 't_old_2', startDate: '2025-01-01', endDate: '2025-04-01' },
      { id: 't_old_3', startDate: '2025-04-15', endDate: '2025-07-01' },
    ],
  };
  const yearCur = {
    id: 'ay_cur', schoolId: SCHOOL, isCurrent: true,
    startDate: '2025-09-01', endDate: '2026-07-01',
    terms: [
      { id: 't_cur_1', startDate: '2025-09-01', endDate: '2025-12-01' },
      { id: 't_cur_2', startDate: '2026-01-01', endDate: '2026-04-01' },
      { id: 't_cur_3', startDate: '2026-04-15', endDate: '2026-07-01' },
    ],
  };

  mockStores = {
    academic_years:   makeCollection([yearOld, yearCur]),
    academic_config:  makeCollection([]),
    grade_boundaries: makeCollection([]),
    assessment_config: makeCollection([]),
    grades:            makeCollection([]),
    assessment_marks:  makeCollection([]),
    students:          makeCollection([]),
    streams:           makeCollection([]),
    teachers:          makeCollection([]),
    exams: makeCollection([
      {
        id: 'ex_old', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math',
        termId: 't_old_1', academicYearId: 'ay_old',
        status: 'published', maxScore: 100, assessmentType: 'ET',
      },
      {
        id: 'ex_cur', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math',
        termId: 't_cur_1', academicYearId: 'ay_cur',
        status: 'published', maxScore: 100, assessmentType: 'ET',
      },
    ]),
    exam_results: makeCollection([
      { id: 'r_old', schoolId: SCHOOL, examId: 'ex_old', studentId: 'stu_1', score: 90, markState: 'present' },
      { id: 'r_cur', schoolId: SCHOOL, examId: 'ex_cur', studentId: 'stu_1', score: 50, markState: 'present' },
    ]),
  };
});

describe('POST /api/report-cards/generate — year/term scope resolution', () => {
  test('no termId/academicYearId in the request → resolves to the isCurrent year, excludes the other year\'s exam result', async () => {
    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });

    expect(res.status).toBe(200);
    const stu = res.body.data.students.find(s => s.studentId === 'stu_1');
    expect(stu).toBeTruthy();
    // ET weight is 40 either way — only the *value* differs (50 vs 90),
    // so this proves which year's result was actually aggregated.
    expect(stu.subjects.sub_math.finalScore).toBe(50);
  });

  test('an explicit academicYearId in the request always wins over live resolution', async () => {
    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1, academicYearId: 'ay_old', termId: 't_old_1' });

    expect(res.status).toBe(200);
    const stu = res.body.data.students.find(s => s.studentId === 'stu_1');
    expect(stu.subjects.sub_math.finalScore).toBe(90);
  });

  test('a school with only one academic year still resolves correctly (no isCurrent flag needed)', async () => {
    mockStores.academic_years = makeCollection([
      { id: 'ay_only', schoolId: SCHOOL, isCurrent: false, startDate: '2020-01-01', endDate: '2099-01-01',
        terms: [{ id: 't_only_1', startDate: '2020-01-01', endDate: '2099-01-01' }] },
    ]);
    mockStores.exams = makeCollection([
      { id: 'ex_only', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math',
        termId: 't_only_1', academicYearId: 'ay_only', status: 'published', maxScore: 100, assessmentType: 'ET' },
    ]);
    mockStores.exam_results = makeCollection([
      { id: 'r_only', schoolId: SCHOOL, examId: 'ex_only', studentId: 'stu_1', score: 77, markState: 'present' },
    ]);

    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });

    expect(res.status).toBe(200);
    const stu = res.body.data.students.find(s => s.studentId === 'stu_1');
    expect(stu.subjects.sub_math.finalScore).toBe(77);
  });
});
