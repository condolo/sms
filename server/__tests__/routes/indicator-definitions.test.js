/* ============================================================
   server/routes/indicator-marks.js — /definitions (2026-10-19)

   Indicator TEXT moved OUT of rc_templates and into this teacher-
   managed collection, direct request: "whoever is setting the
   template is like an admin, he doesn't know all the indicators per
   subject... these indicators vary depending on what content was
   set... they have to be added manually in the Markbook." The
   template still gates WHICH subjects use indicator entry; these
   routes own the indicator text itself, scoped per class+subject+term.

   Uses the REAL canWriteSubject/isElective/isInCurriculum (only their
   own DB reads are mocked), same discipline as indicator-marks.test.js.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), hasNoAssignments: jest.fn(() => false) }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

let mockTeachingAssignments  = [];
let mockClassSubjects        = [];
let mockRcTemplates          = [];
let mockIndicatorMarks       = [];
let mockIndicatorDefinitions = [];
let mockAcademicConfig       = { schoolId: SCHOOL_A, archivedAcademicYears: [] };

function mockMatches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      if (!cond.some(sub => mockMatches(doc, sub))) return false;
      continue;
    }
    const val = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond && !cond.$in.includes(val)) return false;
      if ('$ne' in cond && val === cond.$ne) return false;
      if ('$exists' in cond && cond.$exists && val === undefined) return false;
    } else if (Array.isArray(val)) {
      if (!val.includes(cond)) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}
function mockCollFor(store) {
  return {
    find:   (filter = {}) => ({ select: function () { return this; }, sort: function () { return this; }, limit: function () { return this; }, lean: () => Promise.resolve(store.filter(d => mockMatches(d, filter))) }),
    findOne: (filter = {}) => ({ select: function () { return this; }, lean: () => Promise.resolve(store.find(d => mockMatches(d, filter)) ?? null) }),
    countDocuments: (filter = {}) => Promise.resolve(store.filter(d => mockMatches(d, filter)).length),
    findOneAndUpdate: (filter, update) => ({
      lean: () => {
        const doc = store.find(d => mockMatches(d, filter));
        if (doc && update.$set) Object.assign(doc, update.$set);
        return Promise.resolve(doc ? { ...doc } : null);
      },
    }),
    findOneAndDelete: (filter) => {
      const idx = store.findIndex(d => mockMatches(d, filter));
      if (idx === -1) return Promise.resolve(null);
      const [removed] = store.splice(idx, 1);
      return Promise.resolve(removed);
    },
    create: (doc) => { store.push({ ...doc }); return Promise.resolve({ ...doc }); },
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'academic_config') return { findOne: () => ({ lean: () => Promise.resolve(mockAcademicConfig) }) };
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments')  return mockCollFor(mockTeachingAssignments);
    if (collection === 'class_subjects')        return mockCollFor(mockClassSubjects);
    if (collection === 'rc_templates')          return mockCollFor(mockRcTemplates);
    if (collection === 'indicator_marks')       return mockCollFor(mockIndicatorMarks);
    if (collection === 'indicator_definitions') return mockCollFor(mockIndicatorDefinitions);
    return mockCollFor([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const indicatorMarksRouter = require('../../routes/indicator-marks');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/indicator-marks', indicatorMarksRouter);
  return app;
}

const TEACHER_ASSIGNED   = { userId: 'usr_t1', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
const TEACHER_UNASSIGNED = { userId: 'usr_t2', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
const ADMIN              = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };

const TEMPLATE_A = {
  id: 'tmplA', schoolId: SCHOOL_A, status: 'active', classIds: ['classA'],
  performanceBands: [{ id: 'bandGood', label: 'Good', defaultScore: 8, grade: 'B' }],
  subjects: [{ id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science' }],
};

beforeEach(() => {
  mockTeachingAssignments  = [{ schoolId: SCHOOL_A, teacherId: 'usr_t1', classId: 'classA', subjectId: 'subj_science', streamId: null }];
  mockClassSubjects        = [{ schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', isCompulsoryForClass: true }];
  mockRcTemplates          = [{ ...TEMPLATE_A, subjects: [{ ...TEMPLATE_A.subjects[0] }] }];
  mockIndicatorMarks       = [];
  mockIndicatorDefinitions = [];
  mockAcademicConfig       = { schoolId: SCHOOL_A, archivedAcademicYears: [] };
});

describe('GET /definitions', () => {
  test('returns indicators scoped to class+subject+term', async () => {
    mockIndicatorDefinitions = [
      { id: 'ind1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, order: 1, text: 'A' },
      { id: 'ind2', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 1, order: 0, text: 'Wrong term' },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).get('/api/indicator-marks/definitions').query({ classId: 'classA', subjectId: 'subj_science', termNumber: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.map(d => d.id)).toEqual(['ind1']);
  });

  test('requires classId, subjectId and termNumber', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).get('/api/indicator-marks/definitions').query({ classId: 'classA' });
    expect(res.status).toBe(400);
  });
});

describe('POST /definitions', () => {
  function validBody(overrides = {}) {
    return { classId: 'classA', subjectId: 'subj_science', termNumber: 2, text: 'Able to count to 10', ...overrides };
  }

  test('the assigned subject teacher can add an indicator', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(201);
    expect(mockIndicatorDefinitions).toHaveLength(1);
    expect(mockIndicatorDefinitions[0]).toMatchObject({ text: 'Able to count to 10', maxScore: 10, order: 0 });
  });

  test('a teacher not assigned to this subject is forbidden', async () => {
    const res = await supertest(buildApp(TEACHER_UNASSIGNED)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(403);
    expect(mockIndicatorDefinitions).toHaveLength(0);
  });

  test('rejected when the subject is not part of the class curriculum', async () => {
    mockClassSubjects = [];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(400);
  });

  test('rejected when the class/subject is not assigned a competency template', async () => {
    mockRcTemplates = [{ ...TEMPLATE_A, subjects: [] }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? res.body.error).toMatch(/Kindergarten Templates/i);
  });

  test('rejected once this class/subject/term is locked (published)', async () => {
    mockIndicatorMarks = [{ schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, isLocked: true }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(403);
    expect(mockIndicatorDefinitions).toHaveLength(0);
  });

  test('new indicators append in order', async () => {
    mockIndicatorDefinitions = [{ id: 'ind1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, order: 0, text: 'First' }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.data.order).toBe(1);
  });

  test('management can add indicators without a teaching_assignments row', async () => {
    mockTeachingAssignments = [];
    const res = await supertest(buildApp(ADMIN)).post('/api/indicator-marks/definitions').send(validBody());
    expect(res.status).toBe(201);
  });
});

describe('PUT /definitions/:id', () => {
  beforeEach(() => {
    mockIndicatorDefinitions = [{ id: 'ind1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Old text', maxScore: 10 }];
  });

  test('the assigned teacher can edit text and maxScore', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).put('/api/indicator-marks/definitions/ind1').send({ text: 'New text', maxScore: 15 });
    expect(res.status).toBe(200);
    expect(mockIndicatorDefinitions[0]).toMatchObject({ text: 'New text', maxScore: 15 });
  });

  test('an unassigned teacher is forbidden', async () => {
    const res = await supertest(buildApp(TEACHER_UNASSIGNED)).put('/api/indicator-marks/definitions/ind1').send({ text: 'Hacked' });
    expect(res.status).toBe(403);
    expect(mockIndicatorDefinitions[0].text).toBe('Old text');
  });

  test('404 for a non-existent indicator', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).put('/api/indicator-marks/definitions/missing').send({ text: 'x' });
    expect(res.status).toBe(404);
  });

  test('rejected once locked', async () => {
    mockIndicatorMarks = [{ schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, isLocked: true }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).put('/api/indicator-marks/definitions/ind1').send({ text: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /definitions/:id', () => {
  beforeEach(() => {
    mockIndicatorDefinitions = [{ id: 'ind1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'To delete' }];
  });

  test('the assigned teacher can delete an unscored indicator', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).delete('/api/indicator-marks/definitions/ind1');
    expect(res.status).toBe(200);
    expect(mockIndicatorDefinitions).toHaveLength(0);
  });

  test('rejected when students already have scores against it', async () => {
    mockIndicatorMarks = [{ schoolId: SCHOOL_A, indicatorId: 'ind1', studentId: 's1', score: 5 }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).delete('/api/indicator-marks/definitions/ind1');
    expect(res.status).toBe(400);
    expect(mockIndicatorDefinitions).toHaveLength(1);
  });

  test('an unassigned teacher is forbidden', async () => {
    const res = await supertest(buildApp(TEACHER_UNASSIGNED)).delete('/api/indicator-marks/definitions/ind1');
    expect(res.status).toBe(403);
    expect(mockIndicatorDefinitions).toHaveLength(1);
  });
});
