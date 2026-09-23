/* ============================================================
   server/routes/teacher-portal.js — GET /dashboard curriculum coverage
   (2026-09, found while extending lessons.js to be stream-aware)

   Same bug/fix as student-portal and parent-portal's own equivalent test
   files — see student-portal-lessons-coverage.test.js's header for the
   full explanation. This is the TEACHER's own dashboard widget: each row
   is one of THEIR OWN teaching assignments, so the fix here is per-
   assignment streamId (not per-student) — a teacher's Diamond-stream
   progress must never be conflated with their own (or a colleague's)
   Sapphire-stream progress for the same class-subject.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A  = 'school_A';
const TEACHER_USER = 'usr_teacher';
const TEACHER_ID   = 'tch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: TEACHER_USER, schoolId: SCHOOL_A, role: 'teacher', email: 't@x.com' };
    next();
  },
}));
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve({ id: TEACHER_ID, userId: TEACHER_USER, firstName: 'Jane', lastName: 'Doe' })),
}));

function mockChain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c,
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
  };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
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
    find:           jest.fn((filter) => mockChain(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne:        jest.fn(() => mockChain(seed[0] ?? null)),
    countDocuments: jest.fn((filter) => Promise.resolve(seed.filter(d => mockMatchesFilter(d, filter)).length)),
    distinct:       jest.fn((field, filter) => Promise.resolve([...new Set(seed.filter(d => mockMatchesFilter(d, filter)).map(d => d[field]))])),
    aggregate:      jest.fn(() => Promise.resolve([])),
  };
}

let mockSchoolDoc, mockAssignments, mockCoverageDocs, mockTopicDocs, mockSubjectDocs, mockClassDocs, mockLessonPlanDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments') return mockCollection(mockAssignments);
    if (collection === 'lesson_coverage')      return mockCollection(mockCoverageDocs);
    if (collection === 'syllabus_topics')      return mockCollection(mockTopicDocs);
    if (collection === 'subjects')             return mockCollection(mockSubjectDocs);
    if (collection === 'classes')              return mockCollection(mockClassDocs);
    if (collection === 'lesson_plans')         return mockCollection(mockLessonPlanDocs);
    return mockCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const teacherPortalRouter = require('../../routes/teacher-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teacher-portal', teacherPortalRouter);
  return app;
}

const CLASS_ID = 'cls_yr2';
const DIAMOND  = 'strm_diamond';
const SAPPHIRE = 'strm_sapphire';

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDoc = { name: 'Test School', academicYear: '2026' };
  mockClassDocs = [{ id: CLASS_ID, schoolId: SCHOOL_A, name: 'Year 2' }];
  mockSubjectDocs = [{ id: 'subj_eng', name: 'English', code: 'ENG' }];
  mockTopicDocs = [
    { id: 'topic_1', schoolId: SCHOOL_A, subjectId: 'subj_eng', academicYear: '2026', subtopics: [] },
    { id: 'topic_2', schoolId: SCHOOL_A, subjectId: 'subj_eng', academicYear: '2026', subtopics: [] },
  ];
  mockAssignments = [
    { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_eng', streamId: DIAMOND, streamName: 'Diamond' },
    { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_eng', streamId: SAPPHIRE, streamName: 'Sapphire' },
  ];
  mockCoverageDocs = [];
  mockLessonPlanDocs = [];
});

describe('GET /api/teacher-portal/dashboard — curriculum coverage', () => {
  test('a real covered record (existence = covered) is counted — previously always showed 0%', async () => {
    mockCoverageDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1', streamId: DIAMOND },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.status).toBe(200);
    const diamondRow = res.body.data.curriculumCoverage.find(r => r.streamId === DIAMOND);
    expect(diamondRow.covered).toBe(1);
    expect(diamondRow.pct).toBe(50);
  });

  test("marking Diamond's coverage does not credit the teacher's own Sapphire row for the same class-subject", async () => {
    mockCoverageDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1', streamId: DIAMOND },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    const diamondRow  = res.body.data.curriculumCoverage.find(r => r.streamId === DIAMOND);
    const sapphireRow = res.body.data.curriculumCoverage.find(r => r.streamId === SAPPHIRE);
    expect(diamondRow.covered).toBe(1);
    expect(sapphireRow.covered).toBe(0); // untouched by Diamond's mark
    expect(diamondRow.streamName).toBe('Diamond');
    expect(sapphireRow.streamName).toBe('Sapphire');
  });

  test('a legacy whole-class assignment (no streamId) still counts shared coverage as before', async () => {
    mockAssignments = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_eng' },
    ];
    mockCoverageDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.curriculumCoverage[0].covered).toBe(1);
  });
});

describe('GET /api/teacher-portal/dashboard — lessonPlans (v5.117.0)', () => {
  // This card queried a 'lesson_plans' collection that had no real writer
  // until lessons.js's /plans routes shipped — always silently returned []
  // before that. lessons.js writes lesson_plans.teacherId as the ACCOUNT
  // userId (see teaching-assignments.js's own schema comment: "userId
  // format, e.g. u_demo_t3"), which is a different identity from
  // TEACHER_ID (the teachers-collection's own id, used by this same
  // dashboard's curriculumCoverage/myClasses sections above) — filtering
  // this query by TEACHER_ID instead of the account id would silently
  // return zero results against real lesson_plans documents.
  test('filters by the account userId, not the teachers-collection id', async () => {
    mockLessonPlanDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_USER, classId: CLASS_ID, subjectId: 'subj_eng', topicTitle: 'Forces', date: '2026-09-23', objectives: 'Explain motion' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.lessonPlans).toHaveLength(1);
    expect(res.body.data.lessonPlans[0].topicTitle).toBe('Forces');
  });

  test('a plan filed under the teachers-collection id instead is correctly NOT this teacher\'s (wrong identity)', async () => {
    mockLessonPlanDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_eng', topicTitle: 'Forces', date: '2026-09-23' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.lessonPlans).toHaveLength(0);
  });
});
