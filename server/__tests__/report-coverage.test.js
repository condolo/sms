/* ============================================================
   utils/report-coverage.js (v5.271.0)

   Asked for by a school that sets HW and CA more than once a term:
   "the Mid-Term report card fetches only assessments from the start of
   that term to the mid-term assessment; the End-Term report fetches all
   of them for that term." Coverage comes from the assessment schedule's
   per-instance windows.
   ============================================================ */
'use strict';

const { createFakeDb } = require('./fixtures/fake-tenant-db');
let mockDb;
jest.mock('../utils/tenant-model', () => ({
  tenantModel: (name) => mockDb.model(name),
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
}));

const { reportCoverage, coverageMarkClause } = require('../utils/report-coverage');
const { matches } = require('./fixtures/fake-tenant-db');

const S = 'sch_1';
const Y = 'ay_2026';
const TYPES = [
  { key: 'CA', instances: 2 }, { key: 'HW', instances: 2 },
  { key: 'MT', instances: 1 }, { key: 'ET', instances: 1 },
];
const win = (assessmentType, instance, dateFrom, dateTo, extra = {}) =>
  ({ schoolId: S, termNumber: 1, academicYearId: Y, assessmentType, instance, dateFrom, dateTo, ...extra });

function termSchedule(extra = []) {
  return createFakeDb({
    assessment_schedule: [
      win('HW', 1, '2026-01-12', '2026-01-23'),
      win('CA', 1, '2026-02-02', '2026-02-06'),
      win('MT', 1, '2026-03-02', '2026-03-06'),
      win('HW', 2, '2026-03-16', '2026-03-27'),
      win('CA', 2, '2026-04-06', '2026-04-10'),
      win('ET', 1, '2026-04-20', '2026-04-30'),
      ...extra,
    ],
  });
}
const cover = (cycle, opts = {}) => reportCoverage({ schoolId: S }, S, { termNumber: 1, academicYearId: Y, cycle, customTypes: TYPES, ...opts });

describe('which assessments a report covers', () => {
  beforeEach(() => { mockDb = termSchedule(); });

  test('Mid-Term covers what is scheduled from the start of term up to the Mid-Term window', async () => {
    const c = await cover('MT');
    expect(c.mode).toBe('by_schedule');
    expect(c.cutoff).toBe('2026-03-06');
    expect(c.included.sort()).toEqual(['CA 1', 'HW 1', 'MT']);
    expect(c.excluded.sort()).toEqual(['CA 2', 'ET', 'HW 2']);
    expect([...c.include].sort()).toEqual(['CA|1', 'HW|1', 'MT|1']);
  });

  test('End-Term covers the whole term', async () => {
    const c = await cover('ET');
    expect(c.included.sort()).toEqual(['CA 1', 'CA 2', 'ET', 'HW 1', 'HW 2', 'MT']);
    expect(c.excluded).toEqual([]);
  });

  test('no cycle (the default whole-term report) covers every mark, as before', async () => {
    const c = await cover(undefined);
    expect(c).toMatchObject({ mode: 'whole_term', include: null });
  });

  test('a cycle with no window this term covers every mark rather than guessing', async () => {
    mockDb = createFakeDb({ assessment_schedule: [win('HW', 1, '2026-01-12', '2026-01-23')] });
    const c = await cover('MT');
    expect(c).toMatchObject({ mode: 'cycle_unscheduled', include: null });
  });

  test('an instance with no window is left out of the Mid-Term report and named, but the last report covers it', async () => {
    mockDb = createFakeDb({ assessment_schedule: [
      win('HW', 1, '2026-01-12', '2026-01-23'), win('CA', 1, '2026-02-02', '2026-02-06'),
      win('MT', 1, '2026-03-02', '2026-03-06'), win('ET', 1, '2026-04-20', '2026-04-30'),
    ] });
    const mt = await cover('MT');
    expect(mt.unscheduled.sort()).toEqual(['CA 2', 'HW 2']);
    expect(mt.include.has('HW|2')).toBe(false);
    const et = await cover('ET');
    expect(et.include.has('HW|2')).toBe(true);
    expect(et.unscheduled).toEqual([]);
  });

  test('a window saved for this academic year wins over a legacy one without a year', async () => {
    mockDb = termSchedule([win('HW', 2, '2026-02-09', '2026-02-13', { academicYearId: null })]);
    const c = await cover('MT');
    expect(c.include.has('HW|2')).toBe(false);   // this year's HW 2 window (16 Mar) is after MT
  });

  test('another term and another school are ignored', async () => {
    mockDb = termSchedule([
      win('HW', 2, '2026-02-09', '2026-02-13', { termNumber: 2 }),
      win('HW', 2, '2026-02-09', '2026-02-13', { schoolId: 'sch_other' }),
    ]);
    const c = await cover('MT');
    expect(c.include.has('HW|2')).toBe(false);
  });

  test('the lock clause matches only covered marks, counting a mark with no instance as instance 1', async () => {
    const c = await cover('MT');
    const clause = coverageMarkClause(c);
    const yes = [{ assessmentType: 'HW', instance: 1 }, { assessmentType: 'HW' }, { assessmentType: 'MT', instance: 1 }];
    const no = [{ assessmentType: 'HW', instance: 2 }, { assessmentType: 'ET', instance: 1 }, { assessmentType: 'CA', instance: 2 }];
    for (const m of yes) expect(matches(m, clause)).toBe(true);
    for (const m of no) expect(matches(m, clause)).toBe(false);
    expect(coverageMarkClause({ combos: null })).toEqual({});
  });
});
