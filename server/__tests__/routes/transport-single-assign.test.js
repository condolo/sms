/* ============================================================
   POST /api/transport/assignments — single-student assign

   Had zero test coverage before this file (only .../bulk and RBAC were
   covered). Written alongside the fix for a real race condition: capacity
   used to be checked via a plain countDocuments() read, then the
   assignment was created unconditionally — two concurrent assigns for a
   route's last seat could both pass the check and both succeed, silently
   overfilling it. Now a seat is claimed atomically on `transport_routes`
   FIRST (occupied < capacity via $expr), and the assignment is only
   created once that claim's result confirms it actually matched.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

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
    return doc[k] === v;
  });
  const chain = (result) => ({ select: () => chain(result), lean: () => Promise.resolve(result) });
  return {
    _docs: () => docs,
    find:     (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne:  (filter) => chain(docs.find(d => matches(d, filter)) || null),
    create:   jest.fn((doc) => { const d = { ...doc }; docs.push(d); return Promise.resolve(d); }),
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matches(d, filter));
      if (idx === -1) return Promise.resolve({ matchedCount: 0 });
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) docs[idx][k] = (docs[idx][k] ?? 0) + v;
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

const express   = require('express');
const supertest = require('supertest');
const transportRouter = require('../../routes/transport');

const SCHOOL = 'sch_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/transport', transportRouter);
  return app;
}

function seed({ routes, assignments = [] }) {
  mockStores = {
    transport_routes:      mockMakeCollection(routes),
    transport_assignments: mockMakeCollection(assignments),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
});

const body = (overrides = {}) => ({
  routeId: 'r_a', studentId: 'stu1', fareType: 'one_way', ...overrides,
});

describe('POST /api/transport/assignments', () => {
  test('assigns a student when the route has no capacity set (unlimited), and still tracks occupied', async () => {
    seed({ routes: [{ id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: null, occupied: 0 }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments').send(body());
    expect(res.status).toBe(201);
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(1);
  });

  test('assigns a student when a seat is available', async () => {
    seed({ routes: [{ id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: 2, occupied: 0 }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments').send(body());
    expect(res.status).toBe(201);
    expect(res.body.data.studentId).toBe('stu1');
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(1);
  });

  test('refuses when the route is already at capacity, and nothing is written', async () => {
    seed({ routes: [{ id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: 1, occupied: 1 }] });
    const res = await supertest(buildApp()).post('/api/transport/assignments').send(body());
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/full capacity/);
    expect(mockStores.transport_assignments.create).not.toHaveBeenCalled();
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(1); // unchanged
  });

  test('race: two assigns for the last seat — the second is rejected, occupied never exceeds capacity', async () => {
    seed({ routes: [{ id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: 1, occupied: 0 }] });

    const first = await supertest(buildApp()).post('/api/transport/assignments').send(body({ studentId: 'stu1' }));
    expect(first.status).toBe(201);

    const second = await supertest(buildApp()).post('/api/transport/assignments').send(body({ studentId: 'stu2' }));
    expect(second.status).toBe(400);

    expect(mockStores.transport_routes._docs()[0].occupied).toBe(1); // not 2
    expect(mockStores.transport_assignments._docs().filter(a => a.status === 'active')).toHaveLength(1);
  });

  test('a student already actively assigned to the route is refused before any seat is claimed', async () => {
    seed({
      routes: [{ id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: 5, occupied: 1 }],
      assignments: [{ id: 'old', schoolId: SCHOOL, routeId: 'r_a', studentId: 'stu1', status: 'active' }],
    });
    const res = await supertest(buildApp()).post('/api/transport/assignments').send(body({ studentId: 'stu1' }));
    expect(res.status).toBe(409);
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(1); // unchanged — rejected before the claim
  });

  test('an assignment-write failure after the claim gives the seat back', async () => {
    seed({ routes: [{ id: 'r_a', schoolId: SCHOOL, name: 'Zone A', capacity: 2, occupied: 0 }] });
    mockStores.transport_assignments.create.mockImplementationOnce(() => Promise.reject(new Error('write failed')));
    const res = await supertest(buildApp()).post('/api/transport/assignments').send(body());
    expect(res.status).toBe(500);
    expect(mockStores.transport_routes._docs()[0].occupied).toBe(0); // compensated back
  });

  test('assigning to an unknown route is rejected', async () => {
    seed({ routes: [] });
    const res = await supertest(buildApp()).post('/api/transport/assignments').send(body());
    expect(res.status).toBe(404);
  });
});
