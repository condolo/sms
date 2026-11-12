/* ============================================================
   v5.267.0 — timetable Phase 2: rules setup
   • Days & rules: timetable rules stored with the working days,
     partial updates merge, unknown rules refused.
   • Teacher availability: per staff record, any id form accepted,
     clock-time blocks validated.
   • The draft reports lessons in a teacher's unavailable time and
     teachers over the lessons-a-day limit, as warnings only.
   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../routes/bell-schedule', () => ({ resolveBellSchedule: jest.fn().mockResolvedValue({ id: 'bs', periods: [] }) }));
jest.mock('../../utils/change-alerts', () => ({ notifyTimetableChange: jest.fn(() => Promise.resolve()) }));

function mockTest1(docVal, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$in' in cond) return cond.$in.some(v => v === docVal || (v == null && docVal == null));
    if ('$ne' in cond) return docVal !== cond.$ne;
  }
  if (cond === null) return docVal == null;
  return docVal === cond;
}
function mockMatches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => (k === '$or' ? v.some(f => mockMatches(doc, f)) : mockTest1(doc[k], v)));
}
function mockChain(result) {
  const c = { select: () => c, sort: () => c, skip: () => c, limit: () => c, lean: () => Promise.resolve(result) };
  return c;
}
function mockCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const setPath = (d, k, v) => { const p = k.split('.'); let o = d; while (p.length > 1) { const x = p.shift(); o[x] = o[x] || {}; o = o[x]; } o[p[0]] = v; };
  return {
    _docs: docs,
    find:    jest.fn(f => mockChain(docs.filter(d => mockMatches(d, f)))),
    findOne: jest.fn(f => mockChain(docs.find(d => mockMatches(d, f)) || null)),
    countDocuments: jest.fn(f => Promise.resolve(docs.filter(d => mockMatches(d, f)).length)),
    updateOne: jest.fn((f, u, opts = {}) => {
      let d = docs.find(x => mockMatches(x, f));
      if (!d && opts.upsert) { d = { ...f, ...(u.$setOnInsert || {}) }; docs.push(d); }
      if (d) for (const [k, v] of Object.entries(u.$set || {})) setPath(d, k, v);
      return Promise.resolve({ matchedCount: d ? 1 : 0 });
    }),
  };
}

function dateOffset(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

let mockCols;
jest.mock('../../utils/model', () => ({
  _model: jest.fn(c => {
    if (!mockCols[c]) mockCols[c] = mockCollection();
    return mockCols[c];
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');
const { normaliseBlocks } = require('../../utils/teacher-availability');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/timetable', timetableRouter);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCols = {
    schools:        mockCollection([{ id: SCHOOL, name: 'School A' }]),
    academic_years: mockCollection([{ id: 'ay_now', schoolId: SCHOOL, isCurrent: true, startDate: dateOffset(-100), endDate: dateOffset(100), terms: [] }]),
    teachers:       mockCollection([
      { id: 'tch_1', userId: 'u_t1', schoolId: SCHOOL, firstName: 'Grace', lastName: 'Akinyi', status: 'active' },
      { id: 'tch_2', schoolId: SCHOOL, firstName: 'Brian', lastName: 'Kamau', status: 'active' },
    ]),
    subjects:       mockCollection([{ id: 'sub_math', schoolId: SCHOOL, name: 'Mathematics' }, { id: 'sub_x', schoolId: 'school_B', name: 'Other school' }]),
    timetable:      mockCollection(),
    teacher_availability: mockCollection(),
  };
});

describe('Days & rules', () => {
  test('defaults: Monday–Friday and the default rules', async () => {
    const res = await supertest(app()).get('/api/timetable/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.workingDays).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    expect(res.body.data.rules.maxTeacherLessonsPerDay).toEqual({ on: true, value: 6 });
    expect(res.body.data.rules.coreSubjectsMorning).toEqual({ on: false, subjectIds: [] });
  });

  test('a partial rules update changes only what was sent, and keeps the working days', async () => {
    await supertest(app()).put('/api/timetable/settings').send({ workingDays: ['monday', 'saturday'] });
    const res = await supertest(app()).put('/api/timetable/settings').send({ rules: { maxTeacherLessonsPerDay: { value: 5 }, avoidTeacherGaps: { on: false } } });
    expect(res.status).toBe(200);
    expect(res.body.data.workingDays).toEqual(['monday', 'saturday']);
    expect(res.body.data.rules.maxTeacherLessonsPerDay).toEqual({ on: true, value: 5 });
    expect(res.body.data.rules.avoidTeacherGaps).toEqual({ on: false });
    expect(res.body.data.rules.spreadAcrossWeek).toEqual({ on: true });
  });

  test('core subjects keep only this school\'s own subjects', async () => {
    const res = await supertest(app()).put('/api/timetable/settings')
      .send({ rules: { coreSubjectsMorning: { on: true, subjectIds: ['sub_math', 'sub_x', 'nope'] } } });
    expect(res.status).toBe(200);
    expect(res.body.data.rules.coreSubjectsMorning).toEqual({ on: true, subjectIds: ['sub_math'] });
  });

  test('unknown rules, bad values and empty bodies are refused', async () => {
    expect((await supertest(app()).put('/api/timetable/settings').send({ rules: { madeUp: { on: true } } })).status).toBe(422);
    expect((await supertest(app()).put('/api/timetable/settings').send({ rules: { maxSubjectPerDay: { value: 0 } } })).status).toBe(422);
    expect((await supertest(app()).put('/api/timetable/settings').send({})).status).toBe(422);
  });
});

describe('teacher availability', () => {
  test('saved under the staff record\'s own id, whichever id form is used', async () => {
    const res = await supertest(app()).put('/api/timetable/availability/u_t1')
      .send({ blocks: [{ day: 'friday', start: '13:00', end: '17:00' }, { day: 'monday', start: '00:00', end: '23:59' }], note: 'Part-time' });
    expect(res.status).toBe(200);
    expect(res.body.data.teacherId).toBe('tch_1');
    const list = await supertest(app()).get('/api/timetable/availability');
    expect(list.body.data).toEqual([expect.objectContaining({
      teacherId: 'tch_1', note: 'Part-time',
      // Sorted by day then time.
      blocks: [{ day: 'monday', start: '00:00', end: '23:59' }, { day: 'friday', start: '13:00', end: '17:00' }],
    })]);
  });

  test('saving again replaces the teacher\'s times', async () => {
    await supertest(app()).put('/api/timetable/availability/tch_1').send({ blocks: [{ day: 'friday', start: '13:00', end: '17:00' }] });
    await supertest(app()).put('/api/timetable/availability/tch_1').send({ blocks: [] });
    expect(mockCols.teacher_availability._docs).toHaveLength(1);
    expect(mockCols.teacher_availability._docs[0].blocks).toEqual([]);
  });

  test('bad times and unknown teachers are refused', async () => {
    expect((await supertest(app()).put('/api/timetable/availability/tch_1').send({ blocks: [{ day: 'friday', start: '14:00', end: '13:00' }] })).status).toBe(400);
    expect((await supertest(app()).put('/api/timetable/availability/tch_1').send({ blocks: [{ day: 'funday', start: '08:00', end: '09:00' }] })).status).toBe(400);
    expect((await supertest(app()).put('/api/timetable/availability/tch_1').send({ blocks: [{ day: 'friday', start: '8am', end: '09:00' }] })).status).toBe(400);
    expect((await supertest(app()).put('/api/timetable/availability/nobody').send({ blocks: [] })).status).toBe(404);
  });

  test('normaliseBlocks drops duplicates', () => {
    const { blocks } = normaliseBlocks([{ day: 'Friday', start: '13:00', end: '14:00' }, { day: 'friday', start: '13:00', end: '14:00' }]);
    expect(blocks).toEqual([{ day: 'friday', start: '13:00', end: '14:00' }]);
  });
});

describe('rule warnings on the draft (never blocking)', () => {
  const lesson = (o) => ({ schoolId: SCHOOL, isActive: true, academicYearId: 'ay_now', type: 'lesson', startTime: '08:00', endTime: '09:00', day: 'monday', ...o });

  test('a lesson in a teacher\'s unavailable time is reported', async () => {
    mockCols.teacher_availability = mockCollection([{ schoolId: SCHOOL, teacherId: 'tch_1', blocks: [{ day: 'friday', start: '13:00', end: '17:00' }] }]);
    // Lesson saved under the login id: still matched to the staff record.
    mockCols.timetable = mockCollection([lesson({ id: 'l1', teacherId: 'u_t1', day: 'friday', startTime: '14:00', endTime: '15:00', subject: 'Mathematics' })]);
    const res = await supertest(app()).get('/api/timetable/status');
    expect(res.status).toBe(200);
    expect(res.body.data.ruleWarningCount).toBe(1);
    expect(res.body.data.ruleWarnings[0]).toMatch(/Grace Akinyi is unavailable Friday 13:00–17:00 but has Mathematics at 14:00–15:00/);
  });

  test('a lesson saved without clock times is caught by a whole-day block (and only by one)', async () => {
    mockCols.teacher_availability = mockCollection([{ schoolId: SCHOOL, teacherId: 'tch_1', blocks: [{ day: 'monday', start: '00:00', end: '23:59' }, { day: 'friday', start: '08:00', end: '09:00' }] }]);
    mockCols.timetable = mockCollection([
      lesson({ id: 'u1', teacherId: 'u_t1', day: 'monday', period: '3', startTime: undefined, endTime: undefined, subject: 'English' }),
      lesson({ id: 'u2', teacherId: 'u_t1', day: 'friday', period: '1', startTime: undefined, endTime: undefined }),
    ]);
    const res = await supertest(app()).get('/api/timetable/status');
    expect(res.body.data.ruleWarnings).toEqual(['Grace Akinyi is unavailable Monday all day but has English at period 3']);
  });

  test('a teacher over the lessons-a-day limit is reported; turning the rule off stops it', async () => {
    mockCols.timetable = mockCollection([1, 2, 3].map(n => lesson({ id: `l${n}`, teacherId: 'tch_2', classId: `c${n}`, startTime: `0${7 + n}:00`, endTime: `0${8 + n}:00` })));
    await supertest(app()).put('/api/timetable/settings').send({ rules: { maxTeacherLessonsPerDay: { value: 2 } } });
    let res = await supertest(app()).get('/api/timetable/status');
    expect(res.body.data.ruleWarnings).toEqual(['Brian Kamau has 3 lessons on Monday (limit 2)']);
    await supertest(app()).put('/api/timetable/settings').send({ rules: { maxTeacherLessonsPerDay: { on: false } } });
    res = await supertest(app()).get('/api/timetable/status');
    expect(res.body.data.ruleWarningCount).toBe(0);
  });

  test('lessons from another academic year are not counted', async () => {
    mockCols.timetable = mockCollection([1, 2, 3].map(n => lesson({ id: `l${n}`, teacherId: 'tch_2', academicYearId: 'ay_old', startTime: `0${7 + n}:00`, endTime: `0${8 + n}:00` })));
    await supertest(app()).put('/api/timetable/settings').send({ rules: { maxTeacherLessonsPerDay: { value: 2 } } });
    const res = await supertest(app()).get('/api/timetable/status');
    expect(res.body.data.ruleWarningCount).toBe(0);
  });
});
