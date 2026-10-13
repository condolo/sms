/* ============================================================
   server/routes/indicator-marks.js — POST /bulk is now blocked while
   the matching mark_submissions record is "submitted"/"approved"
   (under review) or the target indicator_marks doc is isLocked.

   Closes the exact gap this file's own header comment used to flag:
   a teacher could submit a subject's indicator marks for review and
   keep silently editing them. Reuses the SAME mark_submissions
   collection/state-machine the numeric Markbook already has, via the
   reserved KG_INDICATORS_TYPE sentinel (see mark-submissions.js) — not
   a second moderation system.

   Uses the REAL canWriteSubject/isElective/unassignedPairs (only their
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

let mockTeachingAssignments = [];
let mockStudents            = [];
let mockRcTemplates         = [];
let mockIndicatorMarks      = [];
let mockMarkSubmissions     = [];
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
      // against an array field (e.g. rc_templates.classIds).
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
    if (collection === 'students')             return mockCollFor(mockStudents);
    if (collection === 'rc_templates')          return mockCollFor(mockRcTemplates);
    if (collection === 'indicator_marks')       return mockCollFor(mockIndicatorMarks);
    if (collection === 'mark_submissions')      return mockCollFor(mockMarkSubmissions);
    return mockCollFor([]);
  },
}));

const express  = require('express');
const supertest = require('supertest');
const indicatorMarksRouter = require('../../routes/indicator-marks');
const { KG_INDICATORS_TYPE } = require('../../routes/mark-submissions');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/indicator-marks', indicatorMarksRouter);
  return app;
}

const TEACHER_ASSIGNED = { userId: 'usr_t1', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

const TEMPLATE_A = {
  id: 'tmplA', schoolId: SCHOOL_A, status: 'active',
  classIds: ['classA'],
  performanceBands: [{ id: 'bandGood', label: 'Good', defaultScore: 8, grade: 'B' }],
  subjects: [{
    id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science',
    indicators: [{ id: 'ind1', text: 'Define collision', maxScore: 10 }],
  }],
};

beforeEach(() => {
  mockTeachingAssignments = [{ schoolId: SCHOOL_A, teacherId: 'usr_t1', classId: 'classA', subjectId: 'subj_science', streamId: null }];
  mockStudents        = [{ id: 's1', schoolId: SCHOOL_A, streamId: null }];
  mockRcTemplates     = [{ ...TEMPLATE_A }];
  mockIndicatorMarks  = [];
  mockMarkSubmissions = [];
  mockAcademicConfig  = { schoolId: SCHOOL_A, archivedAcademicYears: [] };
});

function validMark(overrides = {}) {
  return {
    studentId: 's1', classId: 'classA', subjectId: 'subj_science',
    templateId: 'tmplA', indicatorId: 'ind1', bandId: 'bandGood',
    score: 9, termNumber: 2, ...overrides,
  };
}

describe('mark_submissions under-review guard', () => {
  test.each(['submitted', 'approved'])('a %s KG submission blocks editing this class/subject/term', async (status) => {
    mockMarkSubmissions = [{
      schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2,
      assessmentType: KG_INDICATORS_TYPE, status, streamId: null,
    }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark()] });
    expect(res.status).toBe(403);
    expect(mockIndicatorMarks).toHaveLength(0);
  });

  test('a draft KG submission does NOT block editing', async () => {
    mockMarkSubmissions = [{
      schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2,
      assessmentType: KG_INDICATORS_TYPE, status: 'draft', streamId: null,
    }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark()] });
    expect(res.status).toBe(200);
  });

  test('a submission for a DIFFERENT subject does not block this one', async () => {
    mockMarkSubmissions = [{
      schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_other', termNumber: 2,
      assessmentType: KG_INDICATORS_TYPE, status: 'submitted', streamId: null,
    }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark()] });
    expect(res.status).toBe(200);
  });

  test('no submission at all does NOT block editing', async () => {
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark()] });
    expect(res.status).toBe(200);
  });
});

describe('isLocked guard', () => {
  test('a locked indicator mark rejects further edits', async () => {
    mockIndicatorMarks = [{
      id: 'im1', schoolId: SCHOOL_A, studentId: 's1', subjectId: 'subj_science',
      indicatorId: 'ind1', termNumber: 2, academicYearId: null, isLocked: true,
    }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 5 })] });
    expect(res.status).toBe(403);
    // The existing doc must be untouched, not silently overwritten.
    expect(mockIndicatorMarks[0].score).toBeUndefined();
  });

  test('an unlocked indicator mark can still be edited normally', async () => {
    mockIndicatorMarks = [{
      id: 'im1', schoolId: SCHOOL_A, studentId: 's1', subjectId: 'subj_science',
      indicatorId: 'ind1', termNumber: 2, academicYearId: null, isLocked: false, score: 5,
    }];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/bulk').send({ marks: [validMark({ score: 7 })] });
    expect(res.status).toBe(200);
    expect(mockIndicatorMarks[0].score).toBe(7);
  });
});
