/* ============================================================
   Timetable → Subject allocation (v5.273.0)

   Asked for directly (2026-11-15): one place in the Timetable to see and
   enter who teaches what, whether a teacher has classes, and lessons per
   week — "without corrupting the existing data, assignment and
   attendance or any other dependent modules". The timetabler has full
   control of the timetable module and enters the allocation the school
   decides.

   Pins:
     - GET /api/timetable/allocation lists curriculum rows and every teacher;
     - the real 'timetabler' role (and a "Manage Whole-School Timetable"
       grant) can create, edit, change and remove assignments; a staff
       member merely TAGGED as timetable coordinator cannot; a plain
       teacher cannot;
     - changing a teacher updates the row in place (id, periods, link kept),
       moves access from the old teacher to the new one (the real scope
       loader attendance/marks use), and never touches attendance, marks,
       lesson plans or coverage;
     - moving lessons is all or nothing and refuses on a clash;
     - everything is scoped by schoolId.
   ============================================================ */
'use strict';

let mockJwtUser;
const mockGrants = { manage: false };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async (_req, mod, sub) => mod === 'timetable' && sub === 'manage' && mockGrants.manage),
  hasPermission: jest.fn(async () => false),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));
jest.mock('../../utils/academic-period', () => ({ resolveAcademicPeriod: async () => ({ academicYearId: 'ay1', termId: 't1' }) }));
jest.mock('../../utils/archival', () => ({ isYearArchived: async () => false }));
const mockChanged = jest.fn(async () => {});
jest.mock('../../utils/timetable-publish', () => ({
  getPublishState: async () => ({ published: true }),
  markTimetableChanged: (...a) => mockChanged(...a),
  isTimetablePublished: async () => true,
  publishedReader: async () => mockDb.model('timetable'),
  timetableReaderFor: async () => mockDb.model('timetable'),
  isTimetableEditor: () => true,
}));
jest.mock('../../routes/bell-schedule', () => ({ resolveBellSchedule: async () => null }));

const express = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');
const assignmentsRouter = require('../../routes/teaching-assignments');
const { _loadAssigned, invalidateScopeCache } = require('../../middleware/scopeMiddleware');

const S = 'school_A';
const TIMETABLER = { userId: 'u_tt', schoolId: S, role: 'timetabler', roles: ['timetabler'] };
const TAGGED = { userId: 'u_tag', schoolId: S, role: 'teacher', roles: ['teacher'], extraRoles: ['timetable_coordinator'] };
const TEACHER = { userId: 'u1', schoolId: S, role: 'teacher', roles: ['teacher'] };
const SECRETARY = { userId: 'u_sec', schoolId: S, role: 'secretary', roles: ['secretary'] };

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/timetable', timetableRouter);
  a.use('/api/teaching-assignments', assignmentsRouter);
  return a;
}
const as = (user) => { mockJwtUser = user; return supertest(app()); };
const lesson = (id, day, start, end, extra) => ({ id, schoolId: S, academicYearId: 'ay1', classId: 'c7', subjectId: 'mat', subject: 'Maths', teacherId: 'u1', teacherName: 'Agnes K', day, period: start, startTime: start, endTime: end, isActive: true, type: 'lesson', ...extra });

beforeEach(() => {
  mockGrants.manage = false;
  mockChanged.mockClear();
  mockDb = createFakeDb({
    classes: [{ id: 'c7', schoolId: S, name: 'Year 7' }, { id: 'c8', schoolId: S, name: 'Year 8' }],
    streams: [],
    subjects: [{ id: 'mat', schoolId: S, name: 'Maths', isActive: true }, { id: 'eng', schoolId: S, name: 'English', isActive: true }],
    class_subjects: [
      { schoolId: S, classId: 'c7', subjectId: 'mat', isCompulsoryForClass: true },
      { schoolId: S, classId: 'c7', subjectId: 'eng', isCompulsoryForClass: true },
      { schoolId: S, classId: 'c8', subjectId: 'mat', isCompulsoryForClass: true },
    ],
    teachers: [
      { id: 't1', schoolId: S, userId: 'u1', title: 'Ms.', firstName: 'Agnes', lastName: 'K', status: 'active', subjects: ['mat'] },
      { id: 't2', schoolId: S, userId: 'u2', title: 'Mr.', firstName: 'Ben', lastName: 'O', status: 'active', subjects: ['mat', 'eng'] },
      { id: 't3', schoolId: S, firstName: 'Cleo', lastName: 'N', status: 'active' },
      { id: 'tx', schoolId: 'school_B', userId: 'ux', firstName: 'Other', lastName: 'School', status: 'active' },
    ],
    users: [{ id: 'u1', schoolId: S, email: 'agnes@s.test' }, { id: 'u2', schoolId: S, email: 'ben@s.test' }],
    departments: [],
    teaching_assignments: [
      { id: 'a1', schoolId: S, classId: 'c7', className: 'Year 7', subjectId: 'mat', subjectName: 'Maths', teacherId: 'u1', teacherName: 'Ms. Agnes K', periodsPerWeek: 5, doubleLessons: 1, lessonGroupId: null, streamId: null },
    ],
    timetable: [
      lesson('l1', 'monday', '08:00', '08:40'),
      lesson('l2', 'tuesday', '08:00', '08:40'),
      lesson('l3', 'monday', '09:00', '09:40', { subjectId: 'eng', subject: 'English' }),   // another subject: never moved
    ],
    // Records already taken — must never change.
    attendance: [{ id: 'att1', schoolId: S, classId: 'c7', date: '2026-11-10', studentId: 'st1', status: 'present', markedBy: 'u1' }],
    assessment_marks: [{ id: 'mk1', schoolId: S, classId: 'c7', subjectId: 'mat', studentId: 'st1', rawScore: 70, updatedBy: 'u1' }],
    lesson_plans: [{ id: 'lp1', schoolId: S, classId: 'c7', subjectId: 'mat', teacherId: 'u1' }],
    lesson_coverage: [{ id: 'cov1', schoolId: S, classId: 'c7', subjectId: 'mat', topicId: 'tp1', teacherId: 'u1' }],
  });
});

const snapshot = () => JSON.stringify(['attendance', 'assessment_marks', 'lesson_plans', 'lesson_coverage'].map(c => mockDb.data[c]));

describe('GET /api/timetable/allocation', () => {
  test('lists every curriculum row with its teacher, and every teacher including one with no classes', async () => {
    const res = await as(TIMETABLER).get('/api/timetable/allocation');
    expect(res.status).toBe(200);
    const rows = res.body.data.rows.map(r => `${r.className}|${r.subjectName}|${r.status}`);
    expect(rows).toEqual(['Year 7|English|no_teacher', 'Year 7|Maths|short', 'Year 8|Maths|no_teacher']);
    const names = res.body.data.teachers.map(t => `${t.name}:${t.status}`);
    expect(names).toEqual(expect.arrayContaining(['Ms. Agnes K:ok', 'Mr. Ben O:no_classes', 'Cleo N:no_classes']));
    expect(names.join()).not.toMatch(/Other School/);
  });
  test('a leftover whole-class row says how many active students of this school are in no active stream (v5.282.0)', async () => {
    mockDb.data.streams.push({ id: 's7a', schoolId: S, classId: 'c7', name: '7A', status: 'active' }, { id: 'sold', schoolId: S, classId: 'c7', name: 'Old', status: 'inactive' });
    mockDb.data.students = [
      { id: 'p1', schoolId: S, classId: 'c7', status: 'active', streamId: 's7a' },
      { id: 'p2', schoolId: S, classId: 'c7', status: 'active' },
      { id: 'p3', schoolId: S, classId: 'c7', status: 'active', streamId: 'sold' },
      { id: 'p4', schoolId: S, classId: 'c7', status: 'withdrawn' },
      { id: 'p5', schoolId: S, classId: 'c8', status: 'active' },
      { id: 'p6', schoolId: 'school_B', classId: 'c7', status: 'active' },
    ];
    const rows = (await as(TIMETABLER).get('/api/timetable/allocation')).body.data.rows;
    const left = rows.find(r => r.classId === 'c7' && !r.streamId && r.subjectId === 'mat');
    expect(left).toMatchObject({ note: 'whole_class_row_for_streamed_subject', studentsWithoutStream: 2, moveTo: [{ id: 's7a', name: '7A', teachers: [] }] });
    expect(rows.filter(r => r !== left).every(r => r.studentsWithoutStream === undefined)).toBe(true);
  });
  test('a plain teacher cannot open it', async () => {
    expect((await as(TEACHER).get('/api/timetable/allocation')).status).toBe(403);
  });
});

describe('who may enter the allocation', () => {
  test('the timetabler can assign a teacher, set lessons per week and doubles, and remove an assignment', async () => {
    const created = await as(TIMETABLER).post('/api/teaching-assignments').send({ teacherId: 'u2', subjectId: 'eng', classId: 'c7' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ teacherId: 'u2', subjectName: 'English', className: 'Year 7' });
    const upd = await as(TIMETABLER).put(`/api/teaching-assignments/${created.body.data.id}`).send({ periodsPerWeek: 4, doubleLessons: 1 });
    expect(upd.status).toBe(200);
    const del = await as(TIMETABLER).delete(`/api/teaching-assignments/${created.body.data.id}`);
    expect(del.status).toBe(200);
  });
  test('a role granted "Manage Whole-School Timetable" can too', async () => {
    mockGrants.manage = true;
    expect((await as(SECRETARY).post('/api/teaching-assignments').send({ teacherId: 'u2', subjectId: 'eng', classId: 'c7' })).status).toBe(201);
  });
  test('a teacher merely tagged as timetable coordinator, or a plain teacher, cannot', async () => {
    expect((await as(TAGGED).post('/api/teaching-assignments').send({ teacherId: 'u2', subjectId: 'eng', classId: 'c7' })).status).toBe(403);
    expect((await as(TEACHER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2' })).status).toBe(403);
    expect(mockDb.data.teaching_assignments.find(a => a.id === 'a1').teacherId).toBe('u1');
  });
});

describe('PUT /api/teaching-assignments/:id/teacher — change who teaches it', () => {
  test('updates the row in place and keeps its settings; records already taken are untouched', async () => {
    const before = snapshot();
    const res = await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2' });
    expect(res.status).toBe(200);
    expect(res.body.data.assignment).toMatchObject({ id: 'a1', teacherId: 'u2', teacherName: 'Mr. Ben O', periodsPerWeek: 5, doubleLessons: 1, reassignedFrom: 'u1' });
    expect(mockDb.data.teaching_assignments).toHaveLength(1);
    expect(snapshot()).toBe(before);
    // Without moveLessons the lessons stay with the old teacher.
    expect(mockDb.data.timetable.filter(l => l.subjectId === 'mat').every(l => l.teacherId === 'u1')).toBe(true);
    expect(mockChanged).not.toHaveBeenCalled();
  });

  test('access (the real loader behind attendance, Markbook and lesson plans) follows the allocation and the lessons', async () => {
    const scope = async (u) => { invalidateScopeCache(u, S); return _loadAssigned(u, S); };
    expect((await scope('u1')).subjectIds).toContain('mat');
    expect((await scope('u2')).classIds).not.toContain('c7');

    // Change only the allocation: the new teacher gains the class at once; the old
    // one still has Maths lessons on the draft, so keeps Maths through those.
    await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2' });
    expect((await scope('u2'))).toMatchObject({ classIds: expect.arrayContaining(['c7']), subjectIds: expect.arrayContaining(['mat']) });
    expect((await scope('u1')).subjectIds).toContain('mat');
  });

  test('a clash with the new teacher\x27s lessons refuses the whole change — nothing is written', async () => {
    mockDb.data.timetable.push(lesson('lx', 'monday', '08:00', '08:40', { classId: 'c8', teacherId: 'u2', teacherName: 'Mr. Ben O' }));
    const res = await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2', moveLessons: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LESSON_CLASH');
    expect(res.body.error.clashes).toHaveLength(1);
    expect(mockDb.data.teaching_assignments[0].teacherId).toBe('u1');
    expect(mockDb.data.timetable.find(l => l.id === 'l1').teacherId).toBe('u1');
  });

  test.each([[1, 'u2'], [2, 'u1']])('a stream row in a class with %i stream(s): whole-class lessons go to %s (v5.282.1)', async (n, want) => {
    mockDb.data.streams = [{ id: 's7a', schoolId: S, classId: 'c7', name: '7A', status: 'active' }, { id: 's7b', schoolId: S, classId: 'c7', name: '7B', status: 'active' }].slice(0, n);
    mockDb.data.teaching_assignments[0].streamId = 's7a';
    mockDb.data.timetable.push(lesson('l4', 'wednesday', '08:00', '08:40', { streamId: 's7a' }), lesson('l5', 'thursday', '08:00', '08:40', { streamId: 'other' }));
    const res = await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2', moveLessons: true });
    expect(res.status).toBe(200);
    const of = (id) => mockDb.data.timetable.find(l => l.id === id).teacherId;
    expect([of('l1'), of('l2'), of('l4'), of('l5'), of('l3')]).toEqual([want, want, 'u2', 'u1', 'u1']);
  });

  test('refuses the same teacher, a duplicate, an unknown teacher, and another school\x27s teacher', async () => {
    expect((await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 't1' })).status).toBe(400);
    mockDb.data.teaching_assignments.push({ id: 'a2', schoolId: S, classId: 'c7', subjectId: 'mat', teacherId: 'u2', streamId: null });
    expect((await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2' })).status).toBe(409);
    expect((await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'nobody' })).status).toBe(404);
    expect((await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'ux' })).status).toBe(404);
    expect(mockDb.data.teaching_assignments.find(a => a.id === 'a1').teacherId).toBe('u1');
  });

  test('a teacher with no login is keyed by their teacher id, and another school\x27s assignment is not found', async () => {
    const res = await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 't3' });
    expect(res.status).toBe(200);
    expect(res.body.data.assignment.teacherId).toBe('t3');
    mockDb.data.teaching_assignments.push({ id: 'b1', schoolId: 'school_B', classId: 'c7', subjectId: 'mat', teacherId: 'ux' });
    expect((await as(TIMETABLER).put('/api/teaching-assignments/b1/teacher').send({ teacherId: 'u2' })).status).toBe(404);
  });
});

describe('one place for data entry (v5.274.0)', () => {
  const HOD = { userId: 'u_hod', schoolId: S, role: 'teacher', roles: ['teacher'], extraRoles: ['hod'], departmentId: 'd_math' };
  test('a head of department reads but cannot create, edit, change or remove', async () => {
    expect((await as(HOD).get('/api/teaching-assignments')).status).toBe(200);
    expect((await as(HOD).post('/api/teaching-assignments').send({ teacherId: 'u2', subjectId: 'eng', classId: 'c7' })).status).toBe(403);
    expect((await as(HOD).put('/api/teaching-assignments/a1').send({ periodsPerWeek: 3 })).status).toBe(403);
    expect((await as(HOD).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 'u2' })).status).toBe(403);
    expect((await as(HOD).delete('/api/teaching-assignments/a1')).status).toBe(403);
    expect(mockDb.data.teaching_assignments).toHaveLength(1);
  });
  test('a teacher who has left or is inactive cannot be given an assignment; one on leave can', async () => {
    mockDb.data.teachers.push(
      { id: 't_left', schoolId: S, firstName: 'Left', lastName: 'X', status: 'terminated' },
      { id: 't_off', schoolId: S, firstName: 'Off', lastName: 'Y', status: 'inactive' },
      { id: 't_leave', schoolId: S, firstName: 'Leave', lastName: 'Z', status: 'on_leave' },
    );
    const left = await as(TIMETABLER).post('/api/teaching-assignments').send({ teacherId: 't_left', subjectId: 'eng', classId: 'c7' });
    expect(left.status).toBe(400);
    expect(left.body.error.message).toMatch(/left the school/);
    expect((await as(TIMETABLER).put('/api/teaching-assignments/a1/teacher').send({ teacherId: 't_off' })).status).toBe(400);
    expect((await as(TIMETABLER).post('/api/teaching-assignments').send({ teacherId: 't_leave', subjectId: 'eng', classId: 'c7' })).status).toBe(201);
  });
});
