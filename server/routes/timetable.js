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
const { sanitisePdfStr }      = require('../utils/sanitisePdf');

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

    // Build a quick id→slot lookup so we can resolve classIds per conflict later
    const slotById = {};
    slots.forEach(s => { slotById[s.id || String(s._id)] = s; });

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
              teacherName: a.teacherName || a.teacherId,   // resolved below
              day:         a.day,
              // Show times if available, else period keys
              period:      (a.startTime && b.startTime)
                ? `${a.startTime}–${a.endTime} / ${b.startTime}–${b.endTime}`
                : a.period,
              sectionsInvolved: [...new Set([a.section, b.section].filter(Boolean))],
              slotIds:     [a._slotId, b._slotId],
              classIds:    [a.classId, b.classId].filter(Boolean),
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
              classIds: [a.classId, b.classId].filter(Boolean),
            });
          }
        }
      }
    });

    // ── Enrich: resolve real teacher names + class names ──────────
    // 1. Teacher names — look up any teacherId that was used as a fallback name
    const unresolvedTeacherIds = [...new Set(
      conflicts
        .filter(c => c.type === 'teacher_double_booked' && c.teacherName === c.teacherId)
        .map(c => c.teacherId),
    )];
    const teacherNameMap = {};
    if (unresolvedTeacherIds.length) {
      const teachers = await _model('teachers').find({
        schoolId,
        $or: [{ userId: { $in: unresolvedTeacherIds } }, { id: { $in: unresolvedTeacherIds } }],
      }).select('userId id firstName lastName title').lean();
      teachers.forEach(t => {
        const name = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
        if (t.userId) teacherNameMap[t.userId] = name;
        if (t.id)     teacherNameMap[t.id]     = name;
      });
    }

    // 2. Class names — batch look up from classes collection
    const allClassIds = [...new Set(conflicts.flatMap(c => c.classIds ?? []))];
    const classNameMap = {};
    if (allClassIds.length) {
      const classes = await _model('classes').find({
        schoolId,
        $or: [{ id: { $in: allClassIds } }, { _id: { $in: allClassIds } }],
      }).select('id name').lean();
      classes.forEach(c => {
        if (c.id)  classNameMap[c.id]          = c.name;
        classNameMap[String(c._id)]             = c.name;
      });
    }

    // 3. Apply enrichment to each conflict
    conflicts.forEach(c => {
      if (c.type === 'teacher_double_booked' && teacherNameMap[c.teacherId]) {
        c.teacherName = teacherNameMap[c.teacherId];
      }
      c.classNames = (c.classIds ?? [])
        .map(cid => classNameMap[cid] ?? cid)
        .filter(Boolean);
      delete c.classIds;  // classNames supersedes this
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

/* ── Helper: can caller edit/manage the timetable? ──────────── */
function _canEdit(req) {
  const { role, roles = [] } = req.jwtUser || {};
  const ed = new Set(['superadmin', 'admin', 'deputy', 'timetabler']);
  return ed.has(role) || roles.some(r => ed.has(r));
}

/* ── GET /api/timetable/status ─ Publish state ──────────────── */
router.get('/status', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const school = await _model('schools').findOne({ id: req.jwtUser.schoolId }).lean();
    const s = school?.timetableStatus ?? { published: false, publishedAt: null, termLabel: '' };
    return ok(res, s);
  } catch (err) { console.error('[timetable GET /status]', err); return E.serverError(res); }
});

/* ── POST /api/timetable/publish ────────────────────────────── */
router.post('/publish', authMiddleware, PLAN, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { termLabel = '' } = req.body;
    const now = new Date().toISOString();
    const { schoolId, userId } = req.jwtUser;

    await _model('schools').updateOne({ id: schoolId }, {
      $set: {
        'timetableStatus.published':   true,
        'timetableStatus.publishedAt': now,
        'timetableStatus.publishedBy': userId,
        'timetableStatus.termLabel':   termLabel.trim(),
      },
    });

    // Snapshot version metadata on every publish
    const slotCount = await _model('timetable').countDocuments({ schoolId, isActive: true });
    await _model('timetable_versions').create({
      id:          uuidv4(),
      schoolId,
      termLabel:   termLabel.trim(),
      publishedAt: now,
      publishedBy: userId,
      slotCount,
    });

    return ok(res, { published: true, publishedAt: now, termLabel: termLabel.trim() });
  } catch (err) { console.error('[timetable POST /publish]', err); return E.serverError(res); }
});

/* ── POST /api/timetable/unpublish ─────────────────────────── */
router.post('/unpublish', authMiddleware, PLAN, rbac('timetable', 'update'), async (req, res) => {
  try {
    await _model('schools').updateOne({ id: req.jwtUser.schoolId }, {
      $set: { 'timetableStatus.published': false },
    });
    return ok(res, { published: false });
  } catch (err) { console.error('[timetable POST /unpublish]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/my ─ Teacher or section-head portal ── */
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { schoolId, role, roles = [], email, userId } = req.jwtUser;
    const allRoles  = [role, ...roles];
    const isTeacher = allRoles.includes('teacher');
    const isSectionHead = allRoles.includes('section_head');

    if (!isTeacher && !isSectionHead) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Endpoint is for teachers and section heads' } });
    }

    // Published gate (admins/editors bypass)
    if (!_canEdit(req)) {
      const school = await _model('schools').findOne({ id: schoolId }).lean();
      if (!school?.timetableStatus?.published) {
        return ok(res, { slots: [], teacher: null, message: 'Timetable has not been published yet.' });
      }
    }

    if (isSectionHead) {
      const user    = await _model('users').findOne({ id: userId, schoolId }).lean();
      const section = user?.sectionAssigned ?? null;
      const filter  = { schoolId, isActive: true };
      if (section) filter.section = section;
      const slots = await _model('timetable').find(filter)
        .sort({ day: 1, startTime: 1, period: 1 }).limit(5000).lean();
      return ok(res, { slots, section: section ?? 'all', role: 'section_head' });
    }

    // Teacher — resolve teacher record by email
    const teacher = await _model('teachers')
      .findOne({ schoolId, email: (email || '').toLowerCase() }).lean();
    if (!teacher) {
      return ok(res, { slots: [], teacher: null, message: 'No teacher record is linked to this account.' });
    }
    const slots = await _model('timetable')
      .find({ schoolId, teacherId: teacher.id, isActive: true })
      .sort({ day: 1, startTime: 1, periodNumber: 1, period: 1 })
      .limit(500).lean();
    return ok(res, {
      slots,
      teacher: { id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName },
      role: 'teacher',
    });
  } catch (err) { console.error('[timetable GET /my]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/my-children ─ Parent/guardian portal ── */
router.get('/my-children', authMiddleware, async (req, res) => {
  try {
    const { schoolId, guardianOf = [] } = req.jwtUser;

    if (!guardianOf.length) {
      return ok(res, { children: [], message: 'No children linked to this account.' });
    }

    const school = await _model('schools').findOne({ id: schoolId }).lean();
    if (!school?.timetableStatus?.published) {
      return ok(res, { children: [], notPublished: true, message: 'Timetable has not been published yet.' });
    }

    const students = await _model('students')
      .find({ id: { $in: guardianOf }, schoolId }).lean();

    const children = await Promise.all(students.map(async student => {
      const slots = student.classId
        ? await _model('timetable')
          .find({ schoolId, classId: student.classId, isActive: true })
          .sort({ day: 1, startTime: 1, period: 1 }).limit(300).lean()
        : [];
      return {
        student: {
          id:        student.id,
          firstName: student.firstName,
          lastName:  student.lastName,
          classId:   student.classId,
          className: student.className,
        },
        slots,
      };
    }));

    return ok(res, { children, termLabel: school.timetableStatus?.termLabel ?? '' });
  } catch (err) { console.error('[timetable GET /my-children]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   SUBSTITUTION ROUTES
   Date-specific overrides of the master timetable.
   Substitutions NEVER modify timetable_slots — they are always
   date-specific records stored separately.
   ══════════════════════════════════════════════════════════════ */

/* GET /api/timetable/substitutions?date=YYYY-MM-DD */
router.get('/substitutions', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { date, from, to } = req.query;
    const filter = { schoolId };
    if (date) {
      filter.date = date;
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to)   filter.date.$lte = to;
    }
    const substitutions = await _model('substitutions')
      .find(filter).sort({ date: 1, period: 1 }).limit(500).lean();
    return ok(res, { substitutions });
  } catch (err) { console.error('[substitutions GET]', err); return E.serverError(res); }
});

/* GET /api/timetable/substitutions/cover-pdf?date=YYYY-MM-DD
   Generates a printable A4 landscape PDF cover sheet for the given date.
   Columns: Absent · Lesson · Reason · Subject · Class · Type · Substitutes · Signature */
router.get('/substitutions/cover-pdf', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: { code: 'MISSING_PARAMS', message: 'date is required' } });

    const [subs, school] = await Promise.all([
      _model('substitutions').find({ schoolId, date }).sort({ originalTeacherId: 1, period: 1 }).lean(),
      _model('schools').findOne({ id: schoolId }).lean(),
    ]);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    const schoolName    = sanitisePdfStr(school?.name ?? 'School');
    const schoolAddress = sanitisePdfStr([school?.address, school?.town ?? school?.city, school?.country].filter(Boolean).join(' · '));

    const dateLabel = (() => {
      try {
        return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        }).toUpperCase();
      } catch { return date; }
    })();

    // Absent teacher intro line: "Ms Ruth (1, 2, 3), Mr Kamau (4, 5)"
    const teacherPeriods = {};
    subs.forEach(s => {
      if (!teacherPeriods[s.originalTeacherId]) teacherPeriods[s.originalTeacherId] = { name: s.originalTeacherName, periods: new Set() };
      teacherPeriods[s.originalTeacherId].periods.add(String(s.period));
    });
    const absentLine = Object.values(teacherPeriods)
      .map(({ name, periods }) => `${name} (${[...periods].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')})`)
      .join(', ');

    const REASON_LABELS = {
      sick: 'Sick', urgent_issue: 'Urgent issue', emergency: 'Emergency',
      professional_development: 'PD', personal: 'Personal',
      bereavement: 'Bereavement', other: 'Other',
    };
    const TYPE_LABELS = { teaching: 'Teaching', supervision: 'Supervision', cover: 'Cover' };

    // A4 landscape
    const doc     = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="cover-sheet-${date}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    const pageW    = doc.page.width;   // ~841pt for A4 landscape
    const pageH    = doc.page.height;  // ~595pt
    const margin   = 40;
    const contentW = pageW - margin * 2;

    // ── Header ─────────────────────────────────────────────────────
    let y = margin;
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000')
      .text(schoolName, margin, y, { width: contentW, align: 'center' });
    y = doc.y;
    if (schoolAddress) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#555')
        .text(schoolAddress, margin, y, { width: contentW, align: 'center' });
      y = doc.y;
    }
    y += 5;
    doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 8;

    // ── Title ──────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
      .text('TEACHING LESSON SUBSTITUTIONS', margin, y, { width: contentW, align: 'center' });
    y = doc.y + 1;
    doc.font('Helvetica').fontSize(9.5).fillColor('#333')
      .text(dateLabel, margin, y, { width: contentW, align: 'center' });
    y = doc.y + 5;

    if (absentLine) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#444')
        .text(`Unfortunately, the following teachers will not teach today: ${absentLine}`, margin, y, { width: contentW });
      y = doc.y + 6;
    } else {
      y += 4;
    }

    // ── Table ──────────────────────────────────────────────────────
    const ROW_H  = 24;
    const HEAD_H = 26;

    // Column widths sum to ~762pt to fill contentW (~762pt at A4 landscape)
    const cols = [
      { label: 'ABSENT',      w: 118 },
      { label: 'LESSON',      w: 50  },
      { label: 'REASON',      w: 80  },
      { label: 'SUBJECT',     w: 80  },
      { label: 'CLASS',       w: 72  },
      { label: 'TYPE',        w: 72  },
      { label: 'SUBSTITUTES', w: 128 },
      { label: 'SIGNATURE',   w: 162 },
    ];
    let cx = margin;
    cols.forEach(c => { c.x = cx; cx += c.w; });

    const tableTop = y;

    // Header row
    doc.rect(margin, tableTop, contentW, HEAD_H).fillColor('#1e293b').fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    cols.forEach(c => {
      doc.text(c.label, c.x + 5, tableTop + 9, { width: c.w - 10, lineBreak: false });
    });

    if (subs.length === 0) {
      doc.rect(margin, tableTop + HEAD_H, contentW, 40).fillColor('#f9fafb').fill();
      doc.font('Helvetica').fontSize(9).fillColor('#9ca3af')
        .text('No substitution records for this date.', margin, tableTop + HEAD_H + 14, { width: contentW, align: 'center' });
    } else {
      // Group rows by teacher so the Absent cell can visually span the group
      const groups = [];
      const groupIdx = {};
      subs.forEach(s => {
        const key = s.originalTeacherId;
        if (groupIdx[key] === undefined) { groupIdx[key] = groups.length; groups.push({ name: s.originalTeacherName, rows: [] }); }
        groups[groupIdx[key]].rows.push(s);
      });

      let ry = tableTop + HEAD_H;

      groups.forEach((group, gi) => {
        const groupStartY = ry;

        group.rows.forEach((s, ri) => {
          const bg = (gi + ri) % 2 === 0 ? '#f8fafc' : '#ffffff';
          // Row background (cols 1–7; col 0 overdrawn per-group below)
          doc.rect(cols[1].x, ry, contentW - cols[0].w, ROW_H).fillColor(bg).fill();

          // Lesson
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b')
            .text(String(s.period), cols[1].x + 5, ry + 6, { width: cols[1].w - 10, lineBreak: false });
          if (s.startTime) {
            doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
              .text(s.startTime, cols[1].x + 5, ry + 15, { width: cols[1].w - 10, lineBreak: false });
          }
          // Reason
          doc.font('Helvetica').fontSize(8.5).fillColor('#374151')
            .text(REASON_LABELS[s.reason] ?? s.reason ?? '—', cols[2].x + 5, ry + 8, { width: cols[2].w - 10, lineBreak: false });
          // Subject
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1e293b')
            .text(s.subject || '—', cols[3].x + 5, ry + 8, { width: cols[3].w - 10, lineBreak: false });
          // Class
          doc.font('Helvetica').fontSize(8.5).fillColor('#374151')
            .text(s.className || s.classId || '—', cols[4].x + 5, ry + 8, { width: cols[4].w - 10, lineBreak: false });
          // Type
          const typeRaw = s.type;
          const typeLabel = TYPE_LABELS[typeRaw] ?? (typeRaw ? typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1) : 'Supervision');
          doc.font('Helvetica').fontSize(8.5).fillColor('#374151')
            .text(typeLabel, cols[5].x + 5, ry + 8, { width: cols[5].w - 10, lineBreak: false });
          // Substitutes
          const hasSub = !!s.substituteTeacherName;
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(hasSub ? '#059669' : '#b45309')
            .text(s.substituteTeacherName || 'UNCOVERED', cols[6].x + 5, ry + 8, { width: cols[6].w - 10, lineBreak: false });
          // Signature line
          doc.moveTo(cols[7].x + 10, ry + ROW_H - 6)
            .lineTo(cols[7].x + cols[7].w - 10, ry + ROW_H - 6)
            .strokeColor('#d1d5db').lineWidth(0.5).stroke();

          ry += ROW_H;
        });

        // Absent cell — spans the full group height (drawn after rows so it sits on top)
        const spanH = group.rows.length * ROW_H;
        doc.rect(cols[0].x, groupStartY, cols[0].w, spanH).fillColor('#fef2f2').fill();
        const nameY = groupStartY + Math.max(7, (spanH - 10) / 2);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#7f1d1d')
          .text(group.name, cols[0].x + 5, nameY, { width: cols[0].w - 10, lineBreak: false });
      });

      // Grid lines
      const tableH = HEAD_H + subs.length * ROW_H;
      doc.strokeColor('#e2e8f0').lineWidth(0.5);
      doc.rect(margin, tableTop, contentW, tableH).stroke();
      cols.slice(1).forEach(c => {
        doc.moveTo(c.x, tableTop).lineTo(c.x, tableTop + tableH).stroke();
      });
      for (let r = 0; r <= subs.length; r++) {
        const ly = tableTop + HEAD_H + r * ROW_H;
        doc.moveTo(margin, ly).lineTo(pageW - margin, ly).stroke();
      }
    }

    // ── Footer ─────────────────────────────────────────────────────
    const printedAt = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    doc.font('Helvetica').fontSize(7).fillColor('#aaaaaa')
      .text(`${schoolName}  ·  Printed: ${printedAt}  ·  Msingi Platform`, margin, pageH - margin - 10, { width: contentW, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[substitutions GET /cover-pdf]', err);
    return E.serverError(res);
  }
});

/* POST /api/timetable/substitutions/absent
   Given a teacherId + date, fetches all their slots for that day
   and creates substitution records (status: uncovered) for each.
   Idempotent — skips periods that already have records.           */
router.post('/substitutions/absent', authMiddleware, PLAN, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { teacherId, date, reason = 'sick', notes = '' } = req.body;

    if (!teacherId || !date) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'teacherId and date are required' } });
    }

    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayOfWeek = DAY_NAMES[new Date(date + 'T00:00:00').getDay()];
    if (!['monday','tuesday','wednesday','thursday','friday'].includes(dayOfWeek)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Substitutions only apply on school days (Mon–Fri)' } });
    }

    // Resolve teacher profile — accept either teacher profile id (tch_demo_2) OR user id (u_demo_t2)
    const teacher = await _model('teachers').findOne({
      schoolId,
      $or: [{ id: teacherId }, { userId: teacherId }],
    }).lean();

    // Timetable slots may store teacher by userId OR by profile id — search both
    const slotIds = [...new Set([teacherId, teacher?.userId, teacher?.id].filter(Boolean))];

    // All slots for this teacher on that weekday
    const slots = await _model('timetable').find({
      schoolId, teacherId: { $in: slotIds }, day: dayOfWeek, isActive: true,
      type: { $in: ['lesson', 'assembly', 'registration'] },
    }).lean();

    if (!slots.length) {
      return ok(res, { substitutions: [], message: 'No lessons found for this teacher on that day.' });
    }

    // Use userId as the canonical originalTeacherId so it matches slot format
    const canonicalTeacherId = teacher?.userId ?? teacherId;
    const teacherName = teacher
      ? `${teacher.title ?? ''} ${teacher.firstName} ${teacher.lastName}`.trim()
      : teacherId;

    // Skip periods already recorded for this teacher + date (check all possible ID formats)
    const existing = await _model('substitutions')
      .find({ schoolId, originalTeacherId: { $in: slotIds }, date }).lean();
    const existingPeriods = new Set(existing.map(s => s.period));

    const toCreate = slots
      .filter(s => !existingPeriods.has(s.period))
      .map(s => ({
        id:                    uuidv4(),
        schoolId,
        date,
        dayOfWeek,
        period:                s.period,
        startTime:             s.startTime ?? null,
        endTime:               s.endTime   ?? null,
        classId:               s.classId,
        className:             s.className ?? s.classId,
        subject:               s.subject   ?? '',
        room:                  s.room      ?? '',
        originalTeacherId:     canonicalTeacherId,
        originalTeacherName:   teacherName,
        substituteTeacherId:   null,
        substituteTeacherName: null,
        reason,
        notes,
        status:    'uncovered',
        createdBy: userId,
        createdAt: new Date().toISOString(),
      }));

    const created = toCreate.length
      ? await _model('substitutions').insertMany(toCreate)
      : [];

    const all = [
      ...existing,
      ...created.map(d => d.toObject ? d.toObject() : d),
    ].sort((a, b) => String(a.period).localeCompare(String(b.period)));

    return ok(res, { substitutions: all, created: created.length, alreadyExisted: existing.length });
  } catch (err) { console.error('[substitutions POST /absent]', err); return E.serverError(res); }
});

/* POST /api/timetable/substitutions/auto-assign
   For every uncovered substitution record on a given date, finds the best
   available teacher (same dept → fewest lessons) and assigns them.
   Tracks assignments within this call to avoid double-booking at same period. */
router.post('/substitutions/auto-assign', authMiddleware, PLAN, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: { code: 'MISSING_PARAMS', message: 'date is required' } });

    const DOW = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const day = DOW[new Date(date + 'T12:00:00').getDay()];

    const Sub = _model('substitutions');

    const [uncovered, allTeachers, weeklySlots] = await Promise.all([
      Sub.find({ schoolId, date, status: 'uncovered' }).lean(),
      _model('teachers').find({ schoolId, status: 'active' }).lean(),
      _model('timetable').find({ schoolId, isActive: true }).select('teacherId').lean(),
    ]);

    if (!uncovered.length) return ok(res, { assigned: 0, message: 'No uncovered lessons to assign.' });

    const weeklyLoad = {};
    weeklySlots.forEach(s => {
      if (s.teacherId) {
        const k = String(s.teacherId);
        weeklyLoad[k] = (weeklyLoad[k] || 0) + 1;
      }
    });

    // All absent teacher IDs — they cannot be assigned as substitutes
    const absentIds = new Set(uncovered.map(s => String(s.originalTeacherId)));

    let assigned = 0;
    // Track per-period assignments made THIS call so we don't double-book
    const thisRunByPeriod = {}; // period -> Set<teacherId>

    // Process in period order so earlier periods get first pick
    const sorted = uncovered.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));

    for (const record of sorted) {
      const p = String(record.period);
      if (!thisRunByPeriod[p]) thisRunByPeriod[p] = new Set();

      // Teachers already teaching at this period on this weekday
      const busySlots = await _model('timetable')
        .find({ schoolId, day, period: p, isActive: true })
        .select('teacherId').lean();
      const busyIds = new Set(busySlots.map(s => String(s.teacherId)).filter(Boolean));

      // Substitutes already covering this period today (DB + this run)
      const dbCovered = await Sub.find({
        schoolId, date, period: p, substituteTeacherId: { $exists: true, $ne: null },
      }).select('substituteTeacherId').lean();
      const coveredIds = new Set([
        ...dbCovered.map(s => String(s.substituteTeacherId)).filter(Boolean),
        ...thisRunByPeriod[p],
      ]);

      const subjLower = (record.subject || '').toLowerCase().trim();

      const candidate = allTeachers
        .map(t => {
          // Use userId as canonical id to match slot teacherId format
          const uid  = String(t.userId ?? '');
          const pid  = String(t.id ?? t._id ?? '');
          const tid  = uid || pid;
          const dept = (t.department || '').toLowerCase();
          const sameDept = !!(subjLower && dept && (
            dept.includes(subjLower.substring(0, 3)) ||
            subjLower.includes(dept.substring(0, 3))
          ));
          const load = (weeklyLoad[uid] ?? 0) + (uid !== pid ? (weeklyLoad[pid] ?? 0) : 0);
          return { id: tid, uid, pid, t, load, sameDept };
        })
        .filter(({ uid, pid }) => {
          const isBusy    = (uid && busyIds.has(uid))    || (pid && busyIds.has(pid));
          const isAbsent  = (uid && absentIds.has(uid))  || (pid && absentIds.has(pid));
          const isCovered = (uid && coveredIds.has(uid)) || (pid && coveredIds.has(pid));
          return (uid || pid) && !isBusy && !isAbsent && !isCovered;
        })
        .sort((a, b) => {
          if (a.sameDept && !b.sameDept) return -1;
          if (!a.sameDept && b.sameDept) return  1;
          return a.load - b.load;
        })[0];

      if (candidate) {
        const t       = candidate.t;
        const subName = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
        await Sub.findOneAndUpdate(
          { id: record.id, schoolId },
          { $set: {
            substituteTeacherId:   candidate.id,
            substituteTeacherName: subName,
            status:                'covered',
            updatedBy:             userId,
            updatedAt:             new Date().toISOString(),
          }},
        );
        thisRunByPeriod[p].add(candidate.id);
        assigned++;
      }
    }

    return ok(res, { assigned, total: uncovered.length });
  } catch (err) {
    console.error('[substitutions POST /auto-assign]', err);
    return E.serverError(res);
  }
});

/* PUT /api/timetable/substitutions/:id — assign substitute or update status */
router.put('/substitutions/:id', authMiddleware, PLAN, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { substituteTeacherId, notes, status, type } = req.body;

    const update = { updatedBy: userId, updatedAt: new Date().toISOString() };

    if (substituteTeacherId !== undefined) {
      if (substituteTeacherId) {
        const sub = await _model('teachers').findOne({ id: substituteTeacherId, schoolId }).lean();
        update.substituteTeacherId   = substituteTeacherId;
        update.substituteTeacherName = sub
          ? `${sub.title ?? ''} ${sub.firstName} ${sub.lastName}`.trim()
          : substituteTeacherId;
        update.status = 'covered';
      } else {
        update.substituteTeacherId   = null;
        update.substituteTeacherName = null;
        update.status = 'uncovered';
      }
    }
    if (notes  !== undefined) update.notes  = notes;
    if (type   !== undefined) update.type   = type;
    if (status !== undefined && substituteTeacherId === undefined) update.status = status;

    const doc = await _model('substitutions').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: update },
      { new: true }
    ).lean();

    if (!doc) return E.notFound(res, 'Substitution record not found');
    return ok(res, doc);
  } catch (err) { console.error('[substitutions PUT /:id]', err); return E.serverError(res); }
});

/* DELETE /api/timetable/substitutions/:id */
router.delete('/substitutions/:id', authMiddleware, PLAN, rbac('timetable', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('substitutions').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Substitution record not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[substitutions DELETE /:id]', err); return E.serverError(res); }
});

/* ── GET /api/timetable/versions — publish history ─────────── */
router.get('/versions', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const versions = await _model('timetable_versions')
      .find({ schoolId }).sort({ publishedAt: -1 }).limit(20).lean();
    return ok(res, { versions });
  } catch (err) { console.error('[timetable GET /versions]', err); return E.serverError(res); }
});

/* GET /api/timetable/available-teachers?date=YYYY-MM-DD&period=5&subject=MAT
   Returns active teachers who are free at the given period on the date's weekday.
   Excludes: teachers scheduled in master timetable at that period, teachers
   marked absent today, substitutes already covering another slot at that period.
   Sorted: same-department first, then fewest weekly lessons (most available). */
router.get('/available-teachers', authMiddleware, PLAN, rbac('timetable', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { date, period, subject = '' } = req.query;
    if (!date || !period) {
      return res.status(400).json({ error: { code: 'MISSING_PARAMS', message: 'date and period are required' } });
    }

    const DOW = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const day = DOW[new Date(date + 'T12:00:00').getDay()];

    // Run all lookups in parallel
    const [busySlots, absentSubs, coveredSubs, allTeachers, weeklySlots] = await Promise.all([
      // Teachers scheduled at this period on this weekday (master timetable)
      _model('timetable').find({ schoolId, day, period: String(period), isActive: true })
        .select('teacherId').lean(),
      // Teachers already marked absent today
      _model('substitutions').find({ schoolId, date })
        .select('originalTeacherId').lean(),
      // Substitutes already covering another slot at this exact period today
      _model('substitutions').find({
        schoolId, date, period: String(period),
        substituteTeacherId: { $exists: true, $ne: null },
      }).select('substituteTeacherId').lean(),
      // All active teachers for this school
      _model('teachers').find({ schoolId, status: 'active' }).lean(),
      // All slots (for weekly load count)
      _model('timetable').find({ schoolId, isActive: true }).select('teacherId').lean(),
    ]);

    const busyIds    = new Set(busySlots.map(s => String(s.teacherId)).filter(Boolean));
    const absentIds  = new Set(absentSubs.map(s => String(s.originalTeacherId)).filter(Boolean));
    const coveredIds = new Set(coveredSubs.map(s => String(s.substituteTeacherId)).filter(Boolean));

    const weeklyLoad = {};
    weeklySlots.forEach(s => {
      if (s.teacherId) {
        const k = String(s.teacherId);
        weeklyLoad[k] = (weeklyLoad[k] || 0) + 1;
      }
    });

    const subjLower = subject.toLowerCase().trim();

    const available = allTeachers
      .filter(t => {
        // Timetable slots store teacherId as userId (u_demo_t2); profiles store userId separately.
        // Check both profile id and userId so exclusions work regardless of which format the slot uses.
        const uid  = String(t.userId ?? '');
        const pid  = String(t.id ?? t._id ?? '');
        const isBusy    = (uid && busyIds.has(uid))    || (pid && busyIds.has(pid));
        const isAbsent  = (uid && absentIds.has(uid))  || (pid && absentIds.has(pid));
        const isCovered = (uid && coveredIds.has(uid)) || (pid && coveredIds.has(pid));
        return (uid || pid) && !isBusy && !isAbsent && !isCovered;
      })
      .map(t => {
        // Use userId as the canonical tid so it matches slot teacherId format for weeklyLoad lookup
        const uid  = String(t.userId ?? '');
        const pid  = String(t.id ?? t._id ?? '');
        const tid  = uid || pid;
        const dept = (t.department || '').toLowerCase();
        // Subject similarity: compare subject against department name
        const sameDepartment = !!(subjLower && dept && (
          dept.includes(subjLower.substring(0, 3)) ||
          subjLower.includes(dept.substring(0, 3))
        ));
        // Weekly load: check both userId and profileId keys
        const load = (weeklyLoad[uid] ?? 0) + (uid !== pid ? (weeklyLoad[pid] ?? 0) : 0);
        return {
          id:             tid,
          firstName:      t.firstName ?? '',
          lastName:       t.lastName  ?? '',
          name:           [t.title, t.firstName, t.lastName].filter(Boolean).join(' '),
          department:     t.department ?? null,
          weeklyLoad:     load,
          sameDepartment,
          suggested:      false,
        };
      })
      .sort((a, b) => {
        // Same dept first, then ascending weekly load (most free at top)
        if (a.sameDepartment && !b.sameDepartment) return -1;
        if (!a.sameDepartment && b.sameDepartment) return  1;
        return a.weeklyLoad - b.weeklyLoad;
      });

    if (available.length) available[0].suggested = true;

    return ok(res, { available, period, day, date });
  } catch (err) {
    console.error('[timetable GET /available-teachers]', err);
    return E.serverError(res);
  }
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
