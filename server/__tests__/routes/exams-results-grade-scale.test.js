/* ============================================================
   Regression test — server/routes/exams.js POST /:id/results grade calc

   Bug found while building the exam results-entry UI: _calcGrade()
   read a per-exam `exam.gradeScale` field that no route anywhere ever
   set, so grade/percentage/points were silently null on every exam
   result ever entered. Fixed to resolve the school's live grading
   scale the same way assessment.js/report-cards.js do: grade_boundaries'
   default scale, falling back to academic_config.gradingSchema.

   All DB calls are mocked — no MongoDB required.
   Run: npm test
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_teacher_001', schoolId: 'school_test_001', role: 'teacher', roles: ['teacher'] };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/plan', () => ({
  planGate: () => (_req, _res, next) => next(),
}));

jest.mock('../../utils/archival', () => ({
  isYearArchived: jest.fn().mockResolvedValue(false),
}));

const EXAM = {
  id: 'exam_001',
  schoolId: 'school_test_001',
  classId: 'cls_001',
  subjectId: 'subj_001',
  academicYearId: 'ay_001',
  status: 'in_progress',
  maxScore: 100,
  ownerId: null,
};

const DEFAULT_SCALE = {
  isDefault: true,
  bands: [
    { grade: 'A', min: 80, points: 12, label: 'Exceeding' },
    { grade: 'B', min: 65, points: 9,  label: 'Meeting' },
    { grade: 'C', min: 50, points: 6,  label: 'Approaching' },
    { grade: 'D', min: 0,  points: 3,  label: 'Below' },
  ],
};

let mockScale = DEFAULT_SCALE;
let mockAcademicCfg = null;

const mockExamFindOne     = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(EXAM) }));
const mockResultsFind     = jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) }));
const mockBulkWrite       = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
const mockAuditInsertMany = jest.fn().mockResolvedValue({});
const mockExamUpdateOne   = jest.fn().mockResolvedValue({});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'exams') {
      return { findOne: mockExamFindOne, updateOne: mockExamUpdateOne };
    }
    if (collection === 'exam_results') {
      return { find: mockResultsFind, bulkWrite: mockBulkWrite };
    }
    if (collection === 'mark_audit_log') {
      return { create: jest.fn().mockResolvedValue({}), insertMany: mockAuditInsertMany };
    }
    if (collection === 'grade_boundaries') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn(() => Promise.resolve(mockScale)) }) };
    }
    if (collection === 'academic_config') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn(() => Promise.resolve(mockAcademicCfg)) }) };
    }
    return {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    };
  }),
}));

const express     = require('express');
const supertest   = require('supertest');
const examsRouter = require('../../routes/exams');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScale = DEFAULT_SCALE;
  mockAcademicCfg = null;
  mockExamFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(EXAM) });
  mockResultsFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

describe('POST /api/exams/:id/results — grade computed from the live school scale', () => {
  test('grade_boundaries default scale is used when present', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/exams/exam_001/results')
      .send({ results: [{ studentId: 'stu_001', score: 82, markState: 'present' }] });

    expect(res.status).toBe(201);
    const ops = mockBulkWrite.mock.calls[0][0];
    const setFields = ops[0].updateOne.update.$set;
    // 82/100 = 82% -> band A (min 80)
    expect(setFields.percentage).toBe(82);
    expect(setFields.grade).toBe('A');
    expect(setFields.points).toBe(12);
  });

  test('falls back to academic_config.gradingSchema when no grade_boundaries default exists', async () => {
    mockScale = null;
    mockAcademicCfg = {
      gradingSchema: [
        { grade: 'X', minScore: 0,  maxScore: 100, points: 1 }, // deliberately distinct from DEFAULT_SCALE
      ],
    };
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/exams/exam_001/results')
      .send({ results: [{ studentId: 'stu_001', score: 50, markState: 'present' }] });

    expect(res.status).toBe(201);
    const setFields = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(setFields.grade).toBe('X');
    expect(setFields.points).toBe(1);
  });

  test('a present result with a score always gets a non-null grade (regression: was always null before the fix)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/exams/exam_001/results')
      .send({ results: [{ studentId: 'stu_001', score: 55, markState: 'present' }] });

    expect(res.status).toBe(201);
    const setFields = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(setFields.grade).not.toBeNull();
    expect(setFields.percentage).not.toBeNull();
  });

  test('absent results still get no score/grade (markState ABS)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/exams/exam_001/results')
      .send({ results: [{ studentId: 'stu_001', markState: 'ABS' }] });

    expect(res.status).toBe(201);
    const setFields = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(setFields.score).toBeNull();
    expect(setFields.grade).toBeUndefined();
  });
});
