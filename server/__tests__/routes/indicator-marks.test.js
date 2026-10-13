/* ============================================================
   server/routes/indicator-marks.js (2026-10) — the Kindergarten
   competency-band Markbook's storage layer.

   Verifies the three non-negotiable guards: subject-teacher scoping
   (a teacher not assigned to the subject is forbidden, same as the
   numeric Markbook), per-indicator maxScore validation (NOT a
   universal 10 — confirmed against real samples), and the
   year-archival guard. Plus: saving the same student/indicator twice
   updates rather than duplicates.

   Uses the REAL canWriteSubject/isElective/unassignedPairs (only their
   own DB reads are mocked) — same discipline as every other sensitive-
   permission test this session. All DB calls are an in-memory fake
   with real filter matching.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), hasNoAssignments: jest.fn(() => false) }));
// rbac() itself (the coarse grades:{read,create} gate) is a pass-through
// here — this file's job is the subject-teacher scoping / score-
// validation / archival guards INSIDE the handler, same split as
// students.test.js vs students-sensitive-permissions.test.js.
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

/* ── In-memory stores with real-ish Mongo filter matching ── */
let mockTeachingAssignments = [];
let mockClassSubjects       = [];
let mockStudents             = [];
let mockRcTemplates         = [];
let mockIndicatorMarks      = [];
let mockAcademicConfig      = { schoolId: SCHOOL_A, archivedAcademicYears: [] };

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
      // Mongo's implicit array-contains semantics for {field: scalar}
      // against an array field (e.g. rc_templates.classIds) — a naive
      // strict-equality check never matches an array against a scalar.
      if (!val.includes(cond)) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}
function mockCollFor(store) {
  return {
    find:   (filter = {}) => ({ select: function () { return this; }, lean: () => Promise.resolve(store.filter(d => mockMatches(d, filter))) }),
    findOne: (filter = {}) => ({ select: function () { return this; }, lean: () => Promise.resolve(store.find(d => mockMatches(d, filter)) ?? null) }),
    updateOne: (filter, update) => {
      const doc = store.find(d => mockMatches(d, filter));
      if (doc) Object.assign(doc, update.$set);
      return Promise.resolve({});
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
    if (collection === 'teaching_assignments') return mockCollFor(mockTeachingAssignments);
    if (collection === 'class_subjects')       return mockCollFor(mockClassSubjects);
    if (collection === 'students')             return mockCollFor(mockStudents);
    if (collection === 'rc_templates')         return mockCollFor(mockRcTemplates);
    if (collection === 'indicator_marks')      return mockCollFor(mockIndicatorMarks);
    return mockCollFor([]);
  },
}));

const express  = require('express');
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

const TEACHER_ASSIGNED    = { userId: 'usr_t1', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
const TEACHER_UNASSIGNED  = { userId: 'usr_t2', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

const TEMPLATE_A = {
  id: 'tmplA', schoolId: SCHOOL_A, status: 'active',
  // Explicit classIds — the assignment resolveRcTemplate now requires
  // POST /bulk to actually verify, not just that a template with this
  // id exists somewhere in the school.
  classIds: ['classA'],
  performanceBands: [{ id: 'bandGood', label: 'Good', defaultScore: 8, grade: 'B' }],
  subjects: [{
    id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science',
    indicators: [{ id: 'ind1', text: 'Define collision', maxScore: 10 }],
  }],
};

beforeEach(() => {
  mockTeachingAssignments = [{ schoolId: SCHOOL_A, teacherId: 'usr_t1', classId: 'classA', subjectId: 'subj_science', streamId: null }];
  mockClassSubjects  = [];
  mockStudents        = [{ id: 's1', schoolId: SCHOOL_A, streamId: null }];
  mockRcTemplates    = [{ ...TEMPLATE_A }];
  mockIndicatorMarks = [];
  mockAcademicConfig = { schoolId: SCHOOL_A, archivedAcademicYears: [] };
});

function validMark(overrides = {}) {
  return {
    studentId: 's1', classId: 'classA', subjectId: 'subj_science',
    templateId: 'tmplA', indicatorId: 'ind1', bandId: 'bandGood',
    score: 9, termNumber: 2, ...overrides,
  };
}

describe('subject-teacher scoping', () => {
  test('a teacher not assigned to this subject is forbidden', async () => {
    const res = await supertest(buildApp(TEACHER_UNASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark()] });
    expect(res.status).toBe(403);
    expect(mockIndicatorMarks).toHaveLength(0);
  });

  test('the assigned teacher can save', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark()] });
    expect(res.status).toBe(200);
    expect(mockIndicatorMarks).toHaveLength(1);
    expect(mockIndicatorMarks[0].score).toBe(9);
  });
});

describe('per-indicator maxScore validation', () => {
  test('a score within the indicator\'s own maxScore is accepted', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 10 })] });
    expect(res.status).toBe(200);
  });

  test('a score exceeding the indicator\'s maxScore is rejected — confirmed NOT universally 10', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 11 })] });
    expect(res.status).toBe(400);
    expect(mockIndicatorMarks).toHaveLength(0);
  });

  test('a higher maxScore (e.g. 20, confirmed from a real ICT sample) raises the ceiling accordingly', async () => {
    mockRcTemplates[0].subjects[0].indicators[0].maxScore = 20;
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 18 })] });
    expect(res.status).toBe(200);
  });

  test('an unknown indicatorId for the template is rejected', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ indicatorId: 'ind_unknown' })] });
    expect(res.status).toBe(400);
  });
});

describe('upsert — saving the same indicator twice updates, never duplicates', () => {
  test('a second save for the same student/indicator/term overwrites the first', async () => {
    await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 7 })] });
    await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 9 })] });
    expect(mockIndicatorMarks).toHaveLength(1);
    expect(mockIndicatorMarks[0].score).toBe(9);
  });
});

describe('year-archival guard', () => {
  test('rejects a write to an archived academic year', async () => {
    mockAcademicConfig.archivedAcademicYears = ['year_2025'];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({
      marks: [validMark({ academicYearId: 'year_2025' })],
    });
    expect(res.status).toBe(400);
    expect(mockIndicatorMarks).toHaveLength(0);
  });
});
