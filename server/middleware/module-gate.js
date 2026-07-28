/* ============================================================
   Msingi — Module On/Off Gate
   Usage:  router.get('/', authMiddleware, PLAN, moduleGate('library'), rbac(...), handler)

   A school admin can disable a whole module from Settings → Modules
   (school.moduleConfig, edited via ModulesTab / Sidebar). Until now
   that only hid the Sidebar nav link — the API itself still answered
   every request for a disabled module. This middleware makes the
   toggle a real access-control boundary: a disabled module 403s here
   regardless of the caller's role/permissions.

   Distinct from planGate (subscription-tier gating) and rbac (per-role
   permission gating) — this is the school's OWN on/off preference for
   a module it already has entitlement to and permission for.

   Must run AFTER authMiddleware (needs req.jwtUser.schoolId).
   ============================================================ */
const { _model } = require('../utils/model');

/* ── moduleConfig cache — same 5-min TTL pattern as planGate's plan cache ── */
const _cfgCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function _getCached(schoolId) {
  const entry = _cfgCache.get(schoolId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cfgCache.delete(schoolId); return null; }
  return entry.moduleConfig;
}

function _setCached(schoolId, moduleConfig) {
  _cfgCache.set(schoolId, { moduleConfig, expiresAt: Date.now() + CACHE_TTL });
}

function invalidateModuleConfigCache(schoolId) {
  _cfgCache.delete(schoolId);
}

async function _getModuleConfig(schoolId) {
  const cached = _getCached(schoolId);
  if (cached !== null) return cached;

  const Schools = _model('schools');
  const school  = await Schools.findOne({ id: schoolId }).select('moduleConfig').lean();
  const cfg     = school?.moduleConfig || [];
  _setCached(schoolId, cfg);
  return cfg;
}

/**
 * moduleGate(moduleKey)
 * Returns middleware that 403s if the school has explicitly disabled
 * this module. A module with no entry in moduleConfig, or a config
 * lookup failure, defaults to enabled — same fail-open-on-absence
 * posture as Sidebar.jsx's `cfgMap[m.key]?.enabled ?? true`, so a
 * school that never touched the Modules tab is unaffected.
 */
function moduleGate(moduleKey) {
  return async (req, res, next) => {
    try {
      const { schoolId } = req.jwtUser || {};
      if (!schoolId) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }

      const cfg   = await _getModuleConfig(schoolId);
      const entry = cfg.find(m => m.key === moduleKey);
      if (entry && entry.enabled === false) {
        return res.status(403).json({
          success: false,
          error: { code: 'MODULE_DISABLED', message: `The '${moduleKey}' module has been disabled for this school.` },
        });
      }
      return next();
    } catch (err) {
      // Fail open on lookup errors — matches planGate's posture of never
      // introducing a new failure mode beyond today's behavior.
      console.error(`[ModuleGate] Lookup failed for school, module '${moduleKey}' — allowing through:`, err.message);
      return next();
    }
  };
}

module.exports = { moduleGate, invalidateModuleConfigCache };
