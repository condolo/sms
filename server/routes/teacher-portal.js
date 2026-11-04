/* ============================================================
   Msingi — Teacher Portal Routes
   All endpoints require JWT with role === 'teacher'.

   GET /api/teacher-portal/dashboard  — full Command Centre payload
   ============================================================ */
'use strict';

const express            = require('express');
const { v4: uuidv4 }     = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { isTimetablePublished, publishedReader } = require('../utils/timetable-publish');
const { ok, created, E } = require('../utils/response');
const { resolveTeacher } = require('../utils/resolveTeacher');
const { _inboxQuery, createDirectMessage } = require('./messages');
const { recipientSummary } = require('../utils/message-audience');
const { readExtras, messageExtras } = require('../utils/message-extras');
const { resolveCurrentPeriod } = require('./academic-config');

const router    = express.Router();
// Lowercase — matches how timetable.js's own SlotSchema actually stores
// `day` (its DAYS constant is lowercase; confirmed against real data: a
// query for 'Monday' matches 0 real documents, 'monday' matches every
// one). A capitalized array here silently broke "Today's Timetable" on
// this dashboard for every teacher, every day, since this route shipped.
const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

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
   Teacher compose — who a teacher may start a conversation with.

   Two doors, both re-resolved on the server at SEND time:
     • categories — "Parents of Form 1A", "Parents of all my classes",
       "School office", "Teachers". The client sends a key, never ids.
     • members — a saved group or a picked list of people. Those ids are
       accepted only when they are a colleague or the parent of a student
       in one of this teacher's OWN classes; a raw id from anywhere else
       is rejected, so a crafted request cannot reach another tenant or
       another teacher's parents.
   The group itself is the existing message_groups document (a reusable
   recipient list, not a room) so delivery stays an ordinary direct
   message per member — same inbox, email and push semantics as replies.
   ══════════════════════════════════════════════════════════════ */

const GUARDIAN_ROLES = ['parent', 'guardian'];
const PORTAL_ROLES = new Set([...GUARDIAN_ROLES, 'student']);
const OFFICE_ROLES = new Set(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy']);

async function _teacherAudience(req) {
  const { schoolId, userId, email } = req.jwtUser;
  const teacher = await _resolveTeacher(userId, email, schoolId).catch(() => null);
  const ownerIds = [...new Set([teacher?.userId, teacher?.id, userId].filter(Boolean))];

  const [assignments, timetable, formClass] = await Promise.all([
    tenantModel('teaching_assignments', tenantContext(req))
      .find({ schoolId, teacherId: { $in: ownerIds } }).select('classId').lean().catch(() => []),
    tenantModel('timetable', tenantContext(req))
      .find({ schoolId, teacherId: { $in: ownerIds }, isActive: true }).select('classId').lean().catch(() => []),
    teacher
      ? tenantModel('classes', tenantContext(req))
          .findOne({ schoolId, formTeacherId: teacher.id }).select('id').lean().catch(() => null)
      : Promise.resolve(null),
  ]);

  const classIds = [...new Set([
    ...assignments.map(a => a.classId),
    ...timetable.map(t => t.classId),
    ...(formClass ? [formClass.id] : []),
  ].filter(Boolean))];

  const [classDocs, staff] = await Promise.all([
    classIds.length
      ? tenantModel('classes', tenantContext(req))
          .find({ schoolId, id: { $in: classIds } }).select('id name').sort({ name: 1 }).lean().catch(() => [])
      : Promise.resolve([]),
    tenantModel('users', tenantContext(req))
      .find({ schoolId, isActive: { $ne: false }, role: { $nin: [...PORTAL_ROLES] } })
      .select('id name role').lean().catch(() => []),
  ]);

  const students = classIds.length
    ? await tenantModel('students', tenantContext(req))
        .find({ schoolId, classId: { $in: classIds } })
        .select('id classId name firstName lastName').lean().catch(() => [])
    : [];
  const studentIds = students.map(s => s.id);
  const parents = studentIds.length
    ? await tenantModel('users', tenantContext(req))
        .find({ schoolId, role: { $in: GUARDIAN_ROLES }, isActive: { $ne: false }, studentIds: { $in: studentIds } })
        .select('id name role studentIds').lean().catch(() => [])
    : [];

  const studentById = Object.fromEntries(students.map(s => [s.id, {
    id: s.id,
    classId: s.classId,
    name: s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Student',
  }]));

  const parentsByClass = Object.fromEntries(classDocs.map(c => [c.id, []]));
  const parentsByStudent = {};
  for (const parent of parents) {
    parent.children = (parent.studentIds || []).map(id => studentById[id]).filter(Boolean);
    for (const child of parent.children) {
      const list = parentsByClass[child.classId];
      if (list && !list.includes(parent.id)) list.push(parent.id);
      if (!parentsByStudent[child.id]) parentsByStudent[child.id] = [];
      if (!parentsByStudent[child.id].includes(parent.id)) parentsByStudent[child.id].push(parent.id);
    }
  }

  const colleagues = staff.filter(s => s.id !== userId);
  const byId = new Map();
  for (const s of colleagues) byId.set(s.id, { id: s.id, name: s.name || 'Staff member', role: s.role, kind: 'staff' });
  for (const p of parents) byId.set(p.id, { id: p.id, name: p.name || 'Parent', role: p.role, kind: 'parent' });

  return {
    classIds,
    classes: classDocs,
    classById: Object.fromEntries(classDocs.map(c => [c.id, c])),
    colleagues,
    parents,
    parentsByClass,
    parentsByStudent,
    studentById,
    byId,
  };
}

/** A category key → recipient ids, or null when the key is not this teacher's. */
function _resolveCategory(audience, key) {
  if (key === 'parents:all') {
    return [...new Set(Object.values(audience.parentsByClass).flat())];
  }
  if (key.startsWith('parents:')) {
    const classId = key.slice('parents:'.length);
    return Object.prototype.hasOwnProperty.call(audience.parentsByClass, classId)
      ? audience.parentsByClass[classId]
      : null;
  }
  if (key === 'staff:office') {
    return audience.colleagues.filter(s => OFFICE_ROLES.has(s.role)).map(s => s.id);
  }
  if (key === 'staff:teachers') {
    return audience.colleagues.filter(s => s.role === 'teacher').map(s => s.id);
  }
  return null;
}

/* GET /api/teacher-portal/message-recipients — what a teacher can start. */
router.get('/message-recipients', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const audience = await _teacherAudience(req);

    const categories = [];
    const seenParents = new Set();
    for (const cls of audience.classes) {
      const ids = audience.parentsByClass[cls.id] ?? [];
      ids.forEach(id => seenParents.add(id));
      if (ids.length) categories.push({ key: `parents:${cls.id}`, label: `Parents of ${cls.name}`, count: ids.length });
    }
    if (audience.classes.filter(c => (audience.parentsByClass[c.id] ?? []).length).length > 1) {
      categories.unshift({ key: 'parents:all', label: 'Parents of all my classes', count: seenParents.size });
    }
    const office = audience.colleagues.filter(s => OFFICE_ROLES.has(s.role)).length;
    if (office) categories.push({ key: 'staff:office', label: 'School office', count: office });
    const teachers = audience.colleagues.filter(s => s.role === 'teacher').length;
    if (teachers) categories.push({ key: 'staff:teachers', label: 'Teachers', count: teachers });

    const groups = await tenantModel('message_groups', tenantContext(req))
      .find({ schoolId, $or: [{ createdBy: userId }, { memberIds: userId }] })
      .sort({ updatedAt: -1 }).lean().catch(() => []);

    return ok(res, {
      categories,
      groups: groups.map(g => ({ id: g.id, name: g.name, memberCount: (g.memberIds ?? []).length })),
    });
  } catch (err) {
    console.error('[teacher-portal GET /message-recipients]', err);
    return E.serverError(res);
  }
});

/* GET /api/teacher-portal/message-contacts — the people behind a new group. */
router.get('/message-contacts', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const audience = await _teacherAudience(req);
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    return ok(res, {
      contacts: [
        ...audience.colleagues
          .map(s => ({ id: s.id, name: s.name || 'Staff member', role: s.role, kind: 'staff', detail: null }))
          .sort(byName),
        ...audience.parents
          .map(p => ({
            id: p.id,
            name: p.name || 'Parent',
            role: p.role,
            kind: 'parent',
            detail: (p.children ?? []).map(c => c.name).filter(Boolean).join(', ') || null,
          }))
          .sort(byName),
      ],
    });
  } catch (err) {
    console.error('[teacher-portal GET /message-contacts]', err);
    return E.serverError(res);
  }
});

/* Bytes live in their own collection so every thread read stays small.
   If the blob write fails, the message keeps its text but loses the
   attachment card — better than a card that downloads to an error. */
async function _persistAttachment(req, messageId, extras, attachmentBlob) {
  if (!attachmentBlob || !extras?.attachment) return;
  try {
    await tenantModel('message_attachments', tenantContext(req)).create({
      id: extras.attachment.id,
      schoolId: req.jwtUser.schoolId,
      messageId,
      name: attachmentBlob.name,
      mimeType: attachmentBlob.mimeType,
      size: attachmentBlob.size,
      data: attachmentBlob.data,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[teacher-portal attachment persist]', err);
    await tenantModel('messages', tenantContext(req))
      .updateOne({ id: messageId }, { $unset: { attachment: '' } })
      .catch(() => {});
  }
}

/* POST /api/teacher-portal/messages — start a conversation or send to a
   saved group. One message document per send, exactly like a reply. */
router.post('/messages', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const subject = String(req.body?.subject ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const groupId = typeof req.body?.groupId === 'string' ? req.body.groupId.trim() : '';
    const groupName = typeof req.body?.groupName === 'string' ? req.body.groupName.trim() : '';
    const memberIds = [...new Set(
      (Array.isArray(req.body?.memberIds) ? req.body.memberIds : [])
        .filter(id => typeof id === 'string' && id.trim())
        .map(id => id.trim()),
    )];

    if (!subject) return E.badRequest(res, 'Add a subject.');
    if (subject.length > 200) return E.badRequest(res, 'Subject must be 200 characters or fewer.');
    if (!body) return E.badRequest(res, 'Write a message first.');
    if (body.length > 4000) return E.badRequest(res, 'That message is too long.');
    if (groupName.length > 80) return E.badRequest(res, 'Group name must be 80 characters or fewer.');

    const extrasResult = readExtras(req.body);
    if (extrasResult.error) return E.badRequest(res, extrasResult.error);

    const audience = await _teacherAudience(req);
    let recipients = [];
    let group = null;

    if (groupId) {
      const saved = await tenantModel('message_groups', tenantContext(req))
        .findOne({ schoolId, id: groupId }).lean();
      if (!saved) return E.notFound(res, 'That group no longer exists.');
      if (saved.createdBy !== userId && !(saved.memberIds ?? []).includes(userId)) {
        return E.forbidden(res, 'You are not a member of that group.');
      }
      recipients = (saved.memberIds ?? []).filter(id => id !== userId && audience.byId.has(id));
      group = { id: saved.id, name: saved.name };
      if (!recipients.length) return E.badRequest(res, 'That group has no recipients you can message.');
    } else if (category) {
      const resolved = _resolveCategory(audience, category);
      if (resolved === null) return E.badRequest(res, 'That audience is not available to you.');
      recipients = resolved;
      if (!recipients.length) return E.badRequest(res, 'No one is in that audience yet.');
    } else {
      const invalid = memberIds.find(id => !audience.byId.has(id));
      if (invalid) return E.badRequest(res, 'One or more recipients are not people you can message.');
      recipients = memberIds.filter(id => id !== userId);
      if (!recipients.length) return E.badRequest(res, 'Choose at least one recipient.');

      if (groupName) {
        const sender = await tenantModel('users', tenantContext(req))
          .findOne({ schoolId, id: userId }).select('name').lean();
        const now = new Date().toISOString();
        const doc = await tenantModel('message_groups', tenantContext(req)).create({
          id: uuidv4(),
          createdBy: userId,
          createdByName: sender?.name ?? 'Teacher',
          name: groupName,
          memberIds: recipients,
          createdAt: now,
          updatedAt: now,
        });
        group = { id: doc.id, name: doc.name };
      }
    }

    const sender = await tenantModel('users', tenantContext(req))
      .findOne({ schoolId, id: userId }).select('name email').lean();
    const msg = await createDirectMessage(req, {
      recipientUserIds: recipients,
      subject,
      body,
      senderName: sender?.name || sender?.email || 'Teacher',
      senderRole: 'teacher',
      ...(group ? { groupId: group.id, groupName: group.name } : {}),
      extra: extrasResult.extras,
    });
    await _persistAttachment(req, msg.id, extrasResult.extras, extrasResult.attachmentBlob);

    return created(res, { id: msg.id, recipients, group });
  } catch (err) {
    console.error('[teacher-portal POST /messages]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/teacher-portal/students/:studentId/attendance?month=YYYY-MM
   The conversation starter: a teacher checks one of their own students'
   month of attendance (and who to message about it). Day registers only —
   an elective register is not that student's day.
   ══════════════════════════════════════════════════════════════ */
router.get('/students/:studentId/attendance', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const { schoolId } = req.jwtUser;
    const audience = await _teacherAudience(req);
    const student = audience.studentById[req.params.studentId];
    if (!student) return E.notFound(res, 'That student is not in one of your classes.');

    const now = new Date();
    const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : fallbackMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return E.badRequest(res, 'Month must look like 2026-10.');
    }

    const records = await tenantModel('attendance', tenantContext(req))
      .find({ schoolId, studentId: student.id, subjectId: null, date: { $gte: `${month}-01`, $lte: `${month}-31` } })
      .sort({ date: -1 }).limit(62)
      .select('date status note')
      .lean().catch(() => []);

    const summary = { total: records.length, present: 0, late: 0, absent: 0, authorised: 0, other: 0 };
    for (const r of records) {
      if (r.status === 'present') summary.present += 1;
      else if (r.status === 'late') summary.late += 1;
      else if (r.status === 'absent') summary.absent += 1;
      else if (r.status === 'authorised_absence') summary.authorised += 1;
      else summary.other += 1;
    }
    const attended = summary.present + summary.late;
    const pct = summary.total ? Math.round((attended / summary.total) * 100) : null;

    return ok(res, {
      student: {
        id: student.id,
        name: student.name,
        classId: student.classId,
        className: audience.classById[student.classId]?.name ?? null,
      },
      month,
      summary: { ...summary, attended, pct },
      days: records.map(r => ({ date: r.date, status: r.status, note: r.note || '' })),
      guardians: (audience.parentsByStudent[student.id] ?? [])
        .map(id => audience.byId.get(id))
        .filter(Boolean)
        .map(p => ({ id: p.id, name: p.name, role: p.role })),
    });
  } catch (err) {
    console.error('[teacher-portal GET /students/:id/attendance]', err);
    return E.serverError(res);
  }
});

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
    // 'timetable' — NOT 'timetable_slots'. See CHANGELOG (this fix) for
    // the full reasoning: these are genuinely different, both-populated
    // collections; 'timetable' is what the admin Scheduling Engine
    // (server/routes/timetable.js) actually reads and writes, while
    // 'timetable_slots' is an orphaned legacy collection nothing writes
    // to anymore. Reading the wrong one meant an admin's timetable edits
    // never reached this dashboard widget.
    const Timetable          = await publishedReader(schoolId, tenantContext(req));
    const Streams            = tenantModel('streams', tenantContext(req));
    const Subjects           = tenantModel('subjects', tenantContext(req));
    const Schools            = _model('schools');
    // behaviour_incidents, not the empty 'behaviour' — see student-portal.js.
    const Behaviour          = tenantModel('behaviour_incidents', tenantContext(req));
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
    // Reported directly 2026-10-27, "is the parent portal live, pulling
    // data as required" — this dashboard's per-class attendance % and
    // "at-risk students" list filtered the `attendance` collection by an
    // `academicYear` field that doesn't exist on it at all (confirmed
    // directly against live data), so both always came back empty/zero
    // for every teacher. Same bug as parent-portal.js's/student-portal.js's
    // identical fix — resolved by the current term's own date range
    // instead, scoped to Attendance queries specifically; the
    // Topics/Coverage queries elsewhere in this file keep using the
    // `academicYear` string above unchanged (not verified broken, out of
    // scope here).
    const academicYears = await tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean();
    const { term: currentTermDoc } = resolveCurrentPeriod(academicYears);
    const attDateFilter = currentTermDoc
      ? { date: { $gte: currentTermDoc.startDate, $lte: currentTermDoc.endDate } }
      : {};

    // ── The classes this teacher teaches ─────────────────────
    // Assignments are keyed by the teacher's LOGIN id (see teaching-
    // assignments.js's canonicalTeacherId comment: every scope check matches
    // req.jwtUser.userId), but older rows can still be keyed by the staff
    // record id. Read both so neither form is silently invisible here.
    //
    // teaching_assignments authorises a marks write, but it is not the only
    // place a school says "this teacher teaches this class": the timetable
    // and the form-teacher role carry it too. Reading assignments alone left
    // a teacher with a full timetable staring at "No classes assigned yet",
    // so myClasses is the union of all three sources.
    const assignmentOwnerIds = [teacher.userId, teacher.id].filter(Boolean);
    const [assignments, teacherTimetable, formClassDoc] = await Promise.all([
      TeachingAssignments.find({ teacherId: { $in: assignmentOwnerIds }, schoolId })
        .select('classId subjectId streamId streamName').lean(),
      // The DRAFT timetable, not the published reader: an unpublished schedule
      // still says who teaches what, and hiding a teacher's own classes
      // because the timetabler has not hit publish is a data bug, not a rule.
      tenantModel('timetable', tenantContext(req))
        .find({ schoolId, teacherId: { $in: assignmentOwnerIds }, isActive: true })
        .select('classId subjectId subject').lean().catch(() => []),
      Classes.findOne({ formTeacherId: teacher.id, schoolId })
        .select('id name formTeacherId studentCount').lean().catch(() => null),
    ]);

    const classIds = [...new Set([
      ...assignments.map(a => a.classId),
      ...teacherTimetable.map(s => s.classId),
      ...(formClassDoc ? [formClassDoc.id] : []),
    ].filter(Boolean))];
    const subjectIds = [...new Set([
      ...assignments.map(a => a.subjectId),
      ...teacherTimetable.map(s => s.subjectId),
    ].filter(Boolean))];

    // ── Today's timetable ────────────────────────────────────
    // streamId included so the dashboard can tell apart two lessons for
    // the SAME class but different streams (e.g. Math for 4A then 4B) —
    // without it, the "Take Att." deep-link below can't pre-select the
    // right stream, and the submitted-check further down would wrongly
    // conflate the two.
    // Unpublished timetables are not shown to teachers either (see utils/timetable-publish.js).
    const rawTimetableToday = !(await isTimetablePublished(schoolId)) ? [] : await Timetable.find({
      schoolId,
      day: todayDay,
      isActive: true,
      $or: [{ teacherId }, { teacherId: userId }],
    }).sort({ startTime: 1 })
      .select('subject subjectId classId streamId period periodNumber startTime endTime room teacherName')
      .lean();

    // 'timetable' stores only the FK ids (classId/streamId), not the
    // display names 'timetable_slots' used to carry — resolve them here.
    // Scoped to just today's classes/streams (not the teacher's full
    // teaching_assignments list below), since an admin-scheduled lesson
    // can exist without a matching assignment record.
    const todayClassIdsRaw  = [...new Set(rawTimetableToday.map(s => s.classId).filter(Boolean))];
    const todayStreamIdsRaw = [...new Set(rawTimetableToday.map(s => s.streamId).filter(Boolean))];
    const [todayClassNameDocs, todayStreamNameDocs] = await Promise.all([
      todayClassIdsRaw.length  ? Classes.find({ id: { $in: todayClassIdsRaw }, schoolId }).select('id name').lean().catch(() => []) : [],
      todayStreamIdsRaw.length ? Streams.find({ id: { $in: todayStreamIdsRaw }, schoolId }).select('id name').lean().catch(() => []) : [],
    ]);
    const todayClassNameMap  = Object.fromEntries(todayClassNameDocs.map(c => [c.id, c.name]));
    const todayStreamNameMap = Object.fromEntries(todayStreamNameDocs.map(s => [s.id, s.name]));
    const timetableToday = rawTimetableToday.map(s => ({
      ...s,
      subjectName: s.subject,
      className:   todayClassNameMap[s.classId] ?? null,
      streamName:  s.streamId ? (todayStreamNameMap[s.streamId] ?? null) : null,
    }));

    // Classes that appear in today's timetable
    const todayClassIds = [...new Set(timetableToday.map(s => s.classId).filter(Boolean))];

    // ── Which (class, stream) combos have attendance today ────
    // A composite key, not a plain classId distinct — a teacher with two
    // lessons today for the same class but different streams must see
    // each one's OWN submitted status, not "any register for this class
    // today" bleeding across both (the exact bug this fix closes).
    const _slotKey = (classId, streamId) => `${classId}::${streamId ?? ''}`;
    const todayAttCombos = classIds.length
      ? await Attendance.find({
          schoolId,
          date: todayISO,
          classId: { $in: todayClassIds.length ? todayClassIds : classIds },
        }).select('classId streamId').lean().catch(() => [])
      : [];
    const submittedKeys = new Set(todayAttCombos.map(a => _slotKey(a.classId, a.streamId)));

    const attendanceStatus = timetableToday.map(slot => ({
      classId:   slot.classId,
      className: slot.className,
      streamId:  slot.streamId ?? null,
      streamName: slot.streamName ?? null,
      submitted: submittedKeys.has(_slotKey(slot.classId, slot.streamId)),
    }));
    // Deduplicate by (classId, streamId) — NOT classId alone, which used
    // to silently merge two different streams' lessons into one entry.
    const attStatusMap = {};
    for (const s of attendanceStatus) {
      attStatusMap[_slotKey(s.classId, s.streamId)] = s;
    }
    // ── (class, stream) detail from today's timetable, for the widget ──
    // The attendance widget is keyed by (class, stream) only; the lesson's
    // period/subject/time come from the teacher's timetable slot for that
    // key. A (class, stream) can have several lessons in a day, so keep the
    // EARLIEST lesson's details (matches the ".sort({ startTime: 1 })" the
    // dashboard already relies on for ordering) rather than overwriting it.
    const slotDetailByKey = {};
    for (const slot of timetableToday) {
      const k = _slotKey(slot.classId, slot.streamId);
      if (!slotDetailByKey[k]) {
        slotDetailByKey[k] = {
          period:       slot.periodNumber ? String(slot.periodNumber) : (slot.period ?? ''),
          subjectName:  slot.subject ?? null,
          subjectId:    slot.subjectId ?? null,
          startTime:    slot.startTime ?? null,
        };
      }
    }

    const attendanceWidget = Object.values(attStatusMap).map((s) => {
      const detail = slotDetailByKey[_slotKey(s.classId, s.streamId)] ?? {};
      return {
        ...s,
        period:       detail.period ?? '',
        subjectName:  detail.subjectName ?? null,
        subjectId:    detail.subjectId ?? null,
        startTime:    detail.startTime ?? null,
        // The app's TeacherHomeItem reads `registerTaken`; the widget's own
        // field is `submitted`. Emit both so the two shapes stay in sync.
        registerTaken: s.submitted,
      };
    });
    const pendingCount     = attendanceWidget.filter(s => !s.registerTaken).length;

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
        Attendance.countDocuments({ schoolId, classId, ...attDateFilter }).catch(() => 0),
        Attendance.countDocuments({ schoolId, classId, ...attDateFilter, status: 'present' }).catch(() => 0),
      ]);

      const attPct = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;

      // Subject(s) this teacher teaches in this class — from the assignment
      // record where there is one, otherwise from the timetable slot's own
      // subject (a timetabled teacher may have no assignment row yet).
      const classSubjects = [...new Set([
        ...assignments
          .filter(a => a.classId === classId)
          .map(a => subjectMap[a.subjectId]?.name),
        ...teacherTimetable
          .filter(s => s.classId === classId)
          .map(s => subjectMap[s.subjectId]?.name ?? s.subject),
      ].filter(Boolean))];

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
    // Resolved with the class union above; the classDocs copy also carries
    // formTeacherId for classes that were only reachable via assignments.
    const formClassRecord = classDocs.find(c => c.formTeacherId === teacherId) || formClassDoc;

    if (formClassRecord) {
      formClass = formClassRecord;
      const fcClassId = formClassRecord.id;

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
        name:             formClassRecord.name,
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
        { $match: { schoolId, classId: { $in: classIds }, ...attDateFilter, status: 'absent' } },
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
    // A coverage record's mere EXISTENCE means "covered" — the previous
    // `covered: true` condition never matched any real document (see
    // lessons.js's POST /coverage), so this always showed 0% regardless
    // of real progress. Also now keyed by the assignment's OWN streamId
    // (when it's a stream-scoped assignment) so this teacher's Diamond
    // progress is never conflated with a colleague's Sapphire progress
    // for the same class-subject.
    let curriculumCoverage = [];
    const topAssignments = assignments.slice(0, 10);
    if (topAssignments.length) {
      curriculumCoverage = await Promise.all(topAssignments.map(async a => {
        const streamFilter = a.streamId ? { streamId: a.streamId } : { streamId: { $exists: false } };
        // Class-scoped, same as lessons.js's _topicClassFilterPart (2026-09
        // fix): a pre-migration topic with no classId is still counted for
        // every class, but a topic scoped to a DIFFERENT class must not
        // inflate this assignment's total.
        const topicClassFilter = { $or: [{ classId: a.classId }, { classId: { $exists: false } }] };
        const [total, covered] = await Promise.all([
          Topics.countDocuments({ schoolId, subjectId: a.subjectId, academicYear, ...topicClassFilter }).catch(() => 0),
          Coverage.countDocuments({ schoolId, classId: a.classId, subjectId: a.subjectId, academicYear, ...streamFilter }).catch(() => 0),
        ]);
        if (total === 0) return null;
        return {
          classId:     a.classId,
          className:   classMap[a.classId]?.name,
          streamId:    a.streamId ?? null,
          streamName:  a.streamName ?? null,
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
    // This queried a 'lesson_plans' collection that didn't exist as a real
    // feature until v5.117.0 (Trinitas + Trinity's requested lesson-plan
    // structure, see lessons.js's /plans routes) — it always silently
    // returned [] before that, which is why this card and the "N lesson(s)
    // without a plan" Today's Work count never showed anything real.
    // `status`/`startTime` below were an earlier, speculative guess at a
    // shape that was never actually built — lessons.js's real schema has
    // neither (a plan's "done" state is whether Reflection has been filled
    // in, not a stored status enum; there is no per-slot start time).
    // Filters by `userId`, NOT the local `teacherId` (= teacher.id, the
    // teachers-collection's own primary key) — lessons.js's /plans routes
    // (and teaching_assignments/lesson_coverage before them) always store
    // the ACCOUNT id in their own teacherId fields (see teaching-
    // assignments.js's schema comment: "userId format, e.g. u_demo_t3"),
    // a genuinely different identity from teacher.id. Using the local
    // `teacherId` here would silently return zero results for any school
    // where the two don't happen to coincide.
    const weekAheadISO = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const LessonPlans  = tenantModel('lesson_plans', tenantContext(req));
    const lessonPlans  = await LessonPlans.find({
      schoolId,
      teacherId: userId,
      date: { $gte: todayISO, $lte: weekAheadISO },
    }).sort({ date: 1 }).limit(10)
      .select('id classId className subjectId subjectName topicTitle subtopicTitle date objectives')
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

/* ══════════════════════════════════════════════════════════════
   GET /api/teacher-portal/inbox
   The teacher's Messages tab. Same counterpart-pairing logic as the
   parent portal's /inbox (a "thread" is the pair (this user, one
   counterpart), not a stored document) — but gated on the teacher role
   and resolving the role groups a teacher actually belongs to, so a
   teacher sees office → teacher threads (and any parent → teacher
   direct messages), not the parent-scoped view that 403s here.
   ══════════════════════════════════════════════════════════════ */
router.get('/inbox', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const Msg = tenantModel('messages', tenantContext(req));

    // Everything addressed to me (my role group or personally) plus
    // everything I sent — the two halves of a conversation in one read.
    const docs = await Msg.find({
      $or: [
        _inboxQuery({ schoolId, userId, role }),
        { schoolId, senderId: userId },
      ],
    }).sort({ createdAt: -1 }).limit(300)
      .select('id senderId senderName senderRole recipients subject body isRead createdAt groupId groupName')
      .lean();

    // A "thread" = (this teacher, one counterpart). The counterpart is the
    // other party of each message: when I sent it, the recipient; when
    // received, the sender. Group by that id. A message to several people is
    // one document, so it pairs with the first recipient — recipientSummary()
    // travels with the row so the app can say so instead of implying a
    // private chat.
    const counterpartOf = (msg) => {
      if (msg.senderId === userId) {
        const other = (msg.recipients || []).find((r) => r !== userId && r !== 'all');
        return other ? { userId: other, name: null, role: null, outboundOnly: true } : null;
      }
      return { userId: msg.senderId, name: msg.senderName || null, role: msg.senderRole || null };
    };

    const byCounterpart = new Map();
    for (const msg of docs) {
      const counterpart = counterpartOf(msg);
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
          ...recipientSummary(msg),
        });
      } else {
        existing.unread += unread;
        if (at > existing.lastAt) {
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

    // Names for conversations where the teacher sent first (counterpart is a
    // recipient id we have to resolve against users).
    const missing = [...byCounterpart.values()].filter((t) => !t.name).map((t) => t.counterpartUserId);
    if (missing.length) {
      const users = await tenantModel('users', tenantContext(req))
        .find({ schoolId, id: { $in: missing } }).select('id name role').lean().catch(() => []);
      const byId = Object.fromEntries(users.map((u) => [u.id, u]));
      for (const t of byCounterpart.values()) {
        if (!t.name && byId[t.counterpartUserId]) {
          t.name = byId[t.counterpartUserId].name || null;
          t.role = byId[t.counterpartUserId].role || null;
        }
      }
    }

    return ok(res, {
      threads: [...byCounterpart.values()]
        .map((t) => ({ ...t, name: t.name || 'School office' }))
        .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
    });
  } catch (err) {
    console.error('[teacher-portal GET /inbox]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/teacher-portal/threads/:counterpartUserId
   One conversation behind a Messages row. Same pair definition and
   same read-on-open write as the parent portal's screen-12 read —
   a thread is (this user, one counterpart), not a document — so the
   two faces cannot disagree about what a conversation contains.
   ══════════════════════════════════════════════════════════════ */
router.get('/threads/:counterpartUserId', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
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
      .select('id senderId senderName senderRole subject body isRead createdAt recipients groupId groupName kind dueAt context attachment poll')
      .lean();

    // Opening a conversation IS reading it — the same single write the
    // web inbox does on open, not a per-message round trip.
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
        ...recipientSummary(m),
        // kind/due/context/attachment plus the poll as THIS reader sees it.
        ...messageExtras(m, userId),
        // Same split as the parent read: for my own bubble this is "did the
        // counterpart open it", for theirs it is "have I".
        read: m.senderId === userId
          ? Boolean(m.isRead?.[counterpartUserId])
          : Boolean(m.isRead?.[userId]),
      })),
    });
  } catch (err) {
    console.error('[teacher-portal GET /threads/:id]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/teacher-portal/threads/:counterpartUserId/messages
   A teacher's reply. Goes through the same createDirectMessage path
   as every other compose surface so notifications and the message
   document shape stay identical.
   ══════════════════════════════════════════════════════════════ */
router.post('/threads/:counterpartUserId/messages', authMiddleware, async (req, res) => {
  if (!_requireTeacher(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const counterpartUserId = req.params.counterpartUserId;
    const body    = String(req.body?.body || '').trim();
    const subject = String(req.body?.subject || '').trim() || 'Message from teacher';

    if (!body) return E.badRequest(res, 'Write a message first.');
    if (body.length > 4000) return E.badRequest(res, 'That message is too long.');

    const extrasResult = readExtras(req.body);
    if (extrasResult.error) return E.badRequest(res, extrasResult.error);

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
      senderName: sender?.name || sender?.email || 'Teacher',
      senderRole: 'teacher',
      extra: extrasResult.extras,
    });
    await _persistAttachment(req, msg.id, extrasResult.extras, extrasResult.attachmentBlob);

    return created(res, { id: msg.id, at: msg.createdAt });
  } catch (err) {
    console.error('[teacher-portal POST /threads/:id/messages]', err);
    return E.serverError(res);
  }
});

module.exports = router;
