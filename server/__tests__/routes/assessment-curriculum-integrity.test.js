/* ============================================================
   server/routes/assessment.js — POST /marks, POST /marks/bulk
   curriculum-integrity guard

   Reported directly (2026-10-15), reproduced exactly: logged in as
   admin, picking a class then a subject the class's curriculum never
   offered, the roster still loaded (the whole class) and marks could
   be entered for it. canWriteSubject/unassignedPairs bypass ALL checks
   for management roles (admin included) — this guard is the ONLY
   thing standing between an admin and writing marks for a subject
   that was never added to the class's curriculum at all, so it must
   apply even to admin.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
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

describe('POST /api/assessment/marks — curriculum integrity, even for admin', () => {
  test('a subject genuinely in the class curriculum is accepted', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(201);
  });

  test('a subject never added to this class\'s curriculum is refused, even as admin', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send({ ...VALID_MARK, subjectId: 'sub_never_added' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/curriculum/i);
    expect(mockMarksFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/assessment/marks/bulk — curriculum integrity, even for admin', () => {
  test('every pair genuinely in the curriculum is accepted', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [VALID_MARK] });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });

  test('a batch containing one out-of-curriculum pair is refused entirely, even as admin', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [VALID_MARK, { ...VALID_MARK, studentId: 'stu_2', subjectId: 'sub_never_added' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sub_never_added/);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
