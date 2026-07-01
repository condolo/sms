/**
 * AuditService — append-only audit log for high-impact platform actions.
 *
 * Usage:
 *   const AuditService = require('../services/audit');
 *
 *   await AuditService.log({
 *     action:   'report_card.publish',
 *     actor:    req.jwtUser,               // { userId, role, email? }
 *     schoolId: req.jwtUser.schoolId,
 *     target:   { type: 'class', id: classId, label: className },
 *     details:  { termNumber, studentCount, batchId },
 *     severity: 'critical',                // 'info' | 'warn' | 'critical'
 *     req,                                 // Express request — for IP + UA
 *   });
 *
 * Non-fatal by design: logging failures are captured and printed but
 * never propagate to the caller. A broken audit log must never block
 * a school's workflow.
 *
 * Collection: audit_logs (append-only — documents are never updated or deleted)
 */
'use strict';

const { _model } = require('../utils/model');

const COLLECTION = 'audit_logs';

/**
 * Action catalogue.
 * severity defaults: 'info' unless overridden per call.
 */
const ACTIONS = {
  // Identity
  'auth.login':              { severity: 'info' },
  'auth.login_failed':       { severity: 'warn' },
  'auth.logout':             { severity: 'info' },
  'auth.password_changed':   { severity: 'warn' },
  'auth.mfa_verified':       { severity: 'info' },
  // Users
  'user.role_changed':       { severity: 'warn' },
  'user.created':            { severity: 'info' },
  'user.deactivated':        { severity: 'warn' },
  // Students
  'student.deleted':         { severity: 'warn' },
  'student.deactivated':     { severity: 'warn' },
  'student.promoted':        { severity: 'info' },
  // Report Cards
  'report_card.publish':     { severity: 'critical' },
  'report_card.unpublish':   { severity: 'critical' },
  'report_card.moderation_bypassed': { severity: 'critical' },
  // Platform (operator-level)
  'platform.impersonate':    { severity: 'critical' },
  'platform.school_deleted': { severity: 'critical' },
  'platform.backup_restored':{ severity: 'critical' },
};

/**
 * Log an audit event.
 * @param {{ action, actor, schoolId, target?, details?, severity?, req? }} opts
 * @returns {Promise<void>}
 */
async function log({ action, actor, schoolId, target, details, severity, req } = {}) {
  try {
    const defaultSeverity = ACTIONS[action]?.severity ?? 'info';

    await _model(COLLECTION).create({
      action,
      severity:   severity ?? defaultSeverity,
      schoolId:   schoolId ?? null,
      actor: {
        userId:  actor?.userId   ?? actor?.id ?? null,
        role:    actor?.role     ?? null,
        email:   actor?.email    ?? null,
      },
      target: target ?? null,
      details: details ?? null,
      ip:        req?.ip ?? req?.headers?.['cf-connecting-ip'] ?? null,
      userAgent: req?.headers?.['user-agent'] ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal — logging must never break a school workflow
    console.error(`[AuditService] Failed to log action "${action}":`, err.message);
  }
}

/**
 * Paginated query for audit logs.
 * School admins see only their own school. Superadmin can query all.
 *
 * @param {{ schoolId?, action?, actorId?, severity?, from?, to?, page?, limit? }} opts
 */
async function query({ schoolId, action, actorId, severity, from, to, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (schoolId)  filter.schoolId       = schoolId;
  if (action)    filter.action         = action;
  if (actorId)   filter['actor.userId']= actorId;
  if (severity)  filter.severity       = severity;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to)   filter.createdAt.$lte = to;
  }

  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    _model(COLLECTION).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    _model(COLLECTION).countDocuments(filter),
  ]);

  return { docs, total, page, limit, pages: Math.ceil(total / limit) };
}

module.exports = { log, query, ACTIONS };
