/* ============================================================
   Msingi — /api/growth-profile/:studentId
   Aggregate endpoint — returns the full Growth Profile
   for a student in a single response:

     GET /:studentId          — full profile (meta + section counts)
     GET /:studentId/academic — academic data (grades, attendance,
                                published report cards)

   All data is READ-ONLY. This route never modifies academic
   records — it only reads from existing collections.

   Plan: standard | RBAC: growth_profile:read (+ grades:read for academic)
   ============================================================ */
const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { moduleGate }     = require('../middleware/module-gate');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }          = require('../utils/response');
const { forbiddenForSelfServiceRole } = require('../utils/self-service-scope');

const router = express.Router();
const PLAN    = planGate('growth_profile');
// Added alongside promoting this module to a real Sidebar entry (it now
// has a navRoute, so it's independently toggleable from Settings → Modules
// — every other toggleable module enforces its own off-state server-side
// via moduleGate; this file predates having a navRoute at all and was
// simply never wired into that pattern until now).
const MODGATE = moduleGate('growth_profile');

// Parent/student self-service scoping — extracted to utils/self-service-scope.js
// so this and any other aggregate endpoint (e.g. weekly-snapshots.js) share one
// implementation instead of risking two independent copies drifting apart.
const _forbiddenForSelfServiceRole = forbiddenForSelfServiceRole;

/* ── GET /api/growth-profile/:studentId ────────────────────── */
router.get('/:studentId', authMiddleware, PLAN, MODGATE, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId } = req.params;

    // Verify student exists and belongs to this school
    const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId })
      .select('id firstName lastName admissionNumber classId className sectionKey photo status')
      .lean();
    if (!student) return E.notFound(res, 'Student not found');
    if (_forbiddenForSelfServiceRole(req, student)) return E.forbidden(res, 'You can only view your own Growth Profile.');

    // Section counts — parallel fetch for performance
    const [
      leadershipCount,
      activitiesCount,
      projectsCount,
      serviceCount,
      awardsCount,
      recsCount,
      aspirations,
    ] = await Promise.all([
      tenantModel('growth_leadership', tenantContext(req)).countDocuments({ schoolId, studentId }),
      tenantModel('growth_activities', tenantContext(req)).countDocuments({ schoolId, studentId }),
      tenantModel('growth_projects', tenantContext(req)).countDocuments({ schoolId, studentId }),
      tenantModel('growth_service', tenantContext(req)).countDocuments({ schoolId, studentId }),
      tenantModel('growth_awards', tenantContext(req)).countDocuments({ schoolId, studentId }),
      tenantModel('growth_recommendations', tenantContext(req)).countDocuments({ schoolId, studentId }),
      tenantModel('growth_aspirations', tenantContext(req)).findOne({ schoolId, studentId }).select('careerInterests universityAspirations').lean(),
    ]);

    // Verified counts
    const [
      leadershipVerified,
      activitiesVerified,
      projectsVerified,
      serviceVerified,
      awardsVerified,
    ] = await Promise.all([
      tenantModel('growth_leadership', tenantContext(req)).countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      tenantModel('growth_activities', tenantContext(req)).countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      tenantModel('growth_projects', tenantContext(req)).countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      tenantModel('growth_service', tenantContext(req)).countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      tenantModel('growth_awards', tenantContext(req)).countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
    ]);

    const totalEntries  = leadershipCount + activitiesCount + projectsCount + serviceCount + awardsCount;
    const totalVerified = leadershipVerified + activitiesVerified + projectsVerified + serviceVerified + awardsVerified;

    return ok(res, {
      student,
      sections: {
        academic:        { count: 0, label: 'Academic'        },   // populated via /academic sub-route
        behaviour:       { count: 0, label: 'Behaviour'       },   // populated via /behaviour sub-route
        leadership:      { count: leadershipCount,  verified: leadershipVerified  },
        activities:      { count: activitiesCount,  verified: activitiesVerified  },
        projects:        { count: projectsCount,    verified: projectsVerified    },
        service:         { count: serviceCount,     verified: serviceVerified     },
        awards:          { count: awardsCount,       verified: awardsVerified      },
        recommendations: { count: recsCount  },
        aspirations:     { filled: !!(aspirations?.careerInterests?.length || aspirations?.personalStatement) },
      },
      summary: {
        totalEntries,
        totalVerified,
        completionPct: totalEntries > 0 ? Math.round((totalVerified / totalEntries) * 100) : 0,
        hasAspirations: !!(aspirations?.careerInterests?.length || aspirations?.personalStatement),
      },
    });
  } catch (err) { console.error('[growth-profile GET/:studentId]', err); return E.serverError(res); }
});

/* ── GET /api/growth-profile/:studentId/academic ───────────── */
// Reads from existing grades, attendance, and report-cards collections.
// NEVER writes to them.
router.get('/:studentId/academic', authMiddleware, PLAN, MODGATE, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId } = req.params;

    // Verify student
    const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId }).select('id firstName lastName classId className').lean();
    if (!student) return E.notFound(res, 'Student not found');
    if (_forbiddenForSelfServiceRole(req, student)) return E.forbidden(res, 'You can only view your own Growth Profile.');

    // Parallel fetch from existing collections — read-only aggregation
    const [gradesAgg, attendanceAgg, recentReports] = await Promise.all([
      // Grades: weighted average per subject (mirrors /api/grades/report logic)
      tenantModel('grades', tenantContext(req)).aggregate([
        { $match: { schoolId, studentId, isPublished: true } },
        {
          $group: {
            _id:             '$subjectId',
            weightedScoreSum: { $sum: { $multiply: [{ $divide: ['$score', { $max: ['$maxScore', 1] }] }, '$weight'] } },
            totalWeight:      { $sum: '$weight' },
            rawAvg:           { $avg: { $multiply: [{ $divide: ['$score', { $max: ['$maxScore', 1] }] }, 100] } },
            entries:          { $sum: 1 },
            latestDate:       { $max: '$date' },
          }
        },
        {
          $addFields: {
            weightedAverage: {
              $round: [{
                $cond: [
                  { $gt: ['$totalWeight', 0] },
                  { $multiply: [{ $divide: ['$weightedScoreSum', '$totalWeight'] }, 100] },
                  '$rawAvg'
                ]
              }, 1]
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]),

      // Attendance summary
      tenantModel('attendance', tenantContext(req)).aggregate([
        { $match: { schoolId, studentId } },
        {
          $group: {
            _id:        null,
            total:      { $sum: 1 },
            present:    { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
            absent:     { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
            late:       { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
            authorised: { $sum: { $cond: [{ $eq: ['$status', 'authorised_absence'] }, 1, 0] } },
          }
        },
        {
          $addFields: {
            attendanceRate: {
              $round: [{ $multiply: [{ $divide: ['$present', { $max: ['$total', 1] }] }, 100] }, 1]
            }
          }
        }
      ]),

      // Recent published report cards (latest 3, non-superseded)
      tenantModel('report_card_snapshots', tenantContext(req)).find({
        schoolId,
        studentId,
        superseded: { $ne: true },
        status:     'published',
      })
        .sort({ publishedAt: -1 })
        .limit(3)
        .select('id version classId className termId termName academicYearId academicYear totalScore averageScore gpa rankings publishedAt')
        .lean(),
    ]);

    const attendance = attendanceAgg[0] ?? null;

    // Batch-resolve subject names so the client never shows raw UUIDs
    const subjectIds  = gradesAgg.map(r => r._id).filter(Boolean);
    const subjectDocs = subjectIds.length
      ? await tenantModel('subjects', tenantContext(req)).find({ schoolId, id: { $in: subjectIds } }, { id: 1, name: 1, code: 1, _id: 0 }).lean()
      : [];
    const subjectMap = Object.fromEntries(subjectDocs.map(s => [s.id, s]));

    // Overall grade average across all subjects
    const overallAverage = gradesAgg.length
      ? Math.round(gradesAgg.reduce((s, r) => s + (r.weightedAverage ?? 0), 0) / gradesAgg.length * 10) / 10
      : null;

    return ok(res, {
      student,
      grades: {
        subjects: gradesAgg.map(r => ({
          subjectId:       r._id,
          subjectName:     subjectMap[r._id]?.name ?? r._id,   // human-readable name, never raw UUID
          subjectCode:     subjectMap[r._id]?.code ?? null,
          weightedAverage: r.weightedAverage,
          entries:         r.entries,
          latestDate:      r.latestDate,
        })),
        overallAverage,
        subjectCount: gradesAgg.length,
      },
      attendance: attendance ? {
        total:          attendance.total,
        present:        attendance.present,
        absent:         attendance.absent,
        late:           attendance.late,
        authorised:     attendance.authorised,
        attendanceRate: attendance.attendanceRate,
      } : null,
      reports: recentReports,
    });
  } catch (err) { console.error('[growth-profile GET/:studentId/academic]', err); return E.serverError(res); }
});

/* ── GET /api/growth-profile/:studentId/behaviour ──────────────
   The permanent behaviour record — grouped by academic year, reading
   ALL-TIME behaviour_incidents with no reset-window applied (unlike
   Behaviour's own /incidents/summary, which floors at the most recent
   points-reset). A yearly reset only moves the "current" window
   Behaviour itself shows; it never touches this collection, so every
   year's totals stay visible here permanently, per Governance Spec §2. */
router.get('/:studentId/behaviour', authMiddleware, PLAN, MODGATE, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId } = req.params;

    const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId })
      .select('id firstName lastName').lean();
    if (!student) return E.notFound(res, 'Student not found');
    if (_forbiddenForSelfServiceRole(req, student)) return E.forbidden(res, 'You can only view your own Growth Profile.');

    const [byYear, years] = await Promise.all([
      tenantModel('behaviour_incidents', tenantContext(req)).aggregate([
        { $match: { schoolId, studentId } },
        { $group: {
          _id:       '$academicYearId',
          merits:    { $sum: { $cond: [{ $eq: ['$type', 'merit'] }, 1, 0] } },
          demerits:  { $sum: { $cond: [{ $eq: ['$type', 'demerit'] }, 1, 0] } },
          points:    { $sum: '$points' },
          total:     { $sum: 1 },
          firstDate: { $min: '$date' },
          lastDate:  { $max: '$date' },
        }},
      ]),
      tenantModel('academic_years', tenantContext(req)).find({ schoolId }).select('id name').lean(),
    ]);

    const yearNameById = Object.fromEntries(years.map(y => [y.id, y.name]));
    const history = byYear
      .map(g => ({
        academicYearId:   g._id,
        academicYearName: g._id ? (yearNameById[g._id] ?? g._id) : 'Unassigned',
        merits: g.merits, demerits: g.demerits, points: g.points, total: g.total,
        firstDate: g.firstDate, lastDate: g.lastDate,
      }))
      .sort((a, b) => (a.firstDate || '').localeCompare(b.firstDate || ''));

    return ok(res, {
      student,
      history,
      allTime: {
        merits:   history.reduce((s, h) => s + h.merits, 0),
        demerits: history.reduce((s, h) => s + h.demerits, 0),
        points:   history.reduce((s, h) => s + h.points, 0),
        total:    history.reduce((s, h) => s + h.total, 0),
      },
    });
  } catch (err) { console.error('[growth-profile GET/:studentId/behaviour]', err); return E.serverError(res); }
});

module.exports = router;
