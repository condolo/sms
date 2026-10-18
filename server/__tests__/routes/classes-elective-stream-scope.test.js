/* ============================================================
   server/routes/classes.js GET /:id/students — electiveSubjectId + streamId

   Reported directly: "On Msingi, I can't access the learners per class,
   the list is general, can you separate it so that I can input the
   marks" — a teacher assigned a SPECIFIC stream for an elective subject
   (a different Kiswahili teacher per stream, even though Kiswahili
   itself is marked optional school-wide) still got every enrolled
   student across EVERY stream merged into one roster, with no way to
   narrow it to just her own stream. Root cause: the electiveSubjectId
   branch always returned `id IN enrolledIds`, ignoring any streamId the
   caller passed — confirmed live, never covered by a test before this.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      return true;
    }
    return doc[k] === v;
  });
}
function mockFakeCollection(seed = []) {
  return {
    find:           (filter) => mockChainArr(seed.filter(d => mockMatches(d, filter))),
    findOne:        (filter) => mockChainObj(seed.find(d => mockMatches(d, filter)) || null),
    countDocuments: (filter) => Promise.resolve(seed.filter(d => mockMatches(d, filter)).length),
  };
}

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: jest.fn(() => Promise.resolve(null)) }));

const CLASS_ID = 'cls_yr1';
const STREAM_TANZANITE = 'strm_tanzanite';
const STREAM_RUBY      = 'strm_ruby';
const KISWAHILI = 'subj_kiswahili';

const STUDENTS = [
  { id: 'stu_1', schoolId: SCHOOL_A, classId: CLASS_ID, streamId: STREAM_TANZANITE, status: 'active', firstName: 'Anenyasha', lastName: 'Chikowore', admissionNumber: 'A1' },
  { id: 'stu_2', schoolId: SCHOOL_A, classId: CLASS_ID, streamId: STREAM_TANZANITE, status: 'active', firstName: 'Aria', lastName: 'Waweru', admissionNumber: 'A2' },
  { id: 'stu_3', schoolId: SCHOOL_A, classId: CLASS_ID, streamId: STREAM_RUBY, status: 'active', firstName: 'Ruby', lastName: 'Kid', admissionNumber: 'A3' },
];

let mockClasses, mockStreams, mockStudents, mockTeachingAssignments, mockClassSubjects, mockStudentSubjects;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_config') return { findOne: () => mockChainObj(null) };
    return { find: () => mockChainArr([]), findOne: () => mockChainObj(null) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes')              return mockClasses;
    if (collection === 'streams')               return mockStreams;
    if (collection === 'students')              return mockStudents;
    if (collection === 'teaching_assignments')  return mockTeachingAssignments;
    if (collection === 'class_subjects')        return mockClassSubjects;
    if (collection === 'student_subjects')      return mockStudentSubjects;
    return mockFakeCollection([]);
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

beforeEach(() => {
  mockJwtUser = { userId: 'usr_harriet', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockClasses  = mockFakeCollection([{ id: CLASS_ID, schoolId: SCHOOL_A, name: 'Year 1' }]);
  mockStreams  = mockFakeCollection([
    { id: STREAM_TANZANITE, schoolId: SCHOOL_A, classId: CLASS_ID, name: 'Tanzanite' },
    { id: STREAM_RUBY,      schoolId: SCHOOL_A, classId: CLASS_ID, name: 'Ruby' },
  ]);
  mockStudents = mockFakeCollection(STUDENTS);
  // Harriet is assigned Kiswahili in Tanzanite only — not Ruby.
  mockTeachingAssignments = mockFakeCollection([
    { id: 'ta1', schoolId: SCHOOL_A, teacherId: 'usr_harriet', classId: CLASS_ID, subjectId: KISWAHILI, streamId: STREAM_TANZANITE },
  ]);
  mockClassSubjects = mockFakeCollection([
    { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: KISWAHILI, isCompulsoryForClass: false },
  ]);
  // Every student in the class is "enrolled" in the elective — the merged
  // list this route used to always return regardless of stream.
  mockStudentSubjects = mockFakeCollection(STUDENTS.map(s => ({ schoolId: SCHOOL_A, subjectId: KISWAHILI, studentId: s.id })));
  invalidateScopeCache('usr_harriet', SCHOOL_A);
});

describe('GET /api/classes/:id/students?electiveSubjectId=', () => {
  test('with no streamId, still returns every enrolled student across every stream (unchanged default)', async () => {
    const res = await supertest(buildApp())
      .get(`/api/classes/${CLASS_ID}/students`)
      .query({ electiveSubjectId: KISWAHILI, status: 'all' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['stu_1', 'stu_2', 'stu_3']);
  });

  test('with streamId, narrows the elective roster to just that one stream\'s enrolled students', async () => {
    const res = await supertest(buildApp())
      .get(`/api/classes/${CLASS_ID}/students`)
      .query({ electiveSubjectId: KISWAHILI, streamId: STREAM_TANZANITE, status: 'all' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['stu_1', 'stu_2']);
  });

  test('a different stream narrows to a disjoint set, proving it is not just ignoring the filter', async () => {
    const res = await supertest(buildApp())
      .get(`/api/classes/${CLASS_ID}/students`)
      .query({ electiveSubjectId: KISWAHILI, streamId: STREAM_RUBY, status: 'all' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id)).toEqual(['stu_3']);
  });
});
