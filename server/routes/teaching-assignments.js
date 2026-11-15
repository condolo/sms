/* ============================================================
   Msingi — /api/teaching-assignments
   Pre-timetabling assignment: which teacher delivers which subject
   to which class (and, when it matters, which stream), in which
   preferred room.

   One record = "Agnes teaches Pure Maths to Class 12 in Room AL-1"

   Stream rule (class has streams, e.g. 7i / 7ii with different Maths
   teachers — a plain class-wide assignment can't express that):
     - Subject is COMPULSORY for this class (class_subjects.
       isCompulsoryForClass) AND the class actually has streams
       → streamId is REQUIRED. Each stream gets its own assignment row,
         and each is independently scoped — assigning Agnes to 7i's
         Maths does not give her visibility into 7ii.
     - Subject is ELECTIVE for this class, OR the class has no streams
       at all → streamId is OPTIONAL. Omitted = whole-class grant
       (electives commonly pool students from every stream into one
       group, so class-wide is the correct default, not a narrowing).
   See scopeEngine.js / scopeMiddleware.js for how streamId then flows
   into what a teacher can actually see.

   Taught together (v5.270.0): rows sharing `lessonGroupId` are one set
   of lessons (co-teaching and/or combined streams). POST /:id/link,
   POST /:id/unlink; see the section near the end of this file.

   This feeds:
     - Timetable slot editor auto-fill (GET ?classId=X&subjectId=Y&streamId=Z)
     - Teacher profile "Assignments" tab (GET ?teacherId=X)
     - Room availability (GET ?roomId=X)

   RBAC:
     - READ:   any authenticated user (teachers see only own)
     - WRITE:  admin, superadmin, principal, deputy, timetabler, and any role
               granted "Manage Whole-School Timetable" (v5.273.0/v5.274.0).
               Data entry happens in ONE place, Timetable → Subject
               allocation; HODs are consulted and pass the data to the
               timetabler, so they read but don't write (v5.274.0). The
               Teachers profile Assignments tab is view-only.
               Teachers who have left or are inactive can't be given an
               assignment; on-leave teachers can (flagged in the allocation).
   ============================================================ */
'use strict';

const express        = require('express');
const { z }         = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }      = require('../middleware/auth');
const { hasExplicitSubGrant } = require('../middleware/rbac');
const { TIMETABLE_FLOOR_ROLES } = require('../utils/scopeEngine');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E }      = require('../utils/response');
const { invalidateScopeCache } = require('../middleware/scopeMiddleware');
const { checkConflicts } = require('../utils/timetable-conflicts');
const { markTimetableChanged } = require('../utils/timetable-publish');

const router = express.Router();

/* ── Role helpers ────────────────────────────────────────────── */
// 'acting_deputy'/'head_of_school' are teacher.extraRoles responsibility
// tags (Settings → Staff Roles & Responsibilities — see
// server/config/staffResponsibilities.js), not real account roles.
// Listed here explicitly, alongside the real 'deputy'/'principal' role
// keys, so a teacher tagged with that responsibility keeps the same full
// management access as before the tag values were renamed off of the
// exact strings SYSTEM_ROLES uses — this is a deliberate capability
// grant, not the accidental string collision it used to be.
const FULL_MANAGE = new Set(['admin', 'superadmin', 'deputy', 'principal', 'acting_deputy', 'head_of_school']);
// 'timetable_coordinator' is the renamed responsibility tag for the OLD
// 'timetabler' value (2026-10-14) — that value collided with the real
// 'timetabler' SYSTEM_ROLES key, and this is exactly where it leaked: a
// teacher merely TAGGED "Timetabler" was silently granted the same
// broad read access below as an account actually holding the real
// timetabler role. Listed explicitly alongside the real role key in
// isTeacherOnly's check further down, same precedent as FULL_MANAGE
// above — the real role key stays (an actual timetabler account must
// still see every teacher's assignments), the tag is now an explicit
// grant rather than an accident, and existing teachers keep the same
// functional access across the rename.

function _effectiveRoles(req) {
  const role       = req.jwtUser?.role       ?? '';
  const roles      = req.jwtUser?.roles      ?? [];
  const extraRoles = req.jwtUser?.extraRoles ?? [];
  return new Set([role, ...roles, ...extraRoles]);
}

/* Returns true if user may create/edit/delete assignments.
   (subjectDepartmentId is kept for callers; it no longer changes the answer.)

   History: a HOD department rule and a "Teachers: update" grant used to open
   this too (the note below). Both were removed in v5.274.0 so there is one
   place and one rule for data entry.

   2026-09-29 (direct user request, following the identical v5.158.0 fix
   for the Teacher Edit button): this floor was entirely closed to
   Settings — no permission grant of any kind could satisfy it, unlike
   every other write path in the app. The client's own "Add assignment"
   button (TeacherList.jsx's TeacherAssignmentsTab) already unlocks for
   any role holding the Teachers module's 'update' permission (the same
   Assignments tab lives inside the same Edit-gated slide-over as the
   Profile tab's subject tags) — extending this to match is additive to
   FULL_MANAGE/HOD, never a replacement: a school that wants this
   restricted to real leadership only simply never grants 'teachers'
   update to anyone else, exactly as it could before this change. */
async function canManage(req, subjectDepartmentId = null) {
  const eff = _effectiveRoles(req);
  if ([...FULL_MANAGE].some(r => eff.has(r))) return true;

  // Timetable module owners (v5.273.0, direct instruction 2026-11-15: "the
  // timetabler should have full control of the timetable module … he doesn't
  // decide who teaches what but he is given that data to update in the
  // system"). Same rule as timetable.js's timetableManageAccess: the REAL
  // account role (jwtUser.role — never extraRoles, so a staff member merely
  // tagged with a responsibility gains nothing), or an explicit "Manage
  // Whole-School Timetable" grant.
  if (TIMETABLE_FLOOR_ROLES.has(req.jwtUser?.role)) return true;
  if (await hasExplicitSubGrant(req, 'timetable', 'manage', 'update')) return true;

  // v5.274.0 (direct instruction 2026-11-15): "HODs don't need to edit this in
  // the system, they are consulted and give data to the timetabler who enters
  // and updates it". One place for data entry — Timetable → Subject
  // allocation — so the HOD department rule and the "Teachers: update" grant
  // no longer open a second way in. HODs and teachers still READ (GET /).
  return false;
}

/* A teacher who has left or is inactive can't be given an assignment (v5.274.0).
   On leave is allowed — the allocation flags it so the timetabler can plan cover. */
function _teacherStatusProblem(teacher) {
  if (teacher.status === 'terminated') return 'That teacher has left the school. Choose a current teacher.';
  if (teacher.status === 'inactive') return 'That teacher is inactive. Choose a current teacher.';
  return null;
}

/* The id an assignment is keyed by: the teacher's LOGIN id when linked (every scope
   check matches teaching_assignments.teacherId against jwtUser.userId), self-healing a
   missing link by email; else teachers.id. Shared by POST / and PUT /:id/teacher. */
async function _canonicalTeacherId(req, teacher) {
  const { schoolId } = req.jwtUser;
  let canonicalTeacherId = teacher.userId;
  if (!canonicalTeacherId && teacher.email) {
    const matchingUser = await tenantModel('users', tenantContext(req))
      .findOne({ schoolId, email: teacher.email.toLowerCase(), isActive: { $ne: false } }).select('id').lean();
    if (matchingUser) {
      // A user doc with no `id` field (irregularly onboarded school) has a
      // JWT userId of String(_id) — auth.js's `user.id || user._id` — so
      // use that same form here. Plain `matchingUser.id` was undefined for
      // them, which fell through to teacher.id below and saved a row the
      // teacher could never see (2026-11-12, Mascit Lab Academy).
      const loginId = matchingUser.id || (matchingUser._id ? String(matchingUser._id) : null);
      if (loginId) {
        canonicalTeacherId = loginId;
        tenantModel('teachers', tenantContext(req))
          .updateOne({ schoolId, id: teacher.id }, { $set: { userId: loginId } })
          .catch(() => {});
      }
    }
  }
  return canonicalTeacherId || teacher.id;
}

/* ── Helper: find a class by either custom id (UUID) or _id (ObjectId string) ─
   Classes created before the id field was added only have _id. GET /classes
   normalises both into `id` for the frontend's own dropdowns (see its own
   "Normalize" comment), so a class missing a real id still displays and
   selects correctly — but a write route that only matches the literal `id`
   field never finds that class, surfacing as a false "Class not found" even
   though the class is right there in the picker. Same helper/reasoning as
   class-subjects.js's _classQuery, kept local rather than shared since
   every route in this codebase that needs it keeps its own copy (e.g.
   students.js's _entityIdForms). */
function _classQuery(schoolId, classId) {
  const isOid = /^[a-f\d]{24}$/i.test(classId);
  return isOid
    ? { schoolId, $or: [{ id: classId }, { _id: classId }] }
    : { schoolId, id: classId };
}

/* Same reasoning as _classQuery, for streams — see streams.js, whose own
   POST/GET routes tolerate the identical legacy _id-as-id case. */
function _streamQuery(schoolId, classId, streamId) {
  const isOid = /^[a-f\d]{24}$/i.test(streamId);
  return isOid
    ? { schoolId, classId, $or: [{ id: streamId }, { _id: streamId }] }
    : { schoolId, classId, id: streamId };
}

/* Same reasoning as _classQuery, for rooms — the Preferred Room picker
   (TeacherList.jsx's TeacherAssignmentsTab) built its option values as
   `r._id ?? r.id`, the wrong priority: every room document always has a
   Mongo _id, so that fallback never actually reached `r.id` at all — the
   dropdown was unconditionally sending the raw Mongo _id, which this
   route's literal `id`-only match then never found. "Room not found" was
   not intermittent or data-dependent; it fired on every save that picked
   a room, regardless of whether that room had a proper id (client fix is
   the real one; this is defense in depth, same as _classQuery/_streamQuery,
   in case a room is ever missing a real id via some path that hasn't been
   audited). */
function _roomQuery(schoolId, roomId) {
  const isOid = /^[a-f\d]{24}$/i.test(roomId);
  return isOid
    ? { schoolId, isActive: { $ne: false }, $or: [{ id: roomId }, { _id: roomId }] }
    : { schoolId, isActive: { $ne: false }, id: roomId };
}

/* ── Validation ─────────────────────────────────────────────── */
const AssignmentSchema = z.object({
  teacherId:       z.string().min(1),    // userId format (e.g. u_demo_t3)
  subjectId:       z.string().min(1),
  classId:         z.string().min(1),    // string id (e.g. cls_demo_4a)
  streamId:        z.string().min(1).optional(),
  preferredRoomId: z.string().optional(),
  periodsPerWeek:  z.number().int().min(1).max(40).optional(),
  // How many of those lessons are double periods (two back-to-back periods each), for the
  // timetable generator (v5.268.0). 2 × doubleLessons must fit in periodsPerWeek.
  doubleLessons:   z.number().int().min(0).max(20).optional(),
});

/* Doubles count two periods each, so they must fit in the week's total. */
function _doublesProblem(periodsPerWeek, doubleLessons) {
  if (!doubleLessons) return null;
  if (!periodsPerWeek) return 'Set periods per week before double lessons.';
  if (doubleLessons * 2 > periodsPerWeek) {
    return `${doubleLessons} double lesson${doubleLessons === 1 ? '' : 's'} need${doubleLessons === 1 ? 's' : ''} ${doubleLessons * 2} periods, but only ${periodsPerWeek} a week are set.`;
  }
  return null;
}

/* ── GET /api/teaching-assignments ──────────────────────────── */
router.get('/', authMiddleware, async (req, res) => { // rbac: self-scoped below for plain teachers, open to all other real roles — see header comment
  try {
    const { schoolId } = req.jwtUser;
    const eff          = _effectiveRoles(req);

    const filter = { schoolId };

    // Teachers can only read their own assignments
    const isTeacherOnly = eff.has('teacher') &&
      !['admin','superadmin','principal','deputy','acting_deputy','head_of_school','hod','timetabler','timetable_coordinator']
        .some(r => eff.has(r));

    if (isTeacherOnly) {
      filter.teacherId = req.jwtUser.userId ?? req.jwtUser.id;
    }

    // Query filters
    if (req.query.teacherId) {
      // Resolve to the SAME canonical id POST uses (teacher's login id when
      // linked), never the raw query value — otherwise a caller whose
      // cached teacher object only has teachers.id (no userId, e.g. a
      // stale client cache or a limited-projection fetch) gets an empty or
      // partial list here, while POST's own canonical lookup still finds
      // the real row and correctly rejects it as "already assigned". That
      // exact split was reported live: an assignment that didn't show up
      // in this list still blocked a re-add as a duplicate.
      const qTeacher = await tenantModel('teachers', tenantContext(req)).findOne({
        schoolId,
        $or: [{ userId: req.query.teacherId }, { id: req.query.teacherId }],
      }).select('id userId').lean();
      filter.teacherId = qTeacher?.userId || qTeacher?.id || req.query.teacherId;
    }
    if (req.query.classId)    filter.classId    = req.query.classId;
    if (req.query.subjectId)  filter.subjectId  = req.query.subjectId;
    // Timetable auto-fill lookup (?classId=X&subjectId=Y&streamId=Z) needs
    // this to pick the RIGHT teacher when a compulsory subject has separate,
    // stream-scoped assignments — without it, a class with two different
    // stream teachers for the same subject would match both rows and the
    // lookup couldn't tell them apart.
    if (req.query.streamId)   filter.streamId   = req.query.streamId;
    if (req.query.roomId)     filter.preferredRoomId = req.query.roomId;
    if (req.query.departmentId) filter.departmentId  = req.query.departmentId;

    const docs = await tenantModel('teaching_assignments', tenantContext(req))
      .find(filter)
      .sort({ subjectName: 1, className: 1 })
      .lean();

    // Rows saved without a denormalised teacherName (imports, seed data) showed
    // as a blank or "Teacher" wherever this list is read — the "Teach together"
    // panel, the slot editor's auto-fill. Fill it from the staff record (v5.270.0).
    // Best-effort: a failed name lookup must never break the list itself.
    const unnamed = [...new Set(docs.filter(d => !d.teacherName && d.teacherId).map(d => d.teacherId))];
    if (unnamed.length) {
      try {
        const staff = await tenantModel('teachers', tenantContext(req))
          .find({ schoolId, $or: [{ userId: { $in: unnamed } }, { id: { $in: unnamed } }] })
          .select('id userId title firstName lastName').lean();
        const nameOf = new Map();
        for (const t of staff || []) {
          const n = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
          if (t.userId) nameOf.set(t.userId, n);
          if (t.id) nameOf.set(t.id, n);
        }
        for (const d of docs) if (!d.teacherName && nameOf.has(d.teacherId)) d.teacherName = nameOf.get(d.teacherId);
      } catch (err) {
        console.error('[teaching-assignments GET] teacher names (ignored):', err.message);
      }
    }

    return ok(res, docs);
  } catch (err) {
    console.error('[teaching-assignments GET /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/teaching-assignments ─────────────────────────── */
router.post('/', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;
    const role = req.jwtUser?.role ?? '';

    const result = AssignmentSchema.safeParse(req.body);
    if (!result.success) return E.validation(res, result.error.issues);
    const { data } = result;
    const doublesErr = _doublesProblem(data.periodsPerWeek, data.doubleLessons);
    if (doublesErr) return E.badRequest(res, doublesErr);

    // Resolve entities — denormalise names at write time
    const [teacher, subject, cls, room] = await Promise.all([
      tenantModel('teachers', tenantContext(req)).findOne({
        schoolId,
        $or: [{ userId: data.teacherId }, { id: data.teacherId }],
      }).lean(),
      tenantModel('subjects', tenantContext(req)).findOne({ schoolId, id: data.subjectId, isActive: { $ne: false } }).lean(),
      tenantModel('classes', tenantContext(req)).findOne(_classQuery(schoolId, data.classId)).lean(),
      data.preferredRoomId
        ? tenantModel('rooms', tenantContext(req)).findOne(_roomQuery(schoolId, data.preferredRoomId)).lean()
        : Promise.resolve(null),
    ]);

    if (!teacher) return E.notFound(res, 'Teacher not found');
    const statusErr = _teacherStatusProblem(teacher);
    if (statusErr) return E.badRequest(res, statusErr);
    if (!subject) return E.notFound(res, 'Subject not found or inactive');
    if (!cls)     return E.notFound(res, 'Class not found');
    if (data.preferredRoomId && !room) return E.notFound(res, 'Room not found');

    // Always key the assignment by the teacher's LOGIN account id when one
    // is linked, never by data.teacherId as sent — every scope check that
    // decides what this teacher can see (Attendance/Markbook/Lessons, via
    // scopeMiddleware's _loadAssigned) matches teaching_assignments.teacherId
    // against req.jwtUser.userId, which IS the login id, not teachers.id.
    // The lookup above accepts either as input (teacher.id is the only
    // option for a teacher with no login yet), but confirmed live: 181
    // existing rows across 4 schools were keyed by teacher.id even though
    // that teacher's login was linked (teacher.userId set) — invisible to
    // them, with no error anywhere, because they were created before the
    // login existed and never re-keyed once it did. This stops new rows
    // from joining that set; see the migration note on invalidateScopeCache
    // in teachers.js/import-export.js/timetable.js for the other half.
    //
    // A second, distinct case confirmed live the same day: teacher.userId
    // can be unset even though an active login with the EXACT matching
    // email already exists — the one-time email-match at teacher-creation
    // (teachers.js POST) only fires if that login already existed AT THAT
    // moment; a login created afterward via a plain invite (no staffId)
    // never links back. Nothing upstream of this route guarantees the link
    // exists before an assignment gets created for this teacher, so self-heal
    // it here too — same by-email match timetable.js's GET /my already does
    // lazily, just exercised at the one place that can't wait for the
    // teacher to visit Timetable first.
    const canonicalTeacherId = await _canonicalTeacherId(req, teacher);

    // Same normalization GET /classes already applies for its own dropdowns
    // (see that route's "Normalize" comment) — a legacy class matched only
    // via _classQuery's _id fallback has no real `id` field, and every
    // lookup below (class_subjects, streams) needs a stable id to key on.
    if (!cls.id) cls.id = String(cls._id);
    if (room && !room.id) room.id = String(room._id);

    // Who may enter the allocation: see canManage() (v5.274.0 — one rule, no HOD branch).
    if (!(await canManage(req))) return E.forbidden(res);

    // ── Stream rule ──────────────────────────────────────────
    // The subject must already be part of this class's curriculum (the
    // Subject dropdown in both the Assignments tab and the timetable editor
    // is populated from exactly this — class_subjects — so under normal use
    // this always exists; this is the server-side backstop for direct API
    // calls). isCompulsoryForClass is the actual source of truth for
    // whether a stream is required, not the subject's own school-wide
    // isCompulsory flag — a subject can be compulsory for one class and
    // elective for another (see class-subjects.js).
    const classSubject = await tenantModel('class_subjects', tenantContext(req))
      .findOne({ schoolId, classId: cls.id, subjectId: data.subjectId }).lean();
    if (!classSubject) {
      return E.badRequest(res, 'This subject is not part of this class\'s curriculum — add it in Curriculum first.');
    }

    const classIdForms = [...new Set([cls.id, String(cls._id)].filter(Boolean))];
    const streamCount = await tenantModel('streams', tenantContext(req))
      .countDocuments({ schoolId, classId: { $in: classIdForms }, status: 'active' });

    let stream = null;
    if (data.streamId) {
      // classId as { $in: classIdForms } is a valid Mongo filter value —
      // matches the stream regardless of which id-form it was stored under.
      stream = await tenantModel('streams', tenantContext(req))
        .findOne(_streamQuery(schoolId, { $in: classIdForms }, data.streamId)).lean();
      if (!stream) return E.notFound(res, 'Stream not found in this class');
    } else if (classSubject.isCompulsoryForClass && streamCount > 0) {
      return E.badRequest(res, 'This subject is compulsory for this class, and the class has streams — select which stream this teacher covers.');
    }

    // Duplicate guard — same teacher+subject+class+stream is idempotent
    // (conflict). streamId is part of the identity now: Agnes/Maths/Year 7i
    // and Agnes/Maths/Year 7ii are two distinct, non-conflicting rows.
    const existing = await tenantModel('teaching_assignments', tenantContext(req)).findOne({
      schoolId,
      teacherId: canonicalTeacherId,
      subjectId: data.subjectId,
      classId:   data.classId,
      streamId:  stream?.id ?? null,
    }).lean();
    if (existing) {
      return E.conflict(res, stream
        ? `This teacher is already assigned to this subject in ${stream.name}`
        : 'This teacher is already assigned to this subject and class');
    }

    const teacherName = [teacher.title, teacher.firstName, teacher.lastName]
      .filter(Boolean).join(' ');

    const doc = await tenantModel('teaching_assignments', tenantContext(req)).create({
      id:                uuidv4(),
      schoolId,
      teacherId:         canonicalTeacherId,
      teacherName,
      subjectId:         data.subjectId,
      subjectName:       subject.name,
      classId:           data.classId,
      className:         cls.name,
      streamId:          stream?.id   ?? null,
      streamName:        stream?.name ?? null,
      departmentId:      subject.departmentId ?? null,
      preferredRoomId:   room?.id            ?? null,
      preferredRoomName: room?.name          ?? null,
      periodsPerWeek:    data.periodsPerWeek ?? null,
      doubleLessons:     data.doubleLessons ?? 0,
      assignedBy:        userId,
      assignedByRole:    role,
    });

    // Bust scope cache so the teacher's next request reflects the new assignment
    invalidateScopeCache(canonicalTeacherId, schoolId);
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[teaching-assignments POST /]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/teaching-assignments/:id — update preferred room / periods / double lessons ── */
router.put('/:id', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;

    const existing = await tenantModel('teaching_assignments', tenantContext(req))
      .findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');

    if (!(await canManage(req, existing.departmentId))) return E.forbidden(res);

    const UpdateSchema = z.object({
      preferredRoomId: z.string().optional().nullable(),
      periodsPerWeek:  z.number().int().min(1).max(40).optional().nullable(),
      doubleLessons:   z.number().int().min(0).max(20).optional().nullable(),
    });
    const result = UpdateSchema.safeParse(req.body);
    if (!result.success) return E.validation(res, result.error.issues);

    const patch = { updatedBy: userId };

    if ('preferredRoomId' in result.data) {
      const rId = result.data.preferredRoomId;
      if (rId) {
        const room = await tenantModel('rooms', tenantContext(req)).findOne(_roomQuery(schoolId, rId)).lean();
        if (!room) return E.notFound(res, 'Room not found');
        patch.preferredRoomId   = room.id || String(room._id);
        patch.preferredRoomName = room.name;
      } else {
        patch.preferredRoomId   = null;
        patch.preferredRoomName = null;
      }
    }
    if ('periodsPerWeek' in result.data) patch.periodsPerWeek = result.data.periodsPerWeek;
    if ('doubleLessons' in result.data) patch.doubleLessons = result.data.doubleLessons ?? 0;
    {
      const ppw = 'periodsPerWeek' in patch ? patch.periodsPerWeek : existing.periodsPerWeek;
      const dbl = 'doubleLessons' in patch ? patch.doubleLessons : (existing.doubleLessons || 0);
      const doublesErr = _doublesProblem(ppw, dbl);
      if (doublesErr) return E.badRequest(res, doublesErr);
    }

    const doc = await tenantModel('teaching_assignments', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      patch,
      { new: true, runValidators: false },
    ).lean();

    // Taught together (v5.270.0): one set of lessons, so periods/week and
    // doubles stay the same on every row of the group.
    if (existing.lessonGroupId && ('periodsPerWeek' in patch || 'doubleLessons' in patch)) {
      const shared = {};
      if ('periodsPerWeek' in patch) shared.periodsPerWeek = patch.periodsPerWeek;
      if ('doubleLessons' in patch) shared.doubleLessons = patch.doubleLessons;
      await tenantModel('teaching_assignments', tenantContext(req)).updateMany(
        { schoolId, lessonGroupId: existing.lessonGroupId, id: { $ne: existing.id } },
        { $set: { ...shared, updatedBy: userId } },
      );
    }

    invalidateScopeCache(existing.teacherId, schoolId);
    return ok(res, doc);
  } catch (err) {
    console.error('[teaching-assignments PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/teaching-assignments/:id/teacher — change who teaches it (v5.273.0) ──
   Body: { teacherId, moveLessons?: boolean }
   Used by Timetable → Subject allocation. The row is updated IN PLACE, so its id,
   periods/week, doubles, room and "taught together" link stay. Records already taken
   (attendance, marks, lesson plans, coverage) are keyed by class/subject/stream, never
   by this row, so none of them change; only who may open that class from now on does.
   Scope (scopeMiddleware._loadAssigned) comes from assignments AND the teacher's draft
   lessons: the new teacher gains access at once; the old one loses it for this subject
   once their lessons for it are moved too (moveLessons). Both scope caches are refreshed.
   moveLessons: also hand this subject's draft lessons (this class, and this stream for a
   stream row) from the old teacher to the new one. All or nothing: if any lesson would
   clash with the new teacher's other lessons, nothing changes and the clashes are listed
   (409 LESSON_CLASH). Draft only — nothing goes live until the timetable is published. */
router.put('/:id/teacher', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;
    const newTeacherInput = typeof req.body?.teacherId === 'string' ? req.body.teacherId.trim() : '';
    const moveLessons = req.body?.moveLessons === true;
    if (!newTeacherInput) return E.badRequest(res, 'Choose the teacher who will teach it.');

    const TA = tenantModel('teaching_assignments', tenantContext(req));
    const existing = await TA.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');
    if (!(await canManage(req, existing.departmentId))) return E.forbidden(res);

    const Teachers = tenantModel('teachers', tenantContext(req));
    const teacher = await Teachers.findOne({ schoolId, $or: [{ userId: newTeacherInput }, { id: newTeacherInput }] }).lean();
    if (!teacher) return E.notFound(res, 'Teacher not found');
    const statusErr = _teacherStatusProblem(teacher);
    if (statusErr) return E.badRequest(res, statusErr);
    const newTeacherId = await _canonicalTeacherId(req, teacher);

    const oldTeacher = await Teachers.findOne({ schoolId, $or: [{ userId: existing.teacherId }, { id: existing.teacherId }] }).lean();
    const oldForms = [...new Set([existing.teacherId, oldTeacher?.userId, oldTeacher?.id].filter(Boolean).map(String))];
    if (oldForms.includes(String(newTeacherId)) || (oldTeacher && oldTeacher.id === teacher.id)) {
      return E.badRequest(res, 'That teacher already teaches it.');
    }
    const duplicate = await TA.findOne({
      schoolId, id: { $ne: existing.id }, subjectId: existing.subjectId, classId: existing.classId,
      streamId: existing.streamId ?? null, teacherId: { $in: [...new Set([newTeacherId, teacher.userId, teacher.id].filter(Boolean))] },
    }).lean();
    if (duplicate) return E.conflict(res, 'That teacher already has this subject for this class.');

    const teacherName = [teacher.title, teacher.firstName, teacher.lastName].filter(Boolean).join(' ');

    // Lessons to hand over, checked before anything is written.
    let lessons = [];
    if (moveLessons) {
      const cls = await tenantModel('classes', tenantContext(req)).findOne(_classQuery(schoolId, existing.classId)).select('id').lean();
      const classForms = [...new Set([existing.classId, cls?.id, cls?._id && String(cls._id)].filter(Boolean))];
      const streamClause = existing.streamId ? [{ streamId: existing.streamId }, { streamIds: existing.streamId }] : null;
      lessons = await tenantModel('timetable', tenantContext(req)).find({
        schoolId, isActive: true, classId: { $in: classForms },
        $and: [
          { $or: [{ subjectId: existing.subjectId }, ...(existing.subjectName ? [{ subjectId: { $in: [null, ''] }, subject: existing.subjectName }] : [])] },
          { $or: [{ teacherId: { $in: oldForms } }, { coTeacherIds: { $in: oldForms } }] },
          ...(streamClause ? [{ $or: streamClause }] : []),
        ],
      }).lean();
      const clashes = [];
      for (const l of lessons) {
        if (!l.day || !l.startTime || !l.endTime) continue;
        const candidate = oldForms.includes(String(l.teacherId))
          ? { ...l, teacherId: newTeacherId }
          : { ...l, coTeacherIds: (l.coTeacherIds || []).map(id => (oldForms.includes(String(id)) ? newTeacherId : id)) };
        const clash = await checkConflicts(schoolId, candidate, [l.id || String(l._id)]);
        if (clash) clashes.push(`${l.day} ${l.startTime}–${l.endTime}: ${clash}`);
      }
      if (clashes.length) {
        return res.status(409).json({ success: false, error: {
          code: 'LESSON_CLASH',
          message: `${teacherName || 'That teacher'} is already busy for ${clashes.length} of these lessons. Nothing was changed. Move those lessons first, or change the teacher without moving lessons.`,
          clashes: clashes.slice(0, 20),
        } });
      }
    }

    const now = new Date().toISOString();
    const updated = await TA.findOneAndUpdate(
      { id: existing.id, schoolId },
      { $set: { teacherId: newTeacherId, teacherName, updatedBy: userId, updatedAt: now, reassignedFrom: existing.teacherId, reassignedAt: now } },
      { new: true },
    ).lean();

    let moved = 0;
    if (lessons.length) {
      const Timetable = tenantModel('timetable', tenantContext(req));
      for (const l of lessons) {
        const filter = l.id ? { schoolId, id: l.id } : { schoolId, _id: l._id };
        const set = oldForms.includes(String(l.teacherId))
          ? { teacherId: newTeacherId, teacherName, updatedBy: userId, updatedAt: now }
          : {
            coTeacherIds: (l.coTeacherIds || []).map(id => (oldForms.includes(String(id)) ? newTeacherId : id)),
            coTeacherNames: (l.coTeacherIds || []).map((id, i) => (oldForms.includes(String(id)) ? teacherName : (l.coTeacherNames || [])[i])),
            updatedBy: userId, updatedAt: now,
          };
        await Timetable.updateOne(filter, { $set: set });
        moved++;
      }
      if (moved) await markTimetableChanged(schoolId);
    }

    invalidateScopeCache(existing.teacherId, schoolId);
    invalidateScopeCache(newTeacherId, schoolId);
    return ok(res, { assignment: updated, movedLessons: moved });
  } catch (err) {
    console.error('[teaching-assignments PUT /:id/teacher]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/teaching-assignments/:id ───────────────────── */
router.delete('/:id', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId } = req.jwtUser;

    const existing = await tenantModel('teaching_assignments', tenantContext(req))
      .findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');

    if (!(await canManage(req, existing.departmentId))) return E.forbidden(res);

    await tenantModel('teaching_assignments', tenantContext(req)).deleteOne({ id: req.params.id, schoolId });
    invalidateScopeCache(existing.teacherId, schoolId);
    await _tidyGroup(req, existing.lessonGroupId);
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[teaching-assignments DELETE /:id]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   TAUGHT TOGETHER (v5.270.0) — `lessonGroupId`
   Rows sharing a lessonGroupId are ONE set of lessons:
     - two teachers, same class/stream/subject  → co-teaching
       (both are in every lesson);
     - same subject in two streams of a class    → combined streams
       (the streams are taught together);
     - or both at once.
   Each row stays an ordinary assignment, so every assignment-based scope
   (attendance, marks, lesson plans…) keeps working unchanged for each
   teacher and stream. The timetable generator, Lessons to place and the
   lesson views read the group. Periods/week and doubles are kept equal
   across a group (it is one set of lessons).
   ══════════════════════════════════════════════════════════════ */

/* A group of one is no group: clear it. */
async function _tidyGroup(req, groupId) {
  if (!groupId) return;
  const { schoolId } = req.jwtUser;
  const TA = tenantModel('teaching_assignments', tenantContext(req));
  const left = await TA.find({ schoolId, lessonGroupId: groupId }).select('id').lean();
  if (left.length === 1) await TA.updateOne({ schoolId, id: left[0].id }, { $set: { lessonGroupId: null } });
}

/* POST /api/teaching-assignments/:id/link — { withId } */
router.post('/:id/link', authMiddleware, async (req, res) => { // rbac: canManage() below for both rows — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;
    const withId = typeof req.body?.withId === 'string' ? req.body.withId : '';
    if (!withId || withId === req.params.id) return E.badRequest(res, 'Choose another assignment to teach together with.');
    const TA = tenantModel('teaching_assignments', tenantContext(req));
    const [a, b] = await Promise.all([
      TA.findOne({ schoolId, id: req.params.id }).lean(),
      TA.findOne({ schoolId, id: withId }).lean(),
    ]);
    if (!a || !b) return E.notFound(res, 'Assignment not found');
    if (!(await canManage(req, a.departmentId)) || !(await canManage(req, b.departmentId))) return E.forbidden(res);
    if (String(a.subjectId) !== String(b.subjectId)) return E.badRequest(res, 'Only lessons of the same subject can be taught together.');
    // Same class, in any of its id forms.
    const cls = await tenantModel('classes', tenantContext(req)).findOne(_classQuery(schoolId, a.classId)).select('id').lean();
    const forms = cls ? [cls.id, cls._id && String(cls._id)].filter(Boolean).map(String) : [String(a.classId)];
    if (!forms.includes(String(b.classId))) return E.badRequest(res, 'Only lessons of the same class can be taught together.');
    // Two rows for the same teacher and stream can't exist (POST refuses), but
    // a whole-class row plus a stream row of the same class would make no sense together.
    if (!a.streamId !== !b.streamId) return E.badRequest(res, 'A whole-class assignment can\'t be combined with a single stream\'s. Use one row per stream.');

    const groupId = a.lessonGroupId || b.lessonGroupId || uuidv4();
    // Merging two existing groups: move every row of b's group into a's.
    const otherGroup = a.lessonGroupId && b.lessonGroupId && a.lessonGroupId !== b.lessonGroupId ? b.lessonGroupId : null;
    const filter = { schoolId, $or: [{ id: { $in: [a.id, b.id] } }, ...(otherGroup ? [{ lessonGroupId: otherGroup }] : []), ...(a.lessonGroupId ? [{ lessonGroupId: a.lessonGroupId }] : [])] };
    const members = await TA.find(filter).select('id teacherId').lean();
    // One set of lessons: the row you link from sets periods/week and doubles for all.
    await TA.updateMany({ schoolId, id: { $in: members.map(m => m.id) } }, {
      $set: { lessonGroupId: groupId, periodsPerWeek: a.periodsPerWeek ?? null, doubleLessons: a.doubleLessons || 0, updatedBy: userId },
    });
    for (const m of members) invalidateScopeCache(m.teacherId, schoolId);
    const out = await TA.find({ schoolId, lessonGroupId: groupId }).lean();
    return ok(res, { lessonGroupId: groupId, members: out });
  } catch (err) {
    console.error('[teaching-assignments POST /:id/link]', err);
    return E.serverError(res);
  }
});

/* POST /api/teaching-assignments/:id/unlink — taught on its own again */
router.post('/:id/unlink', authMiddleware, async (req, res) => { // rbac: canManage() below — real-role + HOD department-scope check
  try {
    const { schoolId, userId } = req.jwtUser;
    const TA = tenantModel('teaching_assignments', tenantContext(req));
    const row = await TA.findOne({ schoolId, id: req.params.id }).lean();
    if (!row) return E.notFound(res, 'Assignment not found');
    if (!(await canManage(req, row.departmentId))) return E.forbidden(res);
    if (!row.lessonGroupId) return ok(res, { id: row.id, lessonGroupId: null });
    await TA.updateOne({ schoolId, id: row.id }, { $set: { lessonGroupId: null, updatedBy: userId } });
    await _tidyGroup(req, row.lessonGroupId);
    invalidateScopeCache(row.teacherId, schoolId);
    return ok(res, { id: row.id, lessonGroupId: null });
  } catch (err) {
    console.error('[teaching-assignments POST /:id/unlink]', err);
    return E.serverError(res);
  }
});

module.exports = router;
// test-only access — same pattern as settings.js's _deriveApiPerms export.
// Role Architecture Audit 2026-08: proves extraRoles' authorization path
// (a narrow grant on this route specifically, not a general RBAC grant)
// resolves exactly as documented.
module.exports.canManage = canManage;
module.exports._effectiveRoles = _effectiveRoles;
