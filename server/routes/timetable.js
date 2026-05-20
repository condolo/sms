/* ============================================================
   Msingi — /api/timetable  (Institutional Scheduling Engine)

   Architecture:
     - Each slot: class + day + period + subject + teacher + room
     - Global conflict prevention: teacher double-booking, room double-booking
     - Multi-view: class schedule, teacher schedule, institution overview
     - Teacher workload tracking
     - Plan: standard | RBAC: timetable:{read,create,update,delete}

   Routes (order matters — specific before /:id wildcard):
     GET    /                        Filtered list
     GET    /workload                Teacher workload summary
     GET    /conflicts               Institution-wide conflict scan
     GET    /overview                All-class master grid data
     GET    /class/:classId          Full class timetable (array)
     GET    /teacher/:teacherId      Teacher weekly schedule (array)
     GET    /:id                     Single slot
     POST   /                        Create slot (with conflict checks)
     POST   /bulk                    Bulk create / replace
     PUT    /:id                     Update slot (with conflict checks)
     DELETE /:id                     Delete slot
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

/* ── Constants ───────────────────────────────────────────────── */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/* ── Validation ─────────────────────────────────────────────── */
const SlotSchema = z.object({
  classId:        z.string().min(1),
  day:            z.enum(DAYS),
  period:         z.string().min(1).max(20),          // "1", "2", "Break", etc.
  periodNumber:   z.number().int().min(0).optional(),
  subject:        z.string().max(100).optional(),      // human-readable subject name
  subjectId:      z.string().optional(),               // linked subject record
  teacherId:      z.string().optional(),               // linked teacher record (used for conflict detection)
  teacherName:    z.string().max(100).optional(),      // denormalised display name
  room:           z.string().max(100).optional(),
  startTime:      z.string().optional(),               // "09:00"
  endTime:        z.string().optional(),               // "09:55"
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  type:           z.enum(['lesson', 'break', 'lunch', 'assembly', 'registration', 'free']).default('lesson'),
  notes:          z.string().max(500).optional(),
  isActive:       z.boolean().default(true),
});

const BulkSlotSchema = z.object({
  slots:        z.array(SlotSchema).min(1).max(500),
  replaceClass: z.string().optional(),
  replaceDay:   z.enum(DAYS).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── Conflict checks ─────────────────────────────────────────── */
async function _checkConflicts(schoolId, data, excludeId = null) {
  const Timetable = _model('timetable');
  const base = { schoolId, day: data.day, period: data.period, isActive: true };
  if (excludeId) { base.id = { $ne: excludeId }; }

  // 1. Class slot collision (same class + day + period)
  const classConflict = await Timetable.findOne({ ...base, classId: data.classId }).lean();
  if (classConflict) {
    return `Slot already exists for this class on ${data.day} period ${data.period}.`;
  }

  // 2. Teacher double-booking (teacher already teaching another class at this time)
  if (data.teacherId) {
    const teacherConflict = await Timetable.findOne({ ...base, teacherId: data.teacherId }).lean();
    if (teacherConflict) {
      return `Teacher is already scheduled in another class at ${data.day} period ${data.period}.`;
    }
  }

  // 3. Room double-booking (room already occupied at this time)
  if (data.room && data.room.trim()) {
    const roomConflict = await Timetable.findOne({
      ...base,
      room: { $regex: new RegExp(`^${data.room.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    }).lean();
    if (roomConflict) {
      return `Room "${data.room}" is already occupied at ${data.day} period ${data.period}.`;
    }
  }

  return null; // no conflict
}

/* ══════════════════════════════════════════════════════════════
   LIST ROUTES (before /:id wildcard)
   ══════════════════════════════════════════════════════════════ */

/* ── GET /api/timetable ─ Filtered list ─────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.teacherId)      filter.teacherId      = req.query.teacherId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.day)            filter.day            = req.query.day;
    if (req.query.room)           filter.room           = req.query.room;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.isActive)       filter.isActive       = req.query.isActive === 'true';
    if (req.query.type)           filter.type           = req.query.type;

    const Timetable = _model('timetable');
    const [docs, total] = await Promise.all([
      Timetable.find(filter)
        .sort({ day: 1, periodNumber: 1, period: 1 })
        .skip(skip).limit(limit)
        .select('-__v').lean(),
      Timetable.countDocuments(filter),
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[timetable GET /]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/workload ─ Teacher workload summary ─── */
router.get('/workload', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, isActive: true, type: 'lesson' };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const slots = await _model('timetable')
      .find(filter)
      .select('teacherId teacherName day classId')
      .limit(10000)
      .lean();

    const wMap = {};
    slots.forEach(s => {
      if (!s.teacherId) return;
      if (!wMap[s.teacherId]) {
        wMap[s.teacherId] = {
          teacherId:   s.teacherId,
          teacherName: s.teacherName || '',
          total:       0,
          byDay:       { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 },
          classes:     new Set(),
        };
      }
      wMap[s.teacherId].total++;
      const d = (s.day || '').toLowerCase();
      if (wMap[s.teacherId].byDay[d] !== undefined) wMap[s.teacherId].byDay[d]++;
      if (s.classId) wMap[s.teacherId].classes.add(s.classId);
    });

    const result = Object.values(wMap)
      .map(w => ({ ...w, classCount: w.classes.size, classes: undefined }))
      .sort((a, b) => b.total - a.total);

    return ok(res, result);
  } catch (err) { console.error('[timetable GET /workload]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/conflicts ─ Institution-wide scan ────── */
router.get('/conflicts', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, isActive: true };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const slots = await _model('timetable')
      .find(filter)
      .select('id classId teacherId teacherName room day period subject')
      .limit(10000)
      .lean();

    const conflicts = [];
    const teacherSeen = {};  // key → first slot id
    const roomSeen    = {};  // key → first slot id

    slots.forEach(slot => {
      const id = slot.id || String(slot._id);

      if (slot.teacherId) {
        const k = `${slot.teacherId}|${slot.day}|${slot.period}`;
        if (teacherSeen[k]) {
          conflicts.push({
            type:        'teacher_double_booked',
            teacherId:   slot.teacherId,
            teacherName: slot.teacherName || slot.teacherId,
            day:         slot.day,
            period:      slot.period,
            slotIds:     [teacherSeen[k], id],
          });
        } else {
          teacherSeen[k] = id;
        }
      }

      if (slot.room && slot.room.trim()) {
        const k = `${slot.room.toLowerCase().trim()}|${slot.day}|${slot.period}`;
        if (roomSeen[k]) {
          conflicts.push({
            type:    'room_double_booked',
            room:    slot.room,
            day:     slot.day,
            period:  slot.period,
            slotIds: [roomSeen[k], id],
          });
        } else {
          roomSeen[k] = id;
        }
      }
    });

    return ok(res, { conflicts, count: conflicts.length });
  } catch (err) { console.error('[timetable GET /conflicts]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/overview ─ Institution master grid ───── */
router.get('/overview', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, isActive: true };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const slots = await _model('timetable')
      .find(filter)
      .select('classId day period subject teacherName teacherId room type')
      .limit(5000)
      .lean();

    const byClass = {};
    slots.forEach(s => {
      if (!byClass[s.classId]) {
        byClass[s.classId] = {
          classId: s.classId,
          total:   0,
          byDay:   { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 },
        };
      }
      byClass[s.classId].total++;
      const d = (s.day || '').toLowerCase();
      if (byClass[s.classId].byDay[d] !== undefined) byClass[s.classId].byDay[d]++;
    });

    return ok(res, {
      classes:    Object.values(byClass),
      totalSlots: slots.length,
    });
  } catch (err) { console.error('[timetable GET /overview]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/class/:classId ─ Class timetable ─────── */
router.get('/class/:classId', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, classId: req.params.classId, isActive: true };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const docs = await _model('timetable')
      .find(filter)
      .sort({ day: 1, periodNumber: 1, period: 1 })
      .limit(200)
      .select('-__v')
      .lean();

    return ok(res, docs);
  } catch (err) { console.error('[timetable GET /class/:classId]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/teacher/:teacherId ─ Teacher schedule ── */
router.get('/teacher/:teacherId', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, teacherId: req.params.teacherId, isActive: true };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termId)         filter.termId         = req.query.termId;

    const docs = await _model('timetable')
      .find(filter)
      .sort({ day: 1, periodNumber: 1, period: 1 })
      .limit(200)
      .select('-__v')
      .lean();

    return ok(res, docs);
  } catch (err) { console.error('[timetable GET /teacher/:teacherId]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/:id ───────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('timetable').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Timetable slot not found');
    return ok(res, doc);
  } catch (err) { console.error('[timetable GET /:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   MUTATION ROUTES
   ══════════════════════════════════════════════════════════════ */

/* ── POST /api/timetable ─ Create slot ──────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('timetable', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SlotSchema, req.body);
    if (error) return E.validation(res, error);

    const conflictMsg = await _checkConflicts(schoolId, data);
    if (conflictMsg) return E.conflict(res, conflictMsg);

    const doc = await _model('timetable').create({
      ...data,
      id:        uuidv4(),
      schoolId,
      createdBy: userId,
      updatedBy: userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[timetable POST /]', err); return E.serverError(res); }
});

/* ── POST /api/timetable/bulk ─ Bulk replace / populate ─────── */
router.post('/bulk', authMiddleware, PLAN, rbac('timetable', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkSlotSchema, req.body);
    if (error) return E.validation(res, error);

    const Timetable = _model('timetable');

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

    // Fetch current doc to merge missing fields for conflict check
    const current = await _model('timetable').findOne({ id: req.params.id, schoolId }).lean();
    if (!current) return E.notFound(res, 'Timetable slot not found');

    // Only run conflict checks if scheduling fields are being changed
    const merged = { ...current, ...data };
    const schedulingChanged = ['classId', 'day', 'period', 'teacherId', 'room'].some(f => data[f] !== undefined);
    if (schedulingChanged) {
      const conflictMsg = await _checkConflicts(schoolId, merged, req.params.id);
      if (conflictMsg) return E.conflict(res, conflictMsg);
    }

    const doc = await _model('timetable').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false },
    ).lean();

    return ok(res, doc);
  } catch (err) { console.error('[timetable PUT /:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/timetable/:id ───────────────────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('timetable', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('timetable').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Timetable slot not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[timetable DELETE /:id]', err); return E.serverError(res); }
});

module.exports = router;
