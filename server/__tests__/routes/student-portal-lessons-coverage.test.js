/* ============================================================
   server/routes/student-portal.js — GET /dashboard curriculum coverage
   (2026-09, found while extending lessons.js to be stream-aware)

   `lesson_coverage` documents never carry a `covered` boolean field — a
   record's mere EXISTENCE means covered (see lessons.js's POST
   /coverage). This route's own coverage aggregation filtered by
   `covered: true`, which never matched any real document — the
   "Curriculum Coverage" widget on the student dashboard showed 0% for
   every subject regardless of real progress, for as long as this route
   has existed. Fixed alongside adding streamId-awareness: a student's
   own stream's coverage, unioned with any legacy/whole-class (no
   streamId) record, so a student in one stream never gets credited (or
   penalized) by a sibling stream's progress.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const STUDENT_1 = 'stu_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: STUDENT_1 };
    next();
  },
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn() },
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
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
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
  };
}

let mockSchoolDoc, mockStudentDoc, mockCoverageDocs, mockTopicDocs, mockSubjectDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students')         return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    if (collection === 'lesson_coverage')  return mockCollection(mockCoverageDocs);
    if (collection === 'syllabus_topics')  return mockCollection(mockTopicDocs);
    if (collection === 'subjects')         return mockCollection(mockSubjectDocs);
    return mockCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const studentPortalRouter = require('../../routes/student-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/student-portal', studentPortalRouter);
  return app;
}

const CLASS_ID = 'cls_yr2';
const DIAMOND  = 'strm_diamond';
const SAPPHIRE = 'strm_sapphire';

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = {
    id: STUDENT_1, schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei',
    admissionNumber: 'ADM001', classId: CLASS_ID, className: 'Year 2', streamId: DIAMOND, status: 'active',
  };
  mockSchoolDoc = { name: 'Test School', academicYear: '2026', portalConfig: {} };
  mockSubjectDocs = [{ id: 'subj_eng', name: 'English', code: 'ENG' }];
  mockTopicDocs = [
    { id: 'topic_1', schoolId: SCHOOL_A, subjectId: 'subj_eng', academicYear: '2026', subtopics: [] },
    { id: 'topic_2', schoolId: SCHOOL_A, subjectId: 'subj_eng', academicYear: '2026', subtopics: [] },
  ];
  mockCoverageDocs = [];
});

describe('GET /api/student-portal/dashboard — curriculum coverage', () => {
  test('a real covered record (no `covered` field, existence = covered) is counted — previously always showed 0%', async () => {
    mockCoverageDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1', streamId: DIAMOND },
    ];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(200);
    const eng = res.body.data.lessonsCoverage.find(s => s.subjectId === 'subj_eng');
    expect(eng.coveredTopics).toBe(1);
    expect(eng.percentage).toBe(50); // 1 of 2 topics
  });

  test("a sibling stream's coverage is NOT credited to this student", async () => {
    mockCoverageDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1', streamId: SAPPHIRE },
    ];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    // Diamond student sees 0 covered — Sapphire's mark doesn't leak in.
    // Subject may be entirely absent from the list (distinct found nothing matching), which is equally correct.
    const eng = res.body.data.lessonsCoverage.find(s => s.subjectId === 'subj_eng');
    expect(eng?.coveredTopics ?? 0).toBe(0);
  });

  test('a legacy whole-class record (no streamId at all) still counts for every student in the class', async () => {
    mockCoverageDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1' },
    ];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const eng = res.body.data.lessonsCoverage.find(s => s.subjectId === 'subj_eng');
    expect(eng.coveredTopics).toBe(1);
  });
});
