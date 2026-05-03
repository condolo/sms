/* ============================================================
   InnoLearn — /api/timetable  (Timetable Management)
   Each slot: class + day + period + subject + teacher + room.
   Plan: standard | RBAC: timetable:{read,create,update,delete}
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
const PLAN   = planGate('timetable');

/* ── Validation ─────────────────────────────────────────────── */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const SlotSchema = z.object({
  classId:        z.string().min(1),
  day:            z.enum(DAYS),
  period:         z.string().min(1).max(20),      // "1", "2", "Break", etc.
  periodNumber:   z.number().int().min(0).optional(),
  subjectId:      z.string().optional(),
  teacherId:      z.string().optional(),
  room:           z.string().max(100).optional(),
  startTime:      z.string().optional(),           // "09:00"
  endTime:        z.string().optional(),           // "09:55"
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  type:           z.enum(['lesson', 'break', 'lunch', 'assembly', 'registration', 'free']).default('lesson'),
  notes:          z.string().max(200).optional(),
  isActive:       z.boolean().default(true),
});

const BulkSlotSchema = z.object({
  slots:        z.array(SlotSchema).min(1).max(500),
  replaceClass: z.string().optional(),  // if set, delete all existing slots for this classId first
  replaceDay:   z.enum(DAYS).optional(), // if set together with replaceClass, only replace that day
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/timetable ─ Filtered timetable ────────────────── */
router.get('/', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId)      filter.classId      = req.query.classId;
    if (req.query.teacherId)    filter.teacherId    = req.query.teacherId;
    if (req.query.subjectId)    filter.subjectId    = req.query.subjectId;
    if (req.query.day)          filter.day          = req.query.day;
    if (req.query.room)         filter.room         = req.query.room;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)       filter.termId       = req.query.termId;
    if (req.query.isActive)     filter.isActive     = req.query.isActive === 'true';

    const Timetable = _model('timetable');
    const [docs, total] = await Promise.all([
      Timetable.find(filter)
        .sort({ day: 1, periodNumber: 1, period: 1 })
        .skip(skip).limit(limit)
        .select('-__v').lean(),
      Timetable.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[timetable GET]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/class/:classId ─ Full class timetable ── */
router.get('/class/:classId', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, classId: req.params.classId, isActive: true };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const docs = await _model('timetable').find(filter)
      .sort({ day: 1, periodNumber: 1, period: 1 })
      .select('-__v').lean();

    // Group by day for easier frontend rendering
    const byDay = {};
    DAYS.forEach(d => { byDay[d] = []; });
    docs.forEach(s => { if (byDay[s.day]) byDay[s.day].push(s); });

    return ok(res, { slots: docs, byDay });
  } catch (err) { console.error('[timetable/class/:classId GET]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/teacher/:teacherId ─ Teacher timetable ─ */
router.get('/teacher/:teacherId', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, teacherId: req.params.teacherId, isActive: true };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const docs = await _model('timetable').find(filter)
      .sort({ day: 1, periodNumber: 1 })
      .select('-__v').lean();

    const byDay = {};
    DAYS.forEach(d => { byDay[d] = []; });
    docs.forEach(s => { if (byDay[s.day]) byDay[s.day].push(s); });

    return ok(res, { slots: docs, byDay });
  } catch (err) { console.error('[timetable/teacher/:teacherId GET]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/:id ───────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('timetable').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Timetable slot not found');
    return ok(res, doc);
  } catch (err) { console.error('[timetable GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/timetable ─ Create single slot ───────────────── */
router.post('/', authMiddleware, PLAN, rbac('timetable', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SlotSchema, req.body);
    if (error) return E.validation(res, error);

    // Check for slot collision: same class + day + period
    const Timetable = _model('timetable');
    const conflict  = await Timetable.findOne({ schoolId, classId: data.classId, day: data.day, period: data.period, isActive: true }).lean();
    if (conflict) return E.conflict(res, `A slot already exists for ${data.classId} on ${data.day} period ${data.period}`);

    const doc = await Timetable.create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[timetable POST]', err); return E.serverError(res); }
});

/* ── POST /api/timetable/bulk ─ Replace / populate timetable ── */
router.post('/bulk', authMiddleware, PLAN, rbac('timetable', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkSlotSchema, req.body);
    if (error) return E.validation(res, error);

    const Timetable = _model('timetable');

    // Optional: delete existing slots before bulk insert
    if (data.replaceClass) {
      const delFilter = { schoolId, classId: data.replaceClass };
      if (data.replaceDay) delFilter.day = data.replaceDay;
      await Timetable.deleteMany(delFilter);
    }

    const toInsert = data.slots.map(s => ({
      ...s,
      id:        uuidv4(),
      schoolId,
      createdBy: userId,
      updatedBy: userId,
    }));

    await Timetable.insertMany(toInsert, { ordered: false });

    return ok(res, { created: toInsert.length, replaced: !!data.replaceClass }, null, 201);
  } catch (err) { console.error('[timetable POST /bulk]', err); return E.serverError(res); }
});

/* ── PUT /api/timetable/:id ─ Update slot ───────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SlotSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const doc = await _model('timetable').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Timetable slot not found');
    return ok(res, doc);
  } catch (err) { console.error('[timetable PUT/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/timetable/:id ───────────────────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('timetable', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('timetable').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Timetable slot not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[timetable DELETE/:id]', err); return E.serverError(res); }
});

module.exports = router;
