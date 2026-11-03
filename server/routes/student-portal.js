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
const { planGate }       = require('../middleware/plan');

/* Portal access is the tier boundary: student portals need 'student', parent
   portals need 'family'. Before this, the tiers existed only as prices — a
   Base school's parents and students could still log in. */
const PLAN = planGate('student_portal');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { isTimetablePublished, publishedReader } = require('../utils/timetable-publish');
const { resolveCurrentPeriod } = require('./academic-config');
const { audienceClause }        = require('../utils/announcement-audience');
const { _getMpesaConfig } = require('./mpesa');
const { createDirectMessage } = require('./messages');
const { resolveMessageCategories, resolveOneCategory } = require('../utils/parent-message-recipients');
const { ok, E, created } = require('../utils/response');
// Weekly Snapshot's read logic is shared with weekly-snapshots.js's own
// staff-facing routes — see that file's _findAuthorizedStudent header
// comment for why this isn't reimplemented here.
const { _helpers: weeklySnapshotHelpers } = require('./weekly-snapshots');

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
router.get('/dashboard', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, studentId } = req.jwtUser;

    const Students      = tenantModel('students', tenantContext(req));
    const Attendance    = tenantModel('attendance', tenantContext(req));
    const FeeInvoices   = tenantModel('invoices', tenantContext(req));
    const Reports       = tenantModel('report_card_snapshots', tenantContext(req));
    const Coverage      = tenantModel('lesson_coverage', tenantContext(req));
    const Topics        = tenantModel('syllabus_topics', tenantContext(req));
    // 'timetable' — NOT 'timetable_slots'. The two are genuinely different,
    // both-populated MongoDB collections: 'timetable' is what the admin
    // Scheduling Engine (server/routes/timetable.js) actually reads and
    // writes; 'timetable_slots' is an orphaned legacy collection nothing
    // writes to anymore. Reading the wrong one meant an admin's timetable
    // edits never reached this dashboard widget. Confirmed live against
    // the real database: 202 real documents in 'timetable' vs 55 stale
    // ones in 'timetable_slots'.
    const Timetable     = await publishedReader(schoolId, tenantContext(req));
    const Subjects      = tenantModel('subjects', tenantContext(req));
    const Schools       = _model('schools');
    /* 'behaviour_incidents', NOT 'behaviour': behaviour.js:515 stores every
       logged incident in the first; the 'behaviour' collection this line used
       to read is written by nothing (real database: 100 incidents vs 0
       'behaviour' docs, for every school), so the widget below was permanently
       empty however much a school logged. parent-portal.js and
       teacher-portal.js made the same mistake. weekly-snapshot-aggregate.js:147
       is the reader that always had it right. */
    const Behaviour     = tenantModel('behaviour_incidents', tenantContext(req));
    const Exams         = tenantModel('exams', tenantContext(req));
    const Announcements = tenantModel('announcements', tenantContext(req));
    const Events        = tenantModel('events', tenantContext(req));
    const Streams       = tenantModel('streams', tenantContext(req));
    const Teachers      = tenantModel('teachers', tenantContext(req));
    const LibraryLoans  = tenantModel('library_loans', tenantContext(req));

    const todayISO = new Date().toISOString().slice(0, 10);

    // ── Student record ───────────────────────────────────────
    const student = await Students.findOne({ id: studentId, schoolId })
      .select('firstName lastName admissionNumber classId className streamId photo status dateOfBirth gender')
      .lean();
    if (!student) return E.notFound(res, 'Student record not found.');

    const school = await Schools.findOne({ id: schoolId })
      .select('termsPerYear name emergencyOnlineMode portalConfig mpesa')
      .lean();

    // Live-resolved, not the schools.academicYear cached field — see
    // parent-portal.js's identical fix for the full reasoning (same
    // staleness class report-cards.js's _resolveTermScope was written
    // to fix; this dashboard had the old, unfixed version of it).
    const academicYears = await tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean();
    const { year: currentYearDoc, term: currentTermDoc, termNumber: currentTermNumber } = resolveCurrentPeriod(academicYears);
    const academicYear = currentYearDoc?.name || '';
    const currentTerm  = currentTermDoc?.name || (currentTermNumber ? `Term ${currentTermNumber}` : '');
    const mpesaEnabled = !!_getMpesaConfig(school);

    // ── Attendance this term ─────────────────────────────────
    // Same bug, same fix, as parent-portal.js's identical query (see its
    // own comment for the full reasoning): `attendance` documents have no
    // `academicYear` field at all, so this always matched zero records.
    // Scoped by the resolved term's own date range instead.
    const attDateFilter = currentTermDoc
      ? { date: { $gte: currentTermDoc.startDate, $lte: currentTermDoc.endDate } }
      : {};
    const attRecords = await Attendance.find({
      schoolId, studentId, ...attDateFilter,
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

    // ── Fee balance & clearance ──────────────────────────────
    const invoices     = await FeeInvoices.find({ schoolId, studentId }).select('total balance status').lean();
    const feeBalance   = invoices.reduce((acc, inv) => acc + (inv.balance || 0), 0);
    const totalBilled  = invoices.reduce((acc, inv) => acc + (inv.total  || 0), 0);
    const feeClearancePct = totalBilled > 0
      ? Math.round(((totalBilled - feeBalance) / totalBilled) * 100)
      : 100;

    // ── Lessons / curriculum coverage ────────────────────────
    // A coverage record's mere EXISTENCE means "covered" — lesson_coverage
    // documents never carry a `covered` boolean field (see lessons.js's
    // POST /coverage). The `covered: true` condition previously here never
    // matched anything, so this widget showed 0% for every subject
    // regardless of real progress — found and fixed alongside the
    // streamId work below, since it made that work impossible to verify
    // on this dashboard otherwise.
    // streamOr: this student's OWN stream's coverage (if their class-
    // subject is taught separately per stream) UNION any legacy/whole-
    // class record (no streamId at all) — so a student in one stream
    // never sees a sibling stream's progress credited to them, while a
    // non-subdivided subject still counts normally.
    let lessonsCoverage = [];
    if (student.classId) {
      const streamOr = student.streamId
        ? [{ streamId: student.streamId }, { streamId: { $exists: false } }]
        : [{ streamId: { $exists: false } }];
      const subjectIds = await Coverage.distinct('subjectId', { schoolId, classId: student.classId, academicYear, $or: streamOr });
      const subjectDocs = await Subjects.find({ id: { $in: subjectIds }, schoolId }).select('id name code').lean();
      const subjectMap  = Object.fromEntries(subjectDocs.map(s => [s.id, s]));

      // Class-scoped, same as lessons.js's _topicClassFilterPart (2026-09
      // fix): a pre-migration topic with no classId still counts for every
      // class, but a topic scoped to a DIFFERENT class must not inflate
      // this student's own class total.
      const topicClassOr = [{ classId: student.classId }, { classId: { $exists: false } }];
      for (const subjectId of subjectIds) {
        const totalTopics   = await Topics.countDocuments({ schoolId, subjectId, academicYear, $or: topicClassOr });
        const coveredTopics = await Coverage.countDocuments({ schoolId, classId: student.classId, subjectId, academicYear, $or: streamOr });
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
    // Lowercase — matches how timetable.js's own SlotSchema actually
    // stores `day` (confirmed against real data: a query for 'Monday'
    // matches 0 documents, 'monday' matches every one). A capitalized
    // array here silently broke "Today's Timetable" on this dashboard
    // for every student, every day, since this route shipped.
    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const today = DAY_NAMES[new Date().getDay()];

    // Same union as lessonsCoverage's streamOr above: this student's own
    // stream's lessons, plus any genuine whole-class slot (no streamId at
    // all — e.g. Assembly). Without this, a student in one stream saw
    // EVERY stream's lessons for their class merged together — not just a
    // display quirk, a real case of showing a student the wrong stream's
    // subject/teacher/room for today.
    const timetableStreamOr = student.streamId
      ? [{ streamId: student.streamId }, { streamId: { $exists: false } }]
      : [{ streamId: { $exists: false } }];

    // Unpublished timetables are not shown to students (see utils/timetable-publish.js).
    let rawSlots = student.classId && (await isTimetablePublished(schoolId))
      ? (await Timetable.find({ schoolId, classId: student.classId, day: today, isActive: true, $or: timetableStreamOr })
          .sort({ startTime: 1 })
          .select('subjectId subject teacherName teacherId startTime endTime room day')
          .lean()
        // 'timetable' stores the display name as `subject`, not
        // `subjectName` — alias it so this widget's existing contract
        // (StudentDashboard.jsx reads slot.subjectName) is unchanged.
        ).map(s => ({ ...s, subjectName: s.subject }))
      : [];

    // When Emergency Online Learning Mode is active, attach meeting link to each slot
    // so students see a "Join" button with the correct teacher's link.
    const emergencyMode = !!(school?.emergencyOnlineMode);
    let timetableToday = rawSlots;

    if (emergencyMode && rawSlots.length > 0) {
      // Collect unique teacherIds present in today's slots
      const teacherIds = [...new Set(rawSlots.map(s => s.teacherId).filter(Boolean))];
      if (teacherIds.length > 0) {
        const Teachers = tenantModel('teachers', tenantContext(req));
        const teacherDocs = await Teachers.find({
          schoolId,
          $or: [{ id: { $in: teacherIds } }, { userId: { $in: teacherIds } }],
        }).select('id userId zoomPMILink zoomPasscode meetLink').lean();
        // Build map keyed by BOTH id and userId so timetable slots resolve regardless of which was stored
        const teacherMap = {};
        for (const t of teacherDocs) {
          if (t.id)     teacherMap[t.id]     = t;
          if (t.userId) teacherMap[t.userId] = t;
        }

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
      schoolId, studentId, status: 'published', superseded: { $ne: true },
    }).sort({ publishedAt: -1 }).limit(6)
      .select('id academicYear termName termNumber totalScore averageScore gpa rankings status publishedAt version termId academicYearId subjects reportLabel cycle')
      .lean();

    // ── Real per-subject marks — the one place this dashboard can show an
    // actual mark, since family roles have no access to the live Markbook
    // at all (see server/utils/repairPermissions.js — student/parent carry
    // no grades/assessment grant). Sourced only from the most recently
    // published report card's own subjects snapshot, never provisional
    // assessment_marks data — a mark a teacher hasn't finished entering, or
    // one still awaiting moderation, is never shown here. Was previously
    // conflated with lessonsCoverage below (curriculum coverage percentage
    // mislabeled as "My Grades"/"My Average") — this is the real thing.
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

    // ── Extended data (parallel) ─────────────────────────────
    const [
      bRecords,
      upcomingExamsDocs,
      announcementsDocs,
      upcomingEventsDocs,
      streamDoc,
      nextDueInvoice,
      borrowedBooksDocs,
    ] = await Promise.all([
      Behaviour.find({ schoolId, studentId })
        .sort({ date: -1, createdAt: -1 }).limit(50)
        .select('points type category description date title').lean()
        .catch(() => []),
      student.classId
        ? Exams.find({
            schoolId,
            classId: student.classId,
            date: { $gte: todayISO },
            // A sitting that is over, or that the office deleted — delete is a
            // soft delete: status 'cancelled' with `deletedAt` stamped, the
            // same leak the staff Exams screen had — is not an exam to look
            // forward to. A mid-sitting exam (in_progress) still shows.
            $or: [
              { status: { $exists: false } },
              { status: 'scheduled' },
              { status: 'in_progress' },
            ],
            $and: [
              { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
            ],
          })
            .sort({ date: 1 }).limit(4)
            .select('title subjectName date startTime type').lean()
            .catch(() => [])
        : [],
      // A student sees the notices addressed to students — and only those.
      // The cut is in the query, not a post-filter, because `.limit(3)` below
      // runs at the database: filtering afterwards would let three
      // parents-only posts occupy the whole board.
      Announcements.find({
        schoolId,
        $and: [
          { $or: [{ expiresAt: { $gte: new Date() } }, { expiresAt: { $exists: false } }, { expiresAt: null }] },
          audienceClause('students'),
        ],
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
      FeeInvoices.findOne({ schoolId, studentId, balance: { $gt: 0 }, dueDate: { $gte: todayISO } })
        .sort({ dueDate: 1 }).select('dueDate').lean().catch(() => null),
      LibraryLoans.find({ schoolId, borrowerId: studentId, status: { $in: ['active', 'overdue', 'lost'] } })
        .sort({ dueDate: 1 })
        .select('id bookId bookTitle status dueDate lostAt')
        .lean().catch(() => []),
    ]);
    // Behaviour summary
    const totalPoints  = bRecords.reduce((sum, r) => sum + (Number(r.points) || 0), 0);
    const latestReward = bRecords.find(r => (Number(r.points) || 0) > 0) || null;
    const latestComment = bRecords[0] || null;
    const badgeLevel   = totalPoints >= 500 ? 'gold' : totalPoints >= 200 ? 'silver' : totalPoints >= 50 ? 'bronze' : null;

    // Class teacher name(s) — main + assistant/co-homeroom teacher
    let classTeacher = null;
    let assistantClassTeacher = null;
    const homeroomTeacherIds = [streamDoc?.formTeacherId, streamDoc?.assistantFormTeacherId].filter(Boolean);
    if (homeroomTeacherIds.length) {
      const ts = await Teachers.find({ id: { $in: homeroomTeacherIds }, schoolId })
        .select('id firstName lastName title').lean().catch(() => []);
      const nameById = Object.fromEntries(ts.map(t => [t.id, `${t.title ? t.title + ' ' : ''}${t.firstName} ${t.lastName}`.trim()]));
      classTeacher          = nameById[streamDoc?.formTeacherId] ?? null;
      assistantClassTeacher = nameById[streamDoc?.assistantFormTeacherId] ?? null;
    }

    return ok(res, {
      student: {
        id:              studentId,
        name:            `${student.firstName} ${student.lastName}`,
        firstName:       student.firstName,
        admissionNumber: student.admissionNumber,
        classId:         student.classId,
        className:       student.className,
        photo:           student.photo || null,
        gender:          student.gender,
        dateOfBirth:     student.dateOfBirth || null,
        // Reported directly 2026-10-27 ("will my average and rank work?"):
        // the client's Class Rank stat card (StudentDashboard.jsx) has
        // always read student.classRank/classSize, but this route never
        // set either — the data exists (reportCards[0].rankings.class,
        // written by report-cards.js only when the school has ranking
        // enabled) but was never mapped here, so the card showed "—"
        // unconditionally, even once a report card with real rankings was
        // published. null when no published report card has rankings
        // (ranking disabled for the school, or nothing published yet) —
        // the client already renders "—" for a null classRank.
        classRank:       reportCards[0]?.rankings?.class?.rank   ?? null,
        classSize:       reportCards[0]?.rankings?.class?.outOf  ?? null,
      },
      school: {
        name: school?.name,
        academicYear,
        currentTerm,
        emergencyOnlineMode: emergencyMode,
        portalConfig: school?.portalConfig || null,
        mpesaEnabled,
      },
      attendance:       attSummary,
      // Security Baseline Register, CFG-09 — school.portalConfig.
      // studentCanSeeFees is a real Settings toggle ("When off, students
      // cannot see their fee balance") that was previously read by
      // nothing at all, server or client: this route always returned the
      // fee fields regardless of the setting, and the client never even
      // checked it. Defaults to visible (!== false) unless a school has
      // explicitly turned it off, matching the toggle's own stated
      // default. Gated at the response, not the query, since a school
      // could flip this at any time and every other consumer of these
      // already-computed values in this function is unaffected.
      ...(school?.portalConfig?.studentCanSeeFees !== false ? {
        feeBalance,
        feeClearancePct,
        nextFeeDueDate: nextDueInvoice?.dueDate ?? null,
      } : {
        feeBalance: null,
        feeClearancePct: null,
        nextFeeDueDate: null,
      }),
      lessonsCoverage,
      subjectMarks,
      timetableToday,
      reportCards: reportCardsOut,
      classTeacher,
      assistantClassTeacher,
      behaviourSummary: { totalPoints, badgeLevel, latestReward, latestComment },
      upcomingExams:    upcomingExamsDocs,
      announcements:    announcementsDocs,
      upcomingEvents:   upcomingEventsDocs,
      /* An active loan whose due date has passed IS overdue — derived here so
         Home's badge agrees with the weekly snapshot's own library section,
         which already derives the same way. The stored status stays 'active'
         until the librarian returns it; this is a read view, not a write. */
      borrowedBooks: borrowedBooksDocs.map((doc) => (
        doc.status === 'active' && doc.dueDate
          ? { ...doc, status: (doc.dueDate < todayISO ? 'overdue' : 'active') }
          : doc
      )),
    });
  } catch (err) {
    console.error('[student-portal GET /dashboard]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/student-portal/me  — own profile only
   ══════════════════════════════════════════════════════════════ */
router.get('/me', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, studentId } = req.jwtUser;
    const Students = tenantModel('students', tenantContext(req));
    const student  = await Students.findOne({ id: studentId, schoolId }).lean();
    if (!student) return E.notFound(res, 'Student record not found.');
    const { __v, _id, ...safe } = student;
    return ok(res, safe);
  } catch (err) {
    console.error('[student-portal GET /me]', err);
    return E.serverError(res);
  }
});

/* ===============================================================
   NOTE (merge): the two conflict regions below were resolved by hand —
   main had added the student messaging routes and this branch adds the
   published full-week timetable read; both are kept, each closed by the
   shared `return E.serverError(res); } });` tail.
   =============================================================== */

/* ═══════════════════════════════════════════════════════════════
   GET /api/student-portal/message-recipients
   Student-safe compose: the categories a student can message are resolved
   from their own class/stream data — subject teachers, class teacher,
   discipline, administration — never another student or parent.
   ═══════════════════════════════════════════════════════════════ */
router.get('/message-recipients', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { studentId } = req.jwtUser;
    const categories = await resolveMessageCategories(req, studentId);
    // Never leak internal recipient userIds to the client — the key is
    // enough to pick from, re-resolved server-side again on send.
    return ok(res, categories.map(c => ({ key: c.key, label: c.label })));
  } catch (err) {
    console.error('[student-portal GET /message-recipients]', err);
    return E.serverError(res);
  }
});

/* ── Full-week timetable ─────────────────────────────────────────────
   The dashboard hands a student `timetableToday`; this route is the read the
   Timetable screen needs for the rest of the week. Same collection, same
   published gate, resolved to the student's own stream, with any substitution
   for that date + period attached as a `change`.

   Per-day shape, not a flat slot list: the screen renders a week, and a flat
   list silently merges the same period across days. */

const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function _mondayOf(value) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))
    ? String(value)
    : new Date().toISOString().slice(0, 10);
  const date = new Date(`${base}T00:00:00Z`);
  const delta = (date.getUTCDay() + 6) % 7; // Sunday 0 -> Monday 0
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

function _addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

router.get('/timetable', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, studentId } = req.jwtUser;

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ id: studentId, schoolId })
      .select('classId streamId')
      .lean();
    if (!student) return E.notFound(res, 'Student record not found.');

    const monday = _mondayOf(req.query.weekOf);
    const currentMonday = _mondayOf(undefined);
    const weeksApart = Math.round(
      (Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${currentMonday}T00:00:00Z`)) / 604800000,
    );
    if (Math.abs(weeksApart) > 1) {
      return E.validation(res, [
        { field: 'weekOf', message: 'Only the current week and one week either side can be read.' },
      ]);
    }

    const weekEnd = _addDays(monday, 6);
    const dates = WEEK_DAYS.map((day, index) => ({ day, date: _addDays(monday, index) }));

    let termLabel = '';
    try {
      const years = await tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean();
      const { year, term, termNumber } = resolveCurrentPeriod(years);
      termLabel = [term?.name || (termNumber ? `Term ${termNumber}` : ''), year?.name]
        .filter(Boolean)
        .join(' ');
    } catch { /* a missing year is not a reason to fail the week */ }

    const published = await isTimetablePublished(schoolId);
    if (!published || !student.classId) {
      return ok(res, { weekOf: monday, weekEnd, termLabel, notPublished: !published, days: [] });
    }

    const Timetable = await publishedReader(schoolId, tenantContext(req));
    const streamOr = student.streamId
      ? [{ streamId: student.streamId }, { streamId: { $exists: false } }]
      : [{ streamId: { $exists: false } }];

    const slots = await Timetable
      .find({ schoolId, classId: student.classId, isActive: true, $or: streamOr })
      .sort({ day: 1, periodNumber: 1, startTime: 1 })
      .limit(300)
      .select('subjectId subject teacherId teacherName room day period periodNumber startTime endTime type')
      .lean();

    /* The timetable document carries `teacherId` but its denormalised
       `teacherName` is often blank (the seed writes ids only). A student
       seeing "No teacher" for their own lesson is a data defect they cannot
       fix, so resolve the names here — by id OR userId, the same two forms
       the dashboard's link join uses. */
    const teacherIds = [...new Set(slots.map((s) => s.teacherId).filter(Boolean))];
    const teacherNameById = new Map();
    if (teacherIds.length > 0) {
      const teacherDocs = await tenantModel('teachers', tenantContext(req))
        .find({ schoolId, $or: [{ id: { $in: teacherIds } }, { userId: { $in: teacherIds } }] })
        .select('id userId title firstName lastName name')
        .lean();
      for (const teacher of teacherDocs) {
        const name = teacher.name || [teacher.title, teacher.firstName, teacher.lastName].filter(Boolean).join(' ');
        if (teacher.id) teacherNameById.set(teacher.id, name);
        if (teacher.userId) teacherNameById.set(teacher.userId, name);
      }
    }

    // ONE substitutions query for the whole week, indexed by date|period.
    const subs = await tenantModel('substitutions', tenantContext(req))
      .find({
        schoolId,
        date: { $gte: dates[0].date, $lte: dates[4].date },
        $or: [{ classId: student.classId }, { classId: { $exists: false } }],
      })
      .limit(300)
      .lean();
    const subByKey = new Map();
    for (const sub of subs) {
      if (sub?.date && sub?.period) subByKey.set(`${sub.date}|${sub.period}`, sub);
    }

    const days = dates.map(({ day, date }) => {
      const daySlots = slots
        .filter((slot) => String(slot.day || '').toLowerCase() === day)
        .map((slot) => {
          const sub = subByKey.get(`${date}|${slot.period}`);
          const change = sub
            ? {
                kind: 'substitution',
                from: sub.originalTeacherName ?? slot.teacherName ?? '',
                to: sub.substituteTeacherName ?? null,
                note: sub.reason || sub.notes || '',
                at: sub.createdAt ?? null,
              }
            : null;
          return {
            period: slot.period ?? '',
            periodNumber: Number(slot.periodNumber ?? slot.period) || 0,
            type: slot.type || 'lesson',
            subjectId: slot.subjectId ?? null,
            subjectName: slot.subject ?? slot.subjectName ?? '',
            teacherId: slot.teacherId ?? null,
            teacherName:
              sub?.substituteTeacherName ||
              slot.teacherName ||
              teacherNameById.get(slot.teacherId) ||
              '',
            room: slot.room ?? '',
            startTime: slot.startTime ?? null,
            endTime: slot.endTime ?? null,
            change,
          };
        })
        .sort((a, b) => a.periodNumber - b.periodNumber || String(a.period).localeCompare(String(b.period)));
      return { date, day, slots: daySlots };
    });

    return ok(res, { weekOf: monday, weekEnd, termLabel, notPublished: false, days });
  } catch (err) {
    console.error('[student-portal GET /timetable]', err);
    return E.serverError(res);
  }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/student-portal/messages
   Body: { category, subject, body }
   `category` is re-resolved server-side to actual staff userId(s) — a
   student can never reach another student or parent through this route.
   ═══════════════════════════════════════════════════════════════ */
router.post('/messages', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, userId, studentId } = req.jwtUser;
    const { category, subject, body } = req.body;

    if (!category || !subject?.trim() || !body?.trim()) {
      return E.badRequest(res, 'category, subject, and body are required');
    }

    const recipientUserIds = await resolveOneCategory(req, studentId, category);
    if (!recipientUserIds || recipientUserIds.length === 0) {
      return E.badRequest(res, 'That recipient is no longer available — please pick another and try again.');
    }

    const senderUser = await tenantModel('users', tenantContext(req)).findOne({ id: userId, schoolId }).select('name email').lean();
    const msg = await createDirectMessage(req, {
      recipientUserIds,
      subject: subject.trim(),
      body: body.trim(),
      senderName: senderUser?.name || senderUser?.email || 'Student',
      senderRole: 'student',
    });
    return created(res, msg);
  } catch (err) {
    console.error('[student-portal POST /messages]', err);
    return E.serverError(res);
  }
});

/* ── Timetable changes — next 7 days, for the Home banner ─────────── */
router.get('/timetable/changes', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const { schoolId, studentId } = req.jwtUser;
    const student = await tenantModel('students', tenantContext(req))
      .findOne({ id: studentId, schoolId })
      .select('classId')
      .lean();
    if (!student?.classId) return ok(res, []);

    const today = new Date().toISOString().slice(0, 10);
    const until = _addDays(today, 7);

    const subs = await tenantModel('substitutions', tenantContext(req))
      .find({
        schoolId,
        date: { $gte: today, $lte: until },
        $or: [{ classId: student.classId }, { classId: { $exists: false } }],
      })
      .sort({ date: 1, period: 1 })
      .limit(10)
      .lean();

    return ok(res, subs.map((sub) => ({
      date: sub.date,
      period: sub.period ?? '',
      kind: 'substitution',
      from: sub.originalTeacherName ?? '',
      to: sub.substituteTeacherName ?? null,
      subjectName: sub.subject ?? '',
      note: sub.reason || sub.notes || '',
    })));
  } catch (err) {
    console.error('[student-portal GET /timetable/changes]', err);
    return E.serverError(res);
  }
});


/* ══════════════════════════════════════════════════════════════
   Weekly Student Snapshot — self-service, bypasses RBAC entirely
   (no rbac()/moduleGate/planGate anywhere in this file, matching every
   other route above). Always self — studentId comes from the JWT, no
   :studentId param, so there's nothing to check ownership against
   other than "is this my own studentId," which the shared helper
   already does via req.jwtUser.studentId.
   ══════════════════════════════════════════════════════════════ */
router.get('/weekly-snapshot/weeks', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const result = await weeklySnapshotHelpers.getWeeksForStudent(req, req.jwtUser.studentId);
    if (result.error === 'not_found') return E.notFound(res, 'Student record not found.');
    if (result.error === 'forbidden') return E.forbidden(res, 'You can only view your own Weekly Snapshots.');
    return ok(res, result);
  } catch (err) {
    console.error('[student-portal GET /weekly-snapshot/weeks]', err);
    return E.serverError(res);
  }
});

router.get('/weekly-snapshot/:weekStart', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    const result = await weeklySnapshotHelpers.getSnapshotDetail(req, req.jwtUser.studentId, req.params.weekStart);
    if (result.error === 'not_found') return E.notFound(res, 'No snapshot generated for that week');
    if (result.error === 'forbidden') return E.forbidden(res, 'You can only view your own Weekly Snapshots.');
    return ok(res, result);
  } catch (err) {
    console.error('[student-portal GET /weekly-snapshot/:weekStart]', err);
    return E.serverError(res);
  }
});

router.get('/weekly-snapshot/:weekStart/pdf', authMiddleware, PLAN, async (req, res) => {
  if (!_requireStudent(req, res)) return;
  try {
    await weeklySnapshotHelpers.streamSnapshotPdf(req, res, req.jwtUser.studentId, req.params.weekStart);
  } catch (err) {
    console.error('[student-portal GET /weekly-snapshot/:weekStart/pdf]', err);
    return E.serverError(res);
  }
});

module.exports = router;
