/* ============================================================
   Msingi — /api/audit
   Audit log query endpoint.

   School admins: see their own school's logs only.
   Superadmin: can query across all schools (omit schoolId param
               to get platform-wide; pass ?schoolId= to filter).

   GET /api/audit            — paginated log list (also accepts
                                correlationId/orgId/membershipId filters,
                                C5/MR-002 — see AuditService.query())
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
    const { role, schoolId: actorSchoolId } = req.jwtUser;
    const { page, limit } = parsePagination(req.query);

    // Superadmin can see all schools or filter; admin is locked to own school
    const schoolId = role === 'superadmin'
      ? (req.query.schoolId || undefined)
      : actorSchoolId;

    const { docs, total } = await AuditService.query({
      schoolId,
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
