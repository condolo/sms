/* ============================================================
   GET /api/finance/fee-structures — each structure carries a generation
   summary: how many students have an invoice from it, and when it was last run.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => true),
  hasPermission: () => true,
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

const mockFeeStructures = [
  { id: 'fs_tuition', schoolId: SCHOOL, name: 'Term 1 Tuition', lineItems: [], total: 139000 },
  { id: 'fs_empty', schoolId: SCHOOL, name: 'Uniform', lineItems: [], total: 2000 },
];
const mockAggregateRows = [
  { _id: 'fs_tuition', students: ['stu1', 'stu2', 'stu3'], lastAt: '2026-10-03T08:00:00.000Z' },
];

let mockAggregateCalls = [];
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'fee_structures') {
      return {
        find: () => ({ sort: () => ({ lean: () => Promise.resolve(mockFeeStructures) }) }),
      };
    }
    if (col === 'invoices') {
      return {
        aggregate: jest.fn(async (pipeline) => { mockAggregateCalls.push(pipeline); return mockAggregateRows; }),
      };
    }
    return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

const express = require('express');
const supertest = require('supertest');
const financeRouter = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRouter);
  return app;
}

beforeEach(() => { mockAggregateCalls = []; });

describe('GET /fee-structures generation summary', () => {
  test('a structure that has been generated reports how many students and when', async () => {
    const res = await supertest(buildApp()).get('/api/finance/fee-structures');
    expect(res.status).toBe(200);
    const tuition = res.body.data.find(d => d.id === 'fs_tuition');
    expect(tuition.generation).toEqual({ students: 3, lastGeneratedAt: '2026-10-03T08:00:00.000Z' });
  });

  test('a structure never generated reports zero students and no date', async () => {
    const res = await supertest(buildApp()).get('/api/finance/fee-structures');
    const uniform = res.body.data.find(d => d.id === 'fs_empty');
    expect(uniform.generation).toEqual({ students: 0, lastGeneratedAt: null });
  });

  test('the summary is one aggregation scoped to the school\'s structure ids', async () => {
    await supertest(buildApp()).get('/api/finance/fee-structures');
    expect(mockAggregateCalls).toHaveLength(1);
    const scoped = mockAggregateCalls[0].find(stage => stage.$match && stage.$match.feeStructureId).$match;
    expect(scoped.feeStructureId.$in).toEqual(['fs_tuition', 'fs_empty']);
  });
});
