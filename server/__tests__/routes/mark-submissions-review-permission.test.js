/* ============================================================
   POST /api/mark-submissions/:id/review — the review/approve
   permission gate

   Permission Granularity Plan 2026-09, Priority 0. Reviewing/approving
   a mark submission was gated only by a hardcoded
   `if (!['admin','principal','section_head'].includes(role))` —
   invisible to and unconfigurable from Settings (a BYPASS finding,
   found while implementing this fix — not precisely identified at this
   level of detail in the original Plan doc, which had assumed this
   route was plain DECORATIVE). Now: that floor stays (never weakened),
   and a school can additionally grant grades.mark_submissions to
   another role/person via Settings, without that grant also reaching
   ordinary grades:update actions like entering marks.

   Same reasoning as report-cards.js's publish fix: uses
   hasExplicitSubGrant (STRICT, no coarse-grant fallback) rather than
   the ordinary rbac()/hasPermission() subKey behavior — falling back to
   plain grades:update here would hand reviewer authority to any
   teacher who can edit their own marks, defeating the entire purpose
   of a review step.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/job-queue', () => ({ enqueueJob: jest.fn(), registerHandler: jest.fn() }));
jest.mock('../../utils/workflow-config', () => ({ getWorkflowConfig: jest.fn().mockResolvedValue(null), resolveStep: jest.fn().mockResolvedValue([]) }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
let mockRolePermsDocs;
let mockSubmissionDocs;
function mockChain(result) { return { lean: () => Promise.resolve(result) }; }
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'role_permissions') {
      return { findOne: (filter) => mockChain(mockRolePermsDocs.find((d) => mockMatchFilter(d, filter)) ?? null) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'mark_submissions') {
      return { findOne: (filter) => mockChain(mockSubmissionDocs.find((d) => mockMatchFilter(d, filter)) ?? null) };
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

beforeEach(() => {
  jest.clearAllMocks();
  mockRolePermsDocs = [];
  // A submission in 'submitted' status — required for /review to even
  // reach the point of returning something other than a 400. Not
  // reached at all by the rejection-path tests below (they 403 before
  // this lookup happens), but needed for the "passes" tests to observe
  // something cleanly distinguishable from a permission rejection.
  mockSubmissionDocs = [{ id: 'sub_1', schoolId: SCHOOL, status: 'submitted' }];
});

describe('POST /api/mark-submissions/:id/review — permission gate', () => {
  test.each(['admin', 'principal', 'section_head'])('%s: unconditional floor role, unaffected by any grant', async (role) => {
    mockJwtUser = { userId: 'u_1', schoolId: SCHOOL, role, roles: [role] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: role, permissions: { grades: ['read', 'update'] } }];
    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_1/review').send({ action: 'approve' });
    expect(res.status).not.toBe(403);
  });

  test('THE REGRESSION GUARD: a teacher with coarse grades:update (needed to enter their own marks) cannot review submissions', async () => {
    mockJwtUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'teacher', permissions: { grades: ['read', 'create', 'update'] } }]; // no grades__mark_submissions
    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_1/review').send({ action: 'approve' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/reviewers can review/i);
  });

  test('THE NEW CAPABILITY: an exams_officer explicitly granted grades.mark_submissions can now review', async () => {
    mockJwtUser = { userId: 'u_eo', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'exams_officer', permissions: { grades: ['read', 'update'], grades__mark_submissions: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_1/review').send({ action: 'approve' });
    expect(res.status).not.toBe(403);
  });

  test('a per-user override granting mark_submissions to one specific person also works', async () => {
    mockJwtUser = { userId: 'u_specific', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'teacher', permissions: { grades: ['read', 'update'] } },
      { schoolId: SCHOOL, userId: 'u_specific', permissions: { grades__mark_submissions: ['update'] } },
    ];
    const res = await supertest(buildApp()).post('/api/mark-submissions/sub_1/review').send({ action: 'approve' });
    expect(res.status).not.toBe(403);
  });
});
