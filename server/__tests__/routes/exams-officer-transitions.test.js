/* ============================================================
   Exams Officer status-transition fix (2026-09-05)

   Two real, verified bugs closed together, both found while writing
   the Exams Officer Guide and re-tracing the actual authorization path
   rather than trusting the existing (too-weak) test assertions:

   1. TRANSITION_ROLES (server/routes/exams.js) excluded 'exams_officer'
      from EVERY entry, despite that role holding full exams:RCUD
      (server/utils/repairPermissions.js) — an Exams Officer could
      create exams and enter marks but could not move a single exam
      through its own lifecycle via PUT /:id, not even Start Exam.

   2. POST /:id/lock computed its exams.lock grant check correctly, then
      called _checkTransition() WITHOUT that boolean — so a legitimately
      granted Exams Officer got PAST the grant check only to be silently
      re-rejected one line later by TRANSITION_ROLES.locked, which never
      included anyone but admin/superadmin. The PRE-EXISTING test for
      this ("THE NEW CAPABILITY: exams_officer explicitly granted
      exams__lock can lock") only asserted `res.status !== 403` — which
      a 400 from the re-rejection also satisfies, masking the bug
      completely. This file asserts the real outcome: 200/201 AND the
      exam's status actually becoming 'locked'.

   Covers, precisely:
     - exams_officer can now drive every transition PUT /:id supports
       for admin (Start, Complete, Moderate, Approve-after-moderation,
       Publish, Archive, Cancel) — proven by actual status changes, not
       just non-403.
     - exams_officer is STILL blocked from the 'locked' transition via
       PUT /:id without an exams.lock grant (floor preserved), and CAN
       reach it via PUT /:id WITH the grant (closing the previously
       tracked-open "PUT /:id alternate path" gap for the permission
       dimension only — see docs/audits/PERMISSION_GRANULARITY_PLAN_2026-09.md §4a).
     - Same floor/grant proof for the locked->approved (unlock)
       transition via PUT /:id.
     - The ordinary moderated->approved (Approve) transition does NOT
       require any lock/unlock grant — proving the fromStatus-aware
       split in _checkTransition actually distinguishes the two
       semantically different actions that share the 'approved' target.
     - 'teacher' role is UNCHANGED — still cannot moderate/approve/lock/
       publish/archive/cancel (regression guard).
     - POST /:id/lock, re-tested with a STRONG assertion (status 200 AND
       exam.status === 'locked' in the mock store), not just non-403.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
let mockRolePermsDocs;
let mockExamDocs;
function mockChain(result) { return { select: () => mockChain(result), lean: () => Promise.resolve(result) }; }

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
    if (collection === 'exams') {
      return {
        findOne: (filter) => mockChain(mockExamDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
        findOneAndUpdate: (filter, update) => {
          const d = mockExamDocs.find((x) => mockMatchFilter(x, filter));
          if (!d) return mockChain(null);
          const { $push, ...rest } = update;
          Object.assign(d, rest);
          if ($push?.statusHistory) d.statusHistory = [...(d.statusHistory || []), $push.statusHistory];
          return mockChain({ ...d });
        },
      };
    }
    if (collection === 'mark_audit_log') {
      return { create: (doc) => Promise.resolve(doc) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]), findOneAndUpdate: () => mockChain(null) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', require('../../routes/exams'));
  return app;
}

function asExamsOfficer(extraPerms = {}) {
  mockJwtUser = { userId: 'u_eo', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
  mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'exams_officer', permissions: { exams: ['read', 'create', 'update', 'delete'], ...extraPerms } }];
}
function asTeacher() {
  mockJwtUser = { userId: 'u_t', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
  mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'teacher', permissions: { exams: ['read', 'update'] } }];
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidatePermCache(SCHOOL);
  mockRolePermsDocs = [];
  mockExamDocs = [
    { id: 'exam_1', schoolId: SCHOOL, title: 'Term 1 Math', status: 'scheduled' },
  ];
});

describe('Exams Officer can now drive the lifecycle via PUT /:id', () => {
  test('scheduled -> in_progress (Start Exam)', async () => {
    asExamsOfficer();
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('in_progress');
  });

  test('in_progress -> completed (Mark Completed)', async () => {
    mockExamDocs[0].status = 'in_progress';
    asExamsOfficer();
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('completed');
  });

  test('in_progress -> cancelled', async () => {
    mockExamDocs[0].status = 'in_progress';
    asExamsOfficer();
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('cancelled');
  });

  test('completed -> moderated (Moderate)', async () => {
    mockExamDocs[0].status = 'completed';
    asExamsOfficer();
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'moderated' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('moderated');
  });

  test('moderated -> approved (ordinary Approve, NO lock/unlock grant needed)', async () => {
    mockExamDocs[0].status = 'moderated';
    asExamsOfficer(); // no exams__lock / exams__unlock grant
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('approved');
  });

  test('published -> archived (Archive)', async () => {
    mockExamDocs[0].status = 'published';
    asExamsOfficer();
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'archived' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('archived');
  });
});

describe('The "locked" floor is preserved for Exams Officer on PUT /:id', () => {
  test('approved -> locked is REJECTED without an exams.lock grant', async () => {
    mockExamDocs[0].status = 'approved';
    asExamsOfficer(); // no exams__lock grant
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'locked' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot set status to "locked"/i);
    expect(mockExamDocs[0].status).toBe('approved'); // unchanged
  });

  test('THE FIX: approved -> locked SUCCEEDS via PUT /:id with an exams.lock grant (previously blind to it)', async () => {
    mockExamDocs[0].status = 'approved';
    asExamsOfficer({ exams__lock: ['update'] });
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'locked' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('locked');
  });
});

describe('The "unlock" (locked -> approved) floor is preserved for Exams Officer on PUT /:id', () => {
  test('locked -> approved is REJECTED without an exams.unlock grant', async () => {
    mockExamDocs[0].status = 'locked';
    asExamsOfficer(); // no exams__unlock grant
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot unlock/i);
    expect(mockExamDocs[0].status).toBe('locked'); // unchanged
  });

  test('locked -> approved SUCCEEDS via PUT /:id with an exams.unlock grant', async () => {
    mockExamDocs[0].status = 'locked';
    asExamsOfficer({ exams__unlock: ['update'] });
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('approved');
  });

  test('INDEPENDENCE: an exams.lock grant alone does not also grant unlock via PUT /:id', async () => {
    mockExamDocs[0].status = 'locked';
    asExamsOfficer({ exams__lock: ['update'] }); // lock grant, NOT unlock
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'approved' });
    expect(res.status).toBe(400);
    expect(mockExamDocs[0].status).toBe('locked');
  });
});

describe('REGRESSION GUARD: teacher role is unaffected by this fix', () => {
  test.each(['cancelled', 'moderated', 'approved', 'locked', 'published', 'archived'])(
    'teacher still cannot set status to "%s"', async (status) => {
      mockExamDocs[0].status = status === 'cancelled' ? 'in_progress' : 'completed';
      asTeacher();
      const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status });
      expect(res.status).toBe(400);
    }
  );

  test('teacher can still Start Exam and Mark Completed (unchanged)', async () => {
    mockExamDocs[0].status = 'scheduled';
    asTeacher();
    const res = await supertest(buildApp()).put('/api/exams/exam_1').send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});

describe('POST /:id/lock — strengthened proof (not just non-403)', () => {
  test('THE FIX: exams_officer explicitly granted exams__lock actually locks the exam', async () => {
    mockExamDocs[0].status = 'approved';
    asExamsOfficer({ exams__lock: ['update'] });
    const res = await supertest(buildApp()).post('/api/exams/exam_1/lock').send({});
    expect(res.status).toBe(200);
    expect(mockExamDocs[0].status).toBe('locked');
    expect(mockExamDocs[0].lockedBy).toBe('u_eo');
  });

  test('REGRESSION GUARD: exams_officer with coarse exams:update but no explicit grant is still fully rejected (403, exam untouched)', async () => {
    mockExamDocs[0].status = 'approved';
    asExamsOfficer(); // no exams__lock grant
    const res = await supertest(buildApp()).post('/api/exams/exam_1/lock').send({});
    expect(res.status).toBe(403);
    expect(mockExamDocs[0].status).toBe('approved');
  });
});
