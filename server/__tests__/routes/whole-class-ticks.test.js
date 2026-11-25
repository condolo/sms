/* ============================================================
   Whole-class topic ticks count for every stream (v5.283.0)

   A class gets streams (or its whole-class teacher is moved to one,
   v5.282.0) after topics were ticked for the whole class. Those ticks
   have no streamId; the stream's teacher, the HOD and the reminders read
   the stream's own ticks only, so progress dropped to 0% and the same
   topics were asked for again. Pins, through the real routers:
     - a whole-class tick counts for every stream; a stream's tick never
       counts for another stream or for the whole class;
     - an item ticked by both counts once;
     - unticking from a stream takes it off that stream only, whoever
       ticked it, and never deletes the whole-class tick;
     - who may do that, and that a page without ?streamId can't delete it;
     - one student's mark from before streams shows only in their stream;
     - lesson plans made for the whole class; reminders; other schools.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); } }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next(), invalidateScopeCache: () => {} }));
jest.mock('../../utils/scopeEngine', () => ({ resolveLessonsScope: async () => null, isClassInScope: () => true }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: async () => ({ title: 'Ms.', firstName: 'Ann', lastName: 'Teacher' }) }));
jest.mock('../../utils/timetable-publish', () => ({
  timetableReaderFor: async () => mockModel('timetable'), publishedReader: async () => mockModel('timetable'), isTimetablePublished: async () => true,
}));
jest.mock('../../utils/lesson-email', () => ({ sendLessonReminder: jest.fn(), sendHodEscalation: jest.fn() }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
// Upsert, deletes and $addToSet, which the shared fixture leaves out.
function mockModel(name) {
  const m = mockDb.model(name);
  const rows = () => (mockDb.data[name] = mockDb.data[name] || []);
  const hits = async (f) => { const ids = (await m.find(f).lean()).map(r => r.id); return rows().filter(r => ids.includes(r.id)); };
  return {
    ...m,
    findOneAndUpdate: (filter, update) => ({ lean: async () => {
      const r = (await hits(filter))[0];
      if (r) { Object.assign(r, update.$set || {}); return { ...r }; }
      const plain = Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v === null));
      const doc = { ...plain, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
      rows().push(doc);
      return { ...doc };
    } }),
    findOneAndDelete: async (filter) => {
      const r = (await hits(filter))[0];
      if (!r) return null;
      mockDb.data[name] = rows().filter(x => x.id !== r.id);
      return r;
    },
    deleteMany: async (filter) => {
      const gone = await hits(filter);
      mockDb.data[name] = rows().filter(x => !gone.includes(x));
      return { deletedCount: gone.length };
    },
    updateMany: async (filter, update) => {
      const list = await hits(filter);
      for (const r of list) {
        Object.assign(r, update.$set || {});
        for (const [k, v] of Object.entries(update.$addToSet || {})) r[k] = [...new Set([...(r[k] || []), v])];
      }
      return { modifiedCount: list.length };
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({ tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }), tenantModel: (name) => mockModel(name) }));
jest.mock('../../utils/model', () => ({ _model: (name) => mockModel(name) }));

const express = require('express');
const supertest = require('supertest');
const { _getPendingTeachers } = require('../../utils/lesson-reminders');

const S = 'sch_1';
const asUser = (userId, role = 'teacher') => ({ userId, schoolId: S, role, roles: [role] });
const ADMIN = asUser('u_admin', 'admin');
const api = (who) => { mockJwtUser = who; const a = express(); a.use(express.json()); a.use('/api/lessons', require('../../routes/lessons')); return supertest(a); };
const BASE = { classId: 'kg1', subjectId: 'cre' };

const tick = (id, x = {}) => ({ id, schoolId: S, ...BASE, academicYear: '2026', topicId: 't2', teacherId: 'u_old', coveredAt: '2026-10-01', ...x });
const asg = (id, teacherId, streamId, x = {}) => ({ id, schoolId: S, ...BASE, subjectName: 'CRE', className: 'KG1', teacherId, teacherName: teacherId, streamId, streamName: streamId, ...x });
function seed(ticks) {
  mockDb = createFakeDb({
    schools: [{ id: S, academicYear: '2026' }],
    classes: [{ id: 'kg1', schoolId: S, name: 'KG1' }],
    subjects: [{ id: 'cre', schoolId: S, name: 'CRE' }],
    streams: [{ id: 'ruby', schoolId: S, classId: 'kg1', name: 'Ruby', status: 'active' }, { id: 'pearl', schoolId: S, classId: 'kg1', name: 'Pearl', status: 'active' }],
    students: [{ id: 'ann', schoolId: S, classId: 'kg1', streamId: 'ruby' }, { id: 'ben', schoolId: S, classId: 'kg1', streamId: 'pearl' }],
    syllabus_topics: [
      { id: 't1', schoolId: S, subjectId: 'cre', classId: 'kg1', academicYear: '2026', title: 'Prayer', order: 1, subtopics: [{ id: 's1', title: 'A' }, { id: 's2', title: 'B' }] },
      { id: 't2', schoolId: S, subjectId: 'cre', classId: 'kg1', academicYear: '2026', title: 'Family', order: 2, subtopics: [] },
      { id: 't9', schoolId: S, subjectId: 'cre', classId: 'grade6', academicYear: '2026', title: 'Other class', order: 1, subtopics: [] },
    ],
    lesson_coverage: ticks,
    teaching_assignments: [asg('a1', 'u_ruby', 'ruby'), asg('a2', 'u_pearl', 'pearl')],
    lesson_plans: [],
    timetable: [],
  });
}
const cov = () => mockDb.data.lesson_coverage;
const RUBY = asUser('u_ruby');
const PEARL = asUser('u_pearl');
const list = async (who, streamId, extra = {}) => (await api(who).get('/api/lessons/coverage').query({ ...BASE, ...(streamId ? { streamId } : {}), ...extra })).body.data.topics;
const pct = async (who) => (await api(who).get('/api/lessons/my-classes')).body.data.map(c => `${c.coveredItems}/${c.totalItems}`);

describe('what counts', () => {
  test('a whole-class tick counts for every stream, everywhere a teacher or HOD looks', async () => {
    seed([tick('w1'), tick('w2', { topicId: 't1', subtopicId: 's1' })]);
    expect(await pct(RUBY)).toEqual(['2/3']);
    expect(await pct(PEARL)).toEqual(['2/3']);
    const t = await list(RUBY, 'ruby');
    expect(t.find(x => x.id === 't2')).toMatchObject({ covered: true, coverage: { id: 'w1', wholeClass: true } });
    expect(t.find(x => x.id === 't1')).toMatchObject({ covered: false, partial: true });
    const sum = (await api(ADMIN).get('/api/lessons/summary')).body.data;
    expect(sum.map(r => [r.streamId, r.coveredItems, r.totalItems])).toEqual([['ruby', 2, 3], ['pearl', 2, 3]]);
    const pend = (await api(ADMIN).get('/api/lessons/pending-teachers')).body.data;
    expect(pend.map(p => `${p.coveredItems}/${p.totalItems}`)).toEqual(['2/3', '2/3']);
  });

  test('a stream tick counts for that stream only: not a sibling, not the whole class', async () => {
    seed([tick('r1', { streamId: 'ruby', teacherId: 'u_ruby' })]);
    mockDb.data.teaching_assignments.push(asg('a3', 'u_whole', null));
    expect(await pct(RUBY)).toEqual(['1/3']);
    expect(await pct(PEARL)).toEqual(['0/3']);
    expect(await pct(asUser('u_whole'))).toEqual(['0/3']);
    expect((await list(PEARL, 'pearl')).find(x => x.id === 't2').covered).toBe(false);
    expect((await list(ADMIN)).find(x => x.id === 't2').covered).toBe(false);
  });

  test('ticked by both the class and the stream is one item, and the stream\'s own tick is shown', async () => {
    seed([tick('r1', { streamId: 'ruby', teacherId: 'u_ruby' }), tick('w1'), tick('w1b')]);
    expect(await pct(RUBY)).toEqual(['1/3']);
    const t2 = (await list(RUBY, 'ruby')).find(x => x.id === 't2');
    expect(t2.coverage.id).toBe('r1');
    expect(t2.coverage.wholeClass).toBeUndefined();
    const sum = (await api(ADMIN).get('/api/lessons/summary')).body.data;
    expect(sum.map(r => r.coveredItems)).toEqual([1, 1]);
  });

  test('a student\'s own progress follows their stream', async () => {
    seed([tick('w1', { notForStreams: ['ruby'] }), tick('p1', { streamId: 'pearl', topicId: 't1', subtopicId: 's1' })]);
    const row = async (id) => (await api(ADMIN).get('/api/lessons/class-summary/kg1').query({ studentId: id })).body.data[0].coveredItems;
    expect(await row('ann')).toBe(0);
    expect(await row('ben')).toBe(2);
  });
});

describe('unticking from a stream', () => {
  test('takes it off that stream only and keeps the whole-class tick, whoever ticked it', async () => {
    seed([tick('w1')]);
    const res = await api(RUBY).delete('/api/lessons/coverage/w1').query({ streamId: 'ruby' });
    expect(res.status).toBe(200);
    expect(cov()).toEqual([expect.objectContaining({ id: 'w1', teacherId: 'u_old', notForStreams: ['ruby'], updatedBy: 'u_ruby' })]);
    expect(await pct(RUBY)).toEqual(['0/3']);
    expect(await pct(PEARL)).toEqual(['1/3']);
    // Ticked again: the stream's own record, and it can be unticked again.
    await api(RUBY).post('/api/lessons/coverage').send({ ...BASE, streamId: 'ruby', topicId: 't2' });
    expect(await pct(RUBY)).toEqual(['1/3']);
    await api(RUBY).delete('/api/lessons/coverage').query({ ...BASE, streamId: 'ruby', topicId: 't2' });
    expect(await pct(RUBY)).toEqual(['0/3']);
    expect(await pct(PEARL)).toEqual(['1/3']);
  });

  test('one click clears both when the class and the stream ticked it', async () => {
    seed([tick('r1', { streamId: 'ruby', teacherId: 'u_ruby' }), tick('w1')]);
    await api(RUBY).delete('/api/lessons/coverage/r1').query({ streamId: 'ruby' });
    expect(cov().map(r => [r.id, r.notForStreams])).toEqual([['w1', ['ruby']]]);
    expect((await list(RUBY, 'ruby')).find(x => x.id === 't2').covered).toBe(false);
  });

  test('a subtopic only unticks that subtopic; the topic unticks all of its subtopics', async () => {
    const subs = () => [tick('x1', { topicId: 't1', subtopicId: 's1' }), tick('x2', { topicId: 't1', subtopicId: 's2' }), tick('w1')];
    seed(subs());
    await api(RUBY).delete('/api/lessons/coverage/x1').query({ streamId: 'ruby' });
    expect(cov().map(r => r.notForStreams)).toEqual([['ruby'], undefined, undefined]);
    seed(subs());
    const r = await api(RUBY).delete('/api/lessons/coverage').query({ ...BASE, streamId: 'ruby', topicId: 't1' });
    expect(r.body.data.deleted).toBe(2);
    expect(cov().map(x => x.notForStreams)).toEqual([['ruby'], ['ruby'], undefined]);
  });

  test('refused: another stream\'s teacher, another subject\'s, a stream of no school of theirs, another school\'s tick', async () => {
    seed([tick('w1'), tick('p1', { streamId: 'pearl', teacherId: 'u_pearl' }), tick('z1', { schoolId: 'sch_2' })]);
    mockDb.data.teaching_assignments.push(asg('a4', 'u_math', 'ruby', { subjectId: 'math' }));
    const before = JSON.stringify(cov());
    const del = (who, id, streamId) => api(who).delete(`/api/lessons/coverage/${id}`).query({ streamId });
    expect((await del(PEARL, 'w1', 'ruby')).status).toBe(404);
    expect((await del(asUser('u_math'), 'w1', 'ruby')).status).toBe(404);
    expect((await del(asUser('u_none'), 'w1', 'ruby')).status).toBe(404);
    expect((await del(RUBY, 'p1', 'ruby')).status).toBe(404);
    expect((await del(ADMIN, 'w1', 'nostream')).status).toBe(404);
    expect((await del(ADMIN, 'z1', 'ruby')).status).toBe(404);
    expect(JSON.stringify(cov())).toBe(before);
  });

  test('a colleague\'s stream tick still can\'t be removed (own records only)', async () => {
    seed([tick('r1', { streamId: 'ruby', teacherId: 'u_old' })]);
    expect((await api(RUBY).delete('/api/lessons/coverage/r1').query({ streamId: 'ruby' })).status).toBe(404);
    expect(cov()).toHaveLength(1);
  });

  test('a page open since before this version can\'t delete the class\'s tick from one stream', async () => {
    seed([tick('w1', { teacherId: 'u_ruby' })]);
    const res = await api(RUBY).delete('/api/lessons/coverage/w1');
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/Refresh the page/);
    expect(cov()).toHaveLength(1);
  });

  test('whole-class view is unchanged: its teacher and an admin delete the tick', async () => {
    seed([tick('w1', { teacherId: 'u_whole' }), tick('w2', { topicId: 't1', subtopicId: 's1' })]);
    mockDb.data.teaching_assignments.push(asg('a3', 'u_whole', null));
    expect((await api(asUser('u_whole')).delete('/api/lessons/coverage/w1')).status).toBe(200);
    expect((await api(ADMIN).delete('/api/lessons/coverage/w2')).status).toBe(200);
    expect(cov()).toEqual([]);
  });
});

describe('one student\'s mark saved before the class had streams', () => {
  test('is listed in their own stream only, and can be removed there', async () => {
    seed([tick('m1', { studentId: 'ann', studentName: 'Ann', teacherId: 'u_ruby' }), tick('m2', { studentId: 'ben', studentName: 'Ben', teacherId: 'u_ruby' })]);
    const names = async (who, s) => (await list(who, s)).find(x => x.id === 't2').studentCoverage.map(x => x.studentName);
    expect(await names(RUBY, 'ruby')).toEqual(['Ann']);
    expect(await names(PEARL, 'pearl')).toEqual(['Ben']);
    expect((await list(RUBY, 'ruby', { studentId: 'ann' })).find(x => x.id === 't2').covered).toBe(true);
    expect((await list(RUBY, 'ruby', { studentId: 'ben' })).find(x => x.id === 't2').covered).toBe(false);
    expect((await api(RUBY).delete('/api/lessons/coverage/m1')).status).toBe(200);
    expect(cov().map(r => r.id)).toEqual(['m2']);
  });
});

describe('lesson plans made for the whole class', () => {
  const plan = (id, x = {}) => ({ id, schoolId: S, ...BASE, teacherId: 'u_ruby', date: '2026-11-23', topicId: 't2', ...x });
  test('stay listed in the stream, not another stream\'s plans', async () => {
    seed([]);
    mockDb.data.lesson_plans.push(plan('p1'), plan('p2', { streamId: 'ruby' }), plan('p3', { streamId: 'pearl' }), plan('p4', { streamId: null }));
    const ids = (await api(RUBY).get('/api/lessons/plans').query({ ...BASE, streamId: 'ruby' })).body.data.map(p => p.id).sort();
    expect(ids).toEqual(['p1', 'p2', 'p4']);
  });

  test('week status: the plan counts, and a whole-class lesson belongs to the one stream the teacher has', async () => {
    seed([]);
    const slot = (id, day, x = {}) => ({ id, schoolId: S, ...BASE, teacherId: 'u_ruby', day, type: 'lesson', isActive: true, ...x });
    mockDb.data.timetable.push(slot('l1', 'monday'), slot('l2', 'tuesday', { streamId: 'ruby' }), slot('l3', 'wednesday'));
    mockDb.data.lesson_plans.push(plan('p1'), plan('p2', { date: '2026-11-24' }));
    const w = async () => (await api(RUBY).get('/api/lessons/plans/week-status').query({ weekStart: '2026-11-23' })).body.data;
    let r = await w();
    expect([r.totalPlanned, r.totalRequired]).toEqual([2, 3]);
    expect(r.assignments).toEqual([expect.objectContaining({ streamId: 'ruby', required: 3, planned: 2, unplannedDates: ['2026-11-25'] })]);
    // Two streams: which one the whole-class lesson belongs to isn't known, so it stays whole class.
    mockDb.data.teaching_assignments.push(asg('a5', 'u_ruby', 'pearl'));
    r = await w();
    expect(r.assignments.map(a => a.streamId)).toEqual(expect.arrayContaining([null, 'ruby']));
  });
});

describe('reminders', () => {
  const done = (streamId) => [tick('a' + streamId, { streamId }), tick('b' + streamId, { streamId, topicId: 't1', subtopicId: 's1' }), tick('c' + streamId, { streamId, topicId: 't1', subtopicId: 's2' })];
  const names = async () => (await _getPendingTeachers(S, '2026', 'friday')).map(t => t.teacherId).sort();
  const lessons = () => mockDb.data.timetable.push(...['u_ruby', 'u_pearl'].map(t => ({ id: t, schoolId: S, ...BASE, teacherId: t, day: 'friday' })));

  test('whole-class ticks count for both teachers', async () => {
    seed(done(undefined).map(t => { delete t.streamId; return t; })); lessons();
    expect(await names()).toEqual([]);
  });
  test('one stream finishing doesn\'t silence the other\'s reminder, and another class\'s topics don\'t cause one', async () => {
    seed(done('ruby')); lessons();
    expect(await names()).toEqual(['u_pearl']);
  });
});
