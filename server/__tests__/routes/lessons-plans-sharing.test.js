/* ============================================================
   Lesson Plan Sharing — GET/PUT /api/lessons/sharing-settings,
   GET /api/lessons/plans/shareable, POST /api/lessons/plans/:id/copy

   User's explicit design intent (verbatim): "some schools want each
   teacher to have their own lesson plan, some schools don't mind if the
   same lesson plan is used across [streams] within the same class" — a
   per-school toggle, default OFF ('own'), which must never change GET
   /plans's own behavior (still always the caller's own records).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';
const SCHOOL_B = 'school_B';

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
      if ('$ne' in v) return doc[k] !== v.$ne;
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    create:  jest.fn((data) => { const doc = { ...data }; docs.push(doc); return Promise.resolve(doc); }),
    updateOne: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatchesFilter(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return Promise.resolve({ acknowledged: true });
    }),
    _docs: () => docs,
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
let mockHasExplicitSubGrant = jest.fn(() => Promise.resolve(false));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: (...args) => mockHasExplicitSubGrant(...args),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockSchoolDoc, mockTeachingAssignments, mockLessonPlans;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return {
      findOne: jest.fn(() => mockChainObj(mockSchoolDoc)),
      updateOne: jest.fn((filter, update) => { if (update.$set) Object.assign(mockSchoolDoc, update.$set); return Promise.resolve({}); }),
    };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments') return mockTeachingAssignments;
    if (collection === 'lesson_plans')         return mockLessonPlans;
    return mockMakeFakeCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const lessonsRouter = require('../../routes/lessons');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lessons', lessonsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockHasExplicitSubGrant = jest.fn(() => Promise.resolve(false));
  mockSchoolDoc = { id: SCHOOL_A };
  mockTeachingAssignments = mockMakeFakeCollection([]);
  mockLessonPlans = mockMakeFakeCollection([]);
});

function asTeacherA({ streamId = 'strm_a', grant = true } = {}) {
  mockJwtUser = { userId: 'usr_teacherA', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockHasExplicitSubGrant = jest.fn(() => Promise.resolve(grant));
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacherA', classId: 'cls_yr6', subjectId: 'subj_eng', streamId, streamName: 'A' },
  ]);
}

const SHARED_PLAN_B = {
  id: 'plan_b', schoolId: SCHOOL_A, teacherId: 'usr_teacherB', teacherName: 'Ms B', classId: 'cls_yr6', className: 'Year 6',
  streamId: 'strm_b', streamName: 'B', subjectId: 'subj_eng', subjectName: 'English', date: '2026-09-10',
  academicYearId: 'ay_2026', termId: 'term_1', topicId: 'topic_1', topicTitle: 'Unit 2', subtopicTitle: 'Metaphors',
  objectives: 'Identify metaphors', activities: 'Read poem', resources: 'Poem sheet', remarks: '',
  differentiation: { low: 'Word bank', middle: '', high: 'Extension' }, assessment: 'Quiz', homework: 'Write a metaphor',
  reflection: { wentWell: 'Went great', betterIf: '', improvement: '' }, fieldLabels: { objectives: 'Lesson Objectives' },
};

describe('GET/PUT /api/lessons/sharing-settings', () => {
  test('defaults to "own" when never configured', async () => {
    const res = await supertest(buildApp()).get('/api/lessons/sharing-settings');
    expect(res.body.data).toEqual({ mode: 'own' });
  });

  test('admin (floor) can turn sharing on without needing lessons__template explicitly granted', async () => {
    const res = await supertest(buildApp()).put('/api/lessons/sharing-settings').send({ mode: 'shared_within_class' });
    expect(res.status).toBe(200);
    expect(mockSchoolDoc.lessonPlanSharing.mode).toBe('shared_within_class');
  });

  test('a teacher without the lessons__template grant cannot change it', async () => {
    asTeacherA({ grant: false });
    const res = await supertest(buildApp()).put('/api/lessons/sharing-settings').send({ mode: 'shared_within_class' });
    expect(res.status).toBe(403);
  });

  test('rejects an invalid mode value', async () => {
    const res = await supertest(buildApp()).put('/api/lessons/sharing-settings').send({ mode: 'everyone_sees_everything' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/lessons/plans/shareable', () => {
  test('returns empty when sharing is off, even if a colleague has a real plan', async () => {
    mockLessonPlans = mockMakeFakeCollection([SHARED_PLAN_B]);
    asTeacherA();
    const res = await supertest(buildApp()).get('/api/lessons/plans/shareable?classId=cls_yr6&subjectId=subj_eng');
    expect(res.body.data).toEqual([]);
  });

  test('when sharing is on, shows a colleague\'s plan for the same class+subject, excluding the caller\'s own', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([
      SHARED_PLAN_B,
      { ...SHARED_PLAN_B, id: 'plan_own', teacherId: 'usr_teacherA' }, // the caller's own — must be excluded
    ]);
    asTeacherA();
    const res = await supertest(buildApp()).get('/api/lessons/plans/shareable?classId=cls_yr6&subjectId=subj_eng');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('plan_b');
    expect(res.body.data[0].teacherName).toBe('Ms B');
  });

  test('a teacher not assigned to this class+subject at all is forbidden', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([SHARED_PLAN_B]);
    mockJwtUser = { userId: 'usr_stranger', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([]);
    const res = await supertest(buildApp()).get('/api/lessons/plans/shareable?classId=cls_yr6&subjectId=subj_eng');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/lessons/plans/:id/copy', () => {
  test('sharing off: a non-admin teacher cannot copy', async () => {
    mockLessonPlans = mockMakeFakeCollection([SHARED_PLAN_B]);
    asTeacherA();
    const res = await supertest(buildApp()).post('/api/lessons/plans/plan_b/copy').send({ targetStreamId: 'strm_a' });
    expect(res.status).toBe(403);
  });

  test('sharing on: creates a new, independently-owned plan with the source content, and never touches the source', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([SHARED_PLAN_B]);
    asTeacherA({ streamId: 'strm_a' });

    const res = await supertest(buildApp()).post('/api/lessons/plans/plan_b/copy').send({ targetStreamId: 'strm_a' });
    expect(res.status).toBe(201);

    const copy = res.body.data;
    expect(copy.id).not.toBe('plan_b');
    expect(copy.teacherId).toBe('usr_teacherA');
    expect(copy.streamId).toBe('strm_a');
    expect(copy.streamName).toBe('A');
    expect(copy.topicTitle).toBe('Unit 2');
    expect(copy.objectives).toBe('Identify metaphors');
    expect(copy.copiedFrom).toEqual({ planId: 'plan_b', teacherId: 'usr_teacherB', teacherName: 'Ms B' });
    // Reflection is per-lesson-delivery — never carried over from the source.
    expect(copy.reflection).toEqual({ wentWell: '', betterIf: '', improvement: '' });

    const source = mockLessonPlans._docs().find(d => d.id === 'plan_b');
    expect(source.teacherId).toBe('usr_teacherB'); // untouched
    expect(source.reflection.wentWell).toBe('Went great'); // untouched
    expect(mockLessonPlans._docs()).toHaveLength(2);
  });

  test('a teacher can override the date (their stream may teach it on a different day)', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([SHARED_PLAN_B]);
    asTeacherA({ streamId: 'strm_a' });
    const res = await supertest(buildApp()).post('/api/lessons/plans/plan_b/copy').send({ targetStreamId: 'strm_a', date: '2026-09-12' });
    expect(res.body.data.date).toBe('2026-09-12');
  });

  test('copying into a stream the caller is not actually assigned to is forbidden', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([SHARED_PLAN_B]);
    asTeacherA({ streamId: 'strm_a' }); // only assigned to strm_a
    const res = await supertest(buildApp()).post('/api/lessons/plans/plan_b/copy').send({ targetStreamId: 'strm_ghost' });
    expect(res.status).toBe(403);
  });

  test('copying a plan that does not exist 404s', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    asTeacherA();
    const res = await supertest(buildApp()).post('/api/lessons/plans/plan_ghost/copy').send({ targetStreamId: 'strm_a' });
    expect(res.status).toBe(404);
  });

  test('tenant isolation: cannot copy a plan belonging to another school, even with the exact real id', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([{ ...SHARED_PLAN_B, schoolId: SCHOOL_B }]);
    asTeacherA({ streamId: 'strm_a' });
    const res = await supertest(buildApp()).post('/api/lessons/plans/plan_b/copy').send({ targetStreamId: 'strm_a' });
    expect(res.status).toBe(404); // looks exactly like "doesn't exist" — never leaks that it belongs to another school
  });
});

describe('GET /api/lessons/plans/shareable — tenant isolation', () => {
  test('a same-class-and-subject plan from another school never appears, even by ID coincidence', async () => {
    mockSchoolDoc.lessonPlanSharing = { mode: 'shared_within_class' };
    mockLessonPlans = mockMakeFakeCollection([{ ...SHARED_PLAN_B, id: 'plan_cross', schoolId: SCHOOL_B }]);
    asTeacherA();
    const res = await supertest(buildApp()).get('/api/lessons/plans/shareable?classId=cls_yr6&subjectId=subj_eng');
    expect(res.body.data).toEqual([]);
  });
});
