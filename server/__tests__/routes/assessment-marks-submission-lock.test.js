/* ============================================================
   server/routes/assessment.js — POST /marks, POST /marks/bulk

   Workflow redesign (2026-10-13): submitted/approved no longer block
   editing — a teacher has full autonomy over marks until the report
   card is actually published, which locks them automatically
   (report-cards.js). This file previously pinned the OPPOSITE
   behavior (submitted/approved under-review blocks a write); it now
   pins that ONLY the terminal 'locked' state (set at publish time)
   blocks a write, and that submitted/approved/rejected/draft all
   behave identically — a plain pass-through.

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
    // class_subjects — curriculum-integrity guard; this file is about
    // submission-lock blocking, not curriculum, so cls_001/subj_001 is
    // genuinely in the curriculum for every test here.
    if (collection === 'class_subjects') {
      return {
        findOne: jest.fn(() => mockChain(() => ({ id: 'cs_1', classId: 'cls_001', subjectId: 'subj_001' }))),
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

describe('POST /api/assessment/marks — submitted/approved no longer block editing', () => {
  test.each(['draft', 'submitted', 'approved', 'rejected'])('a %s submission does NOT block editing — only "locked" does, and that is set at publish time, not here', async (status) => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });

  test('a submission for a DIFFERENT class does not block this one either', async () => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', classId: 'cls_999', status: 'submitted' }];
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });

  test('no submission at all does NOT block editing', async () => {
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(201);
  });

  test('the mark being LOCKED (assessment_marks.isLocked, set automatically at report-card publish) still blocks — the one guard that survived the redesign', async () => {
    mockMarksFindOne.mockReturnValue(mockChain(() => ({ isLocked: true })));
    const res = await supertest(buildApp()).post('/api/assessment/marks').send(MARK);
    expect(res.status).toBe(403);
    expect(mockMarksUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/assessment/marks/bulk — submitted/approved no longer block editing', () => {
  test.each(['draft', 'submitted', 'approved', 'rejected'])('a %s submission does NOT block the batch', async (status) => {
    mockSubmissionDocs = [{ ...SUB, id: 'sub_1', status }];
    const res = await supertest(buildApp()).post('/api/assessment/marks/bulk').send({ marks: [MARK] });
    expect(res.status).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
  });

  test('a locked mark (assessment_marks.isLocked, set automatically at publish) still blocks the batch', async () => {
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

// The "mark_submissions under-review check is year-scoped" describe
// block that used to live here was removed 2026-10-13 along with the
// guard it tested — submitted/approved no longer block editing at
// all (see above), so there is no more cross-year false-block to pin
// for that specific check. The schedule-lock year-scoping above is
// untouched and still real.
