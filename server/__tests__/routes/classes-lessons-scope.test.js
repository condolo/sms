/* ============================================================
   server/routes/classes.js — GET / ?lessonsScope=true (2026-09)

   Same bug, same fix shape as classes-attendance-scope.test.js: Lesson
   Plans (v5.117.0) reused the generic req.scope via
   ScopeEngine.isClassInScope, which treats exams_officer/
   admissions_officer/finance/hr/timetabler/discipline_committee as
   unrestricted for Lesson Plans purely because they're 'school'-level
   scope for THEIR OWN module — none of which implies they teach any
   class at all. `?lessonsScope=true` is the identical, deliberately
   narrower opt-in flag LessonsPage.jsx's own class picker uses, sourced
   from resolveLessonsScope instead. Unlike attendanceScope, this does
   NOT fold in homeroom streams — a lesson plan is always tied to a real
   subject-teaching assignment, not homeroom/pastoral duty.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as classes-attendance-scope.test.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    aggregate:      jest.fn(() => Promise.resolve([])),
  };
}

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockClasses, mockTeachingAssignments, mockStreams;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes') return mockClasses;
    if (collection === 'streams') return mockStreams;
    return mockMakeFakeCollection([]);
  },
}));

const express     = require('express');
const supertest   = require('supertest');
const classesRouter = require('../../routes/classes');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_exams_officer', schoolId: SCHOOL_A, role: 'exams_officer', roles: ['exams_officer'] };
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_1', schoolId: SCHOOL_A, name: 'Year 4', status: 'active' },
    { id: 'cls_2', schoolId: SCHOOL_A, name: 'Year 7', status: 'active' },
  ]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockStreams = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_exams_officer', SCHOOL_A);
  invalidateScopeCache('usr_admin', SCHOOL_A);
});

describe('exams_officer — the exact reported bug class, applied to Lesson Plans', () => {
  test('WITHOUT any assignments, exams_officer is unrestricted for assignedOnly (Exams\' own picker) — correct, unchanged', async () => {
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('the SAME exams_officer, with no real class assignment, is narrowed to nothing for lessonsScope', async () => {
    const res = await supertest(buildApp()).get('/api/classes?lessonsScope=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.noAssignments).toBe(true);
  });

  test('an exams_officer with a real teaching assignment sees only that class via lessonsScope', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_exams_officer', classId: 'cls_2', subjectId: 'subj_eng' },
    ]);
    const res = await supertest(buildApp()).get('/api/classes?lessonsScope=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id)).toEqual(['cls_2']);
  });
});

describe('every "school-level-for-its-own-module" role is narrowed for lessonsScope', () => {
  test.each(['admissions_officer', 'finance', 'hr', 'timetabler', 'discipline_committee'])(
    '%s with no lessons-relevant assignment sees nothing via lessonsScope',
    async (role) => {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/classes?lessonsScope=true');
      expect(res.body.data).toEqual([]);
    }
  );
});

describe('the genuine Lessons floor stays fully unrestricted', () => {
  test.each(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy'])(
    '%s sees every class via lessonsScope, with no assignments at all',
    async (role) => {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/classes?lessonsScope=true');
      expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
    }
  );
});
