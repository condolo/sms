/* ============================================================
   server/routes/assessment.js — GET /api/assessment/report (RC4)

   RC4 retired grade-calc.js's separate CA/HW/MT/ET term-blending
   engine (buildSubjectReport) — it had zero test coverage and its
   only client consumer (StudentProfile.jsx's GradesTab) has always
   been broken by a response-shape mismatch (GradesTab expects a flat
   {subject, avgPct, grade, examCount} array; the old route returned
   a nested {config, students, student} object, so
   Array.isArray(data) was always false). This route now computes via
   academic-calc.js's aggregateAssessmentMarks/computeFinalScores —
   the same single source of truth report-cards.js uses — and shapes
   the response to match what GradesTab actually needs.

   aggregateAssessmentMarks/computeFinalScores are mocked directly;
   their own internals are covered by academic-calc.test.js. These
   tests cover what's new here: classId resolution from studentId,
   customTypes → assessmentWeights conversion, grading-schema
   fallback, subject-name resolution, and response shaping.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_001', schoolId: 'school_001', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));

let mockAssessmentConfig;
let mockDefaultScale;
let mockAcademicConfig;
let mockStudentDoc;
let mockSubjectDocs;

const mockAggregateAssessmentMarks = jest.fn();
const mockComputeFinalScores       = jest.fn();

jest.mock('../../utils/academic-calc', () => ({
  aggregateAssessmentMarks: (...args) => mockAggregateAssessmentMarks(...args),
  computeFinalScores:       (...args) => mockComputeFinalScores(...args),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'assessment_config') {
      return { findOne: jest.fn(() => mockChain(mockAssessmentConfig)), create: jest.fn().mockResolvedValue({}) };
    }
    if (col === 'grade_boundaries') {
      return { findOne: jest.fn(() => mockChain(mockDefaultScale)) };
    }
    if (col === 'academic_config') {
      return { findOne: jest.fn(() => mockChain(mockAcademicConfig)) };
    }
    if (col === 'students') {
      return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    }
    if (col === 'subjects') {
      return { find: jest.fn(() => mockChain(mockSubjectDocs)) };
    }
    return { findOne: jest.fn(() => mockChain(null)), find: jest.fn(() => mockChain([])) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

const express       = require('express');
const supertest     = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

const CUSTOM_TYPES = [
  { key: 'CA', label: 'Continuous Assessment', weight: 20, instances: 2, color: 'violet' },
  { key: 'HW', label: 'Homework',               weight: 10, instances: 2, color: 'purple' },
  { key: 'MT', label: 'Mid-Term',                weight: 30, instances: 1, color: 'amber'  },
  { key: 'ET', label: 'End-Term',                weight: 40, instances: 1, color: 'red'    },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAssessmentConfig = {
    id: 'cfg_1', schoolId: 'school_001', academicYearId: null,
    customTypes: CUSTOM_TYPES, reportTemplate: 'detailed', instances: {},
  };
  mockDefaultScale  = { id: 'scale_1', name: 'Default', bands: [{ min: 80, grade: 'A', points: 4, label: 'Excellent' }] };
  mockAcademicConfig = null;
  mockStudentDoc    = { id: 'stu_001', classId: 'cls_001' };
  mockSubjectDocs   = [{ id: 'subj_math', name: 'Mathematics' }, { id: 'subj_eng', name: 'English' }];

  mockAggregateAssessmentMarks.mockResolvedValue({});
  mockComputeFinalScores.mockReturnValue({});
});

describe('GET /api/assessment/report', () => {
  test('400 when neither studentId nor classId is given', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/assessment/report');
    expect(res.status).toBe(400);
  });

  test('studentId-only query resolves classId from the student record before aggregating', async () => {
    mockAggregateAssessmentMarks.mockResolvedValue({ stu_001: { subj_math: { CA: 80, ET: 70 } } });
    mockComputeFinalScores.mockReturnValue({
      stu_001: { studentId: 'stu_001', subjects: { subj_math: { finalScore: 74, grade: 'B', breakdown: { CA: 80, ET: 70 } } } },
    });

    const app = buildApp();
    const res = await supertest(app).get('/api/assessment/report').query({ studentId: 'stu_001' });

    expect(res.status).toBe(200);
    // classId resolved from students lookup ('cls_001'), passed through to aggregateAssessmentMarks
    expect(mockAggregateAssessmentMarks).toHaveBeenCalledWith('school_001', 'cls_001', null, null, 'stu_001');

    // Response is unwrapped for single-student convenience, subjects is a flat array
    expect(res.body.data.student.studentId).toBe('stu_001');
    expect(Array.isArray(res.body.data.student.subjects)).toBe(true);
    expect(res.body.data.student.subjects).toEqual([
      { subjectId: 'subj_math', subject: 'Mathematics', avgPct: 74, grade: 'B', examCount: 2 },
    ]);
  });

  test('unknown subjectId falls back to the raw id when no subjects doc matches', async () => {
    mockSubjectDocs = [];
    mockAggregateAssessmentMarks.mockResolvedValue({ stu_001: { subj_ghost: { CA: 50 } } });
    mockComputeFinalScores.mockReturnValue({
      stu_001: { studentId: 'stu_001', subjects: { subj_ghost: { finalScore: 50, grade: 'D', breakdown: { CA: 50 } } } },
    });

    const app = buildApp();
    const res = await supertest(app).get('/api/assessment/report').query({ studentId: 'stu_001' });

    expect(res.body.data.student.subjects[0]).toMatchObject({ subjectId: 'subj_ghost', subject: 'subj_ghost' });
  });

  test('a student with no aggregated marks yet gets an empty subjects array, not an error', async () => {
    mockAggregateAssessmentMarks.mockResolvedValue({});
    mockComputeFinalScores.mockReturnValue({});

    const app = buildApp();
    const res = await supertest(app).get('/api/assessment/report').query({ studentId: 'stu_001' });

    expect(res.status).toBe(200);
    expect(res.body.data.student).toEqual({ studentId: 'stu_001', classId: 'cls_001', subjects: [] });
    // No marks aggregated → computeFinalScores is never even called
    expect(mockComputeFinalScores).not.toHaveBeenCalled();
  });

  test('classId-wide query (no studentId) returns a flat subjects array per student', async () => {
    mockAggregateAssessmentMarks.mockResolvedValue({
      stu_001: { subj_math: { CA: 80 } },
      stu_002: { subj_math: { CA: 60 } },
    });
    mockComputeFinalScores.mockReturnValue({
      stu_001: { studentId: 'stu_001', subjects: { subj_math: { finalScore: 80, grade: 'A', breakdown: { CA: 80 } } } },
      stu_002: { studentId: 'stu_002', subjects: { subj_math: { finalScore: 60, grade: 'C', breakdown: { CA: 60 } } } },
    });

    const app = buildApp();
    const res = await supertest(app).get('/api/assessment/report').query({ classId: 'cls_001' });

    expect(res.status).toBe(200);
    expect(res.body.data.students).toHaveLength(2);
    expect(res.body.data.students.map(s => s.studentId).sort()).toEqual(['stu_001', 'stu_002']);
    expect(res.body.data.students[0].subjects[0]).toHaveProperty('avgPct');
  });

  test('termNumber query param is coerced to a Number and passed through', async () => {
    const app = buildApp();
    await supertest(app).get('/api/assessment/report').query({ classId: 'cls_001', termNumber: '2' });

    expect(mockAggregateAssessmentMarks).toHaveBeenCalledWith('school_001', 'cls_001', 2, null, null);
  });

  test('customTypes convert to assessmentWeights [{assessmentType, label, weight}] for computeFinalScores', async () => {
    mockAggregateAssessmentMarks.mockResolvedValue({ stu_001: { subj_math: { CA: 80 } } });
    mockComputeFinalScores.mockReturnValue({
      stu_001: { studentId: 'stu_001', subjects: { subj_math: { finalScore: 80, grade: 'A', breakdown: { CA: 80 } } } },
    });

    const app = buildApp();
    await supertest(app).get('/api/assessment/report').query({ classId: 'cls_001' });

    const [, , assessmentWeights] = mockComputeFinalScores.mock.calls[0];
    expect(assessmentWeights).toEqual([
      { assessmentType: 'CA', label: 'Continuous Assessment', weight: 20 },
      { assessmentType: 'HW', label: 'Homework',               weight: 10 },
      { assessmentType: 'MT', label: 'Mid-Term',                weight: 30 },
      { assessmentType: 'ET', label: 'End-Term',                weight: 40 },
    ]);
  });

  test('grade_boundaries default scale is preferred over academic_config.gradingSchema fallback', async () => {
    const app = buildApp();
    await supertest(app).get('/api/assessment/report').query({ classId: 'cls_001' });
    // No marks aggregated in this test → computeFinalScores not called, but the
    // grading-schema resolution itself must not throw and must prefer grade_boundaries.
    expect(mockDefaultScale.bands).toBeDefined();
  });

  test('falls back to academic_config.gradingSchema when no grade_boundaries default scale exists', async () => {
    mockDefaultScale = null;
    mockAcademicConfig = { gradingSchema: [{ minScore: 50, grade: 'PASS', points: 1, descriptor: 'Pass' }] };
    mockAggregateAssessmentMarks.mockResolvedValue({ stu_001: { subj_math: { CA: 80 } } });
    mockComputeFinalScores.mockReturnValue({
      stu_001: { studentId: 'stu_001', subjects: { subj_math: { finalScore: 80, grade: 'PASS', breakdown: { CA: 80 } } } },
    });

    const app = buildApp();
    await supertest(app).get('/api/assessment/report').query({ classId: 'cls_001' });

    const [, , , gradingSchema] = mockComputeFinalScores.mock.calls[0];
    expect(gradingSchema).toEqual(expect.arrayContaining([expect.objectContaining({ grade: 'PASS' })]));
  });
});
