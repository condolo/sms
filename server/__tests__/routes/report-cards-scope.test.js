/* ============================================================
   server/routes/report-cards.js — GET /, GET /:id data scope +
   the missing 'student' self-ownership check (2026-09)

   Prompted directly: "a teacher should only see their streams and
   subjects they've been assigned to — no assumptions." Before this,
   GET / and GET /:id never called scopeMiddleware/ScopeEngine at all
   (MODULE_SCOPE.report_cards's streamAware:true was dead config) — a
   teacher with grades:read could list or open ANY student's report
   card in the school. GET /:id also only checked ownership for
   'parent'/'guardian' roles — a 'student'-role caller with grades:read
   had NO ownership check at all and could fetch any OTHER student's
   full report card by id.

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
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = mockScope; next(); } }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

let mockJwtUser;
let mockScope; // null = unrestricted; {level, classIds, subjectIds, streamIds, unrestrictedModules} = scoped
let mockSnapshotDocs;
let mockAssignmentDocs;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), skip: () => mockChainArr(arr), limit: () => mockChainArr(arr), select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
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
    create:         jest.fn((doc) => Promise.resolve(doc)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = seed.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      seed[idx] = { ...seed[idx], ...flat };
      return mockChainObj(seed[idx]);
    }),
  };
}

jest.mock('../../utils/model', () => ({ _model: jest.fn(() => mockCollection([])) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'report_card_snapshots') return mockCollection(mockSnapshotDocs);
    if (collection === 'teaching_assignments')  return mockCollection(mockAssignmentDocs);
    if (collection === 'mark_audit_log')        return mockCollection([]);
    return mockCollection([]);
  },
}));

const express           = require('express');
const supertest         = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

const CLASS_A = 'cls_A';
const CLASS_B = 'cls_B';
const STUDENT_1 = 'stu_1';
const STUDENT_2 = 'stu_2';

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
  mockSnapshotDocs = [
    { id: 'rc_1', schoolId: SCHOOL, studentId: STUDENT_1, classId: CLASS_A, streamId: null, status: 'published', superseded: false },
    { id: 'rc_2', schoolId: SCHOOL, studentId: STUDENT_2, classId: CLASS_B, streamId: null, status: 'published', superseded: false },
  ];
  mockAssignmentDocs = [];
});

describe('GET /api/report-cards — data scope', () => {
  test('unrestricted (admin) role sees every snapshot', async () => {
    mockJwtUser = { userId: 'usr_admin_1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    mockScope = null;
    const res = await supertest(buildApp()).get('/api/report-cards');
    expect(res.body.data.map(d => d.id)).toEqual(expect.arrayContaining(['rc_1', 'rc_2']));
  });

  test('a teacher scoped to CLASS_A only sees CLASS_A snapshots', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards');
    const ids = res.body.data.map(d => d.id);
    expect(ids).toContain('rc_1');
    expect(ids).not.toContain('rc_2');
  });

  test('a parent sees only their own linked children, even without an explicit studentId query', async () => {
    mockJwtUser = { userId: 'usr_parent_1', schoolId: SCHOOL, role: 'parent', guardianOf: [STUDENT_1] };
    mockScope = { level: 'guardian', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards');
    const ids = res.body.data.map(d => d.id);
    expect(ids).toEqual(['rc_1']);
  });

  test("a parent explicitly requesting another guardian's studentId gets no results, not that student's data", async () => {
    mockJwtUser = { userId: 'usr_parent_1', schoolId: SCHOOL, role: 'parent', guardianOf: [STUDENT_1] };
    mockScope = { level: 'guardian', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards').query({ studentId: STUDENT_2 });
    expect(res.body.data).toHaveLength(0);
  });

  test('a student sees only their own report card', async () => {
    mockJwtUser = { userId: 'usr_student_1', schoolId: SCHOOL, role: 'student', studentId: STUDENT_1 };
    mockScope = { level: 'self', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards');
    const ids = res.body.data.map(d => d.id);
    expect(ids).toEqual(['rc_1']);
  });
});

describe('GET /api/report-cards/:id — data scope + ownership', () => {
  test('a teacher out of scope for the class → 403', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_B], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards/rc_1');
    expect(res.status).toBe(403);
  });

  test('a teacher in scope for the class → 200', async () => {
    mockScope = { level: 'assigned', classIds: [CLASS_A], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards/rc_1');
    expect(res.status).toBe(200);
  });

  test('a parent viewing an unlinked child → 403 (existing behavior, unchanged)', async () => {
    mockJwtUser = { userId: 'usr_parent_1', schoolId: SCHOOL, role: 'parent', guardianOf: [STUDENT_2] };
    mockScope = { level: 'guardian', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards/rc_1');
    expect(res.status).toBe(403);
  });

  test("a student fetching another student's report card by id → 403 (the fix — this had NO check before)", async () => {
    mockJwtUser = { userId: 'usr_student_2', schoolId: SCHOOL, role: 'student', studentId: STUDENT_2 };
    mockScope = { level: 'self', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards/rc_1');
    expect(res.status).toBe(403);
  });

  test('a student fetching their OWN report card by id → 200', async () => {
    mockJwtUser = { userId: 'usr_student_1', schoolId: SCHOOL, role: 'student', studentId: STUDENT_1 };
    mockScope = { level: 'self', classIds: [], subjectIds: [], streamIds: [], unrestrictedModules: [] };
    const res = await supertest(buildApp()).get('/api/report-cards/rc_1');
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/report-cards/:id/comments — subject-teacher scoping on subjectComments', () => {
  test('a teacher not assigned to the subject → 403, no write', async () => {
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/rc_1/comments')
      .send({ subjectComments: { subj_math: 'Doing well' } });
    expect(res.status).toBe(403);
  });

  test('a teacher assigned to the subject → 200', async () => {
    mockAssignmentDocs = [{ schoolId: SCHOOL, classId: CLASS_A, subjectId: 'subj_math', teacherId: 'usr_teacher_1' }];
    const res = await supertest(buildApp())
      .put('/api/report-cards/rc_1/comments')
      .send({ subjectComments: { subj_math: 'Doing well' } });
    expect(res.status).toBe(200);
  });

  test('admin bypasses the subject check', async () => {
    mockJwtUser = { userId: 'usr_admin_1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/rc_1/comments')
      .send({ subjectComments: { subj_math: 'Doing well' } });
    expect(res.status).toBe(200);
  });

  test('classTeacherRemark alone (no subjectComments) is unaffected by the subject check', async () => {
    mockAssignmentDocs = [];
    const res = await supertest(buildApp())
      .put('/api/report-cards/rc_1/comments')
      .send({ classTeacherRemark: 'A great term overall.' });
    expect(res.status).toBe(200);
  });
});
