/* ============================================================
   GET /api/class-subjects/enrollment-analytics

   New view: for every subject on a class's curriculum, how many of
   that class's active students are actually enrolled in it — a
   different axis from enrollment-warnings (per-STUDENT subject
   counts vs min/max rules). Exactly the shape of gap that hid 6
   students missing from a Kiswahili elective roster for weeks (see
   CHANGELOG/project memory) — this is the view meant to surface that
   kind of problem directly instead of only after a parent complaint.

   Covers:
     1. A compulsory subject short of the full roster is flagged via
        `gap` (roster size minus enrolled).
     2. An elective subject's partial coverage is NOT flagged (`gap`
        is null) — that's expected, the roster splits across electives.
     3. A student enrolled in zero subjects at all is counted in
        `unenrolledStudents`.
     4. Scope: an unrestricted (management) caller sees every class;
        a scoped caller sees only their assigned class(es).
     5. ?classId narrows to one class.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_1', schoolId: SCHOOL }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

let mockScope; // null = unrestricted; { classIds: [...] } = scoped
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (req, _res, next) => { req.scope = mockScope; next(); } }));
jest.mock('../../utils/scopeEngine', () => ({
  resolveClassPickerScope: jest.fn(async (req) => req.scope),
  applyToFilter: jest.fn((req, _module, filter) => {
    if (!req.scope) return filter; // school-level: unrestricted
    filter.id = { $in: req.scope.classIds ?? [] };
    return filter;
  }),
}));

function mockChain(result) {
  return { sort: () => mockChain(result), select: () => mockChain(result), lean: () => Promise.resolve(result) };
}
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
    }
    return doc[k] === v;
  });
}
let mockStores;
function mockCollFor(col) {
  const docs = () => mockStores[col] || (mockStores[col] = []);
  return {
    find:     (filter) => mockChain(docs().filter(d => matches(d, filter))),
    aggregate: async (pipeline) => {
      const matchStage = pipeline.find(s => s.$match)?.$match ?? {};
      const matched = docs().filter(d => matches(d, matchStage));
      const groups = {};
      for (const d of matched) {
        const key = `${d.classId}::${d.subjectId}`;
        groups[key] ??= { _id: { classId: d.classId, subjectId: d.subjectId }, count: 0 };
        groups[key].count++;
      }
      return Object.values(groups);
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (col) => mockCollFor(col),
}));

const express   = require('express');
const supertest = require('supertest');
const classSubjectsRouter = require('../../routes/class-subjects');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/class-subjects', classSubjectsRouter);
  return app;
}

beforeEach(() => {
  mockScope = null;
  mockStores = {
    classes: [
      { id: 'cls_1', schoolId: SCHOOL, name: 'Form 1A' },
      { id: 'cls_2', schoolId: SCHOOL, name: 'Form 1B' },
    ],
    class_subjects: [
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_math', isCompulsoryForClass: true },
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_french', isCompulsoryForClass: false },
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_kiswahili', isCompulsoryForClass: false },
    ],
    subjects: [
      { id: 'sub_math', schoolId: SCHOOL, name: 'Mathematics' },
      { id: 'sub_french', schoolId: SCHOOL, name: 'French' },
      { id: 'sub_kiswahili', schoolId: SCHOOL, name: 'Kiswahili' },
    ],
    students: [
      { id: 'stu_1', schoolId: SCHOOL, classId: 'cls_1', status: 'active' },
      { id: 'stu_2', schoolId: SCHOOL, classId: 'cls_1', status: 'active' },
      { id: 'stu_3', schoolId: SCHOOL, classId: 'cls_1', status: 'active' },
    ],
    // Math (compulsory): only 2 of 3 students enrolled — a real gap.
    // French/Kiswahili (electives): split the roster, no gap expected.
    // stu_3 has zero enrollments at all.
    student_subjects: [
      { schoolId: SCHOOL, classId: 'cls_1', studentId: 'stu_1', subjectId: 'sub_math' },
      { schoolId: SCHOOL, classId: 'cls_1', studentId: 'stu_2', subjectId: 'sub_math' },
      { schoolId: SCHOOL, classId: 'cls_1', studentId: 'stu_1', subjectId: 'sub_french' },
      { schoolId: SCHOOL, classId: 'cls_1', studentId: 'stu_2', subjectId: 'sub_kiswahili' },
    ],
  };
});

describe('GET /api/class-subjects/enrollment-analytics', () => {
  test('flags a compulsory subject short of the full roster', async () => {
    const res = await supertest(buildApp()).get('/api/class-subjects/enrollment-analytics?classId=cls_1');
    expect(res.status).toBe(200);
    const cls1 = res.body.data.classes.find(c => c.classId === 'cls_1');
    const math = cls1.subjects.find(s => s.subjectId === 'sub_math');
    expect(math.enrolled).toBe(2);
    expect(math.rosterSize).toBe(3);
    expect(math.gap).toBe(1); // 1 active student missing from a compulsory subject
  });

  test('does not flag an elective subject even though it only covers part of the roster', async () => {
    const res = await supertest(buildApp()).get('/api/class-subjects/enrollment-analytics?classId=cls_1');
    const cls1 = res.body.data.classes.find(c => c.classId === 'cls_1');
    const french = cls1.subjects.find(s => s.subjectId === 'sub_french');
    expect(french.enrolled).toBe(1);
    expect(french.gap).toBeNull(); // partial elective coverage is expected, not a gap
  });

  test('counts a student with zero subject enrollments at all', async () => {
    const res = await supertest(buildApp()).get('/api/class-subjects/enrollment-analytics?classId=cls_1');
    const cls1 = res.body.data.classes.find(c => c.classId === 'cls_1');
    expect(cls1.unenrolledStudents).toBe(1); // stu_3
  });

  test('unrestricted caller sees every class', async () => {
    mockScope = null;
    const res = await supertest(buildApp()).get('/api/class-subjects/enrollment-analytics');
    expect(res.body.data.classes.map(c => c.classId).sort()).toEqual(['cls_1', 'cls_2']);
  });

  test('a scoped caller sees only their assigned class(es)', async () => {
    mockScope = { classIds: ['cls_2'] };
    const res = await supertest(buildApp()).get('/api/class-subjects/enrollment-analytics');
    expect(res.body.data.classes.map(c => c.classId)).toEqual(['cls_2']);
  });
});
