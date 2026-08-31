/* ============================================================
   server/routes/attendance.js — stream-scoped writes (Milestone 2)

   Companion to attendance-write-scope.test.js, which covers the
   plain whole-class case. This covers a teacher whose ONLY grant for
   a class is a compulsory subject scoped to one specific stream (see
   teaching-assignments.js) — they never appear in scope.classIds at
   all, so the plain classId check would wrongly deny them their own
   stream's attendance. Also proves streamId is correctly denormalized
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
    findOneAndUpdate: jest.fn((filter, update) => {
      const existing = docs.find(d => mockMatchesFilter(d, filter));
      const flat = update.$set ? { ...update.$set, ...(update.$setOnInsert ?? {}) } : update;
      if (existing) { Object.assign(existing, flat); return mockChainObj(existing); }
      const created = { id: 'att_new', ...filter, ...flat };
      docs.push(created);
      return mockChainObj(created);
    }),
    findOneAndDelete: jest.fn((filter) => Promise.resolve(docs.find(d => mockMatchesFilter(d, filter)) || null)),
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

let mockAttendance, mockTeachingAssignments, mockStudents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    if (c === 'attendance') return mockAttendance;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'attendance') return mockAttendance;
    if (collection === 'students')   return mockStudents;
    return mockMakeFakeCollection([]);
  },
}));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockAttendance = mockMakeFakeCollection([]);
  mockStudents   = mockMakeFakeCollection([STUDENT_RED, STUDENT_BLUE]);
  mockTeachingAssignments = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

// Compulsory-subject, stream-scoped assignment — no whole-class grant.
function asStreamTeacherOf(classId, streamId) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId, subjectId: 'subj_math', streamId },
  ]);
}

describe('POST /api/attendance — stream-only teacher', () => {
  test('can mark attendance for a student in THEIR OWN stream', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: STUDENT_RED.id, classId: 'cls_yr7', date: '2026-05-02', status: 'present',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.streamId).toBe('strm_7i'); // denormalized from the student, not the client
  });

  test('CANNOT mark attendance for a student in the SIBLING stream of the same class', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: STUDENT_BLUE.id, classId: 'cls_yr7', date: '2026-05-02', status: 'present',
    });
    expect(res.status).toBe(403);
  });

  test('a whole-class teacher (elective, no streamId on their assignment) still marks either stream fine', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr7', subjectId: 'subj_french' }, // no streamId
    ]);
    const res = await supertest(buildApp()).post('/api/attendance').send({
      studentId: STUDENT_BLUE.id, classId: 'cls_yr7', date: '2026-05-02', status: 'present',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.streamId).toBe('strm_7ii');
  });
});

describe('POST /api/attendance/bulk — stream-only teacher', () => {
  test('mixed-stream submission: their own stream\'s student is written, the other is silently skipped', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_yr7', date: '2026-05-02',
      records: [
        { studentId: STUDENT_RED.id,  status: 'present' },
        { studentId: STUDENT_BLUE.id, status: 'present' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.skipped).toBe(1);
    const written = mockAttendance._docs().find(d => d.studentId === STUDENT_RED.id);
    expect(written.streamId).toBe('strm_7i');
    expect(mockAttendance._docs().find(d => d.studentId === STUDENT_BLUE.id)).toBeUndefined();
  });

  test('submitting ONLY the other stream\'s students is forbidden outright', async () => {
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_yr7', date: '2026-05-02',
      records: [{ studentId: STUDENT_BLUE.id, status: 'present' }],
    });
    expect(res.status).toBe(403);
  });
});

describe('PUT/DELETE /api/attendance/:id — stream-only teacher', () => {
  test('can edit a record that was already stamped with their own stream', async () => {
    mockAttendance = mockMakeFakeCollection([
      { id: 'att_red', schoolId: SCHOOL_A, studentId: STUDENT_RED.id, classId: 'cls_yr7', streamId: 'strm_7i', date: '2026-05-01', status: 'present' },
    ]);
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).put('/api/attendance/att_red').send({ status: 'late' });
    expect(res.status).toBe(200);
  });

  test('cannot edit a record stamped with the SIBLING stream', async () => {
    mockAttendance = mockMakeFakeCollection([
      { id: 'att_blue', schoolId: SCHOOL_A, studentId: STUDENT_BLUE.id, classId: 'cls_yr7', streamId: 'strm_7ii', date: '2026-05-01', status: 'present' },
    ]);
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).put('/api/attendance/att_blue').send({ status: 'late' });
    expect(res.status).toBe(403);
  });

  test('cannot delete a record stamped with the SIBLING stream', async () => {
    mockAttendance = mockMakeFakeCollection([
      { id: 'att_blue', schoolId: SCHOOL_A, studentId: STUDENT_BLUE.id, classId: 'cls_yr7', streamId: 'strm_7ii', date: '2026-05-01', status: 'present' },
    ]);
    asStreamTeacherOf('cls_yr7', 'strm_7i');
    const res = await supertest(buildApp()).delete('/api/attendance/att_blue');
    expect(res.status).toBe(403);
  });
});
