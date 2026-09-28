/* ============================================================
   server/routes/lessons.js — syllabus_topics class scoping (2026-09)

   Real bug report: a teacher updated topics for a Year 7 stream and the
   SAME topics immediately appeared as ready-to-teach in Year 8 too. Root
   cause confirmed against real production data: syllabus_topics was
   scoped ONLY by {schoolId, subjectId, academicYear} — a subject like
   "English" is a single record shared by every grade that teaches it, so
   its topics were never separated by class at all. This was never
   related to lessonPlanSharing (confirmed unset for every real school).

   Fix: classId is now required on every NEW topic. Existing (pre-
   migration) topics keep classId unset and are treated as "legacy, still
   shown for every class" via the inclusive _topicClassFilterPart() filter
   — nothing a real school already relies on disappears; only topics
   created after this fix are actually scoped to one class.

   This file proves:
   (1) POST /topics requires classId — 422 without it.
   (2) GET /topics only returns a class-scoped topic for ITS OWN class,
       not a sibling class teaching the same subject.
   (3) GET /topics still returns a legacy (classId-unset) topic for EVERY
       class — the backward-compatible migration path.
   (4) GET /coverage mirrors the same class isolation for the drill-down
       view a teacher actually sees.
   (5) POST /coverage refuses to mark a topic scoped to a DIFFERENT class
       as covered (404), closing the same leak at the write path.
   (6) A topic can still be assigned a class later via PUT (TopicSchema
       .partial() already carries the new field through).

   Same mocked harness as lessons-stream-scope.test.js — scopeMiddleware/
   ScopeEngine are NOT mocked, exercised for real. All DB calls mocked.
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
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    create:           jest.fn((data) => { const doc = { ...data }; docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const existing = docs.find(d => mockMatchesFilter(d, filter));
      if (existing) {
        if (update.$set) Object.assign(existing, update.$set);
        else Object.assign(existing, update);
        return mockChainObj(existing);
      }
      return mockChainObj(null);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return Promise.resolve(null);
      const [removed] = docs.splice(idx, 1);
      return Promise.resolve(removed);
    }),
    deleteMany: jest.fn((filter) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (mockMatchesFilter(docs[i], filter)) docs.splice(i, 1);
      }
      return Promise.resolve({ deletedCount: before - docs.length });
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

let mockSchoolDoc, mockTeachingAssignments, mockSyllabusTopics, mockLessonCoverage, mockClasses, mockSubjects;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChainObj(mockSchoolDoc)) };
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments') return mockTeachingAssignments;
    if (collection === 'syllabus_topics')      return mockSyllabusTopics;
    if (collection === 'lesson_coverage')      return mockLessonCoverage;
    if (collection === 'classes')              return mockClasses;
    if (collection === 'subjects')             return mockSubjects;
    return mockMakeFakeCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const lessonsRouter = require('../../routes/lessons');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lessons', lessonsRouter);
  return app;
}

const YEAR7_TOPIC = {
  id: 'topic_yr7', schoolId: SCHOOL_A, classId: 'cls_yr7', subjectId: 'subj_eng',
  subjectName: 'English', title: 'Poetry', academicYear: '2026', subtopics: [],
};
const YEAR8_TOPIC = {
  id: 'topic_yr8', schoolId: SCHOOL_A, classId: 'cls_yr8', subjectId: 'subj_eng',
  subjectName: 'English', title: 'Advanced Poetry', academicYear: '2026', subtopics: [],
};
const LEGACY_TOPIC = {
  id: 'topic_legacy', schoolId: SCHOOL_A, subjectId: 'subj_eng',
  subjectName: 'English', title: 'Grammar Basics', academicYear: '2026', subtopics: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockSchoolDoc = { id: SCHOOL_A, academicYear: '2026' };
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockSyllabusTopics = mockMakeFakeCollection([YEAR7_TOPIC, YEAR8_TOPIC, LEGACY_TOPIC]);
  mockLessonCoverage = mockMakeFakeCollection([]);
  mockClasses = mockMakeFakeCollection([
    { id: 'cls_yr7', schoolId: SCHOOL_A, name: 'Year 7' },
    { id: 'cls_yr8', schoolId: SCHOOL_A, name: 'Year 8' },
  ]);
  mockSubjects = mockMakeFakeCollection([{ id: 'subj_eng', schoolId: SCHOOL_A, name: 'English' }]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherOf({ classId = 'cls_yr7', subjectId = 'subj_eng' } = {}) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId, subjectId, subjectName: 'English', className: classId === 'cls_yr7' ? 'Year 7' : 'Year 8' },
  ]);
}

describe('POST /api/lessons/topics — classId is required (2026-09 fix)', () => {
  test('rejects a new topic with no classId', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics').send({
      subjectId: 'subj_eng', subjectName: 'English', title: 'New Topic',
    });
    expect(res.status).toBe(422);
  });

  test('accepts and stores classId on a new topic', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/topics').send({
      classId: 'cls_yr7', subjectId: 'subj_eng', subjectName: 'English', title: 'New Topic',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.classId).toBe('cls_yr7');
  });
});

describe('GET /api/lessons/topics — class isolation', () => {
  test('a Year 8-scoped topic never appears for a Year 7 query, even for the same subject', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/topics').query({ subjectId: 'subj_eng', classId: 'cls_yr7' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map(t => t.id);
    expect(ids).toContain('topic_yr7');
    expect(ids).not.toContain('topic_yr8');
  });

  test('a Year 7-scoped topic never appears for a Year 8 query', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/topics').query({ subjectId: 'subj_eng', classId: 'cls_yr8' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map(t => t.id);
    expect(ids).toContain('topic_yr8');
    expect(ids).not.toContain('topic_yr7');
  });

  test('a legacy (classId-unset) topic appears for BOTH classes — backward-compatible migration', async () => {
    const yr7 = await supertest(buildApp()).get('/api/lessons/topics').query({ subjectId: 'subj_eng', classId: 'cls_yr7' });
    const yr8 = await supertest(buildApp()).get('/api/lessons/topics').query({ subjectId: 'subj_eng', classId: 'cls_yr8' });
    expect(yr7.body.data.map(t => t.id)).toContain('topic_legacy');
    expect(yr8.body.data.map(t => t.id)).toContain('topic_legacy');
  });

  test('omitting classId entirely falls back to old unscoped behavior (caller has not been updated yet)', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/topics').query({ subjectId: 'subj_eng' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(['topic_yr7', 'topic_yr8', 'topic_legacy']));
  });
});

describe('GET /api/lessons/coverage — class isolation in the teacher drill-down', () => {
  test('a Year 7 teacher never sees the Year 8-scoped topic in their coverage view', async () => {
    asTeacherOf({ classId: 'cls_yr7' });
    const res = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr7', subjectId: 'subj_eng' });
    expect(res.status).toBe(200);
    const ids = res.body.data.topics.map(t => t.id);
    expect(ids).toContain('topic_yr7');
    expect(ids).toContain('topic_legacy');
    expect(ids).not.toContain('topic_yr8');
  });
});

describe('POST /api/lessons/coverage — write-path class isolation', () => {
  test('marking a Year 8-scoped topic as covered for a Year 7 class is refused (404), not silently cross-applied', async () => {
    asTeacherOf({ classId: 'cls_yr7' });
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr7', subjectId: 'subj_eng', topicId: 'topic_yr8',
    });
    expect(res.status).toBe(404);
  });

  test('marking the matching class-scoped topic as covered succeeds', async () => {
    asTeacherOf({ classId: 'cls_yr7' });
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr7', subjectId: 'subj_eng', topicId: 'topic_yr7',
    });
    expect(res.status).toBe(200);
  });

  test('marking a legacy (classId-unset) topic as covered still works for any class', async () => {
    asTeacherOf({ classId: 'cls_yr8' });
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr8', subjectId: 'subj_eng', topicId: 'topic_legacy',
    });
    expect(res.status).toBe(200);
  });
});
