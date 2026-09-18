/* ============================================================
   GET /api/assessment/analytics (2026-09)

   Replaces the Reports page's Academic tab, which called
   GET /marks/summary with no classId and always got rejected — see
   CHANGELOG.md's studentName-adjacent v5.68.0-era entries and the
   dedicated fix note for this one. Covers:

     1. Whole-school view for an unrestricted (leadership) role —
        scope: 'whole_school', every class's marks included.
     2. A scoped teacher (scope: 'assigned') sees only their assigned
        class(es) — school-wide totals never leak into their view, and
        availableClasses only lists their own.
     3. Requesting a classId outside the caller's scope returns an
        empty result, not another class's data and not an error —
        matches ScopeEngine.applyToFilter's existing "replace with
        __no_match__" contract used by every other scoped module.
     4. Comparison periods: previousTerm (same year, N-1; wraps to the
        prior year's last term at term 1), previousYear (same
        termNumber, prior year), and 'none'.
     5. A school with no academic years configured yet returns an
        empty-but-valid response, not an error.
     6. An explicitly invalid academicYearId is rejected (400), not
        silently ignored.
     7. subjectId narrows results to one subject.
     8. passMark is read from academic_config (default 40).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
// scopeMiddleware itself is already covered by its own dedicated tests
// (scope-engine.test.js / scope-engine-streams.test.js) — mocked here to
// a controlled req.scope so this file tests only THIS route's use of it.
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = mockScope; next(); } }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));

let mockJwtUser;
let mockScope; // null = unrestricted; {level, classIds} = scoped
let mockYears;
let mockAcademicConfigDoc;
let mockMarkDocs;
let mockSubjectDocs;
let mockClassDocs;
let mockStreamDocs;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }

function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}

/* Fake aggregate: reads the $match filter from the pipeline, applies it
   to mockMarkDocs, then computes the same bySubject/overall shape the
   real $facet pipeline does — a pragmatic stand-in for a real Mongo
   $facet run, same approach this test suite already uses elsewhere for
   aggregation-heavy routes (see finance-draft-invoices.test.js). */
function mockFakeMarksAggregate(pipeline) {
  const matchStage = pipeline.find(s => s.$match)?.$match ?? {};
  const matched = mockMarkDocs.filter(d => mockMatchesFilter(d, matchStage));
  const passMark = mockAcademicConfigDoc?.passMark ?? 40;

  function summarize(docs) {
    if (docs.length === 0) return null;
    const avgPct = Math.round((docs.reduce((s, d) => s + d.rawScore, 0) / docs.length) * 10) / 10;
    const passCount = docs.filter(d => d.rawScore >= passMark).length;
    return { avgPct, count: docs.length, passRate: Math.round((passCount / docs.length) * 1000) / 10 };
  }

  const bySubjectIds = [...new Set(matched.map(d => d.subjectId))];
  const bySubject = bySubjectIds.map(subjectId => ({ subjectId, ...summarize(matched.filter(d => d.subjectId === subjectId)) }));
  const overall = summarize(matched);

  return Promise.resolve([{ bySubject, overall: overall ? [overall] : [] }]);
}

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'academic_years')   return { find: () => mockChainArr(mockYears) };
    if (collection === 'academic_config')  return { findOne: () => mockChainObj(mockAcademicConfigDoc) };
    if (collection === 'assessment_marks') return { aggregate: (pipeline) => mockFakeMarksAggregate(pipeline) };
    if (collection === 'subjects')         return { find: (filter) => mockChainArr(mockSubjectDocs.filter(d => mockMatchesFilter(d, filter))) };
    if (collection === 'classes')          return { find: (filter) => mockChainArr(mockClassDocs.filter(d => mockMatchesFilter(d, filter))) };
    if (collection === 'streams')          return { find: (filter) => mockChainArr(mockStreamDocs.filter(d => mockMatchesFilter(d, filter))) };
    return { find: () => mockChainArr([]), findOne: () => mockChainObj(null) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

const YEAR_2025 = { id: 'ay_2025', name: '2025/2026', startDate: '2025-01-01', endDate: '2025-11-30', isCurrent: false,
  terms: [{ startDate: '2025-01-01', endDate: '2025-04-30' }, { startDate: '2025-05-01', endDate: '2025-08-31' }, { startDate: '2025-09-01', endDate: '2025-11-30' }] };
const YEAR_2026 = { id: 'ay_2026', name: '2026/2027', startDate: '2026-01-01', endDate: '2026-11-30', isCurrent: true,
  terms: [{ startDate: '2026-01-01', endDate: '2026-04-30' }, { startDate: '2026-05-01', endDate: '2026-08-31' }, { startDate: '2026-09-01', endDate: '2026-11-30' }] };

const CLASSES = [{ id: 'cls_a', name: 'Form 1A', schoolId: SCHOOL }, { id: 'cls_b', name: 'Form 2B', schoolId: SCHOOL }];
const SUBJECTS = [{ id: 'sub_math', name: 'Mathematics', schoolId: SCHOOL }, { id: 'sub_eng', name: 'English', schoolId: SCHOOL }];

function mark(overrides = {}) {
  return { schoolId: SCHOOL, isPublished: true, academicYearId: 'ay_2026', termNumber: 2, classId: 'cls_a', subjectId: 'sub_math', rawScore: 70, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockScope = null;
  mockYears = [YEAR_2025, YEAR_2026];
  mockAcademicConfigDoc = { passMark: 40 };
  mockClassDocs = CLASSES;
  mockSubjectDocs = SUBJECTS;
  mockStreamDocs = [];
  mockMarkDocs = [
    mark({ subjectId: 'sub_math', classId: 'cls_a', rawScore: 80 }),
    mark({ subjectId: 'sub_math', classId: 'cls_a', rawScore: 60 }),
    mark({ subjectId: 'sub_eng',  classId: 'cls_b', rawScore: 30 }),
  ];
});

describe('GET /api/assessment/analytics — whole-school view', () => {
  test('an unrestricted (leadership) caller sees marks across every class', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe('whole_school');
    expect(res.body.data.overall.count).toBe(3); // all 3 marks, both classes
    const math = res.body.data.subjects.find(s => s.subjectId === 'sub_math');
    expect(math.subject).toBe('Mathematics');
    expect(math.current.avgPct).toBe(70); // (80+60)/2
    expect(res.body.data.availableClasses).toHaveLength(2); // both classes visible
  });
});

describe('GET /api/assessment/analytics — scoped teacher view', () => {
  beforeEach(() => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    mockScope = { level: 'assigned', classIds: ['cls_a'] };
  });

  test("a scoped teacher's whole-school totals never include another class's marks", async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe('assigned');
    expect(res.body.data.overall.count).toBe(2); // only cls_a's 2 math marks — cls_b's English excluded
    expect(res.body.data.subjects.map(s => s.subjectId)).toEqual(['sub_math']); // no English (cls_b, out of scope)
    expect(res.body.data.availableClasses).toEqual([{ id: 'cls_a', name: 'Form 1A' }]); // only their own class
  });

  test('requesting a classId OUTSIDE scope returns empty, not that class\'s real data', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ classId: 'cls_b', academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.status).toBe(200);
    expect(res.body.data.subjects).toEqual([]);
    expect(res.body.data.overall).toBeNull();
  });
});

describe('GET /api/assessment/analytics — stream-only-scoped teacher', () => {
  // Regression (2026-09) — a compulsory-subject-per-stream teaching
  // assignment (teaching-assignments.js) contributes only to
  // scope.streamIds, never scope.classIds. `classes` documents have no
  // streamId field of their own to match a stream-scoped grant against
  // (see scopeEngine.js's MODULE_SCOPE comment on `classes`), so this used
  // to resolve to an empty availableClasses list here — the same bug found
  // live in AttendancePage.jsx's class picker (classes.js's GET /), fixed
  // in the same change via the shared ScopeEngine.resolveClassPickerScope().
  beforeEach(() => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    mockScope = { level: 'assigned', classIds: [], streamIds: ['str_a'] }; // no whole-class grant anywhere
    mockStreamDocs = [{ id: 'str_a', schoolId: SCHOOL, classId: 'cls_a' }];
  });

  test('availableClasses still lists the stream\'s parent class, not an empty list', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.status).toBe(200);
    expect(res.body.data.availableClasses).toEqual([{ id: 'cls_a', name: 'Form 1A' }]);
  });
});

describe('GET /api/assessment/analytics — period comparison', () => {
  beforeEach(() => {
    mockMarkDocs = [
      mark({ subjectId: 'sub_math', academicYearId: 'ay_2026', termNumber: 2, rawScore: 80 }), // current
      mark({ subjectId: 'sub_math', academicYearId: 'ay_2026', termNumber: 1, rawScore: 60 }), // previous term (same year)
      mark({ subjectId: 'sub_math', academicYearId: 'ay_2025', termNumber: 3, rawScore: 50 }), // previous year's last term
      mark({ subjectId: 'sub_math', academicYearId: 'ay_2025', termNumber: 2, rawScore: 40 }), // same term, previous year
    ];
  });

  test('compareTo=previousTerm (default) compares against termNumber-1 in the same year', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2 });
    expect(res.body.data.previousPeriod).toEqual({ academicYearId: 'ay_2026', academicYearName: '2026/2027', termNumber: 1 });
    const math = res.body.data.subjects[0];
    expect(math.current.avgPct).toBe(80);
    expect(math.previous.avgPct).toBe(60);
    expect(math.delta).toBe(20);
  });

  test('compareTo=previousTerm at term 1 wraps to the PREVIOUS year\'s last term', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 1 });
    expect(res.body.data.previousPeriod).toEqual({ academicYearId: 'ay_2025', academicYearName: '2025/2026', termNumber: 3 });
  });

  test('compareTo=previousYear compares the SAME termNumber in the prior year', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'previousYear' });
    expect(res.body.data.previousPeriod).toEqual({ academicYearId: 'ay_2025', academicYearName: '2025/2026', termNumber: 2 });
    expect(res.body.data.subjects[0].previous.avgPct).toBe(40);
  });

  test('compareTo=none returns no previous period and no delta', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.body.data.previousPeriod).toBeNull();
    expect(res.body.data.subjects[0].previous).toBeNull();
    expect(res.body.data.subjects[0].delta).toBeNull();
  });

  test('the very first recorded term has nothing earlier to compare against — previousPeriod is null, not an error', async () => {
    mockYears = [YEAR_2026];
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.previousPeriod).toBeNull();
  });
});

describe('GET /api/assessment/analytics — edge cases', () => {
  test('no academic years configured yet -> empty-but-valid response, not an error', async () => {
    mockYears = [];
    const res = await supertest(buildApp()).get('/api/assessment/analytics');
    expect(res.status).toBe(200);
    expect(res.body.data.subjects).toEqual([]);
    expect(res.body.data.currentPeriod).toBeNull();
  });

  test('an invalid academicYearId is rejected, not silently ignored', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_nonexistent' });
    expect(res.status).toBe(400);
  });

  test('subjectId narrows to one subject', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, subjectId: 'sub_eng', compareTo: 'none' });
    expect(res.body.data.subjects.map(s => s.subjectId)).toEqual(['sub_eng']);
  });

  test('passMark is read from academic_config, not hardcoded', async () => {
    mockAcademicConfigDoc = { passMark: 65 };
    // Default fixture: 3 marks total (80, 60, 30) — with passMark 65, only
    // the 80-scorer passes (vs. the 40-default where 80 and 60 both would).
    const res = await supertest(buildApp()).get('/api/assessment/analytics').query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.body.data.passMark).toBe(65);
    expect(res.body.data.overall.passRate).toBeCloseTo(33.3, 1); // 1 of 3 marks passes
  });
});
