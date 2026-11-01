/* ============================================================
   POST /api/transport/assignments/bulk

   Several students of one class are put on one route together. Each gets
   their own assignment record. Everything is checked before anything is
   written, and a student already on the route is skipped, not duplicated.
   ============================================================ */
'use strict';

// Minimal aggregation-expression evaluator — only what POST /assignments/
// bulk's atomic seat-claim guard actually sends ($lt/$lte comparing a field
// reference, optionally wrapped in $ifNull/$add, against another field or
// a literal), not a general-purpose $expr implementation.
function evalExprValue(doc, v) {
  if (typeof v === 'string' && v.startsWith('$')) return doc[v.slice(1)];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('$ifNull' in v) { const [ref, def] = v.$ifNull; const val = evalExprValue(doc, ref); return val == null ? def : val; }
    if ('$add' in v) return v.$add.reduce((sum, x) => sum + evalExprValue(doc, x), 0);
  }
  return v;
}
function evalExpr(doc, expr) {
  if ('$lt'  in expr) { const [a, b] = expr.$lt;  return evalExprValue(doc, a) <  evalExprValue(doc, b); }
  if ('$lte' in expr) { const [a, b] = expr.$lte; return evalExprValue(doc, a) <= evalExprValue(doc, b); }
  return false;
}
function mockMakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const matches = (doc, filter) => Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$expr') return evalExpr(doc, v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
  const chain = (result) => ({ select: () => chain(result), lean: () => Promise.resolve(result) });
  return {
    _docs: () => docs,
    find:     (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne:  (filter) => chain(docs.find(d => matches(d, filter)) || null),
    insertMany: jest.fn(async (list) => { docs.push(...list.map(d => ({ ...d }))); return list; }),
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matches(d, filter));
      if (idx === -1) return Promise.resolve({ matchedCount: 0 });
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) docs[idx][k] = (docs[idx][k] ?? 0) + v;
      if (update.$set) Object.assign(docs[idx], update.$set);
      return Promise.resolve({ matchedCount: 1 });
    }),
  };
}

let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasPermission: () => true,
}));
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => mockStores[col] || mockMakeCollection([])),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

const express = require('express');
const supertest = require('supertest');
const transportRouter = require('../../routes/transport');

const SCHOOL = 'sch_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/transport', transportRouter);
  return app;
}

const ZONE_A = {
  id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: null,
  fares: [{ fareType: 'one_way', amount: 29000 }, { fareType: 'two_way', amount: 35600 }],
};

const STUDENTS = [
  { id: 'stu1', schoolId: SCHOOL, status: 'active', firstName: 'Amina', lastName: 'W', admissionNumber: '1001' },
  { id: 'stu2', schoolId: SCHOOL, status: 'active', firstName: 'Brian', lastName: 'O', admissionNumber: '1002' },
  { id: 'stu3', schoolId: SCHOOL, status: 'active', firstName: 'Cathy', lastName: 'M', admissionNumber: '1003' },
];

function seed({ routes = [ZONE_A], assignments = [] } = {}) {
  mockStores = {
    transport_routes: mockMakeCollection(routes),
    transport_assignments: mockMakeCollection(assignments),
    students: mockMakeCollection(STUDENTS),
  };
}

function pick(...ids) {
  return ids.map(id => {
    const s = STUDENTS.find(x => x.id === id);
    return { studentId: id, studentName: `${s.firstName} ${s.lastName}`, studentClass: 'Year 6' };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  seed();
});

describe('POST /api/transport/assignments/bulk', () => {
  test('each selected student gets their own assignment with the chosen fare', async () => {
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: pick('stu1', 'stu2') });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: 2, skipped: [] });
    const docs = mockStores.transport_assignments._docs();
    expect(docs.map(d => d.studentId).sort()).toEqual(['stu1', 'stu2']);
    expect(docs.every(d => d.fareType === 'one_way' && d.routeId === 'r_a' && d.status === 'active')).toBe(true);
    expect(new Set(docs.map(d => d.id)).size).toBe(2);
  });

  test('a student already on the route is skipped and reported, not duplicated', async () => {
    seed({ assignments: [{ id: 'old', schoolId: SCHOOL, routeId: 'r_a', studentId: 'stu1', status: 'active' }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'two_way', students: pick('stu1', 'stu3') });
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.skipped).toEqual([{ studentId: 'stu1', reason: 'already on this route' }]);
    expect(mockStores.transport_assignments._docs().filter(d => d.studentId === 'stu1')).toHaveLength(1);
  });

  test('the same student listed twice is saved once', async () => {
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: [...pick('stu2'), ...pick('stu2')] });
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.skipped[0].reason).toMatch(/more than once/);
  });

  test('a route with no fare of the chosen type is refused before anything is written', async () => {
    seed({ routes: [{ ...ZONE_A, fares: [{ fareType: 'one_way', amount: 29000 }] }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'two_way', students: pick('stu1') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no two-way fare/);
    expect(mockStores.transport_assignments.insertMany).not.toHaveBeenCalled();
  });

  test('a route without enough seats is refused and nothing is written', async () => {
    seed({ routes: [{ ...ZONE_A, capacity: 2 }], assignments: [{ id: 'old', schoolId: SCHOOL, routeId: 'r_a', studentId: 'stuX', status: 'active' }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: pick('stu1', 'stu2') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only 1 seat left/);
    expect(mockStores.transport_assignments.insertMany).not.toHaveBeenCalled();
  });

  // Race-condition guard: the atomic occupied/capacity claim is the real
  // gate; the active.length-based check above it is only a fast pre-check
  // for a friendly message in the common case. These exercise the claim
  // itself, not the pre-check.
  test('the atomic claim blocks even when the active.length pre-check alone would have allowed it (simulates a concurrent claim already landed)', async () => {
    // occupied=2/capacity=2 (already full per the authoritative counter)
    // but zero active transport_assignments are seeded — standing in for
    // another request's bulk-assign that already claimed both seats via
    // the atomic $inc, whose insertMany this snapshot can't see yet. The
    // old countDocuments()-only check would have said "2 seats free" and
    // let this request through too, double-booking the route.
    seed({ routes: [{ ...ZONE_A, capacity: 2, occupied: 2 }], assignments: [] });
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: pick('stu1') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only 0 seats left/);
    expect(mockStores.transport_assignments.insertMany).not.toHaveBeenCalled();
  });

  test('a successful bulk assign increments occupied by exactly the number created', async () => {
    seed({ routes: [{ ...ZONE_A, capacity: 5, occupied: 0 }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: pick('stu1', 'stu2') });
    expect(res.status).toBe(200);
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(2);
  });

  test('an insertMany failure after the claim gives all claimed seats back', async () => {
    seed({ routes: [{ ...ZONE_A, capacity: 5, occupied: 0 }] });
    mockStores.transport_assignments.insertMany.mockImplementationOnce(() => Promise.reject(new Error('write failed')));
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: pick('stu1', 'stu2') });
    expect(res.status).toBe(500);
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(0); // compensated back, not left inflated
  });

  test('a student who is not an active student of this school is refused', async () => {
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', fareType: 'one_way', students: [{ studentId: 'ghost' }] });
    expect(res.status).toBe(422);
    expect(res.body.error.issues[0].message).toMatch(/ghost/);
    expect(mockStores.transport_assignments.insertMany).not.toHaveBeenCalled();
  });

  test('a fare type is required', async () => {
    const res = await supertest(buildApp()).post('/api/transport/assignments/bulk')
      .send({ routeId: 'r_a', students: pick('stu1') });
    expect(res.status).toBe(422);
  });
});
