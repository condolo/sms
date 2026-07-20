/* ============================================================
   Msingi — /api/audit
   Audit log query endpoint. School-scoped only — every caller (admin
   or superadmin) is locked to their own school, always. 'superadmin'
   is a per-school RBAC role every school's own admin holds, not a
   platform credential; a prior version of this route let 'superadmin'
   omit schoolId to get a platform-wide view, meaning any school's own
   admin could see every OTHER school's audit log — a real cross-tenant
   leak, found via a direct report, not a scan. Platform-wide audit
   visibility, when it's built, belongs behind platform.js's
   platformSession gate, the same as every other platform-wide read.

   GET /api/audit            — paginated log list, own school only
                                (also accepts correlationId/orgId/
                                membershipId filters, C5/MR-002 — see
                                AuditService.query())
   GET /api/audit/actions    — list of known action types (for filter UI)
   ============================================================ */
'use strict';

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { ok, parsePagination, paginate, E } = require('../utils/response');
const AuditService = require('../services/audit');

const router = express.Router();

/* ── Auth guard ──────────────────────────────────────────────── */
function _adminGuard(req, res, next) {
  const { role } = req.jwtUser;
  if (!['admin', 'superadmin'].includes(role)) {
    return E.forbidden(res, 'Admin access required');
  }
  next();
}

/* ════════════════════════════════════════════════════════════════
   GET /api/audit
   ════════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, _adminGuard, async (req, res) => {
  try {
    const { schoolId: actorSchoolId } = req.jwtUser;
    const { page, limit } = parsePagination(req.query);

    const { docs, total } = await AuditService.query({
      schoolId: actorSchoolId,
      action:        req.query.action        || undefined,
      actorId:       req.query.actorId       || undefined,
      severity:      req.query.severity      || undefined,
      correlationId: req.query.correlationId || undefined,
      orgId:         req.query.orgId         || undefined,
      membershipId:  req.query.membershipId  || undefined,
      from:          req.query.from          || undefined,
      to:            req.query.to            || undefined,
      page,
      limit,
    });

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[audit GET]', err);
    return E.serverError(res);
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /api/audit/actions
   Returns the catalogue of known action types for filter dropdowns.
   ════════════════════════════════════════════════════════════════ */
router.get('/actions', authMiddleware, _adminGuard, (req, res) => {
  const actions = Object.entries(AuditService.ACTIONS).map(([action, meta]) => ({
    action,
    severity: meta.severity,
  }));
  return ok(res, actions);
});

module.exports = router;
