/* ============================================================
   Regression test — server/routes/assessment.js bulk mark-entry
   conflict detection

   This is the LIVE mark-entry endpoint the actual "Markbook" tab
   (client/src/pages/exams/ExamsPage.jsx) calls — POST
   /api/exams/:id/results (BUG-003's originally-named endpoint) is a
   deliberately-retired flow ("Markbook: schedule-driven unified mark
   entry (replaces Results + CA Marks)", ExamsPage.jsx's own header
   comment) with no reachable client anywhere in the app.

   POST /api/assessment/marks/bulk previously bulk-upserted with no
   version check at all — two teachers saving marks for the same
   student/subject/assessment-type/instance concurrently would
   silently last-write-win, exactly the BUG-003 hazard, just in the
   endpoint teachers actually use today.

   Fix: MarkSchema gained an optional _v (client's last-known
   version), mirroring exam_results/ResultSchema exactly. When
   provided and stale, that mark is excluded from the bulkWrite ops
   and reported in the response's `conflicts` array instead of being
   silently overwritten. Omitting _v (older clients) skips the check
   entirely.

   All DB calls are mocked — no MongoDB required.
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
  firstArchivedYear: jest.fn().mockResolvedValue(null),
}));

/* Existing mark for stu_001/CA/instance 1 is at version 2 — a teacher
   who last read version 1 is stale and must be reported as a
   conflict, not overwritten. No academicYearId on either side, so the
   composite key lines up. */
const EXISTING_MARKS = [
  { studentId: 'stu_001', subjectId: 'subj_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70, _v: 2 },
];

function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }) };
}

const mockConfigFindOne  = jest.fn(() => mockChain(() => null)); // triggers default CA/HW/MT/ET types
const mockConfigCreate   = jest.fn().mockResolvedValue({});
const mockScheduleFindOne = jest.fn(() => mockChain(() => null)); // no locked schedule entry
const mockMarksFindOne   = jest.fn(() => mockChain(() => null));  // no locked mark sample
const mockMarksFind      = jest.fn(() => mockChain(() => EXISTING_MARKS));
const mockBulkWrite      = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config') {
      return { findOne: mockConfigFindOne, create: mockConfigCreate };
    }
    if (collection === 'assessment_schedule') {
      return { findOne: mockScheduleFindOne };
    }
    if (collection === 'assessment_marks') {
      return { findOne: mockMarksFindOne, find: mockMarksFind, bulkWrite: mockBulkWrite };
    }
    return { findOne: jest.fn(() => mockChain(() => null)) };
  }),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigFindOne.mockReturnValue(mockChain(() => null));
  mockConfigCreate.mockResolvedValue({});
  mockScheduleFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFind.mockReturnValue(mockChain(() => EXISTING_MARKS));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

describe('POST /api/assessment/marks/bulk — optimistic concurrency (BUG-003, live endpoint)', () => {
  test('a stale _v is reported as a conflict and excluded from the write, a fresh mark still writes', async () => {
    const app = buildApp();

    const res = await supertest(app)
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          // Stale — existing _v is 2, this client last read version 1
          { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 85, _v: 1 },
          // New student/mark, no existing record, no _v sent — writes normally
          { studentId: 'stu_002', subjectId: 'subj_001', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 60 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0]).toMatchObject({
      studentId: 'stu_001',
      yourVersion: 1,
      currentVersion: 2,
      currentRawScore: 70,
    });

    // Only the non-conflicting mark (stu_002) should have been sent to bulkWrite
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const ops = mockBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter.studentId).toBe('stu_002');
  });

  test('omitting _v entirely writes normally with no conflicts — unchanged behavior for existing clients', async () => {
    const app = buildApp();

    const res = await supertest(app)
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 85 }, // no _v
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toHaveLength(0);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    expect(mockBulkWrite.mock.calls[0][0]).toHaveLength(1);
  });

  test('a batch that is entirely conflicts skips bulkWrite altogether (no ops to send)', async () => {
    const app = buildApp();

    const res = await supertest(app)
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 85, _v: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
