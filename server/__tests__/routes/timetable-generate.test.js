/* ============================================================
   /api/timetable/generate — automatic timetable (v5.269.0)

   Through the real route and the real prepare.js + solver (in-memory DB,
   inline solver under Jest). Pins: who may use it; the precheck; a
   generated run fills the scope from the teaching assignments without
   touching locked lessons or double-booking a teacher who teaches
   outside the scope; apply replaces only the scope's unlocked draft
   lessons and keeps a backup; undo puts them back; a run made stale by
   later edits is refused; everything is scoped by schoolId.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (req, _res, next) => next() }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
const mockGrant = { value: false };
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async (_req, mod, sub) => mod === 'timetable' && sub === 'generate' && mockGrant.value),
}));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/academic-period', () => ({ resolveAcademicPeriod: async () => ({ academicYearId: 'ay1', termId: 't1' }) }));
jest.mock('../../utils/timetable-settings', () => {
  const actual = jest.requireActual('../../utils/timetable-settings');
  return { ...actual, getTimetableSettings: async () => ({ workingDays: ['monday', 'tuesday'], rules: actual.DEFAULT_RULES }) };
});
// Four lesson periods a day, a break after the second.
jest.mock('../../routes/bell-schedule', () => ({
  resolveBellSchedule: async () => ({
    id: 'bs1',
    periods: [
      { p: 1, start: '08:00', end: '08:40' },
      { p: 2, start: '08:40', end: '09:20' },
      { p: 'B', start: '09:20', end: '09:40', isBreak: true },
      { p: 3, start: '09:40', end: '10:20' },
      { p: 4, start: '10:20', end: '11:00' },
    ],
  }),
}));
const mockClash = { value: null };
jest.mock('../../utils/timetable-conflicts', () => ({ checkConflicts: jest.fn(async () => mockClash.value) }));
jest.mock('../../utils/timetable-publish', () => ({ markTimetableChanged: jest.fn(async () => {}) }));

const express = require('express');
const supertest = require('supertest');
const { markTimetableChanged } = require('../../utils/timetable-publish');
const router = require('../../routes/timetable-generate');

const S = 'school_A';
const ADMIN = { userId: 'u_admin', schoolId: S, role: 'admin' };
const TEACHER = { userId: 'u_t1', schoolId: S, role: 'teacher' };
const SCOPE = { scope: { sectionKey: 'secondary' }, budgetSeconds: 2 };

function seed() {
  return createFakeDb({
    classes: [
      { id: 'c1', schoolId: S, name: 'Form 1A', sectionKey: 'secondary' },
      { id: 'c2', schoolId: S, name: 'Form 1B', sectionKey: 'secondary' },
      { id: 'c3', schoolId: S, name: 'Grade 3', sectionKey: 'primary' },
    ],
    subjects: [
      { id: 'math', schoolId: S, name: 'Mathematics' },
      { id: 'eng', schoolId: S, name: 'English' },
    ],
    teachers: [
      { id: 'tch1', schoolId: S, userId: 'u_t1', firstName: 'Amos', lastName: 'Kip' },
      { id: 'tch2', schoolId: S, userId: 'u_t2', firstName: 'Beth', lastName: 'Oduor' },
    ],
    teaching_assignments: [
      { id: 'ta1', schoolId: S, classId: 'c1', className: 'Form 1A', subjectId: 'math', subjectName: 'Mathematics', teacherId: 'u_t1', teacherName: 'Amos Kip', periodsPerWeek: 3, doubleLessons: 1 },
      { id: 'ta2', schoolId: S, classId: 'c1', className: 'Form 1A', subjectId: 'eng', subjectName: 'English', teacherId: 'u_t2', teacherName: 'Beth Oduor', periodsPerWeek: 2 },
      { id: 'ta3', schoolId: S, classId: 'c2', className: 'Form 1B', subjectId: 'math', subjectName: 'Mathematics', teacherId: 'u_t1', teacherName: 'Amos Kip', periodsPerWeek: 3 },
      { id: 'ta4', schoolId: S, classId: 'c2', className: 'Form 1B', subjectId: 'eng', subjectName: 'English', teacherId: 'u_t2', teacherName: 'Beth Oduor', periodsPerWeek: 2 },
    ],
    timetable: [
      // Locked in scope: stays, and counts towards Form 1A's 2 English lessons.
      { id: 'L_locked', schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c1', day: 'monday', period: '1', startTime: '08:00', endTime: '08:40', subject: 'English', subjectId: 'eng', teacherId: 'u_t2', type: 'lesson', locked: true },
      // Unlocked in scope, a subject the run places (matched by NAME, no subjectId): replaced on apply, back on undo.
      { id: 'L_old', schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c2', day: 'tuesday', period: '4', startTime: '10:20', endTime: '11:00', subject: 'mathematics', teacherId: 'u_t1', type: 'lesson' },
      // Unlocked in scope, a subject with NO periods-per-week target: stays, and its time is busy.
      { id: 'L_art', schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c1', day: 'tuesday', period: '3', startTime: '09:40', endTime: '10:20', subject: 'Art', teacherId: 'u_t2', type: 'lesson' },
      // Outside the scope, same teacher under another id form: that time is taken.
      { id: 'L_primary', schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c3', day: 'monday', period: '2', startTime: '08:40', endTime: '09:20', subject: 'Mathematics', subjectId: 'math', teacherId: 'tch1', type: 'lesson' },
    ],
    // Another school's run — never visible here.
    timetable_generation_runs: [{ id: 'run_B', schoolId: 'school_B', lessons: [{ classId: 'x' }], scopeClassKeys: ['x'] }],
  });
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/timetable/generate', router);
  return a;
}
const as = (user) => { mockJwtUser = user; return supertest(app()); };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = seed();
  mockGrant.value = false;
  mockClash.value = null;
});

async function generate() {
  const res = await as(ADMIN).post('/api/timetable/generate').send(SCOPE);
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('access', () => {
  test('a teacher without "Generate Timetable" is refused; with it, allowed', async () => {
    expect((await as(TEACHER).post('/api/timetable/generate/precheck').send(SCOPE)).status).toBe(403);
    mockGrant.value = true;
    expect((await as(TEACHER).post('/api/timetable/generate/precheck').send(SCOPE)).status).toBe(200);
  });

  test('a bad scope is a validation error (422)', async () => {
    expect((await as(ADMIN).post('/api/timetable/generate/precheck').send({ scope: { sectionKey: 'x', classIds: ['c1'] } })).status).toBe(422);
    expect((await as(ADMIN).post('/api/timetable/generate/precheck').send({})).status).toBe(422);
  });

  test('another school\'s run is not found', async () => {
    expect((await as(ADMIN).get('/api/timetable/generate/runs/run_B')).status).toBe(404);
    expect((await as(ADMIN).post('/api/timetable/generate/runs/run_B/apply')).status).toBe(404);
  });
});

describe('precheck', () => {
  test('counts what will be placed (locked lessons subtracted) and what will be replaced', async () => {
    const res = await as(ADMIN).post('/api/timetable/generate/precheck').send(SCOPE);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ lessonsNeeded: 9, replaceable: 1, kept: 1 });
    expect(res.body.data.classes.sort()).toEqual(['Form 1A', 'Form 1B']);
    expect(res.body.data.precheck.filter(p => p.level === 'error')).toEqual([]);
  });

  test('a scope with nothing to place says why, and generating it is refused', async () => {
    const pre = await as(ADMIN).post('/api/timetable/generate/precheck').send({ scope: { sectionKey: 'primary' } });
    expect(pre.body.data.precheck.some(p => p.code === 'nothing_to_place')).toBe(true);
    const gen = await as(ADMIN).post('/api/timetable/generate').send({ scope: { sectionKey: 'primary' } });
    expect(gen.status).toBe(400);
  });

  test('a teacher needing more lessons than they have free periods is an error', async () => {
    mockDb.data.teaching_assignments[0].periodsPerWeek = 8; // Amos: 8 + 3 + 1 elsewhere > 8 periods
    mockDb.data.teaching_assignments[0].doubleLessons = 0;
    const res = await as(ADMIN).post('/api/timetable/generate/precheck').send(SCOPE);
    expect(res.body.data.precheck.find(p => p.code === 'teacher_overfull').message).toMatch(/Amos Kip needs 12 lessons/);
  });
});

describe('generate', () => {
  test('fills the scope validly and stores a run; the draft is untouched until apply', async () => {
    const run = await generate();
    expect(run.stats).toMatchObject({ lessonsNeeded: 9, lessonsPlaced: 9, unitsUnplaced: 0, replaces: 1 });
    expect(run).not.toHaveProperty('lessons'); // summary only
    expect(mockDb.data.timetable.map(l => l.id).sort()).toEqual(['L_art', 'L_locked', 'L_old', 'L_primary']);

    const full = (await as(ADMIN).get(`/api/timetable/generate/runs/${run.id}`)).body.data;
    const lessons = full.lessons;
    const at = l => `${l.day}|${l.startTime}`;
    // No class twice at once, including against its locked lesson.
    for (const c of ['c1', 'c2']) {
      const times = lessons.filter(l => l.classId === c).map(at);
      if (c === 'c1') times.push('monday|08:00', 'tuesday|09:40');
      expect(new Set(times).size).toBe(times.length);
    }
    // No teacher twice at once, and Amos never at his out-of-scope Monday 08:40.
    for (const t of ['u_t1', 'u_t2']) {
      const times = lessons.filter(l => l.teacherId === t).map(at);
      expect(new Set(times).size).toBe(times.length);
    }
    expect(lessons.filter(l => l.teacherId === 'u_t1').map(at)).not.toContain('monday|08:40');
    expect(lessons.filter(l => l.teacherId === 'u_t2').map(at)).not.toContain('monday|08:00');
    expect(lessons.filter(l => l.teacherId === 'u_t2').map(at)).not.toContain('tuesday|09:40');
    // Form 1A English: 2 a week, 1 already locked → 1 generated.
    expect(lessons.filter(l => l.classId === 'c1' && l.subjectId === 'eng')).toHaveLength(1);
    // Form 1A Maths double: two back-to-back periods sharing a doubleId, not across the break.
    const dbl = lessons.filter(l => l.classId === 'c1' && l.subjectId === 'math' && l.doubleId);
    expect(dbl).toHaveLength(2);
    expect(dbl[0].day).toBe(dbl[1].day);
    const pair = dbl.map(l => l.period).sort().join('-');
    expect(['1-2', '3-4']).toContain(pair);
  });

  test('lists recent runs, newest first, this school only', async () => {
    const a = await generate();
    const b = await generate();
    const res = await as(ADMIN).get('/api/timetable/generate/runs');
    expect(res.body.data.map(r => r.id)).toEqual([b.id, a.id]);
  });
});

describe('apply and undo', () => {
  test('apply replaces only the scope\'s unlocked draft lessons; undo puts them back', async () => {
    const run = await generate();
    const applied = await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(applied.status).toBe(200);
    expect(applied.body.data).toEqual({ applied: 9, replaced: 1 });
    const ids = mockDb.data.timetable.map(l => l.id);
    expect(ids).toEqual(expect.arrayContaining(['L_locked', 'L_primary', 'L_art']));
    expect(ids).not.toContain('L_old');
    const generated = mockDb.data.timetable.filter(l => l.generationRunId === run.id);
    expect(generated).toHaveLength(9);
    expect(generated.every(l => l.schoolId === S && l.academicYearId === 'ay1' && l.isActive)).toBe(true);
    expect(markTimetableChanged).toHaveBeenCalledWith(S);

    expect((await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`)).status).toBe(409);

    const undone = await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/undo`);
    expect(undone.status).toBe(200);
    expect(mockDb.data.timetable.map(l => l.id).sort()).toEqual(['L_art', 'L_locked', 'L_old', 'L_primary']);
    expect((await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/undo`)).status).toBe(409);
  });

  test('only the most recently applied run can be undone', async () => {
    const first = await generate();
    await as(ADMIN).post(`/api/timetable/generate/runs/${first.id}/apply`);
    const second = await generate();
    await as(ADMIN).post(`/api/timetable/generate/runs/${second.id}/apply`);
    expect((await as(ADMIN).post(`/api/timetable/generate/runs/${first.id}/undo`)).status).toBe(409);
    expect((await as(ADMIN).post(`/api/timetable/generate/runs/${second.id}/undo`)).status).toBe(200);
  });

  test('a run made stale by later edits elsewhere is refused and nothing changes', async () => {
    const run = await generate();
    mockClash.value = 'Teacher Amos Kip is already teaching Grade 3 then.';
    const res = await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_RUN');
    expect(mockDb.data.timetable.map(l => l.id).sort()).toEqual(['L_art', 'L_locked', 'L_old', 'L_primary']);
  });

  test('apply also replaces lessons that store the class under its _id form', async () => {
    // The class has an `id`, but this old lesson saved it as String(_id).
    mockDb.data.classes[1]._id = '64b7f0c2e4a1d93f5c8b2a17';
    mockDb.data.timetable.find(l => l.id === 'L_old').classId = '64b7f0c2e4a1d93f5c8b2a17';
    const run = await generate();
    await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(mockDb.data.timetable.map(l => l.id)).not.toContain('L_old');
  });
});

describe('option blocks (electives), v5.269.1', () => {
  // Form 1A has 8 periods. Already used: locked English 1, Art 1; to place:
  // Maths 3 + English 1 + Physics 2 + History 2 = 10 if one after another.
  // It only fits if Physics and History share periods — they are options
  // and no student takes both.
  beforeEach(() => {
    mockDb.data.subjects.push({ id: 'phy', schoolId: S, name: 'Physics' }, { id: 'his', schoolId: S, name: 'History' });
    mockDb.data.teachers.push(
      { id: 'tch3', schoolId: S, userId: 'u_t3', firstName: 'Cy', lastName: 'Phys' },
      { id: 'tch4', schoolId: S, userId: 'u_t4', firstName: 'Di', lastName: 'Hist' },
    );
    mockDb.data.class_subjects = [
      { schoolId: S, classId: 'c1', subjectId: 'phy', isCompulsoryForClass: false },
      { schoolId: S, classId: 'c1', subjectId: 'his', isCompulsoryForClass: false },
      { schoolId: S, classId: 'c1', subjectId: 'math', isCompulsoryForClass: true },
    ];
    mockDb.data.students = [
      { id: 'st1', schoolId: S, classId: 'c1', streamId: 'sA', status: 'active' },
      { id: 'st2', schoolId: S, classId: 'c1', streamId: 'sB', status: 'active' },
    ];
    mockDb.data.student_subjects = [
      { schoolId: S, studentId: 'st1', subjectId: 'phy' },
      { schoolId: S, studentId: 'st2', subjectId: 'his' },
    ];
    // Physics entered once per stream (same teacher) — must become ONE group of 2 lessons, not 4.
    mockDb.data.teaching_assignments.push(
      { id: 'ta5', schoolId: S, classId: 'c1', className: 'Form 1A', streamId: 'sA', streamName: 'A', subjectId: 'phy', subjectName: 'Physics', teacherId: 'u_t3', periodsPerWeek: 2 },
      { id: 'ta5b', schoolId: S, classId: 'c1', className: 'Form 1A', streamId: 'sB', streamName: 'B', subjectId: 'phy', subjectName: 'Physics', teacherId: 'u_t3', periodsPerWeek: 2 },
      { id: 'ta6', schoolId: S, classId: 'c1', className: 'Form 1A', subjectId: 'his', subjectName: 'History', teacherId: 'u_t4', periodsPerWeek: 2 },
    );
  });

  const lessonsOf = async (runId) => (await as(ADMIN).get(`/api/timetable/generate/runs/${runId}`)).body.data.lessons;
  const at = l => `${l.day}|${l.startTime}`;

  test('options run side by side, so the whole week fits; each option group is placed once', async () => {
    const pre = (await as(ADMIN).post('/api/timetable/generate/precheck').send(SCOPE)).body.data;
    expect(pre.lessonsNeeded).toBe(13);
    expect(pre.precheck.filter(p => p.level === 'error')).toEqual([]);
    const run = await generate();
    expect(run.stats).toMatchObject({ lessonsNeeded: 13, unitsUnplaced: 0 });
    const lessons = await lessonsOf(run.id);
    const phy = lessons.filter(l => l.subjectId === 'phy');
    const his = lessons.filter(l => l.subjectId === 'his');
    expect(phy).toHaveLength(2);
    expect(his).toHaveLength(2);
    expect([...phy, ...his].every(l => l.streamId === null)).toBe(true);
    // Never beside a compulsory Form 1A lesson (or the locked one / Art).
    const c1Other = lessons.filter(l => l.classId === 'c1' && !['phy', 'his'].includes(l.subjectId)).map(at).concat(['monday|08:00', 'tuesday|09:40']);
    for (const l of [...phy, ...his]) expect(c1Other).not.toContain(at(l));
    // And they did share at least one period (8 periods, 10 lessons).
    expect(phy.some(p => his.some(h => at(h) === at(p)))).toBe(true);
  });

  test('a student taking both: the two never share a period, and what can\'t fit is listed', async () => {
    mockDb.data.student_subjects.push({ schoolId: S, studentId: 'st1', subjectId: 'his' });
    const run = await generate();
    const lessons = await lessonsOf(run.id);
    const phy = lessons.filter(l => l.subjectId === 'phy').map(at);
    const his = lessons.filter(l => l.subjectId === 'his').map(at);
    expect(phy.some(t => his.includes(t))).toBe(false);
    expect(run.stats.unitsUnplaced).toBeGreaterThan(0);
  });

  test('no enrolment recorded: a warning, and the option is kept apart from everything', async () => {
    mockDb.data.student_subjects = [];
    const pre = (await as(ADMIN).post('/api/timetable/generate/precheck').send(SCOPE)).body.data;
    expect(pre.precheck.find(p => p.code === 'elective_no_enrolment').message).toMatch(/Physics|History/);
    const run = await generate();
    const lessons = await lessonsOf(run.id);
    const c1 = lessons.filter(l => l.classId === 'c1').map(at);
    expect(new Set(c1).size).toBe(c1.length);   // nothing in Form 1A overlaps
  });
});

describe('apply is safe if writing fails part-way', () => {
  // Fail the next `count` timetable inserts (each after writing one doc, i.e. part-way).
  function failNextTimetableInsert(count = 1) {
    const orig = mockDb.model.bind(mockDb);
    let left = count;
    mockDb.model = (name) => {
      const m = orig(name);
      if (name === 'timetable') {
        const realInsert = m.insertMany;
        m.insertMany = async (docs) => {
          if (left <= 0) return realInsert(docs);
          left -= 1;
          await realInsert(docs.slice(0, 1));
          throw new Error('disk full');
        };
      }
      return m;
    };
  }

  test('if even the rollback fails, the run keeps the backup and says so', async () => {
    const run = await generate();
    failNextTimetableInsert(2);
    const res = await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(res.status).toBe(500);
    expect(res.body.error.message).toMatch(/could not be put back/);
    const saved = mockDb.data.timetable_generation_runs.find(r => r.id === run.id);
    expect(saved.status).toBe('applying');
    expect(saved.backup.map(l => l.id)).toEqual(['L_old']);
  });

  test('a failed insert puts the draft back exactly, and the run can be applied again', async () => {
    const run = await generate();
    failNextTimetableInsert();
    const res = await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('APPLY_FAILED');
    expect(mockDb.data.timetable.map(l => l.id).sort()).toEqual(['L_art', 'L_locked', 'L_old', 'L_primary']);
    expect(mockDb.data.timetable_generation_runs.find(r => r.id === run.id)).toMatchObject({ status: 'generated' });
    expect(markTimetableChanged).not.toHaveBeenCalled();
    const again = await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(again.status).toBe(200);
  });

  test('the backup is saved before any lesson is deleted', async () => {
    const run = await generate();
    const orig = mockDb.model.bind(mockDb);
    let backupAtDelete;
    mockDb.model = (name) => {
      const m = orig(name);
      if (name === 'timetable') {
        const realDelete = m.deleteMany;
        m.deleteMany = async (f) => { backupAtDelete = mockDb.data.timetable_generation_runs.find(r => r.id === run.id).backup; return realDelete(f); };
      }
      return m;
    };
    await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`);
    expect(backupAtDelete.map(l => l.id)).toEqual(['L_old']);
  });

  test('a run already being applied (by someone else) is refused, nothing changes', async () => {
    const run = await generate();
    mockDb.data.timetable_generation_runs.find(r => r.id === run.id).status = 'applying';
    expect((await as(ADMIN).post(`/api/timetable/generate/runs/${run.id}/apply`)).status).toBe(409);
    expect(mockDb.data.timetable.map(l => l.id).sort()).toEqual(['L_art', 'L_locked', 'L_old', 'L_primary']);
  });
});
