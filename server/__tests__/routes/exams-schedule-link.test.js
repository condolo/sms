/* ============================================================
   server/routes/exams.js — POST / auto-links (or creates) the
   corresponding assessment_schedule entry (the Markbook "window")

   Part of consolidating all mark entry into the Markbook: an exam no
   longer stores marks itself, but it must still open the matching
   Markbook window automatically — otherwise a Mid-Term exam could exist
   with nowhere for its subject teacher to enter marks. Before this fix,
   only the teacher /announce route ever set scheduleEntryId; the general
   admin "Create Exam" flow left it undefined (the exact gap the reported
   Biology CA exam, bc4dfbd5..., had live).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';
const CURRENT_YEAR = 'ay_2026_2027';

function mockChain(result) {
  return { select: () => mockChain(result), sort: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
let mockScheduleDocs;
const mockExamCreate = jest.fn(async (doc) => ({ ...doc }));
const mockScheduleFindOneAndUpdate = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../../utils/email', () => ({}));

function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    return doc[k] === v;
  });
}

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'exams') return { create: mockExamCreate, findOne: () => mockChain(null) };
    if (col === 'academic_years') {
      return { find: () => mockChain([{ id: CURRENT_YEAR, schoolId: SCHOOL, isCurrent: true, startDate: '2026-09-01', endDate: '2027-07-01', terms: [{ id: 't1', startDate: '2026-09-01', endDate: '2026-12-01' }] }]) };
    }
    if (col === 'assessment_config') {
      return { findOne: () => mockChain({ schoolId: SCHOOL, customTypes: [{ key: 'MT', label: 'Mid-Term Exam', weight: 30 }] }) };
    }
    if (col === 'assessment_schedule') {
      return {
        findOne: (filter) => mockChain((mockScheduleDocs || []).find(d => mockMatchesFilter(d, filter)) ?? null),
        findOneAndUpdate: mockScheduleFindOneAndUpdate,
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
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockScheduleDocs = [];
  mockScheduleFindOneAndUpdate.mockImplementation((filter, update) =>
    mockChain({ id: 'sched_new', ...filter, ...update.$set, ...update.$setOnInsert })
  );
});

const BASE_EXAM = { title: 'Mid-Term Exam — Biology', assessmentType: 'MT', maxScore: 100, date: '2026-10-15' };

describe('POST /api/exams — auto-links (or creates) its assessment_schedule window', () => {
  test('no matching schedule entry exists yet — one is created and linked via scheduleEntryId', async () => {
    const res = await supertest(buildApp()).post('/api/exams').send(BASE_EXAM);
    expect(res.status).toBe(201);
    expect(mockScheduleFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = mockScheduleFindOneAndUpdate.mock.calls[0];
    expect(filter.assessmentType).toBe('MT');
    expect(filter.instance).toBe(1);
    expect(filter.academicYearId).toBe(CURRENT_YEAR);
    expect(mockExamCreate).toHaveBeenCalledTimes(1);
    // The newly-created schedule entry's own generated id (uuidv4) is what
    // gets linked — not a literal, since _resolveScheduleLink creates it.
    expect(mockExamCreate.mock.calls[0][0].scheduleEntryId).toBe(update.$setOnInsert.id);
  });

  test('an existing schedule entry for this type/term/year is reused, not duplicated', async () => {
    mockScheduleDocs = [{ id: 'sched_existing', schoolId: SCHOOL, termNumber: 1, assessmentType: 'MT', instance: 1, academicYearId: CURRENT_YEAR }];
    const res = await supertest(buildApp()).post('/api/exams').send(BASE_EXAM);
    expect(res.status).toBe(201);
    expect(mockScheduleFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockExamCreate.mock.calls[0][0].scheduleEntryId).toBe('sched_existing');
  });

  test('an existing legacy null-tagged schedule entry for this type/term is adopted instead of creating a duplicate', async () => {
    mockScheduleDocs = [{ id: 'sched_legacy', schoolId: SCHOOL, termNumber: 1, assessmentType: 'MT', instance: 1, academicYearId: null }];
    const res = await supertest(buildApp()).post('/api/exams').send(BASE_EXAM);
    expect(res.status).toBe(201);
    expect(mockScheduleFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockExamCreate.mock.calls[0][0].scheduleEntryId).toBe('sched_legacy');
  });

  test('an explicit scheduleEntryId in the request is trusted as-is (the /announce path)', async () => {
    const res = await supertest(buildApp()).post('/api/exams').send({ ...BASE_EXAM, scheduleEntryId: 'sched_from_announce' });
    expect(res.status).toBe(201);
    expect(mockScheduleFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockExamCreate.mock.calls[0][0].scheduleEntryId).toBe('sched_from_announce');
  });

  test('no assessmentType at all — nothing to link, scheduleEntryId stays null (scheduling-only exams unaffected)', async () => {
    const res = await supertest(buildApp()).post('/api/exams').send({ title: 'Field trip', maxScore: 100 });
    expect(res.status).toBe(201);
    expect(mockScheduleFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockExamCreate.mock.calls[0][0].scheduleEntryId).toBeNull();
  });
});
