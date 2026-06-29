/* ============================================================
   Msingi — Plan Tier Gating Middleware
   Usage:  router.get('/reports', planGate('reports'), handler)

   Plans are cumulative — each tier inherits all features below it:
     core ⊂ standard ⊂ premium ⊂ enterprise

   The school's plan is stored on its schools document.
   Plan is cached per schoolId for 5 minutes.
   ============================================================ */
const { _model } = require('../utils/model');

/* ── Plan hierarchy ─────────────────────────────────────────── */
// Canonical names: base / student / family / enterprise
// Legacy aliases (core/standard/premium) kept for backwards-compat with existing school records.
//
// IMPORTANT: The tier controls PORTAL ACCESS only — not ERP module access.
//   base     → admin + teacher portals   (all ERP modules included)
//   student  → + student portal
//   family   → + parent portal
//   enterprise → + API/SSO/white-label (custom sales)
//
// All ERP features are available on every paid plan. Only portal-specific
// and enterprise platform features are gated at higher levels.
const PLAN_LEVELS = {
  core: 1, base: 1,          // Tier 1 — staff portals only
  standard: 2, student: 2,   // Tier 2 — + student portal
  premium: 3,  family: 3,    // Tier 3 — + parent portal
  enterprise: 4,             // Tier 4 — API access / white-label / SSO
};

/* Feature → minimum plan required */
const FEATURE_PLAN = {
  /* ── ALL ERP MODULES — available on every plan (base and above) ── */
  students:           'core',
  attendance:         'core',
  classes:            'core',
  teachers:           'core',
  grades:             'core',
  subjects:           'core',
  events:             'core',
  messaging:          'core',
  admissions:         'core',
  behaviour:          'core',
  timetable:          'core',
  bell_schedule:      'core',
  rooms:              'core',
  exams:              'core',
  key_stages:         'core',
  houses:             'core',
  sections:           'core',
  assessment:         'core',
  comment_banks:      'core',
  exam_series:        'core',
  mark_submissions:   'core',
  finance:            'core',
  report_cards:       'core',
  growth_profile:     'core',
  library:            'core',
  transport:          'core',
  hostel:             'core',
  lessons:            'core',
  custom_smtp:        'core',
  elearning:          'core',
  analytics:          'core',
  reports:            'core',
  custom_roles:       'core',
  hr:                 'core',

  /* ── Portal access — gated by tier ── */
  student_portal:     'standard',   // student login accounts and dashboard
  parent_portal:      'premium',    // parent login accounts and dashboard

  /* ── Enterprise only — not sold via self-service ── */
  api_access:         'enterprise',
  sso:                'enterprise',
  advanced_analytics: 'enterprise',
  multi_campus:       'enterprise',
  white_label:        'enterprise',
};

/* ── School plan cache ──────────────────────────────────────── */
const _planCache = new Map();
const PLAN_CACHE_TTL = 5 * 60 * 1000;

function _getCachedPlan(schoolId) {
  const entry = _planCache.get(schoolId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _planCache.delete(schoolId); return null; }
  return entry.plan;
}

function _setCachedPlan(schoolId, plan) {
  _planCache.set(schoolId, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL });
}

function invalidatePlanCache(schoolId) {
  _planCache.delete(schoolId);
}

async function _getSchoolPlan(schoolId) {
  const cached = _getCachedPlan(schoolId);
  if (cached) return cached;

  const Schools = _model('schools');
  const school  = await Schools.findOne({ id: schoolId }).lean();
  const plan    = school?.plan || 'core';
  _setCachedPlan(schoolId, plan);
  return plan;
}

/* ── Middleware factory ──────────────────────────────────────── */
/**
 * planGate(feature)
 * Returns middleware that checks whether the school's plan
 * includes the requested feature. Must be used AFTER authMiddleware.
 *
 * @param {string} feature - Feature key from FEATURE_PLAN map
 */
function planGate(feature) {
  return async (req, res, next) => {
    try {
      const { schoolId } = req.jwtUser || {};
      if (!schoolId) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }

      const requiredPlan  = FEATURE_PLAN[feature];
      // Fail CLOSED for unregistered features — prevents silent privilege escalation
      // when new routes are added without registering in FEATURE_PLAN.
      if (!requiredPlan) {
        console.error(`[PlanGate] Unknown feature key: '${feature}' — denying access (fail-closed). Register it in FEATURE_PLAN.`);
        return res.status(403).json({ success: false, error: { code: 'PLAN_UPGRADE_REQUIRED', message: `Feature '${feature}' is not available on any plan. Contact support.` } });
      }

      const schoolPlan     = await _getSchoolPlan(schoolId);
      const schoolLevel    = PLAN_LEVELS[schoolPlan]    || 1;
      const requiredLevel  = PLAN_LEVELS[requiredPlan]  || 1;

      if (schoolLevel < requiredLevel) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PLAN_UPGRADE_REQUIRED',
            message: `This feature requires the '${requiredPlan}' plan or higher. Your current plan is '${schoolPlan}'.`,
            currentPlan: schoolPlan,
            requiredPlan
          }
        });
      }

      next();
    } catch (err) {
      console.error('[PlanGate] Error checking plan:', err);
      res.status(500).json({ success: false, error: { code: 'PLAN_CHECK_ERROR', message: 'Failed to verify plan' } });
    }
  };
}

module.exports = { planGate, invalidatePlanCache, FEATURE_PLAN, PLAN_LEVELS };
