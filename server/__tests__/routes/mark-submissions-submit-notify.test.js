/* ============================================================
   POST /api/mark-submissions — submitting for review now notifies
   reviewers.

   Nothing told a reviewer (admin/principal/section_head, the same
   floor /review itself enforces) that a submission was waiting —
   the only existing notify path fired on the unlock-request step,
   well past where a reviewer first needs to know. This covers the
   new _notifyReviewers() call: it fires once per active admin/
   principal/section_head user, and a lookup/notify failure never
   blocks the submission itself from succeeding.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/job-queue', () => ({ enqueueJob: jest.fn(), registerHandler: jest.fn() }));
jest.mock('../../utils/workflow-config', () => ({ getWorkflowConfig: jest.fn().mockResolvedValue(null), resolveStep: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/elective-scope', () => ({ isElective: jest.fn().mockResolvedValue(false), canTeachElective: jest.fn().mockResolvedValue(true) }));
jest.mock('../../utils/teaching-scope', () => ({ restrictToTaught: jest.fn(), taughtPairs: jest.fn().mockResolvedValue([]) }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return true; // $or/$in etc. — not exercised here
    return doc[k] === v;
  });
}
function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockRolePermsDocs;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'role_permissions') {
      return { findOne: (filter) => mockChain(mockRolePermsDocs.find((d) => mockMatchFilter(d, filter)) ?? null) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

let mockUsersDocs;
let mockMessagesCreate;
let mockSubmissionsCreate;
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'mark_submissions') {
      return {
        findOne: () => mockChain(null), // no existing submission — the create branch
        create:  (doc) => { mockSubmissionsCreate(doc); return Promise.resolve(doc); },
      };
    }
    if (collection === 'assessment_marks') {
      return { find: () => mockChain([{ studentId: 'stu_1', rawScore: 70 }]) };
    }
    if (collection === 'classes')  return { findOne: () => mockChain({ id: 'cls_001', name: 'Form 1A' }) };
    if (collection === 'subjects') return { findOne: () => mockChain({ id: 'subj_eng', name: 'English Language' }) };
    if (collection === 'users')    return { find: () => mockChain(mockUsersDocs) };
    if (collection === 'messages') return { create: (doc) => { mockMessagesCreate(doc); return Promise.resolve(doc); } };
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

const VALID_SUBMIT = {
  classId: 'cls_001', subjectId: 'subj_eng', termNumber: 1,
  assessmentType: 'MT', instance: 1, streamId: 'strm_a',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
  mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'teacher', permissions: { grades: ['read', 'create', 'update'] } }];
  mockUsersDocs = [
    { id: 'usr_admin_1' }, { id: 'usr_principal_1' }, { id: 'usr_sectionhead_1' },
  ];
  mockMessagesCreate = jest.fn();
  mockSubmissionsCreate = jest.fn();
});

describe('POST /api/mark-submissions — reviewer notification', () => {
  test('submitting creates the submission and notifies every active admin/principal/section_head', async () => {
    const res = await supertest(buildApp()).post('/api/mark-submissions').send(VALID_SUBMIT);
    expect(res.status).toBe(201);
    expect(mockSubmissionsCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    const recipients = mockMessagesCreate.mock.calls.map(([doc]) => doc.recipients[0]);
    expect(recipients.sort()).toEqual(['usr_admin_1', 'usr_principal_1', 'usr_sectionhead_1'].sort());
    const [sentDoc] = mockMessagesCreate.mock.calls[0];
    expect(sentDoc.subject).toBe('Marks submitted for review');
    expect(sentDoc.body).toMatch(/English Language — Form 1A/);
    expect(sentDoc.body).toMatch(/MT marks for Term 1/);
  });

  test('no reviewers found — zero notifications, submission still succeeds', async () => {
    mockUsersDocs = [];
    const res = await supertest(buildApp()).post('/api/mark-submissions').send(VALID_SUBMIT);
    expect(res.status).toBe(201);
    expect(mockSubmissionsCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('a notification failure never blocks the submission itself', async () => {
    mockMessagesCreate = jest.fn(() => { throw new Error('messages store unavailable'); });
    const res = await supertest(buildApp()).post('/api/mark-submissions').send(VALID_SUBMIT);
    expect(res.status).toBe(201);
    expect(mockSubmissionsCreate).toHaveBeenCalledTimes(1);
  });
});
