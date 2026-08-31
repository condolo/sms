/* ============================================================
   server/routes/assessment.js — stream-scoped RC6 writes (Milestone 2)

   Companion to assessment-subject-scope.test.js, which covers the
   plain {classId, subjectId} case. This covers a teacher whose only
   teaching_assignments row for a class+subject is scoped to ONE
   specific stream (a compulsory subject — see teaching-
   assignments.js, e.g. 7i's Maths teacher isn't 7ii's): canWriteSubject
   / unassignedPairs must match that stream exactly, not just the
   class+subject pair, for POST /marks, POST /marks/bulk, and
   DELETE /marks/:id (the RC6 guard newly added to DELETE in this same
   batch — it previously had no scope check of any kind). Also proves
   streamId is denormalized onto every written mark, resolved from the
   student, not trusted from the client.

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

const STUDENT_RED  = { id: 'stu_red_1',  streamId: 'strm_7i' };
const STUDENT_BLUE = { id: 'stu_blue_1', streamId: 'strm_7ii' };
const mockStudentsById = { [STUDENT_RED.id]: STUDENT_RED, [STUDENT_BLUE.id]: STUDENT_BLUE };

let mockAssignmentDocs;
let mockMarkStore;
const mockConfigFindOne   = jest.fn(() => mockChain(() => null));
const mockScheduleFindOne = jest.fn(() => mockChain(() => null));
const mockMarksFindOne    = jest.fn(() => mockChain(() => null));
let mockMarksFindOneTarget = null; // used by DELETE
const mockBulkWrite       = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config')   return { findOne: mockConfigFindOne, create: jest.fn().mockResolvedValue({}) };
    if (collection === 'assessment_schedule') return { findOne: mockScheduleFindOne };
    if (collection === 'assessment_marks') {
      return {
        findOne:          jest.fn(() => mockChain(() => mockMarksFindOneTarget)),
        find:              jest.fn(() => mockChain(() => [])),
        findOneAndUpdate:  jest.fn((filter, update) => mockChain(() => {
          const doc = { id: 'mark_new', ...filter, ...(update.$set ?? {}) };
          mockMarkStore.push(doc);
          return doc;
        })),
        findOneAndDelete:  jest.fn(() => Promise.resolve(mockMarksFindOneTarget)),
        bulkWrite:         mockBulkWrite,
      };
    }
    if (collection === 'academic_config')     return { findOne: jest.fn(() => mockChain(() => ({ subjectAssignmentEnforced: true }))) };
    if (collection === 'teaching_assignments') {
      // Mirrors subject-scope.js's own _streamOr shape: $or is
      // [{streamId:null}, {streamId:{$exists:false}}, ...(wanted ? [{streamId:wanted}] : [])] —
      // a 3rd entry means a specific stream was being searched for.
      return {
        find:    jest.fn(() => mockChain(() => mockAssignmentDocs)),
        findOne: jest.fn((filter) => {
          const wantedStream = filter.$or?.[2]?.streamId;
          const match = mockAssignmentDocs.find(a =>
            a.classId === filter.classId && a.subjectId === filter.subjectId &&
            (!a.streamId || a.streamId === wantedStream)
          );
          return mockChain(() => match ?? null);
        }),
      };
    }
    if (collection === 'students') {
      return {
        find:    jest.fn((filter) => mockChain(() => Object.values(mockStudentsById).filter(s => (filter.id?.$in ?? []).includes(s.id)))),
        findOne: jest.fn((filter) => mockChain(() => mockStudentsById[filter.id] ?? null)),
      };
    }
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

const markFor = (studentId) => ({
  studentId, subjectId: 'subj_math', classId: 'cls_yr7', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_teacher_1', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };
  mockAssignmentDocs = [];
  mockMarkStore = [];
  mockMarksFindOneTarget = null;
  mockConfigFindOne.mockReturnValue(mockChain(() => null));
  mockScheduleFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFindOne.mockReturnValue(mockChain(() => null));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

function asStreamTeacherOf(classId, subjectId, streamId) {
  mockAssignmentDocs = [{ classId, subjectId, streamId }];
}

describe('POST /api/assessment/marks — stream-scoped RC6', () => {
  test('can grade a student in THEIR OWN stream', async () => {
    asStreamTeacherOf('cls_yr7', 'subj_math', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(markFor(STUDENT_RED.id));
    expect(res.status).toBe(201);
    expect(mockMarkStore[0].streamId).toBe('strm_7i'); // denormalized from the student
  });

  test('CANNOT grade a student in the SIBLING stream', async () => {
    asStreamTeacherOf('cls_yr7', 'subj_math', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(markFor(STUDENT_BLUE.id));
    expect(res.status).toBe(403);
  });

  test('a whole-class assignment (no streamId) still grades either stream fine', async () => {
    mockAssignmentDocs = [{ classId: 'cls_yr7', subjectId: 'subj_math' }]; // no streamId
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(markFor(STUDENT_BLUE.id));
    expect(res.status).toBe(201);
    expect(mockMarkStore[0].streamId).toBe('strm_7ii');
  });
});

describe('POST /api/assessment/marks/bulk — stream-scoped RC6', () => {
  test('a batch mixing both streams is rejected outright when the teacher only covers one', async () => {
    asStreamTeacherOf('cls_yr7', 'subj_math', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [markFor(STUDENT_RED.id), markFor(STUDENT_BLUE.id)],
    });
    expect(res.status).toBe(403);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('a batch entirely within their own stream proceeds', async () => {
    asStreamTeacherOf('cls_yr7', 'subj_math', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({
      marks: [markFor(STUDENT_RED.id)],
    });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/assessment/marks/:id — stream-scoped RC6 (newly guarded)', () => {
  test('can delete a mark stamped with their own stream', async () => {
    asStreamTeacherOf('cls_yr7', 'subj_math', 'strm_7i');
    mockMarksFindOneTarget = { id: 'mark_1', classId: 'cls_yr7', subjectId: 'subj_math', streamId: 'strm_7i' };
    const res = await supertest(buildApp()).delete('/api/assessment/marks/mark_1');
    expect(res.status).toBe(200);
  });

  test('cannot delete a mark stamped with the sibling stream', async () => {
    asStreamTeacherOf('cls_yr7', 'subj_math', 'strm_7i');
    mockMarksFindOneTarget = { id: 'mark_2', classId: 'cls_yr7', subjectId: 'subj_math', streamId: 'strm_7ii' };
    const res = await supertest(buildApp()).delete('/api/assessment/marks/mark_2');
    expect(res.status).toBe(403);
  });
});
