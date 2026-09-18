/* ============================================================
   server/routes/lessons.js — stream-scoped coverage (2026-09, Milestone 3)

   Before this fix, `lessons` was not streamAware at all — a teacher
   whose ONLY grant for a class-subject was a stream-scoped assignment
   (teaching-assignments.js's per-stream grant, e.g. English taught
   separately to 2A and 2B) got an outright 403 opening their own class's
   coverage view (isClassInScope denied unconditionally, regardless of
   streamCount), and "My Classes" showed duplicate, indistinguishable
   cards for the two streams sharing one merged coverage record.

   This file proves: (1) GET /coverage now allows a stream-only teacher
   for their OWN stream and denies a sibling stream; (2) POST /coverage
   gained a real class-ownership check it never had before (any teacher
   could previously mark coverage for any class); (3) coverage records
   are correctly identity-scoped by streamId — marking one stream never
   touches a sibling stream's or the whole class's shared coverage;
   (4) a plain whole-class assignment (no streamId) is completely
   unaffected — same shared-coverage behavior as before this fix existed.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as attendance-stream-scope.test.js.

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
// Unlike the simpler mocks elsewhere in this suite, this one correctly
// handles `$exists` — the exact mechanism _streamFilterPart() relies on
// to distinguish "no streamId at all" (whole-class, legacy shape) from
// "a specific streamId" records. A mock that treats every object-valued
// filter clause as an automatic match (as several older mocks in this
// suite do) would silently hide any bug in that distinction.
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
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const existing = docs.find(d => mockMatchesFilter(d, filter));
      if (existing) {
        if (update.$set) Object.assign(existing, update.$set);
        return mockChainObj(existing);
      }
      const created = {
        ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v === null)),
        ...(update.$set ?? {}),
        ...(update.$setOnInsert ?? {}),
      };
      docs.push(created);
      return mockChainObj(created);
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

const TOPIC = { id: 'topic_1', schoolId: SCHOOL_A, subjectId: 'subj_eng', subjectName: 'English', title: 'Grammar', academicYear: '2026', subtopics: [] };

// "mock"-prefixed — babel-plugin-jest-hoist only permits a jest.mock()
// factory to close over out-of-scope variables whose name starts with
// "mock" (the same convention every other mocked test file in this repo
// already follows for its own seed data referenced inside a factory).
let mockSchoolDoc, mockTeachingAssignments, mockSyllabusTopics, mockLessonCoverage, mockClasses;
jest.mock('../../utils/model', () => ({
  // scopeMiddleware.js's _loadAssigned reads teaching_assignments via
  // _model() directly, not tenantModel() — must be routed here too, or
  // req.scope always computes as "zero assignments" regardless of what
  // mockTeachingAssignments is seeded with.
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

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockSchoolDoc = { id: SCHOOL_A, academicYear: '2026' };
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockSyllabusTopics = mockMakeFakeCollection([TOPIC]);
  mockLessonCoverage = mockMakeFakeCollection([]);
  mockClasses = mockMakeFakeCollection([{ id: 'cls_yr2', schoolId: SCHOOL_A, name: 'Year 2' }]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

// Compulsory-subject, stream-scoped assignment(s) — no whole-class grant.
function asStreamTeacherOf(...streamAssignments) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection(
    streamAssignments.map(({ classId, streamId, streamName, subjectId }) => ({
      schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId, streamId, streamName,
      subjectId: subjectId ?? 'subj_eng', subjectName: 'English', className: 'Year 2',
    }))
  );
}

describe('GET /api/lessons/coverage — stream-only teacher', () => {
  test('is denied outright with no streamId at all — same as a teacher with zero assignments', async () => {
    asStreamTeacherOf({ classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' });
    const res = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr2', subjectId: 'subj_eng' });
    expect(res.status).toBe(403);
  });

  test('is allowed for THEIR OWN stream', async () => {
    asStreamTeacherOf({ classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' });
    const res = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr2', subjectId: 'subj_eng', streamId: 'strm_diamond' });
    expect(res.status).toBe(200);
  });

  test('is denied for a SIBLING stream of the same class they do not teach', async () => {
    asStreamTeacherOf({ classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' });
    const res = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr2', subjectId: 'subj_eng', streamId: 'strm_sapphire' });
    expect(res.status).toBe(403);
  });

  test('a whole-class teacher (no streamId on their assignment) still works with no streamId param — unchanged behavior', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', subjectName: 'English', className: 'Year 2' },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr2', subjectId: 'subj_eng' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/lessons/coverage — class-ownership check (new — this route had NONE before)', () => {
  test('a teacher CANNOT mark coverage for a class they have no assignment in at all', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([]); // no assignments anywhere
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(res.status).toBe(403);
    expect(mockLessonCoverage._docs()).toHaveLength(0);
  });

  test('a stream-only teacher CANNOT mark coverage for a sibling stream they do not teach', async () => {
    asStreamTeacherOf({ classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' });
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_sapphire', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(res.status).toBe(403);
    expect(mockLessonCoverage._docs()).toHaveLength(0);
  });

  test('a stream-only teacher CAN mark coverage for their own stream', async () => {
    asStreamTeacherOf({ classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' });
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_diamond', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(res.status).toBe(200);
    expect(mockLessonCoverage._docs()).toHaveLength(1);
    expect(mockLessonCoverage._docs()[0].streamId).toBe('strm_diamond');
  });

  test('an admin can still mark coverage for any class regardless of scope (existing "on behalf of" ability preserved)', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_diamond', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/lessons/coverage — streamId identity (marking one stream never touches another)', () => {
  test('marking Diamond covered does not create or affect a Sapphire coverage record', async () => {
    asStreamTeacherOf(
      { classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' },
      { classId: 'cls_yr2', streamId: 'strm_sapphire', streamName: 'Sapphire' },
    );
    await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_diamond', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(mockLessonCoverage._docs()).toHaveLength(1);
    expect(mockLessonCoverage._docs()[0].streamId).toBe('strm_diamond');

    // Now mark Sapphire too — must create a SEPARATE record, not update the Diamond one.
    await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_sapphire', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(mockLessonCoverage._docs()).toHaveLength(2);
    const streamIds = mockLessonCoverage._docs().map(d => d.streamId).sort();
    expect(streamIds).toEqual(['strm_diamond', 'strm_sapphire']);
  });

  test('a plain whole-class assignment (no streamId) creates a record with NO streamId field — legacy shape unchanged', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', subjectName: 'English', className: 'Year 2' },
    ]);
    await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', subjectId: 'subj_eng', topicId: 'topic_1',
    });
    expect(mockLessonCoverage._docs()).toHaveLength(1);
    expect(mockLessonCoverage._docs()[0]).not.toHaveProperty('streamId');
  });

  test('GET /coverage for one stream never shows a sibling stream\'s coverage as done', async () => {
    asStreamTeacherOf(
      { classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' },
      { classId: 'cls_yr2', streamId: 'strm_sapphire', streamName: 'Sapphire' },
    );
    await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_diamond', subjectId: 'subj_eng', topicId: 'topic_1',
    });

    const diamondView = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr2', subjectId: 'subj_eng', streamId: 'strm_diamond' });
    expect(diamondView.body.data.topics[0].covered).toBe(true);

    const sapphireView = await supertest(buildApp()).get('/api/lessons/coverage').query({ classId: 'cls_yr2', subjectId: 'subj_eng', streamId: 'strm_sapphire' });
    expect(sapphireView.body.data.topics[0].covered).toBe(false); // NOT covered — Diamond's mark didn't leak in
  });
});

describe('GET /api/lessons/my-classes — distinct cards per stream (no more duplicates)', () => {
  test('two stream-scoped assignments for the same class-subject produce two DISTINCT, independently-scored cards', async () => {
    asStreamTeacherOf(
      { classId: 'cls_yr2', streamId: 'strm_diamond', streamName: 'Diamond' },
      { classId: 'cls_yr2', streamId: 'strm_sapphire', streamName: 'Sapphire' },
    );
    // Mark ONLY Diamond's topic covered before reading the summary.
    await supertest(buildApp()).post('/api/lessons/coverage').send({
      classId: 'cls_yr2', streamId: 'strm_diamond', subjectId: 'subj_eng', topicId: 'topic_1',
    });

    const res = await supertest(buildApp()).get('/api/lessons/my-classes');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const diamond  = res.body.data.find(c => c.streamId === 'strm_diamond');
    const sapphire = res.body.data.find(c => c.streamId === 'strm_sapphire');
    expect(diamond.streamName).toBe('Diamond');
    expect(sapphire.streamName).toBe('Sapphire');
    expect(diamond.pct).toBe(100);   // 1 of 1 topic covered
    expect(sapphire.pct).toBe(0);    // untouched by Diamond's mark
  });
});
