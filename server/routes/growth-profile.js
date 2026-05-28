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
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('growth_profile');

/* ── GET /api/growth-profile/:studentId ────────────────────── */
router.get('/:studentId', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId } = req.params;

    // Verify student exists and belongs to this school
    const student = await _model('students').findOne({ id: studentId, schoolId })
      .select('id firstName lastName admissionNumber classId className sectionKey photo status')
      .lean();
    if (!student) return E.notFound(res, 'Student not found');

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
      _model('growth_leadership').countDocuments({ schoolId, studentId }),
      _model('growth_activities').countDocuments({ schoolId, studentId }),
      _model('growth_projects').countDocuments({ schoolId, studentId }),
      _model('growth_service').countDocuments({ schoolId, studentId }),
      _model('growth_awards').countDocuments({ schoolId, studentId }),
      _model('growth_recommendations').countDocuments({ schoolId, studentId }),
      _model('growth_aspirations').findOne({ schoolId, studentId }).select('careerInterests universityAspirations').lean(),
    ]);

    // Verified counts
    const [
      leadershipVerified,
      activitiesVerified,
      projectsVerified,
      serviceVerified,
      awardsVerified,
    ] = await Promise.all([
      _model('growth_leadership').countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      _model('growth_activities').countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      _model('growth_projects').countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      _model('growth_service').countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
      _model('growth_awards').countDocuments({ schoolId, studentId, verificationStatus: { $in: ['institution_verified','staff_verified'] } }),
    ]);

    const totalEntries  = leadershipCount + activitiesCount + projectsCount + serviceCount + awardsCount;
    const totalVerified = leadershipVerified + activitiesVerified + projectsVerified + serviceVerified + awardsVerified;

    return ok(res, {
      student,
      sections: {
        academic:        { count: 0, label: 'Academic'        },   // populated via /academic sub-route
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
router.get('/:studentId/academic', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId } = req.params;

    // Verify student
    const student = await _model('students').findOne({ id: studentId, schoolId }).select('id firstName lastName classId className').lean();
    if (!student) return E.notFound(res, 'Student not found');

    // Parallel fetch from existing collections — read-only aggregation
    const [gradesAgg, attendanceAgg, recentReports] = await Promise.all([
      // Grades: weighted average per subject (mirrors /api/grades/report logic)
      _model('grades').aggregate([
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
      _model('attendance').aggregate([
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
      _model('report_card_snapshots').find({
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

    // Overall grade average across all subjects
    const overallAverage = gradesAgg.length
      ? Math.round(gradesAgg.reduce((s, r) => s + (r.weightedAverage ?? 0), 0) / gradesAgg.length * 10) / 10
      : null;

    return ok(res, {
      student,
      grades: {
        subjects:       gradesAgg.map(r => ({
          subjectId:       r._id,
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

module.exports = router;
