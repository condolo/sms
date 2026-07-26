/* ============================================================
   server/routes/report-cards.js — subject-teacher scope enforcement
   (RC6, via server/utils/subject-scope.js)

   PUT /draft-comments/:studentId/subject/:subjectId and the
   subjectComments branch of PUT /draft-comments/:studentId let any
   user with report_cards:update write the Subject Teacher Comment
   for ANY subject on ANY student — no check that the caller is
   actually assigned to teach that subject in that class. These
   tests cover the new enforcement wired into both write paths.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), sort: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockCurrentUser = { userId: 'usr_teacher_1', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

let mockAcademicConfig;
let mockAssignmentDocs;
const mockDraftCommentUpsert = jest.fn(() => mockChain({ id: 'draft_1' }));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'academic_config') {
      return { findOne: jest.fn(() => mockChain(mockAcademicConfig)) };
    }
    if (col === 'teaching_assignments') {
      return {
        findOne: jest.fn(() => mockChain(mockAssignmentDocs[0] ?? null)),
        find:    jest.fn(() => mockChain(mockAssignmentDocs)),
      };
    }
    if (col === 'report_card_draft_comments') {
      return { findOneAndUpdate: mockDraftCommentUpsert };
    }
    return { findOne: jest.fn(() => mockChain(null)), find: jest.fn(() => mockChain([])) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

const express          = require('express');
const supertest        = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_teacher_1', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };
  mockAcademicConfig = { subjectAssignmentEnforced: true };
  mockAssignmentDocs = [];
  mockDraftCommentUpsert.mockReturnValue(mockChain({ id: 'draft_1' }));
});

describe('PUT /api/report-cards/draft-comments/:studentId/subject/:subjectId', () => {
  test('enforced + teacher NOT assigned → 403, no write', async () => {
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001/subject/subj_math')
      .send({ classId: 'cls_001', termNumber: 1, comment: 'Doing well' });
    expect(res.status).toBe(403);
    expect(mockDraftCommentUpsert).not.toHaveBeenCalled();
  });

  test('enforced + teacher IS assigned → write proceeds', async () => {
    mockAssignmentDocs = [{ classId: 'cls_001', subjectId: 'subj_math' }];
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001/subject/subj_math')
      .send({ classId: 'cls_001', termNumber: 1, comment: 'Doing well' });
    expect(res.status).toBe(200);
    expect(mockDraftCommentUpsert).toHaveBeenCalledTimes(1);
  });

  test('enforcement OFF → write proceeds with no assignment', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: false };
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001/subject/subj_math')
      .send({ classId: 'cls_001', termNumber: 1, comment: 'Doing well' });
    expect(res.status).toBe(200);
  });

  test('admin role bypasses the check', async () => {
    mockCurrentUser = { userId: 'usr_admin_1', schoolId: 'school_001', role: 'admin', roles: ['admin'] };
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001/subject/subj_math')
      .send({ classId: 'cls_001', termNumber: 1, comment: 'Doing well' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/report-cards/draft-comments/:studentId — subjectComments branch', () => {
  test('enforced + a subjectComments key the caller is not assigned to → 403, no write', async () => {
    mockAssignmentDocs = [{ classId: 'cls_001', subjectId: 'subj_math' }]; // math only
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001')
      .send({ classId: 'cls_001', termNumber: 1, subjectComments: { subj_math: 'Good', subj_english: 'Bad' } });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? res.body.error).toMatch(/subj_english/);
    expect(mockDraftCommentUpsert).not.toHaveBeenCalled();
  });

  test('enforced + every subjectComments key assigned → write proceeds', async () => {
    mockAssignmentDocs = [{ classId: 'cls_001', subjectId: 'subj_math' }];
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001')
      .send({ classId: 'cls_001', termNumber: 1, subjectComments: { subj_math: 'Good' } });
    expect(res.status).toBe(200);
    expect(mockDraftCommentUpsert).toHaveBeenCalledTimes(1);
  });

  test('no classId on the request skips the check (nothing to scope against) — base fields still write', async () => {
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_001')
      .send({ termNumber: 1, classTeacherRemark: 'Great term' });
    expect(res.status).toBe(200);
  });
});
