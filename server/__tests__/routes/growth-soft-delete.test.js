/* ============================================================
   Growth Profile soft-delete consistency fix (Governance Spec §2)

   growth-records.js (leadership/activities/service/awards),
   growth-projects.js, and growth-recommendations.js previously hard
   deleted via findOneAndDelete. All three now soft-delete
   (deletedAt/deletedBy), matching behaviour_incidents' existing
   pattern — permanence is a stated guarantee, not an accident.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), skip: () => chain(result), limit: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    findOneAndUpdate: (filter, update, opts = {}) => ({
      lean: async () => {
        const doc = docs.find(d => matches(d, filter));
        if (!doc) return null;
        Object.assign(doc, update.$set ?? update);
        return { ...doc };
      },
    }),
    findOneAndDelete: async (filter) => {
      const idx = docs.findIndex(d => matches(d, filter));
      if (idx === -1) return null;
      const [removed] = docs.splice(idx, 1);
      return removed;
    },
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const express   = require('express');
const supertest = require('supertest');
const growthRecordsRouter        = require('../../routes/growth-records');
const growthProjectsRouter       = require('../../routes/growth-projects');
const growthRecommendationsRouter = require('../../routes/growth-recommendations');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/growth-records', growthRecordsRouter);
  app.use('/api/growth-projects', growthProjectsRouter);
  app.use('/api/growth-recommendations', growthRecommendationsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
  mockStores = {
    growth_leadership:       makeStore([{ id: 'gl_1', schoolId: SCHOOL, studentId: 'stu_1', title: 'Head Boy' }]),
    growth_projects:         makeStore([{ id: 'gp_1', schoolId: SCHOOL, studentId: 'stu_1', title: 'Science Fair' }]),
    growth_recommendations:  makeStore([{ id: 'gr_1', schoolId: SCHOOL, studentId: 'stu_1', content: 'A fine student indeed.', authorId: 'u_admin', createdBy: 'u_admin' }]),
  };
});

describe('growth-records.js DELETE (leadership/activities/service/awards)', () => {
  test('soft-deletes: doc stays in the store with deletedAt/deletedBy, not removed', async () => {
    const app = buildApp();
    const res = await supertest(app).delete('/api/growth-records/leadership/gl_1');
    expect(res.status).toBe(200);
    const doc = mockStores.growth_leadership._docs().find(d => d.id === 'gl_1');
    expect(doc).toBeDefined(); // still exists — never hard-deleted
    expect(doc.deletedAt).toBeTruthy();
    expect(doc.deletedBy).toBe('u_admin');
  });

  test('a soft-deleted record disappears from the list and single-get views', async () => {
    const app = buildApp();
    await supertest(app).delete('/api/growth-records/leadership/gl_1');

    const listRes = await supertest(app).get('/api/growth-records/leadership');
    expect(listRes.body.data.map(d => d.id)).not.toContain('gl_1');

    const getRes = await supertest(app).get('/api/growth-records/leadership/gl_1');
    expect(getRes.status).toBe(404);
  });

  test('a soft-deleted record cannot be re-edited via PUT', async () => {
    const app = buildApp();
    await supertest(app).delete('/api/growth-records/leadership/gl_1');
    const res = await supertest(app).put('/api/growth-records/leadership/gl_1').send({ title: 'Updated' });
    expect(res.status).toBe(404);
  });
});

describe('growth-projects.js DELETE', () => {
  test('soft-deletes: doc retained, excluded from list', async () => {
    const app = buildApp();
    const res = await supertest(app).delete('/api/growth-projects/gp_1');
    expect(res.status).toBe(200);
    const doc = mockStores.growth_projects._docs().find(d => d.id === 'gp_1');
    expect(doc.deletedAt).toBeTruthy();

    const listRes = await supertest(app).get('/api/growth-projects');
    expect(listRes.body.data.map(d => d.id)).not.toContain('gp_1');
  });
});

describe('growth-recommendations.js DELETE', () => {
  test('soft-deletes and preserves the existing author/admin permission check', async () => {
    const app = buildApp();
    const res = await supertest(app).delete('/api/growth-recommendations/gr_1');
    expect(res.status).toBe(200);
    const doc = mockStores.growth_recommendations._docs().find(d => d.id === 'gr_1');
    expect(doc.deletedAt).toBeTruthy();

    const listRes = await supertest(app).get('/api/growth-recommendations');
    expect(listRes.body.data.map(d => d.id)).not.toContain('gr_1');
  });

  test('a non-author, non-admin still cannot delete', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_other_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const res = await supertest(app).delete('/api/growth-recommendations/gr_1');
    expect(res.status).toBe(403);
    expect(mockStores.growth_recommendations._docs().find(d => d.id === 'gr_1').deletedAt).toBeUndefined();
  });
});
