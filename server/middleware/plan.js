/* ============================================================
   Msingi — Plan Tier Gating Middleware
   Usage:  router.get('/reports', planGate('reports'), handler)

   Plans are cumulative — each tier inherits all features below it:
     core ⊂ standard ⊂ premium ⊂ enterprise

   The school's plan is stored on its schools document.
   Plan is cached per schoolId for 5 minutes.
   ============================================================ */
const { _model } = require('../utils/model');
const { hasEntitlement } = require('../utils/entitlements');

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
  weekly_snapshot:    'core',
  resources:          'core',
  library:            'core',
  transport:          'core',
  extracurricular:    'core',
  hostel:             'core',
  medical:            'core',
  inventory:          'core',
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
/* 60s, not 5min: a lapsed subscription must take effect promptly without a
   plan change. The cached value is the whole expiry-aware state. */
const PLAN_CACHE_TTL = 60 * 1000;

/* Subscription expiry policy — opt-in so an existing deployment can turn it
   on deliberately:
     ENFORCE_PLAN_EXPIRY=true   after the grace period the school is treated
                                as the base tier (ERP stays, student/parent
                                portals close); the billed plan is untouched
     PLAN_GRACE_DAYS=7          days after expiry before that happens */
const ENFORCE_PLAN_EXPIRY = process.env.ENFORCE_PLAN_EXPIRY === 'true';
const PLAN_GRACE_DAYS = Math.max(0, parseInt(process.env.PLAN_GRACE_DAYS || '7', 10));

function _getCachedPlan(schoolId) {
  const entry = _planCache.get(schoolId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _planCache.delete(schoolId); return null; }
  return entry.state;
}

function _setCachedPlan(schoolId, state) {
  _planCache.set(schoolId, { state, expiresAt: Date.now() + PLAN_CACHE_TTL });
}

function invalidatePlanCache(schoolId) {
  _planCache.delete(schoolId);
}

/**
 * Resolve a school's subscription state.
 * Effective expiry = planExpiresAt (paid) || trialEnds (onboarding trial).
 * Past expiry + grace (and only when enforcement is on), `restricted` is
 * true and `effectivePlan` drops to the base level. The billed plan itself
 * is never mutated — downgrade is an access decision, not a billing one.
 */
async function getPlanState(schoolId) {
  const cached = _getCachedPlan(schoolId);
  if (cached) return cached;

  const Schools = _model('schools');
  const school  = await Schools.findOne(
    { id: schoolId },
    { plan: 1, planExpiresAt: 1, trialEnds: 1 }
  ).lean();

  const plan        = school?.plan || 'core';
  /* An explicit planExpiresAt=null means "no expiry" (enterprise /
     bootstrap) and must NOT fall back to an old onboarding trialEnds —
     otherwise clearing the date would silently re-expire the school. Only
     when the field was never set does the trial date govern. */
  const hasPlanExpiry = !!school && Object.prototype.hasOwnProperty.call(school, 'planExpiresAt');
  const expiryRaw   = hasPlanExpiry ? school.planExpiresAt : (school?.trialEnds || null);
  const expiryDate  = expiryRaw ? new Date(expiryRaw) : null;
  const validExpiry = expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate : null;
  const graceEndsAt = validExpiry ? new Date(validExpiry.getTime() + PLAN_GRACE_DAYS * 86400000) : null;

  const pastExpiry = !!(validExpiry && Date.now() > validExpiry.getTime());
  const restricted = !!(ENFORCE_PLAN_EXPIRY && graceEndsAt && Date.now() > graceEndsAt.getTime());

  const state = {
    plan,
    effectivePlan: restricted ? 'core' : plan,
    expiresAt:     validExpiry ? validExpiry.toISOString() : null,
    graceEndsAt:   graceEndsAt ? graceEndsAt.toISOString() : null,
    pastExpiry,
    restricted,
    graceDays:     PLAN_GRACE_DAYS,
    enforced:      ENFORCE_PLAN_EXPIRY,
  };
  _setCachedPlan(schoolId, state);
  return state;
}

async function _getSchoolPlan(schoolId) {
  return (await getPlanState(schoolId)).effectivePlan;
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

      const state          = await getPlanState(schoolId);
      const schoolPlan     = state.effectivePlan;
      const schoolLevel    = PLAN_LEVELS[schoolPlan]    || 1;
      const requiredLevel  = PLAN_LEVELS[requiredPlan]  || 1;

      if (schoolLevel >= requiredLevel) {
        return next(); // Plan alone grants it — entitlements are never consulted on this path (ADR-0004 Decision 1).
      }

      // Plan alone would deny. Check for an explicit override entitlement
      // before failing. Dual-read (ADR-0004): absence of a doc, or any
      // lookup error, must resolve to exactly today's plan-derived denial
      // — never a new failure mode and never an accidental grant.
      let granted = false;
      try {
        granted = await hasEntitlement(schoolId, feature);
      } catch (entErr) {
        console.error(`[PlanGate] Entitlement lookup failed for school '${schoolId}', feature '${feature}' — falling back to plan-derived denial:`, entErr);
        granted = false;
      }
      if (granted) {
        return next();
      }

      /* Subscription expiry is a different denial from "paid for a lower
         tier" — but guardians and students must never be told their school
         is behind on billing. They get a neutral account-access message;
         staff get the date so they can act on it. */
      if (state.restricted) {
        const isPortalUser = ['parent', 'guardian', 'student'].includes(req.jwtUser?.role);
        if (isPortalUser) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'ACCOUNT_UNAVAILABLE',
              message: 'Unable to access this account. Please contact your school administrator.',
            }
          });
        }
        return res.status(403).json({
          success: false,
          error: {
            code: 'PLAN_EXPIRED',
            message: `Your subscription expired on ${new Date(state.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. This feature is paused until the subscription is renewed.`,
            currentPlan: state.plan,
            requiredPlan,
            expiresAt: state.expiresAt,
            graceDays: state.graceDays,
          }
        });
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'PLAN_UPGRADE_REQUIRED',
          message: `This feature requires the '${requiredPlan}' plan or higher. Your current plan is '${schoolPlan}'.`,
          currentPlan: schoolPlan,
          requiredPlan
        }
      });
    } catch (err) {
      console.error('[PlanGate] Error checking plan:', err);
      res.status(500).json({ success: false, error: { code: 'PLAN_CHECK_ERROR', message: 'Failed to verify plan' } });
    }
  };
}

module.exports = {
  planGate,
  invalidatePlanCache,
  getPlanState,
  FEATURE_PLAN,
  PLAN_LEVELS,
  PLAN_GRACE_DAYS,
  ENFORCE_PLAN_EXPIRY,
};
