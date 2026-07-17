/* ============================================================
   Msingi — Bell Schedule Routes
   Supports per-section schedules so multi-level schools can have
   different lesson times for KG, Primary, Secondary, and A-Level.

   GET  /api/bell-schedule?section=primary  — fetch section schedule
        (falls back: section-specific → 'all' → hardcoded default)
   PUT  /api/bell-schedule                  — save a section schedule
        body: { section: 'primary', periods: [...] }
   GET  /api/bell-schedule/sections         — all configured sections

   Plan gate: 'bell_schedule' → standard plan
   Auth:      authMiddleware (GET), authMiddleware + admin (PUT)

   Sections: 'all' (school-wide default) | 'kg' | 'primary' |
             'secondary' | 'alevel'

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

const router = express.Router();

/* ── Sections ─────────────────────────────────────────────────── */
const VALID_SECTIONS = ['all', 'kg', 'primary', 'secondary', 'alevel'];

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
const TimeRe = /^\d{2}:\d{2}$/;
const PeriodSchema = z.object({
  p:       z.string().min(1).max(10),
  start:   z.string().regex(TimeRe, 'start must be HH:MM'),
  end:     z.string().regex(TimeRe, 'end must be HH:MM'),
  label:   z.string().min(1).max(60),
  isBreak: z.boolean(),
});
const BellBodySchema = z.object({
  section: z.enum(VALID_SECTIONS).default('all'),
  periods: z.array(PeriodSchema).min(1).max(40),
});

/* ── Helpers ──────────────────────────────────────────────────── */
function _uid() {
  return 'bs_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ── Shared lookup used by timetable route too ───────────────── */
/**
 * Fetch the effective bell schedule for a given section.
 * Falls back: section-specific → school 'all' → hardcoded DEFAULT_BELL.
 * Returns { periods, section } — the section that was actually used.
 */
async function resolveBellSchedule(schoolId, section = 'all') {
  const Bs = tenantModel('bell_schedules', { schoolId });
  let doc = null;

  // 1. Try requested section (if not already 'all')
  if (section !== 'all') {
    doc = await Bs.findOne({ schoolId, section }).lean();
  }
  // 2. Fall back to school-wide default
  if (!doc) {
    doc = await Bs.findOne({ schoolId, section: 'all' }).lean();
  }
  // 3. Final fallback: hardcoded constant
  if (!doc) {
    return { periods: DEFAULT_BELL, section: 'default', id: null };
  }
  return { periods: doc.periods, section: doc.section, id: doc.id };
}

/* ══════════════════════════════════════════════════════════════
   ROUTES
   ══════════════════════════════════════════════════════════════ */

/* GET /api/bell-schedule/sections — list all configured sections ─ */
router.get('/sections', authMiddleware, planGate('bell_schedule'), async (req, res) => {
  try {
    const Bs   = tenantModel('bell_schedules', tenantContext(req));
    const docs = await Bs.find({ schoolId: req.jwtUser.schoolId }).lean();

    // Return one entry per VALID_SECTION indicating configured/default
    const configured = {};
    docs.forEach(d => { configured[d.section] = d; });

    const result = VALID_SECTIONS.map(s => ({
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
    const section = VALID_SECTIONS.includes(req.query.section) ? req.query.section : 'all';
    const result  = await resolveBellSchedule(req.jwtUser.schoolId, section);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[bell-schedule] GET error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch bell schedule' } });
  }
});

/* PUT /api/bell-schedule ─ save or create section schedule ───── */
router.put('/', authMiddleware, planGate('bell_schedule'), rbac('timetable', 'bell_schedule'), async (req, res) => {
  try {
    const parsed = BellBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid bell schedule data' },
      });
    }

    const { section, periods } = parsed.data;
    const now  = new Date().toISOString();
    const Bs   = tenantModel('bell_schedules', tenantContext(req));

    const existing = await Bs.findOne({ schoolId: req.jwtUser.schoolId, section }).lean();
    if (existing) {
      await Bs.updateOne({ id: existing.id }, { $set: { periods, updatedAt: now } });
    } else {
      await Bs.create({
        id:        _uid(),
        schoolId:  req.jwtUser.schoolId,
        section,
        periods,
        createdAt: now,
        updatedAt: now,
      });
    }

    res.json({ success: true, data: { section, periods } });
  } catch (err) {
    console.error('[bell-schedule] PUT error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to save bell schedule' } });
  }
});

/* DELETE /api/bell-schedule?section=primary — revert to default ─ */
router.delete('/', authMiddleware, planGate('bell_schedule'), rbac('timetable', 'bell_schedule'), async (req, res) => {
  try {
    const section = req.query.section;
    if (!section || section === 'all') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: "Cannot delete the 'all' schedule. Use PUT to update it." } });
    }
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Unknown section '${section}'.` } });
    }
    await tenantModel('bell_schedules', tenantContext(req)).deleteOne({ schoolId: req.jwtUser.schoolId, section });
    res.json({ success: true, message: `Bell schedule for '${section}' removed. Will now use school default.` });
  } catch (err) {
    console.error('[bell-schedule] DELETE error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to delete bell schedule' } });
  }
});

router.resolveBellSchedule = resolveBellSchedule;
router.DEFAULT_BELL        = DEFAULT_BELL;

module.exports = router;
