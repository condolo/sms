/* ============================================================
   Msingi — Parent Portal Routes
   All endpoints require JWT with role === 'parent'.
   Parents are linked to one or more children via studentIds[].

   GET /api/parent-portal/children          — list of parent's children
   GET /api/parent-portal/dashboard/:childId — full dashboard for one child
   ============================================================ */
'use strict';

const express            = require('express');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();

function _requireParent(req, res) {
  const role = req.jwtUser?.role;
  if (role !== 'parent' && role !== 'guardian') {
    E.forbidden(res, 'This endpoint is for parent accounts only.');
    return false;
  }
  return true;
}

/* ══════════════════════════════════════════════════════════════
   GET /api/parent-portal/children
   List all children linked to this parent account.
   ══════════════════════════════════════════════════════════════ */
router.get('/children', authMiddleware, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, studentIds = [], guardianOf = [] } = req.jwtUser;
    const ids = [...new Set([...studentIds, ...guardianOf])];

    const Students = _model('students');
    const children = await Students.find({ id: { $in: ids }, schoolId })
      .select('id firstName lastName admissionNumber classId className photo status')
      .lean();

    return ok(res, children.map(c => ({
      id:              c.id,
      name:            `${c.firstName} ${c.lastName}`,
      admissionNumber: c.admissionNumber,
      classId:         c.classId,
      className:       c.className,
      photo:           c.photo || null,
      status:          c.status || 'active',
    })));
  } catch (err) {
    console.error('[parent-portal GET /children]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/parent-portal/dashboard/:childId
   Full dashboard payload for one child.
   Parent must be linked to that childId.
   ══════════════════════════════════════════════════════════════ */
router.get('/dashboard/:childId', authMiddleware, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, studentIds = [], guardianOf = [] } = req.jwtUser;
    const childId = req.params.childId;
    const linkedIds = [...new Set([...studentIds, ...guardianOf])];

    if (!linkedIds.includes(childId)) {
      return E.forbidden(res, 'You do not have access to this student\'s records.');
    }

    const Students    = _model('students');
    const Attendance  = _model('attendance_records');
    const FeeInvoices = _model('fee_invoices');
    const FeePayments = _model('fee_payments');
    const Reports     = _model('report_cards');
    const Coverage    = _model('lesson_coverage');
    const Topics      = _model('syllabus_topics');
    const Subjects    = _model('subjects');
    const Schools     = _model('schools');

    const student = await Students.findOne({ id: childId, schoolId })
      .select('firstName lastName admissionNumber classId className photo status dateOfBirth gender')
      .lean();
    if (!student) return E.notFound(res, 'Student record not found.');

    const school       = await Schools.findOne({ id: schoolId }).select('academicYear name').lean();
    const academicYear = school?.academicYear || '';

    // ── Attendance ───────────────────────────────────────────
    const attRecords = await Attendance.find({ schoolId, studentId: childId, academicYear })
      .select('status date').lean();
    const attSummary = { present: 0, absent: 0, late: 0, total: attRecords.length };
    attRecords.forEach(r => {
      if (r.status === 'present') attSummary.present++;
      else if (r.status === 'absent') attSummary.absent++;
      else if (r.status === 'late') attSummary.late++;
    });
    attSummary.percentage = attSummary.total
      ? Math.round((attSummary.present / attSummary.total) * 100) : 0;

    // Last 5 attendance records for the parent
    const recentAttendance = attRecords
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
      .map(r => ({ date: r.date, status: r.status }));

    // ── Fee balance & recent payments ────────────────────────
    const invoices = await FeeInvoices.find({ schoolId, studentId: childId }).select('totalAmount paidAmount dueDate termNumber').lean();
    const feeBalance = invoices.reduce((acc, inv) => acc + ((inv.totalAmount || 0) - (inv.paidAmount || 0)), 0);

    const recentPayments = await FeePayments.find({ schoolId, studentId: childId })
      .sort({ paidAt: -1 }).limit(5)
      .select('amount paidAt mpesaCode method reference')
      .lean();

    // ── Lessons coverage ─────────────────────────────────────
    let lessonsCoverage = [];
    if (student.classId) {
      const subjectIds  = await Coverage.distinct('subjectId', { schoolId, classId: student.classId, academicYear });
      const subjectDocs = await Subjects.find({ id: { $in: subjectIds }, schoolId }).select('id name code').lean();
      const subjectMap  = Object.fromEntries(subjectDocs.map(s => [s.id, s]));

      for (const subjectId of subjectIds) {
        const totalTopics   = await Topics.countDocuments({ schoolId, subjectId, academicYear });
        const coveredTopics = await Coverage.countDocuments({ schoolId, classId: student.classId, subjectId, academicYear, covered: true });
        if (totalTopics === 0) continue;
        lessonsCoverage.push({
          subjectId,
          subjectName:  subjectMap[subjectId]?.name || subjectId,
          subjectCode:  subjectMap[subjectId]?.code || '',
          coveredTopics,
          totalTopics,
          percentage: Math.round((coveredTopics / totalTopics) * 100),
        });
      }
    }

    // ── Published report cards ───────────────────────────────
    const reportCards = await Reports.find({ schoolId, studentId: childId, status: 'published' })
      .sort({ academicYear: -1, termNumber: -1 }).limit(6)
      .select('academicYear termNumber totalMarks grade rank status publishedAt')
      .lean();

    return ok(res, {
      child: {
        id:              childId,
        name:            `${student.firstName} ${student.lastName}`,
        admissionNumber: student.admissionNumber,
        classId:         student.classId,
        className:       student.className,
        photo:           student.photo || null,
        gender:          student.gender,
        status:          student.status,
      },
      school:           { name: school?.name, academicYear },
      attendance:       attSummary,
      recentAttendance,
      feeBalance,
      recentPayments,
      lessonsCoverage,
      reportCards,
    });
  } catch (err) {
    console.error('[parent-portal GET /dashboard/:childId]', err);
    return E.serverError(res);
  }
});

module.exports = router;
