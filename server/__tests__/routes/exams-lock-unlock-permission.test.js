/* ============================================================
   POST /api/exams/:id/lock and /:id/unlock — the lock/unlock
   permission gates

   Permission Granularity Plan 2026-09, Priority 0, Option A. Both
   routes were gated only by a hardcoded `if (!['admin','superadmin'].
   includes(role))` — invisible to and unconfigurable from Settings
   (BYPASS, full trace in the Plan §4a). Now: that floor stays
   (never weakened), and a school can additionally grant exams.lock
   and exams.unlock INDEPENDENTLY via Settings — the registry's single
   combined "Lock / Unlock Exam" row was split into two rows for
   exactly this reason. A role granted lock is NOT automatically
   granted unlock, and vice versa.

   Deliberately does NOT touch, and these tests do NOT exercise:
   TRANSITION_ROLES / _checkTransition (shared state-machine logic,
   out of scope), or PUT /:id (a separate, documented, not-yet-
   resolved alternate path to the same transitions — see the Plan).

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
let mockAuditLogCreate;
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
    if (collection === 'exams') {
      return {
        findOne: (filter) => mockChain(mockExamDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
        findOneAndUpdate: (filter) => mockChain(mockExamDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
      };
    }
    if (collection === 'mark_audit_log') {
      return { create: (doc) => { mockAuditLogCreate(doc); return Promise.resolve(doc); } };
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

beforeEach(() => {
  jest.clearAllMocks();
  // rbac.js's in-memory permission cache is a module-level Map, not a jest
  // mock — jest.clearAllMocks() doesn't touch it. Several tests below reuse
  // the same roleKey+schoolId with DIFFERENT permissions payloads; without
  // this, a later test would silently see an earlier test's cached result.
  invalidatePermCache(SCHOOL);
  mockRolePermsDocs = [];
  mockAuditLogCreate = jest.fn();
  mockExamDocs = [
    { id: 'exam_approved', schoolId: SCHOOL, title: 'Term 1 Math', status: 'approved' },
    { id: 'exam_locked',   schoolId: SCHOOL, title: 'Term 1 Science', status: 'locked' },
  ];
});

describe('POST /api/exams/:id/lock', () => {
  test.each(['admin', 'superadmin'])('%s: unconditional floor, unaffected by any grant', async (role) => {
    mockJwtUser = { userId: 'u_1', schoolId: SCHOOL, role, roles: [role] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: role, permissions: { exams: ['read', 'update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_approved/lock').send({});
    expect(res.status).not.toBe(403);
  });

  test('THE REGRESSION GUARD: exams_officer with coarse exams:update but no explicit exams__lock grant is still rejected', async () => {
    mockJwtUser = { userId: 'u_eo', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'exams_officer', permissions: { exams: ['read', 'create', 'update'] } }]; // no exams__lock
    const res = await supertest(buildApp()).post('/api/exams/exam_approved/lock').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/lock exams/i);
  });

  test('THE NEW CAPABILITY: exams_officer explicitly granted exams__lock can lock', async () => {
    mockJwtUser = { userId: 'u_eo2', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'exams_officer', permissions: { exams: ['read', 'update'], exams__lock: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_approved/lock').send({});
    expect(res.status).not.toBe(403);
  });

  test('INDEPENDENCE: a role granted exams__unlock ONLY (not exams__lock) cannot lock', async () => {
    mockJwtUser = { userId: 'u_unlock_only', schoolId: SCHOOL, role: 'principal', roles: ['principal'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'principal', permissions: { exams: ['read', 'update'], exams__unlock: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_approved/lock').send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/exams/:id/unlock', () => {
  test.each(['admin', 'superadmin'])('%s: unconditional floor, unaffected by any grant', async (role) => {
    mockJwtUser = { userId: 'u_1', schoolId: SCHOOL, role, roles: [role] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: role, permissions: { exams: ['read', 'update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_locked/unlock').send({ reason: 'Correction needed' });
    expect(res.status).not.toBe(403);
  });

  test('THE REGRESSION GUARD: exams_officer with coarse exams:update but no explicit exams__unlock grant is still rejected', async () => {
    mockJwtUser = { userId: 'u_eo', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'exams_officer', permissions: { exams: ['read', 'create', 'update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_locked/unlock').send({ reason: 'Correction needed' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/unlock exams/i);
  });

  test('THE NEW CAPABILITY: principal explicitly granted exams__unlock can unlock', async () => {
    mockJwtUser = { userId: 'u_p', schoolId: SCHOOL, role: 'principal', roles: ['principal'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'principal', permissions: { exams: ['read', 'update'], exams__unlock: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_locked/unlock').send({ reason: 'Correction needed' });
    expect(res.status).not.toBe(403);
  });

  test('INDEPENDENCE: a role granted exams__lock ONLY (not exams__unlock) cannot unlock', async () => {
    mockJwtUser = { userId: 'u_lock_only', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'exams_officer', permissions: { exams: ['read', 'update'], exams__lock: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_locked/unlock').send({ reason: 'Correction needed' });
    expect(res.status).toBe(403);
  });

  test('REQUIREMENT PRESERVED: an explicitly-granted caller with NO reason still gets the pre-existing 400, not silently past it', async () => {
    mockJwtUser = { userId: 'u_p2', schoolId: SCHOOL, role: 'principal', roles: ['principal'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'principal', permissions: { exams: ['read', 'update'], exams__unlock: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_locked/unlock').send({}); // no reason
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/reason is required/i);
  });

  test('REQUIREMENT PRESERVED: a successful explicitly-granted unlock still writes the mark_audit_log entry', async () => {
    mockJwtUser = { userId: 'u_p3', schoolId: SCHOOL, role: 'principal', roles: ['principal'] };
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'principal', permissions: { exams: ['read', 'update'], exams__unlock: ['update'] } }];
    const res = await supertest(buildApp()).post('/api/exams/exam_locked/unlock').send({ reason: 'Correction needed' });
    expect(res.status).not.toBe(403);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXAM_UNLOCKED', reason: 'Correction needed' }));
  });
});
