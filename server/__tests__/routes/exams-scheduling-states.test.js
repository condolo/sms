/* ============================================================
   server/routes/exams.js — the four-state scheduling tracker (Phase 6)

   Exams schedule a sitting; moderation and marks live in the Markbook.
   Only scheduled -> in_progress -> completed (or cancelled) is allowed.
   The Results endpoints and the lock/unlock endpoints are retired and
   must no longer be routable.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), sort: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockCurrentUser = { userId: 'usr_teacher', schoolId: 'sch_1', role: 'teacher', roles: ['teacher'] };
let mockExisting;
const mockExamUpdate = jest.fn((filter, update) => mockChain({ ...mockExisting, ...update }));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn().mockResolvedValue(false) }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'exams') {
      return {
        findOne: () => mockChain(mockExisting),
        findOneAndUpdate: mockExamUpdate,
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

const express     = require('express');
const supertest   = require('supertest');
const examsRouter = require('../../routes/exams');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_teacher', schoolId: 'sch_1', role: 'teacher', roles: ['teacher'] };
  mockExisting = { id: 'ex_1', schoolId: 'sch_1', title: 'Mid-Term', status: 'scheduled', statusHistory: [] };
});

function putStatus(status, role = 'teacher') {
  mockCurrentUser = { userId: 'usr_x', schoolId: 'sch_1', role, roles: [role] };
  return supertest(buildApp()).put('/api/exams/ex_1').send({ status });
}

describe('PUT /api/exams/:id — four-state scheduling tracker', () => {
  test('scheduled -> in_progress is allowed for a teacher', async () => {
    const res = await putStatus('in_progress', 'teacher');
    expect(res.status).toBe(200);
    expect(mockExamUpdate).toHaveBeenCalledTimes(1);
  });

  test('in_progress -> completed is allowed', async () => {
    mockExisting.status = 'in_progress';
    const res = await putStatus('completed', 'teacher');
    expect(res.status).toBe(200);
  });

  test('scheduled -> cancelled is allowed for an exams officer', async () => {
    const res = await putStatus('cancelled', 'exams_officer');
    expect(res.status).toBe(200);
  });

  test('the legacy moderation states are no longer valid targets', async () => {
    for (const legacy of ['moderated', 'approved', 'locked', 'published', 'archived']) {
      const res = await putStatus(legacy, 'admin');
      expect([400, 422]).toContain(res.status);
    }
    expect(mockExamUpdate).not.toHaveBeenCalled();
  });

  test('a skipped transition (scheduled -> completed) is rejected', async () => {
    const res = await putStatus('completed', 'teacher');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Cannot transition/);
  });

  test('completed is terminal: nothing moves out of it', async () => {
    mockExisting.status = 'completed';
    const res = await putStatus('in_progress', 'admin');
    expect(res.status).toBe(400);
  });
});

describe('retired Results and lock/unlock endpoints are no longer routable', () => {
  test.each([
    ['GET',  '/api/exams/ex_1/results'],
    ['POST', '/api/exams/ex_1/results'],
    ['GET',  '/api/exams/results/all'],
    ['POST', '/api/exams/ex_1/lock'],
    ['POST', '/api/exams/ex_1/unlock'],
  ])('%s %s is gone (404)', async (method, path) => {
    mockCurrentUser = { userId: 'usr_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] };
    const app = buildApp();
    const req = method === 'GET' ? supertest(app).get(path) : supertest(app).post(path).send({});
    const res = await req;
    expect(res.status).toBe(404);
  });
});
