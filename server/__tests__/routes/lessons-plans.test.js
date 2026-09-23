/* ============================================================
   server/routes/lessons.js — Lesson Plans (Trinitas + Trinity, 2026-09)

   New feature: a real per-lesson planning document (Topic/Subtopic +
   objectives/activities/resources/remarks + differentiation + assessment
   + homework + reflection), distinct from the existing syllabus/coverage
   tracker but built on top of it — Topic/Subtopic is a REQUIRED picker
   sourced from syllabus_topics, so a subject with zero topics literally
   has nothing plannable yet (the "update topics first" precondition,
   enforced by construction rather than a separate check).

   This file proves:
   (1) POST /plans requires a real topic for that subject — 404 if none.
   (2) POST /plans enforces the same class[-stream] ownership ScopeEngine
       check coverage already has — a teacher can't plan for a class they
       don't teach.
   (3) GET /plans always scopes to the caller's own records unless
       admin/HOD — a personal planning record, not shared reference data.
   (4) PUT/DELETE /plans/:id are owner-only, with NO HOD carve-out — HOD
       can view (isHodOrAdmin) but not edit someone else's plan, matching
       "Reflection is the subject teacher's own" exactly. Admin can.
   (5) PUT merges differentiation/reflection field-by-field instead of
       replacing wholesale — filling in Reflection weeks later doesn't
       blow away previously-saved Differentiation text.
   (6) GET /plans/:id/pdf renders a real PDF and is gated the same way as
       the plain GET.

   scopeMiddleware/ScopeEngine are NOT mocked — exercised for real, same
   discipline as lessons-stream-scope.test.js. All DB calls are mocked.
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
      if ('$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      if ('$gte' in v || '$lte' in v) {
        if ('$gte' in v && !(doc[k] >= v.$gte)) return false;
        if ('$lte' in v && !(doc[k] <= v.$lte)) return false;
        return true;
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
      if (existing) { Object.assign(existing, update); return mockChainObj(existing); }
      return mockChainObj(null);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return Promise.resolve(null);
      const [removed] = docs.splice(idx, 1);
      return Promise.resolve(removed);
    }),
    deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 0 })),
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

const TOPIC = { id: 'topic_1', schoolId: SCHOOL_A, subjectId: 'subj_eng', subjectName: 'English', title: 'Grammar', subtopics: [{ id: 'sub_1', title: 'Nouns' }] };

let mockSchoolDoc, mockTeachingAssignments, mockSyllabusTopics, mockLessonPlans, mockClasses, mockSubjects, mockStreams, mockAcademicYears;
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
    if (collection === 'lesson_plans')         return mockLessonPlans;
    if (collection === 'classes')              return mockClasses;
    if (collection === 'subjects')             return mockSubjects;
    if (collection === 'streams')              return mockStreams;
    if (collection === 'academic_years')       return mockAcademicYears;
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
  mockLessonPlans = mockMakeFakeCollection([]);
  mockClasses = mockMakeFakeCollection([{ id: 'cls_yr2', schoolId: SCHOOL_A, name: 'Year 2' }]);
  mockSubjects = mockMakeFakeCollection([{ id: 'subj_eng', schoolId: SCHOOL_A, name: 'English' }]);
  mockStreams = mockMakeFakeCollection([{ id: 'strm_diamond', schoolId: SCHOOL_A, name: 'Diamond' }]);
  mockAcademicYears = mockMakeFakeCollection([]);
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherOf({ classId = 'cls_yr2', streamId, subjectId = 'subj_eng' } = {}) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId, ...(streamId ? { streamId } : {}), subjectId, subjectName: 'English', className: 'Year 2' },
  ]);
}

const BASE_BODY = { classId: 'cls_yr2', subjectId: 'subj_eng', date: '2026-09-23', topicId: 'topic_1', subtopicId: 'sub_1', objectives: 'Identify nouns' };

describe('POST /api/lessons/plans — the "update topics first" precondition', () => {
  test('rejects a topicId that does not exist for this subject', async () => {
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({ ...BASE_BODY, topicId: 'topic_ghost' });
    expect(res.status).toBe(404);
  });

  test('rejects when the subject genuinely has zero topics', async () => {
    asTeacherOf({ subjectId: 'subj_math' });
    mockSyllabusTopics = mockMakeFakeCollection([]); // no topics at all for subj_math
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({ ...BASE_BODY, subjectId: 'subj_math', topicId: 'topic_1' });
    expect(res.status).toBe(404);
  });

  test('a real topic for this subject succeeds', async () => {
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.topicTitle).toBe('Grammar');
    expect(res.body.data.subtopicTitle).toBe('Nouns');
  });
});

describe('POST /api/lessons/plans — template field labels + custom fields (v5.117.3)', () => {
  test('snapshots the default builtin labels onto the record when the school has no saved template', async () => {
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.fieldLabels.objectives).toBe('Lesson Objectives');
    expect(res.body.data.fieldLabels.reflection_went_well).toBe('What went well');
  });

  test('snapshots the SCHOOL-CONFIGURED label, not the default, once a template is saved', async () => {
    mockSchoolDoc.lessonPlanTemplate = {
      fields: [{ key: 'homework', label: 'Prep Work', enabled: true, required: false, order: 8 }],
    };
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.fieldLabels.homework).toBe('Prep Work');
  });

  test('accepts and stores customFields as self-contained {key,label,value} triples', async () => {
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({
      ...BASE_BODY,
      customFields: [{ key: 'custom_links', label: 'Cross-curricular links', value: 'Links to Science unit 3' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.customFields).toEqual([{ key: 'custom_links', label: 'Cross-curricular links', value: 'Links to Science unit 3' }]);
  });

  test('PUT preserves customFields untouched when the request omits the key entirely', async () => {
    asTeacherOf();
    const created = await supertest(buildApp()).post('/api/lessons/plans').send({
      ...BASE_BODY,
      customFields: [{ key: 'custom_links', label: 'Cross-curricular links', value: 'Links to Science unit 3' }],
    });
    const res = await supertest(buildApp()).put(`/api/lessons/plans/${created.body.data.id}`).send({ objectives: 'Updated objective' });
    expect(res.status).toBe(200);
    expect(res.body.data.customFields).toEqual([{ key: 'custom_links', label: 'Cross-curricular links', value: 'Links to Science unit 3' }]);
  });
});

describe('POST/PUT /api/lessons/plans — server-side required-field enforcement (v5.117.4)', () => {
  test('POST rejects when a required BUILTIN field (per the live template) is empty', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'assessment', label: 'Assessment & Evaluation', enabled: true, required: true, order: 7 }] };
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY); // assessment omitted
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('Assessment & Evaluation');
  });

  test('POST succeeds once the required builtin field is actually filled', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'assessment', label: 'Assessment & Evaluation', enabled: true, required: true, order: 7 }] };
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({ ...BASE_BODY, assessment: 'Exit ticket' });
    expect(res.status).toBe(201);
  });

  test('a DISABLED field is never enforced even if marked required', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'assessment', label: 'Assessment & Evaluation', enabled: false, required: true, order: 7 }] };
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    expect(res.status).toBe(201);
  });

  test('POST rejects when a required CUSTOM field is missing entirely', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'custom_links', label: 'Cross-curricular links', enabled: true, required: true, order: 12 }] };
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY); // no customFields sent at all
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('Cross-curricular links');
  });

  test('POST succeeds once the required custom field is filled', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'custom_links', label: 'Cross-curricular links', enabled: true, required: true, order: 12 }] };
    asTeacherOf();
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({
      ...BASE_BODY, customFields: [{ key: 'custom_links', label: 'Cross-curricular links', value: 'Links to Science' }],
    });
    expect(res.status).toBe(201);
  });

  test('PUT rejects a merged final state that would leave a required field empty', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'objectives', label: 'Lesson Objectives', enabled: true, required: true, order: 0 }] };
    asTeacherOf();
    const created = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY); // objectives filled at creation
    expect(created.status).toBe(201);
    const res = await supertest(buildApp()).put(`/api/lessons/plans/${created.body.data.id}`).send({ objectives: '' });
    expect(res.status).toBe(422);
  });

  test('PUT editing an unrelated field does not fail just because it doesn\'t re-send an already-satisfied required field', async () => {
    mockSchoolDoc.lessonPlanTemplate = { fields: [{ key: 'objectives', label: 'Lesson Objectives', enabled: true, required: true, order: 0 }] };
    asTeacherOf();
    const created = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    const res = await supertest(buildApp()).put(`/api/lessons/plans/${created.body.data.id}`).send({ remarks: 'Bring extra materials' });
    expect(res.status).toBe(200); // objectives already satisfied on the existing doc — merged state still valid
  });
});

describe('POST /api/lessons/plans — class[-stream] ownership (mirrors coverage exactly)', () => {
  test('a teacher with no assignment for this class is forbidden', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockTeachingAssignments = mockMakeFakeCollection([]);
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    expect(res.status).toBe(403);
  });

  test('a stream-only teacher is forbidden for a sibling stream', async () => {
    asTeacherOf({ streamId: 'strm_diamond' });
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({ ...BASE_BODY, streamId: 'strm_sapphire' });
    expect(res.status).toBe(403);
  });

  test('a stream-only teacher succeeds for THEIR OWN stream', async () => {
    asTeacherOf({ streamId: 'strm_diamond' });
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({ ...BASE_BODY, streamId: 'strm_diamond' });
    expect(res.status).toBe(201);
    expect(res.body.data.streamName).toBe('Diamond');
  });

  test('admin can create on behalf of another teacher', async () => {
    const res = await supertest(buildApp()).post('/api/lessons/plans').send({ ...BASE_BODY, teacherId: 'usr_teacher' });
    expect(res.status).toBe(201);
    expect(res.body.data.teacherId).toBe('usr_teacher');
  });

  // Same bug class as classes-lessons-scope.test.js: exams_officer (and
  // admissions_officer/finance/hr/timetabler/discipline_committee) are
  // ROLE_SCOPE_LEVEL 'school' for their OWN module, which — before
  // resolveLessonsScope existed — also made ScopeEngine.isClassInScope
  // treat them as unrestricted for Lesson Plans, purely as a side effect
  // of scopeMiddleware computing one generic scope per request.
  test('a "school-level-for-its-own-module" role with no real teaching assignment is forbidden, not waved through', async () => {
    mockJwtUser = { userId: 'usr_exams', schoolId: SCHOOL_A, role: 'exams_officer', roles: ['exams_officer'] };
    mockTeachingAssignments = mockMakeFakeCollection([]);
    const res = await supertest(buildApp()).post('/api/lessons/plans').send(BASE_BODY);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/lessons/plans — scoped to own records', () => {
  beforeEach(() => {
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_mine', schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', date: '2026-09-23' },
      { id: 'plan_other', schoolId: SCHOOL_A, teacherId: 'usr_other', classId: 'cls_yr2', subjectId: 'subj_eng', date: '2026-09-23' },
    ]);
  });

  test('a teacher sees only their own, even when asking for another teacherId', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans').query({ teacherId: 'usr_other' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(p => p.id)).toEqual(['plan_mine']);
  });

  test('HOD can filter by any teacherId', async () => {
    mockJwtUser = { userId: 'usr_hod', schoolId: SCHOOL_A, role: 'hod', roles: ['hod'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans').query({ teacherId: 'usr_other' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(p => p.id)).toEqual(['plan_other']);
  });
});

describe('GET/PUT/DELETE /api/lessons/plans/:id — ownership, no HOD edit carve-out', () => {
  beforeEach(() => {
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_1', schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr2', subjectId: 'subj_eng', topicId: 'topic_1', date: '2026-09-23',
        differentiation: { low: 'existing-low', middle: 'existing-mid', high: 'existing-high' },
        reflection: { wentWell: '', betterIf: '', improvement: '' } },
    ]);
  });

  test('GET: the owning teacher can view their own', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans/plan_1');
    expect(res.status).toBe(200);
  });

  test('GET: a different teacher is forbidden', async () => {
    mockJwtUser = { userId: 'usr_other', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans/plan_1');
    expect(res.status).toBe(403);
  });

  test('GET: HOD (not the subject teacher) CAN view for oversight', async () => {
    mockJwtUser = { userId: 'usr_hod', schoolId: SCHOOL_A, role: 'hod', roles: ['hod'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans/plan_1');
    expect(res.status).toBe(200);
  });

  test('PUT: HOD (not admin, not the subject teacher) is forbidden from editing — "Reflection is the subject teacher\'s own"', async () => {
    mockJwtUser = { userId: 'usr_hod', schoolId: SCHOOL_A, role: 'hod', roles: ['hod'] };
    const res = await supertest(buildApp()).put('/api/lessons/plans/plan_1').send({ reflection: { wentWell: 'Great engagement' } });
    expect(res.status).toBe(403);
  });

  test('PUT: the owning subject teacher can fill in Reflection later', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).put('/api/lessons/plans/plan_1').send({ reflection: { wentWell: 'Great engagement' } });
    expect(res.status).toBe(200);
    expect(res.body.data.reflection.wentWell).toBe('Great engagement');
  });

  test('PUT: filling in Reflection does NOT clobber previously-saved Differentiation', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).put('/api/lessons/plans/plan_1').send({ reflection: { wentWell: 'Great engagement' } });
    expect(res.status).toBe(200);
    expect(res.body.data.differentiation).toEqual({ low: 'existing-low', middle: 'existing-mid', high: 'existing-high' });
  });

  test('PUT: a partial Reflection update merges field-by-field, not wholesale', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    await supertest(buildApp()).put('/api/lessons/plans/plan_1').send({ reflection: { wentWell: 'Great engagement' } });
    const res2 = await supertest(buildApp()).put('/api/lessons/plans/plan_1').send({ reflection: { betterIf: 'More group work' } });
    expect(res2.status).toBe(200);
    expect(res2.body.data.reflection).toEqual({ wentWell: 'Great engagement', betterIf: 'More group work', improvement: '' });
  });

  test('DELETE: a different teacher is forbidden', async () => {
    mockJwtUser = { userId: 'usr_other', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).delete('/api/lessons/plans/plan_1');
    expect(res.status).toBe(404); // ownership folded into the lookup filter, same as DELETE /coverage/:id
  });

  test('DELETE: the owner can delete their own', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).delete('/api/lessons/plans/plan_1');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/lessons/plans/:id/pdf', () => {
  beforeEach(() => {
    mockSchoolDoc = { id: SCHOOL_A, name: 'Trinitas International School', academicYear: '2026' };
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_1', schoolId: SCHOOL_A, teacherId: 'usr_teacher', teacherName: 'Jane Teacher', classId: 'cls_yr2', className: 'Year 2',
        subjectId: 'subj_eng', subjectName: 'English', topicId: 'topic_1', topicTitle: 'Grammar', date: '2026-09-23',
        objectives: 'Identify nouns', activities: 'Group work', resources: 'Textbook',
        differentiation: { low: 'Picture cards', middle: 'Worksheet', high: 'Extension task' },
        assessment: 'Exit ticket', homework: 'Workbook p.12',
        reflection: { wentWell: '', betterIf: '', improvement: '' } },
    ]);
  });

  test('the owning teacher gets a real PDF back', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans/plan_1/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('a different teacher is forbidden', async () => {
    mockJwtUser = { userId: 'usr_other', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/lessons/plans/plan_1/pdf');
    expect(res.status).toBe(403);
  });
});
