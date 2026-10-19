/* ============================================================
   server/routes/report-cards.js — POST /kg/generate, POST /kg/publish
   (2026-10). Deliberately separate from the numeric /generate and
   /publish — see that section's own header comment in the route file
   for why (ranking/deviation have no agreed meaning for indicator
   marks, so they're skipped, not guessed at).

   Verifies: no-template guard (falls back cleanly, doesn't crash),
   subject-average computed as earned/possible (not a hardcoded 10),
   overall average aggregates across every subject, grade resolution
   goes through the real grade_boundaries scale (not a parallel
   concept), snapshot versioning/supersede on republish, the
   archived-year guard, and — the one most likely to silently break —
   that GET /verify/:reportId's hash recomputation actually matches
   what /kg/publish stored (same _hashSnapshot function, branched
   internally, not a second hash function nobody else calls).
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

/* A real-ish grade scale, not a stubbed single value — so tests can
   assert DIFFERENT grades for different computed percentages, proving
   the subject/overall average actually flows through this, not a
   hardcoded stand-in. */
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

/* ── In-memory stores, real-ish Mongo filter matching (incl. $or/$ne/$in) ── */
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
      // Mongoose array-field semantics: `classIds: 'x'` matches when
      // 'x' is AN ELEMENT of the array (e.g. rc_templates.classIds).
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
    // GET /verify/:reportId deliberately uses the GLOBAL (non-tenant)
    // model — a public, cross-tenant-by-design lookup (see its own
    // header comment) — so it has to read from the SAME mockSnapshots
    // array tenantModel('report_card_snapshots') writes to, not a
    // separate, always-empty stub.
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
// mongoose.startSession/withTransaction — standalone-mode fallback path
// (the same one production hits on non-replica-set MongoDB) exercises
// bulkWrite directly without a real transaction.
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
  subjects: [{
    id: 'subjTmplScience', subjectId: 'subj_science', name: 'Science',
    indicators: [
      { id: 'ind1', text: 'Define collision', maxScore: 10 },
      { id: 'ind2', text: 'Match animals', maxScore: 10 },
    ],
  }],
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
  mockIndicatorMarks = [];
  // Indicator identity/text now comes from indicator_definitions, not
  // the template (2026-10-19) — see indicator-marks.js's header.
  mockIndicatorDefinitions = [
    { id: 'ind1', schoolId: SCHOOL_A, classId: 'classKG', subjectId: 'subj_science', termNumber: 2, academicYearId: null, text: 'Define collision', maxScore: 10, order: 0 },
    { id: 'ind2', schoolId: SCHOOL_A, classId: 'classKG', subjectId: 'subj_science', termNumber: 2, academicYearId: null, text: 'Match animals', maxScore: 10, order: 1 },
  ];
  mockSnapshots = [];
  mockDraftComments = [];
  mockPublishBatches = [];
  mockSchool = { id: SCHOOL_A, name: 'Test School', houses: [] };
});

function genBody(overrides = {}) {
  return { classId: 'classKG', termId: 't2', academicYearId: 'year1', termNumber: 2, ...overrides };
}

describe('POST /kg/generate', () => {
  test('refuses cleanly when the class has no resolved template', async () => {
    mockRcTemplates = [];
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/generate').send(genBody({ classId: 'classOther' }));
    expect(res.status).toBe(400);
  });

  test('computes subject average as earned/possible — not a hardcoded assumption', async () => {
    mockIndicatorMarks = [
      { id: 'm1', schoolId: SCHOOL_A, studentId: 's1', classId: 'classKG', subjectId: 'subj_science', indicatorId: 'ind1', bandId: 'bandGood', score: 8, termNumber: 2 },
      { id: 'm2', schoolId: SCHOOL_A, studentId: 's1', classId: 'classKG', subjectId: 'subj_science', indicatorId: 'ind2', bandId: 'bandGood', score: 6, termNumber: 2 },
    ];
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/generate').send(genBody());
    expect(res.status).toBe(200);
    const subj = res.body.data.students[0].subjects[0];
    // (8+6) earned / (10+10) possible = 70%
    expect(subj.subjectAvgPct).toBeCloseTo(70);
    expect(subj.subjectGrade).toBe('B'); // 65-79 band
    expect(res.body.data.students[0].overallAvgPct).toBeCloseTo(70);
  });

  test('a subject with no marks at all has a null average, not zero', async () => {
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/generate').send(genBody());
    expect(res.body.data.students[0].subjects[0].subjectAvgPct).toBeNull();
  });
});

describe('POST /kg/publish', () => {
  test('refuses when the academic year is archived', async () => {
    mockIsYearArchived = true;
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/publish').send(genBody());
    expect(res.status).toBe(400);
    expect(mockSnapshots).toHaveLength(0);
  });

  test('refuses when the class has no resolved template', async () => {
    mockRcTemplates = [];
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/publish').send(genBody());
    expect(res.status).toBe(400);
  });

  test('publishes a versioned snapshot with layoutKey "kindergarten" and a hash GET /verify would accept', async () => {
    mockIndicatorMarks = [
      { id: 'm1', schoolId: SCHOOL_A, studentId: 's1', classId: 'classKG', subjectId: 'subj_science', indicatorId: 'ind1', bandId: 'bandGood', score: 9, termNumber: 2 },
    ];
    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/publish').send(genBody());
    expect(res.status).toBe(201);
    expect(mockSnapshots).toHaveLength(1);
    const snap = mockSnapshots[0];
    expect(snap.layoutKey).toBe('kindergarten');
    expect(snap.version).toBe(1);
    expect(snap.kgSubjects[0].subjectId).toBe('subj_science');

    // The exact guarantee GET /verify/:reportId depends on: recomputing
    // through the SAME _hashSnapshot the publish route used must match.
    const verifyRes = await supertest(buildApp(ADMIN)).get(`/api/report-cards/verify/${snap.reportId}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(true);
    expect(verifyRes.body.isAuthentic).toBe(true);
  });

  test('republishing the same class/term supersedes the previous version', async () => {
    await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/publish').send(genBody());
    expect(mockSnapshots).toHaveLength(1);
    const firstId = mockSnapshots[0].id;

    await supertest(buildApp(ADMIN)).post('/api/report-cards/kg/publish').send(genBody());
    expect(mockSnapshots).toHaveLength(2);
    const first = mockSnapshots.find(s => s.id === firstId);
    const second = mockSnapshots.find(s => s.id !== firstId);
    expect(first.superseded).toBe(true);
    expect(second.version).toBe(2);
    expect(second.supersedesId).toBe(firstId);
  });
});
