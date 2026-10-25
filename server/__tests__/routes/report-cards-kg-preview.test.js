/* ============================================================
   server/routes/report-cards.js — POST /kg/preview-html,
   POST /kg/preview-pdf (2026-10-24)

   Reported directly, with a screenshot: the Kindergarten report
   preview had no Print or Download button at all, unlike the ordinary
   numeric StudentReportCard.jsx. These are the KG counterparts to the
   numeric path's preview-html/preview-pdf, but — unlike those — DO
   re-run computeKgReport rather than trusting client-sent data, which
   is safe here specifically because a KG report has no ranking/GPA
   concept to lose by re-deriving it (see kg-report.js's own header).

   Same mock harness as report-cards-kg.test.js (kg/generate, kg/publish)
   — reused verbatim so this file proves the preview routes build the
   exact same snap shape /kg/publish does, just unpersisted.
   pdfkit itself is the REAL installed dependency (not mocked), same
   convention as weekly-snapshots.test.js's own PDF route test.
   ============================================================ */

const SCHOOL_A = 'school_A';
let mockIsYearArchived = false;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn().mockResolvedValue(true) }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), isClassInScope: jest.fn(() => true), resolveAttendanceScope: jest.fn(), resolveAssessmentScope: jest.fn(), resolveHomeroomStreamIds: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn(() => Promise.resolve(mockIsYearArchived)) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/ranking', () => ({
  rankStudents: jest.fn(() => []), mergeRankings: jest.fn(() => ({})), bestPerSubject: jest.fn(() => ({})), computeRankingScore: jest.fn(() => ({ rankingScore: 0, subjectsUsed: [] })),
}));
jest.mock('../../utils/academic-calc', () => ({
  aggregateAssessmentMarks: jest.fn().mockResolvedValue({}), aggregateUnmoderatedMarks: jest.fn().mockResolvedValue([]),
  computeFinalScores: jest.fn(() => ({})), attendanceSummary: jest.fn().mockResolvedValue(null), behaviourSummary: jest.fn().mockResolvedValue(null),
  attachDeviations: jest.fn(x => x), computeTermDeviation: jest.fn(),
}));

const GRADE_BANDS = [
  { min: 80, grade: 'A' }, { min: 65, grade: 'B' }, { min: 50, grade: 'C' }, { min: 0, grade: 'D' },
];
jest.mock('../../routes/academic-config', () => ({
  mergeConfig: jest.fn(c => c ?? {}),
  resolveCurrentPeriod: jest.fn(() => ({ year: { id: 'year1', terms: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] } })),
  resolveGrade: jest.fn((score, bands) => {
    const sorted = [...(bands || [])].sort((a, b) => b.min - a.min);
    const band = sorted.find(b => score >= b.min);
    return { grade: band?.grade ?? null, points: null, descriptor: null, remarks: null };
  }),
  OBSERVATION_RATING_VALUES: [], DEFAULT_GRADING_SCHEMA: GRADE_BANDS,
}));
jest.mock('../../routes/assessment', () => ({ getConfig: jest.fn() }));
jest.mock('../../routes/report-card-templates', () => ({ resolveTemplate: jest.fn().mockResolvedValue({ templateId: null, templateVersion: null, layoutKey: 'subject_paired' }) }));

let mockStudents = [];
let mockStreams = [];
let mockTeachers = [];
let mockClasses = [];
let mockSections = [];
let mockGradeBoundaries = [];
let mockRcTemplates = [];
let mockIndicatorMarks = [];
let mockIndicatorDefinitions = [];
let mockSnapshots = [];
let mockDraftComments = [];
let mockPublishBatches = [];
let mockSchool = { id: SCHOOL_A, name: 'Test School', houses: [] };

function mockMatches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') { if (!cond.some(sub => mockMatches(doc, sub))) return false; continue; }
    const val = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond && !cond.$in.includes(val)) return false;
      if ('$ne' in cond && val === cond.$ne) return false;
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
    find: (filter = {}) => ({
      select: function () { return this; }, sort: function () { return this; },
      lean: () => Promise.resolve(store.filter(d => mockMatches(d, filter))),
    }),
    findOne: (filter = {}) => ({ select: function () { return this; }, lean: () => Promise.resolve(store.find(d => mockMatches(d, filter)) ?? null) }),
    findOneAndUpdate: (filter, update) => {
      let doc = store.find(d => mockMatches(d, filter));
      if (!doc) { doc = { ...filter }; store.push(doc); }
      Object.assign(doc, update.$set);
      return { lean: () => Promise.resolve({ ...doc }) };
    },
    updateOne: (filter, update) => {
      const doc = store.find(d => mockMatches(d, filter));
      if (doc) Object.assign(doc, update.$set);
      return Promise.resolve({});
    },
    distinct: () => Promise.resolve([]),
    create: (doc) => { store.push({ ...doc }); return Promise.resolve({ ...doc }); },
    bulkWrite: (ops) => {
      for (const op of ops) {
        if (op.insertOne) store.push({ ...op.insertOne.document });
        if (op.updateOne) {
          const doc = store.find(d => mockMatches(d, op.updateOne.filter));
          if (doc) Object.assign(doc, op.updateOne.update.$set);
        }
      }
      return Promise.resolve({});
    },
  };
}
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockSchool) }) }) };
    if (c === 'report_card_snapshots') return mockCollFor(mockSnapshots);
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    const map = {
      students: mockStudents, streams: mockStreams, teachers: mockTeachers,
      classes: mockClasses, sections: mockSections, grade_boundaries: mockGradeBoundaries,
      rc_templates: mockRcTemplates, indicator_marks: mockIndicatorMarks,
      indicator_definitions: mockIndicatorDefinitions,
      report_card_snapshots: mockSnapshots, report_card_draft_comments: mockDraftComments,
      publish_batches: mockPublishBatches, invoices: [], academic_years: [],
    };
    return mockCollFor(map[collection] ?? []);
  },
}));
jest.mock('mongoose', () => ({
  startSession: jest.fn().mockRejectedValue(Object.assign(new Error('no replica set'), { code: 20 })),
  Types: { ObjectId: { isValid: () => false } },
}));

const express = require('express');
const supertest = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

const ADMIN = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };

const TEMPLATE = {
  id: 'tmplKG', schoolId: SCHOOL_A, status: 'active', name: 'KG Competency Report',
  classIds: ['classKG'], sectionId: null, isDefault: false,
  display: { showScore: true, showGrade: true, showSubjectAvg: true, showOverallAvg: true },
  performanceBands: [{ id: 'bandGood', label: 'Good', defaultScore: 8, grade: 'B' }],
  subjects: [{ id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science' }],
};

beforeEach(() => {
  mockIsYearArchived = false;
  mockStudents = [{ id: 's1', schoolId: SCHOOL_A, classId: 'classKG', status: 'active', firstName: 'Amara', lastName: 'Osei', admissionNumber: 'ADM-001', streamId: null, houseId: null }];
  mockStreams = [];
  mockTeachers = [];
  mockClasses = [{ id: 'classKG', schoolId: SCHOOL_A, sectionKey: 'kg' }];
  mockSections = [{ id: 'sec_kg', schoolId: SCHOOL_A, key: 'kg' }];
  mockGradeBoundaries = [{ id: 'scaleA', schoolId: SCHOOL_A, sectionId: 'sec_kg', isDefault: true, name: 'KG Scale', bands: GRADE_BANDS }];
  mockRcTemplates = [{ ...TEMPLATE, subjects: TEMPLATE.subjects.map(s => ({ ...s })) }];
  mockIndicatorMarks = [
    { id: 'm1', schoolId: SCHOOL_A, studentId: 's1', classId: 'classKG', subjectId: 'subj_science', indicatorId: 'ind1', bandId: 'bandGood', score: 9, termNumber: 2 },
  ];
  mockIndicatorDefinitions = [
    { id: 'ind1', schoolId: SCHOOL_A, classId: 'classKG', subjectId: 'subj_science', termNumber: 2, academicYearId: null, text: 'Define collision', maxScore: 10, order: 0 },
  ];
  mockSnapshots = [];
  mockDraftComments = [];
  mockPublishBatches = [];
  mockSchool = { id: SCHOOL_A, name: 'Test School', houses: [] };
});

function previewBody(overrides = {}) {
  return { classId: 'classKG', studentId: 's1', termId: 't2', academicYearId: 'year1', termNumber: 2, ...overrides };
}

describe('POST /kg/preview-html', () => {
  test('422s when studentId is missing (unlike /kg/generate, this route is single-student only)', async () => {
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-html').send({ classId: 'classKG', termNumber: 2 });
    expect(res.status).toBe(422);
  });

  test('renders real HTML for a draft (no persisted snapshot needed)', async () => {
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-html').send(previewBody());
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('<!DOCTYPE html>');
    expect(res.body.data.html).toContain('Amara Osei');
    expect(res.body.data.html).toContain('DRAFT'); // never published
    expect(mockSnapshots).toHaveLength(0); // genuinely nothing persisted
  });

  test('reflects the actually-saved draft comment, not a stale/absent one', async () => {
    mockDraftComments = [{ schoolId: SCHOOL_A, studentId: 's1', termNumber: 2, classTeacherRemark: 'Settling in beautifully.' }];
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-html').send(previewBody());
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('Settling in beautifully.');
  });

  test('404s for a student not in this class (or not active)', async () => {
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-html').send(previewBody({ studentId: 'stu_ghost' }));
    expect(res.status).toBe(404);
  });

  test('400s cleanly when the class has no resolved Kindergarten template', async () => {
    mockRcTemplates = [];
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-html').send(previewBody());
    expect(res.status).toBe(400);
  });
});

describe('POST /kg/preview-pdf', () => {
  test('returns a real, non-empty application/pdf response', async () => {
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-pdf').send(previewBody());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
    expect(mockSnapshots).toHaveLength(0);
  });

  test('404s for a student not in this class', async () => {
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/preview-pdf').send(previewBody({ studentId: 'stu_ghost' }));
    expect(res.status).toBe(404);
  });
});
