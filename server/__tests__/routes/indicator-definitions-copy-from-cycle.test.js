/* ============================================================
   server/routes/indicator-marks.js — POST /definitions/copy-from-cycle
   (2026-11)

   Audit requested directly ahead of End-Term: Kindergarten classes
   need Mid-Term and End-of-Term competency entry to coexist instead
   of overwriting each other. Unlike copy-from-section (which always
   copies across sibling classes), this route does one of two
   different things depending on what already exists for the
   destination cycle — see its own header comment for the full
   reasoning:

   1. ADOPT (relabel in place) any unclaimed legacy data (no `cycle`
      field at all — exactly what every indicator/mark entered before
      this feature existed looks like, since the Kindergarten Markbook
      already required picking an Assessment before this route
      existed). Adoption must preserve every already-entered mark —
      it changes no indicator ids, only relabels them.
   2. Otherwise, COPY from another cycle into brand-new, independent
      rows — marks are deliberately NOT carried over on this path; a
      new cycle's scores start blank.

   Same mock harness as indicator-definitions-copy-from-section.test.js,
   extended with updateMany (for the adopt path).
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
    if (cond === null) { if (val !== null && val !== undefined) return false; continue; }
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
    updateMany: (filter, update) => {
      const matched = store.filter(d => mockMatches(d, filter));
      for (const d of matched) if (update.$set) Object.assign(d, update.$set);
      return Promise.resolve({ matchedCount: matched.length, modifiedCount: matched.length });
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

const TEACHER_ASSIGNED = { userId: 'usr_t1', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

const TEMPLATE_A = {
  id: 'tmplA', schoolId: SCHOOL_A, status: 'active', classIds: ['classA'],
  performanceBands: [{ id: 'bandGood', label: 'Good', defaultScore: 8, grade: 'B' }],
  subjects: [{ id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science' }],
};

function validBody(overrides = {}) {
  return { classId: 'classA', subjectId: 'subj_science', termNumber: 2, cycle: 'ET', ...overrides };
}

beforeEach(() => {
  mockTeachingAssignments  = [{ schoolId: SCHOOL_A, teacherId: 'usr_t1', classId: 'classA', subjectId: 'subj_science', streamId: null }];
  mockClassSubjects        = [{ schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', isCompulsoryForClass: true }];
  mockRcTemplates          = [{ ...TEMPLATE_A, subjects: [{ ...TEMPLATE_A.subjects[0] }] }];
  mockIndicatorMarks       = [];
  mockIndicatorDefinitions = [];
  mockAcademicConfig       = { schoolId: SCHOOL_A, archivedAcademicYears: [] };
});

describe('POST /definitions/copy-from-cycle — ADOPT path (unclaimed legacy data)', () => {
  test('adopts legacy (cycle-less) indicators AND their already-entered marks in place — no new ids, nothing duplicated', async () => {
    mockIndicatorDefinitions = [
      { id: 'legacy1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Identify shapes', maxScore: 10 },
    ];
    mockIndicatorMarks = [
      { id: 'mark1', schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'classA', subjectId: 'subj_science', indicatorId: 'legacy1', termNumber: 2, academicYearId: null, score: 8 },
    ];

    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-cycle').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ copied: 0, adopted: 1 });

    // Same row, same id — relabelled, not duplicated.
    expect(mockIndicatorDefinitions).toHaveLength(1);
    expect(mockIndicatorDefinitions[0].id).toBe('legacy1');
    expect(mockIndicatorDefinitions[0].cycle).toBe('ET');

    // The already-entered mark survived, now explicitly tagged too —
    // the critical safety property: a teacher's real score never
    // appears to vanish just because this feature shipped.
    expect(mockIndicatorMarks).toHaveLength(1);
    expect(mockIndicatorMarks[0].id).toBe('mark1');
    expect(mockIndicatorMarks[0].score).toBe(8);
    expect(mockIndicatorMarks[0].cycle).toBe('ET');
  });

  test('a no-op when the destination cycle already has its own indicators (never re-adopts or duplicates)', async () => {
    mockIndicatorDefinitions = [
      { id: 'et1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, cycle: 'ET', order: 0, text: 'Already set up for End Term', maxScore: 10 },
      { id: 'legacy1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, order: 0, text: 'Legacy text', maxScore: 10 },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-cycle').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ copied: 0, adopted: 0 });
    expect(mockIndicatorDefinitions).toHaveLength(2); // nothing added, nothing changed
    expect(mockIndicatorDefinitions.find(d => d.id === 'legacy1').cycle).toBeUndefined();
  });
});

describe('POST /definitions/copy-from-cycle — COPY path (legacy already claimed by a different cycle)', () => {
  test('copies from the already-adopted Mid-Term cycle into brand-new, independent rows — marks do NOT carry over', async () => {
    mockIndicatorDefinitions = [
      { id: 'mt1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, cycle: 'MT', order: 0, text: 'Identify shapes', maxScore: 10, updatedAt: '2026-10-01T00:00:00.000Z' },
    ];
    mockIndicatorMarks = [
      { id: 'mtMark1', schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'classA', subjectId: 'subj_science', indicatorId: 'mt1', termNumber: 2, academicYearId: null, cycle: 'MT', score: 9 },
    ];

    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-cycle').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ copied: 1, adopted: 0, sourceCycle: 'MT' });

    const etDefs = mockIndicatorDefinitions.filter(d => d.cycle === 'ET');
    expect(etDefs).toHaveLength(1);
    expect(etDefs[0].text).toBe('Identify shapes');
    expect(etDefs[0].id).not.toBe('mt1'); // new, independent id

    // Marks are NOT copied — End Term starts blank for scores.
    expect(mockIndicatorMarks.filter(m => m.cycle === 'ET')).toHaveLength(0);
    // Mid-Term's own data is completely untouched.
    expect(mockIndicatorDefinitions.find(d => d.id === 'mt1')).toMatchObject({ cycle: 'MT', text: 'Identify shapes' });
    expect(mockIndicatorMarks.find(m => m.id === 'mtMark1')).toMatchObject({ cycle: 'MT', score: 9 });
  });

  test('editing or deleting the End-Term copy never touches the Mid-Term source', async () => {
    mockIndicatorDefinitions = [
      { id: 'mt1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, cycle: 'MT', order: 0, text: 'Identify shapes', maxScore: 10, updatedAt: '2026-10-01T00:00:00.000Z' },
    ];
    await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-cycle').send(validBody());
    const etDef = mockIndicatorDefinitions.find(d => d.cycle === 'ET');

    // Edit the ET copy's text.
    const editRes = await supertest(buildApp(TEACHER_ASSIGNED))
      .put(`/api/indicator-marks/definitions/${etDef.id}`)
      .send({ text: 'Identify shapes and colours (End Term, expanded)' });
    expect(editRes.status).toBe(200);
    expect(mockIndicatorDefinitions.find(d => d.id === 'mt1').text).toBe('Identify shapes'); // Mid-Term unchanged

    // Delete the ET copy entirely.
    const delRes = await supertest(buildApp(TEACHER_ASSIGNED)).delete(`/api/indicator-marks/definitions/${etDef.id}`);
    expect(delRes.status).toBe(200);
    expect(mockIndicatorDefinitions.filter(d => d.cycle === 'ET')).toHaveLength(0);
    expect(mockIndicatorDefinitions.find(d => d.id === 'mt1')).toBeTruthy(); // Mid-Term still there
  });

  test('a locked Mid-Term does not block starting a new End-Term cycle', async () => {
    mockIndicatorDefinitions = [
      { id: 'mt1', schoolId: SCHOOL_A, classId: 'classA', subjectId: 'subj_science', termNumber: 2, academicYearId: null, cycle: 'MT', order: 0, text: 'Identify shapes', maxScore: 10, updatedAt: '2026-10-01T00:00:00.000Z' },
    ];
    mockIndicatorMarks = [
      { id: 'mtMark1', schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'classA', subjectId: 'subj_science', indicatorId: 'mt1', termNumber: 2, academicYearId: null, cycle: 'MT', isLocked: true },
    ];
    const res = await supertest(buildApp(TEACHER_ASSIGNED)).post('/api/indicator-marks/definitions/copy-from-cycle').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ copied: 1, sourceCycle: 'MT' });
  });
});
