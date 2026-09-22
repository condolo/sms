/* ============================================================
   server/routes/exams.js — data scope enforcement (2026-09)

   Prompted directly: "a teacher should only see their streams and
   subjects they've been assigned to — no assumptions." Before this,
   exams.js never called scopeMiddleware/ScopeEngine at all (confirmed
   by grep) — any caller with exams:read could list or open ANY exam
   in the school, and POST /:id/results's only gate was an optional,
   client-suppliable exam.ownerId with no fallback to a real
   teaching_assignments check.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn().mockResolvedValue(false) }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
// Controlled req.scope, same convention as assessment-analytics.test.js —
// scopeMiddleware itself is covered by its own dedicated tests.
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = mockScope; next(); } }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));

let mockJwtUser;
let mockScope; // null = unrestricted; {level, classIds, subjectIds, streamIds, unrestrictedModules} = scoped
let mockExamDocs;
let mockAssignmentDocs;
let mockStreamDocs;
let mockResultDocs;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), skip: () => mockChainArr(arr), limit: () => mockChainArr(arr), select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }

function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockCollection(seed = []) {
  return {
    find:           jest.fn((filter) => mockChainArr(seed.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(seed.find(d => mockMatchesFilter(d, filter)) ?? null)),
    countDocuments: jest.fn((filter) => Promise.resolve(seed.filter(d => mockMatchesFilter(d, filter)).length)),
    create:         jest.fn((doc) => Promise.resolve({ ...doc, toObject: () => doc })),
    bulkWrite:      jest.fn(() => Promise.resolve({ modifiedCount: 0, upsertedCount: 0 })),
    updateOne:      jest.fn(() => Promise.resolve({})),
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'mark_audit_log') return { create: jest.fn().mockResolvedValue({}) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'exams')               return mockCollection(mockExamDocs);
    if (collection === 'teaching_assignments') return mockCollection(mockAssignmentDocs);
    if (collection === 'streams')              return mockCollection(mockStreamDocs);
    if (collection === 'exam_results')         return mockCollection(mockResultDocs);
    if (collection === 'grade_boundaries')     return mockCollection([]);
    if (collection === 'academic_config')      return mockCollection([]);
    if (collection === 'mark_audit_log')       return { create: jest.fn().mockResolvedValue({}) };
    return mockCollection([]);
  },
}));

const express     = require('express');
const supertest   = require('supertest');
const examsRouter = require('../../routes/exams');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examsRouter);
  return app;
}

const CLASS_A = 'cls_A';
const CLASS_B = 'cls_B';
const STREAM_A1 = 'strm_A1';
const SUBJ_MATH = 'subj_math';
const SUBJ_SCI  = 'subj_sci';

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
  mockExamDocs = [
    { id: 'exam_A_math', schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_MATH, title: 'Math Test A', maxScore: 100, status: 'scheduled' },
    { id: 'exam_A_sci',  schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_SCI,  title: 'Science Test A', maxScore: 100, status: 'scheduled' },
    { id: 'exam_B_math', schoolId: SCHOOL, classId: CLASS_B, subjectId: SUBJ_MATH, title: 'Math Test B', maxScore: 100, status: 'scheduled' },
  ];
  mockAssignmentDocs = [];
  mockStreamDocs = [{ id: STREAM_A1, schoolId: SCHOOL, classId: CLASS_A, name: 'A1' }];
  mockResultDocs = [];
});

describe('GET /api/exams — data scope', () => {
  test('unrestricted (school-level) role sees every exam', async () => {
    mockScope = null;
    const res = await supertest(buildApp()).get('/api/exams');
    expect(res.body.data).toHaveLength(3);
  });

  test('a teacher scoped to CLASS_A only sees CLASS_A exams, not CLASS_B', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH, SUBJ_SCI], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams');
    const ids = res.body.data.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['exam_A_math', 'exam_A_sci']));
    expect(ids).not.toContain('exam_B_math');
  });

  test('a teacher assigned only Math (not Science) in CLASS_A does not see the Science exam', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams');
    const ids = res.body.data.map(e => e.id);
    expect(ids).toContain('exam_A_math');
    expect(ids).not.toContain('exam_A_sci');
  });

  test('a stream-only-scoped teacher (no whole-class grant) still sees their class exams via the parent-class fold', async () => {
    // classIds empty — this teacher's ONLY assignment is stream-scoped
    // (e.g. a compulsory subject taught separately per stream).
    mockScope = { level: 'assigned', classIds: [], subjectIds: [SUBJ_MATH, SUBJ_SCI], streamIds: [STREAM_A1], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams');
    const ids = res.body.data.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['exam_A_math', 'exam_A_sci']));
    expect(ids).not.toContain('exam_B_math');
  });

  test('zero assignments (assigned level, empty classIds/streamIds) sees nothing', async () => {
    mockScope = { level: 'assigned', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams');
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/exams/:id — data scope', () => {
  test('out-of-scope class → 403', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_B], subjectIds: [SUBJ_MATH], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams/exam_A_math');
    expect(res.status).toBe(403);
  });

  test('in-scope class+subject → 200', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams/exam_A_math');
    expect(res.status).toBe(200);
  });

  test('in-scope class but wrong subject → 403', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_SCI], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams/exam_A_math');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/exams/:id/results — ownership fallback to teaching_assignments', () => {
  beforeEach(() => {
    mockScope = null; // scope isn't exercised on this route; irrelevant here
  });

  test('no ownerId, not admin, no teaching_assignments record → 403', async () => {
    mockExamDocs = [{ id: 'exam_1', schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_MATH, maxScore: 100, status: 'in_progress', ownerId: null }];
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/exams/exam_1/results').send({ results: [{ studentId: 'stu_1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(403);
  });

  test('no ownerId, not admin, but a real teaching_assignments record exists → 201', async () => {
    mockExamDocs = [{ id: 'exam_1', schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_MATH, maxScore: 100, status: 'in_progress', ownerId: null }];
    mockAssignmentDocs = [{ id: 'ta_1', schoolId: SCHOOL, teacherId: 'usr_teacher_1', classId: CLASS_A, subjectId: SUBJ_MATH }];
    const res = await supertest(buildApp()).post('/api/exams/exam_1/results').send({ results: [{ studentId: 'stu_1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(201);
  });

  test('ownerId matches the caller → 201 regardless of teaching_assignments', async () => {
    mockExamDocs = [{ id: 'exam_1', schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_MATH, maxScore: 100, status: 'in_progress', ownerId: 'usr_teacher_1' }];
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/exams/exam_1/results').send({ results: [{ studentId: 'stu_1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(201);
  });

  test('ownerId set to someone ELSE, caller has no assignment → 403', async () => {
    mockExamDocs = [{ id: 'exam_1', schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_MATH, maxScore: 100, status: 'in_progress', ownerId: 'usr_other_teacher' }];
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/exams/exam_1/results').send({ results: [{ studentId: 'stu_1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(403);
  });

  test('admin bypasses the check regardless of ownerId/assignment', async () => {
    mockJwtUser = { userId: 'usr_admin_1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    mockExamDocs = [{ id: 'exam_1', schoolId: SCHOOL, classId: CLASS_A, subjectId: SUBJ_MATH, maxScore: 100, status: 'in_progress', ownerId: 'usr_other_teacher' }];
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/exams/exam_1/results').send({ results: [{ studentId: 'stu_1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(201);
  });

  test('an exam with no classId/subjectId at all has nothing to check and is allowed through', async () => {
    mockExamDocs = [{ id: 'exam_1', schoolId: SCHOOL, maxScore: 100, status: 'in_progress', ownerId: null }];
    mockAssignmentDocs = [];
    const res = await supertest(buildApp()).post('/api/exams/exam_1/results').send({ results: [{ studentId: 'stu_1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(201);
  });
});

/* ============================================================
   GET /:id/results and GET /results/all — previously had ZERO scope
   check at all, unlike GET / and GET /:id (the exam metadata) above.
   A teacher scoped to CLASS_A only, with a valid CLASS_B examId (e.g.
   from a stray reference, not from their own scoped exam list), could
   fetch CLASS_B's actual scores directly. Fixed to reuse the exact
   same _examClassScope/_examInScope/_applySubjectScope helpers already
   proven correct above — not a new, separately-drifting mechanism.
   ============================================================ */
describe('GET /api/exams/:id/results — data scope (2026-09 fix)', () => {
  test('a teacher scoped to CLASS_A can fetch CLASS_A exam results', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH, SUBJ_SCI], streamIds: [], unrestrictedModules: [] };
    mockResultDocs = [{ id: 'res_1', schoolId: SCHOOL, examId: 'exam_A_math', studentId: 'stu_1', score: 80 }];
    const res = await supertest(buildApp()).get('/api/exams/exam_A_math/results');
    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(1);
  });

  test('a teacher scoped to CLASS_A only is forbidden from CLASS_B exam results — the actual bug this closes', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH, SUBJ_SCI], streamIds: [], unrestrictedModules: [] };
    mockResultDocs = [{ id: 'res_1', schoolId: SCHOOL, examId: 'exam_B_math', studentId: 'stu_1', score: 80 }];
    const res = await supertest(buildApp()).get('/api/exams/exam_B_math/results');
    expect(res.status).toBe(403);
  });

  test('unrestricted (school-level) role can fetch any exam\'s results', async () => {
    mockScope = null;
    mockResultDocs = [{ id: 'res_1', schoolId: SCHOOL, examId: 'exam_B_math', studentId: 'stu_1', score: 80 }];
    const res = await supertest(buildApp()).get('/api/exams/exam_B_math/results');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/exams/results/all — data scope (2026-09 fix)', () => {
  beforeEach(() => {
    mockResultDocs = [
      { id: 'res_A_math', schoolId: SCHOOL, examId: 'exam_A_math', classId: CLASS_A, subjectId: SUBJ_MATH, studentId: 'stu_1', score: 70 },
      { id: 'res_B_math', schoolId: SCHOOL, examId: 'exam_B_math', classId: CLASS_B, subjectId: SUBJ_MATH, studentId: 'stu_2', score: 90 },
    ];
  });

  test('a teacher scoped to CLASS_A cannot pull CLASS_B results by passing ?classId=CLASS_B directly — the real IDOR this closes', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get(`/api/exams/results/all?classId=${CLASS_B}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0); // narrowed to __no_match__, not an error — matches this route's existing empty-result posture
  });

  test('a teacher scoped to CLASS_A gets CLASS_A results when passing ?classId=CLASS_A', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get(`/api/exams/results/all?classId=${CLASS_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map(r => r.id)).toEqual(['res_A_math']);
  });

  test('a teacher with NO classId filter at all only sees results for classes they are actually scoped to', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [SUBJ_MATH], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/exams/results/all');
    expect(res.status).toBe(200);
    expect(res.body.data.map(r => r.id)).toEqual(['res_A_math']);
  });

  test('unrestricted (school-level) role sees every class\'s results', async () => {
    mockScope = null;
    const res = await supertest(buildApp()).get('/api/exams/results/all');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});
