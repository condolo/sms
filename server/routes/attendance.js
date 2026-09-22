/* ============================================================
   Msingi — /api/attendance  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   Paginated with class/date/student/period filters.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }  = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate }        = require('../middleware/plan');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine         = require('../utils/scopeEngine');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { _model } = require('../utils/model');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const email = require('../utils/email');

/* First route migrated to tenantModel() (C4 · ADR-0001). attendance is
   entirely self-contained (one tenant-owned collection; every filter
   already carried schoolId), so this is behavior-identical — but the
   scoping is now structural: a future edit that forgets schoolId can no
   longer leak across schools, because tenantModel injects it and rejects
   any conflicting one. Tenant isolation here is enforced at the data
   accessor, not assumed in the handler. */

const router = express.Router();
const PLAN   = planGate('attendance');
const MODGATE = moduleGate('attendance');

/* ── Validation ─────────────────────────────────────────────── */
const AttendanceRecordSchema = z.object({
  studentId:  z.string().min(1),
  classId:    z.string().min(1),
  date:       z.string().min(1),          // ISO date string e.g. "2026-05-01"
  period:     z.string().optional(),      // "AM", "PM", "Period 1", etc.
  status:     z.enum(['present', 'absent', 'late', 'authorised_absence', 'excluded', 'holiday']),
  note:       z.string().max(500).optional(),
  markedBy:   z.string().optional(),      // userId of teacher (overridden by JWT)
});

const BulkAttendanceSchema = z.object({
  classId:    z.string().min(1),
  // Narrows this register to one specific stream within the class — a
  // teacher teaching, say, both 3A and 3B has two separate lessons at two
  // separate times and must mark two separate registers, not one merged
  // list. Optional and fully backward-compatible: omitted (a class with no
  // streams, or a caller who intentionally wants the whole merged class)
  // behaves exactly as before this field existed.
  streamId:   z.string().optional(),
  date:       z.string().min(1),
  period:     z.string().optional(),
  records:    z.array(z.object({
    studentId: z.string().min(1),
    status:    z.enum(['present', 'absent', 'late', 'authorised_absence', 'excluded', 'holiday']),
    note:      z.string().max(500).optional(),
  })).min(1).max(200),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/attendance ─ Paginated list ───────────────────── */
router.get('/', authMiddleware, PLAN, MODGATE, rbac('attendance', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId)    filter.classId   = req.query.classId;
    // A caller narrowing to one specific stream within a multi-stream class
    // (AttendancePage.jsx's stream picker) — ScopeEngine.applyToFilter below
    // already validates this against the caller's own scope.streamIds via
    // its existing streamAware handling (attendance IS streamAware — each
    // record carries its own streamId, stamped from the student at write
    // time), the same mechanism that already narrows classId for a
    // stream-scoped teacher even without this param.
    if (req.query.streamId)   filter.streamId  = req.query.streamId;
    if (req.query.studentId)  filter.studentId = req.query.studentId;
    if (req.query.status)     filter.status    = req.query.status;
    if (req.query.period)     filter.period    = req.query.period;

    // Date range support: ?dateFrom=2026-04-01&dateTo=2026-04-30
    if (req.query.date)       filter.date = req.query.date;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    }

    // Fold in the caller's own homeroom/form-teacher streams (see
    // scopeEngine.js's foldHomeroomScope) for this request's own scoping
    // only — never written back onto req.scope, which scopeMiddleware
    // caches per userId::schoolId for every other module's own next call
    // to read as-is.
    const originalScope = req.scope;
    req.scope = await ScopeEngine.foldHomeroomScope(req);
    ScopeEngine.applyToFilter(req, 'attendance', filter);
    req.scope = originalScope;

    const Attendance = tenantModel('attendance', tenantContext(req));
    const [docs, total] = await Promise.all([
      Attendance.find(filter)
        .sort({ date: -1, classId: 1 })
        .skip(skip).limit(limit)
        .select('-__v')
        .lean(),
      Attendance.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[attendance GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/attendance/summary ─ Attendance stats per student ─ */
router.get('/summary', authMiddleware, PLAN, MODGATE, rbac('attendance', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const filter = { schoolId };
    if (req.query.classId)   filter.classId   = req.query.classId;
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    }

    const originalScope = req.scope;
    req.scope = await ScopeEngine.foldHomeroomScope(req);
    ScopeEngine.applyToFilter(req, 'attendance', filter);
    req.scope = originalScope;

    // No classId/studentId -> one school-wide aggregate (a single object,
    // not an array) for dashboard-style summaries. With either given, keep
    // the existing per-student breakdown (an array, one row per student)
    // used by class/student-scoped consumers (e.g. StudentProfile.jsx).
    // Previously this route 400'd with neither given — the exact shape the
    // Dashboard's own call has always sent, so that widget never resolved.
    const schoolWide = !req.query.classId && !req.query.studentId;

    const Attendance = tenantModel('attendance', tenantContext(req));
    const summary = await Attendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id:        schoolWide ? null : '$studentId',
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
      },
      { $sort: { attendanceRate: 1 } }
    ]);

    if (schoolWide) {
      return ok(res, summary[0] ?? { total: 0, present: 0, absent: 0, late: 0, authorised: 0, attendanceRate: null });
    }
    return ok(res, summary);
  } catch (err) {
    console.error('[attendance GET /summary]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/attendance/school-report ─ Whole-school, per-class/stream ──
   A distinct, deliberately MORE restrictive view than plain 'attendance:
   read' — a class teacher or subject teacher with ordinary attendance
   access should not automatically see every other class's registers in
   one place. Uses hasExplicitSubGrant (no coarse-grant fallback), same
   reasoning as report-card publishing and mark-submissions review: falling
   back to plain attendance:read would hand this to every teacher the
   moment the 'attendance__report' sub exists, via the SAME role most
   teachers already hold read/create on for their own register-taking. */
router.get('/school-report', authMiddleware, PLAN, MODGATE, rbac('attendance', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const FLOOR_ROLES = new Set(['admin', 'principal', 'deputy_principal', 'deputy']);
    if (!FLOOR_ROLES.has(role) && !(await hasExplicitSubGrant(req, 'attendance', 'report', 'read'))) {
      return E.forbidden(res, 'Only admins, principals, deputies, or explicitly granted roles can view the school-wide attendance report.');
    }

    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return E.badRequest(res, 'date must be in YYYY-MM-DD format');

    const Students    = tenantModel('students', tenantContext(req));
    const Streams     = tenantModel('streams', tenantContext(req));
    const Classes     = tenantModel('classes', tenantContext(req));
    const Attendance  = tenantModel('attendance', tenantContext(req));

    const [classDocs, streamDocs, rosterAgg, dayAgg] = await Promise.all([
      Classes.find({ schoolId }).select('id name').lean(),
      Streams.find({ schoolId }).select('id name classId').lean(),
      Students.aggregate([
        { $match: { schoolId, status: 'active' } },
        { $group: { _id: { classId: '$classId', streamId: '$streamId' }, roster: { $sum: 1 } } },
      ]),
      Attendance.aggregate([
        { $match: { schoolId, date } },
        { $group: { _id: { classId: '$classId', streamId: '$streamId', status: '$status' }, count: { $sum: 1 } } },
      ]),
    ]);

    const bucketKey = (classId, streamId) => `${classId}::${streamId ?? ''}`;

    // Seed a bucket for every real (classId, streamId) pair, plus one for
    // any class that has students with no streamId at all (a class never
    // split into streams) — never for a (classId, streamId) pair that has
    // neither a roster nor any attendance recorded, so an empty class
    // doesn't clutter the report.
    const buckets = new Map();
    function bucketFor(classId, streamId) {
      const key = bucketKey(classId, streamId);
      if (!buckets.has(key)) {
        buckets.set(key, {
          classId, streamId: streamId ?? null,
          roster: 0, present: 0, absent: 0, late: 0, authorised_absence: 0, excluded: 0, holiday: 0,
        });
      }
      return buckets.get(key);
    }

    for (const row of rosterAgg) {
      const b = bucketFor(row._id.classId, row._id.streamId);
      b.roster += row.roster;
    }
    for (const row of dayAgg) {
      const b = bucketFor(row._id.classId, row._id.streamId);
      if (b[row._id.status] !== undefined) b[row._id.status] += row.count;
    }

    const classNameById  = Object.fromEntries(classDocs.map(c => [c.id, c.name]));
    const streamNameById = Object.fromEntries(streamDocs.map(s => [s.id, s.name]));

    function finalizeRow(b, streamName) {
      const marked  = b.present + b.absent + b.late + b.authorised_absence + b.excluded + b.holiday;
      const unmarked = Math.max(b.roster - marked, 0);
      const rate = b.roster > 0 ? Math.round((b.present / b.roster) * 100) : null;
      return {
        streamId: b.streamId, streamName: streamName ?? null,
        roster: b.roster, present: b.present, absent: b.absent, late: b.late,
        authorisedAbsence: b.authorised_absence, unmarked, rate,
      };
    }

    const byClass = new Map();
    for (const b of buckets.values()) {
      if (!byClass.has(b.classId)) byClass.set(b.classId, []);
      const streamName = b.streamId ? (streamNameById[b.streamId] ?? 'Unknown stream') : 'Unassigned to a stream';
      byClass.get(b.classId).push(finalizeRow(b, streamName));
    }

    const classes = [...byClass.entries()].map(([classId, streams]) => {
      const roster  = streams.reduce((s, r) => s + r.roster, 0);
      const present = streams.reduce((s, r) => s + r.present, 0);
      const rate    = roster > 0 ? Math.round((present / roster) * 100) : null;
      return {
        classId, className: classNameById[classId] ?? 'Unknown class',
        roster, present, rate,
        streams: streams.sort((a, b) => (a.streamName ?? '').localeCompare(b.streamName ?? '')),
      };
    }).sort((a, b) => a.className.localeCompare(b.className));

    const schoolRoster  = classes.reduce((s, c) => s + c.roster, 0);
    const schoolPresent = classes.reduce((s, c) => s + c.present, 0);
    const schoolWide = {
      roster: schoolRoster,
      present: schoolPresent,
      rate: schoolRoster > 0 ? Math.round((schoolPresent / schoolRoster) * 100) : null,
    };

    return ok(res, { date, schoolWide, classes });
  } catch (err) {
    console.error('[attendance GET /school-report]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/attendance/:id ─────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('attendance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Attendance = tenantModel('attendance', tenantContext(req));
    const doc = await Attendance.findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Attendance record not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[attendance GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/attendance ─ Single record ───────────────────── */
router.post('/', authMiddleware, PLAN, MODGATE, rbac('attendance', 'create'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AttendanceRecordSchema, req.body);
    if (error) return E.validation(res, error);

    // Resolve the student once — needed both to stream-scope the write
    // (a teacher whose only grant here is a compulsory subject in ONE
    // stream — see teaching-assignments.js — never appears in classIds at
    // all, so the classId-only check below would wrongly deny them their
    // own stream's attendance) and to denormalize streamId onto the
    // record itself, the same way classId already is, so later reads can
    // be scoped the same way (see scopeEngine.js's streamAware modules).
    const student = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: data.studentId }).select('streamId').lean();

    // Scope was previously only enforced on the GET list — a scoped
    // ('assigned') account could mark attendance for any class in the
    // school via this route regardless of what teaching_assignments says,
    // since the classes dropdown that feeds this form isn't scoped either.
    // This is the authoritative check; the dropdown itself is unchanged.
    // Folds in the caller's own homeroom/form-teacher streams for this
    // check only (see scopeEngine.js's foldHomeroomScope) — never written
    // back onto req.scope.
    const originalScope = req.scope;
    req.scope = await ScopeEngine.foldHomeroomScope(req);
    const inScope = ScopeEngine.isClassInScope(req, 'attendance', data.classId, student?.streamId);
    req.scope = originalScope;
    if (!inScope) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const Attendance = tenantModel('attendance', tenantContext(req));

    // Upsert: replace if same student/date/period already exists
    const filter = {
      schoolId,
      studentId: data.studentId,
      date:      data.date,
      ...(data.period ? { period: data.period } : {})
    };

    const doc = await Attendance.findOneAndUpdate(
      filter,
      { ...data, streamId: student?.streamId ?? null, schoolId, markedBy: userId, updatedBy: userId, $setOnInsert: { id: uuidv4(), createdBy: userId } },
      { upsert: true, new: true, runValidators: false }
    ).lean();

    if (doc.status === 'absent') {
      _notifyAbsences(req, [{ studentId: doc.studentId, date: doc.date }]).catch(err => console.error('[attendance/absence notify]', err));
    }

    return created(res, doc);
  } catch (err) {
    console.error('[attendance POST]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/attendance/bulk ─ Mark whole class at once ───── */
router.post('/bulk', authMiddleware, PLAN, MODGATE, rbac('attendance', 'create'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkAttendanceSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, streamId, date, period, records } = data;

    // Folds in the caller's own homeroom/form-teacher streams (see
    // scopeEngine.js's foldHomeroomScope) for every scope check in this
    // route only — restored immediately after, never written back onto
    // req.scope.
    const originalScope = req.scope;
    req.scope = await ScopeEngine.foldHomeroomScope(req);

    const wholeClassGrant = ScopeEngine.isClassInScope(req, 'attendance', classId);

    // The request targets one specific stream — validate the caller may
    // act on it at all (either via the whole-class grant above, or their
    // own scope.streamIds) before even looking at the submitted records.
    if (streamId && !wholeClassGrant) {
      const myStreamIds = req.scope?.streamIds ?? [];
      if (!myStreamIds.includes(streamId)) {
        req.scope = originalScope;
        return E.forbidden(res, 'This stream is not in your assigned scope.');
      }
    }

    // Resolve each submitted student's stream — needed to denormalize
    // streamId onto every record (same as classId already is) and, for a
    // teacher whose only grant here is one specific stream (a compulsory
    // subject — see teaching-assignments.js), to verify server-side which
    // of the submitted students they're actually allowed to mark, rather
    // than trusting the client's list wholesale. In normal use the
    // roster this form is built from is already scoped correctly (see
    // Milestone 1), so this is a defense-in-depth check, not the
    // primary UX gate.
    const studentDocs = await tenantModel('students', tenantContext(req))
      .find({ schoolId, id: { $in: records.map(r => r.studentId) } })
      .select('id streamId').lean();
    const streamByStudent = Object.fromEntries(studentDocs.map(s => [s.id, s.streamId ?? null]));

    let allowedRecords = records;
    if (streamId) {
      // A stream-targeted register: every submitted student must actually
      // belong to it — the roster this form is built from (streams.js's
      // GET /:id/students) is already scoped to exactly this stream, so a
      // mismatch here means the client and reality have diverged. Fail
      // loudly (400) rather than silently dropping the offending student,
      // since that would save an incomplete register without saying so.
      const mismatched = records.filter(r => streamByStudent[r.studentId] !== streamId);
      if (mismatched.length) {
        req.scope = originalScope;
        return E.badRequest(res, `${mismatched.length} student(s) in this submission do not belong to the requested stream.`);
      }
    } else if (!wholeClassGrant) {
      const myStreamIds = req.scope?.streamIds ?? [];
      allowedRecords = records.filter(r => myStreamIds.includes(streamByStudent[r.studentId]));
      if (allowedRecords.length === 0) {
        req.scope = originalScope;
        return E.forbidden(res, 'This class is not in your assigned scope.');
      }
    }
    req.scope = originalScope; // scope checks done — restore before the write below

    const Attendance = tenantModel('attendance', tenantContext(req));

    // Build bulk upsert operations
    const ops = allowedRecords.map(r => ({
      updateOne: {
        filter: { schoolId, studentId: r.studentId, date, classId, ...(period ? { period } : {}) },
        update: {
          $set:        { status: r.status, note: r.note || '', streamId: streamByStudent[r.studentId] ?? null, markedBy: userId, updatedBy: userId, classId, date, ...(period ? { period } : {}), schoolId },
          $setOnInsert: { id: uuidv4(), createdBy: userId }
        },
        upsert: true
      }
    }));

    const result = await Attendance.bulkWrite(ops, { ordered: false });

    const absentees = allowedRecords.filter(r => r.status === 'absent').map(r => ({ studentId: r.studentId, date }));
    if (absentees.length) {
      _notifyAbsences(req, absentees).catch(err => console.error('[attendance/bulk absence notify]', err));
    }

    return ok(res, {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      total:    allowedRecords.length,
      skipped:  records.length - allowedRecords.length
    }, null, 201);
  } catch (err) {
    console.error('[attendance POST /bulk]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/attendance/:id ─ Update record ─────────────────── */
router.put('/:id', authMiddleware, PLAN, MODGATE, rbac('attendance', 'update'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AttendanceRecordSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    delete data.schoolId; delete data.id;

    const Attendance = tenantModel('attendance', tenantContext(req));

    // Fetch first — need the record's OWN classId (and streamId, already
    // denormalized at create time) to scope-check, since a partial update
    // may not include one, and a caller could otherwise try to reassign an
    // in-scope record onto an out-of-scope class via `data.classId`.
    const existing = await Attendance.findOne({ id: req.params.id, schoolId }).select('classId streamId').lean();
    if (!existing) return E.notFound(res, 'Attendance record not found');
    const originalScope = req.scope;
    req.scope = await ScopeEngine.foldHomeroomScope(req);
    const inScope = ScopeEngine.isClassInScope(req, 'attendance', existing.classId, existing.streamId) &&
      ScopeEngine.isClassInScope(req, 'attendance', data.classId, existing.streamId);
    req.scope = originalScope;
    if (!inScope) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const doc = await Attendance.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();

    if (!doc) return E.notFound(res, 'Attendance record not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[attendance PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/attendance/:id ──────────────────────────────── */
router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('attendance', 'delete'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Attendance = tenantModel('attendance', tenantContext(req));

    const existing = await Attendance.findOne({ id: req.params.id, schoolId }).select('classId streamId').lean();
    if (!existing) return E.notFound(res, 'Attendance record not found');
    const originalScope = req.scope;
    req.scope = await ScopeEngine.foldHomeroomScope(req);
    const inScope = ScopeEngine.isClassInScope(req, 'attendance', existing.classId, existing.streamId);
    req.scope = originalScope;
    if (!inScope) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const doc = await Attendance.findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Attendance record not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[attendance DELETE/:id]', err);
    return E.serverError(res);
  }
});

/* ── Notification trigger (attendance) ───────────────────────── */
async function _notifyAbsences(req, records) {
  if (!records.length) return;
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);

  const studentIds = [...new Set(records.map(r => r.studentId))];
  const [students, school] = await Promise.all([
    tenantModel('students', ctx).find({ id: { $in: studentIds } }).select('id firstName lastName').lean(),
    _model('schools').findOne({ id: schoolId }).select('name systemEmail').lean(),
  ]);
  const nameById = Object.fromEntries(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
  const schoolName  = school?.name || '';
  const schoolEmail = school?.systemEmail || '';

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'absence_alert',
    items: records.map(r => {
      const studentName = nameById[r.studentId] || r.studentId;
      return {
        studentId: r.studentId,
        inAppSubject: `${studentName} marked absent`,
        inAppBody:    `${studentName} was marked absent on ${r.date}.`,
        emailDigestSubject: `Absence alert — ${studentName}`,
        emailDigestBody:    `${studentName} was marked absent on ${r.date}.`,
        sendEmail: (recipient) => email.sendAbsenceAlert({
          recipientName: recipient.name, recipientEmail: recipient.email,
          studentName, date: r.date,
          schoolName, schoolEmail, schoolId,
        }),
      };
    }),
  });
}

router._notifyAbsences = _notifyAbsences;

module.exports = router;
