/* ============================================================
   server/routes/mark-submissions.js — Kindergarten indicator marks
   reuse this SAME collection/state-machine (not a second moderation
   system), keyed by a reserved KG_INDICATORS_TYPE sentinel in
   `assessmentType` (indicator marks have no real assessmentType/
   instance of their own). This file verifies the routing itself:
   POST / (submit, completeness check + snapshot), POST /:id/lock and
   POST /:id/unlock all read/write `indicator_marks` instead of
   `assessment_marks` whenever a submission's assessmentType is the KG
   sentinel — and that ordinary numeric submissions are completely
   unaffected (still read/write assessment_marks exactly as before).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn().mockResolvedValue(false) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/job-queue', () => ({ enqueueJob: jest.fn(), registerHandler: jest.fn() }));
jest.mock('../../utils/workflow-config', () => ({ getWorkflowConfig: jest.fn().mockResolvedValue(null), resolveStep: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/elective-scope', () => ({
  isElective: jest.fn().mockResolvedValue(false),
  canTeachElective: jest.fn().mockResolvedValue(true),
  isInCurriculum: jest.fn().mockResolvedValue(true),
}));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

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

let mockIndicatorMarksDocs;
let mockAssessmentMarksDocs;
let mockSubDoc;
let mockStudentsDocs;

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'mark_submissions') {
      return {
        findOne: () => mockChain(mockSubDoc),
        findOneAndUpdate: (_filter, update) => {
          Object.assign(mockSubDoc, update.$set);
          return mockChain({ ...mockSubDoc });
        },
        create: (doc) => { mockSubDoc = { ...doc }; return Promise.resolve({ ...doc, toObject: () => doc }); },
      };
    }
    if (collection === 'indicator_marks') {
      return {
        find: (filter) => mockChain(mockIndicatorMarksDocs.filter(d => mockMatchFilter(d, filter))),
        updateMany: (filter, update) => {
          let n = 0;
          for (const doc of mockIndicatorMarksDocs) {
            if (mockMatchFilter(doc, filter)) { Object.assign(doc, update.$set); n++; }
          }
          return Promise.resolve({ modifiedCount: n });
        },
      };
    }
    if (collection === 'assessment_marks') {
      return {
        find: (filter) => mockChain((mockAssessmentMarksDocs || []).filter(d => mockMatchFilter(d, filter))),
        updateMany: (filter, update) => {
          let n = 0;
          for (const doc of (mockAssessmentMarksDocs || [])) {
            if (mockMatchFilter(doc, filter)) { Object.assign(doc, update.$set); n++; }
          }
          return Promise.resolve({ modifiedCount: n });
        },
      };
    }
    if (collection === 'students') {
      return { find: (filter) => mockChain((mockStudentsDocs || []).filter(d => mockMatchFilter(d, filter))) };
    }
    if (collection === 'teaching_assignments') return { findOne: () => mockChain(null) };
    if (collection === 'classes')  return { findOne: () => mockChain({ name: 'KG1' }) };
    if (collection === 'subjects') return { findOne: () => mockChain({ name: 'Science' }) };
    if (collection === 'users')    return { find: () => mockChain([]) };
    if (collection === 'messages') return { create: () => Promise.resolve({}) };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');
const { KG_INDICATORS_TYPE } = require('../../routes/mark-submissions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mark-submissions', require('../../routes/mark-submissions'));
  return app;
}

const KG_KEY  = { classId: 'cls_kg1', subjectId: 'subj_science', termNumber: 2, assessmentType: KG_INDICATORS_TYPE, instance: 1 };
const NUM_KEY = { classId: 'cls_001', subjectId: 'subj_eng', termNumber: 2, assessmentType: 'CA', instance: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin_1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockIndicatorMarksDocs  = [];
  mockAssessmentMarksDocs = [];
  mockStudentsDocs        = [];
  mockSubDoc = null;
});

describe('POST /api/mark-submissions/:id/lock — KG routes to indicator_marks, numeric still routes to assessment_marks', () => {
  test('a KG submission locks matching indicator_marks docs, never touches assessment_marks', async () => {
    mockSubDoc = { id: 'sub_kg', schoolId: SCHOOL, status: 'approved', ...KG_KEY };
    mockIndicatorMarksDocs  = [{ schoolId: SCHOOL, classId: 'cls_kg1', subjectId: 'subj_science', termNumber: 2, isLocked: false }];
    mockAssessmentMarksDocs = [{ schoolId: SCHOOL, ...KG_KEY, isLocked: false }]; // decoy — must stay untouched

    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_kg/lock').send({});
    expect(res.status).toBe(200);
    expect(mockIndicatorMarksDocs[0].isLocked).toBe(true);
    expect(mockAssessmentMarksDocs[0].isLocked).toBe(false);
  });

  test('an ordinary numeric submission still locks assessment_marks, never indicator_marks — unchanged behavior', async () => {
    mockSubDoc = { id: 'sub_num', schoolId: SCHOOL, status: 'approved', ...NUM_KEY };
    mockAssessmentMarksDocs = [{ schoolId: SCHOOL, ...NUM_KEY, isLocked: false }];
    mockIndicatorMarksDocs  = [{ schoolId: SCHOOL, classId: 'cls_001', subjectId: 'subj_eng', termNumber: 2, isLocked: false }]; // decoy

    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_num/lock').send({});
    expect(res.status).toBe(200);
    expect(mockAssessmentMarksDocs[0].isLocked).toBe(true);
    expect(mockIndicatorMarksDocs[0].isLocked).toBe(false);
  });
});

describe('POST /api/mark-submissions/:id/unlock — same KG vs numeric routing', () => {
  test('unlocking a KG submission clears isLocked on indicator_marks only', async () => {
    mockSubDoc = { id: 'sub_kg', schoolId: SCHOOL, status: 'locked', ...KG_KEY };
    mockIndicatorMarksDocs  = [{ schoolId: SCHOOL, classId: 'cls_kg1', subjectId: 'subj_science', termNumber: 2, isLocked: true }];
    mockAssessmentMarksDocs = [{ schoolId: SCHOOL, ...KG_KEY, isLocked: true }];

    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_kg/unlock').send({ reason: 'correction needed' });
    expect(res.status).toBe(200);
    expect(mockIndicatorMarksDocs[0].isLocked).toBe(false);
    expect(mockAssessmentMarksDocs[0].isLocked).toBe(true); // decoy untouched
  });
});

describe('POST /api/mark-submissions — KG completeness check reads indicator_marks, not assessment_marks', () => {
  test('a KG submit is accepted once every roster student has at least one indicator mark', async () => {
    mockStudentsDocs = [{ id: 'stu_1', schoolId: SCHOOL, classId: 'cls_kg1', status: 'active' }];
    mockIndicatorMarksDocs = [{ studentId: 'stu_1', subjectId: 'subj_science', classId: 'cls_kg1', schoolId: SCHOOL, termNumber: 2, score: 8 }];
    mockAssessmentMarksDocs = []; // deliberately empty — must NOT be consulted for a KG submit

    const res = await supertest(buildApp()).post('/api/mark-submissions').send({ ...KG_KEY, academicYearId: undefined });
    expect(res.status).toBe(201);
  });

  test('a KG submit is rejected when a roster student has no indicator mark yet', async () => {
    mockStudentsDocs = [{ id: 'stu_1', schoolId: SCHOOL, classId: 'cls_kg1', status: 'active' }];
    mockIndicatorMarksDocs = []; // nobody scored yet

    const res = await supertest(buildApp()).post('/api/mark-submissions').send(KG_KEY);
    expect(res.status).toBe(400);
    expect(mockSubDoc).toBeNull();
  });
});
