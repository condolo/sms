/* ============================================================
   server/routes/subjects.js

   Reported directly (2026-10-14): a deleted subject is soft-deleted
   (isActive:false), vanishes from GET / with no way to find it again,
   yet its code permanently blocked creating or editing another subject
   to use that same code — the uniqueness checks in POST/PUT never
   scoped to active-only. Fixed by scoping those checks to active
   subjects, adding ?includeInactive=true to GET / so a deactivated
   subject is traceable again, and a dedicated reactivate route.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

function mockChain(result) {
  return { lean: () => Promise.resolve(result), select: () => mockChain(result), sort: () => mockChain(result), limit: () => mockChain(result) };
}
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) return (doc[k] !== undefined) === v.$exists;
    }
    return doc[k] === v;
  });
}
let mockStores;
function mockCollFor(col) {
  const docs = () => mockStores[col] || (mockStores[col] = []);
  return {
    find:    (filter) => mockChain(docs().filter(d => matches(d, filter))),
    findOne: (filter) => mockChain(docs().find(d => matches(d, filter)) ?? null),
    create:  async (doc) => { const d = { ...doc }; docs().push(d); return { ...d, toObject: () => d }; },
    findOneAndUpdate: (filter, update) => {
      const d = docs().find(x => matches(x, filter));
      if (!d) return { then: (res) => res(null) };
      Object.assign(d, update);
      return { then: (res) => res({ ...d, toObject: () => d }) };
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (col) => mockCollFor(col),
}));

const express   = require('express');
const supertest = require('supertest');
const subjectsRouter = require('../../routes/subjects');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/subjects', subjectsRouter);
  return app;
}

beforeEach(() => {
  mockStores = {
    departments: [{ id: 'dep_1', schoolId: SCHOOL, name: 'Sciences' }],
    subjects: [],
  };
});

describe('GET /api/subjects — inactive subjects hidden by default, visible with ?includeInactive=true', () => {
  test('a deactivated subject is excluded from the default list', async () => {
    mockStores.subjects = [
      { id: 'sub_1', schoolId: SCHOOL, name: 'Biology', code: 'BIO', departmentId: 'dep_1', isActive: true },
      { id: 'sub_2', schoolId: SCHOOL, name: 'Old Subject', code: 'OLD', departmentId: 'dep_1', isActive: false },
    ];
    const res = await supertest(buildApp()).get('/api/subjects');
    expect(res.body.data.map(s => s.id)).toEqual(['sub_1']);
  });

  test('?includeInactive=true returns both, making the deactivated one traceable again', async () => {
    mockStores.subjects = [
      { id: 'sub_1', schoolId: SCHOOL, name: 'Biology', code: 'BIO', departmentId: 'dep_1', isActive: true },
      { id: 'sub_2', schoolId: SCHOOL, name: 'Old Subject', code: 'OLD', departmentId: 'dep_1', isActive: false },
    ];
    const res = await supertest(buildApp()).get('/api/subjects?includeInactive=true');
    expect(res.body.data.map(s => s.id).sort()).toEqual(['sub_1', 'sub_2']);
  });
});

describe('POST /api/subjects — code uniqueness scoped to active subjects only', () => {
  test('a code held only by a deactivated subject can be reused', async () => {
    mockStores.subjects = [
      { id: 'sub_old', schoolId: SCHOOL, name: 'Old Subject', code: 'OLD', departmentId: 'dep_1', isActive: false },
    ];
    const res = await supertest(buildApp()).post('/api/subjects').send({ name: 'New Subject', code: 'OLD', departmentId: 'dep_1' });
    expect(res.status).toBe(201);
  });

  test('a code held by an ACTIVE subject is still refused', async () => {
    mockStores.subjects = [
      { id: 'sub_1', schoolId: SCHOOL, name: 'Biology', code: 'BIO', departmentId: 'dep_1', isActive: true },
    ];
    const res = await supertest(buildApp()).post('/api/subjects').send({ name: 'Biology II', code: 'BIO', departmentId: 'dep_1' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/subjects/:id — same active-only code scoping', () => {
  test('editing a subject to take a code held only by a deactivated subject succeeds', async () => {
    mockStores.subjects = [
      { id: 'sub_1', schoolId: SCHOOL, name: 'Biology', code: 'BIO', departmentId: 'dep_1', isActive: true },
      { id: 'sub_old', schoolId: SCHOOL, name: 'Old Subject', code: 'OLD', departmentId: 'dep_1', isActive: false },
    ];
    const res = await supertest(buildApp()).put('/api/subjects/sub_1').send({ name: 'Biology', code: 'OLD', departmentId: 'dep_1' });
    expect(res.status).toBe(200);
  });

  test('editing to a code held by another ACTIVE subject is still refused', async () => {
    mockStores.subjects = [
      { id: 'sub_1', schoolId: SCHOOL, name: 'Biology', code: 'BIO', departmentId: 'dep_1', isActive: true },
      { id: 'sub_2', schoolId: SCHOOL, name: 'Chemistry', code: 'CHEM', departmentId: 'dep_1', isActive: true },
    ];
    const res = await supertest(buildApp()).put('/api/subjects/sub_1').send({ name: 'Biology', code: 'CHEM', departmentId: 'dep_1' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/subjects/:id/reactivate', () => {
  test('reactivates a deactivated subject', async () => {
    mockStores.subjects = [
      { id: 'sub_old', schoolId: SCHOOL, name: 'Old Subject', code: 'OLD', departmentId: 'dep_1', isActive: false },
    ];
    const res = await supertest(buildApp()).patch('/api/subjects/sub_old/reactivate');
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
  });

  test('refuses to reactivate if another active subject has since taken its code', async () => {
    mockStores.subjects = [
      { id: 'sub_old', schoolId: SCHOOL, name: 'Old Subject', code: 'OLD', departmentId: 'dep_1', isActive: false },
      { id: 'sub_new', schoolId: SCHOOL, name: 'New Subject', code: 'OLD', departmentId: 'dep_1', isActive: true },
    ];
    const res = await supertest(buildApp()).patch('/api/subjects/sub_old/reactivate');
    expect(res.status).toBe(409);
  });

  test('404s for a subject that does not exist', async () => {
    const res = await supertest(buildApp()).patch('/api/subjects/does_not_exist/reactivate');
    expect(res.status).toBe(404);
  });
});
