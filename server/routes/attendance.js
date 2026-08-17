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
const { rbac }            = require('../middleware/rbac');
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

    ScopeEngine.applyToFilter(req, 'attendance', filter);

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

    ScopeEngine.applyToFilter(req, 'attendance', filter);

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

    // Scope was previously only enforced on the GET list — a scoped
    // ('assigned') account could mark attendance for any class in the
    // school via this route regardless of what teaching_assignments says,
    // since the classes dropdown that feeds this form isn't scoped either.
    // This is the authoritative check; the dropdown itself is unchanged.
    if (!ScopeEngine.isClassInScope(req, 'attendance', data.classId)) {
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
      { ...data, schoolId, markedBy: userId, updatedBy: userId, $setOnInsert: { id: uuidv4(), createdBy: userId } },
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

    const { classId, date, period, records } = data;

    if (!ScopeEngine.isClassInScope(req, 'attendance', classId)) {
      return E.forbidden(res, 'This class is not in your assigned scope.');
    }

    const Attendance = tenantModel('attendance', tenantContext(req));

    // Build bulk upsert operations
    const ops = records.map(r => ({
      updateOne: {
        filter: { schoolId, studentId: r.studentId, date, classId, ...(period ? { period } : {}) },
        update: {
          $set:        { status: r.status, note: r.note || '', markedBy: userId, updatedBy: userId, classId, date, ...(period ? { period } : {}), schoolId },
          $setOnInsert: { id: uuidv4(), createdBy: userId }
        },
        upsert: true
      }
    }));

    const result = await Attendance.bulkWrite(ops, { ordered: false });

    const absentees = records.filter(r => r.status === 'absent').map(r => ({ studentId: r.studentId, date }));
    if (absentees.length) {
      _notifyAbsences(req, absentees).catch(err => console.error('[attendance/bulk absence notify]', err));
    }

    return ok(res, {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      total:    records.length
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

    // Fetch first — need the record's OWN classId to scope-check, since a
    // partial update may not include one, and a caller could otherwise try
    // to reassign an in-scope record onto an out-of-scope class via `data.classId`.
    const existing = await Attendance.findOne({ id: req.params.id, schoolId }).select('classId').lean();
    if (!existing) return E.notFound(res, 'Attendance record not found');
    if (!ScopeEngine.isClassInScope(req, 'attendance', existing.classId) ||
        !ScopeEngine.isClassInScope(req, 'attendance', data.classId)) {
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

    const existing = await Attendance.findOne({ id: req.params.id, schoolId }).select('classId').lean();
    if (!existing) return E.notFound(res, 'Attendance record not found');
    if (!ScopeEngine.isClassInScope(req, 'attendance', existing.classId)) {
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
