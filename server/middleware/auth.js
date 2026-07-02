const crypto               = require('crypto');
const jwt                  = require('jsonwebtoken');
const { verify }           = require('../utils/jwt');
const { getTokenVersion }  = require('../utils/token-version');
const { _model }           = require('../utils/model');

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

    req.jwtUser = payload;   // { userId, schoolId, role, roles, email, tv, guardianOf? … }

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
   Issued by POST /api/platform/auth/login; separate from school JWT. */
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
    if (payload.sub !== 'platform-admin') throw new Error('invalid subject');
    req.platformAdmin = true;
    next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'PLATFORM_SESSION_EXPIRED', message: 'Platform session expired. Please sign in again.' } });
  }
}

module.exports = { authMiddleware, platformAdmin, platformSession };
