/* ============================================================
   Library config (book category catalogue) — server/routes/library.js

   GET/PUT /api/library/config: school-configurable category list,
   same singleton pattern as finance.js's fee_config. Covers defaults-
   when-unset, write gated to MANAGE_ROLES, duplicate-key rejection,
   and GET /books' classId filter.

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

let mockJwtUser = { userId: 'usr_A', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockConfig;
function makeConfigStore(seed = null) {
  let doc = seed;
  return {
    findOne: jest.fn(() => mockChainObj(doc)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const flat = update.$set ? { ...update.$set } : { ...update };
      doc = { ...(doc || {}), ...flat };
      return mockChainObj(doc);
    }),
  };
}

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (Array.isArray(doc[k])) return doc[k].includes(v);
    return doc[k] === v;
  });
}
function makeBooksStore(seed = []) {
  return {
    find:           jest.fn((filter) => mockChainArr(seed.filter(d => matchesFilter(d, filter)))),
    countDocuments: jest.fn((filter) => Promise.resolve(seed.filter(d => matchesFilter(d, filter)).length)),
  };
}
let mockBooks = makeBooksStore();

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'library_config') return mockConfig;
    if (c === 'library_books')  return mockBooks;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const libraryRouter = require('../../routes/library');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/library', libraryRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_A', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
  mockConfig = makeConfigStore(null);
  mockBooks  = makeBooksStore();
});

test('GET /config with no saved doc returns the documented defaults', async () => {
  const res = await supertest(buildApp()).get('/api/library/config');
  expect(res.status).toBe(200);
  expect(res.body.data.categories.map(c => c.key)).toEqual(['general', 'textbook', 'fiction', 'reference', 'periodical']);
});

test('PUT persists a custom category list, scoped to the school', async () => {
  const res = await supertest(buildApp()).put('/api/library/config').send({
    categories: [{ key: 'novel', label: 'Novel' }],
  });
  expect(res.status).toBe(200);
  expect(res.body.data.categories).toEqual([{ key: 'novel', label: 'Novel' }]);
  const [filter] = mockConfig.findOneAndUpdate.mock.calls[0];
  expect(filter.schoolId).toBe(SCHOOL_A);
});

test('PUT rejects duplicate category keys', async () => {
  const res = await supertest(buildApp()).put('/api/library/config').send({
    categories: [{ key: 'novel', label: 'Novel' }, { key: 'novel', label: 'Novels' }],
  });
  expect(res.status).toBe(400);
  expect(mockConfig.findOneAndUpdate).not.toHaveBeenCalled();
});

test('PUT is forbidden for a non-manage role (e.g. teacher)', async () => {
  mockJwtUser = { userId: 'usr_T', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).put('/api/library/config').send({
    categories: [{ key: 'novel', label: 'Novel' }],
  });
  expect(res.status).toBe(403);
  expect(mockConfig.findOneAndUpdate).not.toHaveBeenCalled();
});

test('GET /books?classId= filters to books tagged with that class — record-keeping only, not a restriction', async () => {
  mockBooks = makeBooksStore([
    { id: 'b1', schoolId: SCHOOL_A, title: 'Science Textbook Year 7', classIds: ['cls_y7'] },
    { id: 'b2', schoolId: SCHOOL_A, title: 'General Fiction', classIds: [] },
  ]);
  const res = await supertest(buildApp()).get('/api/library/books?classId=cls_y7');
  expect(res.status).toBe(200);
  expect(res.body.data.map(b => b.id)).toEqual(['b1']);
});
