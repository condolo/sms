/* ============================================================
   Read All Messages (Oversight) — v5.281.0
   routes/message-oversight.js, and messages on the generic collections
   route. rbac is NOT mocked: role_permissions is seeded.
   ============================================================ */
'use strict';

const { createFakeDb } = require('../fixtures/fake-tenant-db');

let mockDb, mockUser;
const mockLog = jest.fn().mockResolvedValue(undefined);
/* The fixture has no $exists-on-dotted or ISO dates problem; a model is enough. */
jest.mock('../../utils/tenant-model', () => ({
  ...jest.requireActual('../../utils/tenant-model'),
  tenantModel: (n) => mockDb.model(n),
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
}));
jest.mock('../../utils/model', () => ({ _model: (n) => mockDb.model(n) }));
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _r, n) => { req.jwtUser = mockUser; n(); } }));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (_q, _r, n) => n() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_q, _r, n) => n() }));
jest.mock('../../services/audit', () => ({ log: (...a) => mockLog(...a) }));
jest.mock('../../utils/notif-settings', () => ({ isEnabled: jest.fn().mockResolvedValue(false), getFrequency: jest.fn() }));
jest.mock('../../utils/push', () => ({ sendToUsers: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: jest.fn().mockResolvedValue('') }));

const express = require('express');
const supertest = require('supertest');
const { invalidatePermCache } = require('../../middleware/rbac');
const { EXPLICIT_SUB_KEYS, ROLE_FLOOR_SUB_KEYS } = require('../../middleware/explicit-sub');

const S = 'sch_1';
const app = express();
app.use(express.json());
app.use('/m', require('../../routes/messages'));
app.use('/c', require('../../routes/collections'));
const as = (role, id = `u_${role}`, roles = [role]) => { mockUser = { schoolId: S, userId: id, role, roles, name: id }; };
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
let n = 0;
const msg = (senderId, senderRole, recipients, h, o = {}) => ({ id: `m${++n}`, schoolId: S, senderId, senderName: senderId, senderRole, recipients, subject: 'S', body: `body ${n}`, type: 'direct', isRead: {}, createdAt: ago(h), ...o });
const user = (id, role, o = {}) => ({ id, schoolId: S, name: `Name ${id}`, role, isActive: true, ...o });
const perm = (roleKey, permissions, o = {}) => ({ schoolId: S, roleKey, permissions, ...o });
const M = { messages: ['read', 'create', 'update', 'delete'] };
const TICK = { ...M, messages__oversight: ['read'] };
const list = (q = {}) => supertest(app).get('/m/oversight/conversations').query(q);
const conv = (s, f) => supertest(app).get(`/m/oversight/conversations/${s}/${f}`);
const remind = (s, f) => supertest(app).post(`/m/oversight/conversations/${s}/${f}/remind`);
const names = (r) => r.body.data.map(x => `${x.staffId}<${x.familyId}`).sort();

beforeEach(() => {
  mockLog.mockClear(); n = 0;
  invalidatePermCache?.(S);
  const roles = ['superadmin', 'admin', 'principal', 'admissions_officer', 'teacher', 'parent', 'student'];
  mockDb = createFakeDb({
    role_permissions: roles.map(r => perm(r, r === 'admissions_officer' ? TICK : M)),
    users: [user('t1', 'teacher'), user('t2', 'teacher'), user('pr', 'principal'), user('cn', 'counselor'), user('ao', 'admissions_officer'),
      user('p1', 'parent'), user('p2', 'parent'), user('s1', 'student'), user('tp', 'teacher', { roles: ['teacher', 'parent'] })],
    messages: [], schools: [{ id: S, name: 'School' }],
  });
  as('admissions_officer', 'ao');
});
const put = (...m) => mockDb.data.messages.push(...m);

describe('who may read', () => {
  beforeEach(() => put(msg('p1', 'parent', ['t1'], 5)));
  test('only someone ticked: not admin, principal or teacher with full Messages rights', async () => {
    expect((await list()).status).toBe(200);
    for (const r of ['admin', 'principal', 'teacher', 'parent', 'student']) { as(r); expect((await list()).status).toBe(403); expect((await conv('t1', 'p1')).status).toBe(403); expect((await remind('t1', 'p1')).status).toBe(403); }
  });
  test('one person can be ticked, or a ticked person’s right removed', async () => {
    mockDb.data.role_permissions.push({ schoolId: S, userId: 'u_teacher', permissions: { messages__oversight: ['read'] } });
    as('teacher'); expect((await list()).status).toBe(200);
    mockDb.data.role_permissions.push({ schoolId: S, userId: 'ao2', permissions: { messages__oversight: [] } });
    as('admissions_officer', 'ao2'); expect((await list()).status).toBe(403);
  });
  test('off for the whole school until someone is ticked, super admin included', async () => {
    as('superadmin'); expect((await list()).status).toBe(200);
    mockDb.data.role_permissions = mockDb.data.role_permissions.map(r => ({ ...r, permissions: M }));
    invalidatePermCache?.(S);
    expect((await list()).status).toBe(403);
    expect((await supertest(app).get('/m/oversight/status')).body.data).toEqual({ enabled: false, canRead: false });
  });
  test('a tick on a parent or student role counts for nothing, alone or on a two-role account', async () => {
    mockDb.data.role_permissions = mockDb.data.role_permissions.map(r => ({ ...r, permissions: ['parent', 'student'].includes(r.roleKey) ? TICK : M }));
    invalidatePermCache?.(S);
    as('parent'); expect((await list()).status).toBe(403);
    as('teacher', 'tp', ['teacher', 'parent']); expect((await list()).status).toBe(403);
    expect((await supertest(app).get('/m/oversight/status')).body.data.enabled).toBe(false);
  });
  test('another school’s tick or messages never count', async () => {
    mockDb.data.role_permissions = [perm('admissions_officer', TICK, { schoolId: 'sch_2' }), ...mockDb.data.role_permissions.map(r => ({ ...r, permissions: M }))];
    invalidatePermCache?.(S);
    expect((await list()).status).toBe(403);
    mockDb.data.role_permissions.push(perm('x_role', TICK)); as('x_role', 'ao');
    mockDb.data.messages[0].schoolId = 'sch_2';
    expect(names(await list({ status: 'all' }))).toEqual([]);
    expect((await conv('t1', 'p1')).status).toBe(404);
  });
  test('the notice is available to everyone while it is on', async () => {
    as('parent'); expect((await supertest(app).get('/m/oversight/status')).body.data).toEqual({ enabled: true, canRead: false });
  });
  test('a general Messages grant can’t be used to hand it on', () => {
    expect(EXPLICIT_SUB_KEYS.has('messages__oversight') || ROLE_FLOOR_SUB_KEYS.has('messages__oversight')).toBe(true);
  });
});

describe('what it shows', () => {
  test('parent and student conversations with staff only', async () => {
    put(msg('p1', 'parent', ['t1'], 5), msg('s1', 'student', ['t2'], 4), msg('t1', 'teacher', ['t2'], 3),
      msg('t1', 'teacher', ['parents'], 2, { type: 'announcement' }), msg('t1', 'teacher', ['p1', 'p2'], 2, { groupId: 'g' }),
      msg('system', 'system', ['p2'], 1, { kind: 'system' }), msg('p2', 'parent', ['t1'], 1, { behaviourThread: 'behaviour:1:p2' }));
    expect(names(await list({ status: 'all' }))).toEqual(['t1<p1', 't2<s1']);
    expect((await conv('t1', 't2')).status).toBe(404);
    expect((await conv('t1', 'p2')).status).toBe(404);
  });
  test('leadership conversations are hidden except from admin and principal; counsellor ones from everyone', async () => {
    put(msg('p1', 'parent', ['pr'], 5), msg('s1', 'student', ['cn'], 4));
    expect(names(await list({ status: 'all' }))).toEqual([]);
    expect((await conv('pr', 'p1')).status).toBe(404);
    mockDb.data.role_permissions.find(r => r.roleKey === 'admin').permissions = TICK; invalidatePermCache?.(S);
    as('admin'); expect(names(await list({ status: 'all' }))).toEqual(['pr<p1']);
    expect((await conv('cn', 's1')).status).toBe(404);
  });
  test('a staff member tagged as nurse in Staff Roles & Responsibilities is hidden too; a nursery teacher is not', async () => {
    put(msg('p1', 'parent', ['t1'], 5), msg('p1', 'parent', ['t2'], 5));
    mockDb.data.teachers = [{ schoolId: S, userId: 't1', extraRoles: ['school_nurse'] }, { schoolId: S, userId: 't2', extraRoles: ['Nursery Lead'] }];
    expect(names(await list())).toEqual(['t2<p1']);
    expect((await conv('t1', 'p1')).status).toBe(404);
    expect((await remind('t1', 'p1')).status).toBe(404);
    mockDb.data.teachers = [{ schoolId: S, userId: 't1', extraRoles: ['tag_7'] }, { schoolId: S, userId: 't2', extraRoles: ['acting_deputy'] }];
    mockDb.data.schools[0].staffResponsibilities = [{ value: 'tag_7', label: 'School Counsellor' }];
    expect(names(await list())).toEqual([]);
  });
  test('the reader’s own conversations are left to their inbox', async () => {
    put(msg('p1', 'parent', ['ao'], 5));
    expect(names(await list({ status: 'all' }))).toEqual([]);
  });
  test('a member of staff who is also a parent is family when writing from the parent portal', async () => {
    put(msg('tp', 'parent', ['t1'], 5), msg('t1', 'teacher', ['tp'], 4));
    expect(names(await list({ status: 'all' }))).toEqual(['t1<tp']);
    expect(names(await list())).toEqual([]);
  });
});

describe('waiting for a reply', () => {
  test('waiting since the first unanswered message; answered leaves the list', async () => {
    put(msg('p1', 'parent', ['t1'], 30), msg('p1', 'parent', ['t1'], 10));
    const r = await list();
    expect(r.body.data[0]).toMatchObject({ staffId: 't1', familyId: 'p1', waitingHours: 30 });
    expect(r.body.summary.waiting).toBe(1);
    put(msg('t1', 'teacher', ['p1'], 1));
    expect((await list()).body.data).toEqual([]);
    expect((await list({ status: 'all' })).body.data).toHaveLength(1);
  });
  test('a message to several staff is settled when any of them answers', async () => {
    put(msg('p1', 'parent', ['t1', 't2'], 10));
    expect(names(await list())).toEqual(['t1<p1', 't2<p1']);
    put(msg('t2', 'teacher', ['p1'], 2));
    expect((await list()).body.data).toEqual([]);
  });
  test('period, search and no message text in the list', async () => {
    put(msg('p1', 'parent', ['t1'], 24 * 20, { childName: 'Brian' }), msg('p2', 'parent', ['t2'], 5));
    expect(names(await list({ days: 7 }))).toEqual(['t2<p2']);
    expect(names(await list({ days: 30, search: 'brian' }))).toEqual(['t1<p1']);
    expect(JSON.stringify((await list()).body)).not.toContain('body ');
  });
});

describe('reading and reminding', () => {
  beforeEach(() => put(msg('p1', 'parent', ['t1'], 30, { childName: 'Brian', attachment: { id: 'a1', name: 'letter.pdf', data: 'x' } })));
  test('reading is logged and marks nothing read', async () => {
    const r = await conv('t1', 'p1');
    expect(r.body.data.messages[0]).toMatchObject({ from: 'family', body: 'body 1', attachmentName: 'letter.pdf' });
    expect(JSON.stringify(r.body)).not.toContain('a1');
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'messages.oversight_read', schoolId: S }));
    expect(mockDb.data.messages[0].isRead).toEqual({});
  });
  test('a reminder reaches the teacher without the message text, is logged, and waits 12 hours', async () => {
    const r = await remind('t1', 'p1');
    expect(r.status).toBe(201);
    const sent = mockDb.data.messages.find(m => m.systemEventKey === 'message_reply_reminder');
    expect(sent).toMatchObject({ schoolId: S, recipients: ['t1'], kind: 'system', reminderFamilyId: 'p1', reminderBy: 'ao' });
    expect(sent.body).toContain('Name p1 (about Brian)');
    expect(sent.body).not.toContain('body 1');
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'messages.oversight_reminder' }));
    expect((await remind('t1', 'p1')).status).toBe(429);
    expect((await list()).body.data[0].lastReminder.by).toBe('Name ao');
    sent.createdAt = ago(13);
    expect((await remind('t1', 'p1')).status).toBe(201);
  });
  test('no reminder once answered, or to an account that is no longer active', async () => {
    mockDb.data.users.find(u => u.id === 't1').isActive = false;
    expect((await remind('t1', 'p1')).status).toBe(409);
    put(msg('t1', 'teacher', ['p1'], 1));
    expect((await remind('t1', 'p1')).status).toBe(409);
  });
});

describe('the old generic route', () => {
  test('messages can’t be listed, added, changed, deleted or bulk-written by anyone', async () => {
    put(msg('p1', 'parent', ['t1'], 5));
    const id = mockDb.data.messages[0].id;
    for (const r of ['superadmin', 'admin', 'teacher', 'parent', 'student']) {
      as(r);
      expect((await supertest(app).get('/c/messages')).status).toBe(403);
      expect((await supertest(app).post('/c/messages').send({ body: 'x' })).status).toBe(403);
      expect((await supertest(app).put(`/c/messages/${id}`).send({ body: 'x' })).status).toBe(403);
      expect((await supertest(app).delete(`/c/messages/${id}`)).status).toBe(403);
      expect((await supertest(app).post('/c/messages/bulk').send([{ id, body: 'x' }])).status).toBe(403);
    }
    expect(mockDb.data.messages).toHaveLength(1);
    expect(mockDb.data.messages[0].body).toBe('body 1');
  });
});
