/* ============================================================
   Msingi — Billing Routes  (platform subscription invoicing)

   GET  /api/billing/current           — current unpaid invoice for school (admin)
   GET  /api/billing/history           — all billing snapshots for school (admin)
   POST /api/billing/generate          — manually generate term snapshot (admin)
   GET  /api/billing/all               — all schools' snapshots (superadmin)

   Billing model:
     • Amount = activeStudentCount × tier rate (KSh 100/120/160)
     • Snapshot taken at term start date (auto via cron, or manual trigger here)
     • One snapshot per school per academicYear+term (idempotent)
   ============================================================ */
'use strict';

const express        = require('express');
const crypto         = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { _model }     = require('../utils/model');
const { ok, created, E } = require('../utils/response');
const { STUDENT_RATE } = require('../config/pricing');

const router = express.Router();

function _uid() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }

function _isAdmin(req) {
  const r = req.jwtUser?.role || '';
  return ['superadmin', 'admin', 'principal'].includes(r);
}
function _isSuperAdmin(req) {
  return req.jwtUser?.role === 'superadmin';
}

/* ── Billing invoice ref generator ─────────────────────────── */
function _invoiceRef(academicYear, term) {
  const yearShort = (academicYear || '').replace('/', '-');
  return `INV-${yearShort}-T${term}-${Date.now().toString(36).toUpperCase()}`;
}

/* ── Core snapshot creation (shared by cron + manual route) ── */
async function createBillingSnapshot(schoolId, { academicYear, term, tier, triggerType = 'manual' }) {
  const Students = _model('students');
  const Snapshots = _model('billing_snapshots');

  // Guard: don't duplicate for same year+term
  const existing = await Snapshots.findOne({ schoolId, academicYear, term }).lean();
  if (existing) return { existing: true, snapshot: existing };

  // Count active students only
  const activeCount = await Students.countDocuments({ schoolId, status: 'active' });

  const rate   = STUDENT_RATE[tier] ?? STUDENT_RATE.base;
  const amount = activeCount * rate;
  const now    = new Date().toISOString();

  const snapshot = {
    id:              _uid(),
    schoolId,
    academicYear,
    term,
    snapshotDate:    now,
    activeCount,
    tier,
    ratePerStudent:  rate,
    totalAmount:     amount,
    status:          'pending',
    invoiceRef:      _invoiceRef(academicYear, term),
    triggerType,     // 'auto' (cron) | 'manual'
    generatedAt:     now,
    paidAt:          null,
    mpesaCode:       null,
    paidAmount:      null,
  };

  await Snapshots.create(snapshot);
  console.log(`[billing] Snapshot created — school ${schoolId} | ${academicYear} T${term} | ${activeCount} students | KSh ${amount} | ${snapshot.invoiceRef}`);
  return { existing: false, snapshot };
}

/* ══════════════════════════════════════════════════════════════
   GET /api/billing/current  — latest pending invoice
   ══════════════════════════════════════════════════════════════ */
router.get('/current', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return E.forbidden(res, 'Admin access required.');
    const { schoolId } = req.jwtUser;
    const Snapshots = _model('billing_snapshots');

    const pending = await Snapshots.findOne({ schoolId, status: 'pending' })
      .sort({ generatedAt: -1 })
      .lean();

    return ok(res, { invoice: pending ?? null });
  } catch (err) {
    console.error('[billing GET /current]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/billing/history  — all invoices for this school
   ══════════════════════════════════════════════════════════════ */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return E.forbidden(res, 'Admin access required.');
    const { schoolId } = req.jwtUser;
    const Snapshots = _model('billing_snapshots');

    const history = await Snapshots.find({ schoolId })
      .sort({ generatedAt: -1 })
      .lean();

    return ok(res, history);
  } catch (err) {
    console.error('[billing GET /history]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/billing/generate  — manually create term snapshot
   Body: { academicYear, term }
   Reads school's current tier from school record.
   ══════════════════════════════════════════════════════════════ */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return E.forbidden(res, 'Admin access required.');
    const { schoolId } = req.jwtUser;
    const { academicYear, term } = req.body;

    if (!academicYear || !term) {
      return E.badRequest(res, 'academicYear and term are required.');
    }

    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }).lean();
    if (!school) return E.notFound(res, 'School not found.');

    // Map legacy plan key → portal tier key
    const legacyMap = { core: 'base', standard: 'student', premium: 'family' };
    const tier = legacyMap[school.plan] || school.plan || 'base';
    if (!STUDENT_RATE[tier]) return E.badRequest(res, 'School has no valid billing tier configured.');

    const { existing, snapshot } = await createBillingSnapshot(schoolId, {
      academicYear,
      term: Number(term),
      tier,
      triggerType: 'manual',
    });

    if (existing) {
      return ok(res, { snapshot, alreadyExists: true, message: 'A snapshot for this term already exists.' });
    }
    return created(res, { snapshot });
  } catch (err) {
    console.error('[billing POST /generate]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/billing/all  — platform-wide view (superadmin only)
   ══════════════════════════════════════════════════════════════ */
router.get('/all', authMiddleware, async (req, res) => {
  try {
    if (!_isSuperAdmin(req)) return E.forbidden(res, 'Superadmin access required.');
    const Snapshots = _model('billing_snapshots');
    const Schools   = _model('schools');

    const snapshots = await Snapshots.find({})
      .sort({ generatedAt: -1 })
      .limit(500)
      .lean();

    // Attach school names
    const schoolIds = [...new Set(snapshots.map(s => s.schoolId))];
    const schools   = await Schools.find({ id: { $in: schoolIds } }).select('id name slug').lean();
    const schoolMap = Object.fromEntries(schools.map(s => [s.id, s]));

    const enriched = snapshots.map(s => ({
      ...s,
      schoolName: schoolMap[s.schoolId]?.name ?? s.schoolId,
      schoolSlug: schoolMap[s.schoolId]?.slug ?? '',
    }));

    return ok(res, enriched);
  } catch (err) {
    console.error('[billing GET /all]', err);
    return E.serverError(res);
  }
});

/* Export createBillingSnapshot for use by cron job */
module.exports = router;
module.exports.createBillingSnapshot = createBillingSnapshot;
