/* ============================================================
   InnoLearn — User Management Routes
   POST /api/users/invite         — invite single user (sends welcome email)
   POST /api/users/bulk-invite    — invite multiple users from CSV/form
   POST /api/users/:id/role-change — notify user of role/permission change
   All endpoints require authMiddleware + admin role
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const email              = require('../utils/email');

const router = express.Router();

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 100,
  message: { error: 'Too many invite requests. Please try again later.' }
});

/* ── Helpers ──────────────────────────────────────────────── */
function _genTempPassword() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums  = '23456789';
  let pwd = '';
  for (let i = 0; i < 8; i++) pwd += alpha[Math.floor(Math.random() * alpha.length)];
  pwd += nums[Math.floor(Math.random() * nums.length)];
  pwd += nums[Math.floor(Math.random() * nums.length)];
  pwd += '!';
  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function _isAdmin(req) {
  const r = req.jwtUser?.role || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || r === 'admin' || rs.includes('superadmin') || rs.includes('admin');
}

function _isSuperAdmin(req) {
  const r = req.jwtUser?.role || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || rs.includes('superadmin');
}

/* ── POST /api/users/invite — invite a single user ─────────
   Body: { name, email, role, phone?, staffId?, nationality? }
   Creates user in MongoDB with temp password, sends welcome email.
   Returns: { user (no password), tempPassword (shown once to admin) }
*/
router.post('/invite', authMiddleware, inviteLimiter, async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });

  const { name, email: userEmail, role, phone, staffId, ...extra } = req.body;
  if (!name || !userEmail) return res.status(400).json({ error: 'name and email are required' });
  if (!userEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return res.status(400).json({ error: 'Invalid email address' });

  // Prevent assigning superadmin unless caller is superadmin
  const safeRole = role || 'teacher';
  if (safeRole === 'superadmin' && !_isSuperAdmin(req)) {
    return res.status(403).json({ error: 'Cannot assign superadmin role' });
  }

  try {
    const User   = _model('users');
    const School = _model('schools');

    const schoolId = req.jwtUser.schoolId;
    const school   = await School.findOne({ id: schoolId }).lean();

    // Check email uniqueness within school
    const existing = await User.findOne({ email: userEmail.toLowerCase(), schoolId }).lean();
    if (existing) return res.status(409).json({ error: 'A user with this email already exists in your school.' });

    const tempPassword = _genTempPassword();
    const hashed       = await bcrypt.hash(tempPassword, 12);
    const now          = new Date().toISOString();

    const user = await User.create({
      id:               _uid(),
      schoolId,
      name:             name.trim(),
      email:            userEmail.toLowerCase().trim(),
      password:         hashed,
      role:             safeRole,
      primaryRole:      safeRole,
      roles:            [safeRole],
      phone:            phone || '',
      staffId:          staffId || '',
      isActive:         true,
      mustChangePassword: true,
      passwordChangedAt:  now,
      createdAt:          now,
      createdBy:          req.jwtUser.userId,
      ...extra
    });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.mfaOtp;
    delete userObj.mfaExpiry;

    // Send welcome email with temp credentials (non-blocking)
    email.sendWelcomeCredentials({
      name:         name.trim(),
      email:        userEmail.toLowerCase(),
      tempPassword,
      schoolName:   school?.name || '',
      role:         safeRole,
      loginUrl:     process.env.APP_URL || 'https://school-management-ecosystem.onrender.com'
    }).catch(err => console.error('[invite email]', err.message));

    console.log(`[USERS] Invited: ${name} (${userEmail}) as ${safeRole} to school ${schoolId}`);
    res.status(201).json({ user: userObj, tempPassword });
  } catch (err) {
    console.error('[users/invite]', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/* ── POST /api/users/bulk-invite — invite multiple users ───
   Body: [{ name, email, role, phone?, staffId? }, ...]
   Processes each sequentially, skips duplicates.
   Returns: { created, skipped, errors }
*/
router.post('/bulk-invite', authMiddleware, inviteLimiter, async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });

  const rows = req.body;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'Body must be a non-empty array of user objects' });
  }
  if (rows.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 users per bulk invite' });
  }

  const User   = _model('users');
  const School = _model('schools');
  const schoolId = req.jwtUser.schoolId;
  const school   = await School.findOne({ id: schoolId }).lean();

  const results = { created: [], skipped: [], errors: [] };

  for (const row of rows) {
    const { name, email: userEmail, role, phone, staffId } = row;
    if (!name || !userEmail) { results.errors.push({ email: userEmail, reason: 'Missing name or email' }); continue; }
    if (!userEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { results.errors.push({ email: userEmail, reason: 'Invalid email' }); continue; }

    const safeRole = (role === 'superadmin' && !_isSuperAdmin(req)) ? 'teacher' : (role || 'teacher');

    try {
      const existing = await User.findOne({ email: userEmail.toLowerCase(), schoolId }).lean();
      if (existing) { results.skipped.push({ email: userEmail, reason: 'Already exists' }); continue; }

      const tempPassword = _genTempPassword();
      const hashed       = await bcrypt.hash(tempPassword, 12);
      const now          = new Date().toISOString();

      const user = await User.create({
        id: _uid(), schoolId,
        name: name.trim(),
        email: userEmail.toLowerCase().trim(),
        password: hashed,
        role: safeRole, primaryRole: safeRole, roles: [safeRole],
        phone: phone || '', staffId: staffId || '',
        isActive: true,
        mustChangePassword: true,
        passwordChangedAt: now,
        createdAt: now,
        createdBy: req.jwtUser.userId
      });

      results.created.push({ name, email: userEmail, role: safeRole, id: user.id });

      // Send welcome email (non-blocking, fire-and-forget)
      email.sendWelcomeCredentials({
        name: name.trim(),
        email: userEmail.toLowerCase(),
        tempPassword,
        schoolName: school?.name || '',
        role: safeRole,
        loginUrl: process.env.APP_URL || 'https://school-management-ecosystem.onrender.com'
      }).catch(() => {});

    } catch (e) {
      results.errors.push({ email: userEmail, reason: e.message });
    }
  }

  console.log(`[USERS] Bulk invite: ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors`);
  res.status(201).json(results);
});

/* ── POST /api/users/:id/role-change — manual role-change notification ──
   Body: { newRole, oldRole?, note? }
   Sends role-change email to the user.
*/
router.post('/:id/role-change', authMiddleware, async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });

  const { newRole, oldRole, note } = req.body;
  if (!newRole) return res.status(400).json({ error: 'newRole is required' });

  try {
    const User   = _model('users');
    const School = _model('schools');
    const user   = await User.findOne({ id: req.params.id, schoolId: req.jwtUser.schoolId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();

    await email.sendRoleChanged({
      name:       user.name,
      email:      user.email,
      schoolName: school?.name || '',
      oldRole:    oldRole || user.role,
      newRole,
      changedBy:  req.jwtUser.email
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[users/role-change]', err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

module.exports = router;
