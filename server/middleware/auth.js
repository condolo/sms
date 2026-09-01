const crypto               = require('crypto');
const jwt                  = require('jsonwebtoken');
const { verify }           = require('../utils/jwt');
const { getTokenVersion, getIdentityTokenVersion } = require('../utils/token-version');
const { _model }           = require('../utils/model');
const SessionService       = require('../services/sessionService');
const AuditService         = require('../services/audit');

/* Standard error envelope — matches { success, error: { code, message } } used everywhere */
function _unauth(res, code, message) {
  return res.status(401).json({ success: false, error: { code, message } });
}

/* Rate-limited lastActivity update — at most one DB write per session per 5 minutes.
   Real API calls are evidence of activity; this records them without a write per request. */
const _actCache = new Map();              // sessionId → lastWrittenAt (ms)
const ACT_INTERVAL = 5 * 60 * 1000;     // 5 min between writes

function _touchActivity(sessionId, userId) {
  const last = _actCache.get(sessionId);
  if (last && Date.now() - last < ACT_INTERVAL) return;
  _actCache.set(sessionId, Date.now());
  _model('sessions')
    .updateOne({ id: sessionId, userId, status: 'active' }, { $set: { lastActivity: new Date() } })
    .catch(() => {});
}

/* Attach req.jwtUser if valid token present.
   Also enforces token version — tokens issued before a role change are rejected. */
async function authMiddleware(req, res, next) {
  try {
    // Read from HttpOnly cookie first (XSS-safe), fall back to Authorization header
    const cookie = req.cookies?.token;
    const header = req.headers.authorization || '';
    const token  = cookie || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return _unauth(res, 'UNAUTHENTICATED', 'No token provided');

    const payload = verify(token);
    if (!payload) return _unauth(res, 'UNAUTHENTICATED', 'Invalid or expired token');

    // Absolute session lifetime — issued at login, never extended by pings.
    // Tokens without absoluteExpiry (pre-v4.53) pass through and rely solely on JWT exp.
    if (payload.absoluteExpiry && new Date(payload.absoluteExpiry) < new Date()) {
      return _unauth(res, 'SESSION_ABSOLUTE_EXPIRED', 'Your session has been active for 8 hours. Please sign in again.');
    }

    // Token version check — only applies to tokens that carry `tv` (issued after v4.32).
    // Old tokens without `tv` pass through until they expire naturally.
    if (typeof payload.tv === 'number') {
      const currentVersion = await getTokenVersion(payload.userId);
      if (payload.tv < currentVersion) {
        return _unauth(res, 'UNAUTHENTICATED', 'Session has been revoked. Please sign in again.');
      }
    }

    // Identity token version check (C8/MR-001 Phase 1, ADR-0003 Decision 4) —
    // additive, same "missing claim passes through" convention as `tv` above.
    // Only tokens for users with a shared credential (users.identityId set)
    // carry `itv`; a password/MFA change bumps identities.tokenVersion,
    // invalidating every token across every school sharing that credential.
    if (typeof payload.itv === 'number' && payload.identityId) {
      const currentIdentityVersion = await getIdentityTokenVersion(payload.identityId);
      if (payload.itv < currentIdentityVersion) {
        return _unauth(res, 'UNAUTHENTICATED', 'Session has been revoked. Please sign in again.');
      }
    }

    // PLAT-01 remediation — impersonation revocation, checked on every
    // request, not just at /auth/ping like a normal session. A normal
    // session's live status is only re-checked when the client happens to
    // call /ping (infrequent, client-initiated) — fine for a user ending
    // their own session, but the acceptance bar here is different: a
    // platform operator or the impersonated school's own admin revoking
    // an active impersonation must take effect on the very next request,
    // not "eventually". Deliberately does NOT reuse the `tv` (tokenVersion)
    // mechanism above — tv is per-userId, and bumping it would also log out
    // the real admin's own concurrent session if they have one open; this
    // checks the exact session record by id instead, touching nothing else
    // belonging to that user. Scoped to impersonated tokens only (an extra
    // DB read per request is acceptable for the rare case, not something to
    // add to every single authenticated request platform-wide).
    if (payload.impersonated && payload.sessionId) {
      const session = await SessionService.getImpersonationSession(payload.sessionId);
      if (!session || session.status !== 'active') {
        AuditService.log({
          action: 'platform.impersonate_denied',
          actor: { userId: payload.userId, role: payload.role, email: payload.email },
          schoolId: payload.schoolId,
          target: { type: 'school', id: payload.schoolId, label: null },
          details: {
            impersonationId: payload.impersonationId ?? payload.sessionId,
            reason: !session ? 'session_not_found' : 'session_revoked_or_expired',
          },
          req,
        });
        return _unauth(res, 'IMPERSONATION_ENDED', 'This impersonation session has ended.');
      }
    }

    req.jwtUser = payload;   // { userId, schoolId, role, roles, email, tv, identityId?, itv?, guardianOf? … }

    // Record activity for session idle tracking — rate-limited to one DB write per 5 min.
    if (payload.sessionId) _touchActivity(payload.sessionId, payload.userId);

    next();
  } catch (err) {
    console.error('[auth] middleware error:', err);
    return _unauth(res, 'UNAUTHENTICATED', 'Authentication error');
  }
}

/* Platform admin check — legacy X-Platform-Key header (kept for backward compat, not used on new routes) */
function platformAdmin(req, res, next) {
  const key    = req.headers['x-platform-key'] || '';
  const secret = process.env.PLATFORM_ADMIN_KEY || '';
  const valid  = secret.length > 0 &&
                 key.length === secret.length &&
                 crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret));
  if (!valid) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Platform admin access only' } });
  }
  next();
}

/* Platform session middleware — verifies the HttpOnly platform_token cookie.
   Issued by POST /api/platform/auth/login; separate from school JWT.

   Security Baseline Register, PLAT-01 — accepts two token shapes:
     sub: 'platform-operator' — issued for a named platform_operators
       account (the normal path once any operator exists). Carries a
       real identity (operatorId/name/email) and a tier ('support' |
       'owner'), exposed as req.platformOperator / req.platformOperatorTier
       for routes that need to distinguish them (see requireOwnerTier
       below).
     sub: 'platform-admin' — the legacy shared-credential token,
       issued only while platform_operators is empty (see the login
       route's bootstrap-safety comment). Treated as owner-tier with no
       real identity behind it, same as it always implicitly was.
   req.platformAdmin stays a plain boolean for either shape, unchanged,
   so ops.js/audit.js/billing.js's existing "is this a platform
   operator at all" checks need no changes. */
function platformSession(req, res, next) {
  const token  = req.cookies?.platform_token;
  const secret = process.env.PLATFORM_JWT_SECRET;

  if (!secret) {
    console.error('[platform] PLATFORM_JWT_SECRET env var is not set');
    return res.status(503).json({ success: false, error: { code: 'MISCONFIGURED', message: 'Platform admin is not configured on this server.' } });
  }
  if (!token) {
    return res.status(401).json({ success: false, error: { code: 'PLATFORM_UNAUTHENTICATED', message: 'Platform session required.' } });
  }
  try {
    const payload = jwt.verify(token, secret);
    if (payload.sub === 'platform-operator') {
      req.platformAdmin = true;
      req.platformOperator = { id: payload.operatorId, name: payload.name, email: payload.email, tier: payload.tier };
      req.platformOperatorTier = payload.tier;
    } else if (payload.sub === 'platform-admin') {
      req.platformAdmin = true;
      req.platformOperator = null;
      req.platformOperatorTier = 'owner'; // legacy shared credential — always full access, as it always implicitly was
    } else {
      throw new Error('invalid subject');
    }
    next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'PLATFORM_SESSION_EXPIRED', message: 'Platform session expired. Please sign in again.' } });
  }
}

/* Owner-tier gate — layered on top of platformSession. A support-tier
   operator can reach any platformSession-gated route that doesn't also
   require this; owner-tier is required for anything mutating or
   otherwise sensitive. See platform.js's router-level wiring for which
   routes that covers. */
function requireOwnerTier(req, res, next) {
  if (req.platformOperatorTier === 'owner') return next();
  return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'This action requires owner-tier platform access.' } });
}

module.exports = { authMiddleware, platformAdmin, platformSession, requireOwnerTier };
