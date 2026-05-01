const express   = require('express');
const bcrypt    = require('bcryptjs');
const { sign }  = require('../utils/jwt');
const { _model } = require('../utils/model');
const { tenantMiddleware } = require('../middleware/tenant');
const { authMiddleware }   = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const email     = require('../utils/email');

const router = express.Router();

/* ── OTP helper ─────────────────────────────────────────── */
function _genOTP() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

/* ── Temp password generator (for new user invites) ────── */
function _genTempPassword() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums  = '23456789';
  let pwd = '';
  for (let i = 0; i < 8; i++) pwd += alpha[Math.floor(Math.random() * alpha.length)];
  pwd += nums[Math.floor(Math.random() * nums.length)];
  pwd += nums[Math.floor(Math.random() * nums.length)];
  pwd += '!';
  // shuffle
  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}

/* ── Password age check (60-day policy) ─────────────────── */
const PASSWORD_MAX_DAYS = 60;
function _passwordAge(user) {
  const ref = user.passwordChangedAt || user.createdAt;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref)) / (1000 * 60 * 60 * 24));
}

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

    // ── First-login forced change (new user temp password) ──
    if (user.mustChangePassword) {
      return res.json({
        passwordExpired: true,
        reason: 'first_login',
        userId:   user.id,
        schoolId: req.school.id,
        hint:     'Your administrator has set a temporary password. Please choose your own password to continue.'
      });
    }

    // ── 60-day password rotation policy ────────────────────
    const ageDays = _passwordAge(user);
    if (ageDays >= PASSWORD_MAX_DAYS) {
      // Send expiry email (non-blocking, deduplication by day)
      _checkPasswordExpiryAndNotify(user, req.school).catch(() => {});
      return res.json({
        passwordExpired: true,
        reason: 'expired',
        userId:   user.id,
        schoolId: req.school.id,
        hint:     `Your password is ${ageDays} days old. For your security, please set a new password to continue.`
      });
    }

    // ── Proactive expiry reminder (≤ 7 days left) ──────────
    if (ageDays >= PASSWORD_MAX_DAYS - 7) {
      _checkPasswordExpiryAndNotify(user, req.school).catch(() => {});
    }

    // ── 2FA for superadmin ──────────────────────────────────
    const userRole = user.primaryRole || user.role;
    if (userRole === 'superadmin' && user.mfaEnabled !== false) {
      const otp     = _genOTP();
      const expiry  = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
      await _model('users').updateOne({ _id: user._id }, { mfaOtp: otp, mfaExpiry: expiry });

      // Send OTP email (non-blocking — log if it fails)
      email.sendLoginOTP({
        name:       user.name,
        email:      user.email,
        otp,
        schoolName: req.school.name || req.school.slug
      }).catch(err => console.error('[2FA email]', err.message));

      return res.json({
        mfaRequired: true,
        userId:      user.id,
        schoolId:    req.school.id,
        hint:        `A 6-digit code has been sent to ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
      });
    }

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

    // Check trial expiry and send reminder if needed
    _checkTrialAndNotify(req.school).catch(() => {});

    const safeUser = { ...user, password: undefined };
    res.json({ token, user: safeUser, school: req.school });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* POST /api/auth/verify-otp — complete 2FA login */
const otpLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10,
  message: { error: 'Too many OTP attempts. Please try again.' } });

router.post('/verify-otp', otpLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { userId, schoolId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ error: 'userId and otp required' });

    const User = _model('users');
    const user = await User.findOne({ id: userId, schoolId: schoolId || req.school?.id }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.mfaOtp || !user.mfaExpiry) {
      return res.status(400).json({ error: 'No pending OTP. Please sign in again.' });
    }
    if (new Date() > new Date(user.mfaExpiry)) {
      await User.updateOne({ id: userId }, { $unset: { mfaOtp: 1, mfaExpiry: 1 } });
      return res.status(400).json({ error: 'Code expired. Please sign in again to get a new code.' });
    }
    if (otp.trim() !== user.mfaOtp) {
      return res.status(401).json({ error: 'Incorrect code. Please check your email and try again.' });
    }

    // OTP verified — clear it, issue JWT
    await User.updateOne({ id: userId }, { $unset: { mfaOtp: 1, mfaExpiry: 1 }, lastLogin: new Date().toISOString() });

    const School = _model('schools');
    const school = await School.findOne({ id: user.schoolId }).lean();

    const token = sign({
      userId:   user.id,
      schoolId: user.schoolId,
      email:    user.email,
      role:     user.primaryRole || user.role,
      roles:    user.roles || [user.role]
    });

    _checkTrialAndNotify(school).catch(() => {});
    res.json({ token, user: { ...user, password: undefined, mfaOtp: undefined, mfaExpiry: undefined }, school });
  } catch (err) {
    console.error('[auth/verify-otp]', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/* ── Password expiry email notification ─────────────────── */
async function _checkPasswordExpiryAndNotify(user, school) {
  const ageDays   = _passwordAge(user);
  const daysLeft  = PASSWORD_MAX_DAYS - ageDays;
  const todayKey  = new Date().toISOString().slice(0, 10);

  // Send at 7, 3, 1 days before expiry and on expiry day
  const notifyAt = [7, 3, 1, 0];
  const milestone = notifyAt.find(n => daysLeft <= n && daysLeft >= n - 1);
  if (milestone === undefined) return;

  const flagField = `pwdReminderSent_${user.id}_${milestone}`;
  if (school[flagField] === todayKey) return; // already sent today

  await _model('schools').updateOne({ id: school.id }, { $set: { [flagField]: todayKey } });
  await email.sendPasswordExpirySoon({
    name:       user.name,
    email:      user.email,
    schoolName: school.name || school.slug,
    daysLeft:   Math.max(0, daysLeft)
  });
}

/* POST /api/auth/force-change — change password when expired or on first login
   No JWT required (user is locked at password screen)
   Body: { userId, schoolId, newPassword }
*/
const forceChangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many attempts. Please try again later.' } });

router.post('/force-change', forceChangeLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { userId, schoolId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'userId and newPassword required' });
    if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const User = _model('users');
    const user = await User.findOne({ id: userId, schoolId: schoolId || req.school?.id }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now    = new Date().toISOString();
    const hashed = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ id: userId }, {
      password: hashed,
      passwordChangedAt: now,
      mustChangePassword: false,
      lastLogin: now
    });

    const School = _model('schools');
    const school = await School.findOne({ id: user.schoolId }).lean();

    // Issue JWT
    const token = sign({
      userId:   user.id,
      schoolId: user.schoolId,
      email:    user.email,
      role:     user.primaryRole || user.role,
      roles:    user.roles || [user.role]
    });

    // Send security confirmation email (non-blocking)
    email.sendPasswordChanged({
      name:       user.name,
      email:      user.email,
      schoolName: school?.name || req.school?.name || ''
    }).catch(() => {});

    const safeUser = { ...user, password: undefined, mfaOtp: undefined, mfaExpiry: undefined,
                       passwordChangedAt: now, mustChangePassword: false };
    res.json({ token, user: safeUser, school });
  } catch (err) {
    console.error('[auth/force-change]', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

/* ── Trial expiry check & email reminder ─────────────────── */
async function _checkTrialAndNotify(school) {
  if (!school?.trialEnds || !school.adminEmail) return;
  const now      = new Date();
  const ends     = new Date(school.trialEnds);
  const daysLeft = Math.ceil((ends - now) / (1000 * 60 * 60 * 24));

  // Only send at exactly 7, 3, 1 days left and on expiry day (0)
  const notifyDays = [7, 3, 1, 0];
  if (!notifyDays.includes(daysLeft)) return;

  // Avoid sending twice on same day
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lastKey  = school[`trialReminderSent_${daysLeft}`];
  if (lastKey === todayKey) return;

  // Mark sent
  await _model('schools').updateOne(
    { id: school.id },
    { $set: { [`trialReminderSent_${daysLeft}`]: todayKey } }
  );

  await email.sendTrialReminder({
    adminName:  school.adminName || school.name,
    adminEmail: school.adminEmail,
    schoolName: school.name,
    plan:       school.plan || 'standard',
    daysLeft,
    trialEnds:  ends.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
  });
}

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

    const hashed = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ id: req.jwtUser.userId }, {
      password: hashed,
      passwordChangedAt: new Date().toISOString(),
      mustChangePassword: false
    });

    // Send security confirmation email (non-blocking)
    const School = _model('schools');
    const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();
    email.sendPasswordChanged({
      name:       user.name,
      email:      user.email,
      schoolName: school?.name || ''
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
