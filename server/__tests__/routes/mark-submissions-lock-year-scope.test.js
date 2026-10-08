/* ============================================================
   server/routes/mark-submissions.js — POST /:id/lock is year-scoped

   Found during a full exam-config -> Markbook -> report-card flow
   audit: the markFilter used to lock the underlying assessment_marks
   records (updateMany) had no academicYearId at all. Locking ONE
   academic year's submission for a class/subject/term/type/instance
   (+stream) would ALSO silently lock every OTHER year's marks sharing
   that same natural key — e.g. locking this year's Term 2 CA1
   submission would re-lock last year's already-settled Term 2 CA1
   marks too, purely because terms/assessment types repeat annually.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn().mockResolvedValue(false) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/job-queue', () => ({ enqueueJob: jest.fn(), registerHandler: jest.fn() }));
jest.mock('../../utils/workflow-config', () => ({ getWorkflowConfig: jest.fn().mockResolvedValue(null), resolveStep: jest.fn().mockResolvedValue([]) }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

// Correctly handles $exists (unlike a naive "any object filter matches"
// stub) — _yearFilterPart's third $or clause is {academicYearId:{$exists:false}},
// which must only match a doc that genuinely has no such field.
function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$exists' in v) return v.$exists ? (k in doc && doc[k] !== undefined) : (!(k in doc) || doc[k] === undefined);
      if ('$in' in v) return v.$in.some(x => x === doc[k] || (x == null && doc[k] == null));
      return true;
    }
    return doc[k] === v;
  });
}

let mockMarksDocs;
let mockSubDoc;
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'mark_submissions') {
      return {
        findOne: () => mockChain(mockSubDoc),
        findOneAndUpdate: (_filter, update) => {
          Object.assign(mockSubDoc, update.$set);
          return mockChain({ ...mockSubDoc });
        },
      };
    }
    if (collection === 'assessment_marks') {
      return {
        updateMany: (filter, update) => {
          let n = 0;
          for (const doc of mockMarksDocs) {
            if (mockMatchFilter(doc, filter)) { Object.assign(doc, update.$set); n++; }
          }
          return Promise.resolve({ modifiedCount: n });
        },
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mark-submissions', require('../../routes/mark-submissions'));
  return app;
}

const NATURAL_KEY = { classId: 'cls_001', subjectId: 'subj_eng', termNumber: 2, assessmentType: 'CA', instance: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin_1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
});

describe('POST /api/mark-submissions/:id/lock — academicYearId scoping', () => {
  test('locking a submission only locks assessment_marks for the SAME academic year', async () => {
    mockSubDoc = { id: 'sub_1', schoolId: SCHOOL, status: 'approved', academicYearId: 'ay_2026', ...NATURAL_KEY };
    mockMarksDocs = [
      { schoolId: SCHOOL, academicYearId: 'ay_2026', ...NATURAL_KEY, isLocked: false }, // this year — should lock
      { schoolId: SCHOOL, academicYearId: 'ay_2025', ...NATURAL_KEY, isLocked: false }, // different year — must NOT lock
    ];

    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_1/lock').send({});
    expect(res.status).toBe(200);
    expect(mockMarksDocs[0].isLocked).toBe(true);
    expect(mockMarksDocs[1].isLocked).toBe(false);
  });

  test('locking a LEGACY submission (no academicYearId) locks only the legacy-tagged marks, not an explicitly different year', async () => {
    mockSubDoc = { id: 'sub_1', schoolId: SCHOOL, status: 'approved', academicYearId: null, ...NATURAL_KEY };
    mockMarksDocs = [
      { schoolId: SCHOOL, academicYearId: null, ...NATURAL_KEY, isLocked: false },    // legacy — should lock
      { schoolId: SCHOOL, academicYearId: 'ay_2026', ...NATURAL_KEY, isLocked: false }, // explicitly different year — must NOT lock
    ];

    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_1/lock').send({});
    expect(res.status).toBe(200);
    expect(mockMarksDocs[0].isLocked).toBe(true);
    expect(mockMarksDocs[1].isLocked).toBe(false);
  });
});
