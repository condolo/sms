/* ============================================================
   Resources config (category catalogue) — server/routes/resources.js

   GET/PUT /api/resources/config: school-configurable category list,
   same singleton pattern as finance.js's fee_config and
   library.js's library_config. Write is gated to FULL_ACCESS_ROLES
   (not the generic rbac('resources','update') permission, since a
   regular teacher can update THEIR OWN shared resource but shouldn't
   be able to edit the school-wide category catalogue).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
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

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'resources_config') return mockConfig;
    return { find: jest.fn(() => mockChainObj([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const resourcesRouter = require('../../routes/resources');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/resources', resourcesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockConfig = makeConfigStore(null);
});

test('GET /config with no saved doc returns the documented defaults', async () => {
  const res = await supertest(buildApp()).get('/api/resources/config');
  expect(res.status).toBe(200);
  expect(res.body.data.categories.map(c => c.key)).toEqual(['forms', 'past_papers', 'policy', 'guide', 'other']);
});

test('PUT persists a custom category list, scoped to the school', async () => {
  const res = await supertest(buildApp()).put('/api/resources/config').send({
    categories: [{ key: 'timetables', label: 'Timetables' }],
  });
  expect(res.status).toBe(200);
  expect(res.body.data.categories).toEqual([{ key: 'timetables', label: 'Timetables' }]);
  const [filter] = mockConfig.findOneAndUpdate.mock.calls[0];
  expect(filter.schoolId).toBe(SCHOOL_A);
});

test('PUT rejects duplicate category keys', async () => {
  const res = await supertest(buildApp()).put('/api/resources/config').send({
    categories: [{ key: 'forms', label: 'Forms' }, { key: 'forms', label: 'Forms 2' }],
  });
  expect(res.status).toBe(400);
  expect(mockConfig.findOneAndUpdate).not.toHaveBeenCalled();
});

test('PUT is forbidden for a teacher, even though teachers can update their own resources', async () => {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  const res = await supertest(buildApp()).put('/api/resources/config').send({
    categories: [{ key: 'timetables', label: 'Timetables' }],
  });
  expect(res.status).toBe(403);
  expect(mockConfig.findOneAndUpdate).not.toHaveBeenCalled();
});
