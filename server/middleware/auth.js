const { verify } = require('../utils/jwt');

/* Attach req.jwtUser if valid token present */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  req.jwtUser = payload;   // { userId, schoolId, role, roles, email }
  next();
}

/* Platform admin check — uses PLATFORM_ADMIN_KEY header */
function platformAdmin(req, res, next) {
  const key = req.headers['x-platform-key'];
  if (!key || key !== process.env.PLATFORM_ADMIN_KEY) {
    return res.status(403).json({ error: 'Platform admin access only' });
  }
  next();
}

module.exports = { authMiddleware, platformAdmin };
