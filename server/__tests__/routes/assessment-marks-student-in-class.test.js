/* ============================================================
   server/routes/assessment.js — POST /marks and /marks/bulk refuse a
   student who isn't in this school, or isn't (and never was) in the
   mark's class (v5.291.0). The rule itself is tested in
   __tests__/utils/mark-students.test.js; this checks the routes use it,
   answer clearly and write nothing. Harness from
   assessment-curriculum-integrity.test.js; all DB calls are mocked.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

// Student-in-class check (v5.291.0) is covered by mark-students.test.js; stubbed here.
jest.mock("../../utils/mark-students", () => ({ studentClassProblems: async () => [] }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
const mockProblems = jest.fn(async () => []);
jest.mock('../../utils/mark-students', () => ({ studentClassProblems: (...a) => mockProblems(...a) }));
jest.mock('../../utils/archival', () => ({
  isYearArchived: jest.fn().mockResolvedValue(false),
  firstArchivedYear: jest.fn().mockResolvedValue(null),
}));

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockClassSubjects;
const mockConfigFindOne   = jest.fn(() => mockChain(null)); // default CA/HW/MT/ET types
const mockScheduleFindOne = jest.fn(() => mockChain(null));
const mockMarksFindOne    = jest.fn(() => mockChain(null));
const mockMarksFind       = jest.fn(() => mockChain([]));
const mockMarksFindOneAndUpdate = jest.fn(() => mockChain({ id: 'mark_1' }));
const mockBulkWrite       = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config')   return { findOne: mockConfigFindOne, create: jest.fn().mockResolvedValue({}) };
    if (collection === 'assessment_schedule') return { findOne: mockScheduleFindOne };
    if (collection === 'assessment_marks') {
      return { findOne: mockMarksFindOne, find: mockMarksFind, findOneAndUpdate: mockMarksFindOneAndUpdate, bulkWrite: mockBulkWrite };
    }
    if (collection === 'class_subjects') {
      return {
        findOne: (filter) => mockChain(mockClassSubjects.find(d => d.classId === filter.classId && d.subjectId === filter.subjectId) ?? null),
        find: (filter) => mockChain(mockClassSubjects.filter(d => (filter.$or ?? []).some(o => o.classId === d.classId && o.subjectId === d.subjectId))),
      };
    }
    return { findOne: jest.fn(() => mockChain(null)), find: jest.fn(() => mockChain([])) };
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
  mockClassSubjects = [{ schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_math', isCompulsoryForClass: true }];
  mockConfigFindOne.mockReturnValue(mockChain(null));
  mockScheduleFindOne.mockReturnValue(mockChain(null));
  mockMarksFindOne.mockReturnValue(mockChain(null));
  mockMarksFind.mockReturnValue(mockChain([]));
  mockMarksFindOneAndUpdate.mockReturnValue(mockChain({ id: 'mark_1' }));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

const VALID_MARK = { studentId: 'stu_1', subjectId: 'sub_math', classId: 'cls_1', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70 };

describe('POST /api/assessment/marks', () => {
  test('a student of the class is saved; the check is asked about that student and class', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(201);
    expect(mockProblems).toHaveBeenCalledWith({ schoolId: SCHOOL }, SCHOOL, [{ studentId: 'stu_1', classId: 'cls_1' }]);
  });

  test('a student id that does not exist → 400, nothing saved', async () => {
    mockProblems.mockResolvedValueOnce([{ studentId: 'NOPE', classId: 'cls_1', problem: 'not_found' }]);
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...VALID_MARK, studentId: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This student is not in this school.');
    expect(mockMarksFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('a student of another class → 400, nothing saved', async () => {
    mockProblems.mockResolvedValueOnce([{ studentId: 'stu_1', classId: 'cls_1', problem: 'other_class' }]);
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not in this class, now or in an earlier year/);
    expect(mockMarksFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/assessment/marks/bulk', () => {
  test('one problem refuses the whole batch and names the students', async () => {
    mockProblems.mockResolvedValueOnce([
      { studentId: 'NOPE', classId: 'cls_1', problem: 'not_found' },
      { studentId: 'stu_9', classId: 'cls_1', problem: 'other_class' },
    ]);
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [VALID_MARK, { ...VALID_MARK, studentId: 'NOPE' }, { ...VALID_MARK, studentId: 'stu_9' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nothing was saved. Students not in this school: NOPE; not in this class, now or in an earlier year: stu_9. Reload the class list and try again.');
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('each student/class pair is checked once', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [VALID_MARK, { ...VALID_MARK, assessmentType: 'HW' }],
    });
    expect(res.status).toBe(200);
    expect(mockProblems.mock.calls[0][2]).toEqual([{ studentId: 'stu_1', classId: 'cls_1' }]);
  });
});
