/* ============================================================
   server/routes/assessment.js — POST /marks, POST /marks/bulk refuse
   numeric marks for a Kindergarten-template class (v5.290.0)

   Reported live: a KG class's subject left out of its Kindergarten
   template opened as a numeric score grid in the Markbook. A class on a
   template is marked only with competency indicators, for its template's
   subjects; numeric marks never reach the KG report card, so the server
   refuses them, for every role.

   Harness copied from assessment-curriculum-integrity.test.js; all DB
   calls are mocked.
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
const mockResolveRcTemplate = jest.fn(async (_schoolId, classId) => (classId === 'cls_kg' ? { id: 'tpl_kg', name: 'KG Report', subjects: [{ subjectId: 'sub_lang' }] } : null));
jest.mock('../../utils/rc-template-scale', () => ({ resolveRcTemplate: (...a) => mockResolveRcTemplate(...a) }));
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
  mockClassSubjects = [
    { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_math', isCompulsoryForClass: true },
    { schoolId: SCHOOL, classId: 'cls_kg', subjectId: 'sub_cre', isCompulsoryForClass: true },
    { schoolId: SCHOOL, classId: 'cls_kg', subjectId: 'sub_lang', isCompulsoryForClass: true },
  ];
  mockConfigFindOne.mockReturnValue(mockChain(null));
  mockScheduleFindOne.mockReturnValue(mockChain(null));
  mockMarksFindOne.mockReturnValue(mockChain(null));
  mockMarksFind.mockReturnValue(mockChain([]));
  mockMarksFindOneAndUpdate.mockReturnValue(mockChain({ id: 'mark_1' }));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

const VALID_MARK = { studentId: 'stu_1', subjectId: 'sub_math', classId: 'cls_1', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70 };
const KG_MARK    = { ...VALID_MARK, classId: 'cls_kg', subjectId: 'sub_cre' };

describe('POST /api/assessment/marks', () => {
  test('an ordinary class still accepts marks', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(201);
  });

  test.each([
    ['a subject left out of the template (the live case)', 'sub_cre'],
    ['a subject in the template (entered as indicators, never scores)', 'sub_lang'],
  ])('a Kindergarten class refuses scores for %s, even as admin', async (_l, subjectId) => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...KG_MARK, subjectId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Kindergarten class/);
    expect(mockResolveRcTemplate).toHaveBeenCalledWith(SCHOOL, 'cls_kg');
    expect(mockMarksFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('a subject outside the curriculum still gets the curriculum message first', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...KG_MARK, subjectId: 'sub_never_added' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/curriculum/i);
  });
});

describe('POST /api/assessment/marks/bulk', () => {
  test('an ordinary class still accepts a batch', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [VALID_MARK] });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });

  test('a batch with any Kindergarten-class mark is refused entirely', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [VALID_MARK, { ...KG_MARK, studentId: 'stu_2' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Kindergarten class/);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
