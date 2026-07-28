/* ============================================================
   Behaviour categories — server/routes/behaviour.js

   Categories moved from {type, defaultPoints} (single direction,
   single value) to a flat {meritPoints, demeritPoints} shape so one
   category can support both directions independently, and a school
   fully owns add/edit/delete/repoint. GET /categories auto-seeds the
   8 default categories (collapsed from the old hardcoded BPS matrix)
   the first time a school has none.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
    }
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    insertMany:       jest.fn((newDocs) => { docs.push(...newDocs); return Promise.resolve(newDocs); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve(null);
      return Promise.resolve(docs.splice(idx, 1)[0]);
    }),
  };
}

const mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockCategories;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'behaviour_categories') return mockCategories;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const behaviourRouter = require('../../routes/behaviour');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviour', behaviourRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCategories = makeFakeCollection([]);
});

test('GET /categories auto-seeds the 8 defaults when a school has none', async () => {
  const res = await supertest(buildApp()).get('/api/behaviour/categories');
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBe(8);
  expect(res.body.data.map(c => c.name)).toContain('Classroom & Academic');
  const leadership = res.body.data.find(c => c.name === 'Leadership & Community Service');
  expect(leadership.meritPoints).toBe(5);
  expect(leadership.demeritPoints).toBeNull(); // merit-only, matches the old matrix
});

test('GET /categories does not reseed once categories already exist', async () => {
  mockCategories = makeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'Custom Only', meritPoints: 1, demeritPoints: null, isActive: true }]);
  const res = await supertest(buildApp()).get('/api/behaviour/categories');
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBe(1);
  expect(res.body.data[0].name).toBe('Custom Only');
});

test('GET /categories?direction=merit only returns categories with a meritPoints value', async () => {
  mockCategories = makeFakeCollection([
    { id: 'c1', schoolId: SCHOOL_A, name: 'Both', meritPoints: 2, demeritPoints: 2, isActive: true },
    { id: 'c2', schoolId: SCHOOL_A, name: 'Demerit Only', meritPoints: null, demeritPoints: 3, isActive: true },
  ]);
  const res = await supertest(buildApp()).get('/api/behaviour/categories?direction=merit');
  expect(res.status).toBe(200);
  expect(res.body.data.map(c => c.name)).toEqual(['Both']);
});

test('POST /categories rejects a category with neither meritPoints nor demeritPoints', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/categories').send({ name: 'Empty' });
  expect(res.status).toBe(422);
  expect(mockCategories.create).not.toHaveBeenCalled();
});

test('POST /categories accepts a demerit-only category', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/categories').send({ name: 'Uniform', demeritPoints: 1 });
  expect(res.status).toBe(201);
  expect(res.body.data.demeritPoints).toBe(1);
  expect(res.body.data.meritPoints).toBeUndefined();
});

test('POST /categories rejects a duplicate name for the same school', async () => {
  mockCategories = makeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'Punctuality', meritPoints: 1, demeritPoints: null, isActive: true }]);
  const res = await supertest(buildApp()).post('/api/behaviour/categories').send({ name: 'Punctuality', meritPoints: 2 });
  expect(res.status).toBe(409);
});
