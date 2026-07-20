/* ============================================================
   server/routes/mark-submissions.js — request-based unlock
   (Governance Spec §3)

   A school with no workflow_configs('marks_unlock') doc keeps today's
   exact unilateral admin/principal unlock — unchanged. A school that
   configures a single-step approver gets request -> approve, gated on
   the resolved approver, plus a scheduled 24h auto-relock job.
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
      if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
      if (Array.isArray(doc[k])) return doc[k].includes(v);
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOneAndUpdate: (filter, update, opts = {}) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) {
          if (!opts.upsert) return null;
          doc = { ...filter }; delete doc.$or; docs.push(doc);
        }
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$push) for (const [k, v] of Object.entries(update.$push)) { doc[k] = [...(doc[k] || []), v]; }
        return { ...doc };
      },
    }),
    updateMany: async (filter, update) => {
      let n = 0;
      for (const doc of docs) if (matches(doc, filter)) { Object.assign(doc, update.$set); n++; }
      return { modifiedCount: n };
    },
    updateOne: async (filter, update) => {
      const doc = docs.find(d => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { modifiedCount: doc ? 1 : 0 };
    },
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;
let mockEnqueued;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

jest.mock('../../utils/job-queue', () => ({
  enqueueJob: jest.fn((job) => { mockEnqueued.push(job); return Promise.resolve('job_1'); }),
  registerHandler: jest.fn(),
}));

const express   = require('express');
const supertest = require('supertest');
const router    = require('../../routes/mark-submissions');

const SCHOOL = 'school_test_001';
const SUB_FILTER = { classId: 'cls_1', subjectId: 'subj_1', termNumber: 1, assessmentType: 'CA', instance: 1 };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mark-submissions', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueued = [];
  mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [], email: 'a@x.io' };
  mockStores = {
    mark_submissions:  makeStore([{ id: 'sub_1', schoolId: SCHOOL, status: 'locked', unlockRequestStatus: null, ...SUB_FILTER }]),
    assessment_marks:  makeStore([]),
    workflow_configs:  makeStore(),
    custom_roles:      makeStore(),
    messages:          makeStore(),
    users: makeStore([
      { id: 'u_admin',   schoolId: SCHOOL, name: 'Admin',   role: 'admin',   isActive: true },
      { id: 'u_hod',     schoolId: SCHOOL, name: 'HOD',     role: 'teacher', extraRoles: ['hod'], isActive: true },
      { id: 'u_teacher', schoolId: SCHOOL, name: 'Teacher', role: 'teacher', isActive: true },
    ]),
  };
});

describe('legacy schools (no marks_unlock config) — unchanged behavior', () => {
  test('unlock works unilaterally for admin/principal with a reason, no request needed', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({ reason: 'exam board asked for a correction' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'marks.unlocked' }));
  });

  test('a non-admin/principal cannot unlock', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const res = await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({ reason: 'please' });
    expect(res.status).toBe(403);
  });

  test('unlock always schedules a 24h auto-relock job', async () => {
    const app = buildApp();
    await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({ reason: 'ok' });
    expect(mockEnqueued).toHaveLength(1);
    expect(mockEnqueued[0].type).toBe('marks_relock');
    expect(mockEnqueued[0].runAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });
});

describe('configured single-step approver — request-then-approve gate', () => {
  async function configureApprover(app) {
    await mockStores.workflow_configs.create({
      id: 'wfc_marks_unlock_' + SCHOOL, schoolId: SCHOOL, workflowKey: 'marks_unlock',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'hod', fallback: null }], notifyOnly: [],
    });
  }

  test('unlock is rejected outright when no request has been made yet', async () => {
    const app = buildApp();
    await configureApprover(app);
    mockCurrentUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['hod'] };
    const res = await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({ reason: 'x' });
    expect(res.status).toBe(400);
  });

  test('teacher requests, HOD (the resolved approver) approves', async () => {
    const app = buildApp();
    await configureApprover(app);

    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const reqRes = await supertest(app).post('/api/mark-submissions/sub_1/request-unlock').send({ reason: 'need to fix a transposed score' });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.data.unlockRequestStatus).toBe('pending');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'marks.unlock_requested' }));

    // Admin is not the configured approver (HOD is) — should be rejected
    mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
    const adminRes = await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({});
    expect(adminRes.status).toBe(403);

    mockCurrentUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['hod'] };
    const res = await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.unlockReason).toBe('need to fix a transposed score'); // fell back to the request's own reason
    expect(mockEnqueued).toHaveLength(1);
  });

  test('a second request while one is already pending is rejected', async () => {
    const app = buildApp();
    await configureApprover(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    await supertest(app).post('/api/mark-submissions/sub_1/request-unlock').send({ reason: 'first' });
    const res = await supertest(app).post('/api/mark-submissions/sub_1/request-unlock').send({ reason: 'second' });
    expect(res.status).toBe(400);
  });

  test('the configured approver can reject the request instead', async () => {
    const app = buildApp();
    await configureApprover(app);
    mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    await supertest(app).post('/api/mark-submissions/sub_1/request-unlock').send({ reason: 'please' });

    mockCurrentUser = { userId: 'u_hod', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['hod'] };
    const res = await supertest(app).post('/api/mark-submissions/sub_1/reject-unlock-request').send({ reason: 'not enough justification' });
    expect(res.status).toBe(200);
    expect(res.body.data.unlockRequestStatus).toBe('rejected');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'marks.unlock_request_rejected' }));

    // and unlock is still blocked — no pending request anymore
    const unlockRes = await supertest(app).post('/api/mark-submissions/sub_1/unlock').send({});
    expect(unlockRes.status).toBe(400);
  });
});

describe('24h auto-relock handler', () => {
  test('re-locks a submission still in the post-unlock approved state', async () => {
    jest.resetModules();
    let capturedHandler;
    jest.doMock('../../utils/job-queue', () => ({
      enqueueJob: jest.fn(),
      registerHandler: jest.fn((type, fn) => { if (type === 'marks_relock') capturedHandler = fn; }),
    }));
    jest.doMock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
    jest.doMock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
    jest.doMock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
    jest.doMock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
    jest.doMock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

    mockStores.mark_submissions = makeStore([{ id: 'sub_2', schoolId: SCHOOL, status: 'approved', ...SUB_FILTER }]);
    mockStores.assessment_marks = makeStore([{ schoolId: SCHOOL, studentId: 'stu_1', ...SUB_FILTER, isLocked: false }]);

    require('../../routes/mark-submissions'); // triggers registerHandler at module load
    await capturedHandler({ submissionId: 'sub_2', schoolId: SCHOOL });

    const sub = mockStores.mark_submissions._docs().find(d => d.id === 'sub_2');
    expect(sub.status).toBe('locked');
    const mark = mockStores.assessment_marks._docs()[0];
    expect(mark.isLocked).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'marks.auto_relocked' }));
  });

  test('does nothing if the submission was already moved on (not approved anymore)', async () => {
    jest.resetModules();
    let capturedHandler;
    jest.doMock('../../utils/job-queue', () => ({
      enqueueJob: jest.fn(),
      registerHandler: jest.fn((type, fn) => { if (type === 'marks_relock') capturedHandler = fn; }),
    }));
    jest.doMock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
    jest.doMock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
    jest.doMock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
    jest.doMock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
    jest.doMock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

    mockStores.mark_submissions = makeStore([{ id: 'sub_3', schoolId: SCHOOL, status: 'locked', ...SUB_FILTER }]);

    require('../../routes/mark-submissions');
    await capturedHandler({ submissionId: 'sub_3', schoolId: SCHOOL });

    const sub = mockStores.mark_submissions._docs().find(d => d.id === 'sub_3');
    expect(sub.status).toBe('locked'); // untouched — already re-locked / moved on
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'marks.auto_relocked' }));
  });
});
