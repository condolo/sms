/* ============================================================
   server/routes/streams.js — GET / ?assignedOnly=true (2026-09)

   GET /api/streams is deliberately UNSCOPED by default (Curriculum,
   Timetable builder, Classes admin all need every stream in a class
   regardless of the caller's own teaching scope — see the route's own
   doc comment). ?assignedOnly=true (+classId) is the narrow, opt-in
   exception: AttendancePage.jsx's stream picker uses it so a teacher
   teaching two streams of the same class (e.g. 3A and 3B — two separate
   lessons, two separate registers) sees only their own streams to choose
   from, not one they'd be 403'd for picking on GET /:id/students.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as classes-assigned-only.test.js.

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

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockHomeroomTeacherRecord;
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve(mockHomeroomTeacherRecord)),
}));

let mockStreams, mockTeachingAssignments;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'streams') return mockStreams;
    return mockMakeFakeCollection([]); // teachers/students enrichment
  },
}));

const express      = require('express');
const supertest    = require('supertest');
const streamsRouter = require('../../routes/streams');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/streams', streamsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockStreams = mockMakeFakeCollection([
    { id: 'str_3a', schoolId: SCHOOL_A, classId: 'cls_year3', name: '3A', status: 'active' },
    { id: 'str_3b', schoolId: SCHOOL_A, classId: 'cls_year3', name: '3B', status: 'active' },
    { id: 'str_3c', schoolId: SCHOOL_A, classId: 'cls_year3', name: '3C', status: 'active' },
  ]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockHomeroomTeacherRecord = null;
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asWholeClassTeacher(classId) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId }, // no streamId — whole-class grant
  ]);
}

function asStreamTeacherOf(...streamIds) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    streamIds.map(streamId => ({ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_year3', streamId }))
  );
}

describe('GET /api/streams — default (no assignedOnly) is unrestricted for everyone', () => {
  test('a stream-scoped teacher still sees every stream when the flag is absent', async () => {
    asStreamTeacherOf('str_3a'); // assigned to only one of the three streams
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3');
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['str_3a', 'str_3b', 'str_3c']);
  });

  test('admin sees every stream', async () => {
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3');
    expect(res.body.data.length).toBe(3);
  });
});

describe('GET /api/streams?classId=X&assignedOnly=true — opt-in narrowing', () => {
  test('a teacher teaching two of three streams (e.g. 3A and 3B) sees only those two — the actual reported scenario', async () => {
    asStreamTeacherOf('str_3a', 'str_3b');
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3&assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['str_3a', 'str_3b']);
  });

  test('a teacher with a whole-class grant (not stream-scoped) sees every stream even with the flag set', async () => {
    asWholeClassTeacher('cls_year3');
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3&assignedOnly=true');
    expect(res.body.data.map(s => s.id).sort()).toEqual(['str_3a', 'str_3b', 'str_3c']);
  });

  test('admin (school-level scope) still sees every stream even with the flag set — no-op for unrestricted roles', async () => {
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3&assignedOnly=true');
    expect(res.body.data.length).toBe(3);
  });

  test('a teacher with zero assignments in this class sees an empty list, not another teacher\'s streams', async () => {
    asStreamTeacherOf(); // no assignments at all
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3&assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('a stream assignment in a DIFFERENT class does not leak into this class\'s picker', async () => {
    asStreamTeacherOf('str_other_class_stream');
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3&assignedOnly=true');
    expect(res.body.data).toEqual([]); // str_other_class_stream isn't one of cls_year3's own streams
  });

  test('assignedOnly without a classId is a no-op — nothing to scope against', async () => {
    asStreamTeacherOf('str_3a');
    const res = await supertest(buildApp()).get('/api/streams?assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['str_3a', 'str_3b', 'str_3c']);
  });

  // 2026-09 — a form/homeroom teacher (formTeacherId) with NO teaching
  // assignment anywhere must still see their own homeroom stream here.
  test('a form teacher with zero teaching assignments still sees their own homeroom stream, and only that one', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([]); // no subject assignment anywhere
    mockHomeroomTeacherRecord = { id: 'tch_1', userId: 'usr_teacher' };
    mockStreams = mockMakeFakeCollection([
      { id: 'str_3a', schoolId: SCHOOL_A, classId: 'cls_year3', name: '3A', status: 'active', formTeacherId: 'tch_1' },
      { id: 'str_3b', schoolId: SCHOOL_A, classId: 'cls_year3', name: '3B', status: 'active' },
      { id: 'str_3c', schoolId: SCHOOL_A, classId: 'cls_year3', name: '3C', status: 'active' },
    ]);
    const res = await supertest(buildApp()).get('/api/streams?classId=cls_year3&assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id)).toEqual(['str_3a']);
  });
});
