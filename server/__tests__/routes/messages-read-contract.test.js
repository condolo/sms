/* ============================================================
   server/routes/messages.js — read contract, thread identity,
   portal guard, audience dedupe, recipient canonicalization.

   Covers the schema decisions from the messages UX review:
     • PATCH /:id/read {read:false} and PATCH|POST /read-all
       {ids, read:false} — the "mark unread"/undo paths.
     • GET /:id — single-message detail with list-identical
       enrichment and inbox-membership authorization.
     • Thread stitching — a 1:1 reply stamps inReplyTo/threadId
       from the prior message between the pair.
     • Portal-context guard — a parent-shaped token (guardianOf)
       is restricted to staff recipients even under a non-parent
       role name.
     • School-wide broadcasts are admin-tier only.
     • Overlapping audiences resolve to ONE notification per person.
     • /recipients merges duplicate account records by email.

   All DB access is mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; req.school = { systemEmail: '', name: 'T' }; next(); },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: async () => false,
}));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: async () => 'https://school.test/login' }));
jest.mock('../../utils/notif-settings', () => ({ isEnabled: async () => true }));
jest.mock('../../utils/email', () => ({ sendMessageNotification: jest.fn() }));
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: (jobs) => Promise.resolve(Promise.allSettled(jobs.map(j => j()))) }));
jest.mock('../../utils/push', () => ({ sendToUsers: jest.fn(async () => {}) }));

/* ── mock store ───────────────────────────────────────────
   Names prefixed with `mock` are required on anything the
   jest.mock factory closures over (jest's out-of-scope guard). */
function _pathGet(doc, path) {
  return path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), doc);
}
function mockMatch(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatch(doc, sub));
    if (k === '$and') return v.every(sub => mockMatch(doc, sub));
    const actual = _pathGet(doc, k);
    if (Array.isArray(actual)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return actual.some(x => v.$in.includes(x));
      return actual.includes(v);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(actual);
      if ('$ne' in v) return actual !== v.$ne;
      if ('$gte' in v) return String(actual) >= String(v.$gte);
      return true;
    }
    return actual === v;
  });
}
function mockChainable(promise) {
  const q = {
    select: () => q,
    sort:   () => q,
    skip:   () => q,
    limit:  () => q,
    lean:   () => promise,
  };
  return q;
}

let mockMessageDocs;
let mockUserDocs;
const mockCalls = { updateMany: [], findOneAndUpdate: [] };

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'messages') {
      return {
        countDocuments: (filter) => Promise.resolve(mockMessageDocs.filter(d => mockMatch(d, filter)).length),
        find: (filter) => mockChainable(Promise.resolve(mockMessageDocs.filter(d => mockMatch(d, filter)))),
        findOne: (filter) => mockChainable(Promise.resolve(mockMessageDocs.find(d => mockMatch(d, filter)) ?? null)),
        findOneAndUpdate: (filter, update) => {
          mockCalls.findOneAndUpdate.push({ filter, update });
          const doc = mockMessageDocs.find(d => mockMatch(d, filter));
          if (!doc) return mockChainable(Promise.resolve(null));
          return mockChainable(Promise.resolve({ ...doc, ...Object.fromEntries(Object.entries(update.$set || {}).map(([k, v]) => [k, v])) }));
        },
        updateMany: (filter, update) => {
          mockCalls.updateMany.push({ filter, update });
          const hits = mockMessageDocs.filter(d => mockMatch(d, filter));
          return Promise.resolve({ modifiedCount: hits.length });
        },
        deleteOne: () => Promise.resolve({ deletedCount: 1 }),
        create: async (doc) => {
          const d = { ...doc, toObject: () => ({ ...doc }) };
          mockMessageDocs.push(d);
          return d;
        },
      };
    }
    if (collection === 'users') {
      return {
        find: (filter) => mockChainable(Promise.resolve(mockUserDocs.filter(d => mockMatch(d, filter)))),
        findOne: (filter) => mockChainable(Promise.resolve(mockUserDocs.find(d => mockMatch(d, filter)) ?? null)),
      };
    }
    return { find: () => mockChainable(Promise.resolve([])), findOne: () => mockChainable(Promise.resolve(null)) };
  },
}));
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ findOne: () => ({ lean: () => Promise.resolve({ name: 'Test School', systemEmail: '' }) }) })),
}));

const express   = require('express');
const supertest = require('supertest');
const router    = require('../../routes/messages');
const { sendMessageNotification } = require('../../utils/email');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use('/api/messages', router);
  return app;
}

beforeEach(() => {
  mockMessageDocs = [];
  mockUserDocs = [
    { id: 'u_admin',  schoolId: SCHOOL_A, name: 'Admin',  email: 'shared@school.test', role: 'admin',   isActive: true },
    { id: 'u_admin2', schoolId: SCHOOL_A, name: 'Admin',  email: 'shared@school.test', role: 'principal', isActive: true },
    { id: 'u_teacher', schoolId: SCHOOL_A, name: 'Teacher', email: 'teacher@school.test', role: 'teacher', isActive: true },
    { id: 'u_parent', schoolId: SCHOOL_A, name: 'Parent', email: 'parent@school.test', role: 'parent',  isActive: true },
    { id: 'u_student', schoolId: SCHOOL_A, name: 'Student', email: 'student@school.test', role: 'student', isActive: true },
  ];
  mockCalls.updateMany.length = 0;
  mockCalls.findOneAndUpdate.length = 0;
  sendMessageNotification.mockClear();
});

describe('read contract', () => {
  test('PATCH /:id/read {read:false} marks ONE message unread via the isRead map', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{ id: 'm_1', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'], isRead: { u_teacher: true } }];
    const res = await supertest(buildApp(me)).patch('/api/messages/m_1/read').send({ read: false });
    expect(res.status).toBe(200);
    expect(mockCalls.findOneAndUpdate[0].update.$set['isRead.u_teacher']).toBe(false);
  });

  test('marking unread without ids on /read-all is refused', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp(me)).patch('/api/messages/read-all').send({ read: false });
    expect(res.status).toBe(400);
    expect(mockCalls.updateMany).toHaveLength(0);
  });

  test('PATCH /read-all {ids, read:false} reverts exactly the given ids (undo path)', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [
      { id: 'm_1', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'], isRead: { u_teacher: true } },
      { id: 'm_2', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'], isRead: { u_teacher: true } },
    ];
    const res = await supertest(buildApp(me)).patch('/api/messages/read-all').send({ ids: ['m_1'], read: false });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(mockCalls.updateMany[0].filter.id).toEqual({ $in: ['m_1'] });
    expect(mockCalls.updateMany[0].update.$set['isRead.u_teacher']).toBe(false);
  });

  test('POST /read-all works as an alias for the legacy PATCH', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{ id: 'm_1', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'], isRead: {} }];
    const res = await supertest(buildApp(me)).post('/api/messages/read-all').send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
  });

  test('GET /:id returns the enriched row to a recipient and 404 to everyone else', async () => {
    const teacher = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{
      id: 'm_1', schoolId: SCHOOL_A, senderId: 'u_admin', senderName: 'Admin',
      recipients: ['u_teacher'], subject: 'Hi', body: 'Hello', isRead: {}, createdAt: '2026-11-17T10:00:00Z',
    }];
    const ok = await supertest(buildApp(teacher)).get('/api/messages/m_1');
    expect(ok.status).toBe(200);
    expect(ok.body.data.subject).toBe('Hi');
    expect(ok.body.data.recipientUsers).toHaveLength(1);

    const outsider = { userId: 'u_student', schoolId: SCHOOL_A, role: 'student' };
    const no = await supertest(buildApp(outsider)).get('/api/messages/m_1');
    expect(no.status).toBe(404);
  });
});

describe('thread identity', () => {
  test('a 1:1 reply stamps inReplyTo/threadId from the prior message between the pair', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{
      id: 'm_root', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'],
      subject: 'Plan', body: 'hello', isRead: {}, createdAt: '2026-11-17T09:00:00Z',
      childId: 'stu_1', childName: 'Amara Osei',
    }];
    const res = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Re: Plan', body: 'ok', recipients: 'u_admin', type: 'direct' });
    expect(res.status).toBe(201);
    expect(res.body.inReplyTo).toBe('m_root');
    expect(res.body.threadId).toBe('m_root');
    expect(res.body.childId).toBe('stu_1');
    expect(res.body.childName).toBe('Amara Osei');
  });

  test('a reply to a threaded root keeps the conversation root as threadId', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{
      id: 'm_root', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'],
      subject: 'Plan', body: 'hello', isRead: {}, createdAt: '2026-11-17T09:00:00Z', threadId: 'thread_x',
    }];
    const res = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Re: Plan', body: 'ok', recipients: 'u_admin', type: 'direct' });
    expect(res.status).toBe(201);
    expect(res.body.inReplyTo).toBe('m_root');
    expect(res.body.threadId).toBe('thread_x');
  });

  test('a multi-recipient send is its own conversation — no stamp', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{
      id: 'm_root', schoolId: SCHOOL_A, senderId: 'u_admin', recipients: ['u_teacher'],
      subject: 'Plan', body: 'hello', isRead: {}, createdAt: '2026-11-17T09:00:00Z',
    }];
    const res = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Hi both', body: 'ok', recipients: ['u_admin', 'u_parent'], type: 'direct' });
    expect(res.status).toBe(201);
    expect(res.body.inReplyTo).toBeUndefined();
    expect(res.body.threadId).toBeUndefined();
  });
});

describe('portal guard + broadcast policy', () => {
  test('a parent-shaped token (guardianOf) cannot message a student even under a custom role name', async () => {
    const me = { userId: 'u_custom', schoolId: SCHOOL_A, role: 'guardian_view', roles: [], guardianOf: ['stu_1'] };
    const res = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Hi', body: 'x', recipients: 'u_student', type: 'direct' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/staff/i);
  });

  test('a teacher may broadcast to a group audience but not school-wide', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    const group = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Notice', body: 'x', recipients: 'teachers', type: 'announcement' });
    expect(group.status).toBe(201);

    const wide = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Notice', body: 'x', recipients: 'all', type: 'announcement' });
    expect(wide.status).toBe(403);
  });

  test('an admin may broadcast school-wide', async () => {
    const me = { userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' };
    const res = await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Notice', body: 'x', recipients: 'all', type: 'announcement' });
    expect(res.status).toBe(201);
  });
});

describe('overlapping audiences resolve to one notification per person', () => {
  test("['all','teachers'] emails a teacher once, not twice", async () => {
    const { sendMessageNotification } = require('../../utils/email');
    const me = { userId: 'u_admin', schoolId: SCHOOL_A, role: 'admin' };
    await supertest(buildApp(me)).post('/api/messages')
      .send({ subject: 'Notice', body: 'x', recipients: ['all', 'teachers'], type: 'announcement' });
    const teacherEmails = sendMessageNotification.mock.calls
      .map(call => call[0])
      .filter(a => a.recipientEmail === 'teacher@school.test');
    expect(teacherEmails).toHaveLength(1);
  });
});

describe('recipient directory canonicalization', () => {
  test('two accounts sharing an email merge into one person with both roles and ids', async () => {
    const me = { userId: 'u_teacher', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp(me)).get('/api/messages/recipients');
    expect(res.status).toBe(200);
    const merged = res.body.data.find(p => p.name === 'Admin');
    expect(merged).toBeTruthy();
    expect(merged.ids.sort()).toEqual(['u_admin', 'u_admin2'].sort());
    expect(merged.roleLabel).toMatch(/Admin/);
    expect(merged.roleLabel).toMatch(/Principal/);
    // the email itself is never returned
    expect(JSON.stringify(res.body.data)).not.toContain('shared@school.test');
    // distinct people stay distinct rows (the caller themself is excluded)
    expect(res.body.data.filter(p => p.name === 'Parent')).toHaveLength(1);
    expect(res.body.data.filter(p => p.name === 'Teacher')).toHaveLength(0);
  });
});
