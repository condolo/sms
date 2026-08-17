/* ============================================================
   Cross-tenant isolation regression — server/routes/attendance.js
   (C4 · ADR-0001 §5 — the backstop the wrapper's residual gaps rely on)

   This is the reference pattern for the cross-tenant regression suite.
   It authenticates as School A and asserts that EVERY query reaching the
   data layer is scoped to School A's schoolId — for reads, writes, the
   aggregate, and the bulk path. Because attendance.js goes through
   tenantModel(), the scoping is structural: even a handler that forgot
   to add schoolId to its filter could not leak, since tenantModel
   injects it. These tests would fail the moment a query escaped that
   scoping.

   All DB calls are mocked — no MongoDB required.
   Run: npm test
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), isClassInScope: jest.fn(() => true) }));

/* Spy attendance model — records every filter/pipeline/op it receives.
   tenantModel() calls _model('attendance') under the hood, so these
   spies see exactly what the data layer would run. */
const seen = { find: [], countDocuments: [], aggregate: [], findOne: [], findOneAndUpdate: [], findOneAndDelete: [], bulkWrite: [] };

/* A chainable that supports .sort().skip().limit().select().lean() and
   resolves to `result` — matches how the handlers build their queries. */
function chain(result) {
  const c = {
    sort:   () => c,
    skip:   () => c,
    limit:  () => c,
    select: () => c,
    lean:   () => Promise.resolve(result),
  };
  return c;
}

// findOne's default resolves the fixture 'att_1' (schoolId: school_A,
// classId: c1) when asked for it under a School-A-scoped filter — anything
// else (e.g. 'att_belonging_to_B') resolves null, exactly as tenantModel's
// structural schoolId injection would produce in production: a query for
// another school's record, once scoped to school_A, simply matches nothing.
let mockFindOneResult = { id: 'att_1', schoolId: 'school_A', classId: 'c1' };
const mockAttendanceModel = {
  find:             jest.fn((filter) => { seen.find.push(filter); return chain([]); }),
  countDocuments:   jest.fn((filter) => { seen.countDocuments.push(filter); return Promise.resolve(0); }),
  aggregate:        jest.fn((pipeline) => { seen.aggregate.push(pipeline); return Promise.resolve([]); }),
  findOne:          jest.fn((filter) => {
    seen.findOne.push(filter);
    return chain(filter.id === mockFindOneResult?.id ? mockFindOneResult : null);
  }),
  findOneAndUpdate: jest.fn((filter, update) => { seen.findOneAndUpdate.push({ filter, update }); return chain({ id: 'att_1', schoolId: 'school_A' }); }),
  findOneAndDelete: jest.fn((filter) => { seen.findOneAndDelete.push(filter); return Promise.resolve(mockFindOneResult); }),
  bulkWrite:        jest.fn((ops) => { seen.bulkWrite.push(ops); return Promise.resolve({ upsertedCount: 1, modifiedCount: 0 }); }),
};

jest.mock('../../utils/model', () => ({ _model: jest.fn(() => mockAttendanceModel) }));

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRouter);
  return app;
}

/* Every schoolId a query carries must be School A's — never absent, never another school. */
function assertScopedToA(filterOrMatch) {
  expect(filterOrMatch).toBeDefined();
  expect(filterOrMatch.schoolId).toBe(SCHOOL_A);
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(seen)) seen[k] = [];
  mockFindOneResult = { id: 'att_1', schoolId: 'school_A', classId: 'c1' };
});

describe('attendance — cross-tenant isolation (authenticated as School A)', () => {
  test('GET / list scopes both the find and the count to School A', async () => {
    await supertest(buildApp()).get('/api/attendance?studentId=s1&classId=c1');
    expect(seen.find).toHaveLength(1);
    assertScopedToA(seen.find[0]);
    assertScopedToA(seen.countDocuments[0]);
    // client-supplied filters are honored WITHIN the tenant, never widen it
    expect(seen.find[0].studentId).toBe('s1');
  });

  test('GET /summary prepends a $match on School A as the first aggregate stage', async () => {
    await supertest(buildApp()).get('/api/attendance/summary?classId=c1');
    expect(seen.aggregate).toHaveLength(1);
    const pipeline = seen.aggregate[0];
    // tenantModel injects the tenant $match as stage 0 — the structural guarantee
    expect(pipeline[0]).toEqual({ $match: { schoolId: SCHOOL_A } });
  });

  test('GET /:id can only match a record within School A (a School B id 404s)', async () => {
    await supertest(buildApp()).get('/api/attendance/att_belonging_to_B');
    expect(seen.findOne).toHaveLength(1);
    assertScopedToA(seen.findOne[0]);
    expect(seen.findOne[0].id).toBe('att_belonging_to_B');
    // → { id: 'att_belonging_to_B', schoolId: 'school_A' } matches nothing → 404
  });

  test('POST / writes are pinned to School A (filter and persisted doc)', async () => {
    await supertest(buildApp()).post('/api/attendance').send({
      studentId: 's1', classId: 'c1', date: '2026-05-01', status: 'present',
    });
    expect(seen.findOneAndUpdate).toHaveLength(1);
    assertScopedToA(seen.findOneAndUpdate[0].filter);
    expect(seen.findOneAndUpdate[0].update.schoolId).toBe(SCHOOL_A);
  });

  test('POST /bulk scopes every upsert op to School A', async () => {
    await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'c1', date: '2026-05-01',
      records: [{ studentId: 's1', status: 'present' }, { studentId: 's2', status: 'absent' }],
    });
    expect(seen.bulkWrite).toHaveLength(1);
    for (const op of seen.bulkWrite[0]) {
      assertScopedToA(op.updateOne.filter);
      expect(op.updateOne.update.$set.schoolId).toBe(SCHOOL_A);
    }
  });

  test('DELETE /:id 404s a cross-tenant id without ever reaching findOneAndDelete', async () => {
    // The existence+scope pre-check (added alongside write-side scope
    // enforcement) now does a School-A-scoped findOne first; a record from
    // another school simply doesn't match that filter, same structural
    // guarantee as every other route here, and the mutation never fires.
    const res = await supertest(buildApp()).delete('/api/attendance/att_belonging_to_B');
    expect(res.status).toBe(404);
    expect(seen.findOne).toHaveLength(1);
    assertScopedToA(seen.findOne[0]);
    expect(seen.findOneAndDelete).toHaveLength(0);
  });

  test('DELETE /:id on a real School-A record is scoped to School A', async () => {
    const res = await supertest(buildApp()).delete('/api/attendance/att_1');
    expect(res.status).toBe(200);
    expect(seen.findOneAndDelete).toHaveLength(1);
    assertScopedToA(seen.findOneAndDelete[0]);
  });

  test('PUT /:id 404s a cross-tenant id without ever reaching findOneAndUpdate', async () => {
    const res = await supertest(buildApp()).put('/api/attendance/att_belonging_to_B').send({ status: 'absent' });
    expect(res.status).toBe(404);
    expect(seen.findOne).toHaveLength(1);
    assertScopedToA(seen.findOne[0]);
    expect(seen.findOneAndUpdate).toHaveLength(0);
  });

  test('PUT /:id on a real School-A record proceeds to a School-A-scoped update', async () => {
    const res = await supertest(buildApp()).put('/api/attendance/att_1').send({ status: 'absent' });
    expect(res.status).toBe(200);
    expect(seen.findOneAndUpdate).toHaveLength(1);
    assertScopedToA(seen.findOneAndUpdate[0].filter);
  });
});
