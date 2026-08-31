/* ============================================================
   server/routes/assessment.js — subject-teacher scope enforcement
   (RC6, via server/utils/subject-scope.js)

   POST /marks and POST /marks/bulk previously let any user with
   grades:create write a mark for ANY subject/class combination —
   academic_config.subjectAssignmentEnforced existed since it was
   added to the schema but nothing ever read it. These tests cover
   the new enforcement wired into both write routes.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

let mockCurrentUser = { userId: 'usr_teacher_1', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({
  isYearArchived: jest.fn().mockResolvedValue(false),
  firstArchivedYear: jest.fn().mockResolvedValue(null),
}));

function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }) };
}

let mockAcademicConfig;
let mockAssignmentDocs;

const mockConfigFindOne   = jest.fn(() => mockChain(() => null)); // triggers default CA/HW/MT/ET types
const mockConfigCreate    = jest.fn().mockResolvedValue({});
const mockScheduleFindOne = jest.fn(() => mockChain(() => null));
const mockMarksFindOne    = jest.fn(() => mockChain(() => null));
const mockMarksFind       = jest.fn(() => mockChain(() => []));
const mockMarksFindOneAndUpdate = jest.fn(() => mockChain(() => ({ id: 'mark_1' })));
const mockBulkWrite       = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config') {
      return { findOne: mockConfigFindOne, create: mockConfigCreate };
    }
    if (collection === 'assessment_schedule') {
      return { findOne: mockScheduleFindOne };
    }
    if (collection === 'assessment_marks') {
      return { findOne: mockMarksFindOne, find: mockMarksFind, findOneAndUpdate: mockMarksFindOneAndUpdate, bulkWrite: mockBulkWrite };
    }
    if (collection === 'academic_config') {
      return { findOne: jest.fn(() => mockChain(() => mockAcademicConfig)) };
    }
    if (collection === 'teaching_assignments') {
      return {
        find:    jest.fn(() => mockChain(() => mockAssignmentDocs)),
        findOne: jest.fn(() => mockChain(() => mockAssignmentDocs[0] ?? null)),
      };
    }
    // 'students' — resolved by assessment.js's POST /marks(/bulk) to
    // denormalize/scope-check streamId (Milestone 2); no test here cares
    // about actual stream values, so an empty result keeps every write
    // treated as a whole-class grant, same as before that change.
    return { findOne: jest.fn(() => mockChain(() => null)), find: jest.fn(() => mockChain(() => [])) };
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

const VALID_MARK = { studentId: 'stu_001', subjectId: 'subj_math', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70 };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_teacher_1', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };
  mockAcademicConfig = { subjectAssignmentEnforced: true };
  mockAssignmentDocs = [];
  mockConfigFindOne.mockReturnValue(mockChain(() => null));
  mockConfigCreate.mockResolvedValue({});
  mockScheduleFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFind.mockReturnValue(mockChain(() => []));
  mockMarksFindOneAndUpdate.mockReturnValue(mockChain(() => ({ id: 'mark_1' })));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

describe('POST /api/assessment/marks — subject-teacher scoping', () => {
  test('enforced + teacher NOT assigned to this subject/class → 403, no write', async () => {
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(403);
    expect(mockMarksFindOne).not.toHaveBeenCalled();
  });

  test('enforced + teacher IS assigned → write proceeds', async () => {
    mockAssignmentDocs = [{ classId: 'cls_001', subjectId: 'subj_math' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(201);
  });

  test('enforcement OFF → write proceeds even with no assignment', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: false };
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(201);
  });

  test('admin role is exempt from the check regardless of assignment', async () => {
    mockCurrentUser = { userId: 'usr_admin_1', schoolId: 'school_001', role: 'admin', roles: ['admin'] };
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(VALID_MARK);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/assessment/marks/bulk — subject-teacher scoping', () => {
  test('enforced + one of two subjects unassigned → 403 naming the denied subject, no bulkWrite', async () => {
    mockAssignmentDocs = [{ classId: 'cls_001', subjectId: 'subj_math' }]; // math only
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [
        { ...VALID_MARK, subjectId: 'subj_math' },
        { ...VALID_MARK, subjectId: 'subj_english', studentId: 'stu_002' },
      ],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/subj_english/);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('enforced + every distinct subject/class pair assigned → write proceeds', async () => {
    mockAssignmentDocs = [{ classId: 'cls_001', subjectId: 'subj_math' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [
        { ...VALID_MARK, subjectId: 'subj_math', studentId: 'stu_001' },
        { ...VALID_MARK, subjectId: 'subj_math', studentId: 'stu_002' }, // same pair, dedup'd to one check
      ],
    });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });
});
