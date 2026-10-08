/* ============================================================
   server/routes/assessment.js — POST /marks, POST /marks/bulk
   block writes while the matching mark_submissions record is
   "submitted" or "approved" (under review, not yet locked)

   Part of wiring the existing mark_submissions workflow (draft ->
   submitted -> approved/rejected -> locked) into the Markbook. Before
   this, only the terminal 'locked' state blocked writes (via
   assessment_marks.isLocked, set by mark-submissions.js's own lock
   route) - a submission merely "under review" could still be silently
   edited, defeating the entire point of submitting for review. Single
   POST /marks had NO lock-awareness at all before this change.

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

let mockSubmissionDocs;
let mockScheduleDocs;
const mockConfigFindOne   = jest.fn(() => mockChain(() => null));
const mockScheduleFindOne = jest.fn((filter) => mockChain(() => (mockScheduleDocs || []).find(d => mockMatchesFilter(d, filter)) ?? null));
const mockMarksFindOne    = jest.fn(() => mockChain(() => null));
const mockMarksFind       = jest.fn(() => mockChain(() => []));
const mockMarksUpdate     = jest.fn(() => mockChain(() => ({ id: 'mk_1' })));
const mockBulkWrite       = jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.some(x => x === doc[k] || (x == null && doc[k] == null));
      // Needed for _yearFilterPart's own {$exists:false} clause — without
      // this, every $exists check silently matched any doc (the generic
      // "else assume it matches" fallback below), which hid the real
      // cross-year-isolation bug these tests exist to catch: a doc that
      // DOES have academicYearId set would incorrectly satisfy
      // {academicYearId:{$exists:false}} too.
      if ('$exists' in v) return v.$exists ? (k in doc && doc[k] !== undefined) : (!(k in doc) || doc[k] === undefined);
      return true;
    }
    return doc[k] === v;
  });
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config')   return { findOne: mockConfigFindOne, create: jest.fn().mockResolvedValue({}) };
    if (collection === 'assessment_schedule') return { findOne: mockScheduleFindOne };
    if (collection === 'assessment_marks') {
      return { findOne: mockMarksFindOne, find: mockMarksFind, findOneAndUpdate: mockMarksUpdate, bulkWrite: mockBulkWrite };
    }
    if (collection === 'mark_submissions') {
      return { findOne: jest.fn((filter) => mockChain(() => (mockSubmissionDocs || []).find(d => mockMatchesFilter(d, filter)) ?? null)) };
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

const SUB = { schoolId: 'school_test_001', classId: 'cls_001', subjectId: 'subj_001', termNumber: 1, assessmentType: 'CA', instance: 1 };
const MARK = { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 72 };

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmissionDocs = [];
  mockScheduleDocs = [];
  mockConfigFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFindOne.mockReturnValue(mockChain(() => null));
  mockMarksFind.mockReturnValue(mockChain(() => []));
  mockMarksUpdate.mockReturnValue(mockChain(() => ({ id: 'mk_1' })));
  mockBulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
});

describe('POST /api/assessment/marks — blocked while under review', () => {
  test.each(['submitted', 'approved'])('a %s submission blocks editing this exact class/subject/term/type/instance', async (status) => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(403);
    expect(mockMarksUpdate).not.toHaveBeenCalled();
  });

  test('a draft submission does NOT block editing', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status: 'draft' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });

  test('a rejected submission does NOT block editing — the point of rejection is to allow correction', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status: 'rejected' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });

  test('a submission for a DIFFERENT class does not block this one', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', classId: 'cls_999', status: 'submitted' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });

  test('no submission at all does NOT block editing — unchanged behavior for assessments never submitted', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/assessment/marks/bulk — blocked while under review', () => {
  test('a submitted submission blocks the whole batch for that key', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status: 'submitted' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK] });
    expect(res.status).toBe(403);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('an approved submission also blocks the batch', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status: 'approved' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK] });
    expect(res.status).toBe(403);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('a locked submission is caught by the pre-existing assessment_marks.isLocked guard, not this one, but still blocks', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status: 'locked' }];
    mockMarksFindOne.mockReturnValue(mockChain(() => ({ isLocked: true })));
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK] });
    expect(res.status).toBe(403);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('no submission, no lock — writes normally', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK] });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
   Cross-year isolation — found during a full exam-config -> Markbook ->
   report-card flow audit: neither the assessment_schedule.isLocked check
   nor the mark_submissions under-review check filtered by academicYearId
   at all, so a lock/submission from ONE year blocked mark entry for every
   OTHER year sharing the same termNumber+assessmentType(+instance) — i.e.
   every subsequent year, since terms/types repeat annually. These tests
   pin the fix: an unrelated year's lock/submission must not block, and
   the SAME year's (or a legacy untagged one's) still correctly does.
   ============================================================ */
describe('POST /api/assessment/marks — assessment_schedule lock is year-scoped', () => {
  const MARK_Y2 = { ...MARK, academicYearId: 'ay_2026' };

  test('a locked schedule entry for a DIFFERENT year does not block this year\'s entry', async () => {
    mockScheduleDocs = [{ schoolId: 'school_test_001', isLocked: true, assessmentType: 'CA', termNumber: 1, academicYearId: 'ay_2025' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK_Y2);
    expect(res.status).toBe(201);
  });

  test('a locked schedule entry for the SAME year still blocks', async () => {
    mockScheduleDocs = [{ schoolId: 'school_test_001', isLocked: true, assessmentType: 'CA', termNumber: 1, academicYearId: 'ay_2026' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK_Y2);
    expect(res.status).toBe(403);
  });

  test('a locked LEGACY (no academicYearId) schedule entry still blocks — backward compatible', async () => {
    mockScheduleDocs = [{ schoolId: 'school_test_001', isLocked: true, assessmentType: 'CA', termNumber: 1, academicYearId: null }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK_Y2);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/assessment/marks/bulk — assessment_schedule lock is year-scoped', () => {
  const MARK_Y2 = { ...MARK, academicYearId: 'ay_2026' };

  test('a locked schedule entry for a DIFFERENT year does not block this year\'s batch', async () => {
    mockScheduleDocs = [{ schoolId: 'school_test_001', isLocked: true, assessmentType: 'CA', termNumber: 1, academicYearId: 'ay_2025' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK_Y2] });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });

  test('a locked schedule entry for the SAME year still blocks the batch', async () => {
    mockScheduleDocs = [{ schoolId: 'school_test_001', isLocked: true, assessmentType: 'CA', termNumber: 1, academicYearId: 'ay_2026' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK_Y2] });
    expect(res.status).toBe(403);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});

describe('POST /api/assessment/marks(/bulk) — mark_submissions under-review check is year-scoped', () => {
  const MARK_Y2 = { ...MARK, academicYearId: 'ay_2026' };
  const SUB_Y1  = { ...SUB, id: 'sub_1', status: 'submitted', academicYearId: 'ay_2025' };
  const SUB_Y2  = { ...SUB, id: 'sub_2', status: 'submitted', academicYearId: 'ay_2026' };

  test('single-mark: a submitted record for a DIFFERENT year does not block this year\'s edit', async () => {
    mockSubmissionDocs = [SUB_Y1];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK_Y2);
    expect(res.status).toBe(201);
  });

  test('single-mark: a submitted record for the SAME year still blocks', async () => {
    mockSubmissionDocs = [SUB_Y2];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK_Y2);
    expect(res.status).toBe(403);
  });

  test('bulk: a submitted record for a DIFFERENT year does not block this year\'s batch', async () => {
    mockSubmissionDocs = [SUB_Y1];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK_Y2] });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });

  test('bulk: a submitted record for the SAME year still blocks the batch', async () => {
    mockSubmissionDocs = [SUB_Y2];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK_Y2] });
    expect(res.status).toBe(403);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
