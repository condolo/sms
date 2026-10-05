/* ============================================================
   POST /api/transport/assignments/bulk

   Several students of one class are put on one route together. Each gets
   their own assignment record. Everything is checked before anything is
   written, and a student already on the route is skipped, not duplicated.
   ============================================================ */
'use strict';

function mockMakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const matches = (doc, filter) => Object.entries(filter || {}).every(([k, v]) => {
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
