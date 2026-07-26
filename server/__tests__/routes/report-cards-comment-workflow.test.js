/* ============================================================
   server/routes/report-cards.js — report-level remark approval
   chain (RC8, via server/utils/workflow-config.js)

   A school with no workflow_configs doc for 'report_comment_approval'
   keeps writing classTeacherRemark/principalRemark directly via the
   pre-existing PUT /draft-comments/:studentId — completely unaffected.
   A school that configures the chain gets a currentStepOrder-driven
   state machine on report_card_draft_comments, mirroring hr.js's
   leave-approval chain exactly (same workflow-config.js engine).

   Same makeStore()/chain() in-memory mock pattern as
   hr-leave-workflow.test.js, since tenantModel(...) delegates to the
   same _model(...) mock underneath.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
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
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) { doc = { ...filter }; delete doc.$or; docs.push(doc); }
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

const express       = require('express');
const supertest     = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_class_teacher', schoolId: SCHOOL, role: 'teacher', roles: [], name: 'Ms Class Teacher', email: 'ct@x.io' };
  mockStores = {
    report_card_draft_comments: makeStore(),
    workflow_configs: makeStore(),
    custom_roles: makeStore(),
    messages: makeStore(),
    schools: makeStore(), // notif-settings.isEnabled — no doc, falls back to DEFAULTS
    notification_digests: makeStore(),
    users: makeStore([
      { id: 'u_class_teacher', schoolId: SCHOOL, name: 'Ms Class Teacher', role: 'teacher', isActive: true },
      { id: 'u_principal',     schoolId: SCHOOL, name: 'The Principal',    role: 'principal', isActive: true },
      { id: 'u_deputy',        schoolId: SCHOOL, name: 'The Deputy',       role: 'deputy_principal', isActive: true },
    ]),
  };
});

async function configureChain(app, steps) {
  mockCurrentUser = { userId: 'u_principal', schoolId: SCHOOL, role: 'principal', roles: [] };
  await supertest(app).put('/api/report-cards/workflow-config').send({ steps });
}

describe('legacy schools (no workflow_configs doc) — unaffected', () => {
  test('GET /workflow-config returns an empty-steps shape, not an error', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/workflow-config');
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toEqual([]);
  });

  test('PATCH /draft-comments/:studentId/advance is a 400 with no chain configured', async () => {
    const res = await supertest(buildApp())
      .patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: 'Great term' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/No report-comment approval chain/);
  });
});

describe('PUT /workflow-config — save validation', () => {
  test('accepts a single-step chain (minSteps=1, unlike leave_approval\'s 2)', async () => {
    const app = buildApp();
    const res = await supertest(app).put('/api/report-cards/workflow-config').send({
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toHaveLength(1);
  });

  test('rejects zero steps', async () => {
    const app = buildApp();
    const res = await supertest(app).put('/api/report-cards/workflow-config').send({ steps: [] });
    expect(res.status).toBe(400);
  });
});

describe('configured chain — advance flow', () => {
  test('an ineligible user cannot advance the current step', async () => {
    const app = buildApp();
    await configureChain(app, [
      { order: 1, assigneeType: 'role', assigneeValue: 'teacher', label: 'Class Teacher' },
      { order: 2, assigneeType: 'role', assigneeValue: 'principal', label: 'Principal' },
    ]);
    mockCurrentUser = { userId: 'u_deputy', schoolId: SCHOOL, role: 'deputy_principal', roles: [] }; // not step 1's role
    const res = await supertest(app)
      .patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: 'Not my turn' });
    expect(res.status).toBe(403);
  });

  test('a blank remark is rejected', async () => {
    const app = buildApp();
    await configureChain(app, [{ order: 1, assigneeType: 'role', assigneeValue: 'teacher', label: 'Class Teacher' }]);
    mockCurrentUser = { userId: 'u_class_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const res = await supertest(app)
      .patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: '   ' });
    expect(res.status).toBe(400);
  });

  test('full 2-step chain: class teacher writes and advances, then principal writes and completes', async () => {
    const app = buildApp();
    await configureChain(app, [
      { order: 1, assigneeType: 'role', assigneeValue: 'teacher', label: 'Class Teacher' },
      { order: 2, assigneeType: 'role', assigneeValue: 'principal', label: 'Principal' },
    ]);

    mockCurrentUser = { userId: 'u_class_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    let res = await supertest(app)
      .patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: 'Solid term overall.' });
    expect(res.status).toBe(200);
    expect(res.body.data.currentStepOrder).toBe(2);
    expect(res.body.data.reportRemarks).toEqual([
      expect.objectContaining({ stepOrder: 1, remark: 'Solid term overall.', label: 'Class Teacher' }),
    ]);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'report_comment.step_written',
      details: expect.objectContaining({ stepOrder: 1, complete: false }),
    }));
    // Step 2's eligible assignee (the principal) was notified
    expect(mockStores.messages._docs().some(m => m.recipients.includes('u_principal'))).toBe(true);

    mockCurrentUser = { userId: 'u_principal', schoolId: SCHOOL, role: 'principal', roles: [] };
    res = await supertest(app)
      .patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: 'Approved, well done.' });
    expect(res.status).toBe(200);
    expect(res.body.data.currentStepOrder).toBe(3); // steps.length + 1 — chain complete
    expect(res.body.data.reportRemarks).toHaveLength(2);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'report_comment.step_written',
      details: expect.objectContaining({ stepOrder: 2, complete: true }),
    }));
  });

  test('re-advancing an already-complete chain is rejected', async () => {
    const app = buildApp();
    await configureChain(app, [{ order: 1, assigneeType: 'role', assigneeValue: 'teacher', label: 'Class Teacher' }]);
    mockCurrentUser = { userId: 'u_class_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    await supertest(app).patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: 'Done.' });

    const res = await supertest(app).patch('/api/report-cards/draft-comments/stu_1/advance')
      .send({ classId: 'cls_1', termNumber: 1, remark: 'Trying again.' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already completed/);
  });
});
