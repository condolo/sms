/* ============================================================
   Parent replies on behaviour entries (v5.266.0)

   A parent wrote: "when we get an update on behaviour, I cannot see
   which teacher has updated. So I don't even know who to reply to …
   I can't tell which homework my son has not done."

   Pins, end to end through the real routes and the real
   createDirectMessage (in-memory DB, mocked email/push):
     - parents see who logged each entry (display name only) and where;
     - parents can only read/reply on their own children's entries;
     - a reply goes to the logger + the child's form teacher, resolved
       server-side, never from the client;
     - staff are notified (inbox + email when the school allows it) and
       can answer; only staff on the conversation (or management) can;
     - the parent sees the answer, and each guardian's thread is their own;
     - everything is scoped by schoolId.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (req, _res, next) => next() }));
// Role permissions are not what's under test here (behaviourAccess() and
// rbac are covered elsewhere); the reply routes do their own checks.
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (req, _res, next) => next(),
  hasExplicitSubGrant: async () => false,
}));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn(), getSnapshotDetail: jest.fn(), streamSnapshotPdf: jest.fn() },
}));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({
  _model: () => ({
    findOne: () => ({ select: function () { return this; }, lean: () => Promise.resolve({ id: 'school_A', name: 'Trinitas', systemEmail: 'office@trinitas.test' }), catch() { return this; } }),
  }),
}));

const mockEmailOn = { value: true };
jest.mock('../../utils/notif-settings', () => ({
  isEnabled: jest.fn(async (_schoolId, event, channel) => (event === 'new_message' && channel === 'email' ? mockEmailOn.value : false)),
}));
jest.mock('../../utils/email', () => ({
  sendMessageNotification: jest.fn(async () => true),
  sendBehaviourIncidentAlert: jest.fn(async () => true),
}));
jest.mock('../../utils/email-queue', () => ({
  enqueueBatch: async (jobs) => { for (const job of jobs) await job(); },
}));
jest.mock('../../utils/push', () => ({ sendToUsers: jest.fn(async () => ({})) }));
jest.mock('../../utils/academic-period', () => ({ resolveAcademicPeriod: async () => ({ academicYearId: 'ay_1', termId: 't_1' }) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn(async () => ({})) }));
jest.mock('../../utils/school-url',() => ({ schoolLoginUrl: async () => 'http://localhost:5173/login' }));

const express = require('express');
const supertest = require('supertest');
const email = require('../../utils/email');
const parentPortalRouter = require('../../routes/parent-portal');
const behaviourRouter = require('../../routes/behaviour');

const S = 'school_A';
const PARENT = { userId: 'usr_p', schoolId: S, role: 'parent', studentIds: ['stu_1'], guardianOf: [] };
const PARENT2 = { userId: 'usr_p2', schoolId: S, role: 'parent', studentIds: ['stu_1'], guardianOf: [] };
const OTHER_PARENT = { userId: 'usr_px', schoolId: S, role: 'parent', studentIds: ['stu_9'], guardianOf: [] };
const LOGGER = { userId: 'usr_t1', schoolId: S, role: 'teacher' };
const FORM_TEACHER = { userId: 'usr_t2', schoolId: S, role: 'teacher' };
const OUTSIDER_TEACHER = { userId: 'usr_t3', schoolId: S, role: 'teacher' };
const ADMIN = { userId: 'usr_admin', schoolId: S, role: 'admin' };

function seed() {
  return createFakeDb({
    users: [
      { id: 'usr_p', schoolId: S, role: 'parent', name: 'Jane Njuguna', email: 'jane@parent.test', studentIds: ['stu_1'] },
      { id: 'usr_p2', schoolId: S, role: 'parent', name: 'Peter Njuguna', email: 'peter@parent.test', studentIds: ['stu_1'] },
      { id: 'usr_px', schoolId: S, role: 'parent', name: 'Other Parent', email: 'other@parent.test', studentIds: ['stu_9'] },
      { id: 'usr_t1', schoolId: S, role: 'teacher', name: 'Mr Otieno', email: 'otieno@school.test', phone: '+254700000001' },
      { id: 'usr_t2', schoolId: S, role: 'teacher', name: 'Ms Wanjiru', email: 'wanjiru@school.test' },
      { id: 'usr_t3', schoolId: S, role: 'teacher', name: 'Mr Outsider', email: 'outsider@school.test' },
      { id: 'usr_t4', schoolId: S, role: 'teacher', name: 't4@school.test', email: 't4@school.test' },
      { id: 'usr_admin', schoolId: S, role: 'admin', name: 'Head Teacher', email: 'head@school.test' },
    ],
    students: [
      { id: 'stu_1', schoolId: S, firstName: 'Liam', lastName: 'Njuguna', classId: 'cls_6', streamId: 'str_6a' },
      { id: 'stu_9', schoolId: S, firstName: 'Other', lastName: 'Child', classId: 'cls_6', streamId: 'str_6a' },
    ],
    streams: [{ id: 'str_6a', schoolId: S, name: '6A', formTeacherId: 'tch_2' }],
    teachers: [{ id: 'tch_2', schoolId: S, userId: 'usr_t2' }],
    classes: [{ id: 'cls_6', schoolId: S, name: 'Year 6' }],
    subjects: [
      { id: 'sub_math', schoolId: S, name: 'Mathematics' },
      { id: 'sub_eng', schoolId: S, name: 'English' },
    ],
    teaching_assignments: [
      { schoolId: S, teacherId: 'usr_t1', classId: 'cls_6', subjectId: 'sub_math', subjectName: 'Mathematics' },
      { schoolId: S, teacherId: 'usr_t3', classId: 'cls_6', subjectId: 'sub_math' },
      { schoolId: S, teacherId: 'usr_t3', classId: 'cls_6', subjectId: 'sub_eng' },
    ],
    behaviour_incidents: [
      { id: 'inc_1', schoolId: S, studentId: 'stu_1', studentName: 'Liam Njuguna', classId: 'cls_6', reportedBy: 'usr_t1', createdBy: 'usr_t1', title: 'Incomplete homework (first instance)', description: 'Incomplete homework (first instance)', category: 'Classroom & Academic', points: -1, type: 'demerit', date: '2026-11-12', note: 'private teacher note' },
      { id: 'inc_2', schoolId: S, studentId: 'stu_1', classId: 'cls_6', reportedBy: 'usr_t4', title: 'Off-task', points: -2, date: '2026-11-10', subjectName: 'English' },
      { id: 'inc_3', schoolId: S, studentId: 'stu_1', classId: 'cls_6', reportedBy: 'usr_t3', title: 'Late to class', points: -1, date: '2026-11-09' },
      { id: 'inc_9', schoolId: S, studentId: 'stu_9', classId: 'cls_6', reportedBy: 'usr_t1', title: 'Other child entry', points: -1, date: '2026-11-12' },
      // Same student id in ANOTHER school — must never surface.
      { id: 'inc_x', schoolId: 'school_B', studentId: 'stu_1', reportedBy: 'usr_t1', title: 'Other school entry', points: -5, date: '2026-11-12' },
    ],
  });
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parent-portal', parentPortalRouter);
  a.use('/api/behaviour', behaviourRouter);
  return a;
}
const as = (user) => { mockJwtUser = user; return supertest(app()); };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = seed();
  mockEmailOn.value = true;
});

describe('parent sees who logged each entry and where', () => {
  test('history shows the logger display name, subject and class — no staff ids, emails or private notes', async () => {
    const res = await as(PARENT).get('/api/parent-portal/behaviour/stu_1');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map(d => [d.id, d]));
    expect(byId.inc_1).toMatchObject({ recordedBy: 'Mr Otieno', subjectName: 'Mathematics', subjectInferred: true, className: 'Year 6' });
    expect(byId.inc_2).toMatchObject({ subjectName: 'English', subjectInferred: false });
    // A teacher who teaches two subjects in the class: no guess.
    expect(byId.inc_3).toMatchObject({ recordedBy: 'Mr Outsider', subjectName: null });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/usr_t\d|@school\.test|\+2547|private teacher note|reportedBy|createdBy/);
    expect(text).not.toMatch(/Other school entry/);
  });

  test('a staff name that is really an email is shown as "School staff"', async () => {
    const res = await as(PARENT).get('/api/parent-portal/behaviour/stu_1');
    expect(res.body.data.find(d => d.id === 'inc_2').recordedBy).toBe('School staff');
  });

  test('another family\'s child is refused', async () => {
    const res = await as(PARENT).get('/api/parent-portal/behaviour/stu_9');
    expect(res.status).toBe(403);
  });
});

describe('accounts saved without an `id` field (user id = String(_id))', () => {
  const HEX = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  beforeEach(() => {
    mockDb.data.users.push({ _id: HEX, schoolId: S, role: 'teacher', name: 'Mrs Idless', email: 'idless@school.test' });
    mockDb.data.behaviour_incidents.push({ id: 'inc_idless', schoolId: S, studentId: 'stu_1', classId: 'cls_6', reportedBy: HEX, title: 'Late homework', points: -1, date: '2026-11-11' });
  });

  test('the parent still sees who logged it', async () => {
    const res = await as(PARENT).get('/api/parent-portal/behaviour/stu_1');
    expect(res.body.data.find(d => d.id === 'inc_idless').recordedBy).toBe('Mrs Idless');
  });

  test('a reply still reaches that teacher', async () => {
    const res = await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_idless/replies').send({ body: 'Which homework?' });
    expect(res.status).toBe(201);
    expect(res.body.data.recipients[0]).toEqual({ name: 'Mrs Idless', reason: 'logged' });
    expect(mockDb.data.messages[0].recipients).toContain(HEX);
  });
});

describe('parent replies', () => {
  test('a reply goes to the logger and the form teacher, and they are notified by email when the school allows it', async () => {
    const res = await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_1/replies')
      .send({ body: 'Which homework was this?', recipients: ['usr_px'], recipientUserIds: ['usr_px'] });
    expect(res.status).toBe(201);
    expect(res.body.data.recipients).toEqual([
      { name: 'Mr Otieno', reason: 'logged' },
      { name: 'Ms Wanjiru', reason: 'form_teacher' },
    ]);
    const [msg] = mockDb.data.messages;
    expect(msg).toMatchObject({
      schoolId: S, senderId: 'usr_p', senderRole: 'parent',
      recipients: ['usr_t1', 'usr_t2'],
      behaviourIncidentId: 'inc_1', behaviourParentId: 'usr_p', behaviourThread: 'behaviour:inc_1:usr_p',
    });
    expect(msg.context).toMatchObject({ type: 'behaviour', title: 'Incomplete homework (first instance)' });
    const emailed = email.sendMessageNotification.mock.calls.map(c => c[0].recipientEmail).sort();
    expect(emailed).toEqual(['otieno@school.test', 'wanjiru@school.test']);
  });

  test('no email when the school has turned New Message email off — the inbox message still lands', async () => {
    mockEmailOn.value = false;
    const res = await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_1/replies').send({ body: 'Hello' });
    expect(res.status).toBe(201);
    expect(mockDb.data.messages).toHaveLength(1);
    expect(email.sendMessageNotification).not.toHaveBeenCalled();
  });

  test('the logger who is also the form teacher gets it once', async () => {
    mockDb.data.teachers[0].userId = 'usr_t1';
    const res = await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_1/replies').send({ body: 'Hi' });
    expect(res.status).toBe(201);
    expect(mockDb.data.messages[0].recipients).toEqual(['usr_t1']);
  });

  test('cannot reply on another child\'s entry — neither via an unlinked child nor by pairing own child with a foreign entry', async () => {
    const a = await as(PARENT).post('/api/parent-portal/behaviour/stu_9/inc_9/replies').send({ body: 'x' });
    expect(a.status).toBe(403);
    const b = await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_9/replies').send({ body: 'x' });
    expect(b.status).toBe(404);
    const c = await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_x/replies').send({ body: 'x' });
    expect(c.status).toBe(404);
    expect(mockDb.data.messages || []).toHaveLength(0);
  });

  test('empty reply is refused; staff cannot use the parent route', async () => {
    expect((await as(PARENT).post('/api/parent-portal/behaviour/stu_1/inc_1/replies').send({ body: '  ' })).status).toBe(400);
    expect((await as(LOGGER).post('/api/parent-portal/behaviour/stu_1/inc_1/replies').send({ body: 'x' })).status).toBe(403);
  });
});

describe('teacher answers and the parent sees it', () => {
  async function parentWrites(user = PARENT, body = 'Which homework was this?') {
    const r = await as(user).post('/api/parent-portal/behaviour/stu_1/inc_1/replies').send({ body });
    expect(r.status).toBe(201);
  }

  test('the logger sees the conversation in Parent Replies with an unread count, then answers; the parent is notified', async () => {
    await parentWrites();
    const inbox = await as(LOGGER).get('/api/behaviour/replies');
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.unreadTotal).toBe(1);
    expect(inbox.body.data.threads[0]).toMatchObject({ incidentId: 'inc_1', parentUserId: 'usr_p', parentName: 'Jane Njuguna', unread: 1 });

    const thread = await as(LOGGER).get('/api/behaviour/incidents/inc_1/replies');
    expect(thread.status).toBe(200);
    expect(thread.body.data.threads[0].messages[0]).toMatchObject({ body: 'Which homework was this?', fromParent: true });
    // Reading marks it read.
    expect((await as(LOGGER).get('/api/behaviour/replies')).body.data.unreadTotal).toBe(0);

    email.sendMessageNotification.mockClear();
    const answer = await as(LOGGER).post('/api/behaviour/incidents/inc_1/replies')
      .send({ parentUserId: 'usr_p', body: 'The Maths worksheet on fractions, page 12.' });
    expect(answer.status).toBe(201);
    const reply = mockDb.data.messages[1];
    expect(reply.recipients.sort()).toEqual(['usr_p', 'usr_t2']);
    expect(email.sendMessageNotification.mock.calls.map(c => c[0].recipientEmail).sort()).toEqual(['jane@parent.test', 'wanjiru@school.test']);

    // Parent: unread count on the entry, then the thread.
    const hist = await as(PARENT).get('/api/parent-portal/behaviour/stu_1');
    expect(hist.body.data.find(d => d.id === 'inc_1')).toMatchObject({ replyCount: 2, unreadReplies: 1 });
    const view = await as(PARENT).get('/api/parent-portal/behaviour/stu_1/inc_1/replies');
    expect(view.status).toBe(200);
    expect(view.body.data.messages.map(m => [m.senderName, m.fromParent, m.mine])).toEqual([
      ['Jane Njuguna', true, true],
      ['Mr Otieno', false, false],
    ]);
    expect(JSON.stringify(view.body)).not.toMatch(/usr_t\d|@school\.test/);
    const after = await as(PARENT).get('/api/parent-portal/behaviour/stu_1');
    expect(after.body.data.find(d => d.id === 'inc_1').unreadReplies).toBe(0);
  });

  test('the form teacher can answer too', async () => {
    await parentWrites();
    const r = await as(FORM_TEACHER).post('/api/behaviour/incidents/inc_1/replies').send({ parentUserId: 'usr_p', body: 'I will check with Mr Otieno.' });
    expect(r.status).toBe(201);
    expect(mockDb.data.messages[1].recipients.sort()).toEqual(['usr_p', 'usr_t1']);
  });

  test('a teacher not on the conversation can neither read nor answer it; management can', async () => {
    await parentWrites();
    expect((await as(OUTSIDER_TEACHER).get('/api/behaviour/incidents/inc_1/replies')).status).toBe(403);
    expect((await as(OUTSIDER_TEACHER).post('/api/behaviour/incidents/inc_1/replies').send({ parentUserId: 'usr_p', body: 'x' })).status).toBe(403);
    expect((await as(OUTSIDER_TEACHER).get('/api/behaviour/replies')).body.data.threads).toHaveLength(0);
    expect((await as(ADMIN).get('/api/behaviour/incidents/inc_1/replies')).status).toBe(200);
  });

  test('staff cannot open a new thread with a parent who never wrote, or with a parent of another child', async () => {
    expect((await as(LOGGER).post('/api/behaviour/incidents/inc_1/replies').send({ parentUserId: 'usr_p', body: 'x' })).status).toBe(404);
    // Forge a thread key for a parent who is not this child's.
    mockDb.data.messages = [{ id: 'm_forged', schoolId: S, senderId: 'usr_px', senderRole: 'parent', recipients: ['usr_t1'], body: 'x', behaviourIncidentId: 'inc_1', behaviourParentId: 'usr_px', behaviourThread: 'behaviour:inc_1:usr_px', createdAt: '2026-11-12T08:00:00Z' }];
    expect((await as(LOGGER).post('/api/behaviour/incidents/inc_1/replies').send({ parentUserId: 'usr_px', body: 'x' })).status).toBe(409);
  });

  test('parents cannot use the staff routes', async () => {
    expect((await as(PARENT).get('/api/behaviour/replies')).status).toBe(403);
    expect((await as(PARENT).post('/api/behaviour/incidents/inc_1/replies').send({ parentUserId: 'usr_p', body: 'x' })).status).toBe(403);
  });

  test('each guardian has their own thread — one never sees the other\'s', async () => {
    await parentWrites(PARENT, 'From Jane');
    await parentWrites(PARENT2, 'From Peter');
    const jane = await as(PARENT).get('/api/parent-portal/behaviour/stu_1/inc_1/replies');
    expect(jane.body.data.messages.map(m => m.body)).toEqual(['From Jane']);
    const other = await as(OTHER_PARENT).get('/api/parent-portal/behaviour/stu_1/inc_1/replies');
    expect(other.status).toBe(403);
    const staff = await as(LOGGER).get('/api/behaviour/incidents/inc_1/replies');
    expect(staff.body.data.threads).toHaveLength(2);
  });

  test('a conversation in another school is invisible', async () => {
    mockDb.data.messages = [{ id: 'm_b', schoolId: 'school_B', senderId: 'usr_p', senderRole: 'parent', recipients: ['usr_t1'], body: 'other school', behaviourIncidentId: 'inc_1', behaviourParentId: 'usr_p', behaviourThread: 'behaviour:inc_1:usr_p', createdAt: '2026-11-12T08:00:00Z' }];
    expect((await as(LOGGER).get('/api/behaviour/replies')).body.data.threads).toHaveLength(0);
    expect((await as(PARENT).get('/api/parent-portal/behaviour/stu_1/inc_1/replies')).body.data.messages).toHaveLength(0);
  });
});

describe('subject on new entries', () => {
  test('subject-options lists the class curriculum with the teacher\'s own subjects first', async () => {
    mockDb.data.class_subjects = [{ schoolId: S, classId: 'cls_6', subjectId: 'sub_eng' }, { schoolId: S, classId: 'cls_6', subjectId: 'sub_math' }];
    const res = await as(LOGGER).get('/api/behaviour/subject-options?studentId=stu_1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'sub_math', name: 'Mathematics', mine: true },
      { id: 'sub_eng', name: 'English', mine: false },
    ]);
  });

  test('a new entry stores the subject name from the subjects table, never a free-typed one', async () => {
    const res = await as(LOGGER).post('/api/behaviour/incidents').send({
      studentId: 'stu_1', title: 'Incomplete homework (first instance)', type: 'demerit', points: -1, subjectId: 'sub_math',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ subjectId: 'sub_math', subjectName: 'Mathematics', reportedBy: 'usr_t1' });
    const forged = await as(LOGGER).post('/api/behaviour/incidents').send({
      studentId: 'stu_1', title: 'x', type: 'demerit', points: -1, subjectName: 'Made-up subject',
    });
    expect(forged.status).toBe(201);
    expect(forged.body.data.subjectName).toBeUndefined();
  });
});

describe('displayName', () => {
  const { displayName } = require('../../utils/behaviour-replies');
  test.each([
    ['Mr Otieno', 'Mr Otieno'],
    ['  Ms Wanjiru ', 'Ms Wanjiru'],
    ['otieno@school.test', 'School staff'],
    ['+254 700 000 001', 'School staff'],
    ['', 'School staff'],
    [null, 'School staff'],
  ])('%p → %p', (input, out) => expect(displayName(input)).toBe(out));
});
