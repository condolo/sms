/* ============================================================
   server/routes/report-cards.js — POST /generate year/term scoping
   (RCE7), now sourced from the Markbook (Phase 5).

   `classes` documents are NOT year-scoped (the same classId persists
   across every academic year via student promotion), and
   ReportCardsTab.jsx's only caller of /generate and /publish never
   sends termId/academicYearId — just {classId, termNumber}. Without
   _resolveTermScope() live-resolving the current academic year first,
   the Markbook aggregation would pull marks across EVERY year a class
   has ever existed, silently mixing an old year's marks into a new
   year's report card.

   Two academic years exist for the same class/subject, each with its
   own mark for the same student. A request with no explicit year/term
   must resolve to the isCurrent-flagged year and include ONLY that
   year's mark. Moderation (provisional flag) is sourced from
   mark_submissions — approved/locked clears it, anything else does not.

   All DB calls are mocked — no MongoDB required. Only utils/model is
   mocked; the real tenantModel() wrapper and the real
   resolveCurrentPeriod()/mergeConfig() run unmocked.
   ============================================================ */
'use strict';

function makeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter || {}).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in v)  return v.$in.includes(doc[k]);
        if ('$ne' in v)  return doc[k] !== v.$ne;
        if ('$nin' in v) return !v.$nin.includes(doc[k]);
        if ('$exists' in v) {
          const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
          return v.$exists ? has : !has;
        }
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
  find:    () => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) }),
  findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }), lean: () => Promise.resolve(null) }),
  create:  async (doc) => doc,
};
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col] || mockEmptyCollection) }));

const express           = require('express');
const supertest         = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

const SCHOOL = 'sch_1';
const CLASS  = 'cls_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

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

const markOld = { id: 'm_old', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math', studentId: 'stu_1', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_old', rawScore: 90, markState: 'present', isPublished: true };
const markCur = { id: 'm_cur', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math', studentId: 'stu_1', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_cur', rawScore: 50, markState: 'present', isPublished: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockStores = {
    academic_years:    makeCollection([yearOld, yearCur]),
    academic_config:   makeCollection([]),
    // A school default scale: generation now refuses without one (no built-in fallback).
    grade_boundaries:  makeCollection([{ id: 'sc_default', schoolId: SCHOOL, name: 'Default', isDefault: true, bands: [{ grade: 'A', min: 80, points: 4 }, { grade: 'E', min: 0, points: 0 }] }]),
    assessment_config: makeCollection([]),
    assessment_marks:  makeCollection([markOld, markCur]),
    mark_submissions:  makeCollection([]),
    subjects:          makeCollection([]),
    students:          makeCollection([]),
    streams:           makeCollection([]),
    teachers:          makeCollection([]),
  };
});

describe('POST /api/report-cards/generate — year/term scope resolution', () => {
  test('no termId/academicYearId in the request → resolves to the isCurrent year, excludes the other year\'s mark', async () => {
    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });

    expect(res.status).toBe(200);
    const stu = res.body.data.students.find(s => s.studentId === 'stu_1');
    expect(stu).toBeTruthy();
    // Only one ET type is present → normalised score equals the mark itself,
    // so 50 proves the current year's mark was used, not 90 from the old year.
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
    mockStores.assessment_marks = makeCollection([
      { id: 'm_only', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math', studentId: 'stu_1', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_only', rawScore: 77, markState: 'present', isPublished: true },
    ]);

    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });

    expect(res.status).toBe(200);
    const stu = res.body.data.students.find(s => s.studentId === 'stu_1');
    expect(stu.subjects.sub_math.finalScore).toBe(77);
  });
});

describe('POST /api/report-cards/generate — provisional flag (Markbook moderation)', () => {
  const SUB_KEY = 'sub_math|ET|1';

  test('every relevant mark approved → provisional is false', async () => {
    mockStores.mark_submissions = makeCollection([
      { id: 'sub_1', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_cur', status: 'approved' },
    ]);
    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.provisional).toBe(false);
    expect(res.body.data.unmoderatedExams).toEqual([]);
  });

  test('a mark with no submission at all → provisional is true, named in unmoderatedExams', async () => {
    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.provisional).toBe(true);
    expect(res.body.data.unmoderatedExams).toEqual([
      { id: SUB_KEY, title: 'sub_math — ET', status: 'not_submitted' },
    ]);
  });

  test('a submitted but not yet approved mark still counts as provisional', async () => {
    mockStores.mark_submissions = makeCollection([
      { id: 'sub_1', schoolId: SCHOOL, classId: CLASS, subjectId: 'sub_math', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_cur', status: 'submitted' },
    ]);
    const res = await supertest(buildApp())
      .post('/api/report-cards/generate')
      .send({ classId: CLASS, termNumber: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.provisional).toBe(true);
    expect(res.body.data.unmoderatedExams[0].status).toBe('submitted');
  });
});
