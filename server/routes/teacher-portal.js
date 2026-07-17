/* ============================================================
   Msingi — Teacher Portal Routes
   All endpoints require JWT with role === 'teacher'.

   GET /api/teacher-portal/dashboard  — full Command Centre payload
   ============================================================ */
'use strict';

const express            = require('express');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }          = require('../utils/response');
const { resolveTeacher } = require('../utils/resolveTeacher');

const router    = express.Router();
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function _requireTeacher(req, res) {
  const role = req.jwtUser?.role;
  if (role !== 'teacher' && role !== 'staff') {
    E.forbidden(res, 'This endpoint is for teacher accounts only.');
    return false;
  }
  return true;
}

const _resolveTeacher = (userId, email, schoolId) =>
  resolveTeacher(userId, email, schoolId, 'firstName lastName title photo email');

/* ══════════════════════════════════════════════════════════════
   GET /api/teacher-portal/dashboard
   One-shot payload for the teacher Command Centre.
   ══════════════════════════════════════════════════════════════ */
router.get('/dashboard', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;

    const Teachers           = tenantModel('teachers', tenantContext(req));
    const TeachingAssignments = tenantModel('teaching_assignments', tenantContext(req));
    const Classes            = tenantModel('classes', tenantContext(req));
    const Students           = tenantModel('students', tenantContext(req));
    const Attendance         = tenantModel('attendance', tenantContext(req));
    const Timetable          = tenantModel('timetable_slots', tenantContext(req));
    const Subjects           = tenantModel('subjects', tenantContext(req));
    const Schools            = _model('schools');
    const Behaviour          = tenantModel('behaviour', tenantContext(req));
    const Exams              = tenantModel('exams', tenantContext(req));
    const Announcements      = tenantModel('announcements', tenantContext(req));
    const Events             = tenantModel('events', tenantContext(req));
    const Messages           = tenantModel('messages', tenantContext(req));
    const Coverage           = tenantModel('lesson_coverage', tenantContext(req));
    const Topics             = tenantModel('syllabus_topics', tenantContext(req));
    const FeeInvoices        = tenantModel('invoices', tenantContext(req));

    const todayISO  = new Date().toISOString().slice(0, 10);
    const todayDay  = DAY_NAMES[new Date().getDay()];

    // ── Teacher record — robust two-step lookup ──────────────
    // Tries userId field first, then resolves by email (same as /api/teachers/me).
    // If no staff directory record exists yet, returns a minimal shell so the
    // dashboard loads rather than crashing.
    const teacher = await _resolveTeacher(userId, req.jwtUser.email, schoolId);

    if (!teacher) {
      // No staff record at all — return minimal shell so the UI can inform
      // the teacher rather than showing a generic error card.
      const school = await Schools.findOne({ id: schoolId })
        .select('name academicYear').lean().catch(() => null);
      return ok(res, {
        teacher: {
          id: null,
          firstName: req.jwtUser.firstName || '',
          lastName:  req.jwtUser.lastName  || '',
          fullName:  req.jwtUser.email || 'Teacher',
          title: '', photo: null,
        },
        school:                { name: school?.name, academicYear: school?.academicYear || '', emergencyOnlineMode: false },
        _noStaffRecord:        true,
        timetableToday:        [],
        attendanceWidget:      [],
        pendingAttendanceCount: 0,
        todayLessonsCount:     0,
        unreadMessages:        0,
        myClasses:             [],
        formClassData:         null,
        atRiskStudents:        [],
        curriculumCoverage:    [],
        lessonPlans:           [],
        departments:           [],
        hr:                    { recentLeave: [], pendingLeaveCount: 0, latestPayroll: null },
        upcomingExams:         [],
        announcements:         [],
        events:                [],
      });
    }

    const teacherId = teacher.id;

    // ── School ───────────────────────────────────────────────
    const school = await Schools.findOne({ id: schoolId })
      .select('name academicYear termsPerYear emergencyOnlineMode')
      .lean();
    const academicYear = school?.academicYear || '';

    // ── Teaching assignments (classIds + subjectIds) ─────────
    const assignments = await TeachingAssignments.find({ teacherId, schoolId })
      .select('classId subjectId').lean();

    const classIds   = [...new Set(assignments.map(a => a.classId).filter(Boolean))];
    const subjectIds = [...new Set(assignments.map(a => a.subjectId).filter(Boolean))];

    // ── Today's timetable ────────────────────────────────────
    const timetableToday = await Timetable.find({
      schoolId,
      day: todayDay,
      $or: [{ teacherId }, { teacherId: userId }],
    }).sort({ startTime: 1 })
      .select('subjectName className classId startTime endTime room teacherName')
      .lean();

    // Classes that appear in today's timetable
    const todayClassIds = [...new Set(timetableToday.map(s => s.classId).filter(Boolean))];

    // ── Which timetable classes have attendance today ─────────
    const todayAttClassIds = classIds.length
      ? await Attendance.distinct('classId', {
          schoolId,
          date: todayISO,
          classId: { $in: todayClassIds.length ? todayClassIds : classIds },
        }).catch(() => [])
      : [];

    const attendanceStatus = timetableToday.map(slot => ({
      classId:   slot.classId,
      className: slot.className,
      submitted: todayAttClassIds.includes(slot.classId),
    }));
    // Deduplicate by classId
    const attStatusMap = {};
    for (const s of attendanceStatus) {
      attStatusMap[s.classId] = s;
    }
    const attendanceWidget = Object.values(attStatusMap);
    const pendingCount     = attendanceWidget.filter(s => !s.submitted).length;

    // ── Classes info ─────────────────────────────────────────
    const [classDocs, subjectDocs] = await Promise.all([
      classIds.length ? Classes.find({ id: { $in: classIds }, schoolId })
        .select('id name formTeacherId studentCount').lean().catch(() => []) : [],
      subjectIds.length ? Subjects.find({ id: { $in: subjectIds }, schoolId })
        .select('id name code').lean().catch(() => []) : [],
    ]);
    const classMap   = Object.fromEntries(classDocs.map(c => [c.id, c]));
    const subjectMap = Object.fromEntries(subjectDocs.map(s => [s.id, s]));

    // Student counts and attendance % per class
    const myClasses = await Promise.all(classIds.map(async classId => {
      const cls = classMap[classId];
      if (!cls) return null;

      const [studentCount, attTotal, attPresent] = await Promise.all([
        Students.countDocuments({ schoolId, classId, status: 'active' }).catch(() => 0),
        Attendance.countDocuments({ schoolId, classId, academicYear }).catch(() => 0),
        Attendance.countDocuments({ schoolId, classId, academicYear, status: 'present' }).catch(() => 0),
      ]);

      const attPct = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;

      // Subject(s) this teacher teaches in this class
      const classSubjectIds = assignments
        .filter(a => a.classId === classId)
        .map(a => a.subjectId);
      const classSubjects = classSubjectIds.map(sid => subjectMap[sid]?.name).filter(Boolean);

      return {
        id:           classId,
        name:         cls.name,
        studentCount,
        attendancePct: attPct,
        subjects:     classSubjects,
      };
    }));
    const myClassesList = myClasses.filter(Boolean);

    // ── Is this teacher a form/class teacher? ────────────────
    let formClass     = null;
    let formClassData = null;
    const formClassDoc = classDocs.find(c => c.formTeacherId === teacherId)
      || await Classes.findOne({ formTeacherId: teacherId, schoolId })
          .select('id name').lean().catch(() => null);

    if (formClassDoc) {
      formClass = formClassDoc;
      const fcClassId = formClassDoc.id;

      const [fcStudents, fcPresentToday, fcAbsentToday, fcBehaviourAlerts, fcFeeAlerts] =
        await Promise.all([
          Students.countDocuments({ schoolId, classId: fcClassId, status: 'active' }).catch(() => 0),
          Attendance.countDocuments({ schoolId, classId: fcClassId, date: todayISO, status: 'present' }).catch(() => 0),
          Attendance.countDocuments({ schoolId, classId: fcClassId, date: todayISO, status: 'absent' }).catch(() => 0),
          Behaviour.countDocuments({ schoolId, classId: fcClassId, points: { $lt: 0 } }).catch(() => 0),
          FeeInvoices.countDocuments({ schoolId, classId: fcClassId, balance: { $gt: 0 } }).catch(() => 0),
        ]);

      formClassData = {
        id:               fcClassId,
        name:             formClassDoc.name,
        totalStudents:    fcStudents,
        presentToday:     fcPresentToday,
        absentToday:      fcAbsentToday,
        behaviourAlerts:  fcBehaviourAlerts,
        feeAlerts:        fcFeeAlerts,
      };
    }

    // ── At-risk students (in teacher's classes) ──────────────
    // Students with 3+ absences this academic year in teacher's classes
    let atRiskStudents = [];
    if (classIds.length) {
      const absenceCounts = await Attendance.aggregate([
        { $match: { schoolId, classId: { $in: classIds }, academicYear, status: 'absent' } },
        { $group: { _id: '$studentId', absences: { $sum: 1 } } },
        { $match: { absences: { $gte: 3 } } },
        { $sort:  { absences: -1 } },
        { $limit: 8 },
      ]).catch(() => []);

      if (absenceCounts.length) {
        const riskIds = absenceCounts.map(r => r._id);
        const riskStudents = await Students.find({ id: { $in: riskIds }, schoolId })
          .select('id firstName lastName classId className admissionNumber').lean().catch(() => []);
        const riskMap = Object.fromEntries(riskStudents.map(s => [s.id, s]));

        atRiskStudents = absenceCounts.map(r => {
          const s = riskMap[r._id];
          if (!s) return null;
          return {
            id:        s.id,
            name:      `${s.firstName} ${s.lastName}`,
            className: s.className || classMap[s.classId]?.name,
            absences:  r.absences,
            reason:    'attendance',
          };
        }).filter(Boolean);
      }

      // Also add students with recent negative behaviour in teacher's classes
      const negBehaviour = await Behaviour.aggregate([
        { $match: { schoolId, classId: { $in: classIds }, points: { $lt: 0 } } },
        { $group: { _id: '$studentId', incidents: { $sum: 1 } } },
        { $match: { incidents: { $gte: 2 } } },
        { $sort:  { incidents: -1 } },
        { $limit: 5 },
      ]).catch(() => []);

      if (negBehaviour.length) {
        const behIds = negBehaviour.map(r => r._id).filter(id => !atRiskStudents.some(s => s.id === id));
        if (behIds.length) {
          const behStudents = await Students.find({ id: { $in: behIds }, schoolId })
            .select('id firstName lastName classId className').lean().catch(() => []);
          const behMap = Object.fromEntries(behStudents.map(s => [s.id, s]));
          for (const r of negBehaviour) {
            const s = behMap[r._id];
            if (!s) continue;
            atRiskStudents.push({
              id:        s.id,
              name:      `${s.firstName} ${s.lastName}`,
              className: s.className || classMap[s.classId]?.name,
              incidents: r.incidents,
              reason:    'behaviour',
            });
          }
        }
      }
    }

    // ── Curriculum coverage (per assignment, capped at 10) ────
    let curriculumCoverage = [];
    const topAssignments = assignments.slice(0, 10);
    if (topAssignments.length) {
      curriculumCoverage = await Promise.all(topAssignments.map(async a => {
        const [total, covered] = await Promise.all([
          Topics.countDocuments({ schoolId, subjectId: a.subjectId, academicYear }).catch(() => 0),
          Coverage.countDocuments({ schoolId, classId: a.classId, subjectId: a.subjectId, academicYear, covered: true }).catch(() => 0),
        ]);
        if (total === 0) return null;
        return {
          classId:     a.classId,
          className:   classMap[a.classId]?.name,
          subjectId:   a.subjectId,
          subjectName: subjectMap[a.subjectId]?.name,
          total,
          covered,
          pct:         Math.round((covered / total) * 100),
        };
      }));
      curriculumCoverage = curriculumCoverage.filter(Boolean);
    }

    // ── Departments for this teacher ─────────────────────────
    let departments = [];
    if (subjectIds.length) {
      const Departments = tenantModel('departments', tenantContext(req));
      const subDepts = await Subjects.find({ id: { $in: subjectIds }, schoolId })
        .select('id departmentId').lean().catch(() => []);
      const deptIds = [...new Set(subDepts.map(s => s.departmentId).filter(Boolean))];
      if (deptIds.length) {
        const deptDocs = await Departments.find({ id: { $in: deptIds }, schoolId, isActive: { $ne: false } })
          .select('id name code color hodId hodName').lean().catch(() => []);
        departments = deptDocs.map(d => ({
          id:       d.id,
          name:     d.name,
          code:     d.code,
          color:    d.color || '#6366f1',
          hodName:  d.hodName || null,
          isHod:    d.hodId === teacherId,
        }));
      }
    }

    // ── Lesson plans (today + next 7 days) ───────────────────
    const weekAheadISO = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const LessonPlans  = tenantModel('lesson_plans', tenantContext(req));
    const lessonPlans  = await LessonPlans.find({
      schoolId,
      teacherId,
      date: { $gte: todayISO, $lte: weekAheadISO },
      status: { $ne: 'delivered' },
    }).sort({ date: 1, startTime: 1 }).limit(10)
      .select('id classId className subjectId subjectName topicTitle date startTime objectives status')
      .lean().catch(() => []);

    // ── HR: leave + payroll ───────────────────────────────────
    const LeaveRequests = tenantModel('leave_requests', tenantContext(req));
    const Payroll       = tenantModel('payroll', tenantContext(req));

    const [recentLeave, latestPayroll] = await Promise.all([
      LeaveRequests.find({ schoolId, staffId: teacherId })
        .sort({ createdAt: -1 }).limit(3)
        .select('id type startDate endDate days status createdAt').lean()
        .catch(() => []),
      Payroll.findOne({ schoolId, staffId: teacherId })
        .sort({ payPeriod: -1 })
        .select('payPeriod netSalary basicSalary status').lean()
        .catch(() => null),
    ]);

    const pendingLeaveCount = recentLeave.filter(l => l.status === 'pending').length;

    // ── Parallel: exams, messages, announcements, events ─────
    const [upcomingExams, unreadMessages, announcements, events] = await Promise.all([
      classIds.length
        ? Exams.find({ schoolId, classId: { $in: classIds }, date: { $gte: todayISO } })
            .sort({ date: 1 }).limit(5)
            .select('subjectName className classId date startTime type').lean()
            .catch(() => [])
        : [],
      Messages.countDocuments({ schoolId, recipientId: userId, readAt: null }).catch(() => 0),
      Announcements.find({
        schoolId,
        $or: [{ expiresAt: { $gte: new Date() } }, { expiresAt: { $exists: false } }, { expiresAt: null }],
      }).sort({ createdAt: -1 }).limit(3)
        .select('title body createdAt priority').lean().catch(() => []),
      Events.find({ schoolId, date: { $gte: todayISO } })
        .sort({ date: 1 }).limit(5)
        .select('title date category').lean().catch(() => []),
    ]);

    return ok(res, {
      teacher: {
        id:          teacherId,
        firstName:   teacher.firstName,
        lastName:    teacher.lastName,
        title:       teacher.title || '',
        fullName:    `${teacher.title ? teacher.title + ' ' : ''}${teacher.firstName} ${teacher.lastName}`.trim(),
        photo:       teacher.photo || null,
      },
      school: {
        name:               school?.name,
        academicYear,
        emergencyOnlineMode: !!(school?.emergencyOnlineMode),
      },
      timetableToday,
      attendanceWidget,
      pendingAttendanceCount: pendingCount,
      todayLessonsCount:      timetableToday.length,
      unreadMessages,
      myClasses:             myClassesList,
      formClassData,
      atRiskStudents,
      curriculumCoverage,
      lessonPlans,
      departments,
      hr: {
        recentLeave,
        pendingLeaveCount,
        latestPayroll,
      },
      upcomingExams,
      announcements,
      events,
    });
  } catch (err) {
    console.error('[teacher-portal GET /dashboard]', err);
    return E.serverError(res);
  }
});

module.exports = router;
