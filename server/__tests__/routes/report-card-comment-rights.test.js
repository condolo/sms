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
// hasPermission defaults to false — none of this file's fixture roles
// (a plain teacher, or admin via the separate isManagement bypass) rely on
// an explicit report_cards grant. A dedicated test below sets this true to
// cover the one case that does: a non-management role an admin explicitly
// granted full report_cards access to.
const mockHasPermission = jest.fn(async () => false);
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => false),
  hasPermission: (...args) => mockHasPermission(...args),
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
    // Mongo's implicit array-contains-scalar: a doc field that's an array
    // matches a scalar filter value when the array contains it — needed
    // for resolveRcTemplate's `classIds: classId` lookup (classIds is an
    // array field, queried with the single classId to check).
    if (Array.isArray(val)) return val.includes(v);
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
    // GET /draft-comments?classId= resolves the roster via students.distinct('id', ...)
    // rather than trusting a draft doc's own (possibly stale) classId field.
    distinct: async (field, f) => [...new Set(rows().filter(d => matches(d, f)).map(d => d[field]))],
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
  mockHasPermission.mockClear();
  mockHasPermission.mockImplementation(async () => false);
  mockDb = {
    students: [
      { id: 'stu1', schoolId: SCHOOL, classId: 'c8a', streamId: 'st_A' },
      { id: 'stu2', schoolId: SCHOOL, classId: 'c8a', streamId: 'st_B' },
    ],
    teaching_assignments: [
      { schoolId: SCHOOL, teacherId: 't1', classId: 'c8a', subjectId: 'bio', streamId: 'st_A' },
      { schoolId: SCHOOL, teacherId: 't1', classId: 'c8a', subjectId: 'math', streamId: null },
    ],
    // Curriculum-integrity guard (new): a comment write now hard-requires
    // a class_subjects link for {classId, subjectId}, for every role.
    // bio/math are genuinely in c8a's curriculum here, same as they
    // would be in a real school with teaching_assignments rows for them.
    class_subjects: [
      { schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', isCompulsoryForClass: true },
      { schoolId: SCHOOL, classId: 'c8a', subjectId: 'math', isCompulsoryForClass: true },
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

  // Reported directly: "my 85-word comment won't fit, only 73 words
  // accepted" — raised from 500 to 1000, matching every other report-card
  // comment field (class teacher's/principal's remark) for no principled
  // reason this one alone was half the room.
  test('a comment over 1000 characters is refused', async () => {
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  test('a comment of exactly 1000 characters is accepted', async () => {
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'x'.repeat(1000) });
    expect(res.status).toBe(200);
  });
});

describe('subject comment — rejected outright for a Kindergarten class (2026-10-13)', () => {
  test('a class with an active rc_template assigned to it refuses a subject comment, even from a teacher who otherwise has the write right', async () => {
    mockDb.rc_templates = [
      { schoolId: SCHOOL, id: 'tpl1', classIds: ['c8a'], status: 'active' },
    ];
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Excellent work.' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Kindergarten/i);
    // Never written — the doc's subjectComments.bio stays exactly what it was seeded with.
    const doc = mockDb.report_card_draft_comments.find(d => d.studentId === 'stu1');
    expect(doc.subjectComments.bio).toBe('Strong bio');
  });

  test('the class teacher remark route is unaffected by the same rc_template', async () => {
    mockDb.rc_templates = [
      { schoolId: SCHOOL, id: 'tpl1', classIds: ['c8a'], status: 'active' },
    ];
    const res = await supertest(buildApp())
      .put(`/api/report-cards/draft-comments/stu1`)
      .send({ termNumber: 3, classTeacherRemark: 'Updated remark' });
    expect(res.status).toBe(200);
  });
});

describe('subject comment — never locked by marks (2026-10-11)', () => {
  // Reported directly: a teacher must be able to submit marks for review
  // then write the comment afterward, or write it first and submit marks
  // later, in either order — commentLockState (and the audited-override
  // path for it) is gone entirely, not narrowed.
  test('a teacher can still edit the comment after the subject\'s marks are submitted', async () => {
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', termNumber: 3, status: 'submitted' });
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Changed' });
    expect(res.status).toBe(200);
    expect(mockDb.report_card_draft_comments.find(d => d.studentId === 'stu1').subjectComments.bio).toBe('Changed');
  });

  test('a teacher can still edit the comment after the subject\'s marks are approved or locked', async () => {
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', termNumber: 3, status: 'locked' });
    const res = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Still editable' });
    expect(res.status).toBe(200);
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'report_comment.locked_edit' })); // nothing left to "override"
  });

  test('a comment can be written before marks exist at all, and marks can be submitted after — neither direction blocks the other', async () => {
    // Comment first.
    const commentRes = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Written before any marks submission' });
    expect(commentRes.status).toBe(200);
    // Marks submitted after — submission itself is a different route (mark-submissions.js),
    // but the mark_submissions row it would create is simulated here directly: the point is
    // that the EXISTING comment is untouched and still editable afterward.
    mockDb.mark_submissions.push({ schoolId: SCHOOL, classId: 'c8a', subjectId: 'bio', termNumber: 3, status: 'approved' });
    const secondEdit = await supertest(buildApp()).put(subjectUrl('stu1', 'bio')).send({ termNumber: 3, comment: 'Edited again after marks approved' });
    expect(secondEdit.status).toBe(200);
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

describe('every class-teacher-tier field is guarded the same way as classTeacherRemark (2026-10-15)', () => {
  // Reported directly, traced to a real silent-data-loss path: GET
  // /draft-comments strips this whole doc down to subjectComments only
  // for any non-form-tutor, non-management caller — so a subject-only
  // teacher's local view of classTeacherName/sportsAndTalent/closingDate/
  // nextTermBegin/observationRatings always defaults to blank. Only
  // classTeacherRemark and principalRemark were ever guarded against
  // being silently overwritten when "changed" from that blank default —
  // every other field here was written unconditionally, by anyone
  // holding report_cards:update, with no check at all.
  const draftUrl = (studentId) => `/api/report-cards/draft-comments/${studentId}`;

  test('sportsAndTalent cannot be changed by a teacher who is not the stream\'s form tutor', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, sportsAndTalent: 'Silently overwritten' });
    expect(res.status).toBe(403);
    expect(mockDb.report_card_draft_comments.find(d => d.studentId === 'stu2').sportsAndTalent).not.toBe('Silently overwritten');
  });

  test('closingDate cannot be changed by a non-form-tutor', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, closingDate: '2026-12-01' });
    expect(res.status).toBe(403);
  });

  test('nextTermBegin cannot be changed by a non-form-tutor', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, nextTermBegin: '2027-01-10' });
    expect(res.status).toBe(403);
  });

  test('classTeacherName cannot be changed by a non-form-tutor', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, classTeacherName: 'Hijacked Name' });
    expect(res.status).toBe(403);
  });

  test('observationRatings cannot be changed by a non-form-tutor', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, observationRatings: { punctuality: 'excellent' } });
    expect(res.status).toBe(403);
  });

  test('the stream\'s real form tutor CAN change all of these for her own stream', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({
      termNumber: 3, sportsAndTalent: 'Captain of the football team', closingDate: '2026-12-01',
      nextTermBegin: '2027-01-10', classTeacherName: 'Ms Teacher',
    });
    expect(res.status).toBe(200);
    const doc = mockDb.report_card_draft_comments.find(d => d.studentId === 'stu1');
    expect(doc.sportsAndTalent).toBe('Captain of the football team');
  });

  test('echoing an unchanged sportsAndTalent value back (e.g. still blank) is not refused, same as the existing classTeacherRemark echo case', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, sportsAndTalent: '' });
    expect(res.status).toBe(200);
  });

  test('a subject-only teacher saving the bulk form after writing their own subject comment does not blank sportsAndTalent for a DIFFERENT, already-set value', async () => {
    // Seed stu2's draft with a real sportsAndTalent entry — simulating the
    // form tutor having already written it via the full, unstripped doc.
    mockDb.report_card_draft_comments.find(d => d.studentId === 'stu2').sportsAndTalent = 'Chess club captain';
    // t1 is NOT stu2's form tutor — their local view (per scopeDraftCommentsForCaller)
    // would never include sportsAndTalent at all, defaulting their save payload to ''.
    const res = await supertest(buildApp()).put(draftUrl('stu2')).send({ termNumber: 3, sportsAndTalent: '' });
    expect(res.status).toBe(403); // blocked outright — never silently written
    expect(mockDb.report_card_draft_comments.find(d => d.studentId === 'stu2').sportsAndTalent).toBe('Chess club captain');
  });
});

describe('PUT /draft-comments/:studentId enforces the same length caps the client advertises (platform audit, 2026-10-18)', () => {
  // Reported gap: this route — the one the UI actually calls — had NO
  // length validation at all for classTeacherRemark/sportsAndTalent/
  // classTeacherName/etc. A client-side maxLength was the only thing
  // stopping an unbounded write. CommentSchema (above, in report-cards.js)
  // already capped classTeacherRemark/principalRemark at 1000 but was only
  // ever wired to the legacy PUT /:id/comments route.
  const draftUrl = (studentId) => `/api/report-cards/draft-comments/${studentId}`;

  test('classTeacherRemark over 1000 chars is rejected', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, classTeacherRemark: 'x'.repeat(1001) });
    expect(res.status).toBe(422);
  });

  test('classTeacherRemark at exactly 1000 chars is accepted', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, classTeacherRemark: 'x'.repeat(1000) });
    expect(res.status).toBe(200);
  });

  test('sportsAndTalent over 1000 chars is rejected', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, sportsAndTalent: 'x'.repeat(1001) });
    expect(res.status).toBe(422);
  });

  test('classTeacherName over 200 chars is rejected', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, classTeacherName: 'x'.repeat(201) });
    expect(res.status).toBe(422);
  });

  test('closingDate over 100 chars is rejected', async () => {
    const res = await supertest(buildApp()).put(draftUrl('stu1')).send({ termNumber: 3, closingDate: 'x'.repeat(101) });
    expect(res.status).toBe(422);
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

  /* Reported directly: a role outside MANAGEMENT_ROLES (e.g. exams_officer)
     explicitly granted full report_cards access via Settings' Role
     Permissions editor saw every comment filtered out — the hardcoded
     management list, not the school's own RBAC grant, decided visibility.
     Confirmed root cause and fixed in comment-scope.js. */
  test('a non-management role explicitly granted full report_cards access sees every draft unchanged, same as management', async () => {
    mockUser = { userId: 'exo1', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockFormStreamIds = []; // not a form tutor
    mockDb.teaching_assignments = []; // not a teacher of anything — the exact shape of the real bug
    mockHasPermission.mockImplementation(async (_req, mod, action) => mod === 'report_cards' && action === 'update');
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments?termNumber=3');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.find(d => d.studentId === 'stu2').classTeacherRemark).toBe('Other stream note');
  });

  test('a role with only report_cards:read (not update) is still scoped down like an ordinary caller', async () => {
    mockUser = { userId: 'exo1', schoolId: SCHOOL, role: 'exams_officer', roles: ['exams_officer'] };
    mockFormStreamIds = [];
    mockDb.teaching_assignments = [];
    mockHasPermission.mockImplementation(async (_req, mod, action) => mod === 'report_cards' && action === 'read');
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments?termNumber=3');
    expect(res.body.data).toEqual([]);
  });
});
