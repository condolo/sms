/* ============================================================
   POST /api/report-cards/publish — the publish permission gate

   Permission Granularity Plan 2026-09, Priority 0. Before this fix,
   the ONLY thing restricting who could publish was a hardcoded
   `if (!['admin','superadmin'].includes(role))` — invisible to and
   unconfigurable from Settings (the BYPASS finding the Plan
   documents). Now: admin/superadmin remain an unconditional floor
   (never weakened), and a school can additionally grant this specific
   ability to another role/person via Settings' `grades.report_generate`
   sub-permission — via hasExplicitSubGrant, which deliberately does
   NOT fall back to the coarse `grades` grant (unlike rbac()'s normal
   subKey behavior), so merely holding grades:create (most teaching/
   exam roles, for entering marks) does not silently grant publish
   rights the moment the hardcoded floor loosens.

   These tests exercise the REAL rbac.js (hasExplicitSubGrant, and the
   router-level `rbac('grades','create')` gate) against fake
   role_permissions data — no MongoDB required. The route's full
   publish pipeline (batch creation, exam aggregation, transactions) is
   NOT exercised here — that's covered elsewhere. To isolate exactly
   the permission boundary without mocking that whole pipeline, "did
   this get past the permission check" is proven by sending a body that
   fails schema validation (the very next step after the permission
   check) — a clean, DB-mock-free way to distinguish "rejected at the
   permission gate" (403, my exact message) from "passed the permission
   gate" (400, a validation error) without needing the rest of the
   pipeline to succeed.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
let mockRolePermsDocs;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection !== 'role_permissions') return { findOne: () => ({ lean: () => Promise.resolve(null) }), find: () => ({ lean: () => Promise.resolve([]) }) };
    return {
      findOne: (filter) => ({ lean: () => Promise.resolve(mockRolePermsDocs.find((d) => mockMatchFilter(d, filter)) ?? null) }),
    };
  }),
}));
// report-cards.js also pulls in tenant-model — not reached before the
// permission check fails, and for the "passed the gate" cases we stop
// at body validation, before tenant-model is ever called either.
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({})),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', require('../../routes/report-cards'));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRolePermsDocs = [];
});

describe('POST /api/report-cards/publish — permission gate', () => {
  test('admin: unconditional floor for the NEW check specifically — never needs grades__report_generate', async () => {
    mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    // admin still goes through the router-level rbac('grades','create')
    // gate like everyone else (admin was removed from the RBAC bypass in
    // an earlier fix) — so a coarse grant is needed to clear THAT gate.
    // The point of this test is what happens AFTER that: no
    // grades__report_generate grant exists anywhere, yet admin must still
    // pass — proving the new check's floor doesn't depend on any grant.
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'admin', permissions: { grades: ['read', 'create', 'update', 'delete'] } },
    ];
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({}); // invalid body — proves we got PAST the permission check
    expect(res.status).not.toBe(403);
  });

  test('superadmin: unconditional floor via the RBAC superrole bypass', async () => {
    mockJwtUser = { userId: 'u_root', schoolId: SCHOOL, role: 'superadmin', roles: ['superadmin'] };
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({});
    expect(res.status).not.toBe(403);
  });

  test('THE REGRESSION GUARD: a role with coarse grades:create but NO explicit report_generate grant is still rejected', async () => {
    mockJwtUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'hod_science', roles: ['hod_science'] };
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'hod_science', permissions: { grades: ['read', 'create', 'update'] } }, // no grades__report_generate at all
    ];
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/do not have permission to publish/i);
  });

  test('a role with grades__report_generate EXPLICITLY granted an empty array (customized but not checked) is still rejected — no accidental pass-through', async () => {
    mockJwtUser = { userId: 'u_hod2', schoolId: SCHOOL, role: 'hod_science', roles: ['hod_science'] };
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'hod_science', permissions: { grades: ['read', 'create'], grades__report_generate: [] } },
    ];
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({});
    expect(res.status).toBe(403);
  });

  test('THE NEW CAPABILITY: a non-admin role explicitly granted grades__report_generate:create passes the permission gate', async () => {
    mockJwtUser = { userId: 'u_deputy', schoolId: SCHOOL, role: 'deputy_principal', roles: ['deputy_principal'] };
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'deputy_principal', permissions: { grades: ['read', 'create'], grades__report_generate: ['create'] } },
    ];
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({}); // invalid body — proves we got PAST the permission check
    expect(res.status).not.toBe(403);
  });

  test('a per-user override granting report_generate to one specific person (role itself not granted it) also passes', async () => {
    mockJwtUser = { userId: 'u_specific', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'teacher', permissions: { grades: ['read', 'create'] } }, // role itself: no report_generate
      { schoolId: SCHOOL, userId: 'u_specific', permissions: { grades__report_generate: ['create'] } }, // this ONE person: granted
    ];
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({});
    expect(res.status).not.toBe(403);
  });

  test('a role with NO grades:create at all is rejected by the earlier coarse rbac() gate, before ever reaching the new check', async () => {
    mockJwtUser = { userId: 'u_parent', schoolId: SCHOOL, role: 'parent', roles: ['parent'] };
    mockRolePermsDocs = [
      { schoolId: SCHOOL, roleKey: 'parent', permissions: { grades: ['read'] } },
    ];
    const res = await supertest(buildApp()).post('/api/report-cards/publish').send({});
    expect(res.status).toBe(403);
    // The EARLIER, generic rbac() middleware message — not the publish-specific one — proving this never reached the new check at all.
    expect(res.body.error.message).toMatch(/does not have 'create' permission on 'grades'/i);
  });
});
