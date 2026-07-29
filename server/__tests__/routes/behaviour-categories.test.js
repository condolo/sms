/* ============================================================
   Behaviour categories — server/routes/behaviour.js

   A category is a named grouping (e.g. "Classroom & Academic") that
   holds its own list of items — each item is an individually named
   behaviour with its own points value and its own merit/demerit
   direction. Both levels are fully school-editable. GET /categories
   auto-seeds the full SAA Behaviour Point System v2 default set (8
   categories, 128 items total) the first time a school has none.

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
    if (k === '$or') return v.some(sub => matchesFilter(doc, sub));
    if (k.includes('.')) {
      const [arrKey, subKey] = k.split('.');
      const arr = doc[arrKey];
      return Array.isArray(arr) && arr.some(el => el && el[subKey] === v);
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && '$ne' in v) return doc[k] !== v.$ne;
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
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve({ matchedCount: 0 });
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return Promise.resolve({ matchedCount: 1 });
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

test('GET /categories auto-seeds the 8 default categories with all their items when a school has none', async () => {
  const res = await supertest(buildApp()).get('/api/behaviour/categories');
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBe(8);
  expect(res.body.data.map(c => c.name)).toContain('Classroom & Academic');

  const totalItems = res.body.data.reduce((sum, c) => sum + c.items.length, 0);
  expect(totalItems).toBe(128);

  // Every item got a server-assigned id and a valid direction/points shape
  for (const cat of res.body.data) {
    for (const item of cat.items) {
      expect(item.id).toBeTruthy();
      expect(['merit', 'demerit']).toContain(item.direction);
      expect(typeof item.points).toBe('number');
    }
  }

  const leadership = res.body.data.find(c => c.name === 'Leadership & Community Service');
  expect(leadership.items.length).toBeGreaterThan(0);
  expect(leadership.items.every(i => i.direction === 'merit')).toBe(true); // merit-only category
});

test('GET /categories does not reseed once categories already exist', async () => {
  mockCategories = makeFakeCollection([{
    id: 'c1', schoolId: SCHOOL_A, name: 'Custom Only', isActive: true,
    items: [{ id: 'i1', label: 'Custom item', direction: 'merit', points: 1 }],
  }]);
  const res = await supertest(buildApp()).get('/api/behaviour/categories');
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBe(1);
  expect(res.body.data[0].name).toBe('Custom Only');
});

test('GET /categories repairs a default-named category left with zero items by a pre-BPS-v2-reseed school, without touching unrelated categories', async () => {
  mockCategories = makeFakeCollection([
    // Pre-existing doc from before commit e0e4964's item-set restore —
    // the category was created, but its items array was never populated.
    { id: 'c1', schoolId: SCHOOL_A, name: 'Classroom & Academic', isActive: true, items: [] },
    // A genuinely custom category the school added on its own — must be
    // left completely untouched (no default matches this name).
    { id: 'c2', schoolId: SCHOOL_A, name: 'Custom Only', isActive: true,
      items: [{ id: 'i1', label: 'Custom item', direction: 'merit', points: 1 }] },
  ]);

  const res = await supertest(buildApp()).get('/api/behaviour/categories');
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBe(2); // no new categories inserted — only existing ones repaired

  const classroom = res.body.data.find(c => c.name === 'Classroom & Academic');
  expect(classroom.items.length).toBeGreaterThan(0);
  expect(classroom.items.every(i => i.id)).toBe(true); // fresh server-assigned ids

  const custom = res.body.data.find(c => c.name === 'Custom Only');
  expect(custom.items).toEqual([{ id: 'i1', label: 'Custom item', direction: 'merit', points: 1 }]);
});

test('GET /categories leaves a default-named category alone once it has at least one item', async () => {
  mockCategories = makeFakeCollection([
    { id: 'c1', schoolId: SCHOOL_A, name: 'Classroom & Academic', isActive: true,
      items: [{ id: 'i1', label: 'School-edited item', direction: 'merit', points: 9 }] },
  ]);

  const res = await supertest(buildApp()).get('/api/behaviour/categories');
  expect(res.status).toBe(200);
  expect(res.body.data[0].items).toEqual([{ id: 'i1', label: 'School-edited item', direction: 'merit', points: 9 }]);
});

test('GET /categories?direction=merit only returns categories containing at least one merit item', async () => {
  mockCategories = makeFakeCollection([
    {
      id: 'c1', schoolId: SCHOOL_A, name: 'Both', isActive: true,
      items: [{ id: 'i1', label: 'Good thing', direction: 'merit', points: 2 }, { id: 'i2', label: 'Bad thing', direction: 'demerit', points: 2 }],
    },
    {
      id: 'c2', schoolId: SCHOOL_A, name: 'Demerit Only', isActive: true,
      items: [{ id: 'i3', label: 'Bad thing', direction: 'demerit', points: 3 }],
    },
  ]);
  const res = await supertest(buildApp()).get('/api/behaviour/categories?direction=merit');
  expect(res.status).toBe(200);
  expect(res.body.data.map(c => c.name)).toEqual(['Both']);
});

test('POST /categories creates a category and assigns server-side ids to its items', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/categories').send({
    name: 'Uniform',
    items: [{ label: 'Full uniform all week', direction: 'merit', points: 3 }],
  });
  expect(res.status).toBe(201);
  expect(res.body.data.items).toHaveLength(1);
  expect(res.body.data.items[0].id).toBeTruthy();
  expect(res.body.data.items[0].label).toBe('Full uniform all week');
});

test('POST /categories rejects an item missing a direction', async () => {
  const res = await supertest(buildApp()).post('/api/behaviour/categories').send({
    name: 'Bad Category',
    items: [{ label: 'No direction', points: 2 }],
  });
  expect(res.status).toBe(422);
  expect(mockCategories.create).not.toHaveBeenCalled();
});

test('POST /categories rejects a duplicate name for the same school', async () => {
  mockCategories = makeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'Punctuality', isActive: true, items: [] }]);
  const res = await supertest(buildApp()).post('/api/behaviour/categories').send({ name: 'Punctuality' });
  expect(res.status).toBe(409);
});

test('PUT /categories/:id replaces the items array, keeping existing item ids and assigning new ones', async () => {
  mockCategories = makeFakeCollection([{
    id: 'c1', schoolId: SCHOOL_A, name: 'Classroom', isActive: true,
    items: [{ id: 'existing-1', label: 'Old item', direction: 'merit', points: 2 }],
  }]);
  const res = await supertest(buildApp()).put('/api/behaviour/categories/c1').send({
    items: [
      { id: 'existing-1', label: 'Old item (renamed)', direction: 'merit', points: 3 }, // edited
      { label: 'Brand new item', direction: 'demerit', points: 1 },                     // added, no id
    ],
  });
  expect(res.status).toBe(200);
  expect(res.body.data.items).toHaveLength(2);
  expect(res.body.data.items[0].id).toBe('existing-1');
  expect(res.body.data.items[0].label).toBe('Old item (renamed)');
  expect(res.body.data.items[1].id).toBeTruthy();
  expect(res.body.data.items[1].id).not.toBe('existing-1');
});

test('PUT /categories/:id can remove an item by omitting it from the array', async () => {
  mockCategories = makeFakeCollection([{
    id: 'c1', schoolId: SCHOOL_A, name: 'Classroom', isActive: true,
    items: [
      { id: 'keep-me', label: 'Kept', direction: 'merit', points: 1 },
      { id: 'drop-me', label: 'Dropped', direction: 'merit', points: 1 },
    ],
  }]);
  const res = await supertest(buildApp()).put('/api/behaviour/categories/c1').send({
    items: [{ id: 'keep-me', label: 'Kept', direction: 'merit', points: 1 }],
  });
  expect(res.status).toBe(200);
  expect(res.body.data.items).toHaveLength(1);
  expect(res.body.data.items[0].id).toBe('keep-me');
});
