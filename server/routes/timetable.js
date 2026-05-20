/* ============================================================
   Msingi — /api/timetable  (Institutional Scheduling Engine)

   Architecture:
     - Each slot: class + day + period + subject + teacher + room
     - startTime/endTime denormalised onto every slot at create time,
       resolved from the class's section bell schedule. This enables
       cross-section conflict detection (a teacher can't teach Primary
       P3 07:30–08:30 AND Secondary P2 07:45–09:00 simultaneously).
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
const { resolveBellSchedule } = require('./bell-schedule');

const router = express.Router();
const PLAN   = planGate('timetable');

/* ── Constants ───────────────────────────────────────────────── */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/* ── Section inference (mirrors frontend inferSection) ────────── */
function _inferSection(className = '') {
  const n = (className || '').toLowerCase();
  if (/kinder|^kg|^pp\s?[12]|nursery|playgroup/i.test(n)) return 'kg';
  if (/grade\s*[1-6]|std\s*[1-6]|class\s*[1-6]|primary|year\s*[1-6]/i.test(n)) return 'primary';
  if (/form\s*[1-4]|grade\s*[7-9]|year\s*[7-9]|junior\s*sec/i.test(n)) return 'secondary';
  if (/form\s*[5-6]|year\s*1[0-3]|a.?level|sixth/i.test(n)) return 'alevel';
  return 'all';
}

/* ── Validation ─────────────────────────────────────────────── */
const SlotSchema = z.object({
  classId:        z.string().min(1),
  day:            z.enum(DAYS),
  period:         z.string().min(1).max(20),          // "1", "2", "Break", etc.
  periodNumber:   z.number().int().min(0).optional(),
  subject:        z.string().max(100).optional(),
  subjectId:      z.string().optional(),
  teacherId:      z.string().optional(),
  teacherName:    z.string().max(100).optional(),
  room:           z.string().max(100).optional(),
  startTime:      z.string().optional(),               // "HH:MM" — auto-filled from bell schedule
  endTime:        z.string().optional(),               // "HH:MM" — auto-filled from bell schedule
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

/* ── Time helpers ────────────────────────────────────────────── */

/**
 * Returns true if two time ranges overlap (exclusive boundaries).
 * Requires HH:MM strings — comparable lexicographically.
 */
function _timesOverlap(start1, end1, start2, end2) {
  if (!start1 || !end1 || !start2 || !end2) return false;
  return start1 < end2 && end1 > start2;
}

/**
 * Resolve the actual start/end times for a period key in a given section.
 * Returns { startTime, endTime } or null if the period key isn't in the schedule.
 */
async function _resolveSlotTimes(schoolId, section, periodKey) {
  try {
    const { periods } = await resolveBellSchedule(schoolId, section);
    const entry = periods.find(p => String(p.p) === String(periodKey));
    if (!entry || entry.isBreak) return null;
    return { startTime: entry.start, endTime: entry.end };
  } catch {
    return null;
  }
}

/**
 * Given a classId, look up the class name and infer its section.
 */
async function _sectionForClass(schoolId, classId) {
  try {
    const Classes = _model('classes');
    const cls = await Classes.findOne({
      schoolId,
      $or: [{ id: classId }, { _id: classId }],
    }).lean();
    return cls ? _inferSection(cls.name) : 'all';
  } catch {
    return 'all';
  }
}

/* ── Conflict checks ─────────────────────────────────────────── */
/**
 * Check for scheduling conflicts.
 * Uses time-overlap when startTime/endTime are available — this is what
 * makes cross-section teacher double-booking detectable:
 *   Primary P3 (09:30–10:30) overlaps with Secondary P2 (09:30–11:00)
 *   even though they have different period keys.
 *
 * Falls back to exact period-key match for old slots without stored times.
 */
async function _checkConflicts(schoolId, data, excludeId = null) {
  const Timetable = _model('timetable');
  const base = { schoolId, day: data.day, isActive: true };
  if (excludeId) base.id = { $ne: excludeId };

  // 1. Class slot collision — same class, same day, same period key
  const classConflict = await Timetable.findOne({
    ...base, classId: data.classId, period: data.period,
  }).lean();
  if (classConflict) {
    return `Slot already exists for this class on ${data.day} period ${data.period}.`;
  }

  // 2. Teacher double-booking — time-overlap aware across all sections
  if (data.teacherId) {
    const teacherSlots = await Timetable.find({ ...base, teacherId: data.teacherId }).lean();
    for (const s of teacherSlots) {
      const overlap = (data.startTime && s.startTime)
        ? _timesOverlap(data.startTime, data.endTime, s.startTime, s.endTime)
        : data.period === s.period;
      if (overlap) {
        const when = (data.startTime && s.startTime)
          ? `${data.startTime}–${data.endTime} overlaps with ${s.startTime}–${s.endTime}`
          : `${data.day} period ${data.period}`;
        return `Teacher is already scheduled in another class at ${when}.`;
      }
    }
  }

  // 3. Room double-booking — time-overlap aware across all sections
  if (data.room && data.room.trim()) {
    const roomRe = new RegExp(
      `^${data.room.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i',
    );
    const roomSlots = await Timetable.find({ ...base, room: roomRe }).lean();
    for (const s of roomSlots) {
      const overlap = (data.startTime && s.startTime)
        ? _timesOverlap(data.startTime, data.endTime, s.startTime, s.endTime)
        : data.period === s.period;
      if (overlap) {
        const when = (data.startTime && s.startTime)
          ? `${data.startTime}–${data.endTime}`
          : `${data.day} period ${data.period}`;
        return `Room "${data.room}" is already occupied at ${when}.`;
      }
    }
  }

  return null;
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
      .select('teacherId teacherName day classId section')
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
          sections:    new Set(),
          classes:     new Set(),
        };
      }
      wMap[s.teacherId].total++;
      const d = (s.day || '').toLowerCase();
      if (wMap[s.teacherId].byDay[d] !== undefined) wMap[s.teacherId].byDay[d]++;
      if (s.classId) wMap[s.teacherId].classes.add(s.classId);
      if (s.section) wMap[s.teacherId].sections.add(s.section);
    });

    const result = Object.values(wMap)
      .map(w => ({
        ...w,
        classCount:   w.classes.size,
        sectionCount: w.sections.size,
        sections:     [...w.sections],
        classes:      undefined,
      }))
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
      .select('id classId teacherId teacherName room day period subject startTime endTime section')
      .limit(10000)
      .lean();

    const conflicts = [];

    // Group by teacher+day and room+day — then check pairwise for overlap
    const teacherDay = {};
    const roomDay    = {};

    slots.forEach(slot => {
      const id = slot.id || String(slot._id);

      if (slot.teacherId) {
        const k = `${slot.teacherId}|${slot.day}`;
        if (!teacherDay[k]) teacherDay[k] = [];
        teacherDay[k].push({ ...slot, _slotId: id });
      }
      if (slot.room && slot.room.trim()) {
        const k = `${slot.room.toLowerCase().trim()}|${slot.day}`;
        if (!roomDay[k]) roomDay[k] = [];
        roomDay[k].push({ ...slot, _slotId: id });
      }
    });

    // Teacher conflicts — time-overlap or exact period match (for legacy slots)
    Object.values(teacherDay).forEach(daySlots => {
      for (let i = 0; i < daySlots.length; i++) {
        for (let j = i + 1; j < daySlots.length; j++) {
          const a = daySlots[i], b = daySlots[j];
          const conflict = (a.startTime && b.startTime)
            ? _timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)
            : a.period === b.period;
          if (conflict) {
            conflicts.push({
              type:        'teacher_double_booked',
              teacherId:   a.teacherId,
              teacherName: a.teacherName || a.teacherId,
              day:         a.day,
              // Show times if available, else period keys
              period:      (a.startTime && b.startTime)
                ? `${a.startTime}–${a.endTime} / ${b.startTime}–${b.endTime}`
                : a.period,
              sectionsInvolved: [...new Set([a.section, b.section].filter(Boolean))],
              slotIds:     [a._slotId, b._slotId],
            });
          }
        }
      }
    });

    // Room conflicts — same approach
    Object.values(roomDay).forEach(daySlots => {
      for (let i = 0; i < daySlots.length; i++) {
        for (let j = i + 1; j < daySlots.length; j++) {
          const a = daySlots[i], b = daySlots[j];
          const conflict = (a.startTime && b.startTime)
            ? _timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)
            : a.period === b.period;
          if (conflict) {
            conflicts.push({
              type:    'room_double_booked',
              room:    a.room,
              day:     a.day,
              period:  (a.startTime && b.startTime)
                ? `${a.startTime}–${a.endTime} / ${b.startTime}–${b.endTime}`
                : a.period,
              sectionsInvolved: [...new Set([a.section, b.section].filter(Boolean))],
              slotIds: [a._slotId, b._slotId],
            });
          }
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
      .select('classId day period subject teacherName teacherId room type section')
      .limit(5000)
      .lean();

    const byClass = {};
    slots.forEach(s => {
      if (!byClass[s.classId]) {
        byClass[s.classId] = {
          classId: s.classId,
          section: s.section || 'all',
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
      .sort({ day: 1, startTime: 1, periodNumber: 1, period: 1 })
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

    // Resolve the section for this class, then auto-populate startTime/endTime
    // from that section's bell schedule so cross-section conflicts can be detected.
    const section = await _sectionForClass(schoolId, data.classId);
    data.section  = section;
    if (!data.startTime) {
      const times = await _resolveSlotTimes(schoolId, section, data.period);
      if (times) { data.startTime = times.startTime; data.endTime = times.endTime; }
    }

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

    // Resolve section + times for each slot; cache by classId to avoid N+1
    const sectionCache = {};
    const toInsert = await Promise.all(data.slots.map(async s => {
      if (!sectionCache[s.classId]) {
        sectionCache[s.classId] = await _sectionForClass(schoolId, s.classId);
      }
      const section = sectionCache[s.classId];
      let { startTime, endTime } = s;
      if (!startTime) {
        const times = await _resolveSlotTimes(schoolId, section, s.period);
        if (times) { startTime = times.startTime; endTime = times.endTime; }
      }
      return {
        ...s, startTime, endTime,
        section,
        id:        uuidv4(),
        schoolId,
        createdBy: userId,
        updatedBy: userId,
      };
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

    const current = await _model('timetable').findOne({ id: req.params.id, schoolId }).lean();
    if (!current) return E.notFound(res, 'Timetable slot not found');

    const merged = { ...current, ...data };

    // Re-resolve section + times if period or classId changed
    const scheduleChanged = ['classId', 'day', 'period'].some(f => data[f] !== undefined);
    if (scheduleChanged) {
      const section = await _sectionForClass(schoolId, merged.classId);
      merged.section = section;
      if (!data.startTime) {
        const times = await _resolveSlotTimes(schoolId, section, merged.period);
        if (times) { merged.startTime = times.startTime; merged.endTime = times.endTime; }
      }
      data.section   = merged.section;
      data.startTime = merged.startTime;
      data.endTime   = merged.endTime;
    }

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
