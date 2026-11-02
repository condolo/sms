/* ============================================================
   server/routes/report-cards.js — POST /publish, `cycle` (2026-11)

   Audit requested directly ahead of End-Term: schools running a
   Mid-Term report then a separate End-of-Term report within the same
   term need both to be independently visible, and the already-
   published Mid-Term data must never be touched or superseded by the
   End-of-Term publish. `cycle` is the mechanism — see PublishSchema's
   own comment in report-cards.js for the full reasoning (Mongo's
   {cycle: null} matches both an explicit null and a missing field, so
   the default/no-cycle path is byte-for-byte unchanged, and a new
   explicit cycle can never match — let alone supersede — a different
   cycle's, or a pre-existing cycle-less, live snapshot).

   Modeled closely on report-cards-kg.test.js's own harness (same
   mock style, same academic-calc/ranking/academic-config mocks) —
   there is no pre-existing full-pipeline test for the NUMERIC /publish
   route's own versioning/supersede logic at all (only the KG one had
   one), so this is a new, minimal happy-path harness, not an
   extension of an existing numeric-publish test file.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn().mockResolvedValue(true) }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), isClassInScope: jest.fn(() => true), resolveAttendanceScope: jest.fn(), resolveAssessmentScope: jest.fn(), resolveHomeroomStreamIds: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/ranking', () => ({
  rankStudents: jest.fn(() => []), mergeRankings: jest.fn(() => ({})), bestPerSubject: jest.fn(() => ({})), computeRankingScore: jest.fn(() => ({ rankingScore: 0, subjectsUsed: [] })),
}));
jest.mock('../../utils/academic-calc', () => ({
  aggregateAssessmentMarks: jest.fn().mockResolvedValue({}), aggregateUnmoderatedMarks: jest.fn().mockResolvedValue([]),
  computeFinalScores: jest.fn(() => ({
    s1: { studentId: 's1', subjects: {}, totalScore: 70, averageScore: 70, gpa: null },
  })),
  attendanceSummary: jest.fn().mockResolvedValue(null), behaviourSummary: jest.fn().mockResolvedValue(null),
  attachDeviations: jest.fn(x => x), computeTermDeviation: jest.fn(),
}));

const GRADE_BANDS = [{ min: 50, grade: 'C' }, { min: 0, grade: 'D' }];
jest.mock('../../routes/academic-config', () => ({
  mergeConfig: jest.fn(c => c ?? {}),
  resolveCurrentPeriod: jest.fn(() => ({ year: { id: 'year1', terms: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] } })),
  resolveGrade: jest.fn(() => ({ grade: 'C', points: null, descriptor: null, remarks: null })),
  OBSERVATION_RATING_VALUES: [], DEFAULT_GRADING_SCHEMA: GRADE_BANDS,
}));
jest.mock('../../routes/assessment', () => ({ getConfig: jest.fn().mockResolvedValue({ customTypes: [{ key: 'MT', label: 'Mid-Term', weight: 50 }, { key: 'ET', label: 'End of Term', weight: 50 }] }) }));
jest.mock('../../routes/report-card-templates', () => ({ resolveTemplate: jest.fn().mockResolvedValue({ templateId: null, templateVersion: null, layoutKey: 'subject_paired' }) }));

let mockStudents, mockStreams, mockTeachers, mockGradeBoundaries, mockRcTemplates;
let mockSnapshots, mockDraftComments, mockPublishBatches, mockCycleLabels;
let mockSchool = { id: SCHOOL_A, name: 'Test School', houses: [] };

function mockMatches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') { if (!cond.some(sub => mockMatches(doc, sub))) return false; continue; }
    const val = doc[key];
    if (cond === null) { if (val !== null && val !== undefined) return false; continue; }
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
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    const map = {
      students: mockStudents, streams: mockStreams, teachers: mockTeachers,
      grade_boundaries: mockGradeBoundaries, rc_templates: mockRcTemplates,
      report_card_snapshots: mockSnapshots, report_card_draft_comments: mockDraftComments,
      publish_batches: mockPublishBatches, report_card_cycle_labels: mockCycleLabels,
      invoices: [], academic_years: [], academic_config: [], assessment_marks: [], mark_submissions: [],
      sections: [{ id: 'sec_pri', schoolId: SCHOOL_A, key: 'primary' }],
      classes: [{ id: 'cls1', schoolId: SCHOOL_A, sectionKey: 'primary' }],
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

beforeEach(() => {
  mockStudents = [{ id: 's1', schoolId: SCHOOL_A, classId: 'cls1', status: 'active', firstName: 'Amara', lastName: 'Osei', admissionNumber: 'ADM-001', streamId: null, houseId: null }];
  mockStreams = [];
  mockTeachers = [];
  mockGradeBoundaries = [{ id: 'scaleA', schoolId: SCHOOL_A, sectionId: 'sec_pri', isDefault: true, name: 'Scale', bands: GRADE_BANDS }];
  mockRcTemplates = [];
  mockSnapshots = [];
  mockDraftComments = [];
  mockPublishBatches = [];
  mockCycleLabels = [];
  mockSchool = { id: SCHOOL_A, name: 'Test School', houses: [] };
});

function publishBody(overrides = {}) {
  return { classId: 'cls1', termId: 't2', academicYearId: 'year1', termNumber: 2, ...overrides };
}

describe('POST /publish — cycle (2026-11): independently-visible reports per term', () => {
  test('default (no cycle) behaves exactly as before — one lineage, republish supersedes', async () => {
    await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody());
    expect(mockSnapshots).toHaveLength(1);
    expect(mockSnapshots[0].cycle).toBeNull();
    const firstId = mockSnapshots[0].id;

    await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody());
    expect(mockSnapshots).toHaveLength(2);
    expect(mockSnapshots.find(s => s.id === firstId).superseded).toBe(true);
    expect(mockSnapshots.find(s => s.id !== firstId).version).toBe(2);
  });

  test('publishing under an explicit NEW cycle does not supersede or alter a different cycle\'s live snapshot', async () => {
    const mtRes = await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody({ cycle: 'MT' }));
    expect(mtRes.status).toBe(201);
    expect(mockSnapshots).toHaveLength(1);
    const mtSnap = { ...mockSnapshots[0] };
    expect(mtSnap.cycle).toBe('MT');
    expect(mtSnap.superseded).toBe(false);
    expect(mtSnap.version).toBe(1);

    const etRes = await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody({ cycle: 'ET' }));
    expect(etRes.status).toBe(201);

    // Two independently-live snapshots now exist for the SAME class/term/year.
    expect(mockSnapshots).toHaveLength(2);
    const freshMt = mockSnapshots.find(s => s.cycle === 'MT');
    const etSnap  = mockSnapshots.find(s => s.cycle === 'ET');
    expect(freshMt).toEqual(mtSnap); // byte-for-byte untouched — not re-fetched, not re-superseded, not mutated
    expect(etSnap.superseded).toBe(false);
    expect(etSnap.version).toBe(1);        // ET is its own, independent lineage — not "version 2" of MT
    expect(etSnap.supersedesId).toBeNull();
  });

  test('a pre-existing, cycle-LESS live snapshot (exactly what real already-published reports look like) is never superseded by a new explicit cycle', async () => {
    // Simulates Trinitas's real, already-published Mid-Term data —
    // published before `cycle` existed, so it has no `cycle` field at all.
    mockSnapshots = [{
      id: 'snap_legacy', version: 1, schoolId: SCHOOL_A, studentId: 's1',
      classId: 'cls1', termId: 't2', termNumber: 2, academicYearId: 'year1',
      status: 'published', superseded: false, commentsLocked: true,
      comments: { classTeacherRemark: 'Original Mid-Term remark — must survive untouched.' },
    }];
    const legacySnapBefore = { ...mockSnapshots[0] };

    const res = await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody({ cycle: 'ET' }));
    expect(res.status).toBe(201);

    const stillThere = mockSnapshots.find(s => s.id === 'snap_legacy');
    expect(stillThere).toEqual(legacySnapBefore); // completely untouched: same superseded flag, same comments, same everything
    expect(mockSnapshots).toHaveLength(2);
    const newSnap = mockSnapshots.find(s => s.id !== 'snap_legacy');
    expect(newSnap.cycle).toBe('ET');
    expect(newSnap.supersedesId).toBeNull(); // did NOT supersede the legacy cycle-less report
  });

  test('re-publishing under the SAME explicit cycle still supersedes only that cycle\'s own previous version', async () => {
    await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody({ cycle: 'ET' }));
    const firstEtId = mockSnapshots.find(s => s.cycle === 'ET').id;

    await supertest(buildApp(ADMIN)).post('/api/report-cards/publish').send(publishBody({ cycle: 'ET' }));
    expect(mockSnapshots).toHaveLength(2);
    expect(mockSnapshots.find(s => s.id === firstEtId).superseded).toBe(true);
    const secondEt = mockSnapshots.find(s => s.id !== firstEtId);
    expect(secondEt.version).toBe(2);
    expect(secondEt.supersedesId).toBe(firstEtId);
  });
});
