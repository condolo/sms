/* ============================================================
   Msingi — Bell Schedule Routes
   Supports per-section schedules so multi-level schools can have
   different lesson times for each of their own configured sections
   (Classes → Sections) — not a fixed set of generic names.

   GET  /api/bell-schedule?section=primary  — fetch section schedule
        (falls back: section-specific → 'all' → hardcoded default)
   PUT  /api/bell-schedule                  — save a section schedule
        body: { section: 'primary', periods: [...] }
   GET  /api/bell-schedule/sections         — all configured sections

   Plan gate: 'bell_schedule' → standard plan
   Auth:      authMiddleware (GET), authMiddleware + admin (PUT)

   Sections: 'all' (school-wide default) plus whatever this school has
             actually configured under Classes → Sections — NOT a fixed
             kg/primary/secondary/alevel set (see _schoolSectionKeys
             below: a school using different section names, e.g.
             "KS3 Section", can set a schedule for it too).

   Period entry shape:
   { p: string, start: 'HH:MM', end: 'HH:MM', label: string, isBreak: bool }
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const { z }   = require('zod');
const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { rbac }           = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { markTimetableChanged } = require('../utils/timetable-publish');

const router = express.Router();

/* ── Sections ─────────────────────────────────────────────────────
   Used to be a fixed ['all','kg','primary','secondary','alevel']
   enum — meant every school could only ever have a per-section bell
   schedule for those four generic names, silently coercing anything
   else (a real section like "KS3 Section") back to 'all' on every
   GET, and rejecting it outright on PUT/DELETE. Live-confirmed: a
   school with real, custom-named sections had this feature
   completely unreachable for every one of them.
   'all' isn't itself a section — it's the school-wide default bucket
   every section falls back to — so it's always valid regardless of
   what the school has configured. */
async function _schoolSectionKeys(schoolId, ctx) {
  // Same order as Classes → Sections' own listing (sections.js's GET /),
  // so this feature's section tabs land in the order the school actually
  // set, not an arbitrary DB order.
  const docs = await tenantModel('sections', ctx).find({ schoolId }).sort({ order: 1, name: 1 }).select('key').lean();
  return new Set(['all', ...docs.map(d => d.key).filter(Boolean)]);
}

/* ── Default bell schedule (school-wide, 07:30–17:00) ───────── */
const DEFAULT_BELL = [
  { p: '1', start: '07:30', end: '08:30', label: 'Period 1',    isBreak: false },
  { p: '2', start: '08:30', end: '09:30', label: 'Period 2',    isBreak: false },
  { p: '3', start: '09:30', end: '10:30', label: 'Period 3',    isBreak: false },
  { p: 'B', start: '10:30', end: '11:00', label: 'Short Break', isBreak: true  },
  { p: '4', start: '11:00', end: '12:00', label: 'Period 4',    isBreak: false },
  { p: '5', start: '12:00', end: '13:00', label: 'Period 5',    isBreak: false },
  { p: 'L', start: '13:00', end: '14:00', label: 'Lunch',       isBreak: true  },
  { p: '6', start: '14:00', end: '15:00', label: 'Period 6',    isBreak: false },
  { p: '7', start: '15:00', end: '16:00', label: 'Period 7',    isBreak: false },
  { p: '8', start: '16:00', end: '17:00', label: 'Period 8',    isBreak: false },
];

/* ── Validation ───────────────────────────────────────────────── */
// A real clock time: 00:00–23:59. Times are compared as text everywhere, so the format must be exact.
const TimeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const PeriodSchema = z.object({
  p:       z.string().min(1).max(10),
  start:   z.string().regex(TimeRe, 'start must be HH:MM'),
  end:     z.string().regex(TimeRe, 'end must be HH:MM'),
  label:   z.string().min(1).max(60),
  isBreak: z.boolean(),
});
const BellBodySchema = z.object({
  // Set to update one named schedule. Omitted = the section default, or a new schedule when classIds are given.
  id:       z.string().min(1).max(80).optional(),
  name:     z.string().trim().min(1).max(60).optional(),
  // The classes this schedule applies to. Empty = the section default. A class is in at most one schedule.
  classIds: z.array(z.string().min(1).max(80)).max(500).optional(),
  // Shape-only here — membership against this school's real section
  // keys (plus 'all') is checked in the route handler, since that set
  // is per-school and can't be known at schema-definition time.
  section: z.string().min(1).max(30).default('all'),
  periods: z.array(PeriodSchema).min(1).max(40),
});

/* ── Helpers ──────────────────────────────────────────────────── */
function _uid() {
  return 'bs_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* A period must end after it starts, and each key may appear once: lessons are placed by key. */
function _periodProblem(periods) {
  const keys = new Set();
  for (const p of periods) {
    if (p.start >= p.end) return `Period ${p.p}: it must end after it starts (${p.start}–${p.end}).`;
    if (keys.has(String(p.p))) return `Period key "${p.p}" appears more than once. Each key needs its own row.`;
    keys.add(String(p.p));
  }
  return null;
}

/* ── Shared lookup used by timetable route too ───────────────── */
/* A schedule with no classIds is a section default. Documents saved before classIds existed have none, so both count. */
const SECTION_DEFAULT = { $or: [{ classIds: { $exists: false } }, { classIds: { $size: 0 } }] };

/* Both forms of a class reference — its UUID `id` and its Mongo `_id` —
   the same duality the PUT route above already accepts when SAVING
   classIds (see its own oidRefs comment). A class can be referenced
   either way at the call site (resyncSlotTimes passes `id`, a lesson's
   own stored classId might be `_id`, an import row might be either),
   so a lookup against a single form here silently missed a schedule
   whose classIds array holds the OTHER form of the very class being
   resolved — confirmed live: a school's customised schedule was being
   ignored by its own assigned classes, falling all the way through to
   the built-in default, for exactly this reason. */
async function _classIdForms(schoolId, classId) {
  const forms = new Set([String(classId)]);
  try {
    const mongoose = require('mongoose');
    const or = [{ id: classId }];
    if (mongoose.Types.ObjectId.isValid(classId) && String(classId).length === 24) or.push({ _id: classId });
    const cls = await tenantModel('classes', { schoolId }).findOne({ schoolId, $or: or }).select('id _id').lean();
    if (cls) {
      if (cls.id)  forms.add(String(cls.id));
      if (cls._id) forms.add(String(cls._id));
    }
  } catch (_) { /* fall back to just the one form already in `forms` */ }
  return [...forms];
}

/**
 * Fetch the effective bell schedule for a class.
 * Falls back: the schedule that lists this class -> the section default
 * (no classIds) -> the school-wide "all" -> the built-in DEFAULT_BELL.
 * Returns { periods, section, id, name } for the schedule actually used.
 */
async function resolveBellSchedule(schoolId, section = 'all', classId = null) {
  const Bs = tenantModel('bell_schedules', { schoolId });
  let doc = null;
  let idForms = null;

  // 1. The schedule this class has been assigned to — tried under BOTH
  // id forms (see _classIdForms above).
  if (classId) {
    idForms = await _classIdForms(schoolId, classId);
    doc = await Bs.findOne({ schoolId, classIds: { $in: idForms } }).lean();
  }
  // 2. The section's default
  if (!doc && section !== 'all') {
    doc = await Bs.findOne({ schoolId, section, ...SECTION_DEFAULT }).lean();
  }
  // 3. The school-wide default
  if (!doc) {
    doc = await Bs.findOne({ schoolId, section: 'all', ...SECTION_DEFAULT }).lean();
  }
  // 4. Built-in
  if (!doc) {
    // Built-in: used only while a school has saved no schedule at all. Reported as its own source.
    return { periods: DEFAULT_BELL, section: 'default', id: null, name: null, source: 'built-in' };
  }
  // Where the times came from: the class's own schedule, a section default, or the school default.
  const source = (idForms && (doc.classIds ?? []).some(c => idForms.includes(String(c)))) ? 'class'
    : doc.section === 'all' ? 'school' : 'section';
  return { periods: doc.periods, section: doc.section, id: doc.id, name: doc.name ?? null, source };
}

/* Each slot copies its start and end times when it is created. When a schedule changes, bring every
   active slot back in line with the schedule its class now uses. Breaks have no slot. A period that
   a schedule no longer has keeps its last times, and is left for the timetable owner to review. */
async function resyncSlotTimes(schoolId, ctx) {
  const classes = await tenantModel('classes', ctx).find({ schoolId }).select('id _id sectionKey').lean();
  const Timetable = tenantModel('timetable', ctx);
  for (const c of classes) {
    const refs = [...new Set([c.id, c._id && String(c._id)].filter(Boolean).map(String))];
    const { periods, id } = await resolveBellSchedule(schoolId, c.sectionKey || 'all', refs[0]);
    const lessons = periods.filter(x => !x.isBreak);
    for (const p of lessons) {
      await Timetable.updateMany(
        { schoolId, classId: { $in: refs }, period: String(p.p), isActive: true },
        { $set: { startTime: p.start, endTime: p.end, bellScheduleId: id ?? null, scheduleStale: false } },
      );
    }
    // A lesson whose period is no longer in the schedule keeps its times, but is flagged so the
    // timetable shows it for review instead of silently dropping it.
    await Timetable.updateMany(
      { schoolId, classId: { $in: refs }, isActive: true, period: { $nin: lessons.map(p => String(p.p)) } },
      { $set: { scheduleStale: true } },
    );
  }
}

// A schedule change must still save if the re-sync fails. The error is logged, and the slots keep their times.
async function _resyncSafely(schoolId, ctx) {
  try {
    await resyncSlotTimes(schoolId, ctx);
    await markTimetableChanged(schoolId);
  } catch (err) {
    console.error('[bell-schedule] slot time re-sync failed:', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   ROUTES
   ══════════════════════════════════════════════════════════════ */

/* GET /api/bell-schedule/sections — list all configured sections ─ */
router.get('/sections', authMiddleware, planGate('bell_schedule'), async (req, res) => {
  try {
    const schoolId = req.jwtUser.schoolId;
    const ctx      = tenantContext(req);
    const [docs, sectionKeys] = await Promise.all([
      tenantModel('bell_schedules', ctx).find({ schoolId }).lean(),
      _schoolSectionKeys(schoolId, ctx),
    ]);

    // Return one entry per this school's real sections (plus 'all'),
    // indicating configured/default — not a fixed generic list. Only a
    // genuine DEFAULT (no classIds) counts as "this section is
    // configured": 'all' can also hold any number of school-wide CLASS
    // schedules (classIds.length > 0) sharing that same section value —
    // keying on section alone without this check let the last such class
    // schedule in `docs` silently overwrite (or masquerade as) the real
    // School Default for 'all'.
    const configured = {};
    docs.forEach(d => { if (!(d.classIds ?? []).length) configured[d.section] = d; });

    const result = [...sectionKeys].map(s => ({
      section:      s,
      configured:   !!configured[s],
      periodCount:  configured[s] ? configured[s].periods.length : null,
      lessonCount:  configured[s] ? configured[s].periods.filter(p => !p.isBreak).length : null,
      id:           configured[s]?.id ?? null,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[bell-schedule] GET /sections error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch sections' } });
  }
});

/* GET /api/bell-schedule?section=primary ────────────────────── */
router.get('/', authMiddleware, planGate('bell_schedule'), async (req, res) => {
  try {
    const schoolId    = req.jwtUser.schoolId;
    const sectionKeys = await _schoolSectionKeys(schoolId, tenantContext(req));
    const section = sectionKeys.has(req.query.section) ? req.query.section : 'all';
    // ?classId= returns the schedule that class actually runs, not just its section's.
    const classId = req.query.classId ? String(req.query.classId) : null;
    const result  = await resolveBellSchedule(schoolId, section, classId);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[bell-schedule] GET error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch bell schedule' } });
  }
});

/* PUT /api/bell-schedule ─ save or create section schedule ───── */
// RBAC fix (2026-09): now checks {resource: 'timetable', action: 'update',
// subKey: 'bell_schedule'}. 'bell_schedule' was previously passed as the ACTION
// (2nd arg) when it's actually the SUBKEY (3rd arg) — moduleRegistry.js's
// own 'timetable.bell_schedule' sub ("Configure Bell Schedule"). No role's
// timetable permission array can ever contain the literal string
// 'bell_schedule' (only read/create/update/delete), so this was
// permanently inaccessible to every role except superadmin. Matches
// rooms.js's already-correct subKey usage for the same "Configure Rooms"
// sub-permission pattern.
/* GET /api/bell-schedule/schedules — every named schedule, with the classes it covers */
router.get('/schedules', authMiddleware, planGate('bell_schedule'), rbac('timetable', 'read'), async (req, res) => {
  try {
    const schoolId = req.jwtUser.schoolId;
    const docs = await tenantModel('bell_schedules', tenantContext(req))
      .find({ schoolId }).sort({ section: 1, name: 1 }).lean();
    res.json({
      success: true,
      data: docs.map(d => ({
        id: d.id, section: d.section, name: d.name ?? null,
        classIds: d.classIds ?? [], periods: d.periods,
      })),
    });
  } catch (err) {
    console.error('[bell-schedule] GET schedules error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch bell schedules' } });
  }
});

/* PUT /api/bell-schedule ─ save a schedule: a section default, or one for specific classes */
// RBAC: {resource: 'timetable', action: 'update', subKey: 'bell_schedule'} (see the 2026-09 fix in git history).
router.put('/', authMiddleware, planGate('bell_schedule'), rbac('timetable', 'update', 'bell_schedule'), async (req, res) => {
  const fail = (msg, status = 400) => res.status(status).json({
    success: false,
    error: { code: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', message: msg },
  });
  try {
    const parsed = BellBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? 'Invalid bell schedule data');
    const periodProblem = _periodProblem(parsed.data.periods);
    if (periodProblem) return fail(periodProblem);

    const { id, name, section, periods } = parsed.data;
    const classIds = [...new Set(parsed.data.classIds ?? [])];
    const schoolId = req.jwtUser.schoolId;
    const ctx      = tenantContext(req);
    const Bs       = tenantModel('bell_schedules', ctx);

    // A schedule for classes is school-wide: its classes may come from any section, so it is
    // stored under 'all'. A section default (no classes) is still stored under its own section.
    const sectionKeys = await _schoolSectionKeys(schoolId, ctx);
    if (!sectionKeys.has(section)) return fail(`Unknown section '${section}'.`);
    const storedSection = classIds.length ? 'all' : section;

    // Every class must exist here.
    const classNames = {};
    if (classIds.length) {
      // A class is referenced by its own id, or by its database _id. Only real object ids may be searched
      // in _id: mongoose rejects any other value, which failed every save that included classes.
      const oidRefs = classIds.filter(ref => /^[a-f\d]{24}$/i.test(ref));
      const or = [{ id: { $in: classIds } }, ...(oidRefs.length ? [{ _id: { $in: oidRefs } }] : [])];
      const classes = await tenantModel('classes', ctx)
        .find({ schoolId, $or: or })
        .select('id name sectionKey').lean();
      const byRef = new Map();
      for (const c of classes) {
        byRef.set(String(c.id), c);
        byRef.set(String(c._id), c);
      }
      for (const ref of classIds) {
        const c = byRef.get(ref);
        if (!c) return fail('A class in this schedule was not found.');
        classNames[ref] = c.name;
      }
      // One schedule per class: a class already in another schedule is refused, never moved silently.
      const others = await Bs.find({ schoolId, classIds: { $in: classIds }, ...(id ? { id: { $ne: id } } : {}) })
        .select('id name classIds').lean();
      if (others.length) {
        const taken  = classIds.find(ref => others.some(o => (o.classIds ?? []).includes(ref)));
        const holder = others.find(o => (o.classIds ?? []).includes(taken));
        return fail(`${classNames[taken] ?? 'A class'} is already in the "${holder.name ?? 'other'}" schedule. Remove it there first.`);
      }
    }

    const now = new Date().toISOString();
    let existing = null;
    if (id) {
      existing = await Bs.findOne({ schoolId, id }).lean();
      if (!existing) return fail('Bell schedule not found.', 404);
      // A default (no classes) and a class schedule are different things. Converting one into the
      // other would leave the school without its default, or silently create a second one.
      if (!(existing.classIds ?? []).length && classIds.length) {
        return fail('A default cannot take classes. Create a new schedule for them.');
      }
      if ((existing.classIds ?? []).length && !classIds.length) {
        return fail('A class schedule needs at least one class. Remove the schedule instead.');
      }
    } else if (classIds.length === 0) {
      // A section default: one per section, updated in place.
      existing = await Bs.findOne({ schoolId, section, ...SECTION_DEFAULT }).lean();
    }

    const label = name ?? (classIds.length === 0 ? 'Section default' : 'Custom schedule');
    if (existing) {
      await Bs.updateOne({ id: existing.id }, { $set: { section: storedSection, name: label, classIds, periods, isDefault: classIds.length === 0, updatedAt: now } });
      await _resyncSafely(schoolId, ctx);
      return res.json({ success: true, data: { id: existing.id, section: storedSection, name: label, classIds, periods } });
    }
    const doc = await Bs.create({ id: _uid(), schoolId, section: storedSection, name: label, classIds, periods, isDefault: classIds.length === 0, createdAt: now, updatedAt: now });
    await _resyncSafely(schoolId, ctx);
    res.json({ success: true, data: { id: doc.id, section: storedSection, name: label, classIds, periods } });
  } catch (err) {
    console.error('[bell-schedule] PUT error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to save bell schedule' } });
  }
});

/* DELETE /api/bell-schedule?id=… — remove a named schedule or a default (the
   school-wide 'all' included — see below) by its own id; its classes fall
   back to the next schedule down.
   DELETE /api/bell-schedule?section=… — remove a section default by section
   key, 'all' included. Unlike PUT, this never requires the section to
   still exist in Classes → Sections: the one real reason to delete a
   section default by key rather than by id is that its section was
   itself already deleted, leaving the default orphaned (see sections.js's
   own cleanup, which handles the normal case — this covers anything from
   before that existed, or any other way one is left behind). */
router.delete('/', authMiddleware, planGate('bell_schedule'), rbac('timetable', 'delete', 'bell_schedule'), async (req, res) => {
  try {
    const schoolId = req.jwtUser.schoolId;
    const ctx      = tenantContext(req);
    const Bs       = tenantModel('bell_schedules', ctx);

    if (req.query.id) {
      const existing = await Bs.findOne({ schoolId, id: String(req.query.id) }).select('section classIds').lean();
      if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Bell schedule not found.' } });
      await Bs.deleteOne({ schoolId, id: String(req.query.id) });
      await _resyncSafely(schoolId, ctx);
      const wasSchoolDefault = existing.section === 'all' && !(existing.classIds ?? []).length;
      return res.json({
        success: true,
        message: wasSchoolDefault
          ? 'School Default removed. Classes with no other schedule now use the built-in default.'
          : 'Bell schedule removed. Its classes now use the next schedule down.',
      });
    }

    const section = req.query.section;
    if (!section) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A section is required.' } });
    }
    const r = await Bs.deleteOne({ schoolId, section, ...SECTION_DEFAULT });
    if (!r.deletedCount) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `No default found for section '${section}'.` } });
    }
    await _resyncSafely(schoolId, ctx);
    res.json({
      success: true,
      message: section === 'all'
        ? 'School Default removed. Classes with no other schedule now use the built-in default.'
        : `Section default for '${section}' removed. Will now use the school default.`,
    });
  } catch (err) {
    console.error('[bell-schedule] DELETE error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to delete bell schedule' } });
  }
});

router.resolveBellSchedule = resolveBellSchedule;
router.DEFAULT_BELL        = DEFAULT_BELL;

module.exports = router;
