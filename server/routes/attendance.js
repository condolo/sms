/* ============================================================
   InnoLearn — /api/attendance  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   Paginated with class/date/student/period filters.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('attendance');

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
router.get('/', authMiddleware, PLAN, rbac('attendance', 'read'), async (req, res) => {
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

    const Attendance = _model('attendance');
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
router.get('/summary', authMiddleware, PLAN, rbac('attendance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    if (!req.query.classId && !req.query.studentId) {
      return E.badRequest(res, 'classId or studentId is required for summary');
    }

    const filter = { schoolId };
    if (req.query.classId)   filter.classId   = req.query.classId;
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    }

    const Attendance = _model('attendance');
    const summary = await Attendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id:        '$studentId',
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

    return ok(res, summary);
  } catch (err) {
    console.error('[attendance GET /summary]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/attendance/:id ─────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('attendance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Attendance = _model('attendance');
    const doc = await Attendance.findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Attendance record not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[attendance GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/attendance ─ Single record ───────────────────── */
router.post('/', authMiddleware, PLAN, rbac('attendance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AttendanceRecordSchema, req.body);
    if (error) return E.validation(res, error);

    const Attendance = _model('attendance');

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

    return created(res, doc);
  } catch (err) {
    console.error('[attendance POST]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/attendance/bulk ─ Mark whole class at once ───── */
router.post('/bulk', authMiddleware, PLAN, rbac('attendance', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkAttendanceSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, date, period, records } = data;
    const Attendance = _model('attendance');

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
router.put('/:id', authMiddleware, PLAN, rbac('attendance', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AttendanceRecordSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    delete data.schoolId; delete data.id;

    const Attendance = _model('attendance');
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
router.delete('/:id', authMiddleware, PLAN, rbac('attendance', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Attendance = _model('attendance');
    const doc = await Attendance.findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Attendance record not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[attendance DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
