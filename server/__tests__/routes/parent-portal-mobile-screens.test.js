/* ============================================================
   server/routes/parent-portal.js — the Phase 1 mobile reads

     GET  /attendance/:childId?month=   screen 5  (month calendar)
     GET  /report/:childId              screen 6  (term report)
     GET  /notices                      screen 7  (notice board)
     GET  /fees/:childId                screen 8  (invoices + receipts)
     GET  /receipts/:paymentId          screen 10 (one receipt)
     GET  /inbox                        screen 11 (conversations)
     GET  /threads/:counterpartUserId   screen 12
     POST /threads/:counterpartUserId/messages
     GET  /profile                      screen 13

   These exist because the dashboard payload is a first-paint read: it
   carries totals and the last five of everything. Each of these screens
   needs a history, so each has its own endpoint rather than making every
   parent on a weak connection pay for a month of attendance they are not
   looking at.

   What is pinned here, and why each one would silently break:
   - a day with an absence AND a present record resolves to ABSENT (the
     calendar shows one tint per day, and "present" would be a lie);
   - an invoice past its due date reports `overdue` even if its stored
     status was never rewritten;
   - a receipt for someone else's child is refused — it is a money
     document, and guessing an id must not open another family's;
   - a staff-only announcement never reaches a parent's board;
   - a conversation is the PAIR (parent, staff), so two messages from the
     same office resolve to one thread, with the parent's own replies in
     it and only the inbound ones counted unread;
   - primary vs co-guardian survives to the profile screen.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { ...global.__PARENT_JWT };
    next();
  },
}));

jest.mock('../../utils/timetable-publish', () => ({
  isTimetablePublished: jest.fn().mockResolvedValue(false),
  publishedReader: jest.fn().mockResolvedValue({
    find: () => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) }),
  }),
}));

/* The real _inboxQuery takes the { schoolId, userId, role } triple from
   req.jwtUser, not the request; this keeps its shape (schoolId + $or) so
   the grouping logic under test is the real one. */
jest.mock('../../routes/messages', () => ({
  _inboxQuery: ({ schoolId, userId }) => ({
    schoolId,
    $or: [{ recipients: 'all' }, { recipients: { $in: ['parents'] } }, { recipients: userId }],
  }),
  createDirectMessage: jest.fn(async (req, payload) => ({
    id: 'msg_sent_1',
    createdAt: '2026-10-24T09:00:00.000Z',
    ...payload,
  })),
}));

jest.mock('../../routes/weekly-snapshots', () => ({ _helpers: { findAuthorizedStudent: jest.fn() } }));

const SCHOOL = 'sch_riverside';
const PARENT = 'usr_kamau';
const CHILD  = 'stu_brian';
const SIBLING = 'stu_joy';

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
    if ('$exists' in cond) return cond.$exists ? docVal !== undefined : docVal === undefined;
    if ('$gte' in cond || '$lte' in cond) {
      const cmp = (x) => {
        if ('$gte' in cond && !(x >= cond.$gte)) return false;
        if ('$lte' in cond && !(x <= cond.$lte)) return false;
        return true;
      };
      return Array.isArray(docVal) ? docVal.some(cmp) : cmp(docVal);
    }
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
  let data = Array.isArray(rows) ? [...rows] : rows;   // findOne hands us one doc, not a list
  const c = {
    select: () => c,
    // Honours the sort/limit the route asks for, so a test can actually pin
    // "newest message wins" and "chronological conversation" rather than
    // whatever order the seed happened to be in.
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

let mockSchoolDoc = null;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((name) => {
    if (name === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollections[name] ?? mockCollection(name);
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: jest.fn((name) => mockCollections[name] ?? mockCollection(name)),
}));

const express   = require('express');
const supertest = require('supertest');
const messageRoutes = require('../../routes/messages');
const parentPortal  = require('../../routes/parent-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortal);
  return app;
}

const THIS_MONTH = new Date().toISOString().slice(0, 7);
const day = (d) => `${THIS_MONTH}-${String(d).padStart(2, '0')}`;

beforeEach(() => {
  jest.clearAllMocks();
  global.__PARENT_JWT = {
    userId: PARENT, schoolId: SCHOOL, role: 'parent',
    studentIds: [CHILD], guardianOf: [SIBLING],
  };
  mockSchoolDoc = { id: SCHOOL, name: 'Riverside Academy', logoUrl: null, systemEmail: 'office@riverside.school', mpesa: null };

  mockCollection('students', [
    { id: CHILD,   schoolId: SCHOOL, firstName: 'Brian', lastName: 'Kamau', className: 'Grade 7A', classId: 'cls_7a', admissionNumber: 'ADM-120', photo: 'brian.jpg', status: 'active' },
    { id: SIBLING, schoolId: SCHOOL, firstName: 'Joy',   lastName: 'Kamau', className: 'Grade 4B', classId: 'cls_4b', admissionNumber: 'ADM-121', photo: null, status: 'active' },
  ]);
  mockCollection('classes', [{ id: 'cls_7a', schoolId: SCHOOL, formTeacherId: 'tch_1' }]);
  mockCollection('teachers', [{ id: 'tch_1', schoolId: SCHOOL, firstName: 'Otieno', lastName: 'Mwangi', title: 'Mrs.' }]);
  mockCollection('academic_years', []);
  mockCollection('attendance', []);
  mockCollection('invoices', []);
  mockCollection('payments', []);
  mockCollection('announcements', []);
  mockCollection('events', []);
  mockCollection('report_card_snapshots', []);
  mockCollection('subjects', []);
  mockCollection('messages', []);
  mockCollection('users', [{ id: PARENT, schoolId: SCHOOL, name: 'Mrs. Kamau', email: 'kamau@example.com', role: 'parent' }]);
});

/* ── Screen 5 — attendance month ────────────────────────────────── */

describe('GET /api/parent-portal/attendance/:childId', () => {
  test('one tint per day, resolving a mixed day to its worst status', async () => {
    mockCollections.attendance._seed.push(
      { schoolId: SCHOOL, studentId: CHILD, date: day(3), status: 'present' },
      { schoolId: SCHOOL, studentId: CHILD, date: day(3), status: 'absent', note: 'Sick note not received' },
      { schoolId: SCHOOL, studentId: CHILD, date: day(4), status: 'present' },
      { schoolId: SCHOOL, studentId: CHILD, date: day(5), status: 'late',  note: 'Arrived 8:40' },
    );

    const res = await supertest(buildApp()).get(`/api/parent-portal/attendance/${CHILD}?month=${THIS_MONTH}`);

    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe(THIS_MONTH);
    expect(res.body.data.days).toEqual([
      { date: day(3), status: 'absent' },   // present + absent → absent, never present
      { date: day(4), status: 'present' },
      { date: day(5), status: 'late' },
    ]);
    expect(res.body.data.summary).toEqual({ present: 1, absent: 1, late: 1, total: 3, percentage: 33 });
  });

  test('exceptions carry their note, newest first — the reason is the point', async () => {
    mockCollections.attendance._seed.push(
      { schoolId: SCHOOL, studentId: CHILD, date: day(2), status: 'late',   note: 'Bus delay' },
      { schoolId: SCHOOL, studentId: CHILD, date: day(9), status: 'absent', note: 'Fever' },
      { schoolId: SCHOOL, studentId: CHILD, date: day(7), status: 'present' },
    );

    const res = await supertest(buildApp()).get(`/api/parent-portal/attendance/${CHILD}?month=${THIS_MONTH}`);
    expect(res.body.data.exceptions).toEqual([
      { date: day(9), status: 'absent', note: 'Fever' },
      { date: day(2), status: 'late',   note: 'Bus delay' },
    ]);
  });

  test('an unparseable month falls back to the current one instead of erroring', async () => {
    const res = await supertest(buildApp()).get(`/api/parent-portal/attendance/${CHILD}?month=last-tuesday`);
    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe(THIS_MONTH);
  });

  test('a month with no records is empty, not zero-percent-with-a-full-month', async () => {
    const res = await supertest(buildApp()).get(`/api/parent-portal/attendance/${CHILD}?month=2019-04`);
    expect(res.body.data.days).toEqual([]);
    expect(res.body.data.summary).toEqual({ present: 0, absent: 0, late: 0, total: 0, percentage: 0 });
  });

  test('another family’s child is refused', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/attendance/stu_someone_else');
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

/* ── Screen 6 — term report ─────────────────────────────────────── */

describe('GET /api/parent-portal/report/:childId', () => {
  test('marks come from the published snapshot, with the teacher’s remark verbatim', async () => {
    mockCollections.report_card_snapshots._seed.push({
      id: 'rc_2', schoolId: SCHOOL, studentId: CHILD, status: 'published', superseded: false,
      academicYear: '2026', termNumber: 3, termName: 'Term 3', publishedAt: '2026-10-01',
      averageScore: 88, totalScore: 640, gpa: 3.6, rankings: { class: 3, stream: 3 },
      classTeacherRemark: 'Brian has grown in confidence this term.',
      subjects: { sub_math: { finalScore: 82, grade: 'A-' } },
    });
    mockCollections.report_card_snapshots._seed.push({
      id: 'rc_1', schoolId: SCHOOL, studentId: CHILD, status: 'published', superseded: false,
      academicYear: '2026', termNumber: 2, publishedAt: '2026-06-01', averageScore: 82,
      subjects: { sub_math: { finalScore: 78, grade: 'B+' } },
    });
    mockCollections.subjects._seed.push({ id: 'sub_math', schoolId: SCHOOL, name: 'Mathematics' });

    const res = await supertest(buildApp()).get(`/api/parent-portal/report/${CHILD}`);

    expect(res.status).toBe(200);
    expect(res.body.data.latest.averageScore).toBe(88);
    expect(res.body.data.latest.classTeacherRemark).toBe('Brian has grown in confidence this term.');
    expect(res.body.data.subjects).toEqual([
      { subjectId: 'sub_math', subjectName: 'Mathematics', finalScore: 82, grade: 'A-' },
    ]);
    expect(res.body.data.trend).toEqual([
      { label: '2026 T2', average: 82 },
      { label: '2026 T3', average: 88 },
    ]);
    expect(res.body.data.classTeacher).toBe('Mrs. Otieno Mwangi');
  });

  test('no published report yet is a null latest, not an error and not zeros', async () => {
    const res = await supertest(buildApp()).get(`/api/parent-portal/report/${CHILD}`);
    expect(res.status).toBe(200);
    expect(res.body.data.latest).toBeNull();
    expect(res.body.data.subjects).toEqual([]);
  });
});

/* ── Screen 7 — notice board ────────────────────────────────────── */

describe('GET /api/parent-portal/notices', () => {
  beforeEach(() => {
    mockCollections.announcements._seed.push(
      { id: 'an_1', schoolId: SCHOOL, title: 'Fee reminder', body: 'Term 3 balance is due on 5 November.', createdAt: '2026-10-20', priority: 'high' },
      { id: 'an_2', schoolId: SCHOOL, title: 'Sports day', body: 'Friday, 9am.', createdAt: '2026-10-19', priority: 'normal' },
      { id: 'an_3', schoolId: SCHOOL, title: 'Staff briefing', body: 'Internal only.', createdAt: '2026-10-18', priority: 'normal', audience: ['staff'] },
      { id: 'an_4', schoolId: SCHOOL, title: 'Parents meeting', body: 'Saturday.', createdAt: '2026-10-17', priority: 'normal', audience: ['parents'] },
    );
  });

  test('staff-only posts never reach a parent, and money notices are flagged', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/notices');

    expect(res.status).toBe(200);
    const titles = res.body.data.notices.map((n) => n.title);
    expect(titles).not.toContain('Staff briefing');
    expect(titles).toEqual(expect.arrayContaining(['Fee reminder', 'Sports day', 'Parents meeting']));

    const fee = res.body.data.notices.find((n) => n.id === 'an_1');
    expect(fee.money).toBe(true);     // → the amber card that jumps to Fees
    expect(fee.pinned).toBe(true);
    const sports = res.body.data.notices.find((n) => n.id === 'an_2');
    expect(sports.money).toBe(false);
    expect(sports.pinned).toBe(false);
  });

  test('a notice with no audience is for everyone — absence is not "staff only"', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/notices');
    expect(res.body.data.notices.map((n) => n.id)).toContain('an_2');
  });
});

/* ── Screen 8 — fees ────────────────────────────────────────────── */

describe('GET /api/parent-portal/fees/:childId', () => {
  test('overdue is derived from the due date, and a paid invoice is not "outstanding"', async () => {
    mockCollections.invoices._seed.push(
      { id: 'inv_1', schoolId: SCHOOL, studentId: CHILD, invoiceNumber: 'INV-1041', total: 20000, balance: 0,     dueDate: '2026-06-05', currency: 'KES' },
      { id: 'inv_2', schoolId: SCHOOL, studentId: CHILD, invoiceNumber: 'INV-1042', total: 25000, balance: 12500, dueDate: '2026-11-05', currency: 'KES' },
      { id: 'inv_3', schoolId: SCHOOL, studentId: CHILD, invoiceNumber: 'INV-1039', total: 10000, balance: 3000,  dueDate: '2026-01-05', currency: 'KES', status: 'outstanding' },
    );
    mockCollections.payments._seed.push(
      { id: 'pay_1', schoolId: SCHOOL, studentId: CHILD, amount: 7500, paidAt: '2026-08-12', mpesaCode: 'QK47X2L9', method: 'mpesa', invoiceId: 'inv_2' },
    );

    const res = await supertest(buildApp()).get(`/api/parent-portal/fees/${CHILD}`);

    expect(res.status).toBe(200);
    expect(res.body.data.currencySymbol).toBe('KSh');
    expect(res.body.data.balance).toBe(15500);
    expect(res.body.data.totalBilled).toBe(55000);
    expect(res.body.data.clearancePct).toBe(72);

    const byId = Object.fromEntries(res.body.data.invoices.map((i) => [i.id, i]));
    expect(byId.inv_1.status).toBe('paid');
    expect(byId.inv_2.status).toBe('outstanding');
    expect(byId.inv_3.status).toBe('overdue');   // stored status said outstanding; the date decides

    // The next date a parent can act on: the earliest outstanding due date
    // still ahead, never the past-due one.
    expect(res.body.data.nextDueDate).toBe('2026-11-05');

    expect(res.body.data.receipts[0]).toEqual({
      id: 'pay_1', code: 'QK47X2L9', amount: 7500, paidAt: '2026-08-12', method: 'mpesa', invoiceId: 'inv_2',
    });
  });

  test('an invoice with no number still gets an identity, never a blank row', async () => {
    mockCollections.invoices._seed.push({ id: 'inv_9', schoolId: SCHOOL, studentId: CHILD, total: 100, balance: 100, dueDate: '2026-11-01' });
    const res = await supertest(buildApp()).get(`/api/parent-portal/fees/${CHILD}`);
    expect(res.body.data.invoices[0].invoiceNumber).toBe('inv_9');
  });
});

/* ── Screen 10 — receipt ────────────────────────────────────────── */

describe('GET /api/parent-portal/receipts/:paymentId', () => {
  beforeEach(() => {
    mockCollections.payments._seed.push(
      { id: 'pay_1', schoolId: SCHOOL, studentId: CHILD, amount: 7500, paidAt: '2026-08-12', mpesaCode: 'QK47X2L9', method: 'mpesa', invoiceId: 'inv_2', status: 'completed' },
      { id: 'pay_2', schoolId: SCHOOL, studentId: 'stu_other_family', amount: 9000, paidAt: '2026-08-13', mpesaCode: 'ZZ11AA22', method: 'mpesa', invoiceId: 'inv_9' },
    );
    mockCollections.invoices._seed.push({ id: 'inv_2', schoolId: SCHOOL, studentId: CHILD, invoiceNumber: 'INV-1042', total: 25000, balance: 12500, currency: 'KES' });
  });

  test('renders the settled receipt with the invoice’s CURRENT balance, labelled as such', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/receipts/pay_1');

    expect(res.status).toBe(200);
    expect(res.body.data.receipt.code).toBe('QK47X2L9');
    expect(res.body.data.receipt.amount).toBe(7500);
    expect(res.body.data.child.name).toBe('Brian Kamau');
    expect(res.body.data.invoice.invoiceNumber).toBe('INV-1042');
    expect(res.body.data.invoice.balance).toBe(12500);
    expect(res.body.data.currencySymbol).toBe('KSh');
  });

  test('another family’s receipt is refused — a money document is not guessable', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/receipts/pay_2');
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

/* ── Screens 11 & 12 — inbox and conversation ───────────────────── */

describe('GET /api/parent-portal/inbox', () => {
  beforeEach(() => {
    mockCollections.messages._seed.push(
      // Newest first, as the query asks for.
      { id: 'm_3', schoolId: SCHOOL, senderId: 'usr_bursar', senderName: 'Njeri (Bursar)', senderRole: 'finance', recipients: [PARENT], subject: 'Fee balance', body: 'Balance is 12,500.', createdAt: '2026-10-22T10:00:00.000Z', isRead: {} },
      { id: 'm_2', schoolId: SCHOOL, senderId: PARENT, senderName: 'Mrs. Kamau', senderRole: 'parent', recipients: ['usr_bursar'], subject: 'Fee balance', body: 'I paid 7,500 yesterday.', createdAt: '2026-10-21T10:00:00.000Z', isRead: {} },
      { id: 'm_1', schoolId: SCHOOL, senderId: 'usr_teacher', senderName: 'Mrs. Otieno', senderRole: 'teacher', recipients: [PARENT], subject: 'Homework', body: 'Brian has incomplete work.', createdAt: '2026-10-20T10:00:00.000Z', isRead: { [PARENT]: true } },
      // Another parent's conversation must never appear.
      { id: 'm_x', schoolId: SCHOOL, senderId: 'usr_bursar', senderName: 'Njeri (Bursar)', senderRole: 'finance', recipients: ['usr_other_parent'], subject: 'Private', body: 'Not yours.', createdAt: '2026-10-23T10:00:00.000Z', isRead: {} },
    );
  });

  test('groups by the other person, counts only inbound unread, newest first', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/inbox');

    expect(res.status).toBe(200);
    expect(res.body.data.threads.map((t) => t.counterpartUserId)).toEqual(['usr_bursar', 'usr_teacher']);

    const bursar = res.body.data.threads[0];
    expect(bursar.name).toBe('Njeri (Bursar)');
    expect(bursar.subject).toBe('Fee balance');       // from the latest message
    expect(bursar.preview).toBe('Balance is 12,500.');
    expect(bursar.lastAt).toBe('2026-10-22T10:00:00.000Z');
    expect(bursar.unread).toBe(1);                    // my own reply is not an unread

    const teacher = res.body.data.threads[1];
    expect(teacher.unread).toBe(0);                   // already read
    expect(teacher.counterpartUserId).toBe('usr_teacher');
  });

  test('a conversation I started still resolves the other person’s name', async () => {
    mockCollections.messages._seed.length = 0;
    mockCollections.messages._seed.push(
      { id: 'm_1', schoolId: SCHOOL, senderId: PARENT, senderName: 'Mrs. Kamau', senderRole: 'parent', recipients: ['usr_bursar'], subject: 'Receipt please', body: 'Could I get a receipt?', createdAt: '2026-10-21T10:00:00.000Z', isRead: {} },
    );
    mockCollections.users._seed.push({ id: 'usr_bursar', schoolId: SCHOOL, name: 'Njeri', role: 'finance' });

    const res = await supertest(buildApp()).get('/api/parent-portal/inbox');
    expect(res.body.data.threads[0].name).toBe('Njeri');
    expect(res.body.data.threads[0].role).toBe('finance');
  });

  /* A "thread" is only ever a LOOKUP PAIR — the messages collection has no
     thread document — so a message that went to several people still lands
     under one of them. Without the recipient fields on the row the app would
     present that as a private conversation with one bursar. */
  test('a send to several staff says so, on the row it was paired into', async () => {
    mockCollections.messages._seed.length = 0;
    mockCollections.messages._seed.push(
      { id: 'm_1', schoolId: SCHOOL, senderId: PARENT, senderName: 'Mrs. Kamau', senderRole: 'parent', recipients: ['usr_bursar', 'usr_head', 'usr_discipline'], subject: 'Uniform', body: 'Please advise.', createdAt: '2026-10-21T10:00:00.000Z', isRead: {} },
    );

    const res = await supertest(buildApp()).get('/api/parent-portal/inbox');
    const row = res.body.data.threads[0];
    expect(row.counterpartUserId).toBe('usr_bursar');   // the pairing is unchanged…
    expect(row.recipientCount).toBe(3);                 // …but it is not presented as 1:1
    expect(row.multiRecipient).toBe(true);
    expect(row.groupId).toBeNull();
    expect(row.groupName).toBeNull();
  });

  test('a saved-group send names the group; a school-wide notice does not claim recipients', async () => {
    mockCollections.messages._seed.length = 0;
    mockCollections.messages._seed.push(
      { id: 'm_grp', schoolId: SCHOOL, senderId: 'usr_head', senderName: 'Mr. Otieno', senderRole: 'principal', recipients: [PARENT, 'usr_bursar'], groupId: 'grp_junior', groupName: 'Junior School Team', subject: 'Sports day', body: 'Report at 8.', createdAt: '2026-10-22T10:00:00.000Z', isRead: {} },
      { id: 'm_bcast', schoolId: SCHOOL, senderId: 'usr_office', senderName: 'Front Desk', senderRole: 'admin', recipients: ['parents'], subject: 'Term ends Friday', body: 'Half term.', createdAt: '2026-10-21T09:00:00.000Z', isRead: {} },
    );

    const res = await supertest(buildApp()).get('/api/parent-portal/inbox');
    const bySubject = Object.fromEntries(res.body.data.threads.map((t) => [t.subject, t]));

    expect(bySubject['Sports day'].groupName).toBe('Junior School Team');
    expect(bySubject['Sports day'].groupId).toBe('grp_junior');
    expect(bySubject['Sports day'].recipientCount).toBe(2);
    expect(bySubject['Sports day'].multiRecipient).toBe(true);

    // An audience key is a broadcast, not a named recipient — so a notice is
    // not dressed up as a two-person group chat.
    expect(bySubject['Term ends Friday'].recipientCount).toBe(0);
    expect(bySubject['Term ends Friday'].multiRecipient).toBe(false);
  });
});

describe('GET /api/parent-portal/threads/:counterpartUserId', () => {
  beforeEach(() => {
    mockCollections.messages._seed.push(
      { id: 'm_2', schoolId: SCHOOL, senderId: 'usr_bursar', senderName: 'Njeri', senderRole: 'finance', recipients: [PARENT], subject: 'Fee balance', body: 'Balance is 12,500.', createdAt: '2026-10-22T10:00:00.000Z', isRead: {} },
      { id: 'm_1', schoolId: SCHOOL, senderId: PARENT, senderName: 'Mrs. Kamau', senderRole: 'parent', recipients: ['usr_bursar'], subject: 'Fee balance', body: 'I paid yesterday.', createdAt: '2026-10-21T10:00:00.000Z', isRead: {} },
    );
    mockCollections.users._seed.push({ id: 'usr_bursar', schoolId: SCHOOL, name: 'Njeri', role: 'finance' });
  });

  test('returns the conversation oldest-first and marks the inbound as read on open', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/threads/usr_bursar');

    expect(res.status).toBe(200);
    expect(res.body.data.counterpart.name).toBe('Njeri');
    expect(res.body.data.messages.map((m) => m.mine)).toEqual([true, false]);
    expect(res.body.data.messages[0].body).toBe('I paid yesterday.');   // chronological
    expect(res.body.data.messages[0].multiRecipient).toBe(false);       // a real 1:1 pair

    const Msg = mockCollections.messages;
    expect(Msg.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = Msg.updateMany.mock.calls[0];
    expect(filter.id.$in).toEqual(['m_2']);                 // only the inbound one
    expect(update.$set[`isRead.${PARENT}`]).toBe(true);
  });

  test('a bubble that went to several people carries that, so the app can withhold one person’s read tick', async () => {
    mockCollections.messages._seed.length = 0;
    mockCollections.messages._seed.push(
      { id: 'm_1', schoolId: SCHOOL, senderId: PARENT, senderName: 'Mrs. Kamau', senderRole: 'parent', recipients: ['usr_bursar', 'usr_head'], subject: 'Uniform', body: 'Please advise.', createdAt: '2026-10-21T10:00:00.000Z', isRead: { usr_bursar: true } },
      { id: 'm_2', schoolId: SCHOOL, senderId: 'usr_bursar', senderName: 'Njeri', senderRole: 'finance', recipients: [PARENT], subject: 'Uniform', body: 'Noted with thanks.', createdAt: '2026-10-22T10:00:00.000Z', isRead: {} },
    );

    const res = await supertest(buildApp()).get('/api/parent-portal/threads/usr_bursar');
    const [mine, theirs] = res.body.data.messages;

    expect(mine.mine).toBe(true);
    expect(mine.recipientCount).toBe(2);
    expect(mine.multiRecipient).toBe(true);
    // `read` here answers "did THIS person open it" — true, and still not a
    // claim that the whole group has. The app has both facts to choose from.
    expect(mine.read).toBe(true);

    expect(theirs.recipientCount).toBe(1);
    expect(theirs.multiRecipient).toBe(false);
  });
});

describe('POST /api/parent-portal/threads/:counterpartUserId/messages', () => {
  beforeEach(() => {
    mockCollections.users._seed.push({ id: 'usr_bursar', schoolId: SCHOOL, name: 'Njeri', role: 'finance', isActive: true });
  });

  test('sends through the same direct-message path the compose screen uses', async () => {
    const res = await supertest(buildApp())
      .post('/api/parent-portal/threads/usr_bursar/messages')
      .send({ body: 'Thank you.', subject: 'Fee balance' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('msg_sent_1');
    expect(messageRoutes.createDirectMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipientUserIds: ['usr_bursar'], body: 'Thank you.', senderRole: 'parent' }),
    );
  });

  test('a recipient who is not in this school is refused, so an id cannot cross tenants', async () => {
    const res = await supertest(buildApp())
      .post('/api/parent-portal/threads/usr_from_another_school/messages')
      .send({ body: 'Hello?' });

    expect(res.status).toBe(400);
    expect(messageRoutes.createDirectMessage).not.toHaveBeenCalled();
  });

  test('an empty message is refused', async () => {
    const res = await supertest(buildApp())
      .post('/api/parent-portal/threads/usr_bursar/messages')
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });
});

/* ── Screen 13 — profile ────────────────────────────────────────── */

describe('GET /api/parent-portal/profile', () => {
  test('primary vs co-guardian survives to the client', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/profile');

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.children.map((c) => [c.id, c]));
    expect(byId[CHILD].relationship).toBe('primary');
    expect(byId[CHILD].isPrimary).toBe(true);
    expect(byId[SIBLING].relationship).toBe('co-guardian');
    expect(byId[SIBLING].isPrimary).toBe(false);
    expect(res.body.data.school.name).toBe('Riverside Academy');
    expect(res.body.data.user.email).toBe('kamau@example.com');
  });
});
