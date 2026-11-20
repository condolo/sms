/* ============================================================
   Per-student syllabus coverage (v5.277.0)

   Requested by Mascit Lab Academy: in a tuition-style class, students can
   be at different points of the syllabus. Marking stays whole-class/stream
   by default; a teacher can instead mark a topic covered for selected
   students. Pins, through the real lessons router:
     - POST /coverage with studentIds writes one record per student and no
       whole-class record; a student outside the class/stream is refused;
     - a whole-class mark and a student's own mark are separate records;
     - GET /coverage: whole-class "covered" ignores individual marks, lists
       them per item, and ?studentId shows that student's own view;
     - DELETE /coverage (bulk) removes only the whole-class mark unless a
       studentId is given;
     - class summary: class % ignores individual marks; ?studentId adds them;
     - GET /roster: an elective's roster is its enrolled students; a stream-
       scoped one is the stream's students; leavers never appear.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next(), invalidateScopeCache: () => {} }));
jest.mock('../../utils/scopeEngine', () => ({ resolveLessonsScope: async () => null, isClassInScope: () => true }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: async () => ({ title: 'Ms.', firstName: 'Ann', lastName: 'Teacher' }) }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
// The shared fixture has no upsert or findOneAndDelete; lessons coverage
// needs both, so this file adds them on top without changing the fixture.
function mockModel(name) {
  const m = mockDb.model(name);
  const rows = () => mockDb.data[name];
  return {
    ...m,
    findOneAndUpdate: (filter, update, opts = {}) => {
      const run = async () => {
        let r = (await m.find(filter).lean())[0];
        if (r) {
          r = rows().find(x => x.id === r.id);
          Object.assign(r, update.$set || {});
          return JSON.parse(JSON.stringify(r));
        }
        if (!opts.upsert) return null;
        const plain = Object.fromEntries(Object.entries(filter).filter(([k, v]) => !k.startsWith('$') && (typeof v !== 'object' || v === null)));
        const doc = { ...plain, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
        rows().push(doc);
        return JSON.parse(JSON.stringify(doc));
      };
      return { lean: run, then: (a, b) => run().then(a, b) };
    },
    findOneAndDelete: async (filter) => {
      const hit = (await m.find(filter).lean())[0];
      if (!hit) return null;
      mockDb.data[name] = rows().filter(x => x.id !== hit.id);
      return hit;
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockModel(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockModel(name) }));

const express = require('express');
const supertest = require('supertest');

const S = 'sch_1';
const ADMIN = { userId: 'u_admin', schoolId: S, role: 'admin', roles: ['admin'] };
const api = () => { mockJwtUser = ADMIN; const a = express(); a.use(express.json()); a.use('/api/lessons', require('../../routes/lessons')); return supertest(a); };
const BASE = { classId: 'c1', subjectId: 'math' };

function seed() {
  const st = (id, extra = {}) => ({ id, schoolId: S, classId: 'c1', status: 'active', firstName: id.toUpperCase(), lastName: 'X', ...extra });
  mockDb = createFakeDb({
    schools: [{ id: S, academicYear: '2026' }],
    classes: [{ id: 'c1', schoolId: S, name: 'Year 9' }],
    students: [st('ann', { streamId: 'east' }), st('ben', { streamId: 'east' }), st('cal', { streamId: 'west' }), st('dee', { status: 'withdrawn' }), { id: 'zed', schoolId: S, classId: 'c2', status: 'active', firstName: 'Zed' }],
    syllabus_topics: [
      { id: 't1', schoolId: S, subjectId: 'math', classId: 'c1', academicYear: '2026', title: 'Algebra', order: 1, subtopics: [{ id: 's1', title: 'Linear' }, { id: 's2', title: 'Quadratic' }] },
      { id: 't2', schoolId: S, subjectId: 'math', classId: 'c1', academicYear: '2026', title: 'Geometry', order: 2, subtopics: [] },
    ],
    lesson_coverage: [],
    teaching_assignments: [{ id: 'ta1', schoolId: S, classId: 'c1', subjectId: 'math', subjectName: 'Maths', teacherId: 'u_t' }],
    class_subjects: [
      { id: 'l1', schoolId: S, classId: 'c1', subjectId: 'math', isCompulsoryForClass: true },
      { id: 'l2', schoolId: S, classId: 'c1', subjectId: 'fre', isCompulsoryForClass: false },
    ],
    student_subjects: [{ id: 'e1', schoolId: S, studentId: 'cal', subjectId: 'fre' }, { id: 'e2', schoolId: S, studentId: 'dee', subjectId: 'fre' }],
  });
}
const cov = () => mockDb.data.lesson_coverage;

describe('marking coverage for selected students', () => {
  beforeEach(seed);

  test('one record per student, named, and no whole-class record', async () => {
    const res = await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't2', studentIds: ['ann', 'ben', 'ann'] });
    expect(res.status).toBe(200);
    expect(res.body.data.students).toBe(2);
    expect(cov().map(r => [r.studentId, r.studentName]).sort()).toEqual([['ann', 'ANN X'], ['ben', 'BEN X']]);
    expect(cov().every(r => r.studentId)).toBe(true);
  });

  test('a student outside the class, or outside the stream, is refused and nothing is written', async () => {
    let res = await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't2', studentIds: ['ann', 'zed'] });
    expect(res.status).toBe(422);
    res = await api().post('/api/lessons/coverage').send({ ...BASE, streamId: 'east', topicId: 't2', studentIds: ['cal'] });
    expect(res.status).toBe(422);
    expect(cov()).toEqual([]);
  });

  test('a whole-class mark after an individual one is its own record; neither overwrites the other', async () => {
    await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't2', studentIds: ['ann'] });
    await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't2' });
    expect(cov()).toHaveLength(2);
    expect(cov().filter(r => !r.studentId)).toHaveLength(1);
    expect(cov().find(r => r.studentId === 'ann')).toBeTruthy();
  });
});

describe('reading coverage', () => {
  beforeEach(async () => {
    seed();
    await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't1', subtopicId: 's1', studentIds: ['ann'] });
    await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't1', subtopicId: 's2', studentIds: ['ann'] });
    await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't2' });   // whole class
  });

  test('whole-class view: individual marks never count as class coverage, but are listed', async () => {
    const { topics } = (await api().get('/api/lessons/coverage').query(BASE)).body.data;
    const alg = topics.find(t => t.id === 't1');
    expect(alg.covered).toBe(false);
    expect(alg.subtopics[0].studentCoverage.map(x => x.studentName)).toEqual(['ANN X']);
    expect(topics.find(t => t.id === 't2').covered).toBe(true);
  });

  test('?studentId: that student sees their own marks plus the whole-class ones', async () => {
    const ann = (await api().get('/api/lessons/coverage').query({ ...BASE, studentId: 'ann' })).body.data.topics;
    expect(ann.every(t => t.covered)).toBe(true);
    const ben = (await api().get('/api/lessons/coverage').query({ ...BASE, studentId: 'ben' })).body.data.topics;
    expect(ben.map(t => t.covered)).toEqual([false, true]);
  });

  test('class summary: class % ignores individual marks; ?studentId adds that student\x27s', async () => {
    const cls = (await api().get('/api/lessons/class-summary/c1')).body.data[0];
    expect(cls).toMatchObject({ totalItems: 3, coveredItems: 1 });
    const ann = (await api().get('/api/lessons/class-summary/c1').query({ studentId: 'ann' })).body.data[0];
    expect(ann).toMatchObject({ totalItems: 3, coveredItems: 3, pct: 100 });
  });

  test('unmarking for the class leaves students\x27 own marks; ?studentId removes just that one', async () => {
    await api().post('/api/lessons/coverage').send({ ...BASE, topicId: 't1', subtopicId: 's1' });   // class mark too
    await api().delete('/api/lessons/coverage').query({ ...BASE, topicId: 't1', subtopicId: 's1' });
    expect(cov().filter(r => r.subtopicId === 's1').map(r => r.studentId)).toEqual(['ann']);
    await api().delete('/api/lessons/coverage').query({ ...BASE, topicId: 't1', subtopicId: 's1', studentId: 'ann' });
    expect(cov().filter(r => r.subtopicId === 's1')).toEqual([]);
  });
});

describe('GET /roster', () => {
  beforeEach(seed);
  test('compulsory: the class\x27s active students, narrowed to the stream when given', async () => {
    const all = (await api().get('/api/lessons/roster').query(BASE)).body.data;
    expect(all.elective).toBe(false);
    expect(all.students.map(s => s.id)).toEqual(['ann', 'ben', 'cal']);
    const east = (await api().get('/api/lessons/roster').query({ ...BASE, streamId: 'east' })).body.data;
    expect(east.students.map(s => s.id)).toEqual(['ann', 'ben']);
  });
  test('elective: only the students enrolled in it (leavers excluded)', async () => {
    const fre = (await api().get('/api/lessons/roster').query({ classId: 'c1', subjectId: 'fre' })).body.data;
    expect(fre).toMatchObject({ elective: true });
    expect(fre.students.map(s => s.id)).toEqual(['cal']);
  });
});
