/* ============================================================
   server/routes/assessment.js — GET /schedule, /marks, /marks/summary
   must fall back to legacy (academicYearId: null) records

   Real customer report, 2026-09-30, with screenshots: assessments were
   scheduled and visible in Settings -> Exams & Assessment ->
   Configuration, but the Markbook's own "Assessment" dropdown showed
   "(none scheduled)" for the exact same school/subject/class.

   Root cause confirmed directly against the live database: the
   Assessment Schedule config form has never had an academic-year
   selector, so it never sends academicYearId when saving — every real
   assessment_schedule document in production (8 of 8, checked directly)
   has academicYearId: null. The Markbook's Mark Entry Context, however,
   always has a real academic year selected and sends it as
   ?academicYearId=<real id> — GET /schedule's old strict equality filter
   (`academicYearId: req.query.academicYearId`) can never match a
   null-tagged document, so the dropdown reads empty for every real
   school, always. The same strict-match bug existed in GET /marks and
   GET /marks/summary.

   Fix: a requested academicYearId now also matches a stored null (or
   entirely absent) academicYearId — the same backward-compatible
   posture this file's own mark-save path (PUT /marks) already uses for
   exactly this reason.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';
const REAL_YEAR = 'ay_2026_2027';
const OTHER_YEAR = 'ay_2025_2026';
const CLASS_A = 'cls_form1a';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = null; next(); } }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));
jest.mock('../../utils/email', () => ({}));

let mockJwtUser;
let mockScheduleDocs;
let mockMarkDocs;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), select: () => mockChainArr(arr), limit: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockCollection(seed = []) {
  return {
    find:    jest.fn((filter) => mockChainArr(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne: jest.fn((filter) => mockChainObj(seed.find(d => mockMatchesFilter(d, filter)) ?? null)),
    create:  jest.fn((doc) => Promise.resolve(doc)),
  };
}

jest.mock('../../utils/model', () => ({ _model: jest.fn(() => mockCollection([])) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'assessment_schedule') return mockCollection(mockScheduleDocs);
    if (collection === 'assessment_marks')    return mockCollection(mockMarkDocs);
    return mockCollection([]);
  },
}));

const express          = require('express');
const supertest        = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockScheduleDocs = [
    // The real, universal shape: never tagged with a year, since the
    // Config form has never asked for one.
    { id: 'sched_ca4', schoolId: SCHOOL, academicYearId: null, termNumber: 1, assessmentType: 'CA', instance: 4, dateFrom: '2026-09-14', dateTo: '2026-09-18' },
    // A genuinely year-scoped entry (possible via a direct API call, or a
    // future UI that does add a year selector) — must still be correctly
    // excluded from a DIFFERENT year's query.
    { id: 'sched_other_year', schoolId: SCHOOL, academicYearId: OTHER_YEAR, termNumber: 1, assessmentType: 'MT', instance: 1, dateFrom: '2025-11-01', dateTo: '2025-11-05' },
  ];
  mockMarkDocs = [
    { id: 'mark_legacy', schoolId: SCHOOL, classId: CLASS_A, streamId: null, studentId: 'stu_1', subjectId: 'subj_mech', termNumber: 1, assessmentType: 'CA', instance: 4, academicYearId: null, rawScore: 70 },
  ];
});

describe('GET /api/assessment/schedule — the reported bug', () => {
  test('a null-tagged schedule entry is returned when a real academicYearId is requested', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/schedule').query({ academicYearId: REAL_YEAR });
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain('sched_ca4');
  });

  test('an entry genuinely scoped to a DIFFERENT year is still correctly excluded', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/schedule').query({ academicYearId: REAL_YEAR });
    const ids = res.body.data.map(s => s.id);
    expect(ids).not.toContain('sched_other_year');
  });

  test('with no academicYearId at all, every entry is returned regardless (unchanged behavior)', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/schedule');
    expect(res.body.data.map(s => s.id).sort()).toEqual(['sched_ca4', 'sched_other_year']);
  });

  test('requesting the OTHER year returns only that year\'s entry, not the null-tagged one twice', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/schedule').query({ academicYearId: OTHER_YEAR });
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain('sched_other_year');
    expect(ids).toContain('sched_ca4'); // still visible — it's universal, not year-locked
  });
});

describe('GET /api/assessment/marks — same fallback', () => {
  test('a null-tagged mark is returned when a real academicYearId is requested', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/marks').query({ academicYearId: REAL_YEAR, classId: CLASS_A });
    expect(res.body.data.map(m => m.id)).toContain('mark_legacy');
  });
});

describe('GET /api/assessment/marks/summary — same fallback', () => {
  test('a null-tagged mark still counts toward the completion grid when a real academicYearId is requested', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/marks/summary').query({ classId: CLASS_A, academicYearId: REAL_YEAR });
    expect(res.status).toBe(200);
    expect(res.body.data.stu_1.CA4).toBe(70);
  });
});
