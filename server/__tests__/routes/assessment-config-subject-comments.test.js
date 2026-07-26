/* ============================================================
   server/routes/assessment.js — subjectTeacherCommentsEnabled (RC7)

   PATCH /api/assessment/config gains a new capability toggle;
   GET /api/assessment/config must always return it (defaulting true
   for schools that never configured it, preserving today's
   always-on behavior — first coverage for this route).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin_1', schoolId: 'school_001', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false), firstArchivedYear: jest.fn().mockResolvedValue(null) }));

function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }) };
}

let mockConfigDoc;
const mockConfigFindOne         = jest.fn(() => mockChain(() => mockConfigDoc));
const mockConfigCreate          = jest.fn().mockResolvedValue({});
const mockConfigFindOneAndUpdate = jest.fn((filter, update) => mockChain(() => ({ ...mockConfigDoc, ...update.$set })));
const mockGradeBoundaryFindOne  = jest.fn(() => mockChain(() => null));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config') {
      return { findOne: mockConfigFindOne, create: mockConfigCreate, findOneAndUpdate: mockConfigFindOneAndUpdate };
    }
    if (collection === 'grade_boundaries') {
      return { findOne: mockGradeBoundaryFindOne };
    }
    return { findOne: jest.fn(() => mockChain(() => null)) };
  }),
}));

const express       = require('express');
const supertest     = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigDoc = null; // no config saved yet — triggers _getConfig's default-doc branch
  mockConfigFindOne.mockReturnValue(mockChain(() => mockConfigDoc));
  mockConfigCreate.mockResolvedValue({});
  mockGradeBoundaryFindOne.mockReturnValue(mockChain(() => null));
});

describe('GET /api/assessment/config — subjectTeacherCommentsEnabled default', () => {
  test('a school that never configured it gets true (preserves always-on behavior)', async () => {
    mockConfigDoc = null;
    const res = await supertest(buildApp()).get('/api/assessment/config');
    expect(res.status).toBe(200);
    expect(res.body.data.subjectTeacherCommentsEnabled).toBe(true);
  });

  test('an explicitly saved false value is returned as-is', async () => {
    mockConfigDoc = { customTypes: [{ key: 'CA', label: 'CA', weight: 100, instances: 1 }], subjectTeacherCommentsEnabled: false };
    const res = await supertest(buildApp()).get('/api/assessment/config');
    expect(res.status).toBe(200);
    expect(res.body.data.subjectTeacherCommentsEnabled).toBe(false);
  });
});

describe('PATCH /api/assessment/config — subjectTeacherCommentsEnabled', () => {
  test('rejects a non-boolean value', async () => {
    const res = await supertest(buildApp()).patch('/api/assessment/config').send({ subjectTeacherCommentsEnabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('accepts a boolean and persists it via $set', async () => {
    mockConfigDoc = { customTypes: [{ key: 'CA', label: 'CA', weight: 100, instances: 1 }] };
    const res = await supertest(buildApp()).patch('/api/assessment/config').send({ subjectTeacherCommentsEnabled: false });
    expect(res.status).toBe(200);
    expect(mockConfigFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'school_001' }),
      expect.objectContaining({ $set: expect.objectContaining({ subjectTeacherCommentsEnabled: false }) }),
      expect.anything(),
    );
    expect(res.body.data.subjectTeacherCommentsEnabled).toBe(false);
  });
});
