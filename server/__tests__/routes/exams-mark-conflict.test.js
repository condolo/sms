/* ============================================================
   Regression test — server/routes/exams.js mark-entry conflict detection

   BUG-003 (see docs/governance/ARCHITECTURE_GOVERNANCE_REVIEW_v1.md):
   POST /:id/results bulk-upserted with no version check — two teachers
   saving marks for the same student concurrently silently last-write-wins,
   with no conflict surfaced to either party.

   Fix: ResultSchema gained an optional _v (client's last-known version).
   When provided and stale, that specific result is excluded from the
   bulkWrite ops and reported in the response's `conflicts` array instead
   of being silently overwritten. Omitting _v (as every client does today)
   skips the check entirely — no behavior change for existing clients.

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

/* Existing result for stu_001 is at version 2 — a teacher who last read
   version 1 is stale and must be reported as a conflict, not overwritten. */
const EXISTING_RESULTS = [
  { studentId: 'stu_001', score: 70, markState: 'present', absent: false, _v: 2 },
];

const mockExamFindOne = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(EXAM) }));
const mockResultsFind = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(EXISTING_RESULTS) }));
const mockBulkWrite   = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
const mockAuditInsertMany = jest.fn().mockResolvedValue({});
const mockExamUpdateOne = jest.fn().mockResolvedValue({});

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
  mockExamFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(EXAM) });
  mockResultsFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(EXISTING_RESULTS) });
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

describe('POST /api/exams/:id/results — optimistic concurrency (BUG-003)', () => {
  test('a stale _v is reported as a conflict and excluded from the write, a fresh result still writes', async () => {
    const app = buildApp();

    const res = await supertest(app)
      .post('/api/exams/exam_001/results')
      .send({
        results: [
          // Stale — existing _v is 2, this client last read version 1
          { studentId: 'stu_001', score: 85, markState: 'present', _v: 1 },
          // New student, no existing record, no _v sent — writes normally
          { studentId: 'stu_002', score: 60, markState: 'present' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0]).toMatchObject({
      studentId: 'stu_001',
      yourVersion: 1,
      currentVersion: 2,
      currentScore: 70,
    });

    // Only the non-conflicting result (stu_002) should have been sent to bulkWrite
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const ops = mockBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter.studentId).toBe('stu_002');
  });

  test('omitting _v entirely writes normally with no conflicts — unchanged behavior for existing clients', async () => {
    const app = buildApp();

    const res = await supertest(app)
      .post('/api/exams/exam_001/results')
      .send({
        results: [
          { studentId: 'stu_001', score: 85, markState: 'present' }, // no _v at all
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.conflicts).toHaveLength(0);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    expect(mockBulkWrite.mock.calls[0][0]).toHaveLength(1);
  });
});
