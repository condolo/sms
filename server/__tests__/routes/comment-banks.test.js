/* ============================================================
   server/routes/comment-banks.js — RC10 shared-service read access

   GET was previously gated on rbac('grades', 'read') — meaning a
   caller from Report Cards (report_cards:*) or a future Behaviour
   consumer, neither of which necessarily holds grades:*, could be
   blocked from the same picklist Assessment's Mark Entry already
   used freely. RC10 opens reads to any authenticated staff member;
   writes (create/update/delete) stay a Grades-settings concern,
   unchanged.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_1', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };
    next();
  },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

const mockRbac = jest.fn(() => (_req, _res, next) => next());
jest.mock('../../middleware/rbac', () => ({ rbac: (...args) => mockRbac(...args) }));

function mockChain(result) {
  return { sort: () => mockChain(result), limit: () => mockChain(result), lean: () => Promise.resolve(result) };
}

const mockFind           = jest.fn(() => mockChain([]));
const mockCreate         = jest.fn().mockResolvedValue({ id: 'cb_1', toObject: () => ({ id: 'cb_1' }) });
const mockFindOneAndUpdate = jest.fn(() => ({ lean: () => Promise.resolve({ id: 'cb_1' }) }));
const mockFindOneAndDelete = jest.fn().mockResolvedValue({ id: 'cb_1' });

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({
    find: mockFind, create: mockCreate,
    findOneAndUpdate: mockFindOneAndUpdate, findOneAndDelete: mockFindOneAndDelete,
  })),
  tenantContext: jest.fn(() => ({})),
}));

const express       = require('express');
const supertest     = require('supertest');
const commentBanksRouter = require('../../routes/comment-banks');

// The mocked rbac middleware factory is invoked once, at route-registration
// time (module require), not per-request — capture that snapshot before
// beforeEach's jest.clearAllMocks() wipes mockRbac's call history.
const registrationCalls = [...mockRbac.mock.calls];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/comment-banks', commentBanksRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockReturnValue(mockChain([]));
  mockCreate.mockResolvedValue({ id: 'cb_1', toObject: () => ({ id: 'cb_1' }) });
  mockFindOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve({ id: 'cb_1' }) });
  mockFindOneAndDelete.mockResolvedValue({ id: 'cb_1' });
});

describe('GET /api/comment-banks — shared read (RC10)', () => {
  test('succeeds for a plain authenticated teacher', async () => {
    const res = await supertest(buildApp()).get('/api/comment-banks');
    expect(res.status).toBe(200);
  });

  test('no module rbac gate was ever registered for the GET route', () => {
    // GET / is the very first route registered in the file — no
    // ('grades', 'read') (or any) rbac(...) call preceded the first
    // write route's registration.
    expect(registrationCalls[0]).not.toEqual(['grades', 'read']);
  });
});

describe('POST/PUT/DELETE /api/comment-banks — still Grades-settings-gated', () => {
  test('rbac was registered for create/update/delete, at route-definition time', () => {
    expect(registrationCalls).toContainEqual(['grades', 'create']);
    expect(registrationCalls).toContainEqual(['grades', 'update']);
    expect(registrationCalls).toContainEqual(['grades', 'delete']);
  });

  test('POST succeeds (module.exports wiring intact)', async () => {
    const res = await supertest(buildApp()).post('/api/comment-banks').send({ text: 'Great effort this term.', category: 'general' });
    expect(res.status).toBe(201);
  });

  test('PUT succeeds', async () => {
    const res = await supertest(buildApp()).put('/api/comment-banks/cb_1').send({ text: 'Updated remark.' });
    expect(res.status).toBe(200);
  });

  test('DELETE succeeds', async () => {
    const res = await supertest(buildApp()).delete('/api/comment-banks/cb_1');
    expect(res.status).toBe(200);
  });
});
