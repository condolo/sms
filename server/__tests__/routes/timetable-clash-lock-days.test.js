/* ============================================================
   v5.265.0 — timetable Phase 0–1
   • Bulk save and spreadsheet import run the same clash checks as
     adding one lesson (before, they skipped them).
   • "Replace this class" only replaces the current year's unlocked
     lessons (before: every year's, archived ones included).
   • Locked lessons can't be edited, moved or removed until unlocked.
   • Working days: lessons only on the school's working days.
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
jest.mock('../../routes/bell-schedule', () => ({
  resolveBellSchedule: jest.fn().mockResolvedValue({
    id: 'bs_test',
    periods: [1, 2, 3, 4].map(n => ({ p: String(n), start: `${String(7 + n).padStart(2, '0')}:00`, end: `${String(8 + n).padStart(2, '0')}:00`, label: `P${n}`, isBreak: false })),
  }),
}));
jest.mock('../../utils/change-alerts', () => ({ notifyTimetableChange: jest.fn(() => Promise.resolve()) }));

/* ── A small in-memory collection that understands the operators these routes use ── */
function test1(docVal, cond) {
  if (cond instanceof RegExp) return cond.test(docVal ?? '');
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$in'  in cond) return cond.$in.some(v => v === docVal || (v == null && docVal == null));
    if ('$ne'  in cond) return docVal !== cond.$ne;
    if ('$nin' in cond) return !cond.$nin.includes(docVal);
  }
  if (cond === null) return docVal == null;
  return docVal === cond;
}
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or')  return v.some(f => matches(doc, f));
    if (k === '$and') return v.every(f => matches(doc, f));
    return test1(doc[k], v);
  });
}
function chain(result) {
  const c = { select: () => c, sort: () => c, skip: () => c, limit: () => c, lean: () => Promise.resolve(result) };
  return c;
}
function mockCollection(seed = []) {
  let docs = seed.map(d => ({ ...d }));
  return {
    _docs: () => docs,
    find:     jest.fn(f => chain(docs.filter(d => matches(d, f)))),
    findOne:  jest.fn(f => chain(docs.find(d => matches(d, f)) || null)),
    countDocuments: jest.fn(f => Promise.resolve(docs.filter(d => matches(d, f)).length)),
    create:   jest.fn(d => { docs.push(d); return Promise.resolve(d); }),
    insertMany: jest.fn(ds => { docs.push(...ds); return Promise.resolve(ds); }),
    deleteMany: jest.fn(f => { const n = docs.length; docs = docs.filter(d => !matches(d, f)); return Promise.resolve({ deletedCount: n - docs.length }); }),
    updateOne: jest.fn((f, u) => {
      const d = docs.find(x => matches(x, f));
      if (d) for (const [k, v] of Object.entries(u.$set || {})) {
        const parts = k.split('.'); let o = d;
        while (parts.length > 1) { const p = parts.shift(); o[p] = o[p] || {}; o = o[p]; }
        o[parts[0]] = v;
      }
      return Promise.resolve({ matchedCount: d ? 1 : 0 });
    }),
    findOneAndUpdate: jest.fn((f, u, opts = {}) => {
      let d = docs.find(x => matches(x, f));
      const existed = !!d;
      if (!d && opts.upsert) { d = { ...f, ...(u.$setOnInsert || {}) }; docs.push(d); }
      if (d) Object.assign(d, u.$set || (u.$setOnInsert ? {} : u));
      const out = opts.rawResult ? { value: d, lastErrorObject: { updatedExisting: existed } } : d;
      return { lean: () => Promise.resolve(out), then: (r, j) => Promise.resolve(out).then(r, j) };
    }),
    findOneAndDelete: jest.fn(f => {
      const i = docs.findIndex(d => matches(d, f));
      return Promise.resolve(i === -1 ? null : docs.splice(i, 1)[0]);
    }),
  };
}

function dateOffset(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const CURRENT_YEAR = { id: 'ay_now', schoolId: SCHOOL, name: 'Now', isCurrent: true, startDate: dateOffset(-100), endDate: dateOffset(100), terms: [{ id: 't_now', name: 'T', startDate: dateOffset(-10), endDate: dateOffset(60) }] };
const OLD_YEAR = { id: 'ay_old', schoolId: SCHOOL, name: 'Old', isCurrent: false, startDate: '2024-01-01', endDate: '2024-12-01', terms: [] };

let mockCols;
jest.mock('../../utils/model', () => ({
  _model: jest.fn(c => {
    if (c === 'academic_config') return { findOne: () => ({ select: function () { return this; }, lean: () => Promise.resolve({ archivedAcademicYears: [] }) }) };
    if (!mockCols[c]) mockCols[c] = mockCollection();
    return mockCols[c];
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');
const { _importTimetable } = require('../../routes/import-export');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/timetable', timetableRouter);
  return a;
}

const lesson = (o) => ({ schoolId: SCHOOL, isActive: true, academicYearId: 'ay_now', type: 'lesson', ...o });

beforeEach(() => {
  jest.clearAllMocks();
  mockCols = {
    schools:        mockCollection([{ id: SCHOOL, name: 'School A' }]),
    academic_years: mockCollection([CURRENT_YEAR, OLD_YEAR]),
    classes:        mockCollection([{ id: 'cls_1', schoolId: SCHOOL, name: 'Grade 7' }, { id: 'cls_2', schoolId: SCHOOL, name: 'Grade 8' }]),
    timetable:      mockCollection(),
    teachers:       mockCollection([{ id: 'tch_1', userId: 'u_t1', schoolId: SCHOOL, firstName: 'Grace', lastName: 'Akinyi', status: 'active' }]),
    streams:        mockCollection(),
  };
});

/* ── Bulk save ─────────────────────────────────────────────── */
describe('POST /bulk — clash checks (all or nothing)', () => {
  test('two lessons in the batch with the same teacher at the same time → 409, nothing saved', async () => {
    const res = await supertest(app()).post('/api/timetable/bulk').send({ slots: [
      { classId: 'cls_1', day: 'monday', period: '1', teacherId: 'u_t1' },
      { classId: 'cls_2', day: 'monday', period: '1', teacherId: 'u_t1' },
    ] });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].message).toMatch(/same teacher/);
    expect(mockCols.timetable._docs()).toHaveLength(0);
  });

  test('a lesson that clashes with a saved one (teacher busy in another class) → 409', async () => {
    mockCols.timetable = mockCollection([lesson({ id: 's1', classId: 'cls_2', day: 'monday', period: '1', teacherId: 'u_t1', startTime: '08:00', endTime: '09:00' })]);
    const res = await supertest(app()).post('/api/timetable/bulk').send({ slots: [{ classId: 'cls_1', day: 'monday', period: '1', teacherId: 'u_t1' }] });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].message).toMatch(/Teacher is already scheduled/);
    expect(mockCols.timetable._docs()).toHaveLength(1);
  });

  test('the same room twice at the same time in the batch → 409', async () => {
    const res = await supertest(app()).post('/api/timetable/bulk').send({ slots: [
      { classId: 'cls_1', day: 'monday', period: '2', room: 'Lab 1' },
      { classId: 'cls_2', day: 'monday', period: '2', room: 'lab 1' },
    ] });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].message).toMatch(/same room/);
  });

  test('no clashes → saved', async () => {
    const res = await supertest(app()).post('/api/timetable/bulk').send({ slots: [
      { classId: 'cls_1', day: 'monday', period: '1', teacherId: 'u_t1' },
      { classId: 'cls_2', day: 'monday', period: '2', teacherId: 'u_t1' },
    ] });
    expect(res.status).toBe(201);
    expect(mockCols.timetable._docs()).toHaveLength(2);
  });
});

describe('POST /bulk replaceClass — this year only, locked lessons kept', () => {
  test('replaces this year\'s unlocked lessons; keeps another year\'s and locked ones; replaced lessons are not clashes', async () => {
    mockCols.timetable = mockCollection([
      lesson({ id: 'now_1',  classId: 'cls_1', day: 'monday',  period: '1', teacherId: 'u_t1', startTime: '08:00', endTime: '09:00' }),
      lesson({ id: 'old_1',  classId: 'cls_1', day: 'monday',  period: '1', academicYearId: 'ay_old' }),
      lesson({ id: 'lock_1', classId: 'cls_1', day: 'tuesday', period: '1', locked: true, subject: 'Assembly' }),
    ]);
    const res = await supertest(app()).post('/api/timetable/bulk').send({
      replaceClass: 'cls_1',
      // Same teacher, same cell as now_1 — fine, because now_1 is being replaced.
      slots: [{ classId: 'cls_1', day: 'monday', period: '1', teacherId: 'u_t1', subject: 'Maths' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.replacedCount).toBe(1);
    const ids = mockCols.timetable._docs().map(d => d.id);
    expect(ids).not.toContain('now_1');
    expect(ids).toContain('old_1');
    expect(ids).toContain('lock_1');
    expect(ids).toHaveLength(3);
  });

  test('a new lesson on top of a locked lesson clashes with it', async () => {
    mockCols.timetable = mockCollection([lesson({ id: 'lock_1', classId: 'cls_1', day: 'tuesday', period: '1', locked: true })]);
    const res = await supertest(app()).post('/api/timetable/bulk').send({
      replaceClass: 'cls_1',
      slots: [{ classId: 'cls_1', day: 'tuesday', period: '1', subject: 'Maths' }],
    });
    expect(res.status).toBe(409);
    expect(mockCols.timetable._docs().map(d => d.id)).toEqual(['lock_1']);
  });
});

/* ── Locked lessons ────────────────────────────────────────── */
describe('locked lessons', () => {
  beforeEach(() => {
    mockCols.timetable = mockCollection([lesson({ id: 'lk', classId: 'cls_1', day: 'monday', period: '1', locked: true, startTime: '08:00', endTime: '09:00' })]);
  });

  test('PUT that changes a locked lesson → 400', async () => {
    const res = await supertest(app()).put('/api/timetable/lk').send({ room: 'Lab 2' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/locked/);
  });

  test('PUT that unlocks (and moves) it → 200', async () => {
    const res = await supertest(app()).put('/api/timetable/lk').send({ locked: false, period: '2' });
    expect(res.status).toBe(200);
    const d = mockCols.timetable._docs()[0];
    expect(d.locked).toBe(false);
    expect(d.period).toBe('2');
  });

  test('DELETE a locked lesson → 400, still there', async () => {
    const res = await supertest(app()).delete('/api/timetable/lk');
    expect(res.status).toBe(400);
    expect(mockCols.timetable._docs()).toHaveLength(1);
  });

  test('saving a lesson that already sits in an old clash, without changing when/who/where, is allowed (e.g. to lock it)', async () => {
    mockCols.timetable = mockCollection([
      lesson({ id: 'a', classId: 'cls_1', day: 'monday', period: '1', teacherId: 'u_t1', startTime: '08:00', endTime: '09:00' }),
      lesson({ id: 'b', classId: 'cls_2', day: 'monday', period: '1', teacherId: 'u_t1', startTime: '08:00', endTime: '09:00' }),
    ]);
    // The editor re-sends every field.
    let res = await supertest(app()).put('/api/timetable/a').send({ classId: 'cls_1', day: 'monday', period: '1', teacherId: 'u_t1', room: '', roomId: '', locked: true });
    expect(res.status).toBe(200);
    // Actually moving it into a clash is still refused.
    mockCols.timetable._docs()[0].locked = false;
    res = await supertest(app()).put('/api/timetable/a').send({ period: '2', teacherId: 'u_t1' });
    expect(res.status).toBe(200);
    res = await supertest(app()).put('/api/timetable/a').send({ period: '1' });
    expect(res.status).toBe(409);
  });

  test('locking an unlocked lesson is allowed', async () => {
    mockCols.timetable = mockCollection([lesson({ id: 'ul', classId: 'cls_1', day: 'monday', period: '1' })]);
    const res = await supertest(app()).put('/api/timetable/ul').send({ locked: true });
    expect(res.status).toBe(200);
    expect(mockCols.timetable._docs()[0].locked).toBe(true);
  });
});

/* ── Working days ──────────────────────────────────────────── */
describe('working days', () => {
  test('default is Monday–Friday', async () => {
    const res = await supertest(app()).get('/api/timetable/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.workingDays).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  });

  test('a Saturday lesson is refused until Saturday is a working day', async () => {
    let res = await supertest(app()).post('/api/timetable').send({ classId: 'cls_1', day: 'saturday', period: '1' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Saturday isn't one of the school's working days/);

    res = await supertest(app()).put('/api/timetable/settings').send({ workingDays: ['saturday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'] });
    expect(res.status).toBe(200);
    expect(res.body.data.workingDays).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);

    res = await supertest(app()).post('/api/timetable').send({ classId: 'cls_1', day: 'saturday', period: '1' });
    expect(res.status).toBe(201);
  });

  test('bulk save refuses a lesson on a non-working day', async () => {
    const res = await supertest(app()).post('/api/timetable/bulk').send({ slots: [{ classId: 'cls_1', day: 'sunday', period: '1' }] });
    expect(res.status).toBe(400);
    expect(mockCols.timetable._docs()).toHaveLength(0);
  });

  test('removing a day reports how many lessons are left on it, and keeps them', async () => {
    mockCols.schools = mockCollection([{ id: SCHOOL, timetableSettings: { workingDays: ['monday', 'saturday'] } }]);
    mockCols.timetable = mockCollection([lesson({ id: 'sat', classId: 'cls_1', day: 'saturday', period: '1' })]);
    const res = await supertest(app()).put('/api/timetable/settings').send({ workingDays: ['monday'] });
    expect(res.status).toBe(200);
    expect(res.body.data.lessonsOnRemovedDays).toBe(1);
    expect(mockCols.timetable._docs()).toHaveLength(1);
  });

  test('an empty or invalid list is rejected', async () => {
    expect((await supertest(app()).put('/api/timetable/settings').send({ workingDays: [] })).status).toBe(422);
    expect((await supertest(app()).put('/api/timetable/settings').send({ workingDays: ['funday'] })).status).toBe(422);
  });
});

/* ── Spreadsheet import ────────────────────────────────────── */
describe('timetable import', () => {
  const row = (o) => ({ className: 'Grade 7', day: 'monday', period: '1', subject: 'Maths', ...o });

  test('a row that puts a teacher in two classes at once is skipped with the reason', async () => {
    mockCols.timetable = mockCollection([lesson({ id: 's1', classId: 'cls_2', day: 'monday', period: '1', teacherId: 'u_t1', startTime: '08:00', endTime: '09:00' })]);
    const r = await _importTimetable([row({ teacherName: 'Grace Akinyi' })], SCHOOL, 'usr_admin');
    expect(r.inserted).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.errors[0].message).toMatch(/Teacher is already scheduled/);
  });

  test('two rows in the same file that clash: the second is skipped', async () => {
    const r = await _importTimetable([
      row({ teacherName: 'Grace Akinyi' }),
      row({ className: 'Grade 8', teacherName: 'Grace Akinyi' }),
    ], SCHOOL, 'usr_admin');
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
  });

  test('a row updating its own cell is not a clash with itself', async () => {
    mockCols.timetable = mockCollection([lesson({ id: 'own', classId: 'cls_1', streamId: null, day: 'monday', period: '1', teacherId: 'u_t1', startTime: '08:00', endTime: '09:00' })]);
    const r = await _importTimetable([row({ teacherName: 'Grace Akinyi', subject: 'English' })], SCHOOL, 'usr_admin');
    expect(r.updated).toBe(1);
    expect(r.errors).toHaveLength(0);
  });

  test('a row over a locked lesson is skipped', async () => {
    mockCols.timetable = mockCollection([lesson({ id: 'lk', classId: 'cls_1', streamId: null, day: 'monday', period: '1', locked: true, subject: 'Assembly' })]);
    const r = await _importTimetable([row()], SCHOOL, 'usr_admin');
    expect(r.skipped).toBe(1);
    expect(r.errors[0].message).toMatch(/locked/);
    expect(mockCols.timetable._docs()[0].subject).toBe('Assembly');
  });

  test('Saturday rows import only when Saturday is a working day', async () => {
    let r = await _importTimetable([row({ day: 'saturday' })], SCHOOL, 'usr_admin');
    expect(r.skipped).toBe(1);
    mockCols.schools = mockCollection([{ id: SCHOOL, timetableSettings: { workingDays: ['monday', 'saturday'] } }]);
    r = await _importTimetable([row({ day: 'saturday' })], SCHOOL, 'usr_admin');
    expect(r.inserted).toBe(1);
  });
});
