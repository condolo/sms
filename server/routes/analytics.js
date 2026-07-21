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
   ============================================================ */
const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel }    = require('../utils/tenant-model');
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('analytics');

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
    tenantModel('grades', { schoolId }).aggregate([
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
     days  — lookback window in days (7 | 30 | 90, default 30)
   ─────────────────────────────────────────────────────────── */
router.get('/leadership', authMiddleware, PLAN, rbac('analytics', 'read'), async (req, res) => {
  try {
    const rawDays = parseInt(req.query.days) || 30;
    const days    = [7, 30, 90].includes(rawDays) ? rawDays : 30;

    const snapshot = await _computeLeadershipSnapshot(req.jwtUser.schoolId, days);
    return ok(res, snapshot);
  } catch (err) {
    console.error('[analytics GET /leadership]', err);
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
router.get('/group', authMiddleware, PLAN, rbac('group_analytics', 'read'), async (req, res) => {
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

module.exports = router;
