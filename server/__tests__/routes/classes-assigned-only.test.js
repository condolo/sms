/* ============================================================
   server/routes/classes.js — GET / ?assignedOnly=true

   GET /api/classes is deliberately UNSCOPED by default (21 different
   client surfaces depend on seeing the full school list regardless of
   the caller's own teaching/assigned scope — see the route's own doc
   comment). ?assignedOnly=true is the narrow, opt-in exception:
   AttendancePage.jsx's class picker uses it so a scoped account isn't
   shown classes its own write requests (POST /attendance) would reject
   anyway. These tests cover both halves — the flag actually narrows
   when passed, and its ABSENCE changes nothing for every other caller.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as medical-alerts.test.js / grades-write-scope.test.js /
   attendance-write-scope.test.js.

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
    return mockMakeFakeCollection([]); // students enrichment
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
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_1', schoolId: SCHOOL_A, name: 'Grade 7A', status: 'active' },
    { id: 'cls_2', schoolId: SCHOOL_A, name: 'Grade 7B', status: 'active' },
  ]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockStreams = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherOf(...classIds) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    classIds.map(classId => ({ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId }))
  );
}

// A compulsory-subject-per-stream assignment (teaching-assignments.js) never
// contributes to scope.classIds, only scope.streamIds — this teacher has NO
// whole-class assignment anywhere, only stream-scoped ones.
function asStreamTeacherOf(...streamAssignments) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    streamAssignments.map(({ classId, streamId }) => ({ schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId, streamId }))
  );
  mockStreams = mockMakeFakeCollection(
    streamAssignments.map(({ classId, streamId }) => ({ id: streamId, schoolId: SCHOOL_A, classId }))
  );
}

describe('GET /api/classes — default (no assignedOnly) is unrestricted for everyone', () => {
  test('a scoped teacher still sees every class when the flag is absent — zero behavior change for the other 20 callers', async () => {
    asTeacherOf('cls_1'); // assigned to only one of the two classes
    const res = await supertest(buildApp()).get('/api/classes');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('admin sees every class', async () => {
    const res = await supertest(buildApp()).get('/api/classes');
    expect(res.body.data.length).toBe(2);
  });
});

describe('GET /api/classes?assignedOnly=true — opt-in narrowing', () => {
  test('a teacher sees only their own assigned classes', async () => {
    asTeacherOf('cls_1');
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id)).toEqual(['cls_1']);
  });

  test('a teacher with zero assigned classes gets an empty list with a noAssignments flag', async () => {
    asTeacherOf(); // no assignments at all
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.noAssignments).toBe(true);
  });

  test('admin (school-level scope) still sees every class even with the flag set — no-op for unrestricted roles', async () => {
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.length).toBe(2);
  });

  // Regression (2026-09) — a teacher whose ONLY assignment is a compulsory
  // subject in one specific stream (teaching-assignments.js's per-stream
  // grant) never appears in scope.classIds, only scope.streamIds. `classes`
  // documents have no streamId field of their own to match against, so this
  // used to resolve to an empty picker with no "no assignments" explanation
  // either — real, reported production bug (a teacher with 4 real stream
  // assignments saw "Select class..." with nothing to select on Attendance).
  test('a teacher with ONLY a stream-scoped assignment (no whole-class grant anywhere) still sees that stream\'s parent class', async () => {
    asStreamTeacherOf({ classId: 'cls_1', streamId: 'str_diamond' });
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.id)).toEqual(['cls_1']);
    expect(res.body.pagination.noAssignments).toBeFalsy();
  });

  test('a stream-scoped teacher with assignments across two different classes sees both parent classes, nothing else', async () => {
    asStreamTeacherOf(
      { classId: 'cls_1', streamId: 'str_diamond' },
      { classId: 'cls_2', streamId: 'str_gold' },
    );
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('mixing a whole-class grant with a stream-scoped grant in a different class shows both, not just the whole-class one', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_1' }, // whole-class, no streamId
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_2', streamId: 'str_gold' }, // stream-only
    ]);
    mockStreams = mockMakeFakeCollection([{ id: 'str_gold', schoolId: SCHOOL_A, classId: 'cls_2' }]);
    const res = await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    expect(res.body.data.map(c => c.id).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('resolving stream assignments to their parent class does not leak into other modules\' scope (record-level narrowing stays intact)', async () => {
    asStreamTeacherOf({ classId: 'cls_1', streamId: 'str_diamond' });
    await supertest(buildApp()).get('/api/classes?assignedOnly=true');
    // The middleware caches scope per user::school — fetch it fresh the same
    // way scopeMiddleware itself would, and confirm the classes.js handler's
    // request-local merge never wrote back into the cached scope object.
    const { scopeMiddleware } = require('../../middleware/scopeMiddleware');
    const req2 = { jwtUser: mockJwtUser };
    await new Promise(resolve => scopeMiddleware(req2, {}, resolve));
    expect(req2.scope.classIds).toEqual([]); // still stream-only — untouched by the classes.js picker's own resolution
    expect(req2.scope.streamIds).toEqual(['str_diamond']);
  });
});
