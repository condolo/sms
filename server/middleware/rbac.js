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

/* ── Merge a per-user override delta on top of a role's permissions ──
   Role Architecture Audit 2026-08 §2d. userPerms is INTENDED to be a
   SPARSE delta — settings.js's current _deriveUserOverridePerms only
   ever writes the exact mod__sub keys an admin explicitly touched via
   Per User, nothing else. A plain `{...rolePerms, ...userPerms}` gets
   the per-key override part right for free (an untouched key is simply
   absent from userPerms, so the role's own value for it survives the
   spread untouched) — but it leaves each affected module's own COARSE
   key (perms[mod], the one a no-subKey rbac() call actually reads)
   stuck at whatever the role alone produced, ignoring the override
   entirely for anyone who checks module-level access rather than a
   specific sub-feature.
   Recomputed here, per affected module, as the union of: the role's own
   original coarse grant (a floor — some role docs, e.g. freshly seeded
   ones from repairPermissions.js, have ONLY this coarse grant with no
   mod__sub breakdown at all yet), the role's own sub-key grants, and
   the override's sub-key grants. Never narrower than what the role
   already grants at the coarse level — the UI has no control that lets
   an admin revoke a bare module key via Per User, only individual
   sub-features, so there is nothing here that should ever shrink it.

   PLAT/RBAC follow-up (2026-09) — a REAL production account (Ann
   Wanjiku, admissions_officer) hit a gap in the above: "touched module"
   was computed only from mod__sub keys, so a module present in userPerms
   as ONLY a bare coarse key (no accompanying mod__sub key at all) never
   entered touchedModules, never got floor-recomputed, and the initial
   spread's userPerms[mod] value — e.g. a stale `[]` — silently won over
   the role's real grant. This bare-key shape is exactly what the
   PRE-2026-08 version of _deriveUserOverridePerms used to write for
   every module an admin hadn't touched (a zero-filled coarse-only
   entry, no subs) — legacy documents saved before that fix still carry
   it today, and nothing has migrated them. The current UI can only ever
   write mod__sub keys (never a bare mod key on its own), so a bare key
   found here is either such a legacy artifact, or — for a module that
   genuinely has real content on the bare key AND matching sub-key
   content (a module the admin DID touch, pre-fix) — is already fully
   covered by the union-of-subs step below, since pre-fix saves always
   wrote sub-keys alongside a non-empty bare key. Either way, treating a
   bare key as "touched" too, and then still deriving its final value
   from floor + subs (never from the bare value itself), is safe for
   every real document shape this codebase can produce and closes the
   gap without needing a data migration. */
function _mergeUserOverrides(rolePerms, userPerms) {
  const merged = { ...rolePerms, ...userPerms };

  const touchedModules = new Set(
    Object.keys(userPerms).map(k => k.includes('__') ? k.split('__')[0] : k)
  );
  for (const mod of touchedModules) {
    const actions = new Set(Array.isArray(rolePerms[mod]) ? rolePerms[mod] : []);
    for (const [key, arr] of Object.entries(merged)) {
      if (key.startsWith(`${mod}__`) && Array.isArray(arr)) arr.forEach(a => actions.add(a));
    }
    merged[mod] = [...actions];
  }
  return merged;
}

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
 * rbac(module, action, subKey?)
 * Returns Express middleware that checks whether the requesting user
 * has the required permission. Must be used AFTER authMiddleware.
 *
 * When subKey is provided AND the role/user has an explicit grant for
 * `${module}__${subKey}` (written by Settings → Roles & Permissions'
 * per-sub V/E/D checkboxes, see settings.js's _deriveApiPerms()), that
 * sub-level grant is checked INSTEAD of the coarse module-level grant —
 * this is what lets "View Leave Requests" and "View Payroll" be granted
 * independently within the same 'hr' module. If no sub-level grant
 * exists (module not yet customized at that granularity, or the caller
 * didn't pass a subKey), this falls back to the original module-level
 * check exactly as before — fully backward compatible with every
 * existing rbac(module, action) call site.
 *
 * @param {string} mod     - Permission module, e.g. 'students'
 * @param {string} action  - Permission action, e.g. 'read', 'create', 'update', 'delete'
 * @param {string} [subKey] - Optional sub-permission key, e.g. 'payroll_view'
 */
/* Shared by rbac()'s middleware path and the standalone hasPermission()
   helper below — same subKey-falls-back-to-module-level rule either way. */
async function _isAllowed(jwtUser, mod, action, subKey) {
  const { userId, schoolId, role, roles = [] } = jwtUser || {};
  if (!schoolId || !role) return false;
  if (_isSuperRole(role, roles)) return true;

  const rolePerms = await _loadPerms(schoolId, role);
  const userPerms = await _loadUserPerms(schoolId, userId);
  const perms = userPerms ? _mergeUserOverrides(rolePerms, userPerms) : rolePerms;

  const subFullKey = subKey ? `${mod}__${subKey}` : null;
  const hasSubGrant = subFullKey && Array.isArray(perms[subFullKey]);

  return hasSubGrant
    ? perms[subFullKey].includes(action)
    : Array.isArray(perms[mod]) && perms[mod].includes(action);
}

/**
 * hasPermission(req, module, action, subKey?)
 * Standalone (non-middleware) permission check for handlers that need to
 * branch on a permission INSIDE their own logic rather than gate the
 * whole route — e.g. narrowing a list query to "your own records" for
 * callers without a broader grant, the way GET /api/library/loans scopes
 * results instead of 403ing outright. Same subKey-falls-back-to-module
 * rule as rbac(); never throws — a lookup failure resolves to false,
 * the same fail-closed posture rbac()'s own catch block has (a caller
 * using this for scoping should treat false as "narrow the query", not
 * "something broke").
 */
async function hasPermission(req, mod, action, subKey) {
  try {
    return await _isAllowed(req.jwtUser, mod, action, subKey);
  } catch (err) {
    console.error('[RBAC] hasPermission lookup failed:', err.message);
    return false;
  }
}

function rbac(mod, action, subKey) {
  return async (req, res, next) => {
    try {
      const { schoolId, role } = req.jwtUser || {};
      if (!schoolId || !role) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }

      const allowed = await _isAllowed(req.jwtUser, mod, action, subKey);

      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Your role does not have '${action}' permission on '${mod}'${subKey ? ` (${subKey})` : ''}`
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

module.exports = { rbac, hasPermission, invalidatePermCache, _mergeUserOverrides };
