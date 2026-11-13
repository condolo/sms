/* ============================================================
   v5.270.0 — co-teaching, streams taught together, subject time rules,
   and the modules that read lessons.

   Through the real routes/utils with an in-memory DB:
     - teaching assignments: link / unlink ("taught together");
     - the generator places a linked set as one set of lessons with all
       its teachers and streams; subject time rules are hard and prechecked;
     - clash checks treat co-teachers as teaching and combined streams as
       each of their streams;
     - lesson readers: student/parent stream filter (incl. whole-class
       lessons saved with streamId null), option lessons only for the
       students who take them, teacher views, cover, Lessons to place;
     - timetable change alerts: only the lesson's own students' families,
       and incoming teachers (co-teachers too) by their login id;
     - adding a lesson by hand validates co-teachers and streams;
     - Days & rules: subject time rules saved, cleaned and warned about.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => false),
  hasPermission: jest.fn(async () => true),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: jest.fn(), scopeMiddleware: () => (_req, _res, next) => next() }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));
jest.mock('../../utils/academic-period', () => ({ resolveAcademicPeriod: async () => ({ academicYearId: 'ay1', termId: 't1' }) }));
jest.mock('../../utils/archival', () => ({ isYearArchived: async () => false }));
jest.mock('../../utils/timetable-publish', () => ({
  getPublishState: async () => ({ published: true }),
  markTimetableChanged: jest.fn(async () => {}),
  isTimetablePublished: async () => true,
  publishedReader: async () => mockDb.model('timetable'),
  timetableReaderFor: async () => mockDb.model('timetable'),
  isTimetableEditor: () => true,
}));
// Four lesson periods a day, a break after the second.
jest.mock('../../routes/bell-schedule', () => ({
  resolveBellSchedule: async () => ({
    id: 'bs1',
    periods: [
      { p: '1', start: '08:00', end: '08:40' }, { p: '2', start: '08:40', end: '09:20' },
      { p: 'B', start: '09:20', end: '09:40', isBreak: true },
      { p: '3', start: '09:40', end: '10:20' }, { p: '4', start: '10:20', end: '11:00' },
    ],
  }),
}));
const mockNotify = { guardians: [], dispatch: [] };
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn(async ({ items }) => { mockNotify.guardians.push(...items.map(i => i.studentId)); }) }));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn(async ({ recipients }) => { mockNotify.dispatch.push(...recipients.map(r => r.userId)); }) }));

const express = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');
const assignmentsRouter = require('../../routes/teaching-assignments');
const generateRouter = require('../../routes/timetable-generate');
const { checkConflicts, batchConflicts } = require('../../utils/timetable-conflicts');
const { studentStreamOr, filterElectivesForStudent } = require('../../utils/lesson-audience');
const { notifyTimetableChange } = require('../../utils/change-alerts');
const { computePlacement } = require('../../utils/timetable-placement');
const { matches } = require('../fixtures/fake-tenant-db');

const S = 'school_A';
const ADMIN = { userId: 'u_admin', schoolId: S, role: 'admin', roles: ['admin'] };

function seed() {
  return createFakeDb({
    schools: [{ id: S, timetableSettings: { workingDays: ['monday', 'tuesday'] } }],
    classes: [{ id: 'c7', schoolId: S, name: 'Year 7', sectionKey: 'secondary' }, { id: 'c8', schoolId: S, name: 'Year 8', sectionKey: 'secondary' }],
    streams: [
      { id: 's7i', schoolId: S, classId: 'c7', name: '7i', status: 'active' },
      { id: 's7ii', schoolId: S, classId: 'c7', name: '7ii', status: 'active' },
      { id: 's7iii', schoolId: S, classId: 'c7', name: '7iii', status: 'active' },
      { id: 's8i', schoolId: S, classId: 'c8', name: '8i', status: 'active' },
    ],
    subjects: [{ id: 'pe', schoolId: S, name: 'PE' }, { id: 'math', schoolId: S, name: 'Maths' }, { id: 'art', schoolId: S, name: 'Art' }],
    class_subjects: [
      { schoolId: S, classId: 'c7', subjectId: 'pe', isCompulsoryForClass: true },
      { schoolId: S, classId: 'c7', subjectId: 'math', isCompulsoryForClass: true },
      { schoolId: S, classId: 'c7', subjectId: 'art', isCompulsoryForClass: false },
    ],
    teachers: [
      { id: 'tA', schoolId: S, userId: 'uA', firstName: 'Ann', lastName: 'A' },
      { id: 'tB', schoolId: S, userId: 'uB', firstName: 'Ben', lastName: 'B' },
      { id: 'tC', schoolId: S, userId: 'uC', firstName: 'Cy', lastName: 'C' },
    ],
    users: [
      { id: 'uA', schoolId: S, name: 'Ann A', role: 'teacher' },
      { id: 'uB', schoolId: S, name: 'Ben B', role: 'teacher' },
      { id: 'uC', schoolId: S, name: 'Cy C', role: 'teacher' },
      { id: 'u_other_school', schoolId: 'school_B', name: 'Elsewhere', role: 'teacher' },
    ],
    students: [
      { id: 'p1', schoolId: S, classId: 'c7', streamId: 's7i', status: 'active' },
      { id: 'p2', schoolId: S, classId: 'c7', streamId: 's7ii', status: 'active' },
      { id: 'p3', schoolId: S, classId: 'c7', streamId: 's7iii', status: 'active' },
    ],
    student_subjects: [{ schoolId: S, studentId: 'p1', subjectId: 'art' }],
    teaching_assignments: [
      // PE: Ann teaches 7i, Ben teaches 7ii — the school wants them together, both teaching.
      { id: 'ta_pe_i', schoolId: S, classId: 'c7', className: 'Year 7', streamId: 's7i', streamName: '7i', subjectId: 'pe', subjectName: 'PE', teacherId: 'uA', teacherName: 'Ann A', periodsPerWeek: 2 },
      { id: 'ta_pe_ii', schoolId: S, classId: 'c7', className: 'Year 7', streamId: 's7ii', streamName: '7ii', subjectId: 'pe', subjectName: 'PE', teacherId: 'uB', teacherName: 'Ben B', periodsPerWeek: 3 },
      { id: 'ta_math_iii', schoolId: S, classId: 'c7', className: 'Year 7', streamId: 's7iii', streamName: '7iii', subjectId: 'math', subjectName: 'Maths', teacherId: 'uC', teacherName: 'Cy C', periodsPerWeek: 3 },
      { id: 'ta_x', schoolId: S, classId: 'c8', className: 'Year 8', streamId: 's8i', subjectId: 'pe', subjectName: 'PE', teacherId: 'uC', periodsPerWeek: 1 },
    ],
    timetable: [],
  });
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/timetable/generate', generateRouter);
  a.use('/api/timetable', timetableRouter);
  a.use('/api/teaching-assignments', assignmentsRouter);
  return a;
}
const as = (user = ADMIN) => { mockJwtUser = user; return supertest(app()); };

beforeEach(() => {
  mockDb = seed();
  mockNotify.guardians = [];
  mockNotify.dispatch = [];
});

/* ── Teaching assignments: link / unlink ─────────────────────────── */
describe('taught together: link and unlink assignments', () => {
  test('linking two rows makes one set; periods/week follow the row you link from', async () => {
    const res = await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_pe_ii' });
    expect(res.status).toBe(200);
    const rows = mockDb.data.teaching_assignments.filter(r => r.subjectId === 'pe' && r.classId === 'c7');
    expect(new Set(rows.map(r => r.lessonGroupId)).size).toBe(1);
    expect(rows.every(r => r.lessonGroupId && r.periodsPerWeek === 2)).toBe(true);
  });

  test('changing periods/week on one row of a set changes them all', async () => {
    await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_pe_ii' });
    await as().put('/api/teaching-assignments/ta_pe_ii').send({ periodsPerWeek: 4 });
    expect(mockDb.data.teaching_assignments.filter(r => r.subjectId === 'pe' && r.classId === 'c7').map(r => r.periodsPerWeek)).toEqual([4, 4]);
  });

  test('refused: a different subject, a different class, a whole-class row with a stream row', async () => {
    expect((await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_math_iii' })).status).toBe(400);
    expect((await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_x' })).status).toBe(400);
    mockDb.data.teaching_assignments.push({ id: 'ta_pe_whole', schoolId: S, classId: 'c7', subjectId: 'pe', teacherId: 'uC', periodsPerWeek: 1 });
    expect((await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_pe_whole' })).status).toBe(400);
  });

  test('unlinking the second-to-last row dissolves the set', async () => {
    await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_pe_ii' });
    await as().post('/api/teaching-assignments/ta_pe_ii/unlink');
    expect(mockDb.data.teaching_assignments.filter(r => r.subjectId === 'pe' && r.classId === 'c7').every(r => !r.lessonGroupId)).toBe(true);
  });

  test('another school\'s assignment can\'t be linked', async () => {
    mockDb.data.teaching_assignments.push({ id: 'ta_b', schoolId: 'school_B', classId: 'c7', streamId: 's7iii', subjectId: 'pe', teacherId: 'uX', periodsPerWeek: 2 });
    expect((await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_b' })).status).toBe(404);
  });
});

/* ── Generator ───────────────────────────────────────────────────── */
describe('generator: taught together and subject time rules', () => {
  const SCOPE = { scope: { classIds: ['c7'] }, budgetSeconds: 2 };

  test('a linked set is placed once, with both teachers and both streams on every lesson', async () => {
    await as().post('/api/teaching-assignments/ta_pe_i/link').send({ withId: 'ta_pe_ii' });
    const run = (await as().post('/api/timetable/generate').send(SCOPE)).body.data;
    expect(run.stats).toMatchObject({ lessonsNeeded: 5, unitsUnplaced: 0 });   // PE 2 (one set) + Maths 3
    const lessons = (await as().get(`/api/timetable/generate/runs/${run.id}`)).body.data.lessons;
    const pe = lessons.filter(l => l.subjectId === 'pe');
    expect(pe).toHaveLength(2);
    for (const l of pe) {
      expect(l).toMatchObject({ streamId: null, streamIds: ['s7i', 's7ii'], teacherId: 'uA', coTeacherIds: ['uB'], coTeacherNames: ['Ben B'] });
    }
    // 7iii's Maths can run at the same time as the 7i+7ii PE (different students).
    const apply = await as().post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(apply.status).toBe(200);
  });

  test('subject time rules: the precheck says when a subject can\'t fit, and lessons never land in a barred period', async () => {
    mockDb.data.schools[0].timetableSettings.rules = { subjectTimes: { on: true, items: [{ subjectId: 'math', notPositions: [1, 2], notDays: [] }] } };
    const run = (await as().post('/api/timetable/generate').send(SCOPE)).body.data;
    const lessons = (await as().get(`/api/timetable/generate/runs/${run.id}`)).body.data.lessons;
    expect(lessons.filter(l => l.subjectId === 'math').every(l => ['3', '4'].includes(l.period))).toBe(true);

    mockDb.data.teaching_assignments.find(r => r.id === 'ta_math_iii').periodsPerWeek = 5;   // only 4 allowed periods
    const pre = (await as().post('/api/timetable/generate/precheck').send(SCOPE)).body.data;
    expect(pre.precheck.find(p => p.code === 'subject_time_overfull').message).toMatch(/Maths: needs 5 lessons a week but its time rules .* leave only 4 periods/);
  });
});

/* ── Clash checks ────────────────────────────────────────────────── */
describe('clash checks', () => {
  const lesson = o => ({ schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c7', day: 'monday', period: '1', startTime: '08:00', endTime: '08:40', type: 'lesson', ...o });

  test('a co-teacher is busy: they can\'t be in another lesson at the same time, either way round', async () => {
    mockDb.data.timetable.push(lesson({ id: 'L1', streamIds: ['s7i', 's7ii'], subjectId: 'pe', teacherId: 'uA', coTeacherIds: ['uB'] }));
    expect(await checkConflicts(S, lesson({ classId: 'c8', streamId: 's8i', teacherId: 'uB' }))).toMatch(/Teacher is already scheduled/);
    expect(await checkConflicts(S, lesson({ classId: 'c8', streamId: 's8i', teacherId: 'uC', coTeacherIds: ['uA'] }))).toMatch(/Teacher is already scheduled/);
  });

  test('streams taught together block each of their streams, not the others', async () => {
    mockDb.data.timetable.push(lesson({ id: 'L1', streamIds: ['s7i', 's7ii'], subjectId: 'pe', teacherId: 'uA' }));
    expect(await checkConflicts(S, lesson({ streamId: 's7ii', subjectId: 'math', teacherId: 'uC' }))).toMatch(/Slot already exists/);
    expect(await checkConflicts(S, lesson({ streamId: 's7iii', subjectId: 'math', teacherId: 'uC' }))).toBeNull();
  });

  test('bulk save checks co-teachers and combined streams inside the batch', () => {
    const batch = [
      lesson({ streamIds: ['s7i', 's7ii'], teacherId: 'uA', coTeacherIds: ['uB'] }),
      lesson({ streamId: 's7iii', teacherId: 'uB' }),
    ];
    expect(batchConflicts(batch)).toHaveLength(1);
    expect(batchConflicts(batch)[0].message).toMatch(/the same teacher/);
  });
});

/* ── Lesson readers ──────────────────────────────────────────────── */
describe('lesson readers', () => {
  const L = (o) => ({ schoolId: S, classId: 'c7', isActive: true, day: 'monday', ...o });
  const rows = [
    L({ id: 'whole_null', streamId: null, subject: 'Assembly' }),
    L({ id: 'whole_missing', subject: 'Registration' }),
    L({ id: 'own', streamId: 's7i', subject: 'Maths' }),
    L({ id: 'other', streamId: 's7ii', subject: 'Maths' }),
    L({ id: 'together', streamIds: ['s7i', 's7ii'], streamId: null, subject: 'PE' }),
    L({ id: 'together_not_mine', streamIds: ['s7ii', 's7iii'], streamId: null, subject: 'PE' }),
  ];

  test('a 7i student sees whole-class lessons (streamId null or missing), their own, and combined ones that include 7i', () => {
    const seen = rows.filter(r => matches(r, { $or: studentStreamOr('s7i') })).map(r => r.id);
    expect(seen.sort()).toEqual(['own', 'together', 'whole_missing', 'whole_null']);
  });

  test('option lessons show only to students who take them', async () => {
    const lessons = [L({ id: 'art', subjectId: 'art' }), L({ id: 'pe', subjectId: 'pe' })];
    const ctx = { schoolId: S };
    expect((await filterElectivesForStudent(ctx, S, { id: 'p1', classId: 'c7' }, lessons)).map(l => l.id)).toEqual(['art', 'pe']);
    expect((await filterElectivesForStudent(ctx, S, { id: 'p2', classId: 'c7' }, lessons)).map(l => l.id)).toEqual(['pe']);
  });

  test('a co-teacher\'s own timetable includes the lessons they co-teach', async () => {
    mockDb.data.timetable.push(L({ id: 'co', streamIds: ['s7i', 's7ii'], teacherId: 'uA', coTeacherIds: ['uB'], subject: 'PE' }));
    const res = await as().get('/api/timetable/teacher/tB');
    expect(res.status).toBe(200);
    expect(res.body.data.map(l => l.id)).toEqual(['co']);
  });

  test('cover: a co-taught lesson needs no cover when one teacher is absent; a solo lesson does', async () => {
    mockDb.data.timetable.push(
      L({ id: 'co', day: 'monday', period: '1', teacherId: 'uA', coTeacherIds: ['uB'], subject: 'PE', type: 'lesson' }),
      L({ id: 'solo', day: 'monday', period: '2', teacherId: 'uB', subject: 'Maths', type: 'lesson' }),
    );
    const res = await as().post('/api/timetable/substitutions/absent').send({ teacherId: 'uB', date: '2026-11-16' });   // a Monday
    expect(res.status).toBe(200);
    expect((mockDb.data.substitutions || []).map(s => s.period)).toEqual(['2']);
  });

  test('cover follows the school\'s working days, not a fixed Mon–Fri', async () => {
    const res = await as().post('/api/timetable/substitutions/absent').send({ teacherId: 'uB', date: '2026-11-18' });   // Wednesday: not a working day here
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/working days \(mon, tue\)/);
  });

  test('Lessons to place: a linked set counts once; a combined lesson counts for each stream; co-teachers count it', () => {
    const assignments = [
      { classId: 'c7', streamId: 's7i', subjectId: 'pe', teacherId: 'uA', periodsPerWeek: 2, lessonGroupId: 'g1' },
      { classId: 'c7', streamId: 's7i', subjectId: 'pe', teacherId: 'uB', periodsPerWeek: 2, lessonGroupId: 'g1' },   // co-teacher, same stream
      { classId: 'c7', streamId: 's7ii', subjectId: 'pe', teacherId: 'uB', periodsPerWeek: 2, lessonGroupId: 'g1' },
    ];
    const slots = [1, 2].map(i => ({ classId: 'c7', streamIds: ['s7i', 's7ii'], subjectId: 'pe', teacherId: 'uA', coTeacherIds: ['uB'], type: 'lesson' }));
    const out = computePlacement({ assignments, slots, teachers: [{ id: 'tA', userId: 'uA' }, { id: 'tB', userId: 'uB' }] });
    const byStream = Object.fromEntries(out.classes.map(c => [c.streamId, c]));
    expect(byStream.s7i).toMatchObject({ needed: 2, placed: 2, status: 'done' });
    expect(byStream.s7ii).toMatchObject({ needed: 2, placed: 2, status: 'done' });
    expect(out.teachers.find(t => t.teacherId === 'tB').placed).toBe(2);
  });
});

/* ── Change alerts ───────────────────────────────────────────────── */
describe('timetable change alerts', () => {
  const ctx = { schoolId: S };

  test('a 7i lesson change tells only 7i families; a combined one tells both streams\'', async () => {
    const before = { classId: 'c7', streamId: 's7i', subjectId: 'math', day: 'monday', period: '1', teacherId: 'uC' };
    await notifyTimetableChange({ ctx, schoolId: S, before, after: { ...before, period: '2' } });
    expect(mockNotify.guardians).toEqual(['p1']);
    mockNotify.guardians = [];
    const comb = { classId: 'c7', streamIds: ['s7i', 's7ii'], subjectId: 'pe', day: 'monday', period: '1', teacherId: 'uA' };
    await notifyTimetableChange({ ctx, schoolId: S, before: comb, after: { ...comb, period: '3' } });
    expect(mockNotify.guardians.sort()).toEqual(['p1', 'p2']);
  });

  test('an option lesson change tells only families of students who take it', async () => {
    const before = { classId: 'c7', subjectId: 'art', day: 'monday', period: '1', teacherId: 'uC' };
    await notifyTimetableChange({ ctx, schoolId: S, before, after: { ...before, period: '4' } });
    expect(mockNotify.guardians).toEqual(['p1']);
  });

  test('incoming teachers are told — a new main teacher and a new co-teacher — by their login id', async () => {
    const before = { classId: 'c7', streamId: 's7i', subjectId: 'math', day: 'monday', period: '1', teacherId: 'uC' };
    await notifyTimetableChange({ ctx, schoolId: S, before, after: { ...before, teacherId: 'uA', coTeacherIds: ['uB'] } });
    expect(mockNotify.dispatch.sort()).toEqual(['uA', 'uB']);
  });
});

/* ── Adding a lesson by hand ─────────────────────────────────────── */
describe('adding a lesson by hand', () => {
  const body = o => ({ classId: 'c7', day: 'monday', period: '1', subject: 'PE', subjectId: 'pe', teacherId: 'uA', ...o });

  test('streams taught together and a co-teacher are saved, with the co-teacher\'s name filled in', async () => {
    const res = await as().post('/api/timetable').send(body({ streamIds: ['s7ii', 's7i'], coTeacherIds: ['uB'] }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ streamId: null, streamIds: ['s7i', 's7ii'], coTeacherIds: ['uB'], coTeacherNames: ['Ben B'] });
  });

  test('refused: a stream of another class, both streamId and streamIds, a co-teacher from another school', async () => {
    expect((await as().post('/api/timetable').send(body({ streamIds: ['s7i', 's8i'] }))).status).toBe(400);
    expect((await as().post('/api/timetable').send(body({ streamId: 's7i', streamIds: ['s7i', 's7ii'] }))).status).toBe(400);
    expect((await as().post('/api/timetable').send(body({ coTeacherIds: ['u_other_school'] }))).status).toBe(400);
  });

  test('one stream in streamIds becomes a plain streamId; the main teacher is never their own co-teacher', async () => {
    const res = await as().post('/api/timetable').send(body({ streamIds: ['s7i'], coTeacherIds: ['uA'] }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ streamId: 's7i', coTeacherIds: [] });
  });
});

/* ── Days & rules: subject time rules ────────────────────────────── */
describe('subject time rules in Days & rules', () => {
  test('saved cleaned: unknown subjects and empty rules dropped, positions sorted', async () => {
    const res = await as().put('/api/timetable/settings').send({ rules: { subjectTimes: { on: true, items: [
      { subjectId: 'pe', notPositions: [3, 1, 1], notDays: ['friday'] },
      { subjectId: 'not_a_subject', notPositions: [1] },
      { subjectId: 'math', notPositions: [], notDays: [] },
    ] } } });
    expect(res.status).toBe(200);
    expect(res.body.data.rules.subjectTimes.items).toEqual([{ subjectId: 'pe', notPositions: [1, 3], notDays: ['friday'] }]);
  });

  test('a lesson placed by hand in a barred lesson shows as a rule warning', async () => {
    mockDb.data.schools[0].timetableSettings.rules = { subjectTimes: { on: true, items: [{ subjectId: 'pe', notPositions: [1] }] } };
    mockDb.data.timetable.push({ id: 'x', schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c7', streamId: 's7i', day: 'monday', period: '1', startTime: '08:00', endTime: '08:40', subjectId: 'pe', subject: 'PE', type: 'lesson' });
    const res = await as().get('/api/timetable/status');
    expect(res.status).toBe(200);
    expect(res.body.data.ruleWarnings.some(w => /PE is set not in lesson 1, but has a lesson Monday 08:00–08:40/.test(w))).toBe(true);
  });
});
