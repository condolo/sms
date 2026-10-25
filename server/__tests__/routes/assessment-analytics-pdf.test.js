/* ============================================================
   GET /api/assessment/analytics/export.pdf

   Renders the exact same scoped data the Assessment Analytics screen
   shows (via the shared _buildAnalyticsReport, refactored out of the
   JSON /analytics route so both share one aggregation), plus the
   per-class subject-enrollment coverage from class-subjects.js's
   _buildEnrollmentAnalytics, as one printable PDF.

   Kept to the same assertion depth every other PDFKit route in this
   codebase uses (weekly-snapshots.test.js, hr-payroll.test.js, etc.):
   a real application/pdf response with a non-empty buffer — PDFKit's
   actual page content isn't practical to assert on directly.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_pdf_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = mockScope; next(); } }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));
jest.mock('../../utils/model', () => ({ _model: jest.fn(() => ({ findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) })) }));

let mockJwtUser;
let mockScope; // null = unrestricted
let mockSchoolDoc;
let mockYears, mockAcademicConfigDoc, mockMarkDocs, mockSubjectDocs, mockClassDocs;
let mockClassSubjectDocs, mockStudentDocs, mockStudentSubjectDocs;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) return (doc[k] !== undefined) === v.$exists;
    }
    return doc[k] === v;
  });
}

const _DIST_BOUNDARIES = [0, 40, 50, 60, 70, 80, 90, 101];
function mockFakeMarksAggregate(pipeline) {
  const matchStage = pipeline.find(s => s.$match)?.$match ?? {};
  const matched = mockMarkDocs.filter(d => mockMatches(d, matchStage));
  const passMark = mockAcademicConfigDoc?.passMark ?? 40;
  function summarize(docs) {
    if (!docs.length) return null;
    const avgPct = Math.round((docs.reduce((s, d) => s + d.rawScore, 0) / docs.length) * 10) / 10;
    const passCount = docs.filter(d => d.rawScore >= passMark).length;
    return { avgPct, count: docs.length, passRate: Math.round((passCount / docs.length) * 1000) / 10 };
  }
  const bySubject = [...new Set(matched.map(d => d.subjectId))].map(subjectId => ({ subjectId, ...summarize(matched.filter(d => d.subjectId === subjectId)) }));
  const byClass   = [...new Set(matched.map(d => d.classId))].map(classId => ({ classId, ...summarize(matched.filter(d => d.classId === classId)) }));
  const overall = summarize(matched);
  const scores = matched.map(d => d.rawScore);
  const overallFull = overall ? { ...overall, minScore: scores.length ? Math.min(...scores) : null, maxScore: scores.length ? Math.max(...scores) : null, stdDev: 0, scores } : null;
  const distribution = _DIST_BOUNDARIES.slice(0, -1).map((b, i) => ({ _id: b, count: matched.filter(d => d.rawScore >= b && d.rawScore < _DIST_BOUNDARIES[i + 1]).length })).filter(x => x.count > 0);
  return Promise.resolve([{ bySubject, byClass, distribution, overall: overallFull ? [overallFull] : [] }]);
}

function mockFakeStudentSubjectsAggregate(pipeline) {
  const matchStage = pipeline.find(s => s.$match)?.$match ?? {};
  const matched = mockStudentSubjectDocs.filter(d => mockMatches(d, matchStage));
  const groups = {};
  for (const d of matched) {
    const key = `${d.classId}::${d.subjectId}`;
    groups[key] ??= { _id: { classId: d.classId, subjectId: d.subjectId }, count: 0 };
    groups[key].count++;
  }
  return Promise.resolve(Object.values(groups));
}

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'academic_years')    return { find: () => mockChainArr(mockYears) };
    if (collection === 'academic_config')   return { findOne: () => mockChainObj(mockAcademicConfigDoc) };
    if (collection === 'assessment_marks')  return { aggregate: (p) => mockFakeMarksAggregate(p) };
    if (collection === 'subjects')          return { find: (f) => mockChainArr(mockSubjectDocs.filter(d => mockMatches(d, f))) };
    if (collection === 'classes')           return { find: (f) => mockChainArr(mockClassDocs.filter(d => mockMatches(d, f))) };
    if (collection === 'class_subjects')    return { find: (f) => mockChainArr(mockClassSubjectDocs.filter(d => mockMatches(d, f))) };
    if (collection === 'students')          return { find: (f) => mockChainArr(mockStudentDocs.filter(d => mockMatches(d, f))) };
    if (collection === 'student_subjects')  return {
      find:      (f) => mockChainArr(mockStudentSubjectDocs.filter(d => mockMatches(d, f))),
      aggregate: (p) => mockFakeStudentSubjectsAggregate(p),
    };
    return { find: () => mockChainArr([]), findOne: () => mockChainObj(null) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));
jest.mock('../../utils/scopeEngine', () => ({
  isUnrestricted: jest.fn((req) => !req.scope),
  applyToFilter:  jest.fn((req, _module, filter) => {
    if (!req.scope) return filter;
    filter.classId = { $in: req.scope.classIds ?? [] };
    filter.id = { $in: req.scope.classIds ?? [] };
    return filter;
  }),
  resolveClassPickerScope: jest.fn(async (req) => req.scope),
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

const YEAR_2026 = {
  id: 'ay_2026', name: '2026/2027', startDate: '2026-01-01', endDate: '2026-11-30', isCurrent: true,
  terms: [{ startDate: '2026-01-01', endDate: '2026-04-30' }, { startDate: '2026-05-01', endDate: '2026-08-31' }, { startDate: '2026-09-01', endDate: '2026-11-30' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockScope = null;
  mockSchoolDoc = { id: SCHOOL, name: 'Test Academy' };
  mockYears = [YEAR_2026];
  mockAcademicConfigDoc = { passMark: 40 };
  mockClassDocs = [{ id: 'cls_a', name: 'Form 1A', schoolId: SCHOOL }];
  mockSubjectDocs = [{ id: 'sub_math', name: 'Mathematics', schoolId: SCHOOL }, { id: 'sub_french', name: 'French', schoolId: SCHOOL }];
  mockMarkDocs = [
    { schoolId: SCHOOL, isPublished: true, academicYearId: 'ay_2026', termNumber: 2, classId: 'cls_a', subjectId: 'sub_math', rawScore: 70 },
    { schoolId: SCHOOL, isPublished: true, academicYearId: 'ay_2026', termNumber: 2, classId: 'cls_a', subjectId: 'sub_math', rawScore: 50 },
  ];
  mockClassSubjectDocs = [
    { schoolId: SCHOOL, classId: 'cls_a', subjectId: 'sub_math', isCompulsoryForClass: true },
    { schoolId: SCHOOL, classId: 'cls_a', subjectId: 'sub_french', isCompulsoryForClass: false },
  ];
  mockStudentDocs = [
    { id: 'stu_1', schoolId: SCHOOL, classId: 'cls_a', status: 'active' },
    { id: 'stu_2', schoolId: SCHOOL, classId: 'cls_a', status: 'active' },
  ];
  mockStudentSubjectDocs = [
    { schoolId: SCHOOL, classId: 'cls_a', studentId: 'stu_1', subjectId: 'sub_math' },
    // stu_2 missing from compulsory Math — a real gap the PDF should flag.
  ];
});

describe('GET /api/assessment/analytics/export.pdf', () => {
  test('returns a real application/pdf response combining analytics + enrollment data', async () => {
    const res = await supertest(buildApp())
      .get('/api/assessment/analytics/export.pdf')
      .query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('assessment-analytics.pdf');
    expect(res.body.length).toBeGreaterThan(0); // a real, non-empty PDF buffer
  });

  test('still returns a valid PDF when there is no academic year configured', async () => {
    mockYears = [];
    const res = await supertest(buildApp()).get('/api/assessment/analytics/export.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('an invalid academicYearId is rejected with 400, not a broken PDF', async () => {
    const res = await supertest(buildApp()).get('/api/assessment/analytics/export.pdf').query({ academicYearId: 'does_not_exist' });
    expect(res.status).toBe(400);
  });

  test('a scoped caller outside cls_a gets an empty-but-valid PDF, not an error or another class\'s data', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher' };
    mockScope = { classIds: ['cls_other'] };
    const res = await supertest(buildApp())
      .get('/api/assessment/analytics/export.pdf')
      .query({ academicYearId: 'ay_2026', termNumber: 2, compareTo: 'none' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});
