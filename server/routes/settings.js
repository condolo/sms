/* ============================================================
   Msingi — Settings Routes
   GET  /api/settings              — current user account info
   PUT  /api/settings              — update display name / change password
   GET  /api/settings/school       — school profile (admin only)
   PUT  /api/settings/school       — update school profile (admin only)
   GET  /api/settings/users        — list users in school (admin only)
   POST /api/settings/users/invite — invite a new user (admin only)
   PUT  /api/settings/users/:id    — update user role/details (admin only)
   DELETE /api/settings/users/:id              — remove user from school (admin only)
   POST   /api/settings/users/:id/reset-password — assign temp password (admin only)
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');
const { authMiddleware }    = require('../middleware/auth');
const { _model }            = require('../utils/model');
const { revokeUserTokens }  = require('../utils/token-version');
const emailUtil             = require('../utils/email');
const { encrypt, smtpEncryptReady } = require('../utils/smtpEncrypt');
const { DEFAULTS: NOTIF_DEFAULTS, EVENT_REGISTRY } = require('../utils/notif-settings');
const { rbac, invalidatePermCache } = require('../middleware/rbac');
const { peekAdmissionCounter, setAdmissionCounter } = require('../utils/counters');
const { MODULE_REGISTRY, MODULE_KEYS } = require('../config/moduleRegistry');

const router = express.Router();

/* ── Role helpers ───────────────────────────────────────────── */
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

/* ── Derive backend API permissions from the V/E/D matrix ─── */
// Used when a custom role's module-permissions are saved to also update role_permissions.
function _deriveApiPerms(byRoleCell) {
  const perms = {};
  for (const mod of MODULE_KEYS) {
    const actions = new Set();
    for (const [key, cell] of Object.entries(byRoleCell ?? {})) {
      if (!key.startsWith(`${mod}__`)) continue;
      if (cell.v) actions.add('read');
      if (cell.e) { actions.add('create'); actions.add('update'); }
      if (cell.d) actions.add('delete');
    }
    perms[mod] = [...actions]; // always include — empty array means no access, module hidden from sidebar
  }
  return perms;
}

/* ── Allowed fields for school update ──────────────────────── */
const SCHOOL_UPDATABLE = [
  'name', 'tagline', 'email', 'phone', 'address', 'website',
  'country', 'currency', 'timezone', 'academicYear', 'academicYearStartMonth', 'termsPerYear',
  'termDates',   // [{term,label,startDate,endDate}] — per-term billing trigger dates
  'houses', 'shortName', 'primaryColor', 'accentColor', 'themePreset', 'logoUrl', 'modulePermissions',
  'moduleConfig',
  'mpesa',
  'hiddenSystemRoles',   // array of system role keys hidden from invite form / R&P sidebar
  'emergencyOnlineMode', // boolean — when true timetable embeds teacher meeting links for students
  'portalConfig',        // object — student/parent portal visibility toggles
  'admissionConfig',     // object — prefix, padding, yearInPrefix for admission numbers
  'staffResponsibilities', // [{value,label}] — configurable HR responsibility options per school
];

/* ── GET /api/settings/modules — return the full module registry ─
   Returns the same structure as MODULE_REGISTRY (key, label, section, subs).
   Used by the R&P UI so the module list is always in sync with the server. */
router.get('/modules', authMiddleware, (req, res) => {
  return res.json({ success: true, data: MODULE_REGISTRY });
});

/* ══════════════════════════════════════════════════════════════
   ACCOUNT — current user
   ══════════════════════════════════════════════════════════════ */

/* GET /api/settings — return current user's profile */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId } = req.jwtUser;
    const Users = _model('users');
    const isOid = /^[a-f\d]{24}$/i.test(userId);
    const filter = isOid
      ? { $or: [{ id: userId }, { _id: new mongoose.Types.ObjectId(userId) }], schoolId }
      : { id: userId, schoolId };
    const user  = await Users.findOne(filter).lean();
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
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'New password must be at least 8 characters.' } });
      }
      const user = await Users.findOne({ id: req.jwtUser.userId, schoolId: req.jwtUser.schoolId }).lean();
      if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      // Support both field names during migration — compare against whichever is present
      const storedHash = user.password || user.passwordHash || '';
      const ok = await bcrypt.compare(currentPassword, storedHash);
      if (!ok) return res.status(400).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' } });
      const hash = await bcrypt.hash(newPassword, 12);
      const now  = new Date().toISOString();
      // Normalise to `password` (canonical field used by auth.js); remove legacy `passwordHash`
      // Reset 90-day rotation clock so the new password doesn't immediately expire
      await Users.updateOne({ id: req.jwtUser.userId }, {
        $set:   { password: hash, passwordChangedAt: now, updatedAt: now },
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

    // Restrict fields for non-admin users
    const role = req.jwtUser?.role || '';
    const roles = req.jwtUser?.roles || [];
    const isAdmin = role === 'superadmin' || role === 'admin' || roles.includes('superadmin') || roles.includes('admin');

    if (!isAdmin) {
      // Return only regional and public branding configurations
      const safe = {
        id: school.id,
        name: school.name,
        shortName: school.shortName || school.name,
        tagline: school.tagline || null,
        logoUrl: school.logoUrl || null,
        faviconUrl: school.faviconUrl || null,
        primaryColor: school.primaryColor || '#4f46e5',
        accentColor: school.accentColor || '#7c3aed',
        themePreset: school.themePreset || null,
        currency: school.currency || 'KES',
        currencySymbol: school.currencySymbol || 'KSh',
        timezone: school.timezone || 'Africa/Nairobi',
        country: school.country || null,
        academicYear: school.academicYear || null,
        termsPerYear: school.termsPerYear || null,
        houses: school.houses || [],
        staffResponsibilities: school.staffResponsibilities || [],
      };
      return res.json({ success: true, data: safe });
    }

    // Strip internal fields and never expose the encrypted SMTP password
    const { _id, __v, smtpPassEnc, ...safe } = school;
    // Expose a safe boolean so the UI knows a password is saved without seeing it
    safe.smtpPassSaved = !!smtpPassEnc;
    res.json({ success: true, data: safe });
  } catch (err) {
    console.error('[settings] GET /school error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch school settings' } });
  }
});

/* PUT /api/settings/school — admin only */
router.put('/school', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
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

    // Sync role_permissions for all roles whose V/E/D matrix was just saved.
    // superadmin and admin bypass RBAC entirely so we never overwrite their permissions.
    if (update.modulePermissions?.byRole) {
      try {
        const SKIP_ROLES = new Set(['superadmin', 'admin']);
        const syncOps = [];
        for (const [roleKey, rolePerms] of Object.entries(update.modulePermissions.byRole)) {
          if (SKIP_ROLES.has(roleKey)) continue;
          const derived = _deriveApiPerms(rolePerms);
          console.log(`[settings:sync] ${roleKey} → admissions:${JSON.stringify(derived.admissions)} finance:${JSON.stringify(derived.finance)}`);
          // Use per-field $set so modules not in MODS (e.g. library, hostel, transport added
          // via migration) are preserved rather than overwritten with empty arrays.
          const permFields = Object.fromEntries(
            Object.entries(derived).map(([mod, actions]) => [`permissions.${mod}`, actions])
          );
          syncOps.push(_model('role_permissions').updateOne(
            { schoolId: req.jwtUser.schoolId, roleKey },
            { $set: { ...permFields, updatedAt: new Date().toISOString() } },
            { upsert: true }
          ));
        }
        if (syncOps.length) {
          await Promise.all(syncOps);
          invalidatePermCache(req.jwtUser.schoolId);
          console.log(`[settings:sync] Flushed cache for ${req.jwtUser.schoolId}`);
        }
      } catch (syncErr) {
        console.warn('[settings] role perm sync (non-fatal):', syncErr.message);
      }
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
router.put('/school/logo', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
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
router.delete('/school/logo', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
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
router.put('/school/favicon', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
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
router.delete('/school/favicon', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
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
router.get('/users', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const Users = _model('users');
    const users = await Users.find(
      { schoolId: req.jwtUser.schoolId, isActive: { $ne: false } },
      { password: 0, passwordHash: 0 }   // exclude both field names
    ).sort({ name: 1 }).lean();
    // Normalize: ensure every user document has a string `id` field so
    // the frontend can reliably use it for PUT/DELETE without falling back
    // to the ObjectId _id (which the server routes also need to handle).
    const safeUsers = users.map(u => ({ ...u, id: u.id || u._id?.toString() }));
    res.json({ success: true, data: safeUsers });
  } catch (err) {
    console.error('[settings] GET /users error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch users' } });
  }
});

/* POST /api/settings/users/invite — invite a user to this school (admin only) */
router.post('/users/invite', authMiddleware, rbac('settings', 'create'), async (req, res) => {
  try {
    const { name, email: userEmail, role = 'teacher', staffId } = req.body;
    if (!userEmail) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required.' } });

    /* All canonical system roles (+ legacy deputy alias) that can be invited */
    const BUILTIN_INVITE_ROLES = new Set([
      'admin', 'deputy_principal', 'deputy', 'section_head', 'teacher',
      'exams_officer', 'timetabler', 'admissions_officer',
      'finance', 'hr', 'discipline_committee', 'parent', 'student',
    ]);
    if (!BUILTIN_INVITE_ROLES.has(role)) {
      // Allow any custom role belonging to this school
      const customRole = await _model('custom_roles').findOne({ schoolId: req.jwtUser.schoolId, key: role }).lean();
      if (!customRole) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid role '${role}'.` } });
      }
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

    // Block if this email belongs to a teacher profile — but only when NOT coming
    // from the HR "Create Login Account" flow (which passes staffId to signal it's
    // an intentional account creation for a known staff member).
    if (!staffId) {
      const existingTeacher = await _model('teachers').findOne({ schoolId: req.jwtUser.schoolId, email: userEmail.toLowerCase().trim() }).lean();
      if (existingTeacher) {
        const tName = [existingTeacher.firstName, existingTeacher.lastName].filter(Boolean).join(' ');
        return res.status(409).json({
          success: false,
          error: {
            code: 'CONFLICT',
            message: `${tName} already has a teacher profile with this email. To grant login access go to HR → select the staff member → Create Login Account.`,
          },
        });
      }
    }

    const tempPassword = _genTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    const now  = new Date().toISOString();
    const newUser = {
      id:            _uid(),
      schoolId:      req.jwtUser.schoolId,
      name:          (name || userEmail.split('@')[0]).trim(),
      email:         userEmail.toLowerCase().trim(),
      role,
      roles:         [role],
      password:          hash,   // canonical field — must match auth.js
      passwordChangedAt: now,    // 90-day clock starts from account creation
      isActive:          true,
      createdAt:         now,
      updatedAt:         now,
    };

    await Users.create(newUser);

    // Send welcome email (non-fatal)
    try {
      const Schools = _model('schools');
      const school  = await Schools.findOne({ id: req.jwtUser.schoolId }).lean();
      await emailUtil.sendWelcomeCredentials({
        email:       userEmail,
        name:        newUser.name,
        schoolName:  school?.name  || 'Your School',
        schoolEmail: school?.systemEmail || school?.email || '',
        schoolId:    req.jwtUser.schoolId,
        tempPassword,
        role,
        loginUrl:    process.env.APP_URL || 'https://msingi.io',
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

/* POST /api/settings/users/bulk-invite — create login accounts for multiple staff (admin only) */
router.post('/users/bulk-invite', authMiddleware, rbac('settings', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { staff } = req.body;
    if (!Array.isArray(staff) || staff.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'staff array is required.' } });
    }
    if (staff.length > 100) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Maximum 100 staff per batch.' } });
    }

    const Users   = _model('users');
    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }).lean();
    const now     = new Date().toISOString();

    let created = 0, skipped = 0;
    const errors = [];

    await Promise.all(staff.map(async s => {
      const email = (s.email ?? '').toLowerCase().trim();
      if (!email) { skipped++; return; }
      try {
        const existing = await Users.findOne({ schoolId, email }).lean();
        if (existing) { skipped++; return; }

        const role = s.role || 'teacher';
        const tempPassword = _genTempPassword();
        const hash = await bcrypt.hash(tempPassword, 10);
        const name = (s.name || email.split('@')[0]).trim();

        await Users.create({
          id: _uid(), schoolId,
          name, email, role, roles: [role],
          password: hash, passwordChangedAt: now,
          isActive: true, mustChangePassword: true,
          createdAt: now, updatedAt: now, createdBy: userId,
        });

        // Send welcome email (non-fatal)
        try {
          await emailUtil.sendWelcomeCredentials({
            email, name,
            schoolName:  school?.name  || 'Your School',
            schoolEmail: school?.systemEmail || school?.email || '',
            schoolId,
            tempPassword, role,
            loginUrl: process.env.APP_URL || 'https://msingi.io',
          });
        } catch { /* non-fatal */ }

        created++;
      } catch (e) {
        errors.push({ email: s.email, message: e.message });
      }
    }));

    console.log(`[settings] Bulk invite: ${created} created, ${skipped} skipped, ${errors.length} errors — by ${userId}`);
    res.status(201).json({ success: true, data: { created, skipped, errors } });
  } catch (err) {
    console.error('[settings] POST /users/bulk-invite error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to bulk invite staff.' } });
  }
});

/* PUT /api/settings/users/:id — update user role (admin only) */
router.put('/users/:id', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { role, name, sectionAssigned, guardianOf } = req.body;
    const update = { updatedAt: new Date().toISOString() };
    if (name)  update.name = name.trim();
    if (role) {
      const BUILTIN_UPDATE_ROLES = [
        'admin', 'deputy_principal', 'deputy', 'section_head', 'teacher',
        'exams_officer', 'timetabler', 'admissions_officer', 'finance', 'hr',
        'discipline_committee', 'parent', 'guardian', 'student',
      ];
      if (!BUILTIN_UPDATE_ROLES.includes(role)) {
        const customRole = await _model('custom_roles').findOne({ schoolId: req.jwtUser.schoolId, key: role }).lean();
        if (!customRole) {
          return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid role.` } });
        }
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
    const isOidPut = /^[0-9a-f]{24}$/i.test(req.params.id);
    const putFilter = isOidPut
      ? { schoolId: req.jwtUser.schoolId, $or: [{ id: req.params.id }, { _id: req.params.id }] }
      : { id: req.params.id, schoolId: req.jwtUser.schoolId };

    const result = await Users.updateOne(putFilter, { $set: update });
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    // Role changed — cascade to linked teacher record + revoke tokens immediately
    if (role) {
      try {
        const changedUser = await Users.findOne(putFilter, { id: 1, email: 1 }).lean();
        if (changedUser) {
          await _model('teachers').updateOne(
            { schoolId: req.jwtUser.schoolId, $or: [{ userId: changedUser.id }, { email: changedUser.email }] },
            { $set: { staffType: role, updatedAt: new Date().toISOString() } }
          );
        }
      } catch (cascErr) {
        console.warn('[settings] teacher staffType cascade (non-fatal):', cascErr.message);
      }
      revokeUserTokens(req.params.id).catch(err =>
        console.warn('[settings] token revocation (non-fatal):', err.message)
      );
    }

    const updated = await Users.findOne(putFilter, { password: 0, passwordHash: 0 }).lean();
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[settings] PUT /users/:id error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update user' } });
  }
});

/* DELETE /api/settings/users/:id — remove user (admin only) */
router.delete('/users/:id', authMiddleware, rbac('settings', 'delete'), async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.jwtUser.userId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'You cannot remove your own account.' } });
    }
    const Users  = _model('users');
    // Support both custom id field and MongoDB _id so accounts created
    // outside the normal invite flow (seed scripts, direct DB writes) can
    // still be removed through the UI.
    const isOidDel = /^[0-9a-f]{24}$/i.test(req.params.id);
    const delFilter = isOidDel
      ? { schoolId: req.jwtUser.schoolId, $or: [{ id: req.params.id }, { _id: req.params.id }] }
      : { id: req.params.id, schoolId: req.jwtUser.schoolId };

    // Fetch user before deactivating so we can cascade to linked teacher record
    const targetUser = await Users.findOne(delFilter, { id: 1, email: 1 }).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    // Soft-delete: mark isActive = false
    await Users.updateOne(
      delFilter,
      { $set: { isActive: false, updatedAt: new Date().toISOString() } }
    );

    // Cascade: deactivate linked teacher record so they stop appearing in timetable/assignments
    try {
      await _model('teachers').updateOne(
        { schoolId: req.jwtUser.schoolId, $or: [{ userId: targetUser.id }, { email: targetUser.email }] },
        { $set: { status: 'inactive', updatedAt: new Date().toISOString() } }
      );
    } catch (cascErr) {
      console.warn('[settings] teacher deactivation cascade (non-fatal):', cascErr.message);
    }

    // Revoke all outstanding tokens so session ends immediately
    revokeUserTokens(req.params.id).catch(err =>
      console.warn('[settings] token revocation on delete (non-fatal):', err.message)
    );

    res.json({ success: true, message: 'User removed.' });
  } catch (err) {
    console.error('[settings] DELETE /users/:id error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to remove user' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/settings/users/:id/reset-password
   Admin sets a usable password for a user.
   Body (optional): { password: string }  — if omitted, a strong random
   password is generated.  No forced change on login; the 90-day platform
   rotation policy handles expiry.
   ══════════════════════════════════════════════════════════════ */
router.post('/users/:id/reset-password', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  const { id } = req.params;
  const { password: customPwd } = req.body;
  const schoolId = req.jwtUser.schoolId;

  /* Validate custom password if provided */
  if (customPwd !== undefined && customPwd !== null && customPwd !== '') {
    if (typeof customPwd !== 'string' || customPwd.length < 8) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters.' } });
    }
  }

  try {
    const User   = _model('users');
    const School = _model('schools');

    /* Support both custom `id` field and MongoDB `_id` (for users created
       outside the invite flow who may only have _id set) */
    const isOid     = /^[0-9a-f]{24}$/i.test(id);
    const userQuery = isOid
      ? { schoolId, $or: [{ id }, { _id: id }] }
      : { id, schoolId };

    const target = await User.findOne(userQuery).lean();
    if (!target) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }

    /* Non-superadmin cannot reset another admin/superadmin's password */
    if (!_isSuperAdmin(req) && (target.role === 'admin' || target.role === 'superadmin')) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot reset password for another admin.' } });
    }

    /* Use custom password if provided, otherwise generate a strong random one */
    const newPassword = (customPwd && customPwd.trim()) ? customPwd.trim() : _genTempPassword();
    const hash        = await bcrypt.hash(newPassword, 12);
    const now         = new Date().toISOString();

    /* Update by whichever field actually matched.
       - Remove legacy mustChangePwd / mustChangePassword flags
       - Reset the 90-day rotation clock from now */
    const updateFilter = target.id
      ? { id: target.id, schoolId }
      : { _id: target._id, schoolId };
    await User.updateOne(
      updateFilter,
      {
        $set:   { password: hash, passwordChangedAt: now, updatedAt: now },
        $unset: { mustChangePwd: 1, mustChangePassword: 1 },
      }
    );

    /* Attempt email — non-fatal */
    const school = await School.findOne({ id: schoolId }).lean();
    let emailSent = false;
    try {
      await emailUtil.sendWelcomeCredentials({
        email:       target.email,
        name:        target.name  || target.email,
        schoolName:  school?.name || 'Your School',
        schoolEmail: school?.systemEmail || school?.email || '',
        schoolId,
        tempPassword: newPassword,
        role:         target.role,
        loginUrl:     process.env.APP_URL || 'https://msingi.io',
      });
      emailSent = true;
    } catch (emailErr) {
      console.warn('[settings] reset-password email failed:', emailErr.message);
    }

    return res.json({
      success: true,
      data: {
        password:  newPassword,
        name:      target.name  || target.email,
        email:     target.email,
        emailSent,
      },
    });
  } catch (err) {
    console.error('[settings] POST /users/:id/reset-password error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to set password.' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   NOTIFICATION SETTINGS
   GET  /api/settings/notifications — return per-event channel config
   PUT  /api/settings/notifications — save per-event channel config
   ══════════════════════════════════════════════════════════════ */

/* GET /api/settings/notifications */
router.get('/notifications', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
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
router.put('/notifications', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
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

/* ══════════════════════════════════════════════════════════════
   CUSTOM SMTP
   POST   /api/settings/school/smtp         — save SMTP config (encrypts pass)
   POST   /api/settings/school/smtp/test    — test connection (no save)
   DELETE /api/settings/school/smtp         — remove custom SMTP config
   ══════════════════════════════════════════════════════════════ */

/* POST /api/settings/school/smtp — save custom SMTP credentials */
router.post('/school/smtp', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  if (!smtpEncryptReady()) {
    return res.status(503).json({ success: false, error: { code: 'SMTP_ENCRYPT_NOT_CONFIGURED', message: 'SMTP_ENCRYPTION_KEY is not set on the server. Contact the platform administrator.' } });
  }
  const { smtpEnabled, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFromName, smtpFromEmail } = req.body;
  const schoolId = req.jwtUser.schoolId;

  try {
    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: schoolId }, { smtpPassEnc: 1 }).lean();
    if (!school) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'School not found.' } });

    const update = {
      smtpEnabled:   !!smtpEnabled,
      smtpHost:      (smtpHost || '').trim(),
      smtpPort:      parseInt(smtpPort, 10) || 587,
      smtpSecure:    !!smtpSecure,
      smtpUser:      (smtpUser || '').trim(),
      smtpFromName:  (smtpFromName || '').trim(),
      smtpFromEmail: (smtpFromEmail || '').trim(),
      updatedAt:     new Date().toISOString(),
    };

    // Only update the encrypted password if a new one is provided
    if (smtpPass && smtpPass.trim()) {
      update.smtpPassEnc = encrypt(smtpPass.trim());
    } else if (!school.smtpPassEnc) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'SMTP password is required.' } });
    }

    await Schools.updateOne({ id: schoolId }, { $set: update });
    emailUtil.invalidateSmtpCache(schoolId);
    return res.json({ success: true, message: 'SMTP settings saved.' });
  } catch (err) {
    console.error('[settings] POST /school/smtp error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to save SMTP settings.' } });
  }
});

/* POST /api/settings/school/smtp/test — test connection without saving */
router.post('/school/smtp/test', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  if (!smtpEncryptReady()) {
    return res.status(503).json({ success: false, error: { code: 'SMTP_ENCRYPT_NOT_CONFIGURED', message: 'SMTP_ENCRYPTION_KEY is not set on the server.' } });
  }

  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFromEmail, sendTo } = req.body;
  const schoolId = req.jwtUser.schoolId;
  const PASS_PLACEHOLDER = '••••••••'; // ••••••••

  if (!smtpHost || !smtpUser || !smtpPass) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'smtpHost, smtpUser and smtpPass are required.' } });
  }

  let pass = smtpPass;
  if (smtpPass === PASS_PLACEHOLDER) {
    // Client is using the masked placeholder — load the real password from DB
    try {
      const Schools = _model('schools');
      const school  = await Schools.findOne({ id: schoolId }, { smtpPassEnc: 1 }).lean();
      if (!school?.smtpPassEnc) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No saved SMTP password. Enter your password to test.' } });
      }
      const { decrypt: _dec } = require('../utils/smtpEncrypt');
      pass = _dec(school.smtpPassEnc);
    } catch (e) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to load saved SMTP password.' } });
    }
  }

  try {
    const t = nodemailer.createTransport({
      host:   smtpHost.trim(),
      port:   parseInt(smtpPort, 10) || 587,
      secure: !!smtpSecure,
      auth:   { user: smtpUser.trim(), pass },
      connectionTimeout: 10_000,
      greetingTimeout:   10_000,
      socketTimeout:     15_000,
    });

    await t.verify();

    const to   = (sendTo || smtpUser).trim();
    const from = smtpFromEmail
      ? `"Msingi SMTP Test" <${smtpFromEmail.trim()}>`
      : `"Msingi SMTP Test" <${smtpUser.trim()}>`;
    await t.sendMail({
      from, to,
      subject: '✅ Msingi — Custom SMTP test successful',
      html: `<p>Your custom SMTP settings are working correctly.</p>
             <p><strong>Host:</strong> ${smtpHost} &nbsp; <strong>Port:</strong> ${smtpPort} &nbsp; <strong>User:</strong> ${smtpUser}</p>
             <p>All school emails will be sent from this address going forward.</p>`,
    });
    return res.json({ success: true, message: `Test email sent to ${to}. Check your inbox.` });
  } catch (err) {
    const msg = err.message || 'Unknown SMTP error';
    console.warn(`[settings] SMTP test failed for school ${schoolId}: ${msg}`);
    return res.status(400).json({ success: false, error: { code: 'SMTP_TEST_FAILED', message: msg } });
  }
});

/* DELETE /api/settings/school/smtp — remove custom SMTP config entirely */
router.delete('/school/smtp', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    await _model('schools').updateOne(
      { id: req.jwtUser.schoolId },
      {
        $unset: { smtpEnabled:1, smtpHost:1, smtpPort:1, smtpSecure:1,
                  smtpUser:1, smtpPassEnc:1, smtpFromName:1, smtpFromEmail:1 },
        $set:   { updatedAt: new Date().toISOString() },
      }
    );
    emailUtil.invalidateSmtpCache(req.jwtUser.schoolId);
    return res.json({ success: true, message: 'Custom SMTP configuration removed. Emails will now route through the Msingi platform.' });
  } catch (err) {
    console.error('[settings] DELETE /school/smtp error:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to remove SMTP config.' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   CUSTOM ROLES
   GET    /api/settings/custom-roles        — list school's custom roles
   POST   /api/settings/custom-roles        — create a new custom role
   DELETE /api/settings/custom-roles/:key   — delete a custom role
   ══════════════════════════════════════════════════════════════ */

const BUILT_IN_ROLE_KEYS = new Set([
  'superadmin','admin',
  'deputy_principal','deputy',          // deputy is the legacy alias
  'section_head','teacher',
  'exams_officer','timetabler',
  'admissions_officer','finance','hr',
  'discipline_committee',
  'parent','guardian','student',
]);

router.get('/custom-roles', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const roles = await _model('custom_roles').find({ schoolId: req.jwtUser.schoolId }).sort({ createdAt: 1 }).lean();
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error('[settings] GET /custom-roles:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch custom roles' } });
  }
});

router.post('/custom-roles', authMiddleware, rbac('settings', 'create'), async (req, res) => {
  try {
    const { label, color = '#6366f1', baseRole = 'teacher' } = req.body;
    if (!label?.trim()) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Label is required.' } });

    // Derive a stable snake_case key from the label
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!key) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Label must contain alphanumeric characters.' } });

    if (BUILT_IN_ROLE_KEYS.has(key)) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `'${key}' is a reserved role name.` } });
    }

    const { schoolId, userId } = req.jwtUser;
    const CustomRoles = _model('custom_roles');
    const existing = await CustomRoles.findOne({ schoolId, key }).lean();
    if (existing) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `A role with key '${key}' already exists.` } });

    // Copy API-level permissions from baseRole's role_permissions doc
    const RolePerms = _model('role_permissions');
    const baseDoc   = await RolePerms.findOne({ schoolId, roleKey: baseRole }).lean();
    const basePerms = baseDoc?.permissions ?? {};

    const now = new Date().toISOString();

    // Upsert a role_permissions doc for this custom role
    await RolePerms.updateOne(
      { schoolId, roleKey: key },
      { $set: { id: `rp_${key}_${schoolId}`, schoolId, roleKey: key, permissions: basePerms, updatedAt: now } },
      { upsert: true }
    );

    // Create the custom_roles record
    const doc = await CustomRoles.create({
      id: _uid(), schoolId, key, label: label.trim(), color, baseRole,
      createdAt: now, createdBy: userId, updatedAt: now,
    });

    invalidatePermCache(schoolId);
    res.status(201).json({ success: true, data: doc.toObject ? doc.toObject() : doc });
  } catch (err) {
    console.error('[settings] POST /custom-roles:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create custom role' } });
  }
});

router.put('/custom-roles/:key', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { key } = req.params;
    const { schoolId } = req.jwtUser;
    const { label, color } = req.body;

    const patch = { updatedAt: new Date().toISOString() };
    if (label?.trim()) patch.label = label.trim();
    if (color)         patch.color = color;

    const doc = await _model('custom_roles').findOneAndUpdate(
      { schoolId, key },
      { $set: patch },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Custom role not found.' } });

    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[settings] PUT /custom-roles/:key:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update custom role' } });
  }
});

router.delete('/custom-roles/:key', authMiddleware, rbac('settings', 'delete'), async (req, res) => {
  try {
    const { key } = req.params;
    const { schoolId } = req.jwtUser;

    const CustomRoles = _model('custom_roles');
    const deleted = await CustomRoles.findOneAndDelete({ schoolId, key });
    if (!deleted) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Custom role not found.' } });

    // Remove role_permissions doc
    await _model('role_permissions').deleteOne({ schoolId, roleKey: key });

    // Strip the role's column from school.modulePermissions.byRole
    await _model('schools').updateOne(
      { id: schoolId },
      { $unset: { [`modulePermissions.byRole.${key}`]: '' }, $set: { updatedAt: new Date().toISOString() } }
    );

    invalidatePermCache(schoolId);
    res.json({ success: true, message: `Role '${key}' deleted.` });
  } catch (err) {
    console.error('[settings] DELETE /custom-roles/:key:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to delete custom role' } });
  }
});

/* ══════════════════════════════════════════════════════════════
   ADMISSION COUNTER  (admin only)
   GET  /api/settings/admission-counter  — peek current seq + next preview
   PUT  /api/settings/admission-counter  — set counter for migrations
   ══════════════════════════════════════════════════════════════ */
router.get('/admission-counter', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const Schools  = _model('schools');
    const school   = await Schools.findOne({ id: req.jwtUser.schoolId }, { admissionConfig: 1 }).lean();
    const cfg      = school?.admissionConfig || {};
    const result   = await peekAdmissionCounter(req.jwtUser.schoolId, cfg);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[settings] GET /admission-counter:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to read counter.' } });
  }
});

router.put('/admission-counter', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const value = parseInt(req.body.value, 10);
    if (isNaN(value) || value < 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'value must be a non-negative integer.' } });
    }
    const Schools = _model('schools');
    const school  = await Schools.findOne({ id: req.jwtUser.schoolId }, { admissionConfig: 1 }).lean();
    const cfg     = school?.admissionConfig || {};
    const result  = await setAdmissionCounter(req.jwtUser.schoolId, value, cfg, true);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[settings] PUT /admission-counter:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to set counter.' } });
  }
});

module.exports = router;
