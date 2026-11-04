/* ============================================================
   Msingi — Smart Reminders routes  (/api/smart-reminders)

   GET  /                      what the rules are, when each fires,
                               and when it last ran for this school
   POST /:key/preview          who would hear from it right now
                               (runs the SAME detect() a send runs)
   POST /:key/run              send it now — refused if this window
                               already went out, unless { force:true }

   Read is settings:read, sending is settings:update: this is a
   communication tool, so whoever may change how the school talks to
   parents is the same person allowed to trigger a reminder.
   ============================================================ */
'use strict';

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { _model } = require('../utils/model');
const { ok, E } = require('../utils/response');
const { listRules, previewRule, runRule, runHistory, DEFAULT_TZ } = require('../utils/smart-reminders');
const AuditService = require('../services/audit');

const router = express.Router();

async function _school(req) {
  const { schoolId } = req.jwtUser;
  const school = await _model('schools')
    .findOne({ id: schoolId })
    .select('id name timezone systemEmail').lean();
  return {
    schoolId,
    name: school?.name || '',
    email: school?.systemEmail || '',
    tz: school?.timezone || DEFAULT_TZ,
  };
}

/* GET /api/smart-reminders */
router.get('/', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const school = await _school(req);
    const history = await runHistory(school.schoolId);
    const rules = listRules().map(rule => ({
      ...rule,
      lastRun: history[rule.key]
        ? {
            at: history[rule.key].ranAt,
            sent: history[rule.key].sent,
            windowKey: history[rule.key].windowKey,
          }
        : null,
    }));
    return ok(res, { rules, timezone: school.tz });
  } catch (err) {
    console.error('[smart-reminders GET /]', err);
    return E.serverError(res);
  }
});

/* POST /api/smart-reminders/:key/preview */
router.post('/:key/preview', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const school = await _school(req);
    const result = await previewRule(req.params.key, { schoolId: school.schoolId, tz: school.tz });
    if (result.error) return E.notFound(res, result.error);
    return ok(res, result);
  } catch (err) {
    console.error('[smart-reminders POST /:key/preview]', err);
    return E.serverError(res);
  }
});

/* POST /api/smart-reminders/:key/run */
router.post('/:key/run', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const school = await _school(req);
    const force = req.body?.force === true;

    // A deliberate second send in the same window is a decision, not a
    // retry — it goes to the audit log with the actor attached.
    const result = await runRule(req.params.key, {
      schoolId: school.schoolId,
      tz: school.tz,
      force,
      schoolName: school.name,
      schoolEmail: school.email,
    });
    if (result.error) return E.badRequest(res, result.error);

    AuditService.log({
      action: 'smart_reminders.run',
      actor: req.jwtUser,
      schoolId: school.schoolId,
      target: { type: 'reminder_rule', id: req.params.key },
      details: { sent: result.sent, windowKey: result.windowKey, forced: force, skipped: Boolean(result.skipped) },
      req,
    });

    return ok(res, result);
  } catch (err) {
    console.error('[smart-reminders POST /:key/run]', err);
    return E.serverError(res);
  }
});

module.exports = router;
