/* ============================================================
   server/routes/assessment.js — PUT /schedule defaults academicYearId
   to the school's current academic year instead of persisting null

   Every one of the 8 live assessment_schedule documents (checked
   directly, v5.166.0) had academicYearId: null, because the Configuration
   UI never sent one. That's tolerated on READ via _yearFilterPart's
   null-matches-any-year fallback, but new entries should stop joining
   that pile — this is the write-side half of closing the gap, part of
   consolidating all mark entry into the Markbook.

   Also verifies: re-saving an existing legacy null-tagged entry (still
   no academicYearId sent) adopts/backfills that SAME row instead of
   upserting a duplicate under the newly-resolved year; an explicit
   academicYearId in the request is untouched and never adopts a legacy row.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';
const CURRENT_YEAR = 'ay_2026_2027';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({}));

let mockScheduleDocs;

function mockChainArr(arr) { return { sort: () => mockChainArr(arr), select: () => mockChainArr(arr), limit: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), sort: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    return doc[k] === v;
  });
}

const mockScheduleFindOneAndUpdate = jest.fn();

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'academic_years') {
      return { find: jest.fn(() => mockChainArr([
        { id: CURRENT_YEAR, schoolId: SCHOOL, isCurrent: true, startDate: '2026-09-01', endDate: '2027-07-01' },
      ])) };
    }
    if (collection === 'assessment_config') {
      return {
        findOne: jest.fn(() => mockChainObj({ schoolId: SCHOOL, customTypes: [{ key: 'CA', label: 'CA', weight: 30 }] })),
        create:  jest.fn().mockResolvedValue({}),
      };
    }
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'academic_years') {
      return { find: jest.fn(() => mockChainArr([
        { id: CURRENT_YEAR, schoolId: SCHOOL, isCurrent: true, startDate: '2026-09-01', endDate: '2027-07-01' },
      ])) };
    }
    if (collection === 'assessment_config') {
      return { findOne: jest.fn(() => mockChainObj({ schoolId: SCHOOL, customTypes: [{ key: 'CA', label: 'CA', weight: 30 }] })) };
    }
    if (collection === 'assessment_schedule') {
      return {
        findOne: jest.fn((filter) => mockChainObj(mockScheduleDocs.find(d => mockMatchesFilter(d, filter)) ?? null)),
        findOneAndUpdate: mockScheduleFindOneAndUpdate,
      };
    }
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  },
}));

const express          = require('express');
const supertest        = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduleDocs = [];
  mockScheduleFindOneAndUpdate.mockImplementation((filter, update) =>
    mockChainObj({ id: 'sched_1', ...filter, ...update.$set, ...update.$setOnInsert })
  );
});

const BODY = { termNumber: 1, assessmentType: 'CA', instance: 1, dateFrom: '2026-09-01', dateTo: '2026-09-10' };

describe('PUT /api/assessment/schedule — mandatory academic year going forward', () => {
  test('omitting academicYearId resolves to the school\'s current year, not null', async () => {
    const res = await supertest(buildApp()).put('/api/assessment/schedule').send(BODY);
    expect(res.status).toBe(200);
    const [filter, update] = mockScheduleFindOneAndUpdate.mock.calls[0];
    expect(update.$set.academicYearId).toBe(CURRENT_YEAR);
    // No existing legacy row — this is a fresh create, filter targets the resolved year directly
    expect(filter.academicYearId).toBe(CURRENT_YEAR);
  });

  test('re-saving an existing legacy null-tagged entry adopts and backfills that SAME row, not a duplicate', async () => {
    mockScheduleDocs = [{ id: 'sched_legacy', schoolId: SCHOOL, termNumber: 1, assessmentType: 'CA', instance: 1, academicYearId: null, dateFrom: '2026-01-01', dateTo: '2026-01-05', label: 'CA' }];
    const res = await supertest(buildApp()).put('/api/assessment/schedule').send(BODY);
    expect(res.status).toBe(200);
    const [filter, update] = mockScheduleFindOneAndUpdate.mock.calls[0];
    // Matches the EXISTING null-tagged row (not a new resolvedYearId row)...
    expect(filter.academicYearId).toBeNull();
    // ...but backfills it to the current year on save.
    expect(update.$set.academicYearId).toBe(CURRENT_YEAR);
  });

  test('an explicit academicYearId in the request is used as-is and never adopts a legacy null row', async () => {
    mockScheduleDocs = [{ id: 'sched_legacy', schoolId: SCHOOL, termNumber: 1, assessmentType: 'CA', instance: 1, academicYearId: null, dateFrom: '2026-01-01', dateTo: '2026-01-05', label: 'CA' }];
    const res = await supertest(buildApp()).put('/api/assessment/schedule').send({ ...BODY, academicYearId: 'ay_next_year' });
    expect(res.status).toBe(200);
    const [filter, update] = mockScheduleFindOneAndUpdate.mock.calls[0];
    expect(filter.academicYearId).toBe('ay_next_year');
    expect(update.$setOnInsert.academicYearId).toBe('ay_next_year');
  });
});
