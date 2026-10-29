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
const { CURRENCY_SYMBOLS } = require('../middleware/tenant');
const { planGate }       = require('../middleware/plan');
/* One alphabet, one hash, one TTL — shared with the office console that
   issues the codes (see utils/link-codes.js for why). */
const {
  hashLinkCode: _hashLinkCode,
  normaliseLinkCode: _normaliseLinkCode,
} = require('../utils/link-codes');

/* Portal access is the tier boundary: student portals need 'student', parent
   portals need 'family'. Before this, the tiers existed only as prices — a
   Base school's parents and students could still log in. */
const PLAN = planGate('parent_portal');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { isTimetablePublished, publishedReader } = require('../utils/timetable-publish');
const { resolveCurrentPeriod } = require('./academic-config');
const { _getMpesaConfig } = require('./mpesa');
const { _inboxQuery } = require('./messages');
const { ok, created, E } = require('../utils/response');
const AuditService = require('../services/audit');
// Weekly Snapshot's read logic is shared with weekly-snapshots.js's own
// staff-facing routes — see that file's _findAuthorizedStudent header
// comment for why this isn't reimplemented here.
const { _helpers: weeklySnapshotHelpers } = require('./weekly-snapshots');
const { resolveMessageCategories, resolveOneCategory } = require('../utils/parent-message-recipients');
const { recipientSummary } = require('../utils/message-audience');
const { createDirectMessage } = require('./messages');

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
router.get('/family-summary', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, studentIds = [], guardianOf = [], userId, role } = req.jwtUser;
    const ids     = [...new Set([...studentIds, ...guardianOf])];
    const todayISO = new Date().toISOString().slice(0, 10);

    if (ids.length === 0) {
      return ok(res, { childrenCount: 0, totalBalance: 0, presentToday: 0, upcomingEvents: 0, unreadMessages: 0 });
    }

    const FeeInvoices = tenantModel('invoices', tenantContext(req));
    const Attendance  = tenantModel('attendance', tenantContext(req));
    const Messages    = tenantModel('messages', tenantContext(req));
    const Events      = tenantModel('events', tenantContext(req));

    // Same inbox-membership + unread definition the bell/Messages page
    // itself uses (messages.js's _inboxQuery + isRead.${userId}) — this
    // previously queried recipientId/readAt, fields the messages
    // collection has never actually had (real shape: `recipients` +
    // `isRead: {[userId]: true}`), so this count was always 0 regardless
    // of real unread messages, silently disagreeing with the bell's own
    // (correct) count.
    const [invoices, todayAtt, unreadMsgs, eventCount] = await Promise.all([
      FeeInvoices.find({ schoolId, studentId: { $in: ids }, balance: { $gt: 0 } })
        .select('studentId balance').lean().catch(() => []),
      Attendance.find({ schoolId, studentId: { $in: ids }, date: todayISO })
        .select('studentId status').lean().catch(() => []),
      Messages.countDocuments({
        ..._inboxQuery({ schoolId, userId, role }),
        [`isRead.${userId}`]: { $ne: true },
      }).catch(() => 0),
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
router.get('/children', authMiddleware, PLAN, async (req, res) => {
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
      // Split names as well as the joined one: the app renders a first name
      // in a chip and the pair in a header, and re-splitting "Mary Anne Wanjiru"
      // in the client gets it wrong for anyone whose surname is two words.
      firstName:       c.firstName,
      lastName:        c.lastName,
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
router.get('/dashboard/:childId', authMiddleware, PLAN, async (req, res) => {
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
    // behaviour_incidents, not the empty 'behaviour' — see student-portal.js.
    const Behaviour     = tenantModel('behaviour_incidents', tenantContext(req));
    const Exams         = tenantModel('exams', tenantContext(req));
    const Announcements = tenantModel('announcements', tenantContext(req));
    const Events        = tenantModel('events', tenantContext(req));
    const Streams       = tenantModel('streams', tenantContext(req));
    const Teachers      = tenantModel('teachers', tenantContext(req));
    // 'timetable' — NOT 'timetable_slots'. See student-portal.js's
    // identical fix for the full reasoning: these are genuinely different,
    // both-populated collections, and 'timetable_slots' is an orphaned
    // legacy one nothing writes to anymore.
    const Timetable     = await publishedReader(schoolId, tenantContext(req));
    const LibraryLoans  = tenantModel('library_loans', tenantContext(req));

    const todayISO = new Date().toISOString().slice(0, 10);
    // Lowercase — matches how timetable.js's own SlotSchema actually
    // stores `day` (confirmed against real data: a query for 'Monday'
    // matches 0 documents, 'monday' matches every one). A capitalized
    // array here silently broke "Today's Timetable" on this dashboard
    // for every parent, every day, since this route shipped.
    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const todayDay  = DAY_NAMES[new Date().getDay()];

    /* Three independent reads, ONE batch. They used to be three sequential
       awaits on the critical path of every parent dashboard load; only
       `student` is depended on by anything else here, and the year doc feeds
       the term/attendance filters resolved below. */
    const [student, school, academicYears] = await Promise.all([
      Students.findOne({ id: childId, schoolId })
        .select('firstName lastName admissionNumber classId className streamId photo status dateOfBirth gender')
        .lean(),
      // Live-resolved, not the schools.academicYear cached field — that
      // field is only ever written by academic-config.js's year-transition
      // endpoint as a backward-compat sync and goes stale the moment that
      // sync is skipped or a year's isCurrent flag changes any other way.
      // Same staleness class report-cards.js's _resolveTermScope was
      // written to fix; this dashboard had the old, unfixed version of it.
      Schools.findOne({ id: schoolId }).select('name portalConfig mpesa').lean(),
      tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean(),
    ]);
    if (!student) return E.notFound(res, 'Student record not found.');

    // This child's own stream's timetable slots, unioned with any genuine
    // whole-class slot (no streamId at all — e.g. Assembly). Without this,
    // a child in one stream had EVERY stream's lessons for their class
    // merged into "Today's Timetable" — not just a display quirk, a real
    // case of showing a parent the wrong stream's subject/teacher/room.
    const timetableStreamOr = student.streamId
      ? [{ streamId: student.streamId }, { streamId: { $exists: false } }]
      : [{ streamId: { $exists: false } }];

    const { year: currentYearDoc, term: currentTermDoc, termNumber: currentTermNumber } = resolveCurrentPeriod(academicYears);
    const academicYear = currentYearDoc?.name || '';
    const currentTerm  = currentTermDoc?.name || (currentTermNumber ? `Term ${currentTermNumber}` : '');
    const mpesaEnabled = !!_getMpesaConfig(school);

    // ── Attendance ───────────────────────────────────────────
    // Reported directly 2026-10-27, "is the parent portal live, pulling
    // data as required" — a real child with 18 real attendance records
    // this term showed 0 present/absent/late/total on this dashboard.
    // Root cause: `attendance` documents have no `academicYear` field at
    // all (confirmed directly against live data — every real record has
    // only date/classId/streamId/studentId/status, never academicYear),
    // so this filter matched zero documents, always, for every parent,
    // every child, every school, since this route shipped. Same class of
    // staleness the comment above this block already flags for the YEAR
    // resolution — just a field that was never populated in the first
    // place rather than one that goes stale. Scoped by the resolved
    // term's own date range instead (currentTermDoc.startDate/endDate),
    // the same boundary _resolveCurrentPeriod itself is built on; no
    // term resolved (school never configured academic years) falls back
    // to all-time rather than silently showing zero.
    const attDateFilter = currentTermDoc
      ? { date: { $gte: currentTermDoc.startDate, $lte: currentTermDoc.endDate } }
      : {};

    /* This child's OWN stream's coverage, unioned with any legacy/whole-class
       record — declared here because the batched read below needs it. */
    const coverageStreamOr = student.streamId
      ? [{ streamId: student.streamId }, { streamId: { $exists: false } }]
      : [{ streamId: { $exists: false } }];

    /* Five independent reads in ONE batch. Each of these used to be awaited on
       its own, one after another, so a parent waited out every round-trip in
       series before the page could render. Nothing here depends on anything
       else in the batch — the coverage subject list is the only derived input,
       and only the block below consumes it. */
    const [attRecords, invoices, recentPayments, reportCards, coverageSubjectIds] = await Promise.all([
      Attendance.find({ schoolId, studentId: childId, ...attDateFilter })
        .select('status date').lean(),
      FeeInvoices.find({ schoolId, studentId: childId })
        .select('total balance status dueDate termId').lean(),
      FeePayments.find({ schoolId, studentId: childId })
        .sort({ paidAt: -1 }).limit(5)
        .select('amount paidAt mpesaCode method reference').lean(),
      Reports.find({
        schoolId, studentId: childId, status: 'published', superseded: { $ne: true },
      }).sort({ publishedAt: -1 }).limit(6)
        .select('id academicYear termName termNumber totalScore averageScore gpa rankings status publishedAt version termId academicYearId subjects')
        .lean(),
      student.classId
        ? Coverage.distinct('subjectId', { schoolId, classId: student.classId, academicYear, $or: coverageStreamOr })
        : [],
    ]);

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
    const feeBalance   = invoices.reduce((acc, inv) => acc + (inv.balance || 0), 0);
    const totalBilled  = invoices.reduce((acc, inv) => acc + (inv.total  || 0), 0);
    const feeClearancePct = totalBilled > 0
      ? Math.round(((totalBilled - feeBalance) / totalBilled) * 100)
      : 100;

    // ── Lessons coverage ─────────────────────────────────────
    // A coverage record's mere EXISTENCE means "covered" — the previous
    // `covered: true` condition never matched any real document (see
    // lessons.js's POST /coverage), so this always showed 0% regardless
    // of real progress. coverageStreamOr: this child's OWN stream's coverage
    // UNION any legacy/whole-class record — see student-portal.js's
    // identical fix for the full reasoning.
    let lessonsCoverage = [];
    if (student.classId && coverageSubjectIds.length) {
      const subjectIds  = coverageSubjectIds;
      const subjectDocs = await Subjects.find({ id: { $in: subjectIds }, schoolId }).select('id name code').lean();
      const subjectMap  = Object.fromEntries(subjectDocs.map(s => [s.id, s]));

      // Class-scoped, same as lessons.js's _topicClassFilterPart (2026-09
      // fix): a pre-migration topic with no classId still counts for every
      // class, but a topic scoped to a DIFFERENT class must not inflate
      // this child's own class total.
      const topicClassOr = [{ classId: student.classId }, { classId: { $exists: false } }];

      /* Two grouped counts, not two queries PER SUBJECT. The loop this
         replaces issued countDocuments twice for every subject in the class
         and awaited each before starting the next: a 12-subject class meant
         24 sequential round-trips on EVERY parent dashboard load, all of it
         latency the parent waits through. Grouping server-side makes it two,
         run together. (Same fix belongs in student-portal.js, which carries
         the identical loop.) */
      const [topicCounts, coverageCounts] = await Promise.all([
        Topics.aggregate([
          { $match: { academicYear, $or: topicClassOr } },
          { $group: { _id: '$subjectId', n: { $sum: 1 } } },
        ]),
        Coverage.aggregate([
          { $match: { classId: student.classId, academicYear, $or: coverageStreamOr } },
          { $group: { _id: '$subjectId', n: { $sum: 1 } } },
        ]),
      ]);
      const totalTopicsBySubject    = Object.fromEntries(topicCounts.map(r => [r._id, r.n]));
      const coveredTopicsBySubject  = Object.fromEntries(coverageCounts.map(r => [r._id, r.n]));

      for (const subjectId of subjectIds) {
        const totalTopics   = totalTopicsBySubject[subjectId] || 0;
        if (totalTopics === 0) continue;
        const coveredTopics = coveredTopicsBySubject[subjectId] || 0;
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
    // (fetched in the batch above — reportCards)

    // ── Real per-subject marks — the one place this dashboard can show an
    // actual mark, since family roles have no access to the live Markbook
    // at all (see server/utils/repairPermissions.js — student/parent carry
    // no grades/assessment grant). Sourced only from the most recently
    // published report card's own subjects snapshot, never provisional
    // assessment_marks data. Was previously conflated with lessonsCoverage
    // below (curriculum coverage percentage mislabeled as "Grades"/"My
    // Average") — this is the real thing.
    const latestSubjects  = reportCards[0]?.subjects || {};
    const markSubjectIds  = Object.keys(latestSubjects);
    const markSubjectDocs = markSubjectIds.length
      ? await Subjects.find({ id: { $in: markSubjectIds }, schoolId }).select('id name').lean()
      : [];
    const markSubjectNameMap = Object.fromEntries(markSubjectDocs.map(s => [s.id, s.name]));
    const subjectMarks = markSubjectIds
      .map(subjectId => ({
        subjectId,
        subjectName: markSubjectNameMap[subjectId] || subjectId,
        finalScore:  latestSubjects[subjectId]?.finalScore ?? null,
        grade:       latestSubjects[subjectId]?.grade ?? null,
        // Homework / Assignment mark — the HW component of the SAME published
        // report-card snapshot (exactly the per-type column the report card
        // itself already prints). Reported directly: "assignments should be
        // included with their score." Never live Markbook data — this is the
        // vetted, published breakdown, so it adds no new visibility.
        assignmentScore: latestSubjects[subjectId]?.breakdown?.HW ?? null,
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
    // The per-type breakdown stays internal to this computation — the
    // report-card list itself only ever needed the summary fields.
    const reportCardsOut = reportCards.map(({ subjects, ...rc }) => rc);

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
      streamDoc,
      timetableSlots,
      nextDueInvoice,
      borrowedBooksDocs,
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
      // Form/assistant teacher lives on the STUDENT'S STREAM, not the class
      // (classes.formTeacherId is a legacy, never-written field — fixed
      // while adding assistant/co-homeroom support, 2026-10-29).
      student.streamId
        ? Streams.findOne({ id: student.streamId, schoolId })
            .select('formTeacherId assistantFormTeacherId name').lean().catch(() => null)
        : null,
      // Unpublished timetables are not shown to parents (see utils/timetable-publish.js).
      student.classId && (await isTimetablePublished(schoolId))
        ? Timetable.find({ schoolId, classId: student.classId, day: todayDay, isActive: true, $or: timetableStreamOr })
            .sort({ startTime: 1 })
            .select('subject teacherName startTime endTime room').lean()
            .then(rows => rows.map(s => ({ ...s, subjectName: s.subject }))) // alias — see student-portal.js
            .catch(() => [])
        : [],
      FeeInvoices.findOne({ schoolId, studentId: childId, balance: { $gt: 0 }, dueDate: { $gte: todayISO } })
        .sort({ dueDate: 1 }).select('dueDate').lean().catch(() => null),
      LibraryLoans.find({ schoolId, borrowerId: childId, status: { $in: ['active', 'overdue', 'lost'] } })
        .sort({ dueDate: 1 })
        .select('id bookId bookTitle status dueDate lostAt')
        .lean().catch(() => []),
    ]);

    // Behaviour summary
    const totalPoints   = bRecords.reduce((sum, r) => sum + (Number(r.points) || 0), 0);
    const latestReward  = bRecords.find(r => (Number(r.points) || 0) > 0) || null;
    const latestComment = bRecords[0] || null;
    const badgeLevel    = totalPoints >= 500 ? 'gold' : totalPoints >= 200 ? 'silver' : totalPoints >= 50 ? 'bronze' : null;

    // Class teacher name(s) — main + assistant/co-homeroom teacher
    let classTeacher = null;
    let assistantClassTeacher = null;
    const homeroomTeacherIds = [streamDoc?.formTeacherId, streamDoc?.assistantFormTeacherId].filter(Boolean);
    if (homeroomTeacherIds.length) {
      const ts = await Teachers.find({ id: { $in: homeroomTeacherIds }, schoolId })
        .select('id firstName lastName title').lean().catch(() => []);
      const nameById = Object.fromEntries(ts.map(t => [t.id, `${t.title ? t.title + ' ' : ''}${t.firstName} ${t.lastName}`.trim()]));
      classTeacher           = nameById[streamDoc?.formTeacherId] ?? null;
      assistantClassTeacher  = nameById[streamDoc?.assistantFormTeacherId] ?? null;
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
      school:             { name: school?.name, academicYear, currentTerm, portalConfig: school?.portalConfig || null, mpesaEnabled },
      attendance:         attSummary,
      recentAttendance,
      feeBalance,
      feeClearancePct,
      nextFeeDueDate:     nextDueInvoice?.dueDate ?? null,
      recentPayments,
      lessonsCoverage,
      subjectMarks,
      reportCards: reportCardsOut,
      academicTrend,
      classTeacher,
      assistantClassTeacher,
      timetableToday:     timetableSlots,
      behaviourSummary:   { totalPoints, badgeLevel, latestReward, latestComment },
      upcomingExams:      upcomingExamsDocs,
      announcements:      announcementsDocs,
      upcomingEvents:     upcomingEventsDocs,
      borrowedBooks:      borrowedBooksDocs,
    });
  } catch (err) {
    console.error('[parent-portal GET /dashboard/:childId]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   Weekly Student Snapshot — self-service, bypasses RBAC entirely
   (no rbac()/moduleGate/planGate anywhere in this file, matching
   every other route above). Ownership is enforced by the shared
   helper reading req.jwtUser.studentIds/guardianOf, same as every
   other child-scoped route in this file already checks manually.
   ══════════════════════════════════════════════════════════════ */
router.get('/weekly-snapshot/:childId/weeks', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const result = await weeklySnapshotHelpers.getWeeksForStudent(req, req.params.childId);
    if (result.error === 'not_found') return E.notFound(res, 'Student not found');
    if (result.error === 'forbidden') return E.forbidden(res, 'You do not have access to this student\'s records.');
    return ok(res, result);
  } catch (err) {
    console.error('[parent-portal GET /weekly-snapshot/:childId/weeks]', err);
    return E.serverError(res);
  }
});

router.get('/weekly-snapshot/:childId/:weekStart', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const result = await weeklySnapshotHelpers.getSnapshotDetail(req, req.params.childId, req.params.weekStart);
    if (result.error === 'not_found') return E.notFound(res, 'No snapshot generated for that week');
    if (result.error === 'forbidden') return E.forbidden(res, 'You do not have access to this student\'s records.');
    return ok(res, result);
  } catch (err) {
    console.error('[parent-portal GET /weekly-snapshot/:childId/:weekStart]', err);
    return E.serverError(res);
  }
});

router.get('/weekly-snapshot/:childId/:weekStart/pdf', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    await weeklySnapshotHelpers.streamSnapshotPdf(req, res, req.params.childId, req.params.weekStart);
  } catch (err) {
    console.error('[parent-portal GET /weekly-snapshot/:childId/:weekStart/pdf]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/parent-portal/message-recipients?childId=X
   Reported directly: "the parent cannot message the school, in the
   message, I need the parent can select whom they want to message,
   nurse, discipline, subject teachers etc but not fellow parents."
   See server/utils/parent-message-recipients.js for the full design —
   every category here is resolved from real assignment/role data, and
   deliberately never includes another parent, guardian, or student.
   ══════════════════════════════════════════════════════════════ */
router.get('/message-recipients', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { studentIds = [], guardianOf = [] } = req.jwtUser;
    const linkedIds = [...new Set([...studentIds, ...guardianOf])];
    const childId = req.query.childId;
    if (!childId || !linkedIds.includes(childId)) {
      return E.forbidden(res, 'You do not have access to this student\'s records.');
    }
    const categories = await resolveMessageCategories(req, childId);
    // Never leak internal recipient userIds to the client — the key is
    // enough to pick from, re-resolved server-side again on send.
    return ok(res, categories.map(c => ({ key: c.key, label: c.label })));
  } catch (err) {
    console.error('[parent-portal GET /message-recipients]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/parent-portal/messages
   Body: { childId, category, subject, body }
   `category` is NEVER trusted as a recipient — it's re-resolved here,
   server-side, from the same real data message-recipients above reads,
   to the actual current staff userId(s). A parent can never reach
   another parent, guardian, or student through this route — there is
   no code path here that can resolve to one.
   ══════════════════════════════════════════════════════════════ */
router.post('/messages', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, userId, studentIds = [], guardianOf = [] } = req.jwtUser;
    const linkedIds = [...new Set([...studentIds, ...guardianOf])];
    const { childId, category, subject, body } = req.body;

    if (!childId || !linkedIds.includes(childId)) {
      return E.forbidden(res, 'You do not have access to this student\'s records.');
    }
    if (!category || !subject?.trim() || !body?.trim()) {
      return E.badRequest(res, 'category, subject, and body are required');
    }

    const recipientUserIds = await resolveOneCategory(req, childId, category);
    if (!recipientUserIds || recipientUserIds.length === 0) {
      return E.badRequest(res, 'That recipient is no longer available — please pick another and try again.');
    }

    // Re-fetched, not trusted from the JWT — same convention messages.js's
    // own POST / uses, since a JWT's name can be stale.
    const senderUser = await tenantModel('users', tenantContext(req)).findOne({ id: userId, schoolId }).select('name email').lean();
    const msg = await createDirectMessage(req, {
      recipientUserIds,
      subject: subject.trim(),
      body: body.trim(),
      senderName: senderUser?.name || senderUser?.email || 'Parent',
      senderRole: 'parent',
    });
    return created(res, msg);
  } catch (err) {
    console.error('[parent-portal POST /messages]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Phase 1 mobile screens — the reads the app needs that the single fat
   dashboard payload deliberately does NOT carry.

   The dashboard is built for first paint: totals, the last five of
   everything, stop. Screens 5–13 each need a *history* — a month of
   attendance, every invoice, an invoice's receipts, the term's report,
   the whole notice board, a conversation. Bolting those onto the
   dashboard would have made every parent pay for data they are not
   looking at, on the connection where that hurts most.

   Two conventions, applied to all of them:
     - the same child-access rule as the dashboard (studentIds ∪ guardianOf,
       never a client-supplied id);
     - `ok(res, …)` envelopes and the same nulls-not-zeroes discipline, so
       a screen can tell "nothing recorded yet" from "genuinely zero".
   ══════════════════════════════════════════════════════════════════ */

function _linkedIds(req) {
  return [...new Set([...(req.jwtUser.studentIds || []), ...(req.jwtUser.guardianOf || [])])];
}

/** True (and answers) when this child is not this parent's — see the dashboard's identical guard. */
function _unlinked(req, res, childId) {
  if (_linkedIds(req).includes(childId)) return false;
  E.forbidden(res, 'You do not have access to this student\'s records.');
  return true;
}

/** Currency + symbol from one source of truth (middleware/tenant.js), never hard-coded per route. */
function _money(currency) {
  const code = String(currency || 'KES').toUpperCase();
  return { currency: code, currencySymbol: CURRENCY_SYMBOLS[code] || code };
}

/* ── Screen 5: one month of attendance ─────────────────────────── */

router.get('/attendance/:childId', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;
    const childId = req.params.childId;
    if (_unlinked(req, res, childId)) return;

    // Validated before it reaches a date filter — this is the only input.
    const rawMonth = String(req.query.month || '');
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : new Date().toISOString().slice(0, 7);
    const [year, mon] = month.split('-').map(Number);
    const firstDay = `${month}-01`;
    const lastDay  = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10); // day 0 of next month

    // `$or` covers both storages of `date` (ISO string, as the bulk marker
    // writes it, and a real Date from older imports) without guessing which
    // this school has — guessing is what silently blanked a parent calendar.
    const Attendance = tenantModel('attendance', tenantContext(req));
    const records = await Attendance.find({
      schoolId,
      studentId: childId,
      $or: [
        { date: { $gte: firstDay, $lte: lastDay } },
        { date: { $gte: new Date(`${firstDay}T00:00:00.000Z`), $lte: new Date(`${lastDay}T23:59:59.999Z`) } },
      ],
    }).select('date status note period').sort({ date: 1 }).lean();

    // A day can hold several records (per period/subject). The calendar shows
    // ONE tint per day, so the day resolves to its worst status: a child who
    // was absent for first period did not "attend" that day.
    const WEIGHT = { absent: 3, late: 2, present: 1 };
    const byDay = new Map();
    for (const r of records) {
      const day = String(r.date).slice(0, 10);
      const held = byDay.get(day);
      if (!held || (WEIGHT[r.status] ?? 0) > (WEIGHT[held.status] ?? 0)) byDay.set(day, r);
    }

    const days = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, r]) => ({ date, status: r.status }));

    const summary = { present: 0, absent: 0, late: 0, total: days.length };
    for (const d of days) if (summary[d.status] !== undefined) summary[d.status] += 1;
    summary.percentage = summary.total ? Math.round((summary.present / summary.total) * 100) : 0;

    return ok(res, {
      month,
      summary,
      days,
      // The board asks for the recent exceptions *with their notes* — the
      // reason is the part a parent actually wants.
      exceptions: [...byDay.entries()]
        .filter(([, r]) => r.status === 'absent' || r.status === 'late')
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .slice(0, 5)
        .map(([date, r]) => ({ date, status: r.status, note: r.note || '' })),
    });
  } catch (err) {
    console.error('[parent-portal GET /attendance]', err);
    return E.serverError(res);
  }
});

/* ── Screen 6: the term report ─────────────────────────────────── */

router.get('/report/:childId', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;
    const childId = req.params.childId;
    if (_unlinked(req, res, childId)) return;

    const Reports  = tenantModel('report_card_snapshots', tenantContext(req));
    const Subjects = tenantModel('subjects', tenantContext(req));

    const cards = await Reports.find({ schoolId, studentId: childId, status: 'published', superseded: { $ne: true } })
      .sort({ publishedAt: -1 })
      .limit(6)
      .select('id academicYear termName termNumber totalScore averageScore gpa rankings publishedAt subjects classTeacherRemark principalRemark')
      .lean();

    const latest = cards[0] || null;

    // Marks come only from the published snapshot — family roles carry no
    // Markbook grant at all (see server/utils/repairPermissions.js), so the
    // snapshot IS the record, never provisional assessment_marks.
    const snapshotSubjects = latest?.subjects || {};
    const ids = Object.keys(snapshotSubjects);
    const subjectDocs = ids.length
      ? await Subjects.find({ id: { $in: ids }, schoolId }).select('id name code').lean()
      : [];
    const nameOf = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));

    const subjects = ids
      .map(subjectId => ({
        subjectId,
        subjectName: nameOf[subjectId] || subjectId,
        finalScore:  snapshotSubjects[subjectId]?.finalScore ?? null,
        grade:       snapshotSubjects[subjectId]?.grade ?? null,
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const trend = [...cards]
      .sort((a, b) => {
        const ay = (s) => String(s.academicYear || '').replace('/', '');
        if (ay(a) !== ay(b)) return ay(a).localeCompare(ay(b));
        return (a.termNumber ?? 0) - (b.termNumber ?? 0);
      })
      .map(rc => ({ label: `${rc.academicYear || ''} T${rc.termNumber ?? ''}`.trim(), average: rc.averageScore ?? null }))
      .filter(t => t.average != null);

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ id: childId, schoolId }).select('firstName lastName className classId streamId').lean();

    // Form/assistant teacher lives on the STUDENT'S STREAM, not the class
    // (classes.formTeacherId is a legacy, never-written field — fixed
    // while adding assistant/co-homeroom support, 2026-10-29).
    let classTeacher = null;
    let assistantClassTeacher = null;
    if (student?.streamId) {
      const streamDoc = await tenantModel('streams', tenantContext(req))
        .findOne({ id: student.streamId, schoolId }).select('formTeacherId assistantFormTeacherId').lean().catch(() => null);
      const homeroomTeacherIds = [streamDoc?.formTeacherId, streamDoc?.assistantFormTeacherId].filter(Boolean);
      if (homeroomTeacherIds.length) {
        const ts = await tenantModel('teachers', tenantContext(req))
          .find({ id: { $in: homeroomTeacherIds }, schoolId }).select('id firstName lastName title').lean().catch(() => []);
        const nameById = Object.fromEntries(ts.map(t => [t.id, `${t.title ? `${t.title} ` : ''}${t.firstName} ${t.lastName}`.trim()]));
        classTeacher          = nameById[streamDoc?.formTeacherId] ?? null;
        assistantClassTeacher = nameById[streamDoc?.assistantFormTeacherId] ?? null;
      }
    }

    const academicYears = await tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean();
    const { year: currentYearDoc, term: currentTermDoc, termNumber: currentTermNumber } = resolveCurrentPeriod(academicYears);

    return ok(res, {
      child: { id: childId, name: `${student?.firstName || ''} ${student?.lastName || ''}`.trim(), className: student?.className || null },
      term: {
        academicYear: currentYearDoc?.name || '',
        termName: currentTermDoc?.name || (currentTermNumber ? `Term ${currentTermNumber}` : ''),
      },
      latest: latest ? {
        id: latest.id,
        academicYear: latest.academicYear,
        termName: latest.termName,
        termNumber: latest.termNumber,
        averageScore: latest.averageScore ?? null,
        totalScore: latest.totalScore ?? null,
        gpa: latest.gpa ?? null,
        rankings: latest.rankings ?? null,
        publishedAt: latest.publishedAt ?? null,
        classTeacherRemark: latest.classTeacherRemark || '',
        principalRemark: latest.principalRemark || '',
      } : null,
      subjects,
      trend,
      classTeacher,
      assistantClassTeacher,
    });
  } catch (err) {
    console.error('[parent-portal GET /report]', err);
    return E.serverError(res);
  }
});

/* ── Screen 7: the notice board ────────────────────────────────── */

router.get('/notices', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;

    const Announcements = tenantModel('announcements', tenantContext(req));
    const Events        = tenantModel('events', tenantContext(req));

    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const [announcements, events] = await Promise.all([
      Announcements.find({
        schoolId,
        $or: [{ expiresAt: { $gte: new Date() } }, { expiresAt: { $exists: false } }, { expiresAt: null }],
      }).sort({ priority: -1, createdAt: -1 }).limit(limit)
        .select('id title body createdAt priority expiresAt category type audience')
        .lean().catch(() => []),
      Events.find({ schoolId, date: { $gte: new Date().toISOString().slice(0, 10) } })
        .sort({ date: 1 }).limit(10)
        .select('id title date category')
        .lean().catch(() => []),
    ]);

    // An announcement addressed to staff only must not appear in a parent's
    // board. `audience` is optional in the collection, so absence = everyone.
    const forParents = (a) => {
      const aud = a.audience;
      if (!aud) return true;
      const list = Array.isArray(aud) ? aud : [aud];
      return list.some(v => ['all', 'parents', 'guardians', 'family'].includes(String(v).toLowerCase()));
    };

    // "Money" notices are the board's amber card that jumps to Fees. Derived
    // from an explicit category when the school sets one, and otherwise from
    // the wording — never from a hard-coded id, so a new fee notice works the
    // day the office writes it.
    const MONEY_RE = /\b(fee|fees|invoice|balance|payment|payments|mpesa|m-pesa|arrears|outstanding)\b/i;

    return ok(res, {
      notices: announcements.filter(forParents).map(a => {
        const category = String(a.category || a.type || '').toLowerCase();
        return {
          id: a.id,
          title: a.title,
          body: a.body,
          createdAt: a.createdAt,
          priority: a.priority || 'normal',
          pinned: a.priority === 'high' || a.priority === 'urgent',
          money: ['fee', 'fees', 'finance', 'money'].includes(category) || MONEY_RE.test(`${a.title} ${a.body}`),
        };
      }),
      events,
    });
  } catch (err) {
    console.error('[parent-portal GET /notices]', err);
    return E.serverError(res);
  }
});

/* ── Screen 8: fees — invoices and receipts as first-class rows ── */

router.get('/fees/:childId', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;
    const childId = req.params.childId;
    if (_unlinked(req, res, childId)) return;

    const FeeInvoices = tenantModel('invoices', tenantContext(req));
    const FeePayments = tenantModel('payments', tenantContext(req));
    const Schools     = _model('schools');

    const [invoices, payments, school] = await Promise.all([
      FeeInvoices.find({ schoolId, studentId: childId })
        .sort({ dueDate: -1 })
        .select('id invoiceNumber total balance status dueDate currency termId termName issuedAt')
        .lean(),
      FeePayments.find({ schoolId, studentId: childId })
        .sort({ paidAt: -1 }).limit(50)
        .select('id amount paidAt mpesaCode method reference invoiceId status')
        .lean(),
      Schools.findOne({ id: schoolId }).select('name logoUrl mpesa').lean(),
    ]);

    const currency = invoices[0]?.currency || 'KES';
    const totalBilled = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const balance     = invoices.reduce((sum, inv) => sum + (inv.balance || 0), 0);
    const clearancePct = totalBilled > 0 ? Math.round(((totalBilled - balance) / totalBilled) * 100) : 100;

    const todayISO = new Date().toISOString().slice(0, 10);
    const outstanding = invoices.filter(inv => (inv.balance || 0) > 0);

    return ok(res, {
      ..._money(currency),
      mpesaEnabled: !!_getMpesaConfig(school),
      balance,
      totalBilled,
      clearancePct,
      // The next date a parent can actually act on: the earliest due date
      // still AHEAD. A past-due invoice is already shown as overdue — putting
      // its old date here as "due by" would be a lie the Pay screen repeats.
      nextDueDate: outstanding.map(i => i.dueDate).filter(d => d && d >= todayISO).sort()[0] ?? null,
      // "overdue" is derived, not trusted: an invoice's stored status is not
      // always re-written when its due date passes.
      invoices: invoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber || inv.id,
        total: inv.total ?? 0,
        balance: inv.balance ?? 0,
        dueDate: inv.dueDate || null,
        termName: inv.termName || null,
        status: (inv.balance || 0) <= 0
          ? 'paid'
          : (inv.dueDate && inv.dueDate < todayISO ? 'overdue' : 'outstanding'),
      })),
      receipts: payments.map(p => ({
        id: p.id,
        code: p.mpesaCode || p.reference || p.id,
        amount: p.amount ?? 0,
        paidAt: p.paidAt || null,
        method: p.method || (p.mpesaCode ? 'mpesa' : 'other'),
        invoiceId: p.invoiceId || null,
      })),
    });
  } catch (err) {
    console.error('[parent-portal GET /fees]', err);
    return E.serverError(res);
  }
});

/* ── Screen 10: one receipt, as a shareable artefact ───────────── */

router.get('/receipts/:paymentId', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;
    const linked = _linkedIds(req);

    const FeePayments = tenantModel('payments', tenantContext(req));
    const FeeInvoices = tenantModel('invoices', tenantContext(req));
    const Students    = tenantModel('students', tenantContext(req));
    const Schools     = _model('schools');

    const payment = await FeePayments.findOne({ id: req.params.paymentId, schoolId }).lean();
    if (!payment) return E.notFound(res, 'Receipt not found.');
    // A receipt is a money document: it may only be opened by a guardian of
    // the child it belongs to. No id guessing, no cross-family leak.
    if (!linked.includes(payment.studentId)) {
      return E.forbidden(res, 'You do not have access to this receipt.');
    }

    const [student, invoice, school] = await Promise.all([
      Students.findOne({ id: payment.studentId, schoolId }).select('id firstName lastName className admissionNumber').lean(),
      payment.invoiceId
        ? FeeInvoices.findOne({ id: payment.invoiceId, schoolId }).select('id invoiceNumber balance total currency dueDate').lean()
        : null,
      Schools.findOne({ id: schoolId }).select('name logoUrl systemEmail').lean(),
    ]);

    return ok(res, {
      receipt: {
        id: payment.id,
        code: payment.mpesaCode || payment.reference || payment.id,
        amount: payment.amount ?? 0,
        paidAt: payment.paidAt || payment.createdAt || null,
        method: payment.method || (payment.mpesaCode ? 'mpesa' : 'other'),
        reference: payment.reference || null,
        status: payment.status || 'completed',
      },
      invoice: invoice ? {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber || invoice.id,
        // Current, not historical: the balance NOW. Labelled that way in the
        // UI so a receipt never claims to show a past statement total.
        balance: invoice.balance ?? 0,
        total: invoice.total ?? 0,
      } : null,
      child: student ? {
        id: student.id,
        name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        className: student.className || null,
        admissionNumber: student.admissionNumber || null,
      } : null,
      school: { name: school?.name || '', logoUrl: school?.logoUrl || null },
      ..._money(invoice?.currency || 'KES'),
    });
  } catch (err) {
    console.error('[parent-portal GET /receipts/:id]', err);
    return E.serverError(res);
  }
});

/* ── Screens 11 & 12: inbox and one conversation ───────────────── */

/* The messages collection has no thread document — a "thread" is the pair
   (this parent, one staff user), which is exactly how the web inbox reads it
   too. Grouping in JS over one bounded query beats inventing a threadId that
   the rest of the product does not write.
   A message addressed to several staff (a Discipline Office compose, a saved
   group send) is still ONE document, so it pairs with whichever recipient this
   picks — hence every row/bubble also carries recipientSummary(): the pairing
   is a lookup key, not a claim that the conversation was private. */
function _counterpartOf(msg, userId) {
  if (msg.senderId === userId) {
    const other = (msg.recipients || []).find(r => r !== userId && r !== 'all');
    return other ? { userId: other, name: null, role: null, outboundOnly: true } : null;
  }
  return { userId: msg.senderId, name: msg.senderName || null, role: msg.senderRole || null, outboundOnly: false };
}

router.get('/inbox', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const Msg = tenantModel('messages', tenantContext(req));

    // Everything addressed to me (role group or personal) plus everything I
    // sent — the two halves of a conversation, in one bounded read.
    const docs = await Msg.find({
      $or: [
        _inboxQuery({ schoolId, userId, role }),
        { schoolId, senderId: userId },
      ],
    }).sort({ createdAt: -1 }).limit(300)
      .select('id senderId senderName senderRole recipients subject body isRead createdAt groupId groupName')
      .lean();

    const byCounterpart = new Map();
    for (const msg of docs) {
      const counterpart = _counterpartOf(msg, userId);
      if (!counterpart?.userId) continue;
      const key = counterpart.userId;
      const existing = byCounterpart.get(key);
      const at = msg.createdAt || '';
      const unread = msg.senderId !== userId && !msg.isRead?.[userId] ? 1 : 0;

      if (!existing) {
        byCounterpart.set(key, {
          counterpartUserId: key,
          name: counterpart.name,
          role: counterpart.role,
          subject: msg.subject || '',
          preview: String(msg.body || '').slice(0, 120),
          lastAt: at,
          unread,
          // Which of these rows was really several people. The thread key is
          // still one counterpart — see the header above — so without this the
          // app would render a group send as a private chat with one of them.
          ...recipientSummary(msg),
        });
      } else {
        existing.unread += unread;
        if (at > existing.lastAt) {           // docs are newest-first
          existing.subject = msg.subject || existing.subject;
          existing.preview = String(msg.body || '').slice(0, 120);
          existing.lastAt = at;
          Object.assign(existing, recipientSummary(msg));
        }
        if (!existing.name && counterpart.name) {
          existing.name = counterpart.name;
          existing.role = counterpart.role;
        }
      }
    }

    // Names for conversations where the parent sent first (the counterpart is
    // a recipient id we have to resolve).
    const missing = [...byCounterpart.values()].filter(t => !t.name).map(t => t.counterpartUserId);
    if (missing.length) {
      const staff = await tenantModel('users', tenantContext(req))
        .find({ schoolId, id: { $in: missing } }).select('id name role').lean().catch(() => []);
      const byId = Object.fromEntries(staff.map(u => [u.id, u]));
      for (const t of byCounterpart.values()) {
        if (!t.name && byId[t.counterpartUserId]) {
          t.name = byId[t.counterpartUserId].name || null;
          t.role = byId[t.counterpartUserId].role || null;
        }
      }
    }

    return ok(res, {
      threads: [...byCounterpart.values()]
        .map(t => ({ ...t, name: t.name || 'School office' }))
        .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
    });
  } catch (err) {
    console.error('[parent-portal GET /inbox]', err);
    return E.serverError(res);
  }
});

router.get('/threads/:counterpartUserId', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const counterpartUserId = req.params.counterpartUserId;
    const Msg = tenantModel('messages', tenantContext(req));

    const docs = await Msg.find({
      $or: [
        { schoolId, senderId: userId, recipients: counterpartUserId },
        { senderId: counterpartUserId, ..._inboxQuery({ schoolId, userId, role }) },
      ],
    }).sort({ createdAt: 1 }).limit(300)
      .select('id senderId senderName senderRole subject body isRead createdAt recipients groupId groupName')
      .lean();

    // Opening a conversation IS reading it — the same single write the web
    // inbox does on open, not a per-message round trip.
    const unreadIds = docs.filter(m => m.senderId !== userId && !m.isRead?.[userId]).map(m => m.id);
    if (unreadIds.length) {
      await Msg.updateMany({ schoolId, id: { $in: unreadIds } }, { $set: { [`isRead.${userId}`]: true } }).catch(() => {});
    }

    const counterpart = await tenantModel('users', tenantContext(req))
      .findOne({ schoolId, id: counterpartUserId }).select('id name role').lean().catch(() => null);

    return ok(res, {
      counterpartUserId,
      counterpart: {
        id: counterpartUserId,
        name: counterpart?.name || 'School office',
        role: counterpart?.role || null,
      },
      messages: docs.map(m => ({
        id: m.id,
        mine: m.senderId === userId,
        from: m.senderId === userId ? 'You' : (m.senderName || counterpart?.name || 'School office'),
        subject: m.subject || '',
        body: m.body,
        at: m.createdAt,
        /* Which bubble here was really a group send. `read` below answers the
           narrow question — did THIS counterpart open it — which is not the
           same claim as "the group read it", so the app has to know the
           difference rather than showing one person's tick as everyone's. */
        ...recipientSummary(m),
        // Two different questions, and conflating them is how an app ends up
        // telling a parent their message was read when nobody opened it:
        //   - my own message → has the OTHER person read it?
        //   - their message  → have I read it? (which I just did, above)
        read: m.senderId === userId
          ? Boolean(m.isRead?.[counterpartUserId])
          : Boolean(m.isRead?.[userId]),
      })),
    });
  } catch (err) {
    console.error('[parent-portal GET /threads/:id]', err);
    return E.serverError(res);
  }
});

router.post('/threads/:counterpartUserId/messages', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const counterpartUserId = req.params.counterpartUserId;
    const body    = String(req.body?.body || '').trim();
    const subject = String(req.body?.subject || '').trim() || 'Message from parent';

    if (!body) return E.badRequest(res, 'Write a message first.');
    if (body.length > 4000) return E.badRequest(res, 'That message is too long.');

    // The counterpart must be a real person in THIS school — otherwise a
    // crafted id could drop a message into another tenant's inbox.
    const counterpart = await tenantModel('users', tenantContext(req))
      .findOne({ schoolId, id: counterpartUserId }).select('id name role isActive').lean();
    if (!counterpart || counterpart.isActive === false) {
      return E.badRequest(res, 'That recipient is no longer available — please pick another and try again.');
    }

    const sender = await tenantModel('users', tenantContext(req))
      .findOne({ id: userId, schoolId }).select('name email').lean();

    const msg = await createDirectMessage(req, {
      recipientUserIds: [counterpartUserId],
      subject,
      body,
      senderName: sender?.name || sender?.email || 'Parent',
      senderRole: 'parent',
    });

    return created(res, { id: msg.id, at: msg.createdAt });
  } catch (err) {
    console.error('[parent-portal POST /threads/:id/messages]', err);
    return E.serverError(res);
  }
});

/* ── Screen 13: the parent's own profile ───────────────────────── */

router.get('/profile', authMiddleware, PLAN, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, userId, studentIds = [], guardianOf = [] } = req.jwtUser;

    const Users    = tenantModel('users', tenantContext(req));
    const Students = tenantModel('students', tenantContext(req));
    const Schools  = _model('schools');

    const [me, school, children] = await Promise.all([
      Users.findOne({ id: userId, schoolId }).select('id name email phone createdAt lastLogin').lean(),
      Schools.findOne({ id: schoolId }).select('name logoUrl slug currency systemEmail').lean(),
      Students.find({ id: { $in: _linkedIds(req) }, schoolId })
        .select('id firstName lastName className admissionNumber photo status').lean(),
    ]);

    // Primary vs co-guardian is the board's distinction and it changes what a
    // parent may do (a co-guardian does not manage the child's account). The
    // JWT carries both lists; only users in BOTH resolve as primary.
    const childrenOut = children.map(c => ({
      id: c.id,
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      className: c.className || null,
      admissionNumber: c.admissionNumber || null,
      photoUrl: c.photo || null,
      relationship: studentIds.includes(c.id) ? 'primary' : 'co-guardian',
      isPrimary: studentIds.includes(c.id),
    }));

    const academicYears = await tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean();
    const { year: currentYearDoc, term: currentTermDoc, termNumber: currentTermNumber } = resolveCurrentPeriod(academicYears);

    return ok(res, {
      user: { id: userId, name: me?.name || '', email: me?.email || null, phone: me?.phone || null },
      school: {
        name: school?.name || '',
        slug: school?.slug || null,
        logoUrl: school?.logoUrl || null,
        supportEmail: school?.systemEmail || null,
      },
      term: {
        academicYear: currentYearDoc?.name || '',
        termName: currentTermDoc?.name || (currentTermNumber ? `Term ${currentTermNumber}` : ''),
      },
      children: childrenOut,
      // Link counts are what the "add a child" row needs to explain itself:
      // the office is the only thing that can grant access, and the app must
      // not pretend otherwise.
      canAddChild: true,
    });
  } catch (err) {
    console.error('[parent-portal GET /profile]', err);
    return E.serverError(res);
  }
});

/* ── Screen 3: linking a child with the office's code ──────────────
   The board's flow 03, and the one place in the parent app where access is
   GRANTED rather than read. Three deliberate properties:

   1. THE APP CANNOT GRANT ITSELF ANYTHING. The code is generated by the
      office, for one student, and is single-use. There is no
      "admission number + surname" self-service path, because anyone who knows
      a child's name could otherwise attach themselves to that child's records.
   2. THE PARENT SEES THE RECORD BEFORE CONFIRMING (preview), never a silent
      binding — the board is explicit about this, and it is also the cheapest
      guard against a mistyped or already-used code.
   3. CONFIRM RE-ISSUES THE SESSION. Child lists are baked into the JWT at
      sign-in, so without a fresh token the parent would be linked on the
      server and still refused by every child endpoint until they signed out
      and back in. The swap happens inside this one response instead.
   ────────────────────────────────────────────────────────────────── */

/* The code format itself lives in utils/link-codes.js, shared with the office
   console that issues the codes — one alphabet, one hash, one TTL. */
const linkCodeLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please ask the office for a new code.' } },
});

/** Loads an unexpired, unused code for this school. Shared by preview and confirm. */
async function _findLinkCode(req, res, rawCode) {
  const code = _normaliseLinkCode(rawCode);
  if (code.length !== 6) {
    E.badRequest(res, 'Enter the 6-character code the office gave you.');
    return null;
  }

  const Codes = tenantModel('child_link_codes', tenantContext(req));
  const doc = await Codes.findOne({
    schoolId: req.jwtUser.schoolId,
    codeHash: _hashLinkCode(code),
    status: 'issued',
  }).lean();

  if (!doc) {
    // One answer for wrong, already-used and never-existed: a parent who has
    // the wrong code does not need to know which kind of wrong it is.
    res.status(404).json({
      success: false,
      error: { code: 'INVALID_CODE', message: 'That code isn’t right, or it has already been used. Ask the office for a new one.' },
    });
    return null;
  }
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
    await Codes.updateOne({ id: doc.id }, { $set: { status: 'expired', updatedAt: new Date().toISOString() } }).catch(() => {});
    res.status(404).json({
      success: false,
      error: { code: 'INVALID_CODE', message: 'That code has expired. Ask the office for a new one.' },
    });
    return null;
  }
  return doc;
}

/* POST /api/parent-portal/link/preview — show the child, grant nothing. */
router.post('/link/preview', authMiddleware, PLAN, linkCodeLimiter, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _findLinkCode(req, res, req.body?.code);
    if (!doc) return;

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ id: doc.studentId, schoolId })
      .select('id firstName lastName className admissionNumber photo status')
      .lean();
    if (!student) {
      return E.notFound(res, 'That student is no longer on the school’s records. Please ask the office.');
    }

    return ok(res, {
      code: _normaliseLinkCode(req.body?.code),   // echoed for the confirm step
      // Already linked is information, not an error: the screen says so
      // instead of offering to link the same child twice.
      alreadyLinked: _linkedIds(req).includes(doc.studentId),
      relationship: doc.relationship || 'primary',
      child: {
        id: student.id,
        name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        className: student.className || null,
        admissionNumber: student.admissionNumber || null,
        photoUrl: student.photo || null,
      },
    });
  } catch (err) {
    console.error('[parent-portal POST /link/preview]', err);
    return E.serverError(res);
  }
});

/* POST /api/parent-portal/link/confirm — grant, then re-issue the session. */
router.post('/link/confirm', authMiddleware, PLAN, linkCodeLimiter, async (req, res) => {
  if (!_requireParent(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await _findLinkCode(req, res, req.body?.code);
    if (!doc) return;

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ id: doc.studentId, schoolId }).select('id firstName lastName className').lean();
    if (!student) return E.notFound(res, 'That student is no longer on the school’s records.');

    const Users = tenantModel('users', tenantContext(req));
    const me = await Users.findOne({ id: userId, schoolId }).lean();
    if (!me) return E.notFound(res, 'Account not found.');

    // Primary guardians live in studentIds, co-guardians in guardianOf — the
    // two fields every child-access check in the product reads.
    const field = (doc.relationship === 'co-guardian') ? 'guardianOf' : 'studentIds';
    const now = new Date().toISOString();
    const Codes = tenantModel('child_link_codes', tenantContext(req));

    // Claim the code FIRST: whoever wins the claim is the one who gets the
    // child. Granting before claiming would let two taps of the same code add
    // two guardians.
    const claimed = await Codes.updateOne(
      { id: doc.id, status: 'issued' },
      { $set: { status: 'used', usedByUserId: userId, usedAt: now, updatedAt: now } },
    );
    if ((claimed?.modifiedCount ?? 0) === 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'That code has already been used. Ask the office for a new one.' },
      });
    }

    await Users.updateOne({ id: userId, schoolId }, { $addToSet: { [field]: student.id }, $set: { updatedAt: now } });

    AuditService.log({
      action: 'parent.link_child',
      actor: { userId, role: req.jwtUser.role, email: me.email },
      schoolId,
      req,
      details: { studentId: student.id, relationship: doc.relationship || 'primary', codeId: doc.id },
    });

    // A fresh session so the child is usable immediately (see the header).
    const authRoutes = require('./auth');   // lazy: keeps this router loadable without the auth stack
    const schoolDoc = req.school ?? await _model('schools').findOne({ id: schoolId }).lean();
    const updated = { ...me, [field]: [...new Set([...(me[field] || []), student.id])] };
    const session = await authRoutes._issueMobileSession(req, updated, schoolDoc, { action: 'auth.mobile.link' });

    return ok(res, {
      childId: student.id,
      child: {
        id: student.id,
        name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        className: student.className || null,
      },
      ...session,
    });
  } catch (err) {
    console.error('[parent-portal POST /link/confirm]', err);
    return E.serverError(res);
  }
});

module.exports = router;
