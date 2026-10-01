/* ============================================================
   server/routes/classes.js — GET /:id/students ?assessmentScope=true

   Same bug, same fix shape as classes-streams-students-scope.test.js's
   AUTHZ-27 (attendanceScope) and classes-lessons-scope.test.js's
   lessonsScope: a role that's ROLE_SCOPE_LEVEL 'school' for its OWN
   module (exams_officer, admissions_officer, finance, hr, timetabler,
   discipline_committee) is also fully unrestricted for Grades/Assessment
   purely as a side effect of scopeMiddleware computing one scope per
   request, not per module. An exams_officer who ALSO holds a real,
   narrow teaching_assignments row in one stream of a class would see
   and could write marks for the WHOLE class's roster instead of just
   their own stream via the Markbook, unless the route is told to use
   ScopeEngine.resolveAssessmentScope instead of the generic req.scope.

   `?assessmentScope=true` is the identical, deliberately narrower
   opt-in flag the Markbook's own roster fetch now sends (ExamsPage.jsx's
   MarkbookTab), mirroring attendanceScope/lessonsScope exactly.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real.
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
  };
}

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockHomeroomTeacherRecord;
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve(mockHomeroomTeacherRecord)),
}));

let mockClasses, mockStreams, mockStudents, mockTeachingAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    if (c === 'academic_config') return { findOne: jest.fn(() => mockChainObj(null)) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes')  return mockClasses;
    if (collection === 'streams')  return mockStreams;
    if (collection === 'students') return mockStudents;
    return mockMakeFakeCollection([]);
  },
}));

const express       = require('express');
const supertest     = require('supertest');
const classesRouter = require('../../routes/classes');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  return app;
}

const STUDENT_9C_RED = {
  id: 'stu_9c_1', schoolId: SCHOOL_A, classId: 'cls_9c', streamId: 'strm_9c_red', status: 'active',
  firstName: 'Amara', lastName: 'Osei', admissionNumber: 'ADM-9C-01',
};
const STUDENT_9C_BLUE = {
  id: 'stu_9c_2', schoolId: SCHOOL_A, classId: 'cls_9c', streamId: 'strm_9c_blue', status: 'active',
  firstName: 'Chiamaka', lastName: 'Nwosu', admissionNumber: 'ADM-9C-02',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_exams_officer', schoolId: SCHOOL_A, role: 'exams_officer', roles: ['exams_officer'] };
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_9c', schoolId: SCHOOL_A, name: 'Class 9C' },
  ]);
  mockStreams = mockMakeFakeCollection([
    { id: 'strm_9c_red',  schoolId: SCHOOL_A, classId: 'cls_9c', name: 'Red' },
    { id: 'strm_9c_blue', schoolId: SCHOOL_A, classId: 'cls_9c', name: 'Blue' },
  ]);
  mockStudents = mockMakeFakeCollection([STUDENT_9C_RED, STUDENT_9C_BLUE]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockHomeroomTeacherRecord = null;
  invalidateScopeCache('usr_exams_officer', SCHOOL_A);
});

describe('GET /api/classes/:id/students — exams_officer with a real stream-only assignment', () => {
  function asStreamScopedExamsOfficer(classId, streamId) {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_exams_officer', classId, subjectId: 'subj_math', streamId },
    ]);
  }

  test('WITHOUT assessmentScope, the generic (unrestricted) scope leaks the WHOLE class — both streams', async () => {
    asStreamScopedExamsOfficer('cls_9c', 'strm_9c_red');
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students');
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.firstName).sort()).toEqual(['Amara', 'Chiamaka']);
  });

  test('WITH assessmentScope=true, the same account is correctly narrowed to just their own stream', async () => {
    asStreamScopedExamsOfficer('cls_9c', 'strm_9c_red');
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students?assessmentScope=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].firstName).toBe('Amara');
    expect(JSON.stringify(res.body)).not.toContain('Chiamaka');
  });

  test('with no real assignment at all, assessmentScope=true narrows to nothing (403), not a silent empty 200', async () => {
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students?assessmentScope=true');
    expect(res.status).toBe(403);
  });
});

describe('every "school-level-for-its-own-module" role is narrowed for assessmentScope', () => {
  test.each(['admissions_officer', 'finance', 'hr', 'timetabler', 'discipline_committee'])(
    '%s with no assessment-relevant assignment is denied via assessmentScope',
    async (role) => {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/classes/cls_9c/students?assessmentScope=true');
      expect(res.status).toBe(403);
    }
  );
});

describe('the genuine Assessment floor stays fully unrestricted', () => {
  test.each(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy'])(
    '%s sees the whole class via assessmentScope, with no assignments at all',
    async (role) => {
      mockJwtUser = { userId: `usr_${role}`, schoolId: SCHOOL_A, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/classes/cls_9c/students?assessmentScope=true');
      expect(res.status).toBe(200);
      expect(res.body.data.map(s => s.firstName).sort()).toEqual(['Amara', 'Chiamaka']);
    }
  );
});

describe('a genuine whole-class-assigned teacher is unaffected by assessmentScope', () => {
  test('a plain teacher with a real whole-class assignment still sees the full roster', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_9c', subjectId: 'subj_eng' },
    ]);
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students?assessmentScope=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.firstName).sort()).toEqual(['Amara', 'Chiamaka']);
  });
});
