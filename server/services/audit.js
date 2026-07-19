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
 * C5/MR-002: every entry is additionally, automatically enriched with
 * `correlationId` (from req.correlationId — see utils/correlation-id.js)
 * and `orgId`/`membershipId` (derived via a `{userId,schoolId}` lookup
 * against the `memberships` collection, null when no membership exists
 * or schoolId/actor.userId is absent). No call site needs to change —
 * both are derived from the params every call site already passes.
 *
 * C11 Phase 1 / ADR-0006: ALERT_ACTIONS entries enqueue a retried
 * webhook delivery (utils/job-queue.js) instead of firing it inline —
 * see _postSecurityAlertWebhook below.
 *
 * Collection: audit_logs (append-only — documents are never updated or deleted)
 */
'use strict';

const { _model } = require('../utils/model');
const { enqueueJob, registerHandler } = require('../utils/job-queue');

/* ── Critical-event alert actions ───────────────────────────────
   These fire a webhook alert in addition to writing the audit log.
   They represent actions that must never go unnoticed.            */
const ALERT_ACTIONS = new Set([
  'platform.impersonate',
  'platform.school_deleted',
  'platform.backup_restored',
  'student.deleted',
  'report_card.moderation_bypassed',
]);

/* C11 Phase 1 / ADR-0006 — the security alert webhook now goes through
   the job queue instead of firing fire-and-forget. This is the pure
   POST logic, registered as the queue's handler for this job type; it
   returns a real Promise that REJECTS on a non-2xx response or a
   request error, which is what lets the queue actually retry — the
   previous inline version swallowed both silently. */
function _postSecurityAlertWebhook({ action, actor, schoolId, target, details }) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  return new Promise((resolve, reject) => {
    if (!webhook) return resolve(); // shouldn't normally be enqueued without it — see log()'s guard

    let url;
    try { url = new URL(webhook); } catch (err) { return reject(err); }

    const lines = [
      `🔴 **Security Alert — ${action}**`,
      `School: \`${schoolId ?? 'unknown'}\``,
      `Actor: \`${actor?.email ?? actor?.userId ?? 'unknown'}\` (${actor?.role ?? '?'})`,
      target ? `Target: \`${target.type}/${target.id}\`` : null,
      details ? `Details: \`${JSON.stringify(details).slice(0, 200)}\`` : null,
      `Time: ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');
    const body = JSON.stringify({ content: lines });

    const lib  = url.protocol === 'https:' ? require('https') : require('http');
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = lib.request(opts, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`webhook responded ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

registerHandler('security_alert_webhook', _postSecurityAlertWebhook);

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
  // Finance
  'finance.invoice_created':         { severity: 'info' },
  'finance.invoice_updated':         { severity: 'info' },
  'finance.invoice_voided':          { severity: 'warn' },
  'finance.payment_recorded':        { severity: 'info' },
  'finance.fee_structure_created':   { severity: 'info' },
  'finance.fee_structure_updated':   { severity: 'info' },
  'finance.fee_structure_deleted':   { severity: 'warn' },
  'finance.bulk_invoices_generated': { severity: 'info' },
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
    const userId = actor?.userId ?? actor?.id ?? null;

    // C5/MR-002 — membership/org enrichment. Non-fatal: a lookup failure
    // (or simply no matching membership, e.g. platform-operator actions
    // with no per-school membership) must never block the audit write.
    // Skipped entirely when there's no schoolId/userId to look up against.
    let orgId = null, membershipId = null;
    if (schoolId && userId) {
      const membership = await _model('memberships').findOne({ userId, schoolId }).lean().catch(() => null);
      orgId        = membership?.orgId ?? null;
      membershipId = membership?.id    ?? null;
    }

    await _model(COLLECTION).create({
      action,
      severity:   severity ?? defaultSeverity,
      schoolId:   schoolId ?? null,
      orgId,
      membershipId,
      correlationId: req?.correlationId ?? null,
      actor: {
        userId,
        role:    actor?.role     ?? null,
        email:   actor?.email    ?? null,
      },
      target: target ?? null,
      details: details ?? null,
      ip:        req?.ip ?? req?.headers?.['cf-connecting-ip'] ?? null,
      userAgent: req?.headers?.['user-agent'] ?? null,
      createdAt: new Date().toISOString(),
    });
    // C11 Phase 1 / ADR-0006 — critical security actions enqueue a
    // retried webhook delivery instead of firing fire-and-forget.
    // Guard stays here (not inside the handler) so no queue_jobs doc is
    // written at all when the env var is unset, matching the previous
    // early-return behavior. Own try/catch, separate from the audit-log
    // write above — an enqueue failure must not be misreported as a
    // failure to write the audit log itself, which already succeeded.
    if (ALERT_ACTIONS.has(action) && process.env.ALERT_WEBHOOK_URL) {
      try {
        await enqueueJob({ type: 'security_alert_webhook', payload: { action, actor, schoolId, target, details }, maxAttempts: 5 });
      } catch (err) {
        console.error(`[AuditService] Failed to enqueue security alert for "${action}":`, err.message);
      }
    }
  } catch (err) {
    // Non-fatal — logging must never break a school workflow
    console.error(`[AuditService] Failed to log action "${action}":`, err.message);
  }
}

/**
 * Paginated query for audit logs.
 * School admins see only their own school. Superadmin can query all.
 *
 * @param {{ schoolId?, action?, actorId?, severity?, correlationId?, orgId?, membershipId?, from?, to?, page?, limit? }} opts
 */
async function query({ schoolId, action, actorId, severity, correlationId, orgId, membershipId, from, to, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (schoolId)       filter.schoolId          = schoolId;
  if (action)         filter.action            = action;
  if (actorId)        filter['actor.userId']   = actorId;
  if (severity)       filter.severity          = severity;
  if (correlationId)  filter.correlationId     = correlationId;
  if (orgId)           filter.orgId            = orgId;
  if (membershipId)    filter.membershipId     = membershipId;
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
