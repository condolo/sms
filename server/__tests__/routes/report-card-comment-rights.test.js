/* ============================================================
   Report comment rights — subject comments, class teacher remark,
   lock with an audited admin override, and what each caller can read.

   Fixture:
     stu1 is in stream st_A, stu2 in stream st_B (both class c8a).
     t1 teaches Biology in st_A only, and Maths to the whole class.
     t1 is form teacher of st_A only.
     Bio/Maths are the subjects; Eng is taught by nobody t1 knows.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

let mockUser = null;
let mockFormStreamIds = [];
const mockAuditLog = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { ...mockUser }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => true),
  hasPermission: () => true,
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/scopeEngine', () => ({
  resolveHomeroomStreamIds: async () => mockFormStreamIds,
}));

let mockDb = {};
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matches(doc, sub));
    if (k === '$and') return v.every(sub => matches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.some(x => x === val || (x == null && val == null));
      if ('$exists' in v) return (val !== undefined) === v.$exists;
    }
    if (v === null) return val == null;
    return val === v;
  });
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) { cur[p] = cur[p] ?? {}; cur = cur[p]; }
  cur[parts[parts.length - 1]] = value;
}
function makeStore(col) {
  const rows = () => (mockDb[col] = mockDb[col] || []);
  const chain = (result) => {
    const c = { sort: () => c, select: () => c, lean: () => Promise.resolve(result) };
    return c;
  };
  return {
    find: (f) => chain(rows().filter(d => matches(d, f))),
    findOne: (f) => chain(rows().find(d => matches(d, f)) ?? null),
    findOneAndUpdate: (f, update) => {
      let doc = rows().find(d => matches(d, f));
      if (!doc) { doc = { ...f }; rows().push(doc); }
      for (const [path, value] of Object.entries(update.$set || {})) setPath(doc, path, value);
      return chain(doc);
    },
    create: async (d) => { rows().push(d); return d; },
  };
}
jest.mock('../../utils/tenant-model', () => {
  const actual = jest.requireActual('../../utils/tenant-model');
  return { ...actual, tenantModel: (col) => global.__store(col) };
});
beforeAll(() => { global.__store = makeStore; });

const express = require('express');
const supertest = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

const TEACHER = { userId: 't1', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
const ADMIN   = { userId: 'a1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };

beforeEach(() => {
  mockUser = { ...TEACHER };
  mockFormStreamIds = ['st_A'];
  mockAuditLog.mockClear();
  mockDb = {
    students: [
      { id: 'stu1', schoolId: SCHOOL, classId: 'c8a', streamId: 'st_A' },
      { id: 'stu2', schoolId: SCHOOL, classId: 'c8a', streamId: 'st_B' },
    ],
    teaching_assignments: [
      { schoolId: SCHOOL, teacherId: 't1', classId: 'c8a', subjectId: 'bio', streamId: 'st_A' },
      { schoolId: SCHOOL, teacherId: 't1', classId: 'c8a', subjectId: 'math', streamId: null },
    ],
    mark_submissions: [],
    report_card_draft_comments: [
      { schoolId: SCHOOL, studentId: 'stu1', classId: 'c8a', termNumber: 3,
        classTeacherRemark: 'Form tutor note', principalRemark: '',
        subjectComments: { bio: 'Strong bio', math: 'Good maths', eng: 'English note' } },
      { schoolId: SCHOOL, studentId: 'stu2', classId: 'c8a', termNumber: 3,
        classTeacherRemark: 'Other stream note', principalRemark: '',
        subjectComments: { bio: 'Bio for stu2', math: 'Maths for stu2' } },
    ],
  };
});

const subjectUrl = (studentId, subjectId) => `/api/report-cards/draft-comments/${studentId}/subject/${subjectId}`;

describe('subject comment — same rights as marks', () => {
  test('a teacher assigned to the subject in the student\'s stream can write it', async () => {
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Excellent work.' });
    expect(res.status).toBe(200);
    const doc = mockDb.report_card_draft_comments.find(d => d.studentId === 'stu1');
    expect(doc.subjectComments.bio).toBe('Excellent work.');
  });

  test('a teacher assigned to the subject only in another stream is refused', async () => {
    const res = await supertest(buildApp()).put(subjectUrl('stu2', 'bio')).send({ termNumber: 3, comment: 'Nope' });
    expect(res.status).toBe(403);
  });

  test('a comment over 500 characters is refused', async () => {
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });
});

describe('subject comment — locks with the mark submission', () => {
  test('a teacher cannot edit once the subject\'s marks are submitted', async () => {
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', termNumber: 3, status: 'submitted' });
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Changed' });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body)).toMatch(/locked/);
  });

  test('an administrator can still edit a locked comment, and that edit is audited', async () => {
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', termNumber: 3, status: 'approved' });
    mockUser = { ...ADMIN };
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Corrected' });
    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'report_comment.locked_edit' }));
  });

  test('a submission for one stream locks only that stream, not the other streams of the class', async () => {
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'math', termNumber: 3, status: 'submitted', streamId: 'st_A' });
    const locked = await supertest(buildApp()).put(subjectUrl('stu1', 'math')).send({ termNumber: 3, comment: 'x' });
    expect(locked.status).toBe(403);
    const open = await supertest(buildApp()).put(subjectUrl('stu2', 'math')).send({ termNumber: 3, comment: 'Open stream' });
    expect(open.status).toBe(200);
  });

  test('a draft mark submission does not lock comments', async () => {
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', termNumber: 3, status: 'draft' });
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Still open' });
    expect(res.status).toBe(200);
  });
});

describe('whole-record save — no bulk subject comments, class remark owned by the form tutor', () => {
  const draftUrl = (studentId) => `/api/report-cards/draft-comments/${studentId}`;

  test('a save that still carries subjectComments is refused and points at the per-subject route', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, subjectComments: { bio: 'x' } });
    expect(res.status).toBe(400);
  });

  test('a form tutor can change the class remark for her own stream', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, classTeacherRemark: 'Updated by tutor' });
    expect(res.status).toBe(200);
  });

  test('a teacher who is not the form tutor of the stream cannot change its class remark', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, classTeacherRemark: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(mockDb.report_card_draft_comments.find(d => d.studentId === 'stu2').classTeacherRemark).toBe('Other stream note');
  });

  test('echoing an unchanged class remark back is not refused', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, classTeacherRemark: 'Other stream note', principalRemark: '' });
    expect(res.status).toBe(200);
  });

  test('only an admin can change the principal remark', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, principalRemark: 'Teacher tries' });
    expect(res.status).toBe(403);
  });
});

describe('reading draft comments', () => {
  test('a form tutor sees the full draft for her own stream', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments?termNumber=3');
    const own = res.body.data.find(d => d.studentId === 'stu1');
    expect(own.classTeacherRemark).toBe('Form tutor note');
    expect(Object.keys(own.subjectComments).sort()).toEqual(['bio', 'eng', 'math']);
  });

  test('for another stream a teacher sees only the subject comments she teaches there', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments?termNumber=3');
    const other = res.body.data.find(d => d.studentId === 'stu2');
    expect(other.classTeacherRemark).toBeUndefined();
    expect(other.principalRemark).toBeUndefined();
    expect(other.subjectComments).toEqual({ math: 'Maths for stu2' });
  });

  test('a teacher with no form stream and no teaching link for a stream sees nothing from it', async () => {
    mockFormStreamIds = [];
    mockDb.teaching_assignments = [];
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments?termNumber=3');
    expect(res.body.data).toEqual([]);
  });

  test('management sees every draft unchanged', async () => {
    mockUser = { ...ADMIN };
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments?termNumber=3');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.find(d => d.studentId === 'stu2').classTeacherRemark).toBe('Other stream note');
  });
});
