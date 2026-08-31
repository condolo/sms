/* ============================================================
   server/routes/grades.js — stream-scoped writes (Milestone 2)

   Companion to grades-write-scope.test.js, which covers the plain
   whole-class case. This covers a teacher whose ONLY grant for a
   class is a compulsory subject scoped to one specific stream (see
   teaching-assignments.js) — they never appear in scope.classIds at
   all, so the plain classId check would wrongly deny them their own
   stream's grades. Also proves streamId is correctly denormalized
   onto every written record (resolved from the student, not trusted
   from the client) for single POST, bulk POST, PUT and DELETE.

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
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter) => { const d = docs.find(x => mockMatchesFilter(x, filter)); return mockChainObj(d ? { ...d } : null); }),
    findOneAndDelete: jest.fn((filter) => Promise.resolve(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve({ ...doc, toObject: () => doc }); }),
    countDocuments:   jest.fn(() => Promise.resolve(0)),
    bulkWrite:        jest.fn((ops) => {
      let upsertedCount = 0, modifiedCount = 0;
      for (const { updateOne } of ops) {
        const existing = docs.find(d => mockMatchesFilter(d, updateOne.filter));
        const flat = { ...(updateOne.update.$set ?? {}) };
        if (existing) { Object.assign(existing, flat); modifiedCount++; }
        else { docs.push({ ...updateOne.filter, ...flat, ...(updateOne.update.$setOnInsert ?? {}) }); upsertedCount++; }
      }
      return Promise.resolve({ upsertedCount, modifiedCount });
    }),
    _docs: () => docs,
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const STUDENT_RED  = { id: 'stu_red_1',  schoolId: SCHOOL_A, classId: 'cls_yr7', streamId: 'strm_7i' };
const STUDENT_BLUE = { id: 'stu_blue_1', schoolId: SCHOOL_A, classId: 'cls_yr7', streamId: 'strm_7ii' };

let mockGrades, mockTeachingAssignments, mockStudents;
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
    if (collection === 'grades')   return mockGrades;
    if (collection === 'students') return mockStudents;
    return mockMakeFakeCollection([]); // mark_audit_log etc.
  },
}));

const express   = require('express');
const supertest = require('supertest');
const gradesRouter = require('../../routes/grades');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/grades', gradesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockGrades  = mockMakeFakeCollection([]);
  mockStudents = mockMakeFakeCollection([STUDENT_RED, STUDENT_BLUE]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asStreamTeacherOf(classId, streamId) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId, subjectId: 'sub_math', streamId },
  ]);
}

const gradeBody = (studentId) => ({
  studentId, subjectId: 'sub_math', classId: 'cls_yr7', score: 80, maxScore: 100,
});

describe('POST /api/grades — stream-only teacher', () => {
  test('can grade a student in THEIR OWN stream', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/grades').send(gradeBody(STUDENT_RED.id));
    expect(res.status).toBe(201);
    expect(res.body.data.streamId).toBe('strm_7i'); // denormalized from the student, not the client
  });

  test('CANNOT grade a student in the SIBLING stream of the same class', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/grades').send(gradeBody(STUDENT_BLUE.id));
    expect(res.status).toBe(403);
  });

  test('a whole-class teacher (elective, no streamId on their assignment) still grades either stream fine', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr7', subjectId: 'sub_french' }, // no streamId
    ]);
    const res = await supertest(buildApp()).post('/api/grades').send(gradeBody(STUDENT_BLUE.id));
    expect(res.status).toBe(201);
    expect(res.body.data.streamId).toBe('strm_7ii');
  });
});

describe('POST /api/grades/bulk — stream-only teacher', () => {
  test('mixed-stream submission: only their own stream\'s grade is scoped correctly, the other is forbidden', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/grades/bulk').send({
      grades: [gradeBody(STUDENT_RED.id), gradeBody(STUDENT_BLUE.id)],
    });
    // grades.js's bulk route rejects the whole batch if ANY row is out of
    // scope (unlike attendance's silent-skip design) — this pins that
    // existing, unchanged batch semantic under the new stream check.
    expect(res.status).toBe(403);
  });

  test('a batch entirely within their own stream succeeds and stamps streamId on every row', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/grades/bulk').send({
      grades: [gradeBody(STUDENT_RED.id)],
    });
    expect(res.status).toBe(201);
    const written = mockGrades._docs().find(d => d.studentId === STUDENT_RED.id);
    expect(written.streamId).toBe('strm_7i');
  });
});

describe('PUT/DELETE /api/grades/:id — stream-only teacher', () => {
  test('can edit a grade that was already stamped with their own stream', async () => {
    mockGrades = mockMakeFakeCollection([
      { id: 'grd_red', schoolId: SCHOOL_A, studentId: STUDENT_RED.id, subjectId: 'sub_math', classId: 'cls_yr7', streamId: 'strm_7i', score: 80, maxScore: 100 },
    ]);
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).put('/api/grades/grd_red').send({ score: 90 });
    expect(res.status).toBe(200);
  });

  test('cannot edit a grade stamped with the SIBLING stream', async () => {
    mockGrades = mockMakeFakeCollection([
      { id: 'grd_blue', schoolId: SCHOOL_A, studentId: STUDENT_BLUE.id, subjectId: 'sub_math', classId: 'cls_yr7', streamId: 'strm_7ii', score: 80, maxScore: 100 },
    ]);
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).put('/api/grades/grd_blue').send({ score: 90 });
    expect(res.status).toBe(403);
  });

  test('cannot delete a grade stamped with the SIBLING stream', async () => {
    mockGrades = mockMakeFakeCollection([
      { id: 'grd_blue', schoolId: SCHOOL_A, studentId: STUDENT_BLUE.id, subjectId: 'sub_math', classId: 'cls_yr7', streamId: 'strm_7ii', score: 80, maxScore: 100 },
    ]);
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).delete('/api/grades/grd_blue');
    expect(res.status).toBe(403);
  });
});
