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
  'user.bulk_created':       { severity: 'info' },
  'user.deactivated':        { severity: 'warn' },
  'user.password_reset_by_admin': { severity: 'warn' },
  // Settings — school profile, branding, SMTP, custom roles (Audit
  // Instrumentation sprint, 2026-07-29 — this is the "control panel" file
  // from the Settings-as-control-panel work earlier this session, so its
  // mutations (module toggles, role/permission grants, SMTP creds,
  // custom-role definitions) are exactly the kind of change that needs a
  // trail). severity escalated per-call-site to 'warn' when the change
  // touches modulePermissions/moduleConfig specifically.
  'settings.school_updated':        { severity: 'info' },
  'settings.custom_role_created':   { severity: 'info' },
  'settings.custom_role_updated':   { severity: 'info' },
  'settings.custom_role_deleted':   { severity: 'warn' },
  // Students
  'student.deleted':         { severity: 'warn' },
  'student.deactivated':     { severity: 'warn' },
  'student.promoted':        { severity: 'info' },
  'student.medical_updated': { severity: 'warn' }, // Medical Centre milestone 1 — sensitive data, distinct from a routine profile edit
  'student.medical_consent_recorded': { severity: 'critical' }, // Medical Centre milestone 2 — parent consent has real legal/compliance weight
  // Admissions — clean application-to-enrollment flow (2026-09 field
  // update, Phase 3). Creates a real Student record and a permanent
  // admission number — worth its own trail distinct from an ordinary
  // application edit.
  'admissions.enrolled':     { severity: 'info' },
  // Medical Centre milestone 3 — Clinic Visits
  'medical.visit_logged':  { severity: 'info' },
  'medical.visit_deleted': { severity: 'warn' },
  // Inventory milestone 1 — Items
  'inventory.item_created': { severity: 'info' },
  'inventory.item_deleted': { severity: 'warn' },
  // Inventory milestone 2 — Stock Transactions. Default 'info'; escalated
  // to 'warn' per-call for adjustment-type transactions (a manual
  // override of the recorded stock level, same escalation posture as
  // payroll.status_changed's 'paid' case).
  'inventory.transaction_recorded': { severity: 'info' },
  // Inventory milestone 3 — Requisitions + Procurement (Workflow Engine reuse)
  'inventory.requisition_raised':         { severity: 'info' },
  'inventory.requisition_step_approved':  { severity: 'info' },
  'inventory.requisition_step_rejected':  { severity: 'warn' },
  'inventory.requisition_fulfilled':      { severity: 'info' },
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
  // HR — Leave workflow (Governance Spec §1)
  'leave.step_approved':     { severity: 'info' },
  'leave.step_rejected':     { severity: 'warn' },
  'leave.hr_confirmed':      { severity: 'info' },
  'leave.hr_rejected':       { severity: 'warn' },
  // HR — Payroll (Payroll Phase 1, Step 1 — stabilizing the existing hr.js
  // payroll feature per the HR & Payroll Architectural Review's §6/§10
  // finding that payroll had zero audit coverage). Default severities
  // below; call sites override to 'critical' for the specific
  // higher-stakes cases (marking a record 'paid'; deleting a
  // confirmed/paid record) — mirroring report_card.publish's treatment.
  'payroll.record_saved':    { severity: 'info' },
  'payroll.status_changed':  { severity: 'warn' },
  'payroll.copied':          { severity: 'info' },
  'payroll.deleted':         { severity: 'warn' },
  // Marks — unlock workflow (Governance Spec §3)
  'marks.unlock_requested':        { severity: 'info' },
  'marks.unlocked':                { severity: 'warn' },
  'marks.unlock_request_rejected': { severity: 'info' },
  'marks.auto_relocked':           { severity: 'info' },
  // Growth Profile / Behaviour (Governance Spec §2)
  'behaviour.points_reset':        { severity: 'warn' },
  // Platform (operator-level)
  'platform.impersonate':       { severity: 'critical' },
  // PLAT-01 remediation — the other two lifecycle events a real, tracked
  // impersonation session now has: explicit early revocation (by either
  // the platform operator or the impersonated school's own admin — same
  // action name either way, actor.role distinguishes which), and a
  // denied attempt to use a session that's already revoked or expired
  // (authMiddleware's per-request check — see middleware/auth.js).
  // 'warn', not 'critical': both are expected, working-as-intended
  // outcomes of a session ending, not an anomaly on their own the way the
  // impersonation grant itself is.
  'platform.impersonate_revoked': { severity: 'warn' },
  'platform.impersonate_denied':  { severity: 'warn' },
  'platform.school_deleted':    { severity: 'critical' },
  'platform.backup_restored':   { severity: 'critical' },
  'platform.superadmin_added':  { severity: 'warn' },
  'platform.superadmin_password_reset': { severity: 'warn' }, // same tier as user.password_reset_by_admin
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
        // Security Baseline Register, PLAT-03 — preserves BOTH identities
        // for any action logged during an impersonated session: `userId`/
        // `role`/`email` above still show the impersonated school admin
        // (unchanged, exactly as before), while these two fields make the
        // impersonation itself visible instead of invisible, and correlate
        // this entry back to the platform.impersonate grant that has who
        // requested it, which school, when, and why. `actor` here is
        // req.jwtUser at virtually every call site already — this reads
        // whatever that session's JWT already carries (set once, at grant
        // time, in platform.js's impersonate route) rather than requiring
        // every existing call site to be touched individually.
        ...(actor?.impersonated ? { impersonated: true, impersonationId: actor?.impersonationId ?? null } : {}),
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

/* ── Regex-safe free-text search ──────────────────────────────────
   See utils/escape-regex.js — the term is matched, never interpreted. */
const { escapeRegex } = require('../utils/escape-regex');

/* ── Date bounds ─────────────────────────────────────────────────
   createdAt is written through Mongoose, so it is stored as a BSON
   Date — even though the audit writer hands it an ISO string.

   Two things follow, and both matter:

   1. Date-only bounds are widened to the full day so the filter bar
      matches what the admin picked: "to 20 Oct" must include
      everything that happened ON the 20th, not just midnight.

   2. The bounds MUST be real Date objects, not ISO strings. Mongoose
      casts a filter for find()/countDocuments(), so a string bound
      works there — but aggregate() does NOT cast its pipeline, so a
      string bound is compared against a BSON Date and matches nothing.
      That silently emptied every counter on the Audit Log KPI row
      while the table below it showed the right rows. Passing Dates
      everywhere makes the list, the counts and the aggregates agree.

   An unparseable bound is dropped rather than passed on as garbage —
   a filter the admin can't see must not be able to 500 the query. */
function _dayStart(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) value = `${value}T00:00:00.000Z`;
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
}
function _dayEnd(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) value = `${value}T23:59:59.999Z`;
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
}

/**
 * Paginated query for audit logs.
 * School admins see only their own school. Superadmin can query all.
 *
 * @param {{ schoolId?, action?, actorId?, severity?, correlationId?, orgId?, membershipId?, from?, to?, q?, page?, limit? }} opts
 */
async function query({ schoolId, action, actorId, severity, correlationId, orgId, membershipId, from, to, q, page = 1, limit = 50 } = {}) {
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
    const start = _dayStart(from);
    const end   = _dayEnd(to);
    if (start) filter.createdAt.$gte = start;
    if (end)   filter.createdAt.$lte = end;
  }
  // Free-text search across the three fields an admin actually looks at
  // when hunting for "who did what to whom": the action name, the actor's
  // email, and the target's human label. The term is regex-escaped first —
  // raw user input as a regex is both a crash risk (an unbalanced "[" is a
  // BSON error, i.e. a 500) and a way to make the database walk far more of
  // the collection than intended.
  const term = typeof q === 'string' ? q.trim() : '';
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { action:        rx },
      { 'actor.email': rx },
      { 'target.label': rx },
    ];
  }

  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    _model(COLLECTION).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    _model(COLLECTION).countDocuments(filter),
  ]);

  return { docs, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Aggregate stats for the audit log — the KPI row in Settings → Audit Log
 * (total events, how many critical/warn/info, how many distinct people acted.
 * what the busiest action was, how much happened in the last 24 hours).
 *
 * Scoped exactly like query(): a school admin only ever sees their own
 * school's numbers, and the optional date window narrows every figure so the
 * cards always agree with the filter bar sitting right above them — a "last 7
 * days" filter must not leave the "total events" card showing all-time numbers.
 *
 * @param {{ schoolId?, from?, to? }} opts
 */
async function stats({ schoolId, from, to } = {}) {
  const filter = {};
  if (schoolId) filter.schoolId = schoolId;

  const start = _dayStart(from);
  const end   = _dayEnd(to);
  if (start || end) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = start;
    if (end)   filter.createdAt.$lte = end;
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [severityAgg, actionAgg, actorAgg, total, last24h] = await Promise.all([
    _model(COLLECTION).aggregate([
      { $match: filter },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    _model(COLLECTION).aggregate([
      { $match: filter },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    _model(COLLECTION).aggregate([
      { $match: filter },
      { $match: { 'actor.userId': { $ne: null } } },
      { $group: { _id: '$actor.userId' } },
      { $count: 'total' },
    ]),
    _model(COLLECTION).countDocuments(filter),
    // "Last 24 hours" honours the same window as everything else — a date range
    // that ends in the past must not report today's events as recent.
    _model(COLLECTION).countDocuments({
      ...filter,
      createdAt: {
        $gte: start && start > since24h ? start : since24h,
        ...(end ? { $lte: end } : {}),
      },
    }),
  ]);

  const bySeverity = { info: 0, warn: 0, critical: 0 };
  for (const row of severityAgg) {
    const key = typeof row._id === 'string' ? row._id : 'info';
    bySeverity[key] = (bySeverity[key] ?? 0) + row.count;
  }

  const topActions = actionAgg
    .filter(row => typeof row._id === 'string')
    .map(row => ({ action: row._id, count: row.count }));

  return {
    total,
    bySeverity,
    uniqueActors: actorAgg[0]?.total ?? 0,
    last24h,
    topActions,
    topAction: topActions[0] ?? null,
  };
}

module.exports = { log, query, stats, ACTIONS };
