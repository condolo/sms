/* ============================================================
   Msingi — Bell Schedule Routes
   GET /api/bell-schedule   — fetch school's bell schedule (or seed default)
   PUT /api/bell-schedule   — save / replace bell schedule

   Plan gate: 'standard' (timetable feature)
   Auth:      authMiddleware (GET), authMiddleware + admin (PUT)

   Schema per period entry:
   {
     p:       string  — period key ('1'–'8', 'B', 'L', or custom)
     start:   string  — 'HH:MM' (24h)
     end:     string  — 'HH:MM' (24h)
     label:   string  — display name
     isBreak: boolean
   }
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');

const router = express.Router();

/* ── Default bell schedule (07:30–17:00, 8 lessons + 2 breaks) ─ */
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

/* ── Validation schema ────────────────────────────────────────── */
const TimeRe = /^\d{2}:\d{2}$/;
const PeriodSchema = z.object({
  p:       z.string().min(1).max(10),
  start:   z.string().regex(TimeRe, 'start must be HH:MM'),
  end:     z.string().regex(TimeRe, 'end must be HH:MM'),
  label:   z.string().min(1).max(60),
  isBreak: z.boolean(),
});
const BellSchema = z.array(PeriodSchema).min(1).max(30);

/* ── Admin check ──────────────────────────────────────────────── */
function _isAdmin(req) {
  const r  = req.jwtUser?.role  || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || r === 'admin' || rs.includes('superadmin') || rs.includes('admin');
}

function _uid() {
  return 'bs_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/* ── GET /api/bell-schedule ──────────────────────────────────── */
router.get('/', authMiddleware, planGate('bell_schedule'), async (req, res) => {
  try {
    const Bs  = _model('bell_schedules');
    let   doc = await Bs.findOne({ schoolId: req.jwtUser.schoolId, isDefault: true }).lean();

    if (!doc) {
      // Seed the default on first access — idempotent
      const now = new Date().toISOString();
      doc = {
        id:        _uid(),
        schoolId:  req.jwtUser.schoolId,
        isDefault: true,
        periods:   DEFAULT_BELL,
        createdAt: now,
        updatedAt: now,
      };
      await Bs.create(doc);
    }

    res.json({ success: true, data: { periods: doc.periods, id: doc.id } });
  } catch (err) {
    console.error('[bell-schedule] GET error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch bell schedule' } });
  }
});

/* ── PUT /api/bell-schedule ──────────────────────────────────── */
router.put('/', authMiddleware, planGate('bell_schedule'), async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to update bell schedule.' } });
    }

    const parsed = BellSchema.safeParse(req.body.periods ?? req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid bell schedule data' },
      });
    }

    const periods = parsed.data;
    const now     = new Date().toISOString();
    const Bs      = _model('bell_schedules');

    const existing = await Bs.findOne({ schoolId: req.jwtUser.schoolId, isDefault: true }).lean();
    if (existing) {
      await Bs.updateOne(
        { id: existing.id },
        { $set: { periods, updatedAt: now } }
      );
    } else {
      await Bs.create({
        id:        _uid(),
        schoolId:  req.jwtUser.schoolId,
        isDefault: true,
        periods,
        createdAt: now,
        updatedAt: now,
      });
    }

    res.json({ success: true, data: { periods } });
  } catch (err) {
    console.error('[bell-schedule] PUT error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to save bell schedule' } });
  }
});

module.exports = router;
