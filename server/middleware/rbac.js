/* ============================================================
   Msingi — Server-Side RBAC Middleware
   Usage:  router.get('/students', rbac('students', 'read'), handler)

   Permission document shape (role_permissions collection):
   {
     schoolId: "sch_abc",
     roleKey: "teacher",
     permissions: {
       students:   ["read"],
       attendance: ["read", "create", "update"],
       finance:    []
     }
   }

   Only superadmin bypasses the DB check (full access always).
   Admin goes through RBAC so superadmin can restrict it from Settings.
   Cache TTL: 5 minutes per schoolId::role pair.
   ============================================================ */
const { _model } = require('../utils/model');

/* ── In-memory permission cache ─────────────────────────────── */
const _cache = new Map();          // key → { perms, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function _cacheKey(schoolId, role) { return `${schoolId}::${role}`; }

function _getCached(schoolId, role) {
  const entry = _cache.get(_cacheKey(schoolId, role));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(_cacheKey(schoolId, role)); return null; }
  return entry.perms;
}

function _setCache(schoolId, role, perms) {
  _cache.set(_cacheKey(schoolId, role), { perms, expiresAt: Date.now() + CACHE_TTL_MS });
}

/* Bust ALL entries for a school (call after role_permissions change) */
function invalidatePermCache(schoolId) {
  for (const key of _cache.keys()) {
    if (key.startsWith(`${schoolId}::`)) _cache.delete(key);
  }
}

/* ── Roles that always have full access ─────────────────────── */
const SUPERROLES = new Set(['superadmin']);

function _isSuperRole(role, roles = []) {
  return SUPERROLES.has(role) || roles.some(r => SUPERROLES.has(r));
}

/* Legacy role aliases — "deputy" was historically used before "deputy_principal"
   was established as the canonical key. When no role_permissions doc exists for
   the alias, fall back to the canonical key's document. */
const ROLE_ALIASES = { deputy: 'deputy_principal' };

/* ── Load permissions from DB (with cache) ──────────────────── */
async function _loadPerms(schoolId, role) {
  const cached = _getCached(schoolId, role);
  if (cached) return cached;

  const RolePerms = _model('role_permissions');
  let doc = await RolePerms.findOne({ schoolId, roleKey: role }).lean();

  // If no doc found, try legacy alias (e.g. "deputy" → "deputy_principal")
  if (!doc && ROLE_ALIASES[role]) {
    doc = await RolePerms.findOne({ schoolId, roleKey: ROLE_ALIASES[role] }).lean();
  }

  // doc.permissions is an object: { module: ['action', ...] }
  const perms = doc?.permissions || {};
  _setCache(schoolId, role, perms);
  return perms;
}

/* Load per-user permission overrides (keyed by userId, not roleKey) */
async function _loadUserPerms(schoolId, userId) {
  if (!userId) return null;
  const cacheKey = `${schoolId}::user::${userId}`;
  const entry = _cache.get(cacheKey);
  if (entry) {
    if (Date.now() > entry.expiresAt) { _cache.delete(cacheKey); }
    else return entry.perms;
  }
  const doc = await _model('role_permissions').findOne({ schoolId, userId }).lean();
  const perms = doc ? doc.permissions || {} : null;
  if (perms !== null) {
    _cache.set(cacheKey, { perms, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return perms;
}

/* ── Middleware factory ──────────────────────────────────────── */
/**
 * rbac(module, action)
 * Returns Express middleware that checks whether the requesting user
 * has the required permission. Must be used AFTER authMiddleware.
 *
 * @param {string} mod    - Permission module, e.g. 'students'
 * @param {string} action - Permission action, e.g. 'read', 'create', 'update', 'delete'
 */
function rbac(mod, action) {
  return async (req, res, next) => {
    try {
      const { userId, schoolId, role, roles = [] } = req.jwtUser || {};

      if (!schoolId || !role) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }

      // Superadmin bypass all permission checks
      if (_isSuperRole(role, roles)) return next();

      const rolePerms = await _loadPerms(schoolId, role);
      const userPerms = await _loadUserPerms(schoolId, userId);

      // User-level overrides win for any module they specify; role perms fill the rest
      const perms = userPerms ? { ...rolePerms, ...userPerms } : rolePerms;

      // Check if the module+action is permitted
      const allowed = Array.isArray(perms[mod]) && perms[mod].includes(action);

      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Your role does not have '${action}' permission on '${mod}'`
          }
        });
      }

      next();
    } catch (err) {
      console.error('[RBAC] Error loading permissions:', err);
      res.status(500).json({ success: false, error: { code: 'RBAC_ERROR', message: 'Failed to evaluate permissions' } });
    }
  };
}

module.exports = { rbac, invalidatePermCache };
