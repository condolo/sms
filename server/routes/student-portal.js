/* ============================================================
   Msingi — Student Portal Routes
   All endpoints require JWT with role === 'student'.
   Data is always scoped to the student's own record (studentId from JWT).

   GET /api/student-portal/dashboard  — full dashboard payload
   GET /api/student-portal/me         — own profile + class
   ============================================================ */
'use strict';

const express            = require('express');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();

function _requireStudent(req, res) {
  const role = req.jwtUser?.role;
  if (role !== 'student') {
    E.forbidden(res, 'This endpoint is for student accounts only.');
    return false;
  }
  if (!req.jwtUser?.studentId) {
    E.forbidden(res, 'Student account is not linked to a student record.');
    return false;
  }
  return true;
}

/* ══════════════════════════════════════════════════════════════
   GET /api/student-portal/dashboard
   Returns everything the student dashboard needs in one request.
   ══════════════════════════════════════════════════════════════ */
router.get('/dashboard', authMiddleware, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, studentId } = req.jwtUser;

    const Students    = _model('students');
    const Attendance  = _model('attendance_records');
    const FeeInvoices = _model('fee_invoices');
    const FeePayments = _model('fee_payments');
    const Reports     = _model('report_cards');
    const Coverage    = _model('lesson_coverage');
    const Topics      = _model('syllabus_topics');
    const Timetable   = _model('timetable_slots');
    const Subjects    = _model('subjects');
    const Schools     = _model('schools');

    // ── Student record ───────────────────────────────────────
    const student = await Students.findOne({ id: studentId, schoolId })
      .select('firstName lastName admissionNumber classId className photo status dateOfBirth gender')
      .lean();
    if (!student) return E.notFound(res, 'Student record not found.');

    const school = await Schools.findOne({ id: schoolId })
      .select('academicYear termsPerYear name emergencyOnlineMode')
      .lean();

    const academicYear = school?.academicYear || '';

    // ── Attendance this term ─────────────────────────────────
    const attRecords = await Attendance.find({
      schoolId, studentId, academicYear,
    }).select('status').lean();

    const attSummary = { present: 0, absent: 0, late: 0, total: attRecords.length };
    attRecords.forEach(r => {
      if (r.status === 'present') attSummary.present++;
      else if (r.status === 'absent') attSummary.absent++;
      else if (r.status === 'late') attSummary.late++;
    });
    attSummary.percentage = attSummary.total
      ? Math.round((attSummary.present / attSummary.total) * 100)
      : 0;

    // ── Fee balance ──────────────────────────────────────────
    const invoices = await FeeInvoices.find({ schoolId, studentId }).select('totalAmount paidAmount').lean();
    const feeBalance = invoices.reduce((acc, inv) => {
      return acc + ((inv.totalAmount || 0) - (inv.paidAmount || 0));
    }, 0);

    // ── Lessons / curriculum coverage ────────────────────────
    let lessonsCoverage = [];
    if (student.classId) {
      const subjectIds = await Coverage.distinct('subjectId', { schoolId, classId: student.classId, academicYear });
      const subjectDocs = await Subjects.find({ id: { $in: subjectIds }, schoolId }).select('id name code').lean();
      const subjectMap  = Object.fromEntries(subjectDocs.map(s => [s.id, s]));

      for (const subjectId of subjectIds) {
        const totalTopics   = await Topics.countDocuments({ schoolId, subjectId, academicYear });
        const coveredTopics = await Coverage.countDocuments({ schoolId, classId: student.classId, subjectId, academicYear, covered: true });
        if (totalTopics === 0) continue;
        lessonsCoverage.push({
          subjectId,
          subjectName: subjectMap[subjectId]?.name || subjectId,
          subjectCode: subjectMap[subjectId]?.code || '',
          coveredTopics,
          totalTopics,
          percentage: Math.round((coveredTopics / totalTopics) * 100),
        });
      }
    }

    // ── Today's timetable ────────────────────────────────────
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const today = DAY_NAMES[new Date().getDay()];

    let rawSlots = student.classId
      ? await Timetable.find({ schoolId, classId: student.classId, day: today })
          .sort({ startTime: 1 })
          .select('subjectId subjectName teacherName teacherId startTime endTime room day')
          .lean()
      : [];

    // When Emergency Online Learning Mode is active, attach meeting link to each slot
    // so students see a "Join" button with the correct teacher's link.
    const emergencyMode = !!(school?.emergencyOnlineMode);
    let timetableToday = rawSlots;

    if (emergencyMode && rawSlots.length > 0) {
      // Collect unique teacherIds present in today's slots
      const teacherIds = [...new Set(rawSlots.map(s => s.teacherId).filter(Boolean))];
      if (teacherIds.length > 0) {
        const Teachers = _model('teachers');
        const teacherDocs = await Teachers.find({ schoolId, id: { $in: teacherIds } })
          .select('id zoomPMILink zoomPasscode meetLink')
          .lean();
        const teacherMap = Object.fromEntries(teacherDocs.map(t => [t.id, t]));

        timetableToday = rawSlots.map(slot => {
          if (!slot.teacherId) return slot;
          const teacher = teacherMap[slot.teacherId];
          if (!teacher) return slot;
          // Prefer Zoom PMI, fall back to Meet link
          const meetingLink     = teacher.zoomPMILink || teacher.meetLink || null;
          const meetingPasscode = teacher.zoomPMILink ? (teacher.zoomPasscode || null) : null;
          const platform        = teacher.zoomPMILink ? 'zoom' : teacher.meetLink ? 'meet' : null;
          if (!meetingLink) return slot;
          return { ...slot, meetingLink, meetingPasscode, platform };
        });
      }
    }

    // ── Published report cards ───────────────────────────────
    const reportCards = await Reports.find({
      schoolId, studentId, status: 'published',
    }).sort({ academicYear: -1, termNumber: -1 }).limit(6)
      .select('academicYear termNumber totalMarks grade rank status publishedAt')
      .lean();

    return ok(res, {
      student: {
        id:              studentId,
        name:            `${student.firstName} ${student.lastName}`,
        admissionNumber: student.admissionNumber,
        classId:         student.classId,
        className:       student.className,
        photo:           student.photo || null,
        gender:          student.gender,
      },
      school: { name: school?.name, academicYear, emergencyOnlineMode: emergencyMode },
      attendance:      attSummary,
      feeBalance,
      lessonsCoverage,
      timetableToday,
      reportCards,
    });
  } catch (err) {
    console.error('[student-portal GET /dashboard]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/student-portal/me  — own profile only
   ══════════════════════════════════════════════════════════════ */
router.get('/me', authMiddleware, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, studentId } = req.jwtUser;
    const Students = _model('students');
    const student  = await Students.findOne({ id: studentId, schoolId }).lean();
    if (!student) return E.notFound(res, 'Student record not found.');
    const { __v, _id, ...safe } = student;
    return ok(res, safe);
  } catch (err) {
    console.error('[student-portal GET /me]', err);
    return E.serverError(res);
  }
});

module.exports = router;
