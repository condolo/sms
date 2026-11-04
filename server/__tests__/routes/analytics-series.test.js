/* ============================================================
   GET /api/analytics/series — time-series aggregation tests.

   The chart points are folded in JS from day-grain aggregate rows, so
   both halves get exercised: the pipeline handed to MongoDB (its $match
   guards and the type-safe day key), and the folding that turns days
   into consecutive, gap-filled buckets.

   All DB calls are mocked — no MongoDB required. The tenantModel mock
   follows analytics-group.test.js, extended to record the pipeline each
   collection was handed.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../../middleware/rbac',  () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../../middleware/plan',  () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_r, _s, n) => n() }));

let mockDayRows = {};   // collection -> day-grain rows the aggregate "returns"
let mockPipelines = {}; // collection -> the pipeline it was handed

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => ({
    aggregate: async (pipeline) => {
      mockPipelines[collection] = pipeline;
      return mockDayRows[collection] ?? [];
    },
    find: () => ({ lean: async () => [] }),
  })),
}));

const express   = require('express');
const supertest = require('supertest');

const analytics = require('../../routes/analytics');
const { _computeSeriesSnapshot, _chooseBucket, _foldSeries, _bucketStart } = analytics;

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.jwtUser = { schoolId: 'sch_test' }; next(); });
  a.use('/api/analytics', analytics);
  return a;
}

/** The $match stage of a captured pipeline. */
const matchOf = (c) => mockPipelines[c][0].$match;
/** The _id expression a pipeline groups days by. */
const groupOf = (c) => mockPipelines[c][1].$group;

beforeEach(() => {
  jest.clearAllMocks();
  mockDayRows   = {};
  mockPipelines = {};
});

describe('_bucketStart / _chooseBucket — calendar maths', () => {
  test('weeks start Monday, months on the 1st, days pass through', () => {
    expect(_bucketStart('2026-11-05', 'day')).toBe('2026-11-05');
    expect(_bucketStart('2026-11-05', 'week')).toBe('2026-11-02'); // Thu → that Monday
    expect(_bucketStart('2026-11-01', 'week')).toBe('2026-10-26'); // Sun belongs to the week before
    expect(_bucketStart('2026-12-31', 'week')).toBe('2026-12-28'); // crosses the year
    expect(_bucketStart('2026-11-27', 'month')).toBe('2026-11-01');
    expect(_bucketStart('2026-01-01', 'month')).toBe('2026-01-01');
  });

  test('picks the grain from the span when the caller does not ask', () => {
    expect(_chooseBucket('2026-10-20', '2026-11-02', null).bucket).toBe('day');    // 14 days
    expect(_chooseBucket('2026-09-01', '2026-11-02', null).bucket).toBe('week');   // 63
    expect(_chooseBucket('2025-01-01', '2026-11-02', null).bucket).toBe('month');  // 671
  });

  test('escalates a grain that would overplot instead of drawing 90 bars', () => {
    const forcedDay = _chooseBucket('2026-08-05', '2026-11-02', 'day'); // 90 days
    expect(forcedDay.bucket).toBe('week');
    expect(forcedDay.keys.length).toBe(14); // 2026-08-03 .. 2026-11-02, Mondays inclusive
    expect(forcedDay.truncatedFrom).toBeNull(); // the whole span came back, just coarser
  });

  test('month is as coarse as it goes, so a lifetime window keeps the recent end and says so', () => {
    const lifetime = _chooseBucket('1926-11-27', '2026-11-02', 'month');
    expect(lifetime.bucket).toBe('month');
    expect(lifetime.keys.length).toBe(26);
    expect(lifetime.truncatedFrom).toBe(lifetime.keys[0]);
    expect(lifetime.keys[0].slice(0, 4)).toBe('2024');
    expect(lifetime.keys[25]).toBe('2026-11-01');
  });

  test('the axis is gap-free and every weekly bucket is a Monday', () => {
    const { keys } = _chooseBucket('2026-10-01', '2026-11-02', 'week');
    expect(keys[0]).toBe('2026-09-28'); // Monday of the week holding the 1st
    expect(keys[keys.length - 1]).toBe('2026-11-02');
    keys.forEach((k, i) => {
      expect(new Date(`${k}T00:00:00Z`).getUTCDay()).toBe(1);
      if (i) expect(new Date(`${k}T00:00:00Z`).getTime()).toBeGreaterThan(new Date(`${keys[i - 1]}T00:00:00Z`).getTime());
    });
  });
});

describe('series pipeline — what MongoDB is asked for', () => {
  test('bounds each collection in the type its field actually stores', async () => {
    await _computeSeriesSnapshot('sch_test', '2026-10-20', '2026-11-02', 'day');

    // attendance.date stores 'YYYY-MM-DD' — a Date bound would match nothing.
    expect(matchOf('attendance')).toEqual({
      schoolId: 'sch_test', date: { $gte: '2026-10-20', $lte: '2026-11-02' },
    });

    // payments.paidAt stores a full ISO timestamp, so the upper bound needs
    // the end-of-day suffix — '2026-11-02' alone sorts before every timestamp
    // on that day and would silently drop the last day's money.
    expect(matchOf('payments').paidAt).toEqual({
      $gte: '2026-10-20T00:00:00.000Z', $lte: '2026-11-02T23:59:59.999Z',
    });

    // invoices.createdAt and assessment_marks.createdAt are real Dates.
    expect(matchOf('invoices').createdAt).toEqual({
      $gte: new Date('2026-10-20T00:00:00.000Z'), $lte: new Date('2026-11-02T23:59:59.999Z'),
    });
    expect(matchOf('assessment_marks').createdAt.$gte).toEqual(new Date('2026-10-20T00:00:00.000Z'));
  });

  test('carries the leadership snapshot\'s exclusions into every bucket', async () => {
    await _computeSeriesSnapshot('sch_test', '2026-10-20', '2026-11-02', 'day');

    // A draft has not been billed and a void was never owed; neither belongs
    // in a "billed per week" bar. Same $nin as GET /finance/summary.
    expect(matchOf('invoices').status).toEqual({ $nin: ['voided', 'draft'] });

    expect(matchOf('assessment_marks')).toMatchObject({
      schoolId: 'sch_test', isPublished: true, markState: 'present', rawScore: { $ne: null },
    });

    // 'late' counts as attended, exactly as the attendance-risk table counts it.
    expect(groupOf('attendance').present.$sum.$cond[0].$in[1]).toEqual(['present', 'late']);
  });

  test('derives the day key from the field\'s runtime type, not an assumption', async () => {
    await _computeSeriesSnapshot('sch_test', '2026-10-20', '2026-11-02', 'week');

    const fields = { attendance: 'date', invoices: 'createdAt', payments: 'paidAt', assessment_marks: 'createdAt' };
    for (const [collection, field] of Object.entries(fields)) {
      const expr = groupOf(collection)._id.$switch;
      expect(expr.branches.map(b => b.case.$eq[1])).toEqual(['string', 'date']);
      expect(expr.branches[0].then).toEqual({ $substr: [`$${field}`, 0, 10] });
      expect(expr.branches[1].then).toEqual({ $dateToString: { format: '%Y-%m-%d', date: `$${field}` } });
      // Anything else (missing, null, an int) buckets to null and is skipped,
      // rather than throwing and 500ing the route for one malformed row.
      expect(expr.default).toBeNull();
    }
  });

  test('isolates every query to the one school', async () => {
    await _computeSeriesSnapshot('sch_other', '2026-10-20', '2026-11-02', 'week');
    for (const c of ['attendance', 'invoices', 'payments', 'assessment_marks']) {
      expect(matchOf(c).schoolId).toBe('sch_other');
    }
  });
});

describe('_foldSeries — days onto the axis', () => {
  const rateShape = (key, acc) => ({
    bucket:  key,
    present: acc?.present ?? 0,
    total:   acc?.total ?? 0,
    // null, not 0%: "no register was read" is a different fact from
    // "everybody was absent", and a chart must not be able to confuse them.
    rate:    acc && acc.total > 0 ? Math.round((acc.present / acc.total) * 1000) / 10 : null,
  });
  const blank = () => ({ present: 0, total: 0 });
  const add   = (acc, r) => { acc.present += r.present; acc.total += r.total; };
  const keys  = ['2026-10-26', '2026-11-02']; // two consecutive Mondays

  test('sums a bucket from its days and takes the rate over the totals', () => {
    const rows = [
      { _id: '2026-10-26', total: 10, present: 8 },
      { _id: '2026-10-30', total: 30, present: 12 }, // 80% then 40% — the week is 20/40, not 60
      { _id: '2026-11-03', total:  5, present: 5 },
    ];
    expect(_foldSeries(rows, keys, 'week', blank, add, rateShape)).toEqual([
      { bucket: '2026-10-26', present: 20, total: 40, rate: 50 },
      { bucket: '2026-11-02', present: 5,  total: 5,  rate: 100 },
    ]);
  });

  test('a bucket with no rows is still a point on the axis', () => {
    const out = _foldSeries([{ _id: '2026-10-26', total: 10, present: 9 }], keys, 'week', blank, add, rateShape);
    expect(out[1]).toEqual({ bucket: '2026-11-02', present: 0, total: 0, rate: null });
  });

  test('a row whose day sits past a truncated axis is dropped, not pushed into a neighbour', () => {
    const out = _foldSeries([{ _id: '2026-10-26', total: 10, present: 1 }], ['2026-11-02'], 'week', blank, add, rateShape);
    expect(out).toEqual([{ bucket: '2026-11-02', present: 0, total: 0, rate: null }]);
  });

  test('rows with a null day are skipped rather than bucketed', () => {
    const out = _foldSeries(
      [{ _id: null, total: 3, present: 3 }, { _id: '2026-11-03', total: 4, present: 2 }],
      keys, 'week', blank, add, rateShape,
    );
    expect(out).toEqual([
      { bucket: '2026-10-26', present: 0, total: 0, rate: null },
      { bucket: '2026-11-02', present: 2, total: 4, rate: 50 },
    ]);
  });
});

describe('GET /api/analytics/series', () => {
  beforeEach(() => {
    mockDayRows = {
      attendance:       [{ _id: '2026-10-30', total: 20, present: 15 }],
      payments:         [{ _id: '2026-10-30', amount: 40000, count: 2 }],
      invoices:         [{ _id: '2026-10-29', amount: 100000, count: 3 }],
      assessment_marks: [{ _id: '2026-10-28', avg: 70, count: 10 }, { _id: '2026-10-29', avg: 50, count: 10 }],
    };
  });

  test('returns four same-length series on one shared axis', async () => {
    const res = await supertest(app()).get('/api/analytics/series?dateFrom=2026-10-26&dateTo=2026-11-01&bucket=week');
    expect(res.status).toBe(200);

    const { meta, attendance, billed, collected, marks } = res.body.data;
    expect(meta).toMatchObject({ bucket: 'week', requested: 'week', since: '2026-10-26', until: '2026-11-01', pointCount: 1, truncatedFrom: null });

    const buckets = attendance.map(p => p.bucket);
    expect(buckets).toEqual(['2026-10-26']);
    expect(billed.map(p => p.bucket)).toEqual(buckets);
    expect(collected.map(p => p.bucket)).toEqual(buckets);
    expect(marks.map(p => p.bucket)).toEqual(buckets);

    expect(attendance[0]).toEqual({ bucket: '2026-10-26', present: 15, total: 20, rate: 75 });
    expect(billed[0]).toEqual({ bucket: '2026-10-26', amount: 100000, count: 3 });
    expect(collected[0]).toEqual({ bucket: '2026-10-26', amount: 40000, count: 2 });
    // two days of 10 marks each, at 70 and 50 — the mean of the marks, not of the days.
    expect(marks[0]).toEqual({ bucket: '2026-10-26', marksCount: 20, avgScore: 60 });
  });

  test('a bucket nobody worked in still plots, with null rates and zero money', async () => {
    mockDayRows = { attendance: [], payments: [], invoices: [], assessment_marks: [] };
    const res = await supertest(app()).get('/api/analytics/series?dateFrom=2026-10-26&dateTo=2026-11-08&bucket=week');
    expect(res.status).toBe(200);

    expect(res.body.data.meta.pointCount).toBe(2);
    expect(res.body.data.attendance).toEqual([
      { bucket: '2026-10-26', present: 0, total: 0, rate: null },
      { bucket: '2026-11-02', present: 0, total: 0, rate: null },
    ]);
    expect(res.body.data.collected[0]).toEqual({ bucket: '2026-10-26', amount: 0, count: 0 });
    expect(res.body.data.marks[0]).toEqual({ bucket: '2026-10-26', marksCount: 0, avgScore: null });
  });

  test('defaults to the last 30 days when the caller sends no range', async () => {
    const res = await supertest(app()).get('/api/analytics/series');
    expect(res.status).toBe(200);

    const { meta } = res.body.data;
    expect(meta.bucket).toBe('week');
    expect(meta.requested).toBeNull();
    expect(Math.round((Date.parse(`${meta.until}T00:00:00Z`) - Date.parse(`${meta.since}T00:00:00Z`)) / 86400000)).toBe(30);
    expect(matchOf('attendance').date).toEqual({ $gte: meta.since, $lte: meta.until });
  });

  test('dateTo with no dateFrom means lifetime, bounded to the recent end', async () => {
    const res = await supertest(app()).get('/api/analytics/series?dateTo=2026-11-02');
    expect(res.status).toBe(200);

    const { meta } = res.body.data;
    expect(meta.bucket).toBe('month');
    expect(meta.pointCount).toBeLessThanOrEqual(26);
    // The window really is "everything the school has ever recorded" — a
    // ~100-year lookback — and the axis is the most recent 26 months of it,
    // with truncatedFrom naming where the chart therefore starts.
    expect(Date.parse(`${meta.until}T00:00:00Z`) - Date.parse(`${meta.since}T00:00:00Z`)).toBeGreaterThan(30000 * 86400000);
    expect(meta.truncatedFrom > meta.since).toBe(true);
    expect(meta.truncatedFrom).toBe(res.body.data.attendance[0].bucket);
  });

  test('rejects an inverted range instead of returning an empty chart', async () => {
    const res = await supertest(app()).get('/api/analytics/series?dateFrom=2026-11-02&dateTo=2026-10-01');
    expect(res.status).toBe(400);
  });

  test('an unrecognised bucket falls back to the span\'s grain rather than erroring', async () => {
    const res = await supertest(app()).get('/api/analytics/series?dateFrom=2026-10-26&dateTo=2026-11-02&bucket=fiscal');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.bucket).toBe('day');   // 8-day span
    expect(res.body.data.meta.requested).toBeNull();
    expect(res.body.data.meta.pointCount).toBe(8);
  });
});
