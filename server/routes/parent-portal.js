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
const { tenantModel, tenantContext } = require('../utils/tenant-model');
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
   GET /api/parent-portal/family-summary
   Aggregate totals across ALL linked children — one call for the
   family hero strip (total balance, today's attendance, messages).
   ══════════════════════════════════════════════════════════════ */
router.get('/family-summary', authMiddleware, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, studentIds = [], guardianOf = [], userId } = req.jwtUser;
    const ids     = [...new Set([...studentIds, ...guardianOf])];
    const todayISO = new Date().toISOString().slice(0, 10);

    if (ids.length === 0) {
      return ok(res, { childrenCount: 0, totalBalance: 0, presentToday: 0, upcomingEvents: 0, unreadMessages: 0 });
    }

    const FeeInvoices = tenantModel('invoices', tenantContext(req));
    const Attendance  = tenantModel('attendance', tenantContext(req));
    const Messages    = tenantModel('messages', tenantContext(req));
    const Events      = tenantModel('events', tenantContext(req));

    const [invoices, todayAtt, unreadMsgs, eventCount] = await Promise.all([
      FeeInvoices.find({ schoolId, studentId: { $in: ids }, balance: { $gt: 0 } })
        .select('studentId balance').lean().catch(() => []),
      Attendance.find({ schoolId, studentId: { $in: ids }, date: todayISO })
        .select('studentId status').lean().catch(() => []),
      Messages.countDocuments({ schoolId, recipientId: userId, readAt: null }).catch(() => 0),
      Events.countDocuments({ schoolId, date: { $gte: todayISO } }).catch(() => 0),
    ]);

    const totalBalance = invoices.reduce((sum, inv) => sum + (inv.balance || 0), 0);
    const attByChild   = {};
    for (const r of todayAtt) attByChild[r.studentId] = r.status;
    const presentToday = Object.values(attByChild).filter(s => s === 'present').length;

    return ok(res, {
      childrenCount:  ids.length,
      totalBalance,
      presentToday,
      upcomingEvents: eventCount,
      unreadMessages: unreadMsgs,
    });
  } catch (err) {
    console.error('[parent-portal GET /family-summary]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/parent-portal/children
   List all children linked to this parent account.
   ══════════════════════════════════════════════════════════════ */
router.get('/children', authMiddleware, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, studentIds = [], guardianOf = [] } = req.jwtUser;
    const ids = [...new Set([...studentIds, ...guardianOf])];

    const Students = tenantModel('students', tenantContext(req));
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

    const Students      = tenantModel('students', tenantContext(req));
    const Attendance    = tenantModel('attendance', tenantContext(req));
    const FeeInvoices   = tenantModel('invoices', tenantContext(req));
    const FeePayments   = tenantModel('payments', tenantContext(req));
    const Reports       = tenantModel('report_card_snapshots', tenantContext(req));
    const Coverage      = tenantModel('lesson_coverage', tenantContext(req));
    const Topics        = tenantModel('syllabus_topics', tenantContext(req));
    const Subjects      = tenantModel('subjects', tenantContext(req));
    const Schools       = _model('schools');
    const Behaviour     = tenantModel('behaviour', tenantContext(req));
    const Exams         = tenantModel('exams', tenantContext(req));
    const Announcements = tenantModel('announcements', tenantContext(req));
    const Events        = tenantModel('events', tenantContext(req));
    const Classes       = tenantModel('classes', tenantContext(req));
    const Teachers      = tenantModel('teachers', tenantContext(req));
    const Timetable     = tenantModel('timetable_slots', tenantContext(req));

    const todayISO = new Date().toISOString().slice(0, 10);
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const todayDay  = DAY_NAMES[new Date().getDay()];

    const student = await Students.findOne({ id: childId, schoolId })
      .select('firstName lastName admissionNumber classId className photo status dateOfBirth gender')
      .lean();
    if (!student) return E.notFound(res, 'Student record not found.');

    const school       = await Schools.findOne({ id: schoolId }).select('academicYear name portalConfig').lean();
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

    // ── Fee balance, clearance & recent payments ─────────────
    const invoices     = await FeeInvoices.find({ schoolId, studentId: childId }).select('total balance status dueDate termId').lean();
    const feeBalance   = invoices.reduce((acc, inv) => acc + (inv.balance || 0), 0);
    const totalBilled  = invoices.reduce((acc, inv) => acc + (inv.total  || 0), 0);
    const feeClearancePct = totalBilled > 0
      ? Math.round(((totalBilled - feeBalance) / totalBilled) * 100)
      : 100;

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
    const reportCards = await Reports.find({
      schoolId, studentId: childId, status: 'published', superseded: { $ne: true },
    }).sort({ publishedAt: -1 }).limit(6)
      .select('academicYear termName termNumber totalScore averageScore gpa rankings status publishedAt version termId academicYearId')
      .lean();

    // ── Academic trend (chronological term averages) ─────────
    const academicTrend = [...reportCards]
      .sort((a, b) => {
        const ay = (s) => s.academicYear?.replace('/', '') ?? '0';
        if (ay(a) !== ay(b)) return ay(a).localeCompare(ay(b));
        return (a.termNumber ?? 0) - (b.termNumber ?? 0);
      })
      .map(rc => ({
        label:   `${rc.academicYear ?? ''} T${rc.termNumber ?? ''}`.trim(),
        average: rc.averageScore ?? null,
        gpa:     rc.gpa ?? null,
      }))
      .filter(t => t.average != null);

    // ── Extended data (parallel) ─────────────────────────────
    const [
      bRecords,
      upcomingExamsDocs,
      announcementsDocs,
      upcomingEventsDocs,
      classDoc,
      timetableSlots,
      nextDueInvoice,
    ] = await Promise.all([
      Behaviour.find({ schoolId, studentId: childId })
        .sort({ date: -1, createdAt: -1 }).limit(50)
        .select('points type category description date title').lean()
        .catch(() => []),
      student.classId
        ? Exams.find({ schoolId, classId: student.classId, date: { $gte: todayISO } })
            .sort({ date: 1 }).limit(4)
            .select('subjectName date startTime type').lean()
            .catch(() => [])
        : [],
      Announcements.find({
        schoolId,
        $or: [{ expiresAt: { $gte: new Date() } }, { expiresAt: { $exists: false } }, { expiresAt: null }],
      }).sort({ createdAt: -1 }).limit(3)
        .select('title body createdAt priority').lean()
        .catch(() => []),
      Events.find({ schoolId, date: { $gte: todayISO } })
        .sort({ date: 1 }).limit(4)
        .select('title date category').lean()
        .catch(() => []),
      student.classId
        ? Classes.findOne({ id: student.classId, schoolId })
            .select('formTeacherId name').lean().catch(() => null)
        : null,
      student.classId
        ? Timetable.find({ schoolId, classId: student.classId, day: todayDay })
            .sort({ startTime: 1 })
            .select('subjectName teacherName startTime endTime room').lean()
            .catch(() => [])
        : [],
      FeeInvoices.findOne({ schoolId, studentId: childId, balance: { $gt: 0 }, dueDate: { $gte: todayISO } })
        .sort({ dueDate: 1 }).select('dueDate').lean().catch(() => null),
    ]);

    // Behaviour summary
    const totalPoints   = bRecords.reduce((sum, r) => sum + (Number(r.points) || 0), 0);
    const latestReward  = bRecords.find(r => (Number(r.points) || 0) > 0) || null;
    const latestComment = bRecords[0] || null;
    const badgeLevel    = totalPoints >= 500 ? 'gold' : totalPoints >= 200 ? 'silver' : totalPoints >= 50 ? 'bronze' : null;

    // Class teacher name
    let classTeacher = null;
    if (classDoc?.formTeacherId) {
      const t = await Teachers.findOne({ id: classDoc.formTeacherId, schoolId })
        .select('firstName lastName title').lean().catch(() => null);
      if (t) classTeacher = `${t.title ? t.title + ' ' : ''}${t.firstName} ${t.lastName}`.trim();
    }

    return ok(res, {
      child: {
        id:              childId,
        name:            `${student.firstName} ${student.lastName}`,
        firstName:       student.firstName,
        admissionNumber: student.admissionNumber,
        classId:         student.classId,
        className:       student.className,
        photo:           student.photo || null,
        gender:          student.gender,
        status:          student.status,
      },
      school:             { name: school?.name, academicYear, portalConfig: school?.portalConfig || null },
      attendance:         attSummary,
      recentAttendance,
      feeBalance,
      feeClearancePct,
      nextFeeDueDate:     nextDueInvoice?.dueDate ?? null,
      recentPayments,
      lessonsCoverage,
      reportCards,
      academicTrend,
      classTeacher,
      timetableToday:     timetableSlots,
      behaviourSummary:   { totalPoints, badgeLevel, latestReward, latestComment },
      upcomingExams:      upcomingExamsDocs,
      announcements:      announcementsDocs,
      upcomingEvents:     upcomingEventsDocs,
    });
  } catch (err) {
    console.error('[parent-portal GET /dashboard/:childId]', err);
    return E.serverError(res);
  }
});

module.exports = router;
