/* ============================================================
   InnoLearn — Plan Tier Gating Middleware
   Usage:  router.get('/reports', planGate('reports'), handler)

   Plans are cumulative — each tier inherits all features below it:
     core ⊂ standard ⊂ premium ⊂ enterprise

   The school's plan is stored on its schools document.
   Plan is cached per schoolId for 5 minutes.
   ============================================================ */
const { _model } = require('../utils/model');

/* ── Plan hierarchy ─────────────────────────────────────────── */
const PLAN_LEVELS = { core: 1, standard: 2, premium: 3, enterprise: 4 };

/* Feature → minimum plan required */
const FEATURE_PLAN = {
  /* ── Core (all plans) ── */
  students:           'core',
  attendance:         'core',
  classes:            'core',
  teachers:           'core',
  grades:             'core',
  subjects:           'core',
  events:             'core',
  messaging:          'core',

  /* ── Standard ── */
  behaviour:          'standard',
  timetable:          'standard',
  exams:              'standard',
  key_stages:         'standard',
  houses:             'standard',
  sections:           'standard',

  /* ── Premium ── */
  finance:            'premium',
  admissions:         'premium',
  reports:            'premium',
  report_cards:       'premium',
  custom_roles:       'premium',

  /* ── Enterprise ── */
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
      if (!requiredPlan) return next(); // Unknown feature — allow (fail open for unknown)

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
