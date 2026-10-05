'use strict';

/* ═══════════════════════════════════════════════════════════════
   EXPLICIT FINANCE SUB-PERMISSIONS

   Some finance actions are granted on their own, not through the general
   finance create/update rights:
     finance__term_billing   run term billing (preview = read, generate = create)
     finance__early_payment  confirm early payment (create) and change its
                             deadline or percentage (update)
     finance__activities     manage activities and enrolments (create/update)

   A general finance grant does NOT cover these. The check is
   hasExplicitSubGrant, which has no module-level fallback. The grant ceiling
   in settings.js treats the same keys as explicit (EXPLICIT_SUB_KEYS), so a
   user can't pass on a right they don't hold explicitly.

   Existing roles keep what they had: withFinanceSubGrants() derives the new
   keys from each role's current finance actions. It is used by the one-time
   backfill (utils/finance-permission-backfill.js) and by the default role
   seeds for new schools (onboard.js, platform.js), so neither leaves a school's
   bursar locked out.
   ═══════════════════════════════════════════════════════════════ */

const { hasExplicitSubGrant } = require('./rbac');

/* The finance actions each explicit key is derived from. Only actions the role
   already holds at module level are copied across. */
const FINANCE_SUB_GRANTS = {
  finance__term_billing:  ['read', 'create'],
  finance__early_payment: ['update', 'create'],
  finance__activities:    ['create', 'update'],
};

const EXPLICIT_SUB_KEYS = new Set(Object.keys(FINANCE_SUB_GRANTS));

/**
 * Middleware: refuse unless the caller's role (or their user override) holds
 * the action on this sub-permission explicitly. Fails closed.
 */
function explicitSub(mod, sub, action) {
  return async (req, res, next) => {
    try {
      if (await hasExplicitSubGrant(req, mod, sub, action)) return next();
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Your role does not have '${action}' permission on '${mod}' (${sub}). Ask an administrator to grant it under Roles & Permissions.`,
        },
      });
    } catch (err) {
      console.error('[RBAC] explicitSub check failed:', err.message);
      return res.status(500).json({ success: false, error: { code: 'RBAC_ERROR', message: 'Failed to evaluate permissions' } });
    }
  };
}

/**
 * Returns a copy of a role's (or user's) permission map with the explicit
 * finance keys added where the map already holds the matching finance
 * actions. Never overwrites a key that is already set.
 */
function withFinanceSubGrants(permissions) {
  const finance = permissions?.finance;
  if (!Array.isArray(finance) || !finance.length) return permissions;
  const out = { ...permissions };
  for (const [key, wanted] of Object.entries(FINANCE_SUB_GRANTS)) {
    if (Array.isArray(out[key])) continue;
    const actions = wanted.filter(a => finance.includes(a));
    if (actions.length) out[key] = actions;
  }
  return out;
}

module.exports = { explicitSub, withFinanceSubGrants, EXPLICIT_SUB_KEYS, FINANCE_SUB_GRANTS };
