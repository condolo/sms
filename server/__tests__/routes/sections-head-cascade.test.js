/* ============================================================
   server/routes/sections.js PUT/POST — Section Head cascade

   sectionHeadId used to be a pure display label ("Head: Mrs X" next
   to the section) with zero effect on access — real section-scoped
   visibility needs the person's OWN user record to have BOTH
   role: 'section_head' AND sectionAssigned: <this section's key>,
   and nothing ever set the latter (confirmed: no client code anywhere
   sends sectionAssigned). Reported directly: an admin describing how
   Section Heads (KS1-KS4) SHOULD work, traced to find the assignment
   UI existed but never actually granted access.

   Fix (confirmed direction via AskUserQuestion): assigning a Section
   Head now auto-cascades sectionAssigned onto that person — safe on
   its own since it's inert unless their role is ALSO section_head.
   The role itself is deliberately NOT touched here (same "no silent
   role changes" precedent as the staffType/extraRoles fixes) — a
   warning is returned instead when the assigned person's role isn't
   actually section_head yet.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs:            () => docs,
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      docs[idx] = { ...docs[idx], ...update };
      return mockChainObj(docs[idx]);
    }),
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve({ matchedCount: 0 });
      Object.assign(docs[idx], update.$set ?? update);
      return Promise.resolve({ matchedCount: 1 });
    }),
  };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

const mockInvalidateScopeCache = jest.fn();
jest.mock('../../middleware/scopeMiddleware', () => ({
  invalidateScopeCache: (...args) => mockInvalidateScopeCache(...args),
}));

let mockSections, mockTeachers, mockUsers;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'sections') return mockSections;
    if (c === 'teachers') return mockTeachers;
    if (c === 'users')    return mockUsers;
    return { findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection, ctx) => {
    const _model = require('../../utils/model')._model;
    return _model(collection, ctx);
  },
}));

const express = require('express');
const supertest = require('supertest');
const sectionsRouter = require('../../routes/sections');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sections', sectionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSections = makeFakeCollection([
    { id: 'sec_ks3', schoolId: SCHOOL_A, key: 'ks3', name: 'KS3', color: '#3b82f6', order: 3, sectionHeadId: null },
  ]);
  mockTeachers = makeFakeCollection([
    { id: 'tch_new_head', schoolId: SCHOOL_A, userId: 'usr_new_head' },
    { id: 'tch_old_head', schoolId: SCHOOL_A, userId: 'usr_old_head' },
    { id: 'tch_no_login', schoolId: SCHOOL_A },        // never linked to a login account
  ]);
  mockUsers = makeFakeCollection([
    { id: 'usr_new_head', schoolId: SCHOOL_A, role: 'teacher',      sectionAssigned: null },
    { id: 'usr_old_head', schoolId: SCHOOL_A, role: 'section_head', sectionAssigned: 'ks3' },
  ]);
});

test('assigning a Section Head sets their sectionAssigned to this section\'s key', async () => {
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ sectionHeadId: 'tch_new_head' });

  expect(res.status).toBe(200);
  const user = mockUsers._docs().find(u => u.id === 'usr_new_head');
  expect(user.sectionAssigned).toBe('ks3');
  expect(mockInvalidateScopeCache).toHaveBeenCalledWith('usr_new_head', SCHOOL_A);
});

test('their role is never touched by this — a warning is returned instead when it isn\'t section_head', async () => {
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ sectionHeadId: 'tch_new_head' });

  expect(res.status).toBe(200);
  const user = mockUsers._docs().find(u => u.id === 'usr_new_head');
  expect(user.role).toBe('teacher'); // untouched
  expect(res.body.data.headWarning).toMatch(/not Section Head/i);
});

test('no warning when the assigned person already holds the section_head role', async () => {
  mockUsers = makeFakeCollection([
    { id: 'usr_new_head', schoolId: SCHOOL_A, role: 'section_head', sectionAssigned: null },
  ]);
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ sectionHeadId: 'tch_new_head' });

  expect(res.status).toBe(200);
  expect(res.body.data.headWarning).toBeUndefined();
});

test('reassigning the head clears sectionAssigned from the outgoing head', async () => {
  mockSections = makeFakeCollection([
    { id: 'sec_ks3', schoolId: SCHOOL_A, key: 'ks3', name: 'KS3', color: '#3b82f6', order: 3, sectionHeadId: 'tch_old_head' },
  ]);
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ sectionHeadId: 'tch_new_head' });

  expect(res.status).toBe(200);
  const oldUser = mockUsers._docs().find(u => u.id === 'usr_old_head');
  expect(oldUser.sectionAssigned).toBeNull();
  const newUser = mockUsers._docs().find(u => u.id === 'usr_new_head');
  expect(newUser.sectionAssigned).toBe('ks3');
});

test('clearing the head (set to null) also clears the outgoing head\'s sectionAssigned', async () => {
  mockSections = makeFakeCollection([
    { id: 'sec_ks3', schoolId: SCHOOL_A, key: 'ks3', name: 'KS3', color: '#3b82f6', order: 3, sectionHeadId: 'tch_old_head' },
  ]);
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ sectionHeadId: null });

  expect(res.status).toBe(200);
  const oldUser = mockUsers._docs().find(u => u.id === 'usr_old_head');
  expect(oldUser.sectionAssigned).toBeNull();
});

test('does NOT clobber an outgoing head\'s sectionAssigned if it no longer points at this section', async () => {
  mockSections = makeFakeCollection([
    { id: 'sec_ks3', schoolId: SCHOOL_A, key: 'ks3', name: 'KS3', color: '#3b82f6', order: 3, sectionHeadId: 'tch_old_head' },
  ]);
  // usr_old_head has already been reassigned to a DIFFERENT section by a
  // separate edit — this section's own cascade must not clobber that.
  mockUsers = makeFakeCollection([
    { id: 'usr_old_head', schoolId: SCHOOL_A, role: 'section_head', sectionAssigned: 'ks4' },
    { id: 'usr_new_head', schoolId: SCHOOL_A, role: 'teacher',      sectionAssigned: null },
  ]);
  await supertest(buildApp()).put('/api/sections/sec_ks3').send({ sectionHeadId: 'tch_new_head' });

  const oldUser = mockUsers._docs().find(u => u.id === 'usr_old_head');
  expect(oldUser.sectionAssigned).toBe('ks4'); // untouched
});

test('assigning a teacher with no linked login account returns a clear warning, does not crash', async () => {
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ sectionHeadId: 'tch_no_login' });

  expect(res.status).toBe(200);
  expect(res.body.data.headWarning).toMatch(/no login account/i);
});

test('leaving sectionHeadId untouched in an unrelated edit does not run the cascade at all', async () => {
  mockSections = makeFakeCollection([
    { id: 'sec_ks3', schoolId: SCHOOL_A, key: 'ks3', name: 'KS3', color: '#3b82f6', order: 3, sectionHeadId: 'tch_old_head' },
  ]);
  const res = await supertest(buildApp())
    .put('/api/sections/sec_ks3')
    .send({ color: '#ff0000' }); // no sectionHeadId in the body at all

  expect(res.status).toBe(200);
  expect(mockInvalidateScopeCache).not.toHaveBeenCalled();
  const oldUser = mockUsers._docs().find(u => u.id === 'usr_old_head');
  expect(oldUser.sectionAssigned).toBe('ks3'); // untouched
});
