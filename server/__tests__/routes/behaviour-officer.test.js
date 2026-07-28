/* ============================================================
   Assignable Behaviour Officer — server/routes/behaviour.js

   Uses the REAL rbac middleware (not mocked) so this proves the
   actual OR-gate: a user with zero role_permissions grant for
   'behaviour' is normally denied, but once assigned as Behaviour
   Officer (via the same workflow_configs {assigneeType, assigneeValue}
   pattern HR/payroll approval chains already use), they pass through
   unconditionally — confirmed with the requester as the intended
   behavior (assignment grants full access, not just a label).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v) && '$ne' in v) return doc[k] !== v.$ne;
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      const flat = update.$set ? { ...update.$set } : { ...update };
      if (idx === -1) { const doc = { ...flat }; docs.push(doc); return mockChainObj(doc); }
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
  };
}

let mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
// Deliberately NOT mocking ../../middleware/rbac — this test needs the real
// role_permissions check so it can prove the officer bypass actually bypasses it.
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

let mockRolePermissions, mockUsers, mockWorkflowConfigs, mockIncidents, mockAcademicYears;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions')    return mockRolePermissions;
    if (c === 'users')               return mockUsers;
    if (c === 'workflow_configs')    return mockWorkflowConfigs;
    if (c === 'behaviour_incidents') return mockIncidents;
    if (c === 'academic_years')      return mockAcademicYears;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const { invalidatePermCache } = require('../../middleware/rbac');
const behaviourRouter = require('../../routes/behaviour');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviour', behaviourRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidatePermCache(SCHOOL_A);
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockRolePermissions = makeFakeCollection([]); // teacher has NO behaviour permissions by default
  mockUsers           = makeFakeCollection([{ id: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', isActive: true }]);
  mockWorkflowConfigs  = makeFakeCollection([]);
  mockIncidents        = makeFakeCollection([]);
  mockAcademicYears    = makeFakeCollection([]);
});

test('a teacher with no behaviour role_permissions is denied normally', async () => {
  const res = await supertest(buildApp()).get('/api/behaviour/incidents');
  expect(res.status).toBe(403);
});

test('the SAME teacher, once assigned as Behaviour Officer by userId, is allowed through', async () => {
  mockWorkflowConfigs = makeFakeCollection([{
    schoolId: SCHOOL_A, workflowKey: 'behaviour_officer',
    steps: [{ assigneeType: 'user', assigneeValue: 'usr_teacher' }],
  }]);
  const res = await supertest(buildApp()).get('/api/behaviour/incidents');
  expect(res.status).toBe(200);
});

test('assigning by role also grants access to anyone currently holding that role', async () => {
  mockWorkflowConfigs = makeFakeCollection([{
    schoolId: SCHOOL_A, workflowKey: 'behaviour_officer',
    steps: [{ assigneeType: 'role', assigneeValue: 'teacher' }],
  }]);
  const res = await supertest(buildApp()).get('/api/behaviour/incidents');
  expect(res.status).toBe(200);
});

test('a different, unassigned user is still denied even when an officer is configured', async () => {
  mockJwtUser = { userId: 'usr_other', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockUsers = makeFakeCollection([
    { id: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', isActive: true },
    { id: 'usr_other',   schoolId: SCHOOL_A, role: 'teacher', isActive: true },
  ]);
  mockWorkflowConfigs = makeFakeCollection([{
    schoolId: SCHOOL_A, workflowKey: 'behaviour_officer',
    steps: [{ assigneeType: 'user', assigneeValue: 'usr_teacher' }], // assigned to someone else specifically
  }]);
  const res = await supertest(buildApp()).get('/api/behaviour/incidents');
  expect(res.status).toBe(403);
});

test('PUT /officer-config is forbidden for a non-admin, even the current officer', async () => {
  mockWorkflowConfigs = makeFakeCollection([{
    schoolId: SCHOOL_A, workflowKey: 'behaviour_officer',
    steps: [{ assigneeType: 'user', assigneeValue: 'usr_teacher' }],
  }]);
  const res = await supertest(buildApp()).put('/api/behaviour/officer-config').send({
    steps: [{ assigneeType: 'user', assigneeValue: 'usr_teacher' }],
  });
  expect(res.status).toBe(403);
});

test('PUT /officer-config succeeds for admin and GET reflects the assignment', async () => {
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  // Realistic seeded default (repairPermissions.js grants admin RCUD on every
  // module) — PUT itself doesn't need this (inline admin-role check, not
  // behaviourAccess), but the follow-up GET does since it isn't the officer.
  mockRolePermissions = makeFakeCollection([{ schoolId: SCHOOL_A, roleKey: 'admin', permissions: { behaviour: ['read', 'create', 'update', 'delete'] } }]);
  const app = buildApp();

  const putRes = await supertest(app).put('/api/behaviour/officer-config').send({
    steps: [{ assigneeType: 'role', assigneeValue: 'deputy_principal' }],
  });
  expect(putRes.status).toBe(200);
  expect(putRes.body.data.steps).toEqual([{ assigneeType: 'role', assigneeValue: 'deputy_principal' }]);

  const getRes = await supertest(app).get('/api/behaviour/officer-config');
  expect(getRes.status).toBe(200);
  expect(getRes.body.data.steps).toEqual([{ assigneeType: 'role', assigneeValue: 'deputy_principal' }]);
});

test('an empty steps array clears the assignment — falls back to plain role_permissions for everyone', async () => {
  mockWorkflowConfigs = makeFakeCollection([{
    schoolId: SCHOOL_A, workflowKey: 'behaviour_officer',
    steps: [{ assigneeType: 'user', assigneeValue: 'usr_teacher' }],
  }]);
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  const app = buildApp();
  const putRes = await supertest(app).put('/api/behaviour/officer-config').send({ steps: [] });
  expect(putRes.status).toBe(200);
  expect(putRes.body.data.steps).toEqual([]);

  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(app).get('/api/behaviour/incidents');
  expect(res.status).toBe(403); // no longer bypassed
});
