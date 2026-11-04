/* ============================================================
   server/routes/lessons.js — who signed this record, and how many
   rows one teaching assignment is allowed to become.

   Two defects found live from the mobile app on 2026-10-31, both proven
   here against a mocked DB (no MongoDB required), neither needing a real
   token:

   1. Every coverage mark and lesson plan written by a signed-in teacher
      stored `teacherName: ''`. The JWT has never carried a `name` claim
      (auth.js's _buildTokenPayload issues userId/schoolId/email/role/
      roles/tv), so `req.jwtUser.name` was undefined on every request —
      and `req.jwtUser.name ?? ''` turned that into a permanently blank
      name baked into the record. The staff record's title + names is what
      a plan is signed with elsewhere in this module (lesson-plans.js, and
      the seeded coverage rows read "Ms. Lilian Wairimu"), so the writer
      now resolves that at write time, falling back to the login's own
      display name when there is no staff profile.

   2. GET /api/lessons/my-classes printed the same class+subject twice,
      one row named and one blank. teaching_assignments has no unique
      index, so two rows for one identity (teacher+class+subject+stream)
      can and did coexist — the demo seed's timetable mirror adding a
      sparse row beside a rich one an operator had created through the
      web UI. my-classes mapped every row it found. The same duplicate
      also reaches the plan-import path, where _resolveStreamTargets
      counts rows to decide "one stream" versus "more than one — say
      which", so one duplicated stream row failed an import as ambiguous
      while naming the same stream twice.

      scopeMiddleware/ScopeEngine are NOT mocked — exercised for real,
      same discipline as lessons-stream-scope.test.js.
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
    find:            jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:         jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments:  jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
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
    updateOne: jest.fn((filter, update) => {
      const existing = docs.find(d => mockMatchesFilter(d, filter));
      if (existing) {
        if (update.$set) Object.assign(existing, update.$set);
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }
      docs.push({
        ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v === null)),
        ...(update.$set ?? {}),
        ...(update.$setOnInsert ?? {}),
      });
      return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
    }),
    _docs: () => docs,
  };
}

// No `name` anywhere in these fixtures — deliberate: this is exactly what a
// real signed-in token looks like, which is the whole bug.
let mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: async () => false,
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const TOPIC = { id: 'topic_1', schoolId: SCHOOL_A, classId: 'cls_yr2', subjectId: 'subj_eng', subjectName: 'English', title: 'Grammar', academicYear: '2026', subtopics: [] };

let mockSchoolDoc, mockTeachingAssignments, mockSyllabusTopics, mockLessonCoverage, mockClasses, mockTeachers, mockUsers;
jest.mock('../../utils/model', () => ({
  // resolveTeacher and scopeMiddleware's _loadAssigned both read through
  // _model() directly, not tenantModel() — route them to the same fakes the
  // tenant-aware calls hit, or the name resolves as "no staff record".
  _model: jest.fn((c) => {
    if (c === 'schools')              return { findOne: jest.fn(() => mockChainObj(mockSchoolDoc)) };
    if (c === 'teaching_assignments') return mockTeachingAssignments;
    if (c === 'teachers')             return mockTeachers;
    if (c === 'users')                return mockUsers;
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
    if (collection === 'users')                return mockUsers;
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

const TEACHER = { userId: 'usr_teacher', email: 'agnes@example.test', name: 'Agnes (login)' };

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: TEACHER.userId, schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockSchoolDoc = { id: SCHOOL_A, academicYear: '2026' };
  mockSyllabusTopics = mockMakeFakeCollection([TOPIC]);
  mockLessonCoverage = mockMakeFakeCollection([]);
  mockClasses = mockMakeFakeCollection([{ id: 'cls_yr2', schoolId: SCHOOL_A, name: 'Year 2' }]);
  // Default: the teacher holds a plain whole-class assignment.
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', subjectName: 'English', streamId: null },
  ]);
  mockTeachers = mockMakeFakeCollection([
    { id: 'tch_1', userId: 'usr_teacher', schoolId: SCHOOL_A, title: 'Ms.', firstName: 'Agnes', lastName: 'Otieno', email: TEACHER.email },
  ]);
  mockUsers = mockMakeFakeCollection([
    { id: 'usr_teacher', schoolId: SCHOOL_A, name: TEACHER.name, email: TEACHER.email },
    { id: 'usr_admin',   schoolId: SCHOOL_A, name: 'Ada Admin',    email: 'admin@example.test' },
    { id: 'usr_other',   schoolId: SCHOOL_A, name: 'Other Login',  email: 'other@example.test' },
  ]);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_other', SCHOOL_A);
});

const coverageBody = { classId: 'cls_yr2', subjectId: 'subj_eng', topicId: 'topic_1' };

describe('POST /api/lessons/coverage — the name on the record', () => {
  test('is the staff record\'s title + names, not the blank the missing JWT claim produced', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send(coverageBody);
    expect(res.status).toBe(200);
    expect(res.body.data.teacherName).toBe('Ms. Agnes Otieno');
  });

  test('falls back to the login\'s own display name when the teacher has no staff profile', async () => {
    mockTeachers = mockMakeFakeCollection([]);
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send(coverageBody);
    expect(res.status).toBe(200);
    expect(res.body.data.teacherName).toBe('Agnes (login)');
  });

  test('follows the teacher an admin submits on behalf of, not the admin signing in', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    mockTeachers = mockMakeFakeCollection([
      { id: 'tch_1', userId: 'usr_admin', schoolId: SCHOOL_A, title: 'Mr.', firstName: 'Ada', lastName: 'Admin' },
      { id: 'tch_2', userId: 'usr_other', schoolId: SCHOOL_A, title: 'Mr.', firstName: 'Sam', lastName: 'Wanjiru' },
    ]);
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send({ ...coverageBody, teacherId: 'usr_other' });
    expect(res.status).toBe(200);
    expect(res.body.data.teacherName).toBe('Mr. Sam Wanjiru');
    expect(res.body.data.teacherId).toBe('usr_other');
  });

  test('writes a name at all — the premise is that no request ever carried one', async () => {
    expect(mockJwtUser.name).toBeUndefined();
    const res = await supertest(buildApp()).post('/api/lessons/coverage').send(coverageBody);
    expect(res.body.data.teacherName).not.toBe('');
  });
});

describe('GET /api/lessons/my-classes — one identity, one row', () => {
  test('collapses two rows for the same class+subject, keeping the one that knows its names', async () => {
    // Exactly what the demo database held: a rich row created through the web
    // UI, and a sparse timetable-mirror row the seed inserted beside it.
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', streamId: null },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', subjectName: 'English', streamId: null },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/my-classes');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ classId: 'cls_yr2', className: 'Year 2', subjectName: 'English' });
  });

  test('keeps two streams of the same class+subject as the two rows they are', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', subjectName: 'English', streamId: 'strm_diamond', streamName: 'Diamond' },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', subjectName: 'English', streamId: 'strm_ruby',    streamName: 'Ruby' },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', streamId: 'strm_diamond' },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/my-classes');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map(r => r.streamName).sort()).toEqual(['Diamond', 'Ruby']);
  });

  test('never merges two subjects or two classes that share a teacher', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', subjectName: 'English', streamId: null },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_math', subjectName: 'Mathematics', streamId: null },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr3', className: 'Year 3', subjectId: 'subj_eng', subjectName: 'English', streamId: null },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/my-classes');
    expect(res.body.data).toHaveLength(3);
  });

  test('counts coverage once per identity, so a duplicated row cannot double a class total', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', className: 'Year 2', subjectId: 'subj_eng', subjectName: 'English', streamId: null },
      { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', streamId: null },
    ]);
    mockLessonCoverage = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, classId: 'cls_yr2', subjectId: 'subj_eng', topicId: 'topic_1', academicYear: '2026' },
    ]);
    const res = await supertest(buildApp()).get('/api/lessons/my-classes');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].coveredItems).toBe(1);
    // One topic with no subtopics is one coverable item — 1/1, not 1/2.
    expect(res.body.data[0].totalItems).toBe(1);
  });
});
