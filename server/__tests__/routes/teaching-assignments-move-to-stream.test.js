/* ============================================================
   Leftover whole-class assignments → stream (v5.282.0)

   Reported 2026-11-25 (KG1 - RUBY): a teacher assigned to a whole class
   before the class had a stream is left on a row no teacher can be added
   to ("select which stream this teacher covers"), while the stream's own
   row has no teacher.

   Pins:
     - PUT /:id/streams turns the row into the chosen stream row(s), keeping
       id, teacher, lessons per week, doubles and room; copies for the rest;
     - refusals write nothing: no stream, another class's or an inactive
       stream, not compulsory, already a stream row, already on that stream,
       linked "taught together", teacher who has left, changed meanwhile;
     - who may do it is the same as every other assignment change;
     - everything is scoped by schoolId; records already taken and draft
       lessons never change; access narrows to the stream at once;
     - adding a stream / making a subject compulsory reports who needs a
       stream and moves nothing.
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
jest.mock('../../services/audit', () => ({ log: jest.fn(async () => {}) }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));

const express = require('express');
const supertest = require('supertest');
const assignmentsRouter = require('../../routes/teaching-assignments');
const streamsRouter = require('../../routes/streams');
const classSubjectsRouter = require('../../routes/class-subjects');
const { _loadAssigned, invalidateScopeCache } = require('../../middleware/scopeMiddleware');

const S = 'school_A';
const TIMETABLER = { userId: 'u_tt', schoolId: S, role: 'timetabler', roles: ['timetabler'] };
const ADMIN = { userId: 'u_ad', schoolId: S, role: 'admin', roles: ['admin'] };
const TAGGED = { userId: 'u_tag', schoolId: S, role: 'teacher', roles: ['teacher'], extraRoles: ['timetable_coordinator'] };
const TEACHER = { userId: 'u1', schoolId: S, role: 'teacher', roles: ['teacher'] };
const OTHER = { userId: 'u_b', schoolId: 'school_B', role: 'admin', roles: ['admin'] };

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/teaching-assignments', assignmentsRouter);
  a.use('/api/streams', streamsRouter);
  a.use('/api/class-subjects', classSubjectsRouter);
  return a;
}
const as = (user) => { mockJwtUser = user; return supertest(app()); };
const move = (user, id, body) => as(user).put(`/api/teaching-assignments/${id}/streams`).send(body);
const ta = () => mockDb.data.teaching_assignments;
const row = (id) => ta().find(a => a.id === id);

beforeEach(() => {
  mockGrants.manage = false;
  mockDb = createFakeDb({
    classes: [{ id: 'kg1r', schoolId: S, name: 'KG1 - RUBY' }, { id: 'y7', schoolId: S, name: 'Year 7' }, { id: 'kg2', schoolId: S, name: 'KG2' }],
    streams: [
      { id: 'ruby', schoolId: S, classId: 'kg1r', name: 'RUBY', status: 'active' },
      { id: 'old', schoolId: S, classId: 'kg1r', name: 'Old', status: 'inactive' },
      { id: '7a', schoolId: S, classId: 'y7', name: '7A', status: 'active' },
      { id: '7b', schoolId: S, classId: 'y7', name: '7B', status: 'active' },
    ],
    subjects: [{ id: 'cre', schoolId: S, name: 'CRE', isActive: true, isCompulsory: true }, { id: 'art', schoolId: S, name: 'Art', isActive: true }],
    class_subjects: [
      { id: 'cs1', schoolId: S, classId: 'kg1r', subjectId: 'cre', isCompulsoryForClass: true },
      { id: 'cs2', schoolId: S, classId: 'kg1r', subjectId: 'art', isCompulsoryForClass: false },
      { id: 'cs3', schoolId: S, classId: 'y7', subjectId: 'cre', isCompulsoryForClass: true },
      { id: 'cs4', schoolId: S, classId: 'kg2', subjectId: 'cre', isCompulsoryForClass: true },
    ],
    teachers: [
      { id: 't1', schoolId: S, userId: 'u1', firstName: 'Angela', lastName: 'K', status: 'active' },
      { id: 't2', schoolId: S, userId: 'u2', firstName: 'Ben', lastName: 'O', status: 'active' },
      { id: 't3', schoolId: S, userId: 'u3', firstName: 'Gone', lastName: 'T', status: 'terminated' },
    ],
    users: [],
    student_subjects: [],
    students: [],
    teaching_assignments: [
      { id: 'a1', schoolId: S, classId: 'kg1r', className: 'KG1 - RUBY', subjectId: 'cre', subjectName: 'CRE', teacherId: 'u1', teacherName: 'Angela K', streamId: null, streamName: null, periodsPerWeek: 3, doubleLessons: 1, preferredRoomId: 'rm1', preferredRoomName: 'Room 1', lessonGroupId: null },
      { id: 'a2', schoolId: S, classId: 'kg1r', subjectId: 'art', subjectName: 'Art', teacherId: 'u1', teacherName: 'Angela K', streamId: null, lessonGroupId: null },
      { id: 'a3', schoolId: S, classId: 'y7', className: 'Year 7', subjectId: 'cre', subjectName: 'CRE', teacherId: 'u1', teacherName: 'Angela K', streamId: null, periodsPerWeek: 2, doubleLessons: 0, lessonGroupId: null },
      { id: 'a4', schoolId: S, classId: 'kg2', subjectId: 'cre', subjectName: 'CRE', teacherId: 'u2', teacherName: 'Ben O', streamId: null, lessonGroupId: null },
    ],
    timetable: [{ id: 'l1', schoolId: S, classId: 'kg1r', subjectId: 'cre', teacherId: 'u1', streamId: null, day: 'monday', isActive: true, type: 'lesson' }],
    attendance: [{ id: 'att1', schoolId: S, classId: 'kg1r', studentId: 's1', status: 'present' }],
    assessment_marks: [{ id: 'm1', schoolId: S, classId: 'kg1r', streamId: 'ruby', subjectId: 'cre', studentId: 's1', rawScore: 8 }],
    lesson_plans: [{ id: 'lp1', schoolId: S, classId: 'kg1r', subjectId: 'cre', teacherId: 'u1' }],
  });
  for (const u of ['u1', 'u2']) invalidateScopeCache(u, S);
});

describe('moving a leftover row', () => {
  test('one stream: the same row becomes the stream row, everything on it kept', async () => {
    const r = await move(TIMETABLER, 'a1', { streamIds: ['ruby'] });
    expect(r.status).toBe(200);
    expect(row('a1')).toMatchObject({ teacherId: 'u1', streamId: 'ruby', streamName: 'RUBY', periodsPerWeek: 3, doubleLessons: 1, preferredRoomId: 'rm1', lessonGroupId: null });
    expect(ta()).toHaveLength(4);
    expect(r.body.data.created).toEqual([]);
  });

  test('several streams: one row each; taught together only when asked', async () => {
    const r = await move(ADMIN, 'a3', { streamIds: ['7a', '7b'] });
    expect(r.status).toBe(200);
    const rows = ta().filter(a => a.classId === 'y7');
    expect(rows.map(a => [a.streamName, a.teacherId, a.periodsPerWeek, a.lessonGroupId])).toEqual([['7A', 'u1', 2, null], ['7B', 'u1', 2, null]]);
    expect(rows.every(a => a.schoolId === S)).toBe(true);
    expect(new Set(rows.map(a => a.id)).size).toBe(2);
  });

  test('together: the streams share one set of lessons', async () => {
    await move(ADMIN, 'a3', { streamIds: ['7a', '7b'], together: true });
    const groups = ta().filter(a => a.classId === 'y7').map(a => a.lessonGroupId);
    expect(groups[0]).toBeTruthy();
    expect(groups[0]).toBe(groups[1]);
  });

  test('together with one stream links nothing', async () => {
    await move(ADMIN, 'a1', { streamIds: ['ruby'], together: true });
    expect(row('a1').lessonGroupId).toBe(null);
  });

  test('another teacher already on the stream stays; both are listed', async () => {
    ta().push({ id: 'a9', schoolId: S, classId: 'kg1r', subjectId: 'cre', teacherId: 'u2', streamId: 'ruby', lessonGroupId: null });
    expect((await move(ADMIN, 'a1', { streamIds: ['ruby'] })).status).toBe(200);
    expect(ta().filter(a => a.streamId === 'ruby').map(a => a.teacherId).sort()).toEqual(['u1', 'u2']);
  });

  test('a class whose assignment stores its _id form is matched', async () => {
    const oid = '64b000000000000000000001';
    mockDb.data.classes.push({ _id: oid, schoolId: S, name: 'Legacy' });
    mockDb.data.streams.push({ id: 'lg', schoolId: S, classId: oid, name: 'L1', status: 'active' });
    mockDb.data.class_subjects.push({ id: 'cs9', schoolId: S, classId: oid, subjectId: 'cre', isCompulsoryForClass: true });
    ta().push({ id: 'a9', schoolId: S, classId: oid, subjectId: 'cre', teacherId: 'u1', streamId: null });
    expect((await move(ADMIN, 'a9', { streamIds: ['lg'] })).status).toBe(200);
    expect(row('a9').streamId).toBe('lg');
  });

  test('draft lessons and records already taken never change; access narrows to the stream', async () => {
    const snap = () => JSON.stringify([mockDb.data.timetable, mockDb.data.attendance, mockDb.data.assessment_marks, mockDb.data.lesson_plans]);
    const before = snap();
    mockDb.data.timetable.length = 0;
    const empty = snap();
    await move(ADMIN, 'a3', { streamIds: ['7a'] });
    expect(snap()).toBe(empty);
    const scope = await _loadAssigned('u1', S);
    expect(JSON.stringify(scope)).toContain('7a');
    expect(JSON.stringify(scope)).not.toContain('7b');
    expect(before).not.toBe(empty);
  });
});

describe('refusals write nothing', () => {
  const refused = async (id, body, status, text, setup) => {
    if (setup) setup();
    const before = JSON.stringify(ta());
    const r = await move(ADMIN, id, body);
    expect([r.status, r.body.error?.message]).toEqual([status, expect.stringMatching(text)]);
    expect(JSON.stringify(ta())).toBe(before);
  };
  test('no stream chosen', () => refused('a1', { streamIds: [] }, 400, /Choose the stream/));
  test('not a list', () => refused('a1', { streamIds: { $ne: null } }, 400, /Choose the stream/));
  test('objects inside the list are ignored', () => refused('a1', { streamIds: [{ $ne: null }] }, 400, /Choose the stream/));
  test('a stream of another class', () => refused('a1', { streamIds: ['7a'] }, 404, /Stream not found/));
  test('one good and one bad stream', () => refused('a3', { streamIds: ['7a', 'ruby'] }, 404, /Stream not found/));
  test('an inactive stream', () => refused('a1', { streamIds: ['old'] }, 404, /Stream not found/));
  test('an elective keeps its whole-class teacher', () => refused('a2', { streamIds: ['ruby'] }, 400, /not compulsory/));
  test('already a stream row', () => refused('a1', { streamIds: ['ruby'] }, 400, /already has a stream/, () => { row('a1').streamId = 'ruby'; }));
  test('linked taught together', () => refused('a1', { streamIds: ['ruby'] }, 400, /separate them/, () => { row('a1').lessonGroupId = 'g1'; }));
  test('teacher has left', () => refused('a1', { streamIds: ['ruby'] }, 400, /has left the school. Remove this row/, () => { row('a1').teacherId = 'u3'; }));
  test('teacher has no staff record', () => refused('a1', { streamIds: ['ruby'] }, 400, /no staff record/, () => { row('a1').teacherId = 'ghost'; }));
  test('teacher is already on that stream (either id form)', () => refused('a1', { streamIds: ['ruby'] }, 409, /Remove this old row/, () => {
    ta().push({ id: 'a9', schoolId: S, classId: 'kg1r', subjectId: 'cre', teacherId: 't1', streamId: 'ruby' });
  }));
  test('already on one of two streams', () => refused('a3', { streamIds: ['7a', '7b'] }, 409, /7B.*Choose only the other/, () => {
    ta().push({ id: 'a9', schoolId: S, classId: 'y7', subjectId: 'cre', teacherId: 'u1', streamId: '7b' });
  }));

  test('changed by someone else meanwhile: no stray copies', async () => {
    const real = mockDb.model;
    mockDb.model = (name) => {
      const m = real(name);
      if (name !== 'teaching_assignments') return m;
      return { ...m, insertMany: async (d) => { const r = await m.insertMany(d); row('a3').teacherId = 'u2'; return r; } };
    };
    const r = await move(ADMIN, 'a3', { streamIds: ['7a', '7b'] });
    expect(r.status).toBe(409);
    expect(ta().filter(a => a.classId === 'y7').map(a => [a.id, a.streamId, a.teacherId])).toEqual([['a3', null, 'u2']]);
  });

  test('a failed write leaves no stray copies', async () => {
    const real = mockDb.model;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.model = (name) => {
      const m = real(name);
      return name === 'teaching_assignments' ? { ...m, findOneAndUpdate: () => ({ lean: () => Promise.reject(new Error('down')) }) } : m;
    };
    const r = await move(ADMIN, 'a3', { streamIds: ['7a', '7b'] });
    expect(r.status).toBe(500);
    expect(ta().filter(a => a.classId === 'y7')).toHaveLength(1);
    console.error.mockRestore();
  });
});

describe('who may move', () => {
  test.each([['a teacher', TEACHER], ['a staff member only tagged as timetable coordinator', TAGGED]])('%s is refused', async (_n, u) => {
    expect((await move(u, 'a1', { streamIds: ['ruby'] })).status).toBe(403);
    expect(row('a1').streamId).toBe(null);
  });
  test('a "Manage Whole-School Timetable" grant is enough', async () => {
    mockGrants.manage = true;
    expect((await move({ ...TEACHER, userId: 'u_x' }, 'a1', { streamIds: ['ruby'] })).status).toBe(200);
  });
  test('another school cannot see or move the row', async () => {
    expect((await move(OTHER, 'a1', { streamIds: ['ruby'] })).status).toBe(404);
    expect(row('a1').streamId).toBe(null);
  });
});

describe('telling the school who needs a stream', () => {
  test('adding a stream lists compulsory whole-class teachers of that class only, and moves nothing', async () => {
    const before = JSON.stringify(ta());
    const r = await as(ADMIN).post('/api/streams').send({ classId: 'kg2', name: 'OPAL' });
    expect(r.status).toBe(201);
    expect(r.body.data.needsStream.map(n => [n.subjectName, n.teacherName])).toEqual([['CRE', 'Ben O']]);
    expect(r.body.data.name).toBe('OPAL');
    expect(JSON.stringify(ta())).toBe(before);
  });

  test('rows with no stored names still show who and what', async () => {
    Object.assign(row('a4'), { teacherName: undefined, subjectName: undefined });
    const r = await as(ADMIN).post('/api/streams').send({ classId: 'kg2', name: 'OPAL' });
    expect(r.body.data.needsStream.map(n => [n.subjectName, n.teacherName])).toEqual([['CRE', 'Ben O']]);
  });

  test('a failed lookup never fails the stream that was created', async () => {
    const real = mockDb.model;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.model = (name) => { if (name === 'teaching_assignments') throw new Error('down'); return real(name); };
    const r = await as(ADMIN).post('/api/streams').send({ classId: 'kg2', name: 'OPAL' });
    expect([r.status, r.body.data.needsStream]).toEqual([201, []]);
    console.error.mockRestore();
  });

  test('making a subject compulsory lists that subject\'s whole-class teachers; making it elective lists none', async () => {
    mockDb.data.class_subjects.forEach(c => { c.toObject = undefined; });
    const real = mockDb.model;
    mockDb.model = (name) => {
      const m = real(name);
      if (name !== 'class_subjects') return m;
      return { ...m, findOneAndUpdate: (f, u) => m.findOneAndUpdate(f, u).lean().then(d => d && ({ ...d, toObject: () => d })) };
    };
    const on = await as(ADMIN).put('/api/class-subjects/cs2').send({ isCompulsoryForClass: true });
    expect(on.body.data.needsStream.map(n => n.subjectId)).toEqual(['art']);
    const off = await as(ADMIN).put('/api/class-subjects/cs2').send({ isCompulsoryForClass: false });
    expect(off.body.data.needsStream).toBeUndefined();
  });

  test('matching the Catalog previews who will need a stream, before anything changes', async () => {
    mockDb.data.class_subjects.find(c => c.id === 'cs1').isCompulsoryForClass = false;   // Catalog says compulsory
    const r = await as(ADMIN).post('/api/class-subjects/apply-catalog').send({ classId: 'kg1r', dryRun: true });
    expect(r.body.data.needsStream.map(n => [n.className, n.subjectName, n.teacherName])).toEqual([['KG1 - RUBY', 'CRE', 'Angela K']]);
    expect(r.body.data.applied).toBe(false);
  });

  test('another school\'s teachers are never listed', async () => {
    ta().push({ id: 'b1', schoolId: 'school_B', classId: 'kg2', subjectId: 'cre', subjectName: 'CRE', teacherName: 'Other', streamId: null });
    const r = await as(ADMIN).post('/api/streams').send({ classId: 'kg2', name: 'OPAL' });
    expect(r.body.data.needsStream.map(n => n.teacherName)).toEqual(['Ben O']);
  });
});
