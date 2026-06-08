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
const crypto   = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const emailUtil          = require('../utils/email');
const { DEFAULTS: NOTIF_DEFAULTS, EVENT_REGISTRY } = require('../utils/notif-settings');

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
  // Use crypto.randomBytes for the random suffix — CSPRNG
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}
function _genTempPassword() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums  = '23456789';
  let chars = '';
  // CSPRNG — no Math.random()
  for (let i = 0; i < 8; i++) chars += alpha[crypto.randomInt(alpha.length)];
  chars += nums[crypto.randomInt(nums.length)];
  chars += nums[crypto.randomInt(nums.length)];
  chars += '!';
  // Fisher-Yates shuffle with CSPRNG
  const arr = chars.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/* ── Allowed fields for school update ──────────────────────── */
const SCHOOL_UPDATABLE = [
  'name', 'tagline', 'email', 'phone', 'address', 'website',
  'country', 'currency', 'timezone', 'academicYear', 'academicYearStartMonth', 'termsPerYear',
  'termDates',   // [{term,label,startDate,endDate}] — per-term billing trigger dates
  'houses', 'shortName', 'primaryColor', 'accentColor', 'themePreset', 'logoUrl', 'modulePermissions',
  'moduleConfig',
  'mpesa',
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
    // Strip BOTH field names — auth.js stores as `password`, settings.js historically used `passwordHash`
    const { password: _pw, passwordHash: _ph, ...safe } = user;
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
      // Support both field names during migration — compare against whichever is present
      const storedHash = user.password || user.passwordHash || '';
      const ok = await bcrypt.compare(currentPassword, storedHash);
      if (!ok) return res.status(400).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' } });
      const hash = await bcrypt.hash(newPassword, 10);
      // Normalise to `password` (canonical field used by auth.js); remove legacy `passwordHash`
      await Users.updateOne({ id: req.jwtUser.userId }, {
        $set:   { password: hash, updatedAt: new Date().toISOString() },
        $unset: { passwordHash: '' },
      });
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

/* ── Shared image-upload helper ─────────────────────────────── */
function _validateBase64Image(b64, maxKB) {
  if (!/^data:image\/(jpeg|jpg|png|webp|gif|svg\+xml);base64,/.test(b64)) {
    return 'Invalid image. Use JPEG, PNG, WebP, GIF, or SVG.';
  }
  const data = b64.split(',')[1] || '';
  const sizeBytes = Math.ceil(data.length * 0.75);
  if (sizeBytes > maxKB * 1024) {
    return `Image too large. Maximum size is ${maxKB} KB.`;
  }
  return null;
}

/* PUT /api/settings/school/logo — upload school logo (admin only) */
router.put('/school/logo', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    const { logoBase64 } = req.body;
    if (!logoBase64) return res.status(400).json({ error: 'logoBase64 is required.' });
    const err = _validateBase64Image(logoBase64, 500);
    if (err) return res.status(400).json({ error: err });

    const Schools = _model('schools');
    const logoUrl = `/api/public/school-asset/logo?slug=${req.jwtUser.schoolId}`;
    await Schools.updateOne(
      { id: req.jwtUser.schoolId },
      { $set: { logoBase64, logoUrl, updatedAt: new Date().toISOString() } }
    );
    res.json({ success: true, logoUrl });
  } catch (err) {
    console.error('[settings] PUT /school/logo:', err);
    res.status(500).json({ error: 'Failed to upload logo.' });
  }
});

/* DELETE /api/settings/school/logo — clear school logo (admin only) */
router.delete('/school/logo', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    const Schools = _model('schools');
    await Schools.updateOne(
      { id: req.jwtUser.schoolId },
      { $unset: { logoBase64: '', logoUrl: '' }, $set: { updatedAt: new Date().toISOString() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove logo.' });
  }
});

/* PUT /api/settings/school/favicon — upload school favicon (admin only) */
router.put('/school/favicon', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    const { faviconBase64 } = req.body;
    if (!faviconBase64) return res.status(400).json({ error: 'faviconBase64 is required.' });
    const err = _validateBase64Image(faviconBase64, 150);
    if (err) return res.status(400).json({ error: err });

    const Schools = _model('schools');
    const faviconUrl = `/api/public/school-asset/favicon?slug=${req.jwtUser.schoolId}`;
    await Schools.updateOne(
      { id: req.jwtUser.schoolId },
      { $set: { faviconBase64, faviconUrl, updatedAt: new Date().toISOString() } }
    );
    res.json({ success: true, faviconUrl });
  } catch (err) {
    console.error('[settings] PUT /school/favicon:', err);
    res.status(500).json({ error: 'Failed to upload favicon.' });
  }
});

/* DELETE /api/settings/school/favicon — clear school favicon (admin only) */
router.delete('/school/favicon', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    const Schools = _model('schools');
    await Schools.updateOne(
      { id: req.jwtUser.schoolId },
      { $unset: { faviconBase64: '', faviconUrl: '' }, $set: { updatedAt: new Date().toISOString() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove favicon.' });
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
      { password: 0, passwordHash: 0 }   // exclude both field names
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
      password:      hash,   // canonical field — must match auth.js
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

    const { password: _pw2, passwordHash: _ph, ...safe } = newUser;
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
    const { role, name, sectionAssigned, guardianOf } = req.body;
    const update = { updatedAt: new Date().toISOString() };
    if (name)  update.name = name.trim();
    if (role) {
      const allowedRoles = ['teacher', 'deputy', 'admin', 'parent', 'guardian', 'student', 'section_head', 'timetabler'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid role.` } });
      }
      if (role === 'admin' && !_isSuperAdmin(req)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only superadmin can assign admin role.' } });
      }
      update.role  = role;
      update.roles = [role];
    }
    // Section head: which section they oversee — validate against school's sections collection
    if (sectionAssigned !== undefined) {
      if (sectionAssigned === null || sectionAssigned === '') {
        update.sectionAssigned = null;
      } else if (typeof sectionAssigned === 'string' && sectionAssigned.length <= 50) {
        const Sections = _model('sections');
        const exists = await Sections.findOne(
          { schoolId: req.jwtUser.schoolId, key: sectionAssigned },
          { _id: 1 }
        ).lean();
        update.sectionAssigned = exists ? sectionAssigned : null;
      } else {
        update.sectionAssigned = null;
      }
    }
    // Parent/guardian: link to student IDs they are responsible for
    if (Array.isArray(guardianOf)) {
      update.guardianOf = guardianOf.filter(id => typeof id === 'string');
    }

    const Users  = _model('users');
    const result = await Users.updateOne(
      { id: req.params.id, schoolId: req.jwtUser.schoolId },
      { $set: update }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    const updated = await Users.findOne({ id: req.params.id }, { password: 0, passwordHash: 0 }).lean();
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

/* ══════════════════════════════════════════════════════════════
   NOTIFICATION SETTINGS
   GET  /api/settings/notifications — return per-event channel config
   PUT  /api/settings/notifications — save per-event channel config
   ══════════════════════════════════════════════════════════════ */

/* GET /api/settings/notifications */
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const School = _model('schools');
    const school = await School.findOne(
      { id: req.jwtUser.schoolId },
      { notificationSettings: 1 }
    ).lean();

    // Merge saved settings with defaults so the response always has
    // the full event list (new events added to registry appear immediately)
    const saved   = school?.notificationSettings ?? {};
    const merged  = {};
    for (const [key, def] of Object.entries(NOTIF_DEFAULTS)) {
      merged[key] = { ...def, ...(saved[key] ?? {}) };
    }

    res.json({ data: merged });
  } catch (err) {
    console.error('[settings] GET /notifications error:', err);
    res.status(500).json({ error: 'Failed to load notification settings' });
  }
});

/* PUT /api/settings/notifications */
router.put('/notifications', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const updates = req.body;
    if (typeof updates !== 'object' || updates === null) {
      return res.status(400).json({ error: 'Invalid notification settings payload' });
    }

    // Validate: only known event keys, only boolean channel values
    // Always-on events are never stored (always true at runtime)
    const sanitised = {};
    for (const [key, channels] of Object.entries(updates)) {
      if (!EVENT_REGISTRY[key]) continue;          // unknown event → skip
      if (EVENT_REGISTRY[key].alwaysOn) continue;  // always-on → not stored
      if (typeof channels !== 'object' || channels === null) continue;
      const cleanChannels = {};
      for (const ch of ['email', 'inApp']) {
        if (typeof channels[ch] === 'boolean') {
          cleanChannels[ch] = channels[ch];
        }
      }
      if (Object.keys(cleanChannels).length) {
        sanitised[key] = cleanChannels;
      }
    }

    await _model('schools').updateOne(
      { id: req.jwtUser.schoolId },
      { $set: { notificationSettings: sanitised, updatedAt: new Date().toISOString() } }
    );

    res.json({ success: true, data: sanitised });
  } catch (err) {
    console.error('[settings] PUT /notifications error:', err);
    res.status(500).json({ error: 'Failed to save notification settings' });
  }
});

module.exports = router;
