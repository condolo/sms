/* ============================================================
   Msingi — User Management Routes
   POST /api/users/invite         — invite single user (sends welcome email)
   POST /api/users/bulk-invite    — invite multiple users from CSV/form
   POST /api/users/:id/role-change — notify user of role/permission change
   All endpoints require authMiddleware + admin role
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const { authMiddleware }   = require('../middleware/auth');
const { rbac }             = require('../middleware/rbac');
const { _model }           = require('../utils/model');
const { revokeUserTokens } = require('../utils/token-version');
const email                = require('../utils/email');
const AuditService         = require('../services/audit');

const router = express.Router();

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 100,
  message: { error: 'Too many invite requests. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/* ── Helpers ──────────────────────────────────────────────── */

/* Build a user findOne/updateOne filter that works whether the JWT's userId is
   a custom string id OR a MongoDB ObjectId hex string (the fallback for legacy
   users who were created without a custom id field). */
function _meFilter(userId, schoolId) {
  const isOid = /^[a-f\d]{24}$/i.test(userId);
  const idQ   = isOid
    ? { $or: [{ id: userId }, { _id: new mongoose.Types.ObjectId(userId) }] }
    : { id: userId };
  return schoolId ? { ...idQ, schoolId } : idQ;
}

function _genTempPassword() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums  = '23456789';
  let chars = '';
  // CSPRNG — crypto.randomInt, never Math.random()
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

function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
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
router.post('/invite', authMiddleware, inviteLimiter, rbac('settings', 'users'), async (req, res) => {

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
      schoolEmail:  school?.systemEmail || '',
      schoolId,
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
router.post('/bulk-invite', authMiddleware, inviteLimiter, rbac('settings', 'users'), async (req, res) => {

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
        passwordChangedAt: now,
        createdAt: now,
        createdBy: req.jwtUser.userId
      });

      results.created.push({ name, email: userEmail, role: safeRole, id: user.id });

      // Send welcome email (non-blocking, fire-and-forget)
      email.sendWelcomeCredentials({
        name:         name.trim(),
        email:        userEmail.toLowerCase(),
        tempPassword,
        schoolName:   school?.name || '',
        schoolEmail:  school?.systemEmail || '',
        schoolId,
        role:         safeRole,
        loginUrl:     process.env.APP_URL || 'https://school-management-ecosystem.onrender.com'
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
router.post('/:id/role-change', authMiddleware, rbac('settings', 'users'), async (req, res) => {

  const { newRole, oldRole, note } = req.body;
  if (!newRole) return res.status(400).json({ error: 'newRole is required' });

  try {
    const User   = _model('users');
    const School = _model('schools');
    const user   = await User.findOne({ id: req.params.id, schoolId: req.jwtUser.schoolId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();

    // Revoke all outstanding tokens for this user so the role change takes effect immediately.
    await revokeUserTokens(user.id);

    await email.sendRoleChanged({
      name:        user.name,
      email:       user.email,
      schoolName:  school?.name || '',
      schoolEmail: school?.systemEmail || '',
      schoolId:    req.jwtUser.schoolId,
      oldRole:     oldRole || user.role,
      newRole,
      changedBy:   req.jwtUser.email
    });

    AuditService.log({ action: 'user.role_changed', actor: req.jwtUser, schoolId: req.jwtUser.schoolId, target: { type: 'user', id: user.id, label: user.email }, details: { oldRole: oldRole || user.role, newRole, note }, req });
    res.json({ success: true });
  } catch (err) {
    console.error('[users/role-change]', err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

/* ══════════════════════════════════════════════════════════════
   SELF-SERVICE PROFILE ENDPOINTS
   GET  /api/users/me                  — fetch own profile (+ photoUrl)
   PUT  /api/users/me                  — update own name / phone / bio
   PUT  /api/users/me/meeting-links    — save Zoom PMI / Meet links (all roles)
   PUT  /api/users/me/photo            — upload / replace profile photo (non-students)
   DELETE /api/users/me/photo          — remove profile photo
   GET  /api/users/:id/photo  — serve photo as image/* (tenant-scoped)
   ══════════════════════════════════════════════════════════════ */

/* GET /api/users/me */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId } = req.jwtUser;
    const User   = _model('users');
    const Photos = _model('user_photos');
    const user   = await User.findOne(_meFilter(userId, schoolId)).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const uid     = user.id || user._id?.toString();
    const photo   = await Photos.findOne({ userId: uid, schoolId }).lean();
    const safeUser = { ...user, password: undefined, mfaOtp: undefined, mfaExpiry: undefined };
    safeUser.id       = uid;
    safeUser.photoUrl = photo ? `/api/users/${uid}/photo?schoolId=${encodeURIComponent(schoolId)}` : null;

    res.json({ user: safeUser });
  } catch (err) {
    console.error('[users/me GET]', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/* PUT /api/users/me — update name, phone, bio */
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'bio'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = String(req.body[key]).trim();
    }
    if (updates.name !== undefined && !updates.name) return res.status(400).json({ error: 'Name cannot be empty' });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

    updates.updatedAt = new Date().toISOString();
    const { userId, schoolId } = req.jwtUser;
    const User = _model('users');
    await User.updateOne(_meFilter(userId, schoolId), { $set: updates });

    // Cascade name change to the teachers record and all denormalized teacherName fields.
    // This ensures timetable, lesson plans, substitutions etc. all reflect the new name.
    if (updates.name) {
      const nameParts   = updates.name.split(' ');
      const newFirst    = nameParts[0];
      const newLast     = nameParts.slice(1).join(' ') || '';
      const newFullName = updates.name;
      const now         = updates.updatedAt;

      const Teachers = _model('teachers');
      const teacherExists = await Teachers.findOne({ schoolId, userId }).lean();
      if (teacherExists) {
        await Teachers.updateOne({ schoolId, userId }, { $set: { firstName: newFirst, lastName: newLast, updatedAt: now } });
      }

      // Cascade to every collection that denormalises teacherName
      await Promise.all([
        _model('timetable').updateMany(
          { schoolId, teacherId: userId },
          { $set: { teacherName: newFullName } }
        ),
        _model('lesson_plans').updateMany(
          { schoolId, teacherId: userId },
          { $set: { teacherName: newFullName } }
        ),
        _model('substitutions').updateMany(
          { schoolId, originalTeacherId: userId },
          { $set: { originalTeacherName: newFullName } }
        ),
        _model('substitutions').updateMany(
          { schoolId, substituteTeacherId: userId },
          { $set: { substituteTeacherName: newFullName } }
        ),
        _model('lesson_coverage').updateMany(
          { schoolId, teacherId: userId },
          { $set: { teacherName: newFullName } }
        ),
      ]);
    }

    const Photos  = _model('user_photos');
    const user    = await User.findOne(_meFilter(userId, schoolId)).lean();
    const uid     = user?.id || user?._id?.toString() || userId;
    const photo   = await Photos.findOne({ userId: uid, schoolId }).lean();
    const safeUser = { ...user, password: undefined, mfaOtp: undefined, mfaExpiry: undefined };
    safeUser.id       = uid;
    safeUser.photoUrl = photo ? `/api/users/${uid}/photo?schoolId=${encodeURIComponent(schoolId)}` : null;

    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('[users/me PUT]', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/* PUT /api/users/me/meeting-links — save Zoom PMI / Google Meet links (all roles) */
router.put('/me/meeting-links', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId } = req.jwtUser;
    const { zoomPMILink = '', zoomPasscode = '', meetLink = '' } = req.body;

    // Validate: if a URL is provided it must start with https://
    for (const [label, val] of [['Zoom PMI link', zoomPMILink], ['Google Meet link', meetLink]]) {
      if (val && !val.trim().startsWith('https://')) {
        return res.status(400).json({ success: false, error: { message: `${label} must start with https://` } });
      }
    }

    const updates = {
      zoomPMILink:  zoomPMILink.trim(),
      zoomPasscode: zoomPasscode.trim(),
      meetLink:     meetLink.trim(),
      updatedAt:    new Date().toISOString(),
    };

    const User = _model('users');
    await User.updateOne(_meFilter(userId, schoolId), { $set: updates });

    // Mirror onto teacher record if one exists (keeps emergency timetable logic working)
    const Teachers = _model('teachers');
    const user = await User.findOne(_meFilter(userId, schoolId)).lean();
    if (user) {
      await Teachers.updateOne(
        { schoolId, email: user.email },
        { $set: { zoomPMILink: updates.zoomPMILink, zoomPasscode: updates.zoomPasscode, meetLink: updates.meetLink, updatedAt: updates.updatedAt } }
      );
    }

    return res.json({ success: true, data: updates });
  } catch (err) {
    console.error('[users/me/meeting-links PUT]', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to save meeting links.' } });
  }
});

/* PUT /api/users/me/photo — upload profile photo (non-students only) */
router.put('/me/photo', authMiddleware, async (req, res) => {
  try {
    const role = req.jwtUser.role || '';
    if (role === 'student') {
      return res.status(403).json({ error: 'Student photos are managed through student records.' });
    }

    const { photoBase64 } = req.body;
    if (!photoBase64) return res.status(400).json({ error: 'photoBase64 is required' });

    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(photoBase64)) {
      return res.status(400).json({ error: 'Invalid image. Use JPEG, PNG, or WebP.' });
    }

    const base64Data = photoBase64.split(',')[1] || '';
    const sizeBytes  = Math.ceil(base64Data.length * 0.75);
    if (sizeBytes > 300 * 1024) {
      return res.status(400).json({ error: 'Image too large. Please upload under 300 KB after resizing.' });
    }

    // Resolve the same canonical uid used everywhere else (user.id preferred over _id)
    const { userId, schoolId } = req.jwtUser;
    const User = _model('users');
    const user = await User.findOne(_meFilter(userId, schoolId)).lean();
    const uid  = user?.id || user?._id?.toString() || userId;

    const Photos = _model('user_photos');
    await Photos.updateOne(
      { userId: uid, schoolId },
      { $set: { userId: uid, schoolId, photoBase64, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );

    res.json({ success: true, photoUrl: `/api/users/${uid}/photo?schoolId=${encodeURIComponent(schoolId)}` });
  } catch (err) {
    console.error('[users/me/photo PUT]', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

/* DELETE /api/users/me/photo */
router.delete('/me/photo', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId } = req.jwtUser;
    const User = _model('users');
    const user = await User.findOne(_meFilter(userId, schoolId)).lean();
    const uid  = user?.id || user?._id?.toString() || userId;

    const Photos = _model('user_photos');
    await Photos.deleteOne({ userId: uid, schoolId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove photo' });
  }
});

/* GET /api/users/:id/photo — serve photo as binary image
   Requires ?schoolId= query param for tenant isolation.
   Auth tokens cannot be sent by browser <img> tags, so we use schoolId
   as a scoping guard instead of Bearer auth.  The schoolId is not sensitive
   (every user knows their own school), but it prevents cross-tenant enumeration. */
router.get('/:id/photo', async (req, res) => {
  try {
    const { schoolId } = req.query;
    if (!schoolId) return res.status(400).end();

    const Photos = _model('user_photos');
    const photo  = await Photos.findOne({ userId: req.params.id, schoolId }).lean();

    if (!photo?.photoBase64) return res.status(404).end();

    const [header, data] = photo.photoBase64.split(',');
    const mimeMatch = header?.match(/data:(image\/[\w+]+);base64/);
    const mime = mimeMatch?.[1] || 'image/jpeg';

    res.set('Content-Type', mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(data, 'base64'));
  } catch {
    res.status(500).end();
  }
});

module.exports = router;
