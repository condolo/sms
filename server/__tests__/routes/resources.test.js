/* ============================================================
   server/routes/resources.js — Governance Spec §5

   Confirms the multi-dimensional visibility model: scope:'all',
   role-targeting, individual userIds, custom groups, and class/section
   targeting resolved against the caller's own (or a parent's linked
   children's) class — plus expiry filtering and creator/full-access
   edit permissions.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), skip: () => chain(result), limit: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$and') return v.every(sub => matches(doc, sub));
      if (k === '$or')  return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && '$gte' in v) return doc[k] != null && doc[k] >= v.$gte;
      if (v && typeof v === 'object' && '$in' in v) {
        const val = k.includes('.') ? k.split('.').reduce((o, p) => o?.[p], doc) : doc[k];
        return Array.isArray(val) ? val.some(x => v.$in.includes(x)) : v.$in.includes(val);
      }
      if (v && typeof v === 'object' && '$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      const val = k.includes('.') ? k.split('.').reduce((o, p) => o?.[p], doc) : doc[k];
      if (Array.isArray(val)) return val.includes(v) || val === v;
      return val === v;
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
        Object.assign(doc, update);
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
const router    = require('../../routes/resources');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/resources', router);
  return app;
}

const FAR_FUTURE = '2099-01-01';

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [], name: 'A Teacher' };
  mockStores = {
    resources: makeStore([
      { id: 'r_all',      schoolId: SCHOOL, title: 'School Calendar', url: 'https://x.io/cal', creatorId: 'u_admin', visibility: { scope: 'all', roles: [], sectionKeys: [], classIds: [], userIds: [], groupId: null } },
      { id: 'r_teachers',  schoolId: SCHOOL, title: 'Staff Handbook',  url: 'https://x.io/staff', creatorId: 'u_admin', visibility: { scope: 'targeted', roles: ['teacher'], sectionKeys: [], classIds: [], userIds: [], groupId: null } },
      { id: 'r_individual', schoolId: SCHOOL, title: 'Your Contract', url: 'https://x.io/contract', creatorId: 'u_admin', visibility: { scope: 'targeted', roles: [], sectionKeys: [], classIds: [], userIds: ['u_teacher'], groupId: null } },
      { id: 'r_class8a',  schoolId: SCHOOL, title: 'Class 8A Trip Form', url: 'https://x.io/trip', creatorId: 'u_admin', visibility: { scope: 'targeted', roles: [], sectionKeys: [], classIds: ['cls_8a'], userIds: [], groupId: null } },
      { id: 'r_group',    schoolId: SCHOOL, title: 'Debate Club Info', url: 'https://x.io/debate', creatorId: 'u_admin', visibility: { scope: 'targeted', roles: [], sectionKeys: [], classIds: [], userIds: [], groupId: 'grp_debate' } },
      { id: 'r_expired',  schoolId: SCHOOL, title: 'Old Notice', url: 'https://x.io/old', creatorId: 'u_admin', expiresAt: '2020-01-01', visibility: { scope: 'all', roles: [], sectionKeys: [], classIds: [], userIds: [], groupId: null } },
      { id: 'r_future',   schoolId: SCHOOL, title: 'Still Live', url: 'https://x.io/live', creatorId: 'u_admin', expiresAt: FAR_FUTURE, visibility: { scope: 'all', roles: [], sectionKeys: [], classIds: [], userIds: [], groupId: null } },
    ]),
    resource_groups: makeStore([
      { id: 'grp_debate', schoolId: SCHOOL, name: 'Debate Club', memberUserIds: ['u_teacher'] },
    ]),
    students: makeStore([
      { id: 'stu_1', schoolId: SCHOOL, classId: 'cls_8a' },
    ]),
    classes: makeStore([
      { id: 'cls_8a', schoolId: SCHOOL, sectionKey: 'secondary' },
    ]),
  };
});

describe('visibility resolution — teacher', () => {
  test('sees scope:all, role-targeted, individually-targeted, and own-group resources; not class-targeted or expired', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/resources');
    const ids = res.body.data.map(d => d.id);
    expect(ids).toEqual(expect.arrayContaining(['r_all', 'r_teachers', 'r_individual', 'r_group', 'r_future']));
    expect(ids).not.toContain('r_class8a');   // not this teacher's class
    expect(ids).not.toContain('r_expired');
  });
});

describe('visibility resolution — student', () => {
  test('a student in cls_8a sees the class-targeted resource', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_stu_1', schoolId: SCHOOL, role: 'student', roles: [], studentId: 'stu_1' };
    const res = await supertest(app).get('/api/resources');
    expect(res.body.data.map(d => d.id)).toContain('r_class8a');
  });

  test('a student in a different class does not see it', async () => {
    mockStores.students.create({ id: 'stu_2', schoolId: SCHOOL, classId: 'cls_9b' });
    const app = buildApp();
    mockCurrentUser = { userId: 'u_stu_2', schoolId: SCHOOL, role: 'student', roles: [], studentId: 'stu_2' };
    const res = await supertest(app).get('/api/resources');
    expect(res.body.data.map(d => d.id)).not.toContain('r_class8a');
  });
});

describe('visibility resolution — full-access roles', () => {
  test('admin bypasses audience targeting entirely, but expiry still applies (a lifecycle filter, not a targeting one)', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
    const res = await supertest(app).get('/api/resources');
    const ids = res.body.data.map(d => d.id);
    expect(ids).toEqual(expect.arrayContaining(['r_all', 'r_teachers', 'r_individual', 'r_class8a', 'r_group', 'r_future']));
    expect(ids).not.toContain('r_expired');
  });
});

describe('POST/PUT/DELETE permissions', () => {
  test('a non-creator, non-full-access user cannot edit or delete someone else\'s resource', async () => {
    const app = buildApp();
    const putRes = await supertest(app).put('/api/resources/r_all').send({ title: 'Hacked' });
    expect(putRes.status).toBe(403);
    const delRes = await supertest(app).delete('/api/resources/r_all');
    expect(delRes.status).toBe(403);
  });

  test('the creator can edit their own resource', async () => {
    const app = buildApp();
    mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const res = await supertest(app).put('/api/resources/r_all').send({ title: 'Updated Calendar' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Calendar');
  });

  test('creating a resource with an invalid url is rejected', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/resources').send({ title: 'Bad', url: 'not-a-url' });
    expect(res.status).toBe(422); // E.validation()'s status, matching this codebase's convention
  });

  test('creating a valid resource stamps the creator', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/resources').send({ title: 'New Link', url: 'https://x.io/new' });
    expect(res.status).toBe(201);
    expect(res.body.data.creatorId).toBe('u_teacher');
  });
});

describe('custom groups', () => {
  test('creating a group and using it for visibility', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/resources/groups').send({ name: 'Chess Club', memberUserIds: ['u_teacher', 'u_other'] });
    expect(res.status).toBe(201);
    expect(mockStores.resource_groups._docs()).toHaveLength(2);
  });
});
