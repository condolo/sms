const { verify } = require('../utils/jwt');

/* Standard error envelope — matches { success, error: { code, message } } used everywhere */
function _unauth(res, code, message) {
  return res.status(401).json({ success: false, error: { code, message } });
}

/* Attach req.jwtUser if valid token present */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return _unauth(res, 'UNAUTHENTICATED', 'No token provided');

  const payload = verify(token);
  if (!payload) return _unauth(res, 'UNAUTHENTICATED', 'Invalid or expired token');

  req.jwtUser = payload;   // { userId, schoolId, role, roles, email, guardianOf? (parent/guardian only) }
  next();
}

/* Platform admin check — uses PLATFORM_ADMIN_KEY header */
function platformAdmin(req, res, next) {
  const key = req.headers['x-platform-key'];
  if (!key || key !== process.env.PLATFORM_ADMIN_KEY) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Platform admin access only' } });
  }
  next();
}

module.exports = { authMiddleware, platformAdmin };
