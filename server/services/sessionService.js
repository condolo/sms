'use strict';

const { v4: uuidv4 }       = require('uuid');
const { _model }            = require('../utils/model');
const { revokeUserTokens }  = require('../utils/token-version');
const { ABSOLUTE_TIMEOUT_MS } = require('../utils/jwt');

/* Sessions kept in DB for 2 days after absoluteExpiry so admins can review history */
const SESSION_TTL_BUFFER_MS = 2 * 24 * 60 * 60 * 1000;

/* Simple UA parser — no external dependency */
function _parseUA(ua = '') {
  const mobile = /mobile|android|iphone|ipad|tablet/i.test(ua);
  const device = mobile ? 'Mobile' : 'Desktop';
  const browser =
    /Edg\//i.test(ua)     ? 'Edge'    :
    /Chrome\//i.test(ua)  ? 'Chrome'  :
    /Firefox\//i.test(ua) ? 'Firefox' :
    /Safari\//i.test(ua)  ? 'Safari'  : 'Browser';
  return { device, browser };
}

/* Ensure TTL index on sessions collection (idempotent) */
(async () => {
  try {
    await _model('sessions').collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true, name: 'ttl_expiry' },
    );
  } catch (e) {
    console.error('[SessionService] TTL index init:', e.message);
  }
})();

/* ─────────────────────────────────────────────────────────────────
   createSession(userId, schoolId, role, ip, ua)
   Called at every full token issuance (login, OTP verify, force-change).
   Returns: { sessionId, absoluteExpiry (ISO string) }
   ───────────────────────────────────────────────────────────────── */
async function createSession(userId, schoolId, role, ip, ua) {
  const { device, browser } = _parseUA(ua);
  const now             = new Date();
  const absoluteExpiry  = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);

  const doc = await _model('sessions').create({
    id:              uuidv4(),
    schoolId,
    userId,
    role,
    ip,
    userAgent:       ua || '',
    device,
    browser,
    startedAt:       now,
    lastActivity:    now,
    absoluteExpiry,
    status:          'active',
    expiresAt:       new Date(absoluteExpiry.getTime() + SESSION_TTL_BUFFER_MS),
  });

  return {
    sessionId:       doc.id,
    absoluteExpiry:  absoluteExpiry.toISOString(),
  };
}

/* ─────────────────────────────────────────────────────────────────
   refreshSession(sessionId, userId)
   Called by POST /auth/ping. Updates lastActivity.
   Returns: { absoluteExpiry } on success, null if revoked/expired.
   ───────────────────────────────────────────────────────────────── */
async function refreshSession(sessionId, userId) {
  const doc = await _model('sessions')
    .findOne({ id: sessionId, userId, status: 'active' })
    .lean();

  if (!doc) return null;
  if (new Date(doc.absoluteExpiry) < new Date()) return null;

  await _model('sessions').updateOne(
    { id: sessionId },
    { $set: { lastActivity: new Date() } },
  );

  return { absoluteExpiry: doc.absoluteExpiry.toISOString() };
}

/* ─────────────────────────────────────────────────────────────────
   listSessions(userId, schoolId)
   Returns active sessions for the user, newest-activity first.
   ───────────────────────────────────────────────────────────────── */
async function listSessions(userId, schoolId) {
  return _model('sessions').find({
    userId,
    schoolId,
    status:          'active',
    absoluteExpiry:  { $gt: new Date() },
  }).select('-__v -expiresAt -userAgent').sort({ lastActivity: -1 }).lean();
}

/* ─────────────────────────────────────────────────────────────────
   terminateSession(sessionId, userId, schoolId)
   User terminates one of their own sessions.
   Returns true if a session was actually found and revoked.
   ───────────────────────────────────────────────────────────────── */
async function terminateSession(sessionId, userId, schoolId, logoutReason = 'USER_LOGOUT') {
  const result = await _model('sessions').updateOne(
    { id: sessionId, userId, schoolId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), revokedByUser: true, logoutReason } },
  );
  return result.modifiedCount > 0;
}

/* ─────────────────────────────────────────────────────────────────
   revokeAllUserSessions(targetUserId, schoolId, actorId?)
   Admin (or the user themselves after a password change) revokes every
   active session.  Also bumps tokenVersion so existing JWTs are
   immediately rejected on the next authenticated request.
   ───────────────────────────────────────────────────────────────── */
async function revokeAllUserSessions(targetUserId, schoolId, actorId = null, logoutReason = 'ADMIN_REVOKED') {
  const now = new Date();
  await _model('sessions').updateMany(
    { userId: targetUserId, schoolId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: now, revokedBy: actorId, logoutReason } },
  );
  // Bump tokenVersion so existing JWTs fail immediately (within the 5-min cache window)
  await revokeUserTokens(targetUserId);
}

/* ─────────────────────────────────────────────────────────────────
   terminateCurrentSession(sessionId)
   Called on explicit logout to mark the session revoked.
   ───────────────────────────────────────────────────────────────── */
async function terminateCurrentSession(sessionId, logoutReason = 'USER_LOGOUT') {
  if (!sessionId) return;
  await _model('sessions').updateOne(
    { id: sessionId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), revokedByUser: true, logoutReason } },
  ).catch(() => {});
}

/* ─────────────────────────────────────────────────────────────────
   PLAT-01 remediation — impersonation sessions.

   Reuses this exact collection and status/expiry machinery rather
   than a second session mechanism, per the register's own decision:
   same TTL index, same 'active'/'revoked' status field, same
   absoluteExpiry contract authMiddleware already understands. Two
   things make an impersonation session different from a normal one,
   both additive fields on the same document shape:
     - impersonation: true — how authMiddleware knows to also check
       this specific session's live status on every request (a normal
       session is only checked at /auth/ping, an infrequent, client-
       initiated poll — impersonation needs revocation to take effect
       on the very next request, not eventually).
     - impersonatedBy / reason — who granted this and why, so the
       session document alone (not just the audit log) carries the
       full PLAT-02 record.
   ───────────────────────────────────────────────────────────────── */

/* createImpersonationSession(userId, schoolId, role, ip, ua, meta)
   meta: { impersonatedBy: {operatorId, tier, email}, reason, timeoutMs }
   Returns: { sessionId, absoluteExpiry } — sessionId doubles as the
   impersonationId; unlike the old code, there is no longer a second,
   unrelated uuid for the "same" grant. */
async function createImpersonationSession(userId, schoolId, role, ip, ua, meta = {}) {
  const { device, browser } = _parseUA(ua);
  const now            = new Date();
  const timeoutMs      = meta.timeoutMs || ABSOLUTE_TIMEOUT_MS;
  const absoluteExpiry = new Date(now.getTime() + timeoutMs);

  const doc = await _model('sessions').create({
    id:              uuidv4(),
    schoolId,
    userId,
    role,
    ip,
    userAgent:       ua || '',
    device,
    browser,
    startedAt:       now,
    lastActivity:    now,
    absoluteExpiry,
    status:          'active',
    expiresAt:       new Date(absoluteExpiry.getTime() + SESSION_TTL_BUFFER_MS),
    impersonation:   true,
    impersonatedBy:  meta.impersonatedBy || null,
    reason:          meta.reason || null,
  });

  return {
    sessionId:       doc.id,
    absoluteExpiry:  absoluteExpiry.toISOString(),
  };
}

/* getImpersonationSession(sessionId) — used by both the per-request
   authMiddleware check and the revoke routes. Returns null for a
   non-impersonation session id too (impersonation: true is part of
   the query, not just a field to inspect after) so a normal session
   id can never accidentally be treated as an impersonation grant. */
async function getImpersonationSession(sessionId) {
  if (!sessionId) return null;
  return _model('sessions').findOne({ id: sessionId, impersonation: true }).lean();
}

/* revokeImpersonationSession(sessionId, revokedBy, revokeReason)
   revokedBy: {userId, role, email} of whoever ended it — either the
   platform operator who granted it, or the impersonated school's own
   admin ending it from their side (see platform.js / settings.js).
   Returns true only if an ACTIVE impersonation session was actually
   found and revoked — false for an unknown id or one already ended,
   so callers can tell "nothing to do" from "not authorized to see it". */
async function revokeImpersonationSession(sessionId, revokedBy, revokeReason) {
  const result = await _model('sessions').updateOne(
    { id: sessionId, status: 'active', impersonation: true },
    { $set: { status: 'revoked', revokedAt: new Date(), revokedBy, revokeReason: revokeReason || null } },
  );
  return result.modifiedCount > 0;
}

module.exports = {
  createSession,
  refreshSession,
  listSessions,
  terminateSession,
  revokeAllUserSessions,
  terminateCurrentSession,
  createImpersonationSession,
  getImpersonationSession,
  revokeImpersonationSession,
};
