/* ============================================================
   server/routes/classes.js GET /:id/students (AUTHZ-27) and
   server/routes/streams.js  GET /:id/students (AUTHZ-28)

   Security Baseline Register. Both routes had zero scope check at
   all — unlike GET /api/students (the list route for the identical
   underlying data), which correctly enforces
   ScopeEngine.applyToFilter. AUTHZ-27 was LIVE-CONFIRMED against
   production: a demo teacher account with zero recorded class
   assignments retrieved full rosters — names, DOB, admission
   numbers, parent name/email/phone — for every class in the school
   via this exact route.

   These tests exercise the real scopeMiddleware + ScopeEngine (not
   mocked) against a real teaching_assignments fixture, same
   discipline as grades-write-scope.test.js, and — per the explicit
   instruction this fix was scoped under — verify the actual response
   BODY (not just the HTTP status) so a scope check that merely
   changed the status code while still leaking data in an error
   payload, or vice versa, would be caught.

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

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

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

const express        = require('express');
const supertest      = require('supertest');
const classesRouter  = require('../../routes/classes');
const streamsRouter  = require('../../routes/streams');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  app.use('/api/streams', streamsRouter);
  return app;
}

const STUDENT_9C = {
  id: 'stu_9c_1', schoolId: SCHOOL_A, classId: 'cls_9c', streamId: 'strm_9c_red',
  firstName: 'Amara', lastName: 'Osei', admissionNumber: 'ADM-9C-01',
  parentName: 'Mrs Osei', parentEmail: 'osei.parent@example.com', parentPhone: '+254700000001',
};
const STUDENT_4A = {
  id: 'stu_4a_1', schoolId: SCHOOL_A, classId: 'cls_4a', streamId: 'strm_4a_blue',
  firstName: 'Brian', lastName: 'Onyango', admissionNumber: 'ADM-4A-01',
  parentName: 'Mr Onyango', parentEmail: 'onyango.parent@example.com', parentPhone: '+254700000002',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_9c', schoolId: SCHOOL_A, name: 'Class 9C' },
    { id: 'cls_4a', schoolId: SCHOOL_A, name: 'Class 4A' },
  ]);
  mockStreams = mockMakeFakeCollection([
    { id: 'strm_9c_red',  schoolId: SCHOOL_A, classId: 'cls_9c', name: 'Red' },
    { id: 'strm_4a_blue', schoolId: SCHOOL_A, classId: 'cls_4a', name: 'Blue' },
  ]);
  mockStudents = mockMakeFakeCollection([STUDENT_9C, STUDENT_4A]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherOf(...classIds) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    classIds.map(classId => ({ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId }))
  );
}

describe('GET /api/classes/:id/students — AUTHZ-27', () => {
  test('a teacher with ZERO assignments cannot see ANY class roster — the exact live-confirmed bug', async () => {
    asTeacherOf(); // no assignments at all, matching the demo account this was found with
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students');
    expect(res.status).toBe(403);
    // Verify the response BODY carries no student data of any kind, not just the status code
    expect(JSON.stringify(res.body)).not.toContain('Amara');
    expect(JSON.stringify(res.body)).not.toContain('osei.parent@example.com');
  });

  test('a teacher assigned to a DIFFERENT class cannot see this class\'s roster or its parent PII', async () => {
    asTeacherOf('cls_4a'); // assigned elsewhere
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('Amara');
    expect(JSON.stringify(res.body)).not.toContain('osei.parent@example.com');
  });

  test('a teacher assigned to THIS class correctly receives the roster, including parent contact fields', async () => {
    asTeacherOf('cls_9c');
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].firstName).toBe('Amara');
    expect(res.body.data[0].parentEmail).toBe('osei.parent@example.com');
  });

  test('a teacher assigned to multiple classes can see each one, but only those', async () => {
    asTeacherOf('cls_9c', 'cls_4a');
    const res9c = await supertest(buildApp()).get('/api/classes/cls_9c/students');
    const res4a = await supertest(buildApp()).get('/api/classes/cls_4a/students');
    expect(res9c.status).toBe(200);
    expect(res4a.status).toBe(200);
    expect(res9c.body.data[0].lastName).toBe('Osei');
    expect(res4a.body.data[0].lastName).toBe('Onyango');
  });

  test('admin (school-level scope) can see any class\'s roster', async () => {
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students');
    expect(res.status).toBe(200);
    expect(res.body.data[0].firstName).toBe('Amara');
  });

  test('manipulating the :id path param to a class outside scope does not bypass the check', async () => {
    asTeacherOf('cls_4a');
    // same request shape a client would send if just editing the URL
    const res = await supertest(buildApp()).get('/api/classes/cls_9c/students?status=active');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/streams/:id/students — AUTHZ-28', () => {
  test('a teacher with ZERO assignments cannot see ANY stream roster', async () => {
    asTeacherOf();
    const res = await supertest(buildApp()).get('/api/streams/strm_9c_red/students');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('Amara');
  });

  test('a teacher assigned to the PARENT CLASS of a different stream cannot see this stream\'s roster', async () => {
    asTeacherOf('cls_4a'); // owns 4A, not 9C — 9C's stream must stay out of reach
    const res = await supertest(buildApp()).get('/api/streams/strm_9c_red/students');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('osei.parent@example.com');
  });

  test('a teacher assigned to the stream\'s parent class correctly receives the roster', async () => {
    asTeacherOf('cls_9c'); // scope is keyed by classId; stream inherits its parent's classId
    const res = await supertest(buildApp()).get('/api/streams/strm_9c_red/students');
    expect(res.status).toBe(200);
    expect(res.body.data[0].firstName).toBe('Amara');
    expect(res.body.data[0].parentPhone).toBe('+254700000001');
  });

  test('admin (school-level scope) can see any stream\'s roster', async () => {
    const res = await supertest(buildApp()).get('/api/streams/strm_9c_red/students');
    expect(res.status).toBe(200);
    expect(res.body.data[0].firstName).toBe('Amara');
  });

  test('a nonexistent stream id 404s before any scope check runs', async () => {
    asTeacherOf('cls_9c');
    const res = await supertest(buildApp()).get('/api/streams/strm_does_not_exist/students');
    expect(res.status).toBe(404);
  });
});
