/* ============================================================
   Cross-tenant isolation regression — server/routes/exams.js
   (C4 · ADR-0001 §5)

   Authenticated as School A, asserts every query reaching the data
   layer is scoped to School A — list, get-by-id, and the mark-entry
   path (exam lookup, existing-results read, the bulkWrite ops, and the
   previously-UNSCOPED auto-advance exams.updateOne({id}) at the end of
   POST /:id/results, which tenantModel now pins to School A).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

const seen = { examFind: [], examCount: [], examFindOne: [], examUpdateOne: [], resFind: [], resBulk: [] };

function mockChain(r) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(r) };
  return c;
}

const mockExams = {
  find:           jest.fn((f) => { seen.examFind.push(f); return mockChain([]); }),
  countDocuments: jest.fn((f) => { seen.examCount.push(f); return Promise.resolve(0); }),
  findOne:        jest.fn((f) => { seen.examFindOne.push(f); return mockChain({ id: 'exam_1', schoolId: 'school_A', status: 'in_progress', maxScore: 100, ownerId: null, academicYearId: 'ay1', classId: 'c1', subjectId: 'sub1' }); }),
  updateOne:      jest.fn((f, u) => { seen.examUpdateOne.push({ filter: f, update: u }); return Promise.resolve({}); }),
};
const mockResults = {
  find:           jest.fn((f) => { seen.resFind.push(f); return mockChain([]); }),
  countDocuments: jest.fn(() => Promise.resolve(0)),
  bulkWrite:      jest.fn((ops) => { seen.resBulk.push(ops); return Promise.resolve({ upsertedCount: 1, modifiedCount: 0 }); }),
};
const mockAudit = { create: jest.fn().mockResolvedValue({}), insertMany: jest.fn().mockResolvedValue([]) };

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'exams')          return mockExams;
    if (c === 'exam_results')   return mockResults;
    if (c === 'mark_audit_log') return mockAudit;
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const examsRouter = require('../../routes/exams');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examsRouter);
  return app;
}
function assertScopedToA(f) { expect(f).toBeDefined(); expect(f.schoolId).toBe(SCHOOL_A); }

beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(seen)) seen[k] = []; });

describe('exams — cross-tenant isolation (authenticated as School A)', () => {
  test('GET / scopes list find + count to School A', async () => {
    await supertest(buildApp()).get('/api/exams');
    assertScopedToA(seen.examFind[0]);
    assertScopedToA(seen.examCount[0]);
  });

  test('GET /:id can only match within School A (School B id 404s)', async () => {
    await supertest(buildApp()).get('/api/exams/exam_belonging_to_B');
    assertScopedToA(seen.examFindOne[0]);
    expect(seen.examFindOne[0].id).toBe('exam_belonging_to_B');
  });

  test('POST /:id/results — exam lookup, results read, bulk ops, AND the auto-advance update are all School-A-scoped', async () => {
    const res = await supertest(buildApp())
      .post('/api/exams/exam_1/results')
      .send({ results: [{ studentId: 's1', score: 80, markState: 'present' }] });
    expect(res.status).toBe(201);

    // exam ownership lookup scoped
    assertScopedToA(seen.examFindOne[0]);
    // existing-results read scoped
    assertScopedToA(seen.resFind[0]);
    // every bulk upsert op scoped
    expect(seen.resBulk[0]).toHaveLength(1);
    assertScopedToA(seen.resBulk[0][0].updateOne.filter);
    expect(seen.resBulk[0][0].updateOne.update.$set.schoolId).toBe(SCHOOL_A);
    // THE LATENT GAP: auto-advance exams.updateOne({id}) had no schoolId in source
    assertScopedToA(seen.examUpdateOne[0].filter);
    expect(seen.examUpdateOne[0].filter.id).toBe('exam_1');
  });
});
