/* ============================================================
   Msingi — Settings Routes
   GET  /api/settings              — current user account info
   PUT  /api/settings              — update display name / change password
   GET  /api/settings/school       — school profile (admin only)
   PUT  /api/settings/school       — update school profile (admin only)
   GET  /api/settings/users        — list users in school (admin only)
   POST /api/settings/users/invite — invite a new user (admin only)
   PUT  /api/settings/users/:id    — update user role/details (admin only)
   DELETE /api/settings/users/:id  — remove user from school (admin only)
   ============================================================ */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const emailUtil          = require('../utils/email');

const router = express.Router();

/* ── Role helpers ───────────────────────────────────────────── */
function _isAdmin(req) {
  const r  = req.jwtUser?.role  || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || r === 'admin' || rs.includes('superadmin') || rs.includes('admin');
}
function _isSuperAdmin(req) {
  const r  = req.jwtUser?.role  || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || rs.includes('superadmin');
}
function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
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

/* ── Allowed fields for school update ──────────────────────── */
const SCHOOL_UPDATABLE = [
  'name', 'tagline', 'email', 'phone', 'address', 'website',
  'country', 'currency', 'timezone', 'academicYear', 'termsPerYear',
  'houses', 'shortName', 'primaryColor', 'logoUrl',
];

/* ══════════════════════════════════════════════════════════════
   ACCOUNT — current user
   ══════════════════════════════════════════════════════════════ */

/* GET /api/settings — return current user's profile */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const Users = _model('users');
    const user  = await Users.findOne({ id: req.jwtUser.userId }).lean();
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    const { passwordHash, ...safe } = user;
    res.json({ success: true, data: safe });
  } catch (err) {
    console.error('[settings] GET / error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch account' } });
  }
});

/* PUT /api/settings — update display name or change password */
router.put('/', authMiddleware, async (req, res) => {
  try {
    const Users = _model('users');
    const { name, currentPassword, newPassword } = req.body;

    /* ── Password change ── */
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Current password is required.' } });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'New password must be at least 6 characters.' } });
      }
      const user = await Users.findOne({ id: req.jwtUser.userId }).lean();
      if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) return res.status(400).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' } });
      const hash = await bcrypt.hash(newPassword, 10);
      await Users.updateOne({ id: req.jwtUser.userId }, { $set: { passwordHash: hash, updatedAt: new Date().toISOString() } });
      return res.json({ success: true, message: 'Password updated.' });
    }

    /* ── Name update ── */
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name cannot be empty.' } });
      await Users.updateOne({ id: req.jwtUser.userId }, { $set: { name: name.trim(), updatedAt: new Date().toISOString() } });
      return res.json({ success: true, message: 'Name updated.' });
    }

    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No updatable fields provided.' } });
  } catch (err) {
    console.error('[settings] PUT / error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update account' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   SCHOOL PROFILE
   ══════════════════════════════════════════════════════════════ */

/* GET /api/settings/school */
router.get('/school', authMiddleware, async (req, res) => {
  try {
    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: req.jwtUser.schoolId }).lean();
    if (!school) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'School not found' } });
    // Strip internal fields
    const { _id, __v, ...safe } = school;
    res.json({ success: true, data: safe });
  } catch (err) {
    console.error('[settings] GET /school error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch school settings' } });
  }
});

/* PUT /api/settings/school — admin only */
router.put('/school', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
    }
    const Schools = _model('schools');
    const update  = {};
    SCHOOL_UPDATABLE.forEach(k => {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    });
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No updatable fields provided.' } });
    }
    update.updatedAt = new Date().toISOString();
    const result = await Schools.updateOne({ id: req.jwtUser.schoolId }, { $set: update });
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'School not found' } });
    }
    const fresh = await Schools.findOne({ id: req.jwtUser.schoolId }).lean();
    const { _id, __v, ...safe } = fresh;
    res.json({ success: true, data: safe });
  } catch (err) {
    console.error('[settings] PUT /school error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update school settings' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   USER MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

/* GET /api/settings/users — list users in this school (admin only) */
router.get('/users', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
    }
    const Users = _model('users');
    const users = await Users.find(
      { schoolId: req.jwtUser.schoolId, isActive: { $ne: false } },
      { passwordHash: 0 }
    ).sort({ name: 1 }).lean();
    res.json({ success: true, data: users });
  } catch (err) {
    console.error('[settings] GET /users error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch users' } });
  }
});

/* POST /api/settings/users/invite — invite a user to this school (admin only) */
router.post('/users/invite', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
    }
    const { name, email: userEmail, role = 'teacher' } = req.body;
    if (!userEmail) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required.' } });

    const allowedRoles = ['teacher', 'deputy', 'admin', 'parent', 'student'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid role. Allowed: ${allowedRoles.join(', ')}` } });
    }
    // Superadmin-only guard: only superadmin can invite other admins
    if (role === 'admin' && !_isSuperAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only superadmin can invite admin users.' } });
    }

    const Users = _model('users');
    const existing = await Users.findOne({ schoolId: req.jwtUser.schoolId, email: userEmail.toLowerCase().trim() }).lean();
    if (existing) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A user with this email already exists in this school.' } });
    }

    const tempPassword = _genTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const now  = new Date().toISOString();
    const newUser = {
      id:            _uid(),
      schoolId:      req.jwtUser.schoolId,
      name:          (name || userEmail.split('@')[0]).trim(),
      email:         userEmail.toLowerCase().trim(),
      role,
      roles:         [role],
      passwordHash:  hash,
      mustChangePwd: true,
      isActive:      true,
      createdAt:     now,
      updatedAt:     now,
    };

    await Users.create(newUser);

    // Send welcome email (non-fatal)
    try {
      const Schools = _model('schools');
      const school  = await Schools.findOne({ id: req.jwtUser.schoolId }).lean();
      await emailUtil.sendWelcome({
        to:           userEmail,
        name:         newUser.name,
        schoolName:   school?.name || 'Your School',
        tempPassword,
        role,
      });
    } catch (emailErr) {
      console.warn('[settings] invite email failed (non-fatal):', emailErr.message);
    }

    const { passwordHash: _ph, ...safe } = newUser;
    res.status(201).json({ success: true, data: { user: safe, tempPassword } });
  } catch (err) {
    console.error('[settings] POST /users/invite error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to invite user' } });
  }
});

/* PUT /api/settings/users/:id — update user role (admin only) */
router.put('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
    }
    const { role, name } = req.body;
    const update = { updatedAt: new Date().toISOString() };
    if (name)  update.name = name.trim();
    if (role) {
      const allowedRoles = ['teacher', 'deputy', 'admin', 'parent', 'student'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid role.` } });
      }
      if (role === 'admin' && !_isSuperAdmin(req)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only superadmin can assign admin role.' } });
      }
      update.role  = role;
      update.roles = [role];
    }

    const Users  = _model('users');
    const result = await Users.updateOne(
      { id: req.params.id, schoolId: req.jwtUser.schoolId },
      { $set: update }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    const updated = await Users.findOne({ id: req.params.id }, { passwordHash: 0 }).lean();
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[settings] PUT /users/:id error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update user' } });
  }
});

/* DELETE /api/settings/users/:id — remove user (admin only) */
router.delete('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
    }
    // Prevent self-deletion
    if (req.params.id === req.jwtUser.userId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'You cannot remove your own account.' } });
    }
    const Users  = _model('users');
    // Soft-delete: mark isActive = false
    const result = await Users.updateOne(
      { id: req.params.id, schoolId: req.jwtUser.schoolId },
      { $set: { isActive: false, updatedAt: new Date().toISOString() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    res.json({ success: true, message: 'User removed.' });
  } catch (err) {
    console.error('[settings] DELETE /users/:id error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to remove user' } });
  }
});

module.exports = router;
