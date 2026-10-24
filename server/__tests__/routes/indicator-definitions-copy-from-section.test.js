/* ============================================================
   server/routes/indicator-marks.js — POST /definitions/copy-from-section
   (2026-10-24)

   Direct request: a school may model Kindergarten as several separate
   CLASSES in one section (KG1/KG2/KG3/Playgroup), not streams of one
   class — streams of one class already share indicator_definitions
   for free (classId-scoped only, no streamId filter anywhere in this
   file), but sibling CLASSES are genuinely different classId's. This
   route pre-fills a genuinely blank class/subject/term from whichever
   sibling class in the same section (classes.sectionKey) already has
   indicators for that exact subject+term — "pre-filled, then
   independent": a one-time copy into new, separately-owned rows, never
   a live-shared list.

   Same mock harness as indicator-definitions.test.js (real canWriteSubject/
   isElective/isInCurriculum, only their own DB reads mocked), extended
   with a `classes` store (for sectionKey) and insertMany support.
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
let mockClasses              = [];
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
    find:   (filter = {}) => ({
      select: function () { return this; },
      sort:   function () { return this; },
      limit:  function () { return this; },
      lean:   () => Promise.resolve(store.filter(d => mockMatches(d, filter))),
    }),
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
    create:      (doc)  => { store.push({ ...doc }); return Promise.resolve({ ...doc }); },
    insertMany:  (docs) => { store.push(...docs.map(d => ({ ...d }))); return Promise.resolve(docs); },
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
    if (collection === 'classes')               return mockCollFor(mockClasses);
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

const TEMPLATE_A = {
  id: 'tmplA', schoolId: SCHOOL_A, status: 'active', classIds: ['classA', 'classB'],
  performanceBands: [{ id: 'bandGood', label: 'Good', defaultScore: 8, grade: 'B' }],
  subjects: [{ id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science' }],
};

function validBody(overrides = {}) {
  return { classId: 'classA', subjectId: 'subj_science', termNumber: 2, ...overrides };
}

beforeEach(() => {
  // classA (KG2, destination) and classB (KG1, sibling source) share
  // sectionKey 'kg'; classD (a different section) never qualifies.
  mockClasses = [
    { schoolId: SCHOOL_A, id: 'classA', sectionKey: 'kg' },
    { schoolId: SCHOOL_A, id: 'classB', sectionKey: 'kg' },
    { schoolId: SCHOOL_A, id: 'classD', sectionKey: 'primary' },
  ];
  mockTeachingAssignments  = [{ schoolId: SCHOOL_A, teacherId: 'usr_t1', classId: 'classA', subjectId: 'subj_science', streamId: null }];
  mockClassSubjects        = [
    { schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', isCompulsoryForClass: true },
    { schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', isCompulsoryForClass: true },
  ];
  mockRcTemplates          = [{ ...TEMPLATE_A, subjects: [{ ...TEMPLATE_A.subjects[0] }] }];
  mockIndicatorMarks       = [];
  mockIndicatorDefinitions = [];
  mockAcademicConfig       = { schoolId: SCHOOL_A, archivedAcademicYears: [] };
});

describe('POST /definitions/copy-from-section', () => {
  test('copies every indicator from a sibling class in the same section into new, independent rows', async () => {
    mockIndicatorDefinitions = [
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Identify shapes', maxScore: 10, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b2', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 1, text: 'Count to 20', maxScore: 15, createdAt: '2026-01-01T00:00:01.000Z' },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ copied: 2, sourceClassId: 'classB' });

    const copied = mockIndicatorDefinitions.filter(d => d.classId === 'classA');
    expect(copied).toHaveLength(2);
    expect(copied.map(d => d.text).sort()).toEqual(['Count to 20', 'Identify shapes']);
    expect(copied.map(d => d.maxScore).sort()).toEqual([10, 15]);
    // New, independent ids — never the same row referenced twice.
    expect(copied.map(d => d.id)).not.toContain('b1');
    expect(copied.map(d => d.id)).not.toContain('b2');
    // Source rows untouched.
    expect(mockIndicatorDefinitions.filter(d => d.classId === 'classB')).toHaveLength(2);
  });

  test('a no-op (never an error) when the destination already has its own indicators', async () => {
    mockIndicatorDefinitions = [
      { id: 'a1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Already here', maxScore: 10 },
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Sibling text', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data.copied).toBe(0);
    expect(mockIndicatorDefinitions).toHaveLength(2); // nothing added
  });

  test('a no-op when no sibling class has anything for this exact subject', async () => {
    mockIndicatorDefinitions = [
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_math', termNumber: 2, academicYearId: null, order: 0, text: 'Different subject entirely', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data.copied).toBe(0);
    expect(mockIndicatorDefinitions.filter(d => d.classId === 'classA')).toHaveLength(0);
  });

  test('a class in a different section is never used as a source', async () => {
    mockIndicatorDefinitions = [
      { id: 'd1', schoolId: SCHOOL_A, classId: 'classD', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Primary section, not KG', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data.copied).toBe(0);
  });

  test('a no-op when the class has no section at all', async () => {
    mockClasses = mockClasses.map(c => c.id === 'classA' ? { ...c, sectionKey: undefined } : c);
    mockIndicatorDefinitions = [
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Sibling text', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data.copied).toBe(0);
  });

  test('rejected when the destination class/subject is not assigned a competency template (same guard as POST /definitions)', async () => {
    mockRcTemplates = [{ ...TEMPLATE_A, subjects: [] }]; // classA/classB no longer carry subj_science
    mockIndicatorDefinitions = [
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Sibling text', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? res.body.error).toMatch(/Kindergarten Templates/i);
    expect(mockIndicatorDefinitions.filter(d => d.classId === 'classA')).toHaveLength(0);
  });

  test('an unassigned teacher is forbidden, same gate as POST /definitions', async () => {
    mockIndicatorDefinitions = [
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Sibling text', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_UNASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(403);
    expect(mockIndicatorDefinitions.filter(d => d.classId === 'classA')).toHaveLength(0);
  });

  test('rejected once the destination class/subject/term is locked (published)', async () => {
    mockIndicatorMarks = [{ schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, isLocked: true }];
    mockIndicatorDefinitions = [
      { id: 'b1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Sibling text', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(403);
    expect(mockIndicatorDefinitions.filter(d => d.classId === 'classA')).toHaveLength(0);
  });

  test('picks the earliest-created sibling set when more than one sibling has indicators', async () => {
    mockIndicatorDefinitions = [
      { id: 'c1', schoolId: SCHOOL_A, classId: 'classB', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Earlier sibling', maxScore: 10, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    // classC — a third KG sibling, created a mark LATER than classB's.
    mockClasses.push({ schoolId: SCHOOL_A, id: 'classC', sectionKey: 'kg' });
    mockIndicatorDefinitions.push(
      { id: 'c2', schoolId: SCHOOL_A, classId: 'classC', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Later sibling', maxScore: 10, createdAt: '2026-02-01T00:00:00.000Z' }
    );
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-section').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ copied: 1, sourceClassId: 'classB' });
    expect(mockIndicatorDefinitions.find(d => d.classId === 'classA').text).toBe('Earlier sibling');
  });
});
