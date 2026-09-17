/* ============================================================
   PUT/DELETE /api/academic-config/years/:id and
   POST /api/academic-config/transition-year — dual-identifier lookup.

   Real bug found live: all three routes looked a year up with
   findOne({ $or: [{ id }, { _id }] }) — Mongoose validates every field in
   a query BEFORE evaluating $or, so passing a real UUID (not a 24-hex-char
   ObjectId string) as `_id` throws a CastError regardless of whether the
   `id` branch would have matched fine on its own. Every year created
   through POST /years gets `id: uuidv4()`, so this broke editing term
   dates, deleting a draft, and activating a draft — reproduced live:
   creating a draft worked, using it afterward 500'd every time.

   The other existing test file for this router
   (academic-config-transition-behaviour-reset.test.js) mocks findOne with
   a plain-JS-equality matcher that never throws regardless of what `_id`
   looks like — exactly why it never caught this. This file's mock
   deliberately simulates the real Mongoose behavior (a thrown CastError
   for a non-ObjectId `_id` value) so it actually exercises the failure
   mode instead of testing around it.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_test';
const REAL_OID = '507f1f77bcf86cd799439011';
const UUID_ID  = '2fc332ad-33ba-48e9-9d36-1429622aef6e'; // shape POST /years actually produces

function isValidObjectIdShape(v) {
  return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
}

/** Mirrors real Mongoose: querying `_id` with a non-ObjectId-shaped value
 *  throws synchronously (well, the driver call rejects) before any $or
 *  alternative is even considered. */
function mockChainObj(obj) {
  return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) };
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matchesFilter(doc, sub));
    if (k === '_id' && !isValidObjectIdShape(v)) {
      throw new Error(`Cast to ObjectId failed for value "${v}" at path "_id"`);
    }
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    updateOne:  jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
    updateMany: jest.fn(() => Promise.resolve({ modifiedCount: 0 })),
    deleteOne:  jest.fn((filter) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx !== -1) docs.splice(idx, 1);
      return Promise.resolve({ deletedCount: idx !== -1 ? 1 : 0 });
    }),
    create: jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
  };
}

const mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const mockEmptyCollection = { findOne: () => mockChainObj(null), findOneAndUpdate: () => mockChainObj(null), updateOne: () => Promise.resolve({}) };
let mockStores;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => mockStores[c] ?? mockEmptyCollection),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((c) => mockStores[c] ?? mockEmptyCollection),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser?.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');
const academicConfigRouter = require('../../routes/academic-config');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/academic-config', academicConfigRouter);
  return app;
}

function seedYear(overrides = {}) {
  return {
    id: UUID_ID, schoolId: SCHOOL, name: '2029-2030',
    startDate: '2029-09-01', endDate: '2030-07-31',
    isCurrent: false, terms: [{ term: 1, label: 'Term 1', startDate: '', endDate: '' }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    academic_years:  makeFakeCollection([seedYear()]),
    academic_config: makeFakeCollection([{ schoolId: SCHOOL, archivedAcademicYears: [] }]),
    schools:         makeFakeCollection([{ id: SCHOOL, name: 'Test School' }]),
    mark_audit_log:  makeFakeCollection([]),
  };
});

describe('academic year lookups no longer break on a UUID id (real Mongoose CastError semantics)', () => {
  test('PUT /years/:id — editing term dates on a UUID-id draft succeeds', async () => {
    const res = await supertest(buildApp())
      .put(`/api/academic-config/years/${UUID_ID}`)
      .send({ terms: [{ term: 1, label: 'Term 1', startDate: '2029-09-01', endDate: '2029-12-01' }] });

    expect(res.status).toBe(200);
    expect(res.body.data.terms[0].startDate).toBe('2029-09-01');
  });

  test('DELETE /years/:id — deleting a UUID-id draft succeeds', async () => {
    const res = await supertest(buildApp()).delete(`/api/academic-config/years/${UUID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });

  test('POST /transition-year — activating a UUID-id draft succeeds', async () => {
    const res = await supertest(buildApp())
      .post('/api/academic-config/transition-year')
      .send({ targetYearId: UUID_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.activatedYear.id).toBe(UUID_ID);
  });

  test('still resolves a legacy year that only has a real ObjectId _id (no id field)', async () => {
    mockStores.academic_years = makeFakeCollection([
      { _id: REAL_OID, schoolId: SCHOOL, name: 'Legacy Year', isCurrent: false, terms: [] },
    ]);
    const res = await supertest(buildApp()).delete(`/api/academic-config/years/${REAL_OID}`);
    expect(res.status).toBe(200);
  });

  test('a genuinely nonexistent id still 404s cleanly, not 500s', async () => {
    const res = await supertest(buildApp()).delete(`/api/academic-config/years/${UUID_ID}-does-not-exist`);
    expect(res.status).toBe(404);
  });
});
