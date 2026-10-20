/* ============================================================
   server/routes/messages.js — recipient directory, saved groups
   and the direct-vs-announcement recipient contract.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL = 'school_msg_test';
let mockDocs;

function pathGet(doc, path) {
  return path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), doc);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(sub => matches(doc, sub));
    const actual = pathGet(doc, key);

    if (value instanceof RegExp) return value.test(actual ?? '');

    if (Array.isArray(actual)) {
      if (value && typeof value === 'object' && '$in' in value) return actual.some(x => value.$in.includes(x));
      if (value && typeof value === 'object' && '$ne' in value) return actual !== value.$ne;
      return actual.includes(value);
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value) return value.$in.includes(actual);
      if ('$nin' in value) return !value.$nin.includes(actual);
      if ('$ne' in value) return actual !== value.$ne;
    }

    return actual === value;
  });
}

function chain(result) {
  const api = {
    select: () => api,
    sort: () => api,
    skip: () => api,
    limit: () => api,
    lean: () => Promise.resolve(result),
  };
  return api;
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));

  const store = {
    docs,
    find: (filter = {}) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter = {}) => chain(docs.find(d => matches(d, filter)) ?? null),
    countDocuments: (filter = {}) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    create: async (doc) => {
      const saved = { ...doc, toObject: () => saved };
      docs.push(saved);
      return saved;
    },
    findOneAndUpdate: (filter, update) => {
      const doc = docs.find(d => matches(d, filter));
      if (!doc) return chain(null);
      Object.assign(doc, update.$set ?? {});
      return chain(doc);
    },
    deleteOne: async (filter = {}) => {
      const idx = docs.findIndex(d => matches(d, filter));
      if (idx >= 0) docs.splice(idx, 1);
      return { deletedCount: idx >= 0 ? 1 : 0 };
    },
  };

  return store;
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = global.__mockJwtUser;
    req.school = { name: 'Test School', systemEmail: 'office@test.school' };
    next();
  },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (_req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: async () => false,
}));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/notif-settings', () => ({ isEnabled: async () => false }));
jest.mock('../../utils/email', () => ({ sendMessageNotification: jest.fn() }));
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: async () => {} }));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: async () => 'http://test.school/login' }));
jest.mock('../../utils/model', () => ({
  _model: () => ({ findOne: () => ({ lean: async () => null }) }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => mockDocs[collection],
}));

const express = require('express');
const supertest = require('supertest');
const messagesRouter = require('../../routes/messages');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messagesRouter);
  return app;
}

const ADMIN = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: [], name: 'Admin' };
const TEACHER = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: [], name: 'Teacher' };
const PARENT = { userId: 'usr_parent', schoolId: SCHOOL, role: 'parent', roles: [], name: 'Parent' };
const STUDENT = { userId: 'usr_student', schoolId: SCHOOL, role: 'student', roles: [], name: 'Student' };

beforeEach(() => {
  mockDocs = {
    users: makeStore([
      { id: 'usr_admin', schoolId: SCHOOL, name: 'Admin', role: 'admin', email: 'admin@test.school', isActive: true },
      { id: 'usr_teacher', schoolId: SCHOOL, name: 'Teacher One', role: 'teacher', email: 'teacher@test.school', isActive: true },
      { id: 'usr_teacher2', schoolId: SCHOOL, name: 'Teacher Two', role: 'teacher', email: 'teacher2@test.school', isActive: true },
      { id: 'usr_parent', schoolId: SCHOOL, name: 'Parent One', role: 'parent', email: 'parent@test.school', isActive: true },
      { id: 'usr_parent2', schoolId: SCHOOL, name: 'Parent Two', role: 'parent', email: 'parent2@test.school', isActive: true },
      { id: 'usr_student', schoolId: SCHOOL, name: 'Student One', role: 'student', email: 'student@test.school', isActive: true },
    ]),
    messages: makeStore([]),
    message_groups: makeStore([]),
  };
});

describe('GET /api/messages/recipients', () => {
  test('a teacher can search the whole school directory', async () => {
    const res = await supertest(buildApp(TEACHER)).get('/api/messages/recipients').query({ q: 'Parent' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(u => u.id).sort()).toEqual(['usr_parent', 'usr_parent2']);
    expect(res.body.data[0]).not.toHaveProperty('email');
  });

  test('a parent is limited to staff even if they ask for students', async () => {
    const res = await supertest(buildApp(PARENT)).get('/api/messages/recipients').query({ scope: 'students' });
    expect(res.status).toBe(200);
    expect(res.body.data.every(u => ['admin', 'teacher'].includes(u.role))).toBe(true);
    expect(res.body.data.some(u => u.role === 'student')).toBe(false);
    expect(res.body.data.some(u => u.role === 'parent')).toBe(false);
  });

  test('the current user is not offered as their own recipient', async () => {
    const res = await supertest(buildApp(TEACHER)).get('/api/messages/recipients');
    expect(res.body.data.some(u => u.id === 'usr_teacher')).toBe(false);
  });
});

describe('saved groups', () => {
  test('staff can create a group, and self is never a member', async () => {
    const res = await supertest(buildApp(TEACHER))
      .post('/api/messages/groups')
      .send({ name: 'Form 4 Teachers', memberIds: ['usr_teacher', 'usr_teacher2', 'usr_admin'] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Form 4 Teachers');
    expect(res.body.data.memberIds.sort()).toEqual(['usr_admin', 'usr_teacher2']);
    expect(res.body.data.members).toHaveLength(2);
    expect(res.body.data.memberCount).toBe(2);
  });

  test('portal users cannot create saved groups', async () => {
    const res = await supertest(buildApp(PARENT))
      .post('/api/messages/groups')
      .send({ name: 'Parents', memberIds: ['usr_teacher'] });
    expect(res.status).toBe(403);
    expect(mockDocs.message_groups.docs).toHaveLength(0);
  });

  test('a group cannot be created with an unknown member', async () => {
    const res = await supertest(buildApp(TEACHER))
      .post('/api/messages/groups')
      .send({ name: 'Ghosts', memberIds: ['usr_missing'] });
    expect(res.status).toBe(400);
    expect(mockDocs.message_groups.docs).toHaveLength(0);
  });

  test('GET /groups only returns groups I created or belong to', async () => {
    mockDocs.message_groups = makeStore([
      { id: 'grp_mine', schoolId: SCHOOL, createdBy: 'usr_teacher', createdByName: 'Teacher One', name: 'Mine', memberIds: ['usr_admin'] },
      { id: 'grp_member', schoolId: SCHOOL, createdBy: 'usr_admin', createdByName: 'Admin', name: 'Member', memberIds: ['usr_teacher'] },
      { id: 'grp_other', schoolId: SCHOOL, createdBy: 'usr_admin', createdByName: 'Admin', name: 'Other', memberIds: ['usr_parent'] },
    ]);
    const res = await supertest(buildApp(TEACHER)).get('/api/messages/groups');
    expect(res.status).toBe(200);
    expect(res.body.data.map(g => g.id).sort()).toEqual(['grp_member', 'grp_mine']);
  });
});

describe('POST /api/messages recipient contract', () => {
  test('direct message stores every selected recipient', async () => {
    const res = await supertest(buildApp(TEACHER))
      .post('/api/messages')
      .send({ subject: 'Hello', body: 'Hi both', recipients: ['usr_parent', 'usr_teacher2'], type: 'direct' });

    expect(res.status).toBe(201);
    expect(res.body.recipients.sort()).toEqual(['usr_parent', 'usr_teacher2']);
    expect(res.body.type).toBe('direct');
  });

  test('direct message to an unknown user is rejected instead of silently disappearing', async () => {
    const res = await supertest(buildApp(TEACHER))
      .post('/api/messages')
      .send({ subject: 'Hello', body: 'Hi', recipients: ['usr_missing'], type: 'direct' });
    expect(res.status).toBe(400);
    expect(mockDocs.messages.docs).toHaveLength(0);
  });

  test('a parent cannot message another parent directly', async () => {
    const res = await supertest(buildApp(PARENT))
      .post('/api/messages')
      .send({ subject: 'Hello', body: 'Hi', recipients: ['usr_parent2'], type: 'direct' });
    expect(res.status).toBe(403);
    expect(mockDocs.messages.docs).toHaveLength(0);
  });

  test('sending to a group resolves current members and excludes the sender', async () => {
    mockDocs.message_groups = makeStore([
      {
        id: 'grp_form4', schoolId: SCHOOL, createdBy: 'usr_teacher', createdByName: 'Teacher One',
        name: 'Form 4 Teachers', memberIds: ['usr_teacher', 'usr_teacher2', 'usr_admin'],
      },
    ]);

    const res = await supertest(buildApp(TEACHER))
      .post('/api/messages')
      .send({ groupId: 'grp_form4', subject: 'Meeting', body: 'Staff room at 4', type: 'direct' });

    expect(res.status).toBe(201);
    expect(res.body.recipients.sort()).toEqual(['usr_admin', 'usr_teacher2']);
    expect(res.body.groupId).toBe('grp_form4');
    expect(res.body.groupName).toBe('Form 4 Teachers');
  });

  test('announcements reject an arbitrary audience key', async () => {
    const res = await supertest(buildApp(TEACHER))
      .post('/api/messages')
      .send({ subject: 'Notice', body: 'Hello', recipients: ['everyone-ish'], type: 'announcement' });
    expect(res.status).toBe(400);
  });

  test('portal roles cannot create announcements', async () => {
    const res = await supertest(buildApp(STUDENT))
      .post('/api/messages')
      .send({ subject: 'Notice', body: 'Hello', recipients: ['all'], type: 'announcement' });
    expect(res.status).toBe(403);
  });
});
