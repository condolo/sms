/* ============================================================
   Report comments (v5.280.0) — utils/report-comments.js and the
   report-cards routes that use it: one Markbook box per term, per
   academic year; a cycle report prints it; a published report keeps its
   own; the box reopens by the assessment schedule.
   ============================================================ */
'use strict';

const { createFakeDb } = require('./fixtures/fake-tenant-db');

let mockDb;
let mockUser;
let mockArchived;
/* The fixture has no upsert; a comment save needs one. */
function mockModel(name) {
  const m = mockDb.model(name);
  return {
    ...m,
    findOneAndUpdate: (filter, update, options = {}) => ({
      lean: async () => {
        const hit = await m.findOneAndUpdate(filter, update).lean();
        if (hit || !options.upsert) return hit;
        await m.create({ _id: `new_${mockDb.data[name].length + 1}`, ...filter });
        return m.findOneAndUpdate(filter, update).lean();
      },
    }),
  };
}

jest.mock('../utils/tenant-model', () => ({
  tenantModel: (name) => mockModel(name),
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
}));
jest.mock('../utils/model', () => ({ _model: (name) => mockModel(name) }));
jest.mock('../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = mockUser; next(); } }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n(), hasPermission: async () => true, hasExplicitSubGrant: async () => true }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../middleware/module-gate', () => ({ moduleGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn(async (_s, y) => mockArchived === y) }));
jest.mock('../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/job-queue', () => ({ enqueueJob: jest.fn(), registerHandler: jest.fn() }));

const express   = require('express');
const supertest = require('supertest');
const rc = require('../utils/report-comments');
const router = require('../routes/report-cards');

const SCHOOL = 'sch_1';
const CTX = { schoolId: SCHOOL };
const YEARS = [
  { id: 'y25', schoolId: SCHOOL, startDate: '2025-01-06', endDate: '2025-11-28', terms: [] },
  { id: 'y26', schoolId: SCHOOL, startDate: '2026-01-05', endDate: '2026-11-27', terms: [], isCurrent: true },
];
const SCOPE26 = { yearId: 'y26', currentYearId: 'y26', years: YEARS };
const SCOPE25 = { yearId: 'y25', currentYearId: 'y26', years: YEARS };
const row = (o) => ({ _id: `r_${Math.random()}`, schoolId: SCHOOL, studentId: 'stu_1', classId: 'cls_1', termNumber: 1, cycle: null, ...o });
const win = (assessmentType, dateFrom, dateTo, o = {}) => ({ schoolId: SCHOOL, termNumber: 1, instance: 1, assessmentType, dateFrom, dateTo, academicYearId: 'y26', ...o });
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const app = express();
app.use(express.json());
app.use('/rc', router);
const save = (comment, extra = {}) => supertest(app).put('/rc/draft-comments/stu_1/subject/math').send({ termNumber: 1, comment, ...extra });
const list = (extra = {}) => supertest(app).get('/rc/draft-comments').query({ classId: 'cls_1', termNumber: 1, ...extra });
const drafts = () => mockDb.data.report_card_draft_comments;

beforeEach(() => {
  mockArchived = null;
  mockUser = { schoolId: SCHOOL, userId: 'u1', role: 'admin', roles: ['admin'], name: 'Admin' };
  mockDb = createFakeDb({
    academic_years: YEARS,
    students: [{ id: 'stu_1', schoolId: SCHOOL, classId: 'cls_1', streamId: 'st_a' }],
    class_subjects: [{ schoolId: SCHOOL, classId: 'cls_1', subjectId: 'math' }],
    report_card_draft_comments: [], report_card_snapshots: [], assessment_schedule: [], student_class_history: [],
  });
});

describe('which year a comment belongs to', () => {
  test('a comment without a year stays visible in the current year it was saved in', () => {
    expect(rc.untaggedBelongsTo('2026-05-01', SCOPE26)).toBe(true);
    expect(rc.untaggedBelongsTo('2026-05-01', SCOPE25)).toBe(false);
  });
  test('last year’s comment is not shown in the new year, and is found in its own', () => {
    expect(rc.untaggedBelongsTo('2025-05-01', SCOPE26)).toBe(false);
    expect(rc.untaggedBelongsTo('2025-05-01', SCOPE25)).toBe(true);
  });
  test('a live comment never disappears when years have no dates, or overlap', () => {
    const undated = { yearId: 'a', currentYearId: 'a', years: [{ id: 'a' }, { id: 'b' }] };
    expect(rc.untaggedBelongsTo('2020-01-01', undated)).toBe(true);
    expect(rc.untaggedBelongsTo(null, SCOPE26)).toBe(true);
    const overlap = { yearId: 'a', currentYearId: 'a', years: [{ id: 'a', startDate: '2026-01-01' }, { id: 'b', startDate: '2026-01-01' }] };
    expect(rc.untaggedBelongsTo('2026-03-01', overlap)).toBe(true);
  });
  test('a school with no academic year set up works as before', () => {
    expect(rc.untaggedBelongsTo('2019-01-01', { yearId: null, years: [], currentYearId: null })).toBe(true);
  });
  test('an unknown year in a request falls back to the current year; a database id means the same year', async () => {
    mockDb.data.academic_years[1]._id = 'dbid26';
    const { resolveCurrentPeriod } = require('../routes/academic-config');
    expect((await rc.commentYear(CTX, SCHOOL, 'gone', resolveCurrentPeriod)).yearId).toBe('y26');
    expect((await rc.commentYear(CTX, SCHOOL, 'dbid26', resolveCurrentPeriod)).yearId).toBe('y26');
    expect((await rc.commentYear(CTX, SCHOOL, 'y25', resolveCurrentPeriod)).yearId).toBe('y25');
  });
});

describe('saving in the Markbook', () => {
  test('a comment saved before the update is kept and edited in place, never duplicated', async () => {
    drafts().push(row({ _id: 'old', updatedAt: '2026-05-01', classTeacherRemark: 'Keep me', subjectComments: { eng: 'English', math: 'Old' } }));
    expect((await save('New')).status).toBe(200);
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0]).toMatchObject({ _id: 'old', academicYearId: 'y26', classTeacherRemark: 'Keep me', subjectComments: { eng: 'English', math: 'New' } });
  });
  test('a new year starts empty and leaves last year’s comment untouched', async () => {
    drafts().push(row({ _id: 'old', updatedAt: '2025-05-01', subjectComments: { math: 'Last year' } }));
    expect((await list()).body.data).toEqual([]);
    expect((await save('This year')).status).toBe(200);
    expect(drafts().find(d => d._id === 'old')).toMatchObject({ subjectComments: { math: 'Last year' } });
    expect(drafts().find(d => d._id === 'old').academicYearId).toBeUndefined();
    expect((await list()).body.data[0].subjectComments.math).toBe('This year');
    expect((await list({ academicYearId: 'y25' })).body.data[0].subjectComments.math).toBe('Last year');
  });
  test('an archived year can be read, not written', async () => {
    mockArchived = 'y25';
    expect((await save('x', { academicYearId: 'y25' })).status).toBe(403);
    expect(drafts()).toHaveLength(0);
  });
  test('a past year also lists the learners who were in the class then', async () => {
    mockDb.data.students[0].classId = 'cls_2';
    mockDb.data.student_class_history.push({ schoolId: SCHOOL, studentId: 'stu_1', academicYearId: 'y25', classId: 'cls_1' });
    drafts().push(row({ academicYearId: 'y25', subjectComments: { math: 'Then' } }));
    expect((await list({ academicYearId: 'y25' })).body.data).toHaveLength(1);
    expect((await list()).body.data).toEqual([]);
  });
  test('another school’s comments are never read or changed', async () => {
    const other = row({ _id: 'theirs', schoolId: 'sch_2', academicYearId: 'y26', subjectComments: { math: 'Theirs' } });
    drafts().push(other);
    expect((await list()).body.data).toEqual([]);
    await save('Ours');
    expect(drafts().find(d => d._id === 'theirs').subjectComments.math).toBe('Theirs');
    expect(drafts().find(d => d._id !== 'theirs').schoolId).toBe(SCHOOL);
  });
});

describe('what a Report Cycle prints', () => {
  const eff = (o = {}) => rc.effectiveDrafts(CTX, SCHOOL, { studentIds: ['stu_1'], termNumber: 1, cycle: 'MT', ...o }, SCOPE26);

  test('the Markbook comment, when nothing was typed for the cycle', async () => {
    drafts().push(row({ academicYearId: 'y26', classTeacherRemark: 'Whole Term remark', subjectComments: { math: 'Box' } }));
    const d = (await eff()).stu_1;
    expect(d.subjectComments).toEqual({ math: 'Box' });
    expect(d.classTeacherRemark).toBeUndefined();   // remarks stay per report
  });
  test('a comment typed for the cycle wins, per subject; a blank one does not', async () => {
    drafts().push(row({ academicYearId: 'y26', subjectComments: { math: 'Box', eng: 'Box', kis: 'Box' } }));
    drafts().push(row({ academicYearId: 'y26', cycle: 'MT', classTeacherRemark: 'MT remark', subjectComments: { math: 'Typed', eng: '  ' } }));
    const d = (await eff()).stu_1;
    expect(d.subjectComments).toEqual({ math: 'Typed', eng: 'Box', kis: 'Box' });
    expect(d.classTeacherRemark).toBe('MT remark');
  });
  test('with no cycle it is the Markbook box, unchanged', async () => {
    drafts().push(row({ academicYearId: 'y26', classTeacherRemark: 'R', subjectComments: { math: 'Box' } }));
    expect((await eff({ cycle: null })).stu_1).toMatchObject({ classTeacherRemark: 'R', subjectComments: { math: 'Box' } });
  });
  test('saving for the cycle does not touch the Markbook box', async () => {
    drafts().push(row({ _id: 'box', academicYearId: 'y26', subjectComments: { math: 'Box' } }));
    expect((await save('MT only', { cycle: 'MT' })).status).toBe(200);
    expect(drafts().find(d => d._id === 'box').subjectComments.math).toBe('Box');
    expect((await list()).body.data[0].subjectComments.math).toBe('Box');
    expect((await list({ cycle: 'MT' })).body.data[0].subjectComments.math).toBe('MT only');
  });
});

describe('a re-published cycle report keeps its own comments once the box has moved on', () => {
  const windows = [win('MT', '2026-02-20', '2026-02-27'), win('ET', '2026-03-23', '2026-03-31')];
  const prev = { coverage: { cutoff: '2026-02-27' }, comments: { subjectComments: { math: 'Mid' } } };
  const go = (updatedAt, p = prev, w = windows) => rc.cycleSubjectComments({ own: null, box: { updatedAt, subjectComments: { math: 'Box' } }, prev: p, windows: w });

  test('edited after End-Term started → the Mid-Term report keeps its comment', () => {
    expect(go('2026-03-25')).toEqual({ math: 'Mid' });
  });
  test('a late correction before End-Term starts still reaches it', () => {
    expect(go('2026-03-10')).toEqual({ math: 'Box' });
  });
  test('nothing scheduled later → a correction still reaches it', () => {
    expect(go('2026-03-25', prev, [windows[0]])).toEqual({ math: 'Box' });
  });
  test('an assessment that takes no comments does not count', () => {
    expect(go('2026-03-25', prev, [windows[0], { ...windows[1], commentsEnabled: false }])).toEqual({ math: 'Box' });
  });
  test('a report published before coverage was recorded uses its publish day', () => {
    expect(go('2026-03-25', { publishedAt: '2026-03-02T08:00:00Z', comments: { subjectComments: { math: 'Mid' } } })).toEqual({ math: 'Mid' });
  });
});

describe('the Markbook box after a Whole Term report was published', () => {
  const publish = (o = {}) => mockDb.data.report_card_snapshots.push({ id: 's1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 1, academicYearId: 'y26', commentsLocked: true, publishedAt: `${day(-10)}T08:00:00Z`, ...o });

  test('locked while nothing later is scheduled, as before', async () => {
    publish();
    expect((await save('x')).status).toBe(403);
  });
  test('locked until the next assessment opens, then open', async () => {
    publish();
    mockDb.data.assessment_schedule.push(win('ET', day(2), day(9)));
    expect((await save('x')).status).toBe(403);
    mockDb.data.assessment_schedule[0].dateFrom = day(-1);
    expect((await save('End-Term')).status).toBe(200);
    expect(mockDb.data.report_card_snapshots[0].commentsLocked).toBe(true);   // the report itself is untouched
  });
  test('last year’s published report never locks this year', async () => {
    publish({ academicYearId: 'y25', publishedAt: '2025-04-01T08:00:00Z' });
    expect((await save('x')).status).toBe(200);
  });
  test('a published report without a year still locks the year it was published in', async () => {
    mockDb.data.report_card_snapshots.push({ id: 's2', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 1, commentsLocked: true, publishedAt: '2026-04-01T08:00:00Z' });
    expect((await save('x')).status).toBe(403);
  });
  test('another school’s schedule or report changes nothing', async () => {
    publish();
    mockDb.data.assessment_schedule.push(win('ET', day(-1), day(5), { schoolId: 'sch_2' }));
    expect((await save('x')).status).toBe(403);
  });
  test('a cycle report’s own comments stay locked after it is published', async () => {
    publish({ cycle: 'MT' });
    mockDb.data.assessment_schedule.push(win('ET', day(-1), day(5)));
    expect((await save('x', { cycle: 'MT' })).status).toBe(403);
    expect((await save('box')).status).toBe(200);
  });
});

describe('the box follows what the published report contains, not only its date (v5.280.1)', () => {
  const MT = win('MT', day(-30), day(-25));
  const ET = win('ET', day(-5), day(5), { label: 'End-Term Exam' });
  const publish = (breakdown, daysAgo, o = {}) => mockDb.data.report_card_snapshots.push({ id: 's1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 1, academicYearId: 'y26', commentsLocked: true, publishedAt: `${day(-daysAgo)}T08:00:00Z`, subjects: { math: { breakdown } }, ...o });
  const sched = (...w) => mockDb.data.assessment_schedule.push(...w);

  test('Mid-Term published late, after End-Term started → End-Term comment saves', async () => {
    publish({ MT: 60 }, 2); sched(MT, ET);
    expect((await save('End-Term')).status).toBe(200);
  });
  test('published on the day End-Term started → End-Term comment saves', async () => {
    publish({ MT: 60, ET: null }, 5); sched(MT, ET);
    expect((await save('End-Term')).status).toBe(200);
  });
  test('the report already contains End-Term → locked, as before', async () => {
    publish({ MT: 60, ET: 70 }, 2); sched(MT, ET);
    expect((await save('x')).status).toBe(403);
  });
  test('a second CA after the report opens it; End-Term marked early and already in the report does not', async () => {
    publish({ CA: 50, MT: 60 }, 4); sched(win('CA', day(-40), day(-35)), MT, win('CA', day(-1), day(3), { instance: 2 }));
    expect((await save('CA 2')).status).toBe(200);
    mockDb.data.report_card_snapshots[0].subjects = { math: { breakdown: { MT: 60, ET: 70 } } };
    mockDb.data.assessment_schedule = [MT, win('ET', day(-1), day(9))];
    expect((await save('x')).status).toBe(403);
  });
  test('an earlier assessment nobody marked does not open the box', async () => {
    publish({ MT: 60, ET: 70 }, 2); sched(win('HW', day(-40), day(-35)), MT, ET);
    expect((await save('x')).status).toBe(403);
  });
  test('End-Term not started: locked, and the message says when it opens', async () => {
    publish({ MT: 60 }, 2); sched(MT, win('ET', day(6), day(9), { label: 'End-Term Exam' }));
    const r = await save('x');
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain(`They open again on ${day(6)}, when End-Term Exam starts`);
  });
  test('End-Term not started but this learner already has an End-Term mark → saves', async () => {
    publish({ MT: 60 }, 2); sched(MT, win('ET', day(6), day(9)));
    mockDb.data.assessment_marks = [{ schoolId: SCHOOL, studentId: 'stu_1', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'y26', rawScore: 89 }];
    expect((await save('End-Term')).status).toBe(200);
  });
  test('a mark of another learner, school, or one locked by a publish does not count', async () => {
    publish({ MT: 60 }, 2); sched(MT, win('ET', day(6), day(9)));
    const m = { schoolId: SCHOOL, studentId: 'stu_1', termNumber: 1, assessmentType: 'ET', instance: 1, academicYearId: 'y26', rawScore: 89 };
    mockDb.data.assessment_marks = [{ ...m, studentId: 'stu_2' }, { ...m, schoolId: 'sch_2' }, { ...m, isLocked: true }, { ...m, termNumber: 2 }];
    expect((await save('x')).status).toBe(403);
  });
  test('an assessment that takes no comments does not open it', async () => {
    publish({ MT: 60 }, 2); sched(MT, { ...ET, commentsEnabled: false });
    expect((await save('x')).status).toBe(403);
  });
});

describe('publishing Term 2 never hides Term 1', () => {
  test('terms without ids are told apart by term number', () => {
    expect(router._termNumberWhenNoTermId({ termId: null }, 2)).toEqual({ termNumber: 2 });
    expect(router._termNumberWhenNoTermId({ termId: 't2' }, 2)).toEqual({});
    expect(router._termNumberWhenNoTermId({ termId: null }, null)).toEqual({});
  });
});
