/* ============================================================
   server/routes/assessment.js — GET /marks, GET /report,
   GET /marks/summary data scope (2026-09)

   Prompted directly: "a teacher should only see their streams and
   subjects they've been assigned to — no assumptions." These three
   read routes had no ScopeEngine call at all before (confirmed by
   grep) — only GET /analytics did. Any grades:read holder could list
   marks, pull a computed report, or see the completion grid for ANY
   class in the school, not just their own assigned class(es)/stream(s).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
// Controlled req.scope, same convention as assessment-analytics.test.js.
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = mockScope; next(); } }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));
jest.mock('../../utils/email', () => ({}));

let mockJwtUser;
let mockScope; // null = unrestricted; {level, classIds, subjectIds, streamIds, unrestrictedModules} = scoped
let mockMarkDocs;
let mockStudentDoc;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), select: () => mockChainArr(arr), limit: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
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
    find:    jest.fn((filter) => mockChainArr(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne: jest.fn((filter) => mockChainObj(seed.find(d => mockMatchesFilter(d, filter)) ?? null)),
    create:  jest.fn((doc) => Promise.resolve(doc)),
  };
}

jest.mock('../../utils/model', () => ({ _model: jest.fn(() => mockCollection([])) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'assessment_marks') return mockCollection(mockMarkDocs);
    if (collection === 'students')         return { findOne: jest.fn(() => mockChainObj(mockStudentDoc)) };
    return mockCollection([]);
  },
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

const CLASS_A = 'cls_A';
const CLASS_B = 'cls_B';
const STREAM_A1 = 'strm_A1';

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
  mockMarkDocs = [
    { id: 'mark_A', schoolId: SCHOOL, classId: CLASS_A, streamId: null, studentId: 'stu_1', subjectId: 'subj_math', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70 },
    { id: 'mark_B', schoolId: SCHOOL, classId: CLASS_B, streamId: null, studentId: 'stu_2', subjectId: 'subj_math', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 80 },
  ];
  mockStudentDoc = null;
});

describe('GET /api/assessment/marks — data scope', () => {
  test('unrestricted role sees marks from every class', async () => {
    mockScope = null;
    const res = await supertest(buildApp()).get('/api/assessment/marks');
    expect(res.body.data.map(m => m.id)).toEqual(expect.arrayContaining(['mark_A', 'mark_B']));
  });

  test('a teacher scoped to CLASS_A only sees CLASS_A marks', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/marks');
    const ids = res.body.data.map(m => m.id);
    expect(ids).toContain('mark_A');
    expect(ids).not.toContain('mark_B');
  });

  test('requesting classId=CLASS_B explicitly while scoped to CLASS_A returns empty, not CLASS_B data', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/marks').query({ classId: CLASS_B });
    expect(res.body.data).toHaveLength(0);
  });

  test('a stream-scoped-only teacher sees marks tagged with their own stream, via the streamAware branch', async () => {
    mockMarkDocs = [
      { id: 'mark_stream_A1', schoolId: SCHOOL, classId: CLASS_A, streamId: STREAM_A1, studentId: 'stu_1', subjectId: 'subj_math', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 70 },
      { id: 'mark_stream_other', schoolId: SCHOOL, classId: CLASS_A, streamId: 'strm_other', studentId: 'stu_3', subjectId: 'subj_math', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 65 },
    ];
    mockScope = { level: 'assigned', classIds: [], subjectIds: [], streamIds: [STREAM_A1], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/marks');
    const ids = res.body.data.map(m => m.id);
    expect(ids).toContain('mark_stream_A1');
    expect(ids).not.toContain('mark_stream_other');
  });
});

describe('GET /api/assessment/marks/summary — data scope', () => {
  test('out-of-scope classId → 403', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/marks/summary').query({ classId: CLASS_B });
    expect(res.status).toBe(403);
  });

  test('in-scope classId → 200', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/marks/summary').query({ classId: CLASS_A });
    expect(res.status).toBe(200);
  });

  test('unrestricted role can query any class', async () => {
    mockScope = null;
    const res = await supertest(buildApp()).get('/api/assessment/marks/summary').query({ classId: CLASS_B });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/assessment/report — data scope', () => {
  test('out-of-scope classId → 403', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/report').query({ classId: CLASS_B });
    expect(res.status).toBe(403);
  });

  test('in-scope classId → 200', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/report').query({ classId: CLASS_A });
    expect(res.status).toBe(200);
  });

  test("a studentId belonging to an out-of-scope class's stream is denied, even though only studentId was passed", async () => {
    mockStudentDoc = { classId: CLASS_B, streamId: null };
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/assessment/report').query({ studentId: 'stu_2' });
    expect(res.status).toBe(403);
  });
});
