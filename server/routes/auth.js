const express   = require('express');
const bcrypt    = require('bcryptjs');
const { sign }  = require('../utils/jwt');
const { _model } = require('../utils/model');
const { tenantMiddleware } = require('../middleware/tenant');
const { authMiddleware }   = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

/* POST /api/auth/login
   Body: { email, password }
   Header: X-School-Slug: InnoLearn   (or resolved from subdomain by tenant middleware)
   Returns: { token, user, school }
*/
router.post('/login', loginLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const User   = _model('users');
    const School = _model('schools');

    // Find user regardless of isActive so we can give a clear pending message
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      schoolId: req.school.id
    }).lean();

    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // If user is inactive, check whether school is pending approval
    if (!user.isActive) {
      const school = await School.findOne({ id: req.school.id }).lean();
      if (school?.status === 'pending') {
        return res.status(403).json({
          error: 'pending_approval',
          message: 'Your school is currently under review. You will receive an email within 24 hours once approved.'
        });
      }
      if (school?.status === 'rejected') {
        return res.status(403).json({
          error: 'rejected',
          message: 'Your school registration was not approved. Please contact support at innolearnnetwork@gmail.com.'
        });
      }
      return res.status(403).json({ error: 'Account inactive. Please contact your school administrator.' });
    }

    // Support both bcrypt hashes and plain-text (migration period)
    const match = user.password.startsWith('$2')
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    // Update last login
    await _model('users').updateOne({ _id: user._id }, { lastLogin: new Date().toISOString() });

    const tokenPayload = {
      userId:   user.id,
      schoolId: req.school.id,
      email:    user.email,
      role:     user.primaryRole || user.role,
      roles:    user.roles || [user.role]
    };
    const token = sign(tokenPayload);

    const safeUser = { ...user, password: undefined };
    res.json({ token, user: safeUser, school: req.school });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* GET /api/auth/me — verify token + return current user */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const User = _model('users');
    const user = await User.findOne({ id: req.jwtUser.userId, schoolId: req.jwtUser.schoolId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const School = _model('schools');
    const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();

    res.json({ user: { ...user, password: undefined }, school });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/* POST /api/auth/change-password */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const User = _model('users');
    const user = await User.findOne({ id: req.jwtUser.userId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = user.password.startsWith('$2')
      ? await bcrypt.compare(currentPassword, user.password)
      : currentPassword === user.password;
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ id: req.jwtUser.userId }, { password: hashed });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
