/* ============================================================
   Msingi — /api/analytics
   Leadership analytics dashboard — single endpoint that runs
   4 parallel aggregations and returns a unified snapshot.

   GET /api/analytics/leadership?days=30

   Access: admin, superadmin, deputy_principal, section_head
   Plan:   premium

   GET /api/analytics/group?days=30 — the same snapshot, rolled up
   across every school in the caller's organization. For a
   group_director-type account whose whole job is "the merged view,
   not any one school's settings" — see CHANGELOG for the
   platform-admin flow that provisions this role.

   GET /api/analytics/series?dateFrom=&dateTo=&bucket= — the window cut
   into consecutive buckets (attendance rate, money billed, money
   collected, marks filed) for trend charts, which no windowed snapshot
   can give. Same gate as /leadership: it is the same school's numbers,
   just sliced by time.
   ============================================================ */
const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel }    = require('../utils/tenant-model');
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('analytics');
const MODGATE = moduleGate('reports');

// "Lifetime" for _computeLeadershipSnapshot's days-based window — the
// function only ever does since.setDate(since.getDate() - days), so a
// far-past lookback is functionally equivalent to "no lower bound" without
// needing a second code path through the aggregations below.
const LIFETIME_DAYS = 36500; // ~100 years

/* ────────────────────────────────────────────────────────────
   Runs the 4 leadership aggregations for ONE school. Pure w.r.t.
   its schoolId argument — not derived from req — so it can be
   reused both for the caller's own school (/leadership) and for
   every school in an organization (/group), which legitimately
   read schools other than the caller's own. tenantModel(collection,
   {schoolId}) still enforces that no single query ever mixes two
   schools' data together; it just doesn't require that schoolId be
   the caller's own — that access decision is rbac()'s job, not
   tenantModel()'s (see /group's route-level comment).
   ─────────────────────────────────────────────────────────── */
async function _computeLeadershipSnapshot(schoolId, days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const todayStr = new Date().toISOString().slice(0, 10);

  /* ── Run all 4 aggregations in parallel ──────────────── */
  const [
    attendanceResult,
    feeResult,
    behaviourResult,
    academicResult,
    classesResult,
  ] = await Promise.all([

    /* 1. ATTENDANCE RISK ─────────────────────────────────
       Per-student attendance in the window → flag at-risk (<80%)
       Then group by classId to get class-level risk summary.         */
    tenantModel('attendance', { schoolId }).aggregate([
      { $match: { schoolId, date: { $gte: sinceStr } } },
      {
        $group: {
          _id:     { classId: '$classId', studentId: '$studentId' },
          total:   { $sum: 1 },
          present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        }
      },
      {
        $addFields: {
          rate: { $round: [{ $multiply: [{ $divide: ['$present', { $max: ['$total', 1] }] }, 100] }, 1] },
        }
      },
      {
        $group: {
          _id:            '$_id.classId',
          totalStudents:  { $sum: 1 },
          atRiskCount:    { $sum: { $cond: [{ $lt: ['$rate', 80] }, 1, 0] } },
          avgRate:        { $avg: '$rate' },
        }
      },
      {
        $addFields: {
          atRiskPct: {
            $round: [{ $multiply: [{ $divide: ['$atRiskCount', { $max: ['$totalStudents', 1] }] }, 100] }, 1]
          },
          avgRate: { $round: ['$avgRate', 1] },
        }
      },
      { $sort:  { atRiskCount: -1 } },
      { $limit: 15 },
    ]),

    /* 2. FEE EXPOSURE ────────────────────────────────────
       Invoices with an outstanding balance.
       Totals + overdue count (dueDate before today).              */
    tenantModel('invoices', { schoolId }).aggregate([
      // status !== 'voided' — a voided invoice's balance/total/amountPaid
      // are left untouched by the void action, so a stale positive balance
      // would otherwise still count toward outstanding fee exposure.
      // createdAt >= since scopes this to invoices raised within the
      // selected window — "new fee exposure introduced this period" — so
      // the panel actually moves when the days/date filter changes, unlike
      // before, when it silently ignored the selector entirely.
      { $match: { schoolId, balance: { $gt: 0 }, status: { $ne: 'voided' }, createdAt: { $gte: since } } },
      {
        $group: {
          _id:              null,
          totalOutstanding: { $sum: '$balance'  },
          // `total` is the canonical field every create/edit/generate path
          // writes — `amount` is a legacy name only the demo seed script
          // still used, which silently zeroed this for live-created invoices.
          totalInvoiced:    { $sum: '$total'    },
          totalPaid:        { $sum: '$amountPaid' },
          studentsOwing:    { $sum: 1 },
          overdueCount:     { $sum: { $cond: [
            { $and: [
              { $ifNull: ['$dueDate', false] },
              { $lt: ['$dueDate', todayStr] },
            ]},
            1, 0
          ]}},
          overdueAmount:    { $sum: { $cond: [
            { $and: [
              { $ifNull: ['$dueDate', false] },
              { $lt: ['$dueDate', todayStr] },
            ]},
            '$balance', 0
          ]}},
        }
      },
    ]),

    /* 3. BEHAVIOUR HEATMAP ──────────────────────────────
       Incidents in the window grouped by classId.
       Merits vs demerits + severity breakdown.                    */
    tenantModel('behaviour_incidents', { schoolId }).aggregate([
      { $match: { schoolId, date: { $gte: sinceStr } } },
      {
        $group: {
          _id:      '$classId',
          total:    { $sum: 1 },
          merits:   { $sum: { $cond: [{ $eq: ['$type', 'merit']   }, 1, 0] } },
          demerits: { $sum: { $cond: [{ $eq: ['$type', 'demerit'] }, 1, 0] } },
          high:     { $sum: { $cond: [{ $eq: ['$severity', 'high']   }, 1, 0] } },
          medium:   { $sum: { $cond: [{ $eq: ['$severity', 'medium'] }, 1, 0] } },
          low:      { $sum: { $cond: [{ $eq: ['$severity', 'low']    }, 1, 0] } },
        }
      },
      { $sort:  { demerits: -1 } },
      { $limit: 15 },
    ]),

    /* 4. ACADEMIC HEALTH ────────────────────────────────
       Published grades → weighted avg per student → class avg.
       Shows how each class is performing academically.           */
    // Markbook marks (assessment_marks) only — rawScore is already a 0-100
    // percentage and there's no per-row weight, so a student's average is the
    // mean of their present marks. createdAt >= since keeps the selector's window.
    tenantModel('assessment_marks', { schoolId }).aggregate([
      { $match: { schoolId, isPublished: true, markState: 'present', rawScore: { $ne: null }, createdAt: { $gte: since } } },
      {
        $group: {
          _id:    { classId: '$classId', studentId: '$studentId' },
          rawAvg: { $avg: '$rawScore' },
        }
      },
      {
        $addFields: { studentAvg: { $round: ['$rawAvg', 1] } }
      },
      {
        $group: {
          _id:           '$_id.classId',
          avgScore:      { $avg: '$studentAvg' },
          studentCount:  { $sum: 1 },
        }
      },
      {
        $addFields: { avgScore: { $round: ['$avgScore', 1] } }
      },
      { $sort: { avgScore: 1 } }, // worst-performing first
      { $limit: 15 },
    ]),

    /* 5. CLASS NAME LOOKUP ──────────────────────────────
       Batch-fetch all class names to enrich the results.
       Include _id so we can map both UUID 'id' and ObjectId strings
       — older attendance records may have been saved with either.  */
    tenantModel('classes', { schoolId }).find({ schoolId }, { id: 1, name: 1 }).lean(),
  ]);

  /* ── Build classId → name map ─────────────────────── */
  // Support both UUID (c.id) and MongoDB ObjectId (c._id) as classId values,
  // because attendance records created before the UUID migration used ObjectIds.
  const classMap = Object.fromEntries(
    (classesResult ?? []).flatMap(c => {
      const entries = [];
      if (c.id)   entries.push([c.id,         c.name]);
      if (c._id)  entries.push([String(c._id), c.name]);
      return entries;
    })
  );

  /* ── Enrich attendance results ────────────────────── */
  const attendanceRisk = attendanceResult.map(r => ({
    classId:       r._id,
    className:     classMap[r._id] ?? r._id ?? 'Unknown Class',
    totalStudents: r.totalStudents,
    atRiskCount:   r.atRiskCount,
    atRiskPct:     r.atRiskPct,
    avgRate:       r.avgRate,
  }));

  /* ── Fee exposure summary ─────────────────────────── */
  const feeSummary = feeResult[0] ?? {
    totalOutstanding: 0, totalInvoiced: 0, totalPaid: 0,
    studentsOwing: 0, overdueCount: 0, overdueAmount: 0,
  };
  const collectionRate = feeSummary.totalInvoiced > 0
    ? Math.round((feeSummary.totalPaid / feeSummary.totalInvoiced) * 100)
    : null;
  const feeExposure = { ...feeSummary, collectionRate };

  /* ── Enrich behaviour heatmap ─────────────────────── */
  const behaviourHeatmap = behaviourResult.map(r => ({
    classId:   r._id,
    className: classMap[r._id] ?? r._id ?? 'Unknown Class',
    total:     r.total,
    merits:    r.merits,
    demerits:  r.demerits,
    high:      r.high,
    medium:    r.medium,
    low:       r.low,
  }));

  /* ── Enrich academic trends ───────────────────────── */
  const academicHealth = academicResult.map(r => ({
    classId:      r._id,
    className:    classMap[r._id] ?? r._id ?? 'Unknown Class',
    avgScore:     r.avgScore,
    studentCount: r.studentCount,
  })).sort((a, b) => a.avgScore - b.avgScore); // worst first

  return {
    meta: { days, since: sinceStr, generatedAt: new Date().toISOString() },
    attendanceRisk,
    feeExposure,
    behaviourHeatmap,
    academicHealth,
  };
}

/* ============================================================
   Time series — the same aggregates grouped into consecutive
   periods, so a chart can draw one honest trend. Without this the
   client would have to re-issue windowed leadership calls and
   stitch them, which costs a query per data point and drifts.
   ============================================================ */

/* The date-bearing fields across these collections are NOT uniformly
   typed: attendance.date is 'YYYY-MM-DD', payments.paidAt is a full ISO
   string, invoices/assessment_marks.createdAt are real Dates, and
   behaviour_incidents.date has been written as both. $substr throws on a
   Date and $dateToString throws on a String, and either failure 500s the
   whole route, so the day key is taken from whatever the field actually
   is rather than from which type this school's records happen to use.
   Rows with neither (missing/null) bucket to null and are skipped. */
function _dayKeyExpr(field) {
  return { $switch: {
    branches: [
      { case: { $eq: [{ $type: `$${field}` }, 'string'] }, then: { $substr: [`$${field}`, 0, 10] } },
      { case: { $eq: [{ $type: `$${field}` }, 'date']   }, then: { $dateToString: { format: '%Y-%m-%d', date: `$${field}` } } },
    ],
    default: null,
  }};
}

const SERIES_BUCKETS    = ['day', 'week', 'month'];
// A phone chart is roughly 300dp of plotting width; past this many points
// the bars are sub-pixel and the trend stops being readable.
const SERIES_MAX_POINTS = 26;

/* 'YYYY-MM-DD' → the first day of the bucket holding it. Weeks start
   Monday. All arithmetic is on UTC midnights so a device timezone never
   moves a day into a different bucket. */
function _bucketStart(day, bucket) {
  if (bucket === 'month') return `${day.slice(0, 7)}-01`;
  if (bucket === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}

function _nextBucketStart(day, bucket) {
  const d = new Date(`${day}T00:00:00Z`);
  if (bucket === 'month') d.setUTCMonth(d.getUTCMonth() + 1, 1);
  else d.setUTCDate(d.getUTCDate() + (bucket === 'week' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

/* The x-axis: every bucket from since to until, oldest first, with no
   gaps — a week with no register read has to still occupy its slot or the
   chart draws a straight line over the hole and invents continuity.
   Past MAX_POINTS the OLDEST buckets are dropped, and truncatedFrom
   records where the series really begins: a silently clipped axis is how
   a trend line lies. rawCount stays the un-cut length, so a caller can
   tell a truncated axis from a merely short one. */
function _seriesAxis(since, until, bucket) {
  const keys = [];
  const last = _bucketStart(until, bucket);
  for (let cursor = _bucketStart(since, bucket); cursor <= last; cursor = _nextBucketStart(cursor, bucket)) {
    keys.push(cursor);
  }
  const dropped = keys.length > SERIES_MAX_POINTS ? keys.length - SERIES_MAX_POINTS : 0;
  return {
    keys: dropped ? keys.slice(dropped) : keys,
    truncatedFrom: dropped ? keys[keys.length - SERIES_MAX_POINTS] : null,
    rawCount: keys.length,
  };
}

/* Day → bucket resolution: honour an explicit request, else pick the
   grain that reads as a trend for the span (daily detail is only
   meaningful over a fortnight or less). A grain that overflows the point
   cap escalates before it truncates — 90 days asked for as days is better
   served by 14 weekly points covering the whole span than by 26 daily
   ones covering only its last month. 'month' has nothing coarser to fall
   back to, so it is the only grain that ever truncates. */
function _chooseBucket(since, until, requested) {
  const spanDays = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000) + 1;
  const asked    = SERIES_BUCKETS.includes(requested) ? requested : null;
  let bucket = asked || (spanDays <= 14 ? 'day' : spanDays <= 182 ? 'week' : 'month');

  let axis = _seriesAxis(since, until, bucket);
  while (axis.rawCount > SERIES_MAX_POINTS && bucket !== 'month') {
    bucket = SERIES_BUCKETS[SERIES_BUCKETS.indexOf(bucket) + 1];
    axis   = _seriesAxis(since, until, bucket);
  }
  return { bucket, requested: asked, spanDays, ...axis };
}

/* Fold day-grain rows onto the shared axis. `blank` seeds a bucket, `add`
   accumulates one day into it, `shape` renders the point — an axis slot
   with no rows still gets a point, with null where an average would be a
   guess and 0 where zero is the real answer. */
function _foldSeries(rows, keys, bucket, blank, add, shape) {
  const byBucket = new Map();
  for (const row of rows) {
    if (!row._id) continue;
    const key = _bucketStart(row._id, bucket);
    if (!byBucket.has(key)) byBucket.set(key, blank());
    add(byBucket.get(key), row);
  }
  return keys.map(key => shape(key, byBucket.has(key) ? byBucket.get(key) : null));
}

/* ────────────────────────────────────────────────────────────
   The four series, for one school, in one window. Mirrors
   _computeLeadershipSnapshot's guards so a bucket sums exactly what
   the same window's headline number sums:
     - attendance counts 'late' as attended, as the risk table does;
     - invoices exclude voided AND draft — a draft has not been billed
       yet, so counting it would make the "billed" bar claim money the
       school has not asked anyone for (/finance/summary uses the same
       $nin);
     - marks are published, present, and scored, as academic health is.
   assessment_marks has no date of its own — no assessmentId, no exam
   date — so a mark lands in the bucket it was FILED in. That is honest
   ("marks entered per week, at the average they were entered at") but
   it is not "performance over term", and the caller must not label it
   as such.
   ─────────────────────────────────────────────────────────── */
async function _computeSeriesSnapshot(schoolId, sinceStr, untilStr, requestedBucket) {
  const { bucket, requested, keys, truncatedFrom } = _chooseBucket(sinceStr, untilStr, requestedBucket);
  const sinceDate = new Date(`${sinceStr}T00:00:00.000Z`);
  const untilDate = new Date(`${untilStr}T23:59:59.999Z`);

  const [attendanceDays, invoiceDays, paymentDays, markDays] = await Promise.all([

    /* attendance.date holds 'YYYY-MM-DD', so the bounds are day strings —
       the same comparison the leadership risk table makes. */
    tenantModel('attendance', { schoolId }).aggregate([
      { $match: { schoolId, date: { $gte: sinceStr, $lte: untilStr } } },
      { $group: {
        _id:     _dayKeyExpr('date'),
        total:   { $sum: 1 },
        present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
    ]),

    /* invoices.createdAt is a Date; `total` is the canonical billed amount
       (see the leadership fee aggregation's note on the legacy `amount`). */
    tenantModel('invoices', { schoolId }).aggregate([
      { $match: { schoolId, status: { $nin: ['voided', 'draft'] }, createdAt: { $gte: sinceDate, $lte: untilDate } } },
      { $group: {
        _id:    _dayKeyExpr('createdAt'),
        amount: { $sum: '$total' },
        count:  { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),

    /* payments.paidAt is an ISO *string*, so the upper bound needs the
       end-of-day suffix — `${until}` alone would sort every timestamp on
       that day after it and drop the day's money. */
    tenantModel('payments', { schoolId }).aggregate([
      { $match: { schoolId, paidAt: { $gte: `${sinceStr}T00:00:00.000Z`, $lte: `${untilStr}T23:59:59.999Z` } } },
      { $group: {
        _id:    _dayKeyExpr('paidAt'),
        amount: { $sum: '$amount' },
        count:  { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),

    tenantModel('assessment_marks', { schoolId }).aggregate([
      { $match: { schoolId, isPublished: true, markState: 'present', rawScore: { $ne: null }, createdAt: { $gte: sinceDate, $lte: untilDate } } },
      { $group: {
        _id:   _dayKeyExpr('createdAt'),
        avg:   { $avg: '$rawScore' },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
  ]);

  const attendance = _foldSeries(
    attendanceDays, keys, bucket,
    () => ({ present: 0, total: 0 }),
    (acc, r) => { acc.present += r.present; acc.total += r.total; },
    (key, acc) => ({
      bucket:  key,
      present: acc?.present ?? 0,
      total:   acc?.total ?? 0,
      // null, not 0% — no register read that week is not the same fact as
      // everybody being absent, and a chart must not be able to confuse them.
      rate:    acc && acc.total > 0 ? Math.round((acc.present / acc.total) * 1000) / 10 : null,
    }),
  );

  const money = rows => _foldSeries(
    rows, keys, bucket,
    () => ({ amount: 0, count: 0 }),
    (acc, r) => { acc.amount += (r.amount || 0); acc.count += r.count; },
    (key, acc) => ({ bucket: key, amount: Math.round((acc?.amount ?? 0) * 100) / 100, count: acc?.count ?? 0 }),
  );

  const marks = _foldSeries(
    markDays, keys, bucket,
    () => ({ sum: 0, count: 0 }),
    (acc, r) => { acc.sum += r.avg * r.count; acc.count += r.count; },
    (key, acc) => ({
      bucket:     key,
      marksCount: acc?.count ?? 0,
      // mean of the marks, not of the students — a heavy week of one
      // student's work should not out-weigh a light week of many.
      avgScore:   acc && acc.count > 0 ? Math.round((acc.sum / acc.count) * 10) / 10 : null,
    }),
  );

  return {
    meta: {
      bucket, requested, since: sinceStr, until: untilStr,
      pointCount: keys.length, truncatedFrom, generatedAt: new Date().toISOString(),
    },
    attendance,
    billed:    money(invoiceDays),
    collected: money(paymentDays),
    marks,
  };
}

/* ── Fold N per-school snapshots into one organization-wide summary.
   Class-level breakdowns (attendanceRisk/behaviourHeatmap/academicHealth
   arrays) are meaningless concatenated across schools — a classId from
   one school has no relationship to a same-shaped classId from another.
   The combined view is summary numbers only: weighted averages (by the
   natural denominator — students, or invoiced amount) and straight sums,
   never a re-listing of individual classes. ─────────────────────── */
function _combineSnapshots(perSchool) {
  let totalOutstanding = 0, totalInvoiced = 0, totalPaid = 0, studentsOwing = 0, overdueCount = 0, overdueAmount = 0;
  let attendanceWeightedSum = 0, attendanceStudents = 0, atRiskCount = 0;
  let academicWeightedSum = 0, academicStudents = 0;
  let merits = 0, demerits = 0, high = 0, medium = 0, low = 0, incidents = 0;

  for (const { snapshot } of perSchool) {
    const fee = snapshot.feeExposure;
    totalOutstanding += fee.totalOutstanding; totalInvoiced += fee.totalInvoiced; totalPaid += fee.totalPaid;
    studentsOwing    += fee.studentsOwing;    overdueCount  += fee.overdueCount;  overdueAmount += fee.overdueAmount;

    for (const c of snapshot.attendanceRisk) {
      attendanceWeightedSum += c.avgRate * c.totalStudents;
      attendanceStudents    += c.totalStudents;
      atRiskCount            += c.atRiskCount;
    }
    for (const c of snapshot.academicHealth) {
      academicWeightedSum += c.avgScore * c.studentCount;
      academicStudents    += c.studentCount;
    }
    for (const c of snapshot.behaviourHeatmap) {
      merits += c.merits; demerits += c.demerits;
      high += c.high; medium += c.medium; low += c.low;
      incidents += c.total;
    }
  }

  return {
    feeExposure: {
      totalOutstanding, totalInvoiced, totalPaid, studentsOwing, overdueCount, overdueAmount,
      collectionRate: totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : null,
    },
    attendance: {
      avgRate:         attendanceStudents > 0 ? Math.round((attendanceWeightedSum / attendanceStudents) * 10) / 10 : null,
      totalStudents:   attendanceStudents,
      atRiskCount,
      atRiskPct:       attendanceStudents > 0 ? Math.round((atRiskCount / attendanceStudents) * 1000) / 10 : null,
    },
    academic: {
      avgScore:      academicStudents > 0 ? Math.round((academicWeightedSum / academicStudents) * 10) / 10 : null,
      studentCount:  academicStudents,
    },
    behaviour: { merits, demerits, high, medium, low, total: incidents },
  };
}

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/leadership
   Query params:
     dateTo   — present whenever the caller uses the dashboard's global
                date-range filter (always "today" today, but sent
                explicitly so its absence is unambiguous)
     dateFrom — the lower bound; omitted specifically means "lifetime"
                (no lower bound), not "use the default"
     days     — legacy fallback (7 | 30 | 90, default 30), only consulted
                when dateTo is absent entirely (no caller sends this
                anymore, kept for safety)
   ─────────────────────────────────────────────────────────── */
router.get('/leadership', authMiddleware, PLAN, MODGATE, rbac('analytics', 'read'), async (req, res) => {
  try {
    let days;
    if (req.query.dateTo) {
      days = req.query.dateFrom
        ? Math.max(1, Math.ceil((Date.now() - new Date(req.query.dateFrom).getTime()) / 86400000))
        : LIFETIME_DAYS;
    } else {
      const rawDays = parseInt(req.query.days) || 30;
      days = [7, 30, 90].includes(rawDays) ? rawDays : 30;
    }

    const snapshot = await _computeLeadershipSnapshot(req.jwtUser.schoolId, days);
    return ok(res, snapshot);
  } catch (err) {
    console.error('[analytics GET /leadership]', err);
    return E.serverError(res);
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/series
   The window's aggregates as consecutive buckets — the four arrays in
   the response share one x-axis (meta.pointCount long, oldest first),
   so a chart can plot any of them, or all of them, without re-querying.

   Query params, same contract as /leadership's date filter:
     dateFrom / dateTo — 'YYYY-MM-DD'; dateTo alone means "up to today",
                         dateTo without dateFrom means the whole life of
                         the school (LIFETIME_DAYS, then bucket-escalated
                         or truncated to the most recent points)
     days              — legacy 7|30|90 fallback, only when dateTo is absent
     bucket            — 'day' | 'week' | 'month'; any other value, or none,
                         lets the server choose from the span. meta.bucket
                         always reports the grain actually used, and
                         meta.requested says whether that was the caller.
   ─────────────────────────────────────────────────────────── */
router.get('/series', authMiddleware, PLAN, MODGATE, rbac('analytics', 'read'), async (req, res) => {
  try {
    const until = req.query.dateTo ? String(req.query.dateTo).slice(0, 10) : new Date().toISOString().slice(0, 10);

    let since;
    if (req.query.dateFrom) {
      since = String(req.query.dateFrom).slice(0, 10);
    } else if (req.query.dateTo) {
      const far = new Date();
      far.setDate(far.getDate() - LIFETIME_DAYS);
      since = far.toISOString().slice(0, 10);
    } else {
      const rawDays = parseInt(req.query.days) || 30;
      const back    = [7, 30, 90].includes(rawDays) ? rawDays : 30;
      const d = new Date();
      d.setDate(d.getDate() - back);
      since = d.toISOString().slice(0, 10);
    }

    if (since > until) {
      return E.badRequest(res, 'dateFrom must be on or before dateTo');
    }

    const snapshot = await _computeSeriesSnapshot(req.jwtUser.schoolId, since, until, req.query.bucket);
    return ok(res, snapshot);
  } catch (err) {
    console.error('[analytics GET /series]', err);
    return E.serverError(res);
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/group
   The same leadership snapshot, for every school in the caller's
   organization — for a group_director-type account whose account
   lives at one "anchor" school but whose access is read-only and
   spans the whole org automatically (add a school to the org later
   and it appears here with no per-account change needed).

   Gated on a DISTINCT permission ('group_analytics') from the
   single-school 'analytics' permission above, specifically so an
   ordinary school admin's existing analytics access never implicitly
   grants a cross-school view — this is opt-in per role, per school's
   own role_permissions doc, same as any other module.

   This route legitimately reads every school in an organization, not
   just the caller's own — the multi-tenant-read equivalent of
   platform.js's orphans/impersonate routes, scoped to one org instead
   of the whole platform. tenantModel() still isolates each school's
   query from every other's; rbac() is what limits who can reach here.
   ─────────────────────────────────────────────────────────── */
router.get('/group', authMiddleware, PLAN, MODGATE, rbac('group_analytics', 'read'), async (req, res) => {
  try {
    const rawDays = parseInt(req.query.days) || 30;
    const days    = [7, 30, 90].includes(rawDays) ? rawDays : 30;

    const Schools = _model('schools');
    const home = await Schools.findOne({ id: req.jwtUser.schoolId }).lean();
    if (!home || !home.organizationId) {
      return E.badRequest(res, 'No organization found for this account');
    }

    const orgSchools = await Schools.find({ organizationId: home.organizationId, isActive: { $ne: false } })
      .select('id name shortName').lean();

    const perSchool = await Promise.all(orgSchools.map(async s => ({
      schoolId: s.id, schoolName: s.name || s.shortName,
      snapshot: await _computeLeadershipSnapshot(s.id, days),
    })));

    return ok(res, {
      meta: { days, generatedAt: new Date().toISOString(), schoolCount: orgSchools.length },
      schools:  perSchool,
      combined: _combineSnapshots(perSchool),
    });
  } catch (err) {
    console.error('[analytics GET /group]', err);
    return E.serverError(res);
  }
});

router._computeLeadershipSnapshot = _computeLeadershipSnapshot;
router._combineSnapshots          = _combineSnapshots;
router._computeSeriesSnapshot     = _computeSeriesSnapshot;
router._chooseBucket              = _chooseBucket;
router._bucketStart               = _bucketStart;
router._foldSeries                = _foldSeries;

module.exports = router;
