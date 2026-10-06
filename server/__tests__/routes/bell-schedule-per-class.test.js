/* ============================================================
   Bell schedules per class (bell-schedule.js).

   A school can run several bell schedules inside one section (Year 1–2,
   Year 3–6, KG…). Rules under test:
     • A class lookup returns the schedule that lists the class, then the
       section default, then the school-wide "all", then the built-in.
     • A class is in at most one schedule. Saving a class that is already
       in another is refused, and the message names that schedule.
     • A class can only join a schedule for its own section.
     • Saving without classIds still updates the section default in place.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$exists' in v) return (val !== undefined) === v.$exists;
      if ('$size' in v) return Array.isArray(val) && val.length === v.$size;
      if ('$in' in v) return Array.isArray(val) ? val.some(x => v.$in.includes(x)) : v.$in.includes(val);
      if ('$ne' in v) return val !== v.$ne;
      if ('$nin' in v) return !v.$nin.includes(val);
    }
    if (Array.isArray(val)) return val.includes(v);
    if (v === null) return val == null;
    return val === v;
  });
}

let mockBells = [];
let mockClasses = [];
let mockSections = [];
let mockSlots = [];

function mockTimetableStore() {
  return {
    find: (f) => ({ lean: () => Promise.resolve(mockSlots.filter(d => matches(d, f))) }),
    updateMany: async (f, u) => {
      let n = 0;
      for (const d of mockSlots) if (matches(d, f)) { Object.assign(d, u.$set); n++; }
      return { modifiedCount: n };
    },
  };
}

function mockBellStore() {
  const chain = (r) => ({ select: () => chain(r), sort: () => chain(r), lean: () => Promise.resolve(r) });
  return {
    find: (f) => chain(mockBells.filter(d => matches(d, f))),
    findOne: (f) => chain(mockBells.find(d => matches(d, f)) ?? null),
    create: async (d) => { mockBells.push(d); return d; },
    updateOne: async (f, u) => { const d = mockBells.find(x => matches(x, f)); if (d) Object.assign(d, u.$set); return { matchedCount: d ? 1 : 0 }; },
    deleteOne: async (f) => { const i = mockBells.findIndex(x => matches(x, f)); if (i >= 0) mockBells.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
  };
}
function mockListStore(rows) {
  const chain = (r) => ({ select: () => chain(r), sort: () => chain(r), lean: () => Promise.resolve(r) });
  return { find: (f) => chain(rows.filter(d => matches(d, f))) };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'bell_schedules') return mockBellStore();
    if (col === 'classes') return mockListStore(mockClasses);
    if (col === 'sections') return mockListStore(mockSections);
    if (col === 'timetable') return mockTimetableStore();
    return mockListStore([]);
  }),
}));

const express = require('express');
const supertest = require('supertest');
const { resolveBellSchedule } = require('../../routes/bell-schedule');
const bellRouter = require('../../routes/bell-schedule');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bell-schedule', bellRouter);
  return app;
}

const PERIODS = [{ p: '1', start: '08:00', end: '09:00', label: 'Period 1', isBreak: false }];

beforeEach(() => {
  mockSections = [{ schoolId: SCHOOL, key: 'primary', name: 'Primary', order: 1 }, { schoolId: SCHOOL, key: 'secondary', name: 'Secondary', order: 2 }];
  mockClasses = [
    { id: 'c_y1', _id: 'c_y1', schoolId: SCHOOL, name: 'Year 1', sectionKey: 'primary' },
    { id: 'c_y2', _id: 'c_y2', schoolId: SCHOOL, name: 'Year 2', sectionKey: 'primary' },
    { id: 'c_y3', _id: 'c_y3', schoolId: SCHOOL, name: 'Year 3', sectionKey: 'primary' },
    { id: 'c_form1', _id: 'c_form1', schoolId: SCHOOL, name: 'Form 1', sectionKey: 'secondary' },
  ];
  mockBells = [
    { id: 'bs_school', schoolId: SCHOOL, section: 'all', name: 'School default', classIds: [], periods: [{ ...PERIODS[0], start: '07:00' }] },
    { id: 'bs_primary', schoolId: SCHOOL, section: 'primary', name: 'Primary default', classIds: [], periods: [{ ...PERIODS[0], start: '07:30' }] },
    { id: 'bs_y1_2', schoolId: SCHOOL, section: 'primary', name: 'Year 1–2', classIds: ['c_y1', 'c_y2'], periods: [{ ...PERIODS[0], start: '08:00' }] },
  ];
});

describe('resolveBellSchedule — which schedule a class gets', () => {
  test('a class listed in a schedule gets that schedule', async () => {
    const r = await resolveBellSchedule(SCHOOL, 'primary', 'c_y1');
    expect(r.id).toBe('bs_y1_2');
    expect(r.periods[0].start).toBe('08:00');
  });

  test('a class in no schedule gets its section default', async () => {
    const r = await resolveBellSchedule(SCHOOL, 'primary', 'c_y3');
    expect(r.id).toBe('bs_primary');
  });

  test('a class in a section with no default gets the school-wide default', async () => {
    const r = await resolveBellSchedule(SCHOOL, 'secondary', 'c_form1');
    expect(r.id).toBe('bs_school');
  });

  test('no schedule at all falls back to the built-in default', async () => {
    mockBells = [];
    const r = await resolveBellSchedule(SCHOOL, 'primary', 'c_y1');
    expect(r.id).toBeNull();
    expect(r.periods.length).toBeGreaterThan(0);
  });
});

describe('saving a schedule for classes', () => {
  test('creates a schedule for classes in its own section', async () => {
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({
      section: 'primary', name: 'Year 3–6', classIds: ['c_y3'], periods: PERIODS,
    });
    expect(res.status).toBe(200);
    expect(mockBells.find(b => b.name === 'Year 3–6').classIds).toEqual(['c_y3']);
  });

  test('refuses a class that is already in another schedule, and names that schedule', async () => {
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({
      section: 'primary', name: 'Year 2 only', classIds: ['c_y2'], periods: PERIODS,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Year 2 is already in the "Year 1–2" schedule/);
  });

  test('editing a schedule may keep its own classes', async () => {
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({
      id: 'bs_y1_2', section: 'primary', name: 'Year 1–2', classIds: ['c_y1', 'c_y2'], periods: PERIODS,
    });
    expect(res.status).toBe(200);
  });

  test('a school-wide schedule can hold classes from several sections', async () => {
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({
      section: 'primary', name: 'Mixed', classIds: ['c_y3', 'c_form1'], periods: PERIODS,
    });
    expect(res.status).toBe(200);
    expect(mockBells.find(x => x.name === 'Mixed').section).toBe('all');
    expect(mockBells.find(x => x.name === 'Mixed').classIds).toEqual(['c_y3', 'c_form1']);
  });

  test('saving without classIds updates the section default in place', async () => {
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({ section: 'primary', periods: PERIODS });
    expect(res.status).toBe(200);
    expect(mockBells.filter(b => b.section === 'primary' && (b.classIds ?? []).length === 0)).toHaveLength(1);
    expect(mockBells.find(b => b.id === 'bs_primary').periods[0].start).toBe('08:00');
  });
});

describe('a schedule must be a real timetable', () => {
  const send = (periods) => supertest(buildApp()).put('/api/bell-schedule').send({ section: 'primary', name: 'Check', classIds: ['c_y3'], periods });

  test('a period that ends before it starts is refused', async () => {
    const res = await send([{ p: '1', start: '09:00', end: '08:00', label: 'Bad', isBreak: false }]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/must end after it starts/);
  });

  test('a period key used twice is refused, since lessons are placed by key', async () => {
    const res = await send([
      { p: '1', start: '08:00', end: '09:00', label: 'A', isBreak: false },
      { p: '1', start: '09:00', end: '10:00', label: 'B', isBreak: false },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/appears more than once/);
  });

  test('an impossible clock time (25:00) is refused, since times are compared as text', async () => {
    const res = await send([{ p: '1', start: '25:00', end: '26:00', label: 'Bad', isBreak: false }]);
    expect(res.status).toBe(400);
  });

  test('a valid schedule with a break is accepted', async () => {
    const res = await send([
      { p: '1', start: '08:00', end: '09:00', label: 'Period 1', isBreak: false },
      { p: 'B', start: '09:00', end: '09:20', label: 'Break', isBreak: true },
      { p: '2', start: '09:20', end: '10:20', label: 'Period 2', isBreak: false },
    ]);
    expect(res.status).toBe(200);
  });
});

describe('slot times follow the schedule', () => {
  test('saving a schedule re-syncs the times of its classes\' existing slots', async () => {
    mockSlots = [
      { schoolId: SCHOOL, classId: 'c_y1', period: '1', startTime: '08:00', endTime: '09:00', isActive: true },
      { schoolId: SCHOOL, classId: 'c_y3', period: '1', startTime: '07:30', endTime: '08:30', isActive: true },
    ];
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({
      id: 'bs_y1_2', section: 'primary', name: 'Year 1–2', classIds: ['c_y1', 'c_y2'],
      periods: [{ p: '1', start: '08:30', end: '09:30', label: 'Period 1', isBreak: false }],
    });
    expect(res.status).toBe(200);
    expect(mockSlots[0].startTime).toBe('08:30');
    expect(mockSlots[0].endTime).toBe('09:30');
    // Year 3 is not in this schedule, so its slot keeps the times its own schedule gave it.
    expect(mockSlots[1].startTime).toBe('07:30');
  });
});

describe('GET /api/bell-schedule?classId= — the schedule a class actually runs', () => {
  test('returns the class\'s own schedule, not its section default', async () => {
    const res = await supertest(buildApp()).get('/api/bell-schedule').query({ section: 'primary', classId: 'c_y1' });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('bs_y1_2');
  });

  test('a class in no schedule gets its section default', async () => {
    const res = await supertest(buildApp()).get('/api/bell-schedule').query({ section: 'primary', classId: 'c_y3' });
    expect(res.body.data.id).toBe('bs_primary');
  });
});

describe('lessons keep a live link to their schedule', () => {
  test('a lesson whose period was removed is flagged stale, and kept', async () => {
    mockSlots = [
      { schoolId: SCHOOL, classId: 'c_y1', period: '1', startTime: '08:00', endTime: '09:00', isActive: true },
      { schoolId: SCHOOL, classId: 'c_y1', period: '6', startTime: '13:00', endTime: '14:00', isActive: true },
    ];
    const res = await supertest(buildApp()).put('/api/bell-schedule').send({
      id: 'bs_y1_2', section: 'primary', name: 'Year 1–2', classIds: ['c_y1', 'c_y2'],
      periods: [{ p: '1', start: '08:30', end: '09:30', label: 'Period 1', isBreak: false }],
    });
    expect(res.status).toBe(200);
    expect(mockSlots[0].bellScheduleId).toBe('bs_y1_2');
    expect(mockSlots[0].scheduleStale).toBe(false);
    expect(mockSlots[1].scheduleStale).toBe(true);
    expect(mockSlots[1].startTime).toBe('13:00'); // kept, not silently cleared
  });
});

describe('listing and removing schedules', () => {
  test('lists every named schedule with its classes', async () => {
    const res = await supertest(buildApp()).get('/api/bell-schedule/schedules');
    expect(res.body.data.map(s => s.name)).toEqual(expect.arrayContaining(['Year 1–2', 'Primary default', 'School default']));
  });

  test('removing a named schedule leaves its classes on the section default', async () => {
    const res = await supertest(buildApp()).delete('/api/bell-schedule').query({ id: 'bs_y1_2' });
    expect(res.status).toBe(200);
    const r = await resolveBellSchedule(SCHOOL, 'primary', 'c_y1');
    expect(r.id).toBe('bs_primary');
  });

  test('the school-wide default cannot be removed by section', async () => {
    const res = await supertest(buildApp()).delete('/api/bell-schedule').query({ section: 'all' });
    expect(res.status).toBe(400);
  });
});
