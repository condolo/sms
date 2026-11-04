/* ============================================================
   server/routes/teacher-portal.js — the Messages tab's thread

     GET  /threads/:counterpartUserId          one conversation
     POST /threads/:counterpartUserId/messages a reply

   These exist because a teacher's Messages row used to fall back to
   the Profile screen (there was no read route on this portal), so a
   tap looked like a detour into the PIN settings. The read mirrors
   the parent portal's screen-12 contract: a thread is the PAIR
   (this teacher, one counterpart), the inbound messages are marked
   read on open, and a group bubble carries its audience instead of
   borrowing one person's tick.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { ...global.__TEACHER_JWT };
    next();
  },
}));

jest.mock('../../utils/timetable-publish', () => ({
  isTimetablePublished: jest.fn().mockResolvedValue(false),
  publishedReader: jest.fn().mockResolvedValue({
    find: () => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) }),
  }),
}));

jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: jest.fn() }));
jest.mock('../../routes/academic-config', () => ({ resolveCurrentPeriod: jest.fn().mockResolvedValue(null) }));

/* The real _inboxQuery derives role groups from ROLE_GROUPS; this keeps its
   shape (schoolId + $or) so the pair filter under test is the real one. */
jest.mock('../../routes/messages', () => ({
  _inboxQuery: ({ schoolId, userId }) => ({
    schoolId,
    $or: [{ recipients: 'all' }, { recipients: { $in: ['teachers'] } }, { recipients: userId }],
  }),
  createDirectMessage: jest.fn(async (req, payload) => ({
    id: 'msg_sent_1',
    createdAt: '2026-10-29T09:00:00.000Z',
    ...payload,
  })),
}));

const SCHOOL = 'sch_demo';
const TEACHER = 'u_demo_t2';
const ADMIN = 'u_demo_admin';

/* ── A tiny in-memory Mongo, enough for the queries these routes issue ── */

function valueMatches(docVal, cond) {
  if (cond instanceof Date) return docVal instanceof Date ? docVal.getTime() === cond.getTime() : docVal === cond;
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$in' in cond) {
      return Array.isArray(docVal)
        ? docVal.some((v) => cond.$in.includes(v))
        : cond.$in.includes(docVal);
    }
    if ('$ne' in cond) return docVal !== cond.$ne;
    return false;
  }
  if (Array.isArray(docVal)) return docVal.includes(cond);
  return docVal === cond;
}

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matchesFilter(doc, sub));
    return valueMatches(doc[key], cond);
  });
}

function mockChain(rows) {
  let data = Array.isArray(rows) ? [...rows] : rows;
  const c = {
    select: () => c,
    sort: (spec) => {
      if (spec && Array.isArray(data)) {
        const [field, dir] = Object.entries(spec)[0] ?? [];
        if (field) {
          data = [...data].sort((a, b) => {
            if (a[field] === b[field]) return 0;
            return (a[field] > b[field] ? 1 : -1) * (dir < 0 ? -1 : 1);
          });
        }
      }
      return c;
    },
    limit: (n) => { if (Array.isArray(data)) data = data.slice(0, n); return c; },
    lean: () => Promise.resolve(data),
    catch: (fn) => Promise.resolve(data).catch(fn),
  };
  return c;
}

const mockCollections = {};

function mockCollection(name, seed = []) {
  const col = {
    _seed: seed,
    find: jest.fn((filter) => mockChain(seed.filter((d) => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChain(seed.find((d) => matchesFilter(d, filter)) ?? null)),
    updateMany: jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
  };
  mockCollections[name] = col;
  return col;
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((name) => mockCollections[name] ?? mockCollection(name)),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: jest.fn((name) => mockCollections[name] ?? mockCollection(name)),
}));

const express   = require('express');
const supertest = require('supertest');
const messageRoutes = require('../../routes/messages');
const teacherPortal = require('../../routes/teacher-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teacher-portal', teacherPortal);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.__TEACHER_JWT = { userId: TEACHER, schoolId: SCHOOL, role: 'teacher' };

  mockCollection('messages', []);
  mockCollection('users', [
    { id: TEACHER, schoolId: SCHOOL, name: 'Demo Teacher', email: 'teacher@demo.msingi.io', role: 'teacher', isActive: true },
    { id: ADMIN, schoolId: SCHOOL, name: 'Demo Admin', role: 'admin', isActive: true },
  ]);
});

describe('GET /api/teacher-portal/threads/:counterpartUserId', () => {
  test('returns the pair oldest-first and marks the inbound as read on open', async () => {
    mockCollections.messages._seed.push(
      { id: 'm_2', schoolId: SCHOOL, senderId: ADMIN, senderName: 'Demo Admin', senderRole: 'admin', recipients: [TEACHER], subject: 'Rota', body: 'Reply before Friday.', createdAt: '2026-10-22T10:00:00.000Z', isRead: {} },
      { id: 'm_1', schoolId: SCHOOL, senderId: TEACHER, senderName: 'Demo Teacher', senderRole: 'teacher', recipients: [ADMIN], subject: 'Rota', body: 'Noted.', createdAt: '2026-10-21T10:00:00.000Z', isRead: {} },
    );

    const res = await supertest(buildApp()).get(`/api/teacher-portal/threads/${ADMIN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.counterpart.name).toBe('Demo Admin');
    expect(res.body.data.messages.map((m) => m.mine)).toEqual([true, false]);
    expect(res.body.data.messages[0].body).toBe('Noted.');
    expect(res.body.data.messages[1].from).toBe('Demo Admin');
    expect(res.body.data.messages[0].multiRecipient).toBe(false);

    const Msg = mockCollections.messages;
    expect(Msg.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = Msg.updateMany.mock.calls[0];
    expect(filter.id.$in).toEqual(['m_2']);      // only the inbound one
    expect(update.$set[`isRead.${TEACHER}`]).toBe(true);
  });

  test('a bubble that went to several people carries that audience', async () => {
    mockCollections.messages._seed.push(
      { id: 'm_1', schoolId: SCHOOL, senderId: ADMIN, senderName: 'Demo Admin', senderRole: 'admin', recipients: [TEACHER, 'u_demo_t1'], subject: 'Timetable', body: 'Draft attached.', createdAt: '2026-10-22T10:00:00.000Z', isRead: {} },
    );

    const res = await supertest(buildApp()).get(`/api/teacher-portal/threads/${ADMIN}`);
    const [theirs] = res.body.data.messages;

    expect(theirs.recipientCount).toBe(2);
    expect(theirs.multiRecipient).toBe(true);
  });

  test('refuses a non-teacher session', async () => {
    global.__TEACHER_JWT.role = 'parent';
    const res = await supertest(buildApp()).get(`/api/teacher-portal/threads/${ADMIN}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/teacher-portal/threads/:counterpartUserId/messages', () => {
  test('sends through the shared direct-message path with the teacher role', async () => {
    const res = await supertest(buildApp())
      .post(`/api/teacher-portal/threads/${ADMIN}/messages`)
      .send({ body: 'Will do.', subject: 'Rota' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('msg_sent_1');

    const { createDirectMessage } = require('../../routes/messages');
    expect(createDirectMessage).toHaveBeenCalledTimes(1);
    const [, payload] = createDirectMessage.mock.calls[0];
    expect(payload.recipientUserIds).toEqual([ADMIN]);
    expect(payload.senderRole).toBe('teacher');
    expect(payload.senderName).toBe('Demo Teacher');
    expect(payload.subject).toBe('Rota');
  });

  test('rejects an empty message before touching the database', async () => {
    const res = await supertest(buildApp())
      .post(`/api/teacher-portal/threads/${ADMIN}/messages`)
      .send({ body: '   ' });

    expect(res.status).toBe(400);
    expect(require('../../routes/messages').createDirectMessage).not.toHaveBeenCalled();
  });
});
