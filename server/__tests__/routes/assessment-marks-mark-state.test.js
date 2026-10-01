/* ============================================================
   server/routes/assessment.js — POST /marks, POST /marks/bulk
   markState (present/ABS/MIS/EXM/INC)

   Part of consolidating all mark entry into the Markbook: assessment_marks
   previously had no way to represent absent/missing/exempt/incomplete —
   only a bare required rawScore — unlike exam_results, which the Markbook
   is replacing. markState (shared vocabulary, server/utils/mark-states.js)
   closes that gap. A non-present mark carries no rawScore, nulled
   server-side regardless of what a client sends, so a stale typed score
   can never masquerade as a real one once the cell is marked absent/etc.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_teacher_001', schoolId: 'school_test_001', role: 'teacher', roles: ['teacher'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({
  isYearArchived: jest.fn().mockResolvedValue(false),
  firstArchivedYear: jest.fn().mockResolvedValue(null),
}));

function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }), sort: () => ({ lean }) };
}

const mockConfigFindOne   = jest.fn(() => mockChain(() => null)); // default CA/HW/MT/ET types
const mockScheduleFindOne = jest.fn(() => mockChain(() => null));
const mockMarksFindOne    = jest.fn(() => mockChain(() => null));
const mockMarksFind       = jest.fn(() => mockChain(() => []));
const mockMarksUpdate     = jest.fn(() => mockChain(() => ({ id: 'mk_1' })));
const mockBulkWrite       = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config')   return { findOne: mockConfigFindOne, create: jest.fn().mockResolvedValue({}) };
    if (collection === 'assessment_schedule') return { findOne: mockScheduleFindOne };
    if (collection === 'assessment_marks') {
      return { findOne: mockMarksFindOne, find: mockMarksFind, findOneAndUpdate: mockMarksUpdate, bulkWrite: mockBulkWrite };
    }
    if (collection === 'teaching_assignments') {
      return {
        findOne: jest.fn(() => mockChain(() => ({ id: 'ta_1' }))),
        find:    jest.fn(() => mockChain(() => [{ classId: 'cls_001', subjectId: 'subj_001' }])),
      };
    }
    return { findOne: jest.fn(() => mockChain(() => null)), find: jest.fn(() => mockChain(() => [])) };
  }),
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
  mockConfigFindOne.mockReturnValue(mockChain(() => null));
  mockScheduleFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFind.mockReturnValue(mockChain(() => []));
  mockMarksUpdate.mockReturnValue(mockChain(() => ({ id: 'mk_1' })));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

const BASE = { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1 };

describe('POST /api/assessment/marks — markState', () => {
  test('omitting markState defaults to "present" and requires rawScore — unchanged behavior', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...BASE, rawScore: 72 });
    expect(res.status).toBe(201);
    expect(mockMarksUpdate).toHaveBeenCalled();
    const setDoc = mockMarksUpdate.mock.calls[0][1].$set;
    expect(setDoc.rawScore).toBe(72);
    expect(setDoc.markState).toBe('present');
  });

  test('markState "present" with no rawScore is rejected — a real score is required', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...BASE, markState: 'present' });
    expect(res.status).toBe(400);
  });

  test('markState "ABS" needs no rawScore, and any rawScore sent is nulled server-side', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...BASE, markState: 'ABS', rawScore: 99 });
    expect(res.status).toBe(201);
    const setDoc = mockMarksUpdate.mock.calls[0][1].$set;
    expect(setDoc.markState).toBe('ABS');
    expect(setDoc.rawScore).toBeNull();
  });

  test.each(['MIS', 'EXM', 'INC'])('markState "%s" is accepted with no rawScore', async (state) => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...BASE, markState: state });
    expect(res.status).toBe(201);
    expect(mockMarksUpdate.mock.calls[0][1].$set.markState).toBe(state);
  });

  test('an invalid markState is rejected', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...BASE, markState: 'LATE' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/assessment/marks/bulk — markState', () => {
  test('a mix of present and non-present marks in one batch are each stored correctly', async () => {
    const res = await supertest(buildApp())
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          { ...BASE, studentId: 'stu_001', rawScore: 85 },
          { ...BASE, studentId: 'stu_002', markState: 'ABS', rawScore: 40 }, // rawScore must be dropped
          { ...BASE, studentId: 'stu_003', markState: 'EXM' },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const ops = mockBulkWrite.mock.calls[0][0];
    const byStudent = Object.fromEntries(ops.map(o => [o.updateOne.filter.studentId, o.updateOne.update.$set]));

    expect(byStudent.stu_001.markState).toBe('present');
    expect(byStudent.stu_001.rawScore).toBe(85);

    expect(byStudent.stu_002.markState).toBe('ABS');
    expect(byStudent.stu_002.rawScore).toBeNull();

    expect(byStudent.stu_003.markState).toBe('EXM');
    expect(byStudent.stu_003.rawScore).toBeNull();
  });

  test('a batch entry with markState "present" and no rawScore fails validation for the whole batch', async () => {
    const res = await supertest(buildApp())
      .post('/api/assessment/marks/bulk')
      .send({ marks: [{ ...BASE, markState: 'present' }] });
    expect(res.status).toBe(400);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
