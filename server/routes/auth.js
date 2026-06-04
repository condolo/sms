const express    = require('express');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const { sign }   = require('../utils/jwt');
const { _model } = require('../utils/model');
const { tenantMiddleware } = require('../middleware/tenant');
const { authMiddleware }   = require('../middleware/auth');
const rateLimit  = require('express-rate-limit');
const email      = require('../utils/email');

const router = express.Router();

/* ── OTP helper — cryptographically secure ──────────────── */
function _genOTP() {
  return String(crypto.randomInt(100000, 999999)); // 6-digit CSPRNG
}

/**
 * Build the JWT payload from a user document + school.
 * Single source of truth — all three login paths (password, OTP, force-change) call this.
 *
 * Includes guardianOf[] for parent/guardian roles so that report-card
 * ownership checks (GET /:id and GET /:id/pdf) can verify family links
 * without an extra DB query on every request.
 *
 * @param {Object} user   — lean user document
 * @param {string} schoolId
 * @returns {Object}      — payload passed to sign()
 */
function _buildTokenPayload(user, schoolId) {
  const role  = user.primaryRole || user.role;
  const payload = {
    userId:   user.id,
    schoolId: schoolId,
    email:    user.email,
    role,
    roles:    user.roles || [role],
  };

  // Include guardian link only for roles that use it — keeps tokens lean for everyone else
  if (role === 'parent' || role === 'guardian') {
    payload.guardianOf = Array.isArray(user.guardianOf) ? user.guardianOf : [];
    payload.studentIds = Array.isArray(user.studentIds) ? user.studentIds : (payload.guardianOf || []);
  }
  // Include studentId for student role so portal endpoints can scope data
  if (role === 'student') {
    payload.studentId = user.studentId || null;
  }

  return payload;
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
   Header: X-School-Slug: demo         (or resolved from subdomain by tenant middleware)
   Returns: { token, user, school }
*/
router.post('/login', loginLimiter, tenantMiddleware, async (req, res) => {
  try {
    // NOTE: renamed to userEmail to avoid shadowing the module-level `email` import
    // 'identifier' supports admission-number login for students; falls back to 'email' for staff
    const { email: userEmail, password, identifier } = req.body;
    const loginId = ((identifier || userEmail) || '').toLowerCase().trim();
    if (!loginId || !password) return res.status(400).json({ error: 'Email or admission number and password required' });

    const User   = _model('users');
    const School = _model('schools');

    // Find user regardless of isActive so we can give a clear pending message
    // Students log in with admission number stored in `username` field; staff use email
    const user = await User.findOne({
      $or: [
        { email: loginId,    schoolId: req.school.id },
        { username: loginId, schoolId: req.school.id },
      ],
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
          message: 'Your school registration was not approved. Please contact support at hello@msingi.io.'
        });
      }
      return res.status(403).json({ error: 'Account inactive. Please contact your school administrator.' });
    }

    const match = user.password?.startsWith('$2')
      ? await bcrypt.compare(password, user.password)
      : false; // reject any account that lacks a bcrypt hash

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
        name:        user.name,
        email:       user.email,
        otp,
        schoolName:  req.school.name || req.school.slug,
        schoolEmail: req.school.systemEmail || ''
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

    const token = sign(_buildTokenPayload(user, req.school.id));

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

    const token = sign(_buildTokenPayload(user, user.schoolId));

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
    name:        user.name,
    email:       user.email,
    schoolName:  school.name || school.slug,
    schoolEmail: school.systemEmail || '',
    daysLeft:    Math.max(0, daysLeft)
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
    const token = sign(_buildTokenPayload(user, user.schoolId));

    // Send security confirmation email (non-blocking)
    email.sendPasswordChanged({
      name:        user.name,
      email:       user.email,
      schoolName:  school?.name || req.school?.name || '',
      schoolEmail: school?.systemEmail || req.school?.systemEmail || ''
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
    adminName:   school.adminName || school.name,
    adminEmail:  school.adminEmail,
    schoolName:  school.name,
    schoolEmail: school.systemEmail || '',
    plan:        school.plan || 'standard',
    daysLeft,
    trialEnds:   ends.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
  });
}

/* ══════════════════════════════════════════════════════════════
   GOOGLE OAUTH 2.0 (no passport.js — native fetch)
   Flow: GET /google?slug=xxx → Google → /google/callback → JWT
   Required env vars:
     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL
   ══════════════════════════════════════════════════════════════ */

router.get('/google', (req, res) => {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const publicUrl   = process.env.PUBLIC_URL || '';
  if (!clientId) return res.status(503).json({ error: 'Google login is not configured on this server.' });

  const redirectUri = `${publicUrl}/api/auth/google/callback`;
  const scope       = 'openid email profile';
  const state       = Buffer.from(JSON.stringify({ slug: req.query.slug || '' })).toString('base64url');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('redirect_uri',  redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         scope);
  url.searchParams.set('state',         state);
  url.searchParams.set('access_type',   'online');
  url.searchParams.set('prompt',        'select_account');

  res.redirect(url.toString());
});

router.get('/google/callback', async (req, res) => {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const publicUrl    = process.env.PUBLIC_URL || '';

  if (!clientId || !clientSecret) {
    return res.redirect(`${publicUrl}/login?error=google_not_configured`);
  }

  const { code, state, error: oauthError } = req.query;
  if (oauthError || !code) {
    return res.redirect(`${publicUrl}/login?error=google_denied`);
  }

  let stateData = {};
  try { stateData = JSON.parse(Buffer.from(state || '', 'base64url').toString()); } catch {}

  try {
    // Exchange code for tokens
    const redirectUri = `${publicUrl}/api/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token from Google');

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const { email, name, sub: googleId } = profile;
    if (!email) throw new Error('No email in Google profile');

    // Resolve school from state slug or tenant middleware fallback
    const slug = stateData.slug;
    const Schools = _model('schools');
    const school  = slug
      ? await Schools.findOne({ slug: { $regex: new RegExp(`^${slug}$`, 'i') }, isActive: true }).lean()
      : null;
    if (!school) {
      return res.redirect(`${publicUrl}/login?error=school_not_found&hint=${encodeURIComponent('Include your school slug in the login URL')}`);
    }

    // Find or create user
    const User = _model('users');
    let user = await User.findOne({ email: email.toLowerCase(), schoolId: school.id }).lean();

    if (!user) {
      // Auto-provision Google-auth users as inactive teachers — admin must activate before they can sign in.
      // isActive: false prevents open registration: anyone with a Google account knowing the school slug
      // could otherwise gain immediate teacher access.
      const now = new Date().toISOString();
      const newUser = {
        id:            `goo_${Date.now().toString(36)}`,
        schoolId:      school.id,
        name:          name || email.split('@')[0],
        email:         email.toLowerCase(),
        role:          'teacher',
        roles:         ['teacher'],
        googleId,
        authProvider:  'google',
        isActive:      false,
        mustChangePassword: false,
        createdAt:     now,
        updatedAt:     now,
      };
      await User.create(newUser);
      user = newUser;
    } else {
      // Update Google ID if first time using OAuth
      if (!user.googleId) {
        await User.updateOne({ id: user.id }, { $set: { googleId, authProvider: 'google', lastLogin: new Date().toISOString() } });
      } else {
        await User.updateOne({ id: user.id }, { $set: { lastLogin: new Date().toISOString() } });
      }
    }

    if (!user.isActive) {
      return res.redirect(`${publicUrl}/login?error=account_inactive`);
    }

    const token = sign(_buildTokenPayload(user, school.id));
    // Redirect to frontend with token — SPA reads it from URL and stores in auth store
    res.redirect(`${publicUrl}/login?token=${encodeURIComponent(token)}&school=${encodeURIComponent(school.slug)}&provider=google`);
  } catch (err) {
    console.error('[auth/google/callback]', err);
    res.redirect(`${publicUrl}/login?error=google_failed`);
  }
});

/* ══════════════════════════════════════════════════════════════
   MICROSOFT OAUTH 2.0 (Azure AD / personal accounts)
   Required env vars:
     MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, PUBLIC_URL
   ══════════════════════════════════════════════════════════════ */

router.get('/microsoft', (req, res) => {
  const clientId  = process.env.MICROSOFT_CLIENT_ID;
  const publicUrl = process.env.PUBLIC_URL || '';
  if (!clientId) return res.status(503).json({ error: 'Microsoft login is not configured on this server.' });

  const redirectUri = `${publicUrl}/api/auth/microsoft/callback`;
  const state       = Buffer.from(JSON.stringify({ slug: req.query.slug || '' })).toString('base64url');

  const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('redirect_uri',  redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         'openid email profile User.Read');
  url.searchParams.set('state',         state);
  url.searchParams.set('prompt',        'select_account');

  res.redirect(url.toString());
});

router.get('/microsoft/callback', async (req, res) => {
  const clientId     = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const publicUrl    = process.env.PUBLIC_URL || '';

  if (!clientId || !clientSecret) {
    return res.redirect(`${publicUrl}/login?error=microsoft_not_configured`);
  }

  const { code, state, error: oauthError } = req.query;
  if (oauthError || !code) return res.redirect(`${publicUrl}/login?error=microsoft_denied`);

  let stateData = {};
  try { stateData = JSON.parse(Buffer.from(state || '', 'base64url').toString()); } catch {}

  try {
    const redirectUri = `${publicUrl}/api/auth/microsoft/callback`;
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
        scope: 'openid email profile User.Read',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token from Microsoft');

    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const email = (profile.mail || profile.userPrincipalName || '').toLowerCase();
    const name  = profile.displayName || email.split('@')[0];
    const msId  = profile.id;
    if (!email) throw new Error('No email in Microsoft profile');

    const Schools = _model('schools');
    const school  = stateData.slug
      ? await Schools.findOne({ slug: { $regex: new RegExp(`^${stateData.slug}$`, 'i') }, isActive: true }).lean()
      : null;
    if (!school) return res.redirect(`${publicUrl}/login?error=school_not_found`);

    const User = _model('users');
    let user = await User.findOne({ email, schoolId: school.id }).lean();

    if (!user) {
      // Same as Google: provision inactive — admin must activate before first sign-in.
      const now = new Date().toISOString();
      const newUser = {
        id:           `ms_${Date.now().toString(36)}`,
        schoolId:     school.id,
        name, email,
        role:         'teacher',
        roles:        ['teacher'],
        microsoftId:  msId,
        authProvider: 'microsoft',
        isActive:     false,
        mustChangePassword: false,
        createdAt:    now,
        updatedAt:    now,
      };
      await User.create(newUser);
      user = newUser;
    } else {
      await User.updateOne({ id: user.id }, { $set: { microsoftId: msId, lastLogin: new Date().toISOString() } });
    }

    if (!user.isActive) return res.redirect(`${publicUrl}/login?error=account_inactive`);

    const token = sign(_buildTokenPayload(user, school.id));
    res.redirect(`${publicUrl}/login?token=${encodeURIComponent(token)}&school=${encodeURIComponent(school.slug)}&provider=microsoft`);
  } catch (err) {
    console.error('[auth/microsoft/callback]', err);
    res.redirect(`${publicUrl}/login?error=microsoft_failed`);
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

    const match = user.password?.startsWith('$2')
      ? await bcrypt.compare(currentPassword, user.password)
      : false;
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
      name:        user.name,
      email:       user.email,
      schoolName:  school?.name || '',
      schoolEmail: school?.systemEmail || ''
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
