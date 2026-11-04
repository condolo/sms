/* ============================================================
   server/routes/teacher-portal.js — rich messages + attendance

     POST /messages                              kind/poll/document
     POST /threads/:id/messages                  same extras on a reply
     GET  /threads/:id                           extras on the read
     GET  /students/:id/attendance?month=YYYY-MM the conversation starter

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

jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn().mockResolvedValue({ id: 't_1', userId: 'u_teacher' }),
}));
jest.mock('../../routes/academic-config', () => ({ resolveCurrentPeriod: jest.fn().mockResolvedValue(null) }));

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
const TEACHER = 'u_teacher';
const ADMIN = 'u_admin';
const PARENT = 'u_parent';
const CLASS = 'cls_7a';
const STUDENT = 'stu_1';

function valueMatches(docVal, cond) {
  if (cond instanceof Date) return docVal instanceof Date ? docVal.getTime() === cond.getTime() : docVal === cond;
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$in' in cond) {
      return Array.isArray(docVal) ? docVal.some(v => cond.$in.includes(v)) : cond.$in.includes(docVal);
    }
    if ('$ne' in cond) return docVal !== cond.$ne;
    if ('$nin' in cond) return !cond.$nin.includes(docVal);
    if ('$gte' in cond || '$lte' in cond) {
      if (cond.$gte != null && !(docVal >= cond.$gte)) return false;
      if (cond.$lte != null && !(docVal <= cond.$lte)) return false;
      return true;
    }
    return false;
  }
  if (Array.isArray(docVal)) return docVal.includes(cond);
  return docVal === cond;
}

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some(sub => matchesFilter(doc, sub));
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
    find: jest.fn((filter) => mockChain(seed.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChain(seed.find(d => matchesFilter(d, filter)) ?? null)),
    create: jest.fn(async (doc) => { seed.push(doc); return doc; }),
    updateOne: jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
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
const teacherPortal = require('../../routes/teacher-portal');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/teacher-portal', teacherPortal);
  return app;
}

const DATA_URL = `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`;

beforeEach(() => {
  jest.clearAllMocks();
  global.__TEACHER_JWT = { userId: TEACHER, schoolId: SCHOOL, role: 'teacher' };

  mockCollection('messages', []);
  mockCollection('message_groups', []);
  mockCollection('message_attachments', []);
  mockCollection('attendance', []);
  mockCollection('teaching_assignments', [{ id: 'ta_1', schoolId: SCHOOL, teacherId: 't_1', classId: CLASS }]);
  mockCollection('timetable', []);
  mockCollection('classes', [{ id: CLASS, schoolId: SCHOOL, name: 'Grade 7A', formTeacherId: 't_1' }]);
  mockCollection('students', [{ id: STUDENT, schoolId: SCHOOL, classId: CLASS, name: 'Amina Wanjiku' }]);
  mockCollection('users', [
    { id: TEACHER, schoolId: SCHOOL, name: 'Demo Teacher', email: 'teacher@demo.msingi.io', role: 'teacher', isActive: true },
    { id: ADMIN, schoolId: SCHOOL, name: 'Demo Admin', role: 'admin', isActive: true },
    { id: PARENT, schoolId: SCHOOL, name: 'Mama Amina', role: 'parent', isActive: true, studentIds: [STUDENT] },
  ]);
});

describe('POST /api/teacher-portal/messages — rich kinds', () => {
  test('a reminder carries its due date and attendance context', async () => {
    const res = await supertest(buildApp())
      .post('/api/teacher-portal/messages')
      .send({
        category: `parents:${CLASS}`,
        subject: 'Attendance follow-up',
        body: 'Amina has missed three days this month.',
        kind: 'reminder',
        dueAt: '2026-11-02T15:00:00.000Z',
        context: { type: 'attendance', title: 'Amina — October', detail: '3 absences' },
      });

    expect(res.status).toBe(201);
    const { createDirectMessage } = require('../../routes/messages');
    const [, payload] = createDirectMessage.mock.calls[0];
    expect(payload.recipientUserIds).toEqual([PARENT]);
    expect(payload.extra).toMatchObject({
      kind: 'reminder',
      dueAt: '2026-11-02T15:00:00.000Z',
      context: { type: 'attendance', title: 'Amina — October', detail: '3 absences' },
      attachment: null,
      poll: null,
    });
    expect(mockCollections.message_attachments.create).not.toHaveBeenCalled();
  });

  test('a poll is created with two options and no votes yet', async () => {
    const res = await supertest(buildApp())
      .post('/api/teacher-portal/messages')
      .send({
        category: 'parents:all',
        subject: 'Sports day',
        body: 'Please vote.',
        kind: 'poll',
        poll: { question: 'Can your child join Friday?', options: ['Yes', 'No'] },
      });

    expect(res.status).toBe(201);
    const { createDirectMessage } = require('../../routes/messages');
    const [, payload] = createDirectMessage.mock.calls[0];
    expect(payload.extra.poll.options.map(o => o.text)).toEqual(['Yes', 'No']);
    expect(payload.extra.poll.votes).toEqual({});
  });

  test('a document is stored beside the message and its card carries the id', async () => {
    const res = await supertest(buildApp())
      .post('/api/teacher-portal/messages')
      .send({
        category: `parents:${CLASS}`,
        subject: 'Homework',
        body: 'Worksheet attached.',
        kind: 'homework',
        attachment: { name: 'worksheet.txt', dataUrl: DATA_URL },
      });

    expect(res.status).toBe(201);
    const { createDirectMessage } = require('../../routes/messages');
    const [, payload] = createDirectMessage.mock.calls[0];
    expect(payload.extra.attachment).toMatchObject({ name: 'worksheet.txt', mimeType: 'text/plain', size: 5 });

    expect(mockCollections.message_attachments.create).toHaveBeenCalledTimes(1);
    const blob = mockCollections.message_attachments.create.mock.calls[0][0];
    expect(blob).toMatchObject({ id: payload.extra.attachment.id, messageId: 'msg_sent_1', schoolId: SCHOOL });
    expect(Buffer.from(blob.data, 'base64').toString()).toBe('hello');
  });

  test('an invalid poll is refused before a message is created', async () => {
    const res = await supertest(buildApp())
      .post('/api/teacher-portal/messages')
      .send({
        category: `parents:${CLASS}`,
        subject: 'Q',
        body: 'B',
        kind: 'poll',
        poll: { question: 'Only one?', options: ['Yes'] },
      });

    expect(res.status).toBe(400);
    expect(require('../../routes/messages').createDirectMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/teacher-portal/threads/:id/messages — rich reply', () => {
  test('a reply can carry a poll too', async () => {
    const res = await supertest(buildApp())
      .post(`/api/teacher-portal/threads/${ADMIN}/messages`)
      .send({
        body: 'Quick vote:',
        kind: 'poll',
        poll: { question: 'Meeting at 4?', options: ['Yes', 'No'] },
      });

    expect(res.status).toBe(201);
    const { createDirectMessage } = require('../../routes/messages');
    const [, payload] = createDirectMessage.mock.calls[0];
    expect(payload.extra.kind).toBe('poll');
    expect(payload.extra.poll.options).toHaveLength(2);
  });
});

describe('GET /api/teacher-portal/threads/:id — extras on the read', () => {
  test('a poll bubble shows counts and this reader\'s own vote', async () => {
    mockCollections.messages._seed.push({
      id: 'm_poll', schoolId: SCHOOL, senderId: ADMIN, senderName: 'Demo Admin', senderRole: 'admin',
      recipients: [TEACHER], subject: 'Meeting', body: 'Vote please.', createdAt: '2026-10-22T10:00:00.000Z',
      isRead: {}, kind: 'poll',
      poll: {
        question: 'Meeting at 4?',
        options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }],
        votes: { [ADMIN]: 'o1', [TEACHER]: 'o2' },
        closesAt: null,
      },
    });

    const res = await supertest(buildApp()).get(`/api/teacher-portal/threads/${ADMIN}`);
    expect(res.status).toBe(200);
    const [bubble] = res.body.data.messages;
    expect(bubble.kind).toBe('poll');
    expect(bubble.poll.totalVotes).toBe(2);
    expect(bubble.poll.myVote).toBe('o2');
    expect(bubble.poll.options.find(o => o.id === 'o2').votes).toBe(1);
  });

  test('an old row without extras reads as plain text', async () => {
    mockCollections.messages._seed.push({
      id: 'm_old', schoolId: SCHOOL, senderId: ADMIN, senderName: 'Demo Admin', senderRole: 'admin',
      recipients: [TEACHER], subject: 'Rota', body: 'Noted.', createdAt: '2026-10-21T10:00:00.000Z', isRead: {},
    });
    const res = await supertest(buildApp()).get(`/api/teacher-portal/threads/${ADMIN}`);
    expect(res.body.data.messages[0]).toMatchObject({ kind: 'text', dueAt: null, attachment: null, poll: null });
  });
});

describe('GET /api/teacher-portal/students/:id/attendance', () => {
  beforeEach(() => {
    mockCollections.attendance._seed.push(
      { id: 'a1', schoolId: SCHOOL, studentId: STUDENT, classId: CLASS, subjectId: null, date: '2026-10-02', status: 'absent', note: '' },
      { id: 'a2', schoolId: SCHOOL, studentId: STUDENT, classId: CLASS, subjectId: null, date: '2026-10-03', status: 'present', note: '' },
      { id: 'a3', schoolId: SCHOOL, studentId: STUDENT, classId: CLASS, subjectId: null, date: '2026-10-06', status: 'late', note: 'Traffic' },
      { id: 'a4', schoolId: SCHOOL, studentId: STUDENT, classId: CLASS, subjectId: null, date: '2026-10-07', status: 'authorised_absence', note: '' },
      // another month and another student — neither may leak in
      { id: 'a5', schoolId: SCHOOL, studentId: STUDENT, classId: CLASS, subjectId: null, date: '2026-09-30', status: 'absent', note: '' },
      { id: 'a6', schoolId: SCHOOL, studentId: 'stu_2', classId: CLASS, subjectId: null, date: '2026-10-02', status: 'absent', note: '' },
    );
  });

  test('summarises the month and names the guardians to message', async () => {
    const res = await supertest(buildApp())
      .get(`/api/teacher-portal/students/${STUDENT}/attendance?month=2026-10`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.student).toEqual({ id: STUDENT, name: 'Amina Wanjiku', classId: CLASS, className: 'Grade 7A' });
    expect(data.month).toBe('2026-10');
    expect(data.summary).toEqual({ total: 4, present: 1, late: 1, absent: 1, authorised: 1, other: 0, attended: 2, pct: 50 });
    expect(data.days.map(d => d.date)).toEqual(['2026-10-07', '2026-10-06', '2026-10-03', '2026-10-02']);
    expect(data.guardians).toEqual([{ id: PARENT, name: 'Mama Amina', role: 'parent' }]);
  });

  test('a student outside this teacher\'s classes is not found', async () => {
    const res = await supertest(buildApp())
      .get('/api/teacher-portal/students/stu_other/attendance?month=2026-10');
    expect(res.status).toBe(404);
  });

  test('a malformed month is refused', async () => {
    const res = await supertest(buildApp())
      .get(`/api/teacher-portal/students/${STUDENT}/attendance?month=October`);
    expect(res.status).toBe(400);
  });
});
