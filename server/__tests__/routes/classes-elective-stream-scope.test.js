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
    // Real Mongoose compares _id against an ObjectId instance (the route
    // wraps it with `new mongoose.Types.ObjectId(pId)`); the mock's docs
    // store it as a plain string, so compare both sides as strings.
    if (k === '_id' && v != null) return String(doc._id) === String(v);
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

describe('GET /api/classes/:id/students?electiveSubjectId= — a class that predates the UUID-`id` migration', () => {
  // Live-confirmed against a real school: 14 of 15 such legacy classes
  // (no `id` field, only Mongo _id) have at least one elective subject.
  // The route resolved `cls` correctly via its _id fallback, but then
  // called isElective(req, cls.id, subjectId) — cls.id is undefined for
  // these classes — so isElective's own class_subjects lookup (classId:
  // undefined) never matched the real link (classId: the _id string),
  // silently returning false ("not elective") and falling through to
  // the whole-class branch: every active student, not just the enrolled
  // 3 of 7. Confirmed live via the real route with the real class before
  // this fix; this is the regression test for it.
  const LEGACY_CLASS_ID = '6a3815ed6eb039df2bea8831'; // no `id` field
  const CHEMISTRY = 'subj_chemistry';

  const LEGACY_STUDENTS = [
    { id: 'stu_a', schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, status: 'active', firstName: 'Alvin', lastName: 'Ankunda', admissionNumber: 'L1' },
    { id: 'stu_b', schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, status: 'active', firstName: 'Joseph', lastName: 'Muinde', admissionNumber: 'L2' },
    { id: 'stu_c', schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, status: 'active', firstName: 'Tumelo', lastName: 'Kimunya', admissionNumber: 'L3' },
    { id: 'stu_d', schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, status: 'active', firstName: 'Salma', lastName: 'Abdi', admissionNumber: 'L4' },
  ];

  beforeEach(() => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    // No `id` field at all — only `_id`, same shape a pre-migration class
    // doc actually has.
    mockClasses  = mockFakeCollection([{ _id: LEGACY_CLASS_ID, schoolId: SCHOOL_A, name: 'Legacy Form 3' }]);
    mockStreams  = mockFakeCollection([]);
    mockStudents = mockFakeCollection(LEGACY_STUDENTS);
    mockTeachingAssignments = mockFakeCollection([]);
    mockClassSubjects = mockFakeCollection([
      { schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, subjectId: CHEMISTRY, isCompulsoryForClass: false },
    ]);
    // Only 3 of the 4 active students are actually enrolled.
    mockStudentSubjects = mockFakeCollection([
      { schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, subjectId: CHEMISTRY, studentId: 'stu_a' },
      { schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, subjectId: CHEMISTRY, studentId: 'stu_b' },
      { schoolId: SCHOOL_A, classId: LEGACY_CLASS_ID, subjectId: CHEMISTRY, studentId: 'stu_c' },
    ]);
    invalidateScopeCache('usr_admin', SCHOOL_A);
  });

  test('narrows to only the enrolled students, not the whole class', async () => {
    const res = await supertest(buildApp())
      .get(`/api/classes/${LEGACY_CLASS_ID}/students`)
      .query({ electiveSubjectId: CHEMISTRY });
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['stu_a', 'stu_b', 'stu_c']); // not stu_d
  });

  test('a genuinely compulsory subject for the same legacy class still returns everyone (no over-narrowing)', async () => {
    const res = await supertest(buildApp())
      .get(`/api/classes/${LEGACY_CLASS_ID}/students`);
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => s.id).sort()).toEqual(['stu_a', 'stu_b', 'stu_c', 'stu_d']);
  });
});
