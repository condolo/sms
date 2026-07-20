/* ============================================================
   server/routes/hr.js — leave approval chain (Governance Spec §1)

   A school with no workflow_configs doc gets exactly today's
   single-step behavior (POST /leave -> pending, PATCH /resolve by
   'hr' RBAC permission). A school that configures a chain gets a
   currentStepOrder-driven state machine: configured steps via
   PATCH /:id/advance (eligibility-checked against the resolved
   step), then HR's own final PATCH /:id/resolve, blocked until every
   configured step has cleared.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      if (Array.isArray(doc[k])) return doc[k].includes(v);
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    findOneAndUpdate: (filter, update, opts = {}) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) {
          if (!opts.upsert) return null;
          doc = { ...filter }; delete doc.$or; docs.push(doc);
        }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const express   = require('express');
const supertest = require('supertest');
const hrRouter  = require('../../routes/hr');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr', hrRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [], name: 'A Teacher', email: 't@x.io' };
  mockStores = {
    leave_requests:   makeStore(),
    workflow_configs: makeStore(),
    custom_roles:     makeStore(),
    messages:         makeStore(),
    memberships:      makeStore(), // audit.js enrichment lookup — unused here since AuditService.log is mocked, kept for parity
    users: makeStore([
      { id: 'u_teacher',    schoolId: SCHOOL, name: 'A Teacher',   role: 'teacher',   isActive: true },
      { id: 'u_hod',        schoolId: SCHOOL, name: 'HOD Person',  role: 'teacher', extraRoles: ['hod'], isActive: true },
      { id: 'u_principal',  schoolId: SCHOOL, name: 'The Principal', role: 'principal', isActive: true },
      { id: 'u_hr',         schoolId: SCHOOL, name: 'HR Person',   role: 'hr',        isActive: true },
    ]),
  };
});

async function submitLeave(app) {
  const res = await supertest(app).post('/api/hr/leave').send({
    type: 'annual', startDate: '2026-08-01', endDate: '2026-08-03', reason: 'trip',
  });
  return res;
}

describe('legacy single-step schools (no workflow_configs doc) — unchanged behavior', () => {
  test('POST /leave creates a request with currentStepOrder null', async () => {
    const app = buildApp();
    const res = await submitLeave(app);
    expect(res.status).toBe(201);
    expect(res.body.data.currentStepOrder).toBeNull();
    expect(res.body.data.status).toBe('pending');
  });

  test('PATCH /:id/resolve approves directly — no chain gate applies', async () => {
    const app = buildApp();
    const submitRes = await submitLeave(app);
    const id = submitRes.body.data.id;

    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [], name: 'HR Person', email: 'hr@x.io' };
    const res = await supertest(app).patch(`/api/hr/leave/${id}/resolve`).send({ status: 'approved', notes: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.hr_confirmed' }));
  });
});

describe('PUT /leave/workflow-config — save validation', () => {
  test('rejects a single-step chain (floor is 2)', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    const res = await supertest(app).put('/api/hr/leave/workflow-config').send({
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'hod' }],
    });
    expect(res.status).toBe(400);
  });

  test('accepts a 2-step chain', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    const res = await supertest(app).put('/api/hr/leave/workflow-config').send({
      steps: [
        { order: 1, assigneeType: 'role', assigneeValue: 'hod' },
        { order: 2, assigneeType: 'role', assigneeValue: 'principal' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toHaveLength(2);
  });
});

describe('configured chain — full flow', () => {
  async function configureChain(app) {
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    await supertest(app).put('/api/hr/leave/workflow-config').send({
      steps: [
        { order: 1, assigneeType: 'role', assigneeValue: 'hod' },
        { order: 2, assigneeType: 'user', assigneeValue: 'u_principal' },
      ],
    });
  }

  test('POST /leave with a configured chain starts at step 1', async () => {
    const app = buildApp();
    await configureChain(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const res = await submitLeave(app);
    expect(res.body.data.currentStepOrder).toBe(1);
  });

  test('an ineligible user cannot advance the current step', async () => {
    const app = buildApp();
    await configureChain(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const submitRes = await submitLeave(app);
    const id = submitRes.body.data.id;

    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] }; // not the HOD
    const res = await supertest(app).patch(`/api/hr/leave/${id}/advance`).send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  test('resolve is blocked while an earlier step is still pending', async () => {
    const app = buildApp();
    await configureChain(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const submitRes = await submitLeave(app);
    const id = submitRes.body.data.id;

    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    const res = await supertest(app).patch(`/api/hr/leave/${id}/resolve`).send({ status: 'approved', notes: 'ok' });
    expect(res.status).toBe(400);
  });

  test('rejecting a step requires a reason', async () => {
    const app = buildApp();
    await configureChain(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const submitRes = await submitLeave(app);
    const id = submitRes.body.data.id;

    mockCurrentUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['hod'] };
    const res = await supertest(app).patch(`/api/hr/leave/${id}/advance`).send({ status: 'rejected' });
    expect(res.status).toBe(400);
  });

  test('full chain: HOD approves step 1, Principal approves step 2, HR confirms', async () => {
    const app = buildApp();
    await configureChain(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const submitRes = await submitLeave(app);
    const id = submitRes.body.data.id;

    mockCurrentUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['hod'] };
    let res = await supertest(app).patch(`/api/hr/leave/${id}/advance`).send({ status: 'approved', notes: 'looks fine' });
    expect(res.status).toBe(200);
    expect(res.body.data.currentStepOrder).toBe(2);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.step_approved', details: expect.objectContaining({ stepOrder: 1 }) }));

    mockCurrentUser = { userId: 'u_principal', schoolId: SCHOOL, role: 'principal', roles: [] };
    res = await supertest(app).patch(`/api/hr/leave/${id}/advance`).send({ status: 'approved', notes: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.currentStepOrder).toBe(3); // steps.length + 1

    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    res = await supertest(app).patch(`/api/hr/leave/${id}/resolve`).send({ status: 'approved', notes: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.hr_confirmed' }));

    // A message was generated for the HOD (step 1 notify) — spot-check the messages store, not the exact copy.
    expect(mockStores.messages._docs().length).toBeGreaterThan(0);
  });

  test('a rejection at step 1 stops the chain — HR resolve is never reachable', async () => {
    const app = buildApp();
    await configureChain(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const submitRes = await submitLeave(app);
    const id = submitRes.body.data.id;

    mockCurrentUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['hod'] };
    const res = await supertest(app).patch(`/api/hr/leave/${id}/advance`).send({ status: 'rejected', notes: 'not enough notice' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.step_rejected' }));

    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };
    const resolveRes = await supertest(app).patch(`/api/hr/leave/${id}/resolve`).send({ status: 'approved', notes: 'x' });
    expect(resolveRes.status).toBe(400); // already resolved (rejected), not pending
  });
});
