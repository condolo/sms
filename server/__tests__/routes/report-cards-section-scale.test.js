/* ============================================================
   Grade scales are section-scoped (v5.168.x).

   A report is generated for one class; its scale is the one for the class's
   section, falling back to the school default, then to the legacy schema.
   If none exists, generation is refused with a clear message, not an
   undefined-scale crash. Sections come from the class (classes.sectionKey),
   because student records don't carry sectionId reliably.

   All DB calls are mocked; the real tenantModel() wrapper and resolver run.
   ============================================================ */
'use strict';

function makeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter || {}).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in v)  return v.$in.includes(doc[k]);
        if ('$ne' in v)  return doc[k] !== v.$ne;
        if ('$exists' in v) {
          const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
          return v.$exists ? has : !has;
        }
      }
      return doc[k] === v;
    });
  }
  function chain(result) {
    return { lean: () => Promise.resolve(result), select: () => chain(result), sort: () => chain(result), limit: () => chain(result), skip: () => chain(result) };
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    create:  async (doc) => { const d = { ...doc }; docs.push(d); return d; },
  };
}

let mockCurrentUser = { userId: 'usr_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] };
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

const mockEmptyCollection = {
  find:    () => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) }),
  findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }), lean: () => Promise.resolve(null) }),
  create:  async (doc) => doc,
};
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col] || mockEmptyCollection) }));

const { sectionIdForClass, resolveGradeScale } = require('../../utils/grade-scale');
const express           = require('express');
const supertest         = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

const SCHOOL = 'sch_1';
const KG_SECTION = 'sec_kg';
const PRI_SECTION = 'sec_pri';

// A tight scale (A from 85) and a generous one (A from 60), so the same mark grades differently.
const STRICT = [{ grade: 'A', min: 85, points: 4 }, { grade: 'B', min: 60, points: 3 }, { grade: 'E', min: 0, points: 0 }];
const LENIENT = [{ grade: 'A', min: 60, points: 4 }, { grade: 'B', min: 40, points: 3 }, { grade: 'E', min: 0, points: 0 }];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

function seed({ scales }) {
  const yearCur = {
    id: 'ay_cur', schoolId: SCHOOL, isCurrent: true, startDate: '2025-09-01', endDate: '2026-07-01',
    terms: [{ id: 't_1', startDate: '2025-09-01', endDate: '2026-01-01' }],
  };
  mockStores = {
    academic_years:    makeCollection([yearCur]),
    academic_config:   makeCollection([]),
    assessment_config: makeCollection([]),
    grade_boundaries:  makeCollection(scales),
    assessment_marks:  makeCollection([
      { id: 'm1', schoolId: SCHOOL, classId: 'cls_kg', subjectId: 'sub_math', studentId: 'stu_1', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_cur', rawScore: 70, markState: 'present', isPublished: true },
    ]),
    mark_submissions:  makeCollection([{ id: 's1', schoolId: SCHOOL, classId: 'cls_kg', subjectId: 'sub_math', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'ay_cur', status: 'approved' }]),
    subjects:          makeCollection([{ id: 'sub_math', schoolId: SCHOOL, name: 'Mathematics' }]),
    classes:           makeCollection([{ id: 'cls_kg', schoolId: SCHOOL, name: 'KG 1', sectionKey: 'kg' }]),
    sections:          makeCollection([{ id: KG_SECTION, schoolId: SCHOOL, key: 'kg', name: 'KG' }, { id: PRI_SECTION, schoolId: SCHOOL, key: 'primary', name: 'Primary' }]),
    students:          makeCollection([{ id: 'stu_1', schoolId: SCHOOL, classId: 'cls_kg', status: 'active', firstName: 'A', lastName: 'B' }]),
    streams:           makeCollection([]),
    teachers:          makeCollection([]),
    report_card_templates: makeCollection([]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
});

describe('resolveGradeScale — section default, then school default, then legacy', () => {
  test('a section default wins over the school default', async () => {
    seed({ scales: [
      { id: 'sc_school', schoolId: SCHOOL, name: 'School', isDefault: true, sectionId: null, bands: LENIENT },
      { id: 'sc_kg',     schoolId: SCHOOL, name: 'KG',     isDefault: true, sectionId: KG_SECTION, bands: STRICT },
    ] });
    const s = await resolveGradeScale(SCHOOL, KG_SECTION, null);
    expect(s).toMatchObject({ id: 'sc_kg', source: 'section' });
  });

  test('a section with no scale of its own uses the school default', async () => {
    seed({ scales: [{ id: 'sc_school', schoolId: SCHOOL, name: 'School', isDefault: true, sectionId: null, bands: LENIENT }] });
    expect(await resolveGradeScale(SCHOOL, PRI_SECTION, null)).toMatchObject({ id: 'sc_school', source: 'school' });
  });

  test('a school with no scale anywhere falls back to the legacy schema', async () => {
    seed({ scales: [] });
    expect(await resolveGradeScale(SCHOOL, KG_SECTION, LENIENT)).toMatchObject({ source: 'legacy' });
  });

  test('no scale at all resolves to null, not an undefined scale', async () => {
    seed({ scales: [] });
    expect(await resolveGradeScale(SCHOOL, KG_SECTION, null)).toBeNull();
  });
});

describe('sectionIdForClass — the section comes from the class', () => {
  test('a class resolves to its section through classes.sectionKey', async () => {
    seed({ scales: [] });
    expect(await sectionIdForClass(SCHOOL, 'cls_kg')).toBe(KG_SECTION);
  });

  test('a class with no sectionKey resolves to null', async () => {
    seed({ scales: [] });
    mockStores.classes = makeCollection([{ id: 'cls_x', schoolId: SCHOOL, name: 'X' }]);
    expect(await sectionIdForClass(SCHOOL, 'cls_x')).toBeNull();
  });
});

describe('POST /api/report-cards/generate — the class section\'s scale grades its students', () => {
  test('a KG class is graded by the KG section scale, not the school default', async () => {
    seed({ scales: [
      { id: 'sc_school', schoolId: SCHOOL, name: 'School', isDefault: true, sectionId: null, bands: LENIENT },
      { id: 'sc_kg',     schoolId: SCHOOL, name: 'KG',     isDefault: true, sectionId: KG_SECTION, bands: STRICT },
    ] });
    const res = await supertest(buildApp()).post('/api/report-cards/generate').send({ classId: 'cls_kg', termNumber: 1 });
    expect(res.status).toBe(200);
    // 70 is a B under the strict KG scale (A needs 85); it would be an A under the school default.
    expect(res.body.data.students[0].subjects.sub_math.grade).toBe('B');
  });

  test('a class whose section has no scale and no school default is refused with a clear message', async () => {
    seed({ scales: [] });
    const res = await supertest(buildApp()).post('/api/report-cards/generate').send({ classId: 'cls_kg', termNumber: 1 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/No grade scale is set for this class's section/);
  });
});
