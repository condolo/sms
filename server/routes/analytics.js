/* ============================================================
   Msingi — /api/analytics
   Leadership analytics dashboard — single endpoint that runs
   4 parallel aggregations and returns a unified snapshot.

   GET /api/analytics/leadership?days=30

   Access: admin, superadmin, deputy_principal, section_head
   Plan:   premium
   ============================================================ */
const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('analytics');

/* ── Roles allowed to see leadership analytics ──────────────── */
const LEADERSHIP_ROLES = new Set([
  'superadmin', 'admin', 'deputy_principal', 'section_head',
]);

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/leadership
   Query params:
     days  — lookback window in days (7 | 30 | 90, default 30)
   ─────────────────────────────────────────────────────────── */
router.get('/leadership', authMiddleware, PLAN, async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;

    if (!LEADERSHIP_ROLES.has(role)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Leadership analytics requires an administrator role.' } });
    }

    const rawDays = parseInt(req.query.days) || 30;
    const days    = [7, 30, 90].includes(rawDays) ? rawDays : 30;

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
      _model('attendance').aggregate([
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
      _model('invoices').aggregate([
        { $match: { schoolId, balance: { $gt: 0 } } },
        {
          $group: {
            _id:              null,
            totalOutstanding: { $sum: '$balance'  },
            totalInvoiced:    { $sum: '$amount'   },
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
      _model('behaviour_incidents').aggregate([
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
      _model('grades').aggregate([
        { $match: { schoolId, isPublished: true } },
        {
          $group: {
            _id:              { classId: '$classId', studentId: '$studentId' },
            weightedScoreSum: { $sum: { $multiply: [{ $divide: ['$score', { $max: ['$maxScore', 1] }] }, '$weight'] } },
            totalWeight:      { $sum: '$weight' },
            rawAvg:           { $avg: { $multiply: [{ $divide: ['$score', { $max: ['$maxScore', 1] }] }, 100] } },
          }
        },
        {
          $addFields: {
            studentAvg: {
              $round: [{
                $cond: [
                  { $gt: ['$totalWeight', 0] },
                  { $multiply: [{ $divide: ['$weightedScoreSum', '$totalWeight'] }, 100] },
                  '$rawAvg',
                ]
              }, 1]
            }
          }
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
         Batch-fetch all class names to enrich the results.        */
      _model('classes').find({ schoolId }, { id: 1, name: 1, _id: 0 }).lean(),
    ]);

    /* ── Build classId → name map ─────────────────────── */
    const classMap = Object.fromEntries((classesResult ?? []).map(c => [c.id, c.name]));

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

    return ok(res, {
      meta: { days, since: sinceStr, generatedAt: new Date().toISOString() },
      attendanceRisk,
      feeExposure,
      behaviourHeatmap,
      academicHealth,
    });
  } catch (err) {
    console.error('[analytics GET /leadership]', err);
    return E.serverError(res);
  }
});

module.exports = router;
