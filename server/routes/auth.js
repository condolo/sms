const express    = require('express');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const mongoose   = require('mongoose');
const { sign, verify } = require('../utils/jwt');
const { _model } = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { tenantMiddleware } = require('../middleware/tenant');
const { authMiddleware }   = require('../middleware/auth');
const rateLimit  = require('express-rate-limit');
const email      = require('../utils/email');
const SessionService       = require('../services/sessionService');
const { revokeUserTokens, revokeIdentityTokens, getIdentityTokenVersion } = require('../utils/token-version');
const AuditService         = require('../services/audit');
const { provisionIdentityForUser } = require('../utils/provision-identities');
const { isIdentityCutoverEnabled } = require('../utils/identity-cutover');

const router = express.Router();

/* ── Auth cookie helper ──────────────────────────────────
   Sets the JWT as an HttpOnly cookie so JS (and XSS) cannot
   read it. Uses SameSite=Strict to block CSRF.
   maxAge mirrors absoluteExpiry when available (8 h default). */
function _setAuthCookie(res, token, absoluteExpiry) {
  const maxAge = absoluteExpiry
    ? Math.max(0, new Date(absoluteExpiry) - Date.now())
    : 8 * 60 * 60 * 1000;
  res.cookie('token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge,
  });
}

/* ── OAuth exchange-code store ───────────────────────────
   Single-use, 30-second codes replace JWT-in-URL.
   Map<code (64-char hex), { token, expiresAt }>
   JavaScript is single-threaded so no race conditions in
   a single process.  Codes are generated with CSPRNG.     */
const _exchangeCodes = new Map();

/**
 * Issue a short-lived exchange code for an OAuth callback.
 * Only the opaque code appears in the redirect URL — the JWT
 * stays server-side until the client calls POST /exchange.
 */
function _issueExchangeCode(token) {
  const code = crypto.randomBytes(32).toString('hex'); // 64-char hex, CSPRNG
  _exchangeCodes.set(code, { token, expiresAt: Date.now() + 30_000 });

  // Lazy cleanup — sweep expired entries each time a new code is issued
  for (const [k, v] of _exchangeCodes) {
    if (v.expiresAt <= Date.now()) _exchangeCodes.delete(k);
  }
  return code;
}

/* ── OTP helpers — cryptographically secure ─────────────── */
function _genOTP() {
  return String(crypto.randomInt(100000, 999999)); // 6-digit CSPRNG
}
// Hash OTP before storing — DB breach cannot reveal pending codes
function _hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}
// Timing-safe OTP comparison — prevents timing attacks
function _verifyOTP(input, storedHash) {
  try {
    const inputHash = _hashOTP(input);
    return crypto.timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

/* Roles that require 2FA */
const MFA_ROLES = new Set(['superadmin', 'admin', 'deputy', 'principal', 'finance']);

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
async function _buildTokenPayload(user, schoolId) {
  const role  = user.primaryRole || user.role;
  const payload = {
    userId:   user.id || user._id.toString(),
    schoolId: schoolId,
    email:    user.email,
    role,
    roles:    user.roles || [role],
    tv:       user.tokenVersion ?? 0,  // token version — enables revocation
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

  // C8/MR-001 Phase 1 (ADR-0003 Decision 4) — additive. Only users with a
  // shared credential (users.identityId set, C8/MR-001 Phase 0) carry these;
  // a password/MFA change bumps identities.tokenVersion, invalidating every
  // token across every school sharing that credential.
  if (user.identityId) {
    payload.identityId = user.identityId;
    payload.itv = await getIdentityTokenVersion(user.identityId);
  }

  // C9 (D-004, Constitution §10 Stage 4) — orgId only when this school's
  // organization has explicitly opted into multi-school (multiSchoolEnabled:
  // true). Set directly from school.organizationId — NOT gated on a
  // `memberships` doc existing for this user at this school. Found live
  // (real-DB production validation, not a mock): a freshly-invited user
  // never gets an inline Membership record for their OWN home school —
  // only the one-time boot backfill (provisionMemberships()) creates those,
  // so anyone invited after boot had payload.orgId silently never set,
  // which broke _availableSchools (and therefore the School Switcher UI)
  // for them even though _resolveIdentitySchools independently proved they
  // have real multi-school access. membershipId stays best-effort metadata
  // (audit-query filter only, see server/routes/audit.js — nothing
  // authorization-relevant depends on it), looked up but never required.
  // Never fatal — a lookup failure here must not block token issuance.
  try {
    const school = await _model('schools').findOne({ id: schoolId }).select('organizationId').lean();
    if (school?.organizationId) {
      const org = await _model('organizations').findOne({ id: school.organizationId }).select('multiSchoolEnabled').lean();
      if (org?.multiSchoolEnabled) {
        payload.orgId = school.organizationId;
        const membership = await tenantModel('memberships', { schoolId }).findOne({ userId: payload.userId }).select('id').lean();
        if (membership) {
          payload.membershipId = membership.id;
        }
      }
    }
  } catch (err) {
    console.error('[auth] _buildTokenPayload multi-school lookup failed (non-fatal):', err.message);
  }

  return payload;
}

/**
 * Which schools can this identity actually log into, within one
 * organization? The single source of truth for "eligible schools" used
 * by both school-switching (_availableSchools/switch-school below) and
 * org-first login (auth-org-login, a separate file). Deliberately does
 * NOT consult `memberships` — a Membership grant (e.g. the Link Identity
 * flow, platform.js POST /memberships) records authorization intent but
 * is NOT created alongside a per-school `users` doc, so it cannot answer
 * "can this identity actually log in here." A real `users` doc carrying
 * a matching `identityId` is the only thing that can. The org boundary
 * is pushed into the query itself (schoolId: {$in: orgSchoolIds}), not
 * applied as an application-level post-filter, for defense-in-depth.
 *
 * @param {string} identityId
 * @param {string} orgId
 * @returns {Promise<Array<{schoolId: string, userId: string, slug: string, name: string}>>}
 */
async function _resolveIdentitySchools(identityId, orgId) {
  if (!identityId || !orgId) return [];
  try {
    // isActive: {$ne:false} — found live (real-DB production validation):
    // without this filter, a school an operator has disabled (PATCH
    // .../schools/:id {isActive:false}) still appeared in the org-login
    // picker and was still redeemable via complete-org-login, even though
    // direct login at that school's own subdomain is correctly blocked by
    // tenantMiddleware's isActive check. Same standard the rest of the
    // resolver already applies to the user doc.
    const orgSchools = await _model('schools')
      .find({ organizationId: orgId, isActive: { $ne: false } })
      .select('id name slug')
      .lean();
    if (!orgSchools.length) return [];
    const orgSchoolIds = orgSchools.map(s => s.id);
    const schoolMap = Object.fromEntries(orgSchools.map(s => [s.id, s]));

    const eligibleUsers = await _model('users')
      .find({ identityId, schoolId: { $in: orgSchoolIds }, isActive: { $ne: false } })
      .select('id schoolId')
      .lean();

    return eligibleUsers
      .filter(u => schoolMap[u.schoolId])
      .map(u => ({
        schoolId: u.schoolId,
        userId:   u.id,
        slug:     schoolMap[u.schoolId].slug,
        name:     schoolMap[u.schoolId].name,
      }));
  } catch (err) {
    console.error('[auth] _resolveIdentitySchools lookup failed (non-fatal):', err.message);
    return [];
  }
}

/**
 * C9 (D-004) — other schools this user can switch to without
 * re-authenticating, for the client to render a School Switcher.
 * Only non-empty when the token payload carries both orgId (this
 * user's current school's organization has multiSchoolEnabled: true)
 * and identityId (this account has been linked to a shared identity,
 * C8/MR-001 Phase 0 — unconditional, not gated by cutover). Sourced
 * from _resolveIdentitySchools, not `memberships` — see that function's
 * comment for why a Membership grant alone cannot answer this.
 *
 * @param {Object} payload — a built token payload (from _buildTokenPayload,
 *   or a verified JWT payload — same shape)
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function _availableSchools(payload) {
  if (!payload.orgId || !payload.identityId) return [];
  const eligible = await _resolveIdentitySchools(payload.identityId, payload.orgId);
  return eligible
    .filter(s => s.schoolId !== payload.schoolId)
    .map(s => ({ id: s.schoolId, name: s.name }));
}

/* ── Temp password generator (for new user invites) ────── */
function _genTempPassword() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums  = '23456789';
  let chars = '';
  // Use crypto.randomInt — CSPRNG, not Math.random
  for (let i = 0; i < 8; i++) chars += alpha[crypto.randomInt(alpha.length)];
  chars += nums[crypto.randomInt(nums.length)];
  chars += nums[crypto.randomInt(nums.length)];
  chars += '!';
  // Fisher-Yates shuffle using CSPRNG
  const arr = chars.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/* ── Password age check (90-day policy) ─────────────────── */
const PASSWORD_MAX_DAYS = 90;
function _passwordAge(user) {
  const ref = user.passwordChangedAt || user.createdAt;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref)) / (1000 * 60 * 60 * 24));
}

/* ── Layer 1: IP-level limiter — platform-wide abuse protection ─
   Catches credential-stuffing bots and scanner IPs before they reach
   the DB. Limit is generous enough for a school computer lab logging
   in simultaneously, but blocks sustained volumetric attacks.
   Uses CF-Connecting-IP when behind Cloudflare so the real client IP
   is used rather than Cloudflare's edge node IP.               ── */
const loginIpLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            100,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:           () => process.env.NODE_ENV === 'test',
  keyGenerator:   (req) => req.headers['cf-connecting-ip'] || req.ip,
  message:        { error: 'Too many requests from this network. Please try again in 15 minutes.' },
});

/* ── Layer 2: Per-account failure tracker (MongoDB-backed) ──────
   Progressive lockouts: 5→1min  10→15min  20→1hr  30→24hr+alert
   Only failed logins count; cleared on any successful auth.
   Shared across all server instances — survives restarts.        ── */
const SecurityService = require('../services/securityService');

/* POST /api/auth/login
   Body: { email, password }
   Header: X-School-Slug: demo         (or resolved from subdomain by tenant middleware)
   Returns: { token, user, school }
*/
router.post('/login', loginIpLimiter, tenantMiddleware, async (req, res) => {
  try {
    // NOTE: renamed to userEmail to avoid shadowing the module-level `email` import
    // 'identifier' supports admission-number login for students; falls back to 'email' for staff
    const { email: userEmail, password, identifier } = req.body;
    const loginId = ((identifier || userEmail) || '').toLowerCase().trim();
    if (!loginId || !password) return res.status(400).json({ error: 'Email or admission number and password required' });

    // Layer 2: per-account lock (progressive: 5→1min, 10→15min, 20→1hr, 30→24hr)
    const retryAfter = await SecurityService.checkAccountLock(req.school.id, loginId);
    if (retryAfter !== null) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Please wait before trying again.',
        retryAfter,
      });
    }

    const User   = tenantModel('users', { schoolId: req.school.id });
    const School = _model('schools');

    // Find user regardless of isActive so we can give a clear pending message
    // Students log in with admission number stored in `username` field; staff use email
    const user = await User.findOne({
      $or: [
        { email: loginId,    schoolId: req.school.id },
        { username: loginId, schoolId: req.school.id },
      ],
    }).lean();

    if (!user) {
      const clientIp = req.headers['cf-connecting-ip'] || req.ip;
      SecurityService.recordFail(req.school.id, loginId, clientIp, req.school).catch(() => {});
      return res.status(401).json({ error: 'Invalid email or password' });
    }

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
          message: 'Your school registration was not approved. Please contact support at support@msingi.io.'
        });
      }
      return res.status(403).json({ error: 'Account inactive. Please contact your school administrator.' });
    }

    // C8/MR-001 Phase 3 (ADR-0003, Cutover) — fetch the shared identity
    // ONCE, reused below for both the password check and the mfaEnabled
    // read further down. Disabled by default — see
    // server/utils/identity-cutover.js. `identityLookupAttempted` is
    // tracked SEPARATELY from `identity` itself: a dangling identityId
    // (fetch attempted, resolves null) or an unusable passwordHash must
    // be treated as a credential mismatch, not silently fall back to
    // users.password — falling back would mask exactly the divergence
    // the Phase 2 qa-health gate exists to catch before cutover is ever
    // turned on. Collapsing these into one nullable variable was a real
    // bug caught by this phase's own tests: `identity` alone can't
    // distinguish "never looked up" from "looked up, found nothing."
    const identityLookupAttempted = isIdentityCutoverEnabled() && !!user.identityId;
    let identity = null;
    if (identityLookupAttempted) {
      identity = await _model('identities').findOne({ id: user.identityId }).lean();
    }

    const match = identityLookupAttempted
      ? (identity?.passwordHash?.startsWith('$2') ? await bcrypt.compare(password, identity.passwordHash) : false)
      : (user.password?.startsWith('$2') ? await bcrypt.compare(password, user.password) : false); // reject any account that lacks a bcrypt hash

    if (!match) {
      const clientIp = req.headers['cf-connecting-ip'] || req.ip;
      SecurityService.recordFail(req.school.id, loginId, clientIp, req.school).catch(() => {});
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const _userId = user.id || user._id.toString();

    // ── First-login forced change (new user temp password or admin reset) ──
    if (user.mustChangePassword || user.mustChangePwd) {
      SecurityService.clearFail(req.school.id, loginId).catch(() => {});
      return res.json({
        passwordExpired: true,
        reason: 'first_login',
        userId:   _userId,
        schoolId: req.school.id,
        hint:     'Your administrator has set a temporary password. Please choose your own password to continue.'
      });
    }

    // ── 90-day password rotation policy ────────────────────
    // userId uses custom id if available; falls back to MongoDB _id string.
    // The force-change route accepts both via $or lookup.
    const ageDays = _passwordAge(user);
    if (ageDays >= PASSWORD_MAX_DAYS) {
      SecurityService.clearFail(req.school.id, loginId).catch(() => {});
      // Send expiry email (non-blocking, deduplication by day)
      _checkPasswordExpiryAndNotify(user, req.school).catch(() => {});
      return res.json({
        passwordExpired: true,
        reason: 'expired',
        userId:   _userId,
        schoolId: req.school.id,
        hint:     `Your password is ${ageDays} days old. For your security, please set a new password to continue.`
      });
    }

    // ── Proactive expiry reminder (≤ 7 days left) ──────────
    if (ageDays >= PASSWORD_MAX_DAYS - 7) {
      _checkPasswordExpiryAndNotify(user, req.school).catch(() => {});
    }

    // ── 2FA for privileged roles ─────────────────────────────
    // Applies to: superadmin, admin, deputy, finance
    // Can be disabled per-user with mfaEnabled: false
    // Skipped for the demo school — demo accounts have no real email inboxes
    const userRole   = user.primaryRole || user.role;
    const isDemo     = req.school?.slug === 'demo';
    // C8/MR-001 Phase 3 — mfaEnabled becomes identity-level once cutover
    // is live and this user has one (ADR-0003 Decision 4, Open Question
    // 3 — a deliberate, tested decision, not a silent behavior change).
    const mfaEnabled = identity ? identity.mfaEnabled : user.mfaEnabled;
    if (!isDemo && MFA_ROLES.has(userRole) && mfaEnabled !== false) {
      const otp      = _genOTP();
      const otpHash  = _hashOTP(otp);          // store hash, not plaintext
      const expiry   = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
      await tenantModel('users', { schoolId: req.school.id }).updateOne({ _id: user._id }, { mfaOtp: otpHash, mfaExpiry: expiry });

      // Send OTP email with plaintext code (non-blocking — log if it fails)
      email.sendLoginOTP({
        name:        user.name,
        email:       user.email,
        otp,                                   // send plaintext code, store hash
        schoolName:  req.school.name || req.school.slug,
        schoolEmail: req.school.systemEmail || '',
        schoolId:    req.school.id,
      }).catch(err => console.error('[2FA email]', err.message));

      SecurityService.clearFail(req.school.id, loginId).catch(() => {});
      return res.json({
        mfaRequired: true,
        userId:      _userId,
        schoolId:    req.school.id,
        hint:        `A 6-digit code has been sent to ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
      });
    }

    // Update last login
    await tenantModel('users', { schoolId: req.school.id }).updateOne({ _id: user._id }, { lastLogin: new Date().toISOString() });

    AuditService.log({ action: 'auth.login', actor: { userId: user.id, role: userRole, email: user.email }, schoolId: req.school.id, req });

    // Create platform session record (device tracking, admin revocation, audit trail)
    const { sessionId, absoluteExpiry } = await SessionService.createSession(
      _userId, req.school.id, userRole,
      req.headers['cf-connecting-ip'] || req.ip,
      req.headers['user-agent'] || '',
    );

    const tokenPayload = await _buildTokenPayload(user, req.school.id);
    const token = sign({ ...tokenPayload, sessionId, absoluteExpiry });

    // Check trial expiry and send reminder if needed
    _checkTrialAndNotify(req.school).catch(() => {});

    const safeUser = { ...user, password: undefined };

    // Attach merged role permissions so the client sidebar can filter correctly.
    // Merges across all roles the user holds (union of actions per module).
    const allRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [userRole];
    const mergedPerms = await _loadMergedPermissions(req.school.id, allRoles, user.id);
    if (mergedPerms !== null) {
      safeUser.permissions = mergedPerms;
    }

    const availableSchools = await _availableSchools(tokenPayload);

    SecurityService.clearFail(req.school.id, loginId).catch(() => {});
    _setAuthCookie(res, token, absoluteExpiry);
    res.json({
      user: safeUser, school: req.school, absoluteExpiry,
      ...(availableSchools.length ? { availableSchools } : {}),
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* POST /api/auth/verify-otp — complete 2FA login */
const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Too many OTP attempts. Please try again.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/verify-otp', otpLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ error: 'userId and otp required' });

    const User  = tenantModel('users', { schoolId: req.school.id });
    const isOid = /^[0-9a-f]{24}$/i.test(userId);
    const userQ  = isOid
      ? { $or: [{ id: userId }, { _id: new mongoose.Types.ObjectId(userId) }], schoolId: req.school.id }
      : { id: userId, schoolId: req.school.id };

    const user = await User.findOne(userQ).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.mfaOtp || !user.mfaExpiry) {
      return res.status(400).json({ error: 'No pending OTP. Please sign in again.' });
    }
    if (new Date() > new Date(user.mfaExpiry)) {
      await User.updateOne({ _id: user._id }, { $unset: { mfaOtp: 1, mfaExpiry: 1 } });
      return res.status(400).json({ error: 'Code expired. Please sign in again to get a new code.' });
    }
    // Timing-safe comparison against stored hash
    if (!_verifyOTP(otp.trim(), user.mfaOtp)) {
      return res.status(401).json({ error: 'Incorrect code. Please check your email and try again.' });
    }

    // OTP verified — clear it, issue JWT
    await User.updateOne({ _id: user._id }, { $unset: { mfaOtp: 1, mfaExpiry: 1 }, lastLogin: new Date().toISOString() });

    const School = _model('schools');
    const school = await School.findOne({ id: user.schoolId }).lean();

    const _otpUserId   = user.id || user._id.toString();
    const _otpUserRole = user.primaryRole || user.role;

    const { sessionId: otpSessionId, absoluteExpiry: otpAbsExpiry } = await SessionService.createSession(
      _otpUserId, user.schoolId, _otpUserRole,
      req.headers['cf-connecting-ip'] || req.ip,
      req.headers['user-agent'] || '',
    );

    const otpTokenPayload = await _buildTokenPayload(user, user.schoolId);
    const token = sign({ ...otpTokenPayload, sessionId: otpSessionId, absoluteExpiry: otpAbsExpiry });

    // Attach merged role permissions so sidebar filters correctly (same as regular login)
    const safeUser = { ...user, password: undefined, mfaOtp: undefined, mfaExpiry: undefined };
    const otpAllRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [_otpUserRole];
    const otpMergedPerms = await _loadMergedPermissions(user.schoolId, otpAllRoles, user.id);
    if (otpMergedPerms !== null) safeUser.permissions = otpMergedPerms;

    const otpAvailableSchools = await _availableSchools(otpTokenPayload);

    _checkTrialAndNotify(school).catch(() => {});
    _setAuthCookie(res, token, otpAbsExpiry);
    res.json({
      user: safeUser, school, absoluteExpiry: otpAbsExpiry,
      ...(otpAvailableSchools.length ? { availableSchools: otpAvailableSchools } : {}),
    });
  } catch (err) {
    console.error('[auth/verify-otp]', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/* ── Merge role_permissions across multiple roles ──────────── */
// Takes the union of actions per module across all roles a user holds.
// deputy is an alias for deputy_principal — normalise before lookup.
async function _loadMergedPermissions(schoolId, roles, userId = null) {
  if (roles.some(r => r === 'superadmin')) return null; // null = full access

  // Normalise aliases
  const keys = [...new Set(roles.map(r => r === 'deputy' ? 'deputy_principal' : r))];

  const RolePerms = tenantModel('role_permissions', { schoolId });
  const docs = await RolePerms.find({ schoolId, roleKey: { $in: keys } }).lean();

  // Union of actions per module across all roles — most permissive wins
  const merged = {};
  for (const doc of docs) {
    for (const [mod, actions] of Object.entries(doc.permissions ?? {})) {
      if (!merged[mod]) merged[mod] = new Set();
      (Array.isArray(actions) ? actions : []).forEach(a => merged[mod].add(a));
    }
  }
  const roleResult = Object.fromEntries(
    Object.entries(merged).map(([mod, set]) => [mod, [...set]])
  );

  // Apply per-user overrides on top of role permissions (user overrides win per module)
  if (userId) {
    const userDoc = await RolePerms.findOne({ schoolId, userId }).lean();
    if (userDoc?.permissions) {
      return { ...roleResult, ...userDoc.permissions };
    }
  }
  return roleResult;
}

/* GET /api/auth/permissions — return merged live permissions for all user roles.
   Called by the client on mount + window focus to keep the sidebar current
   without requiring a full logout/login after an admin changes Settings.    */
router.get('/permissions', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId, role, roles } = req.jwtUser;
    if (role === 'superadmin') {
      return res.json({ permissions: null }); // null = full access, no sidebar filtering
    }
    // Use all roles the user holds so secondary roles are honoured
    const allRoles = Array.isArray(roles) && roles.length ? roles : [role];
    const permissions = await _loadMergedPermissions(schoolId, allRoles, userId);
    res.json({ permissions: permissions ?? {} });
  } catch (err) {
    console.error('[auth/permissions]', err);
    res.status(500).json({ error: 'Failed to load permissions' });
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
    schoolId:    school.id,
    daysLeft:    Math.max(0, daysLeft)
  });
}

/* POST /api/auth/force-change — change password when 90-day rotation is due
   No JWT required (user is locked at password screen)
   Body: { userId, schoolId, newPassword }
   userId may be either the custom `id` field (e.g. "usr_xxx") or the MongoDB
   _id hex string — the $or lookup handles both cases.
*/
const forceChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/force-change', forceChangeLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { userId, schoolId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'userId and newPassword required' });
    if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const sid  = schoolId || req.school?.id;
    const User = tenantModel('users', { schoolId: sid });

    /* Support users with custom `id` field AND users that only have MongoDB _id */
    const isOid     = /^[0-9a-f]{24}$/i.test(userId);
    const userQuery = isOid
      ? { schoolId: sid, $or: [{ id: userId }, { _id: userId }] }
      : { id: userId, schoolId: sid };

    const user = await User.findOne(userQuery).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now    = new Date().toISOString();
    const hashed = await bcrypt.hash(newPassword, 12);

    /* Update by whichever field actually matched */
    const updateFilter = user.id
      ? { id: user.id }
      : { _id: user._id };

    await User.updateOne(updateFilter, {
      password:          hashed,
      passwordChangedAt: now,
      mustChangePassword: false,  // clear legacy flag if present
      mustChangePwd:      false,  // clear legacy alias if present
      lastLogin:          now,
    });

    const _fcUserId = user.id || user._id.toString();

    // C8/MR-001 Phase 1 (ADR-0003 Decision 3/4) — dual-write the identical
    // hash to the shared credential when this user has one, then revoke
    // sessions on every OTHER device. Ordering matters: revoke BEFORE
    // building the new token payload below, and patch the local `user`
    // object's tokenVersion to match — otherwise the token this route is
    // about to issue would carry the stale pre-revocation `tv` and reject
    // itself on its very next request. (itv needs no such patch —
    // _buildTokenPayload resolves it via a fresh, cache-invalidated
    // getIdentityTokenVersion() call, not from the `user` object.)
    try {
      if (user.identityId) {
        await _model('identities').updateOne(
          { id: user.identityId },
          { $set: { passwordHash: hashed, updatedAt: now } }
        );
      }
      await revokeUserTokens(_fcUserId);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      if (user.identityId) await revokeIdentityTokens(user.identityId);
    } catch (revokeErr) {
      console.error('[auth/force-change] dual-write/revocation failed (non-fatal):', revokeErr.message);
    }

    const School = _model('schools');
    const school = await School.findOne({ id: user.schoolId }).lean();

    const _fcUserRole = user.primaryRole || user.role;

    const { sessionId: fcSessionId, absoluteExpiry: fcAbsExpiry } = await SessionService.createSession(
      _fcUserId, user.schoolId, _fcUserRole,
      req.headers['cf-connecting-ip'] || req.ip,
      req.headers['user-agent'] || '',
    );

    // Issue JWT
    const fcTokenPayload = await _buildTokenPayload(user, user.schoolId);
    const token = sign({ ...fcTokenPayload, sessionId: fcSessionId, absoluteExpiry: fcAbsExpiry });

    // Send security confirmation email (non-blocking)
    email.sendPasswordChanged({
      name:        user.name,
      email:       user.email,
      schoolName:  school?.name || req.school?.name || '',
      schoolEmail: school?.systemEmail || req.school?.systemEmail || '',
      schoolId:    user.schoolId,
    }).catch(() => {});

    const safeUser = { ...user, password: undefined, mfaOtp: undefined, mfaExpiry: undefined,
                       passwordChangedAt: now, mustChangePassword: false };
    const fcAvailableSchools = await _availableSchools(fcTokenPayload);
    _setAuthCookie(res, token, fcAbsExpiry);
    res.json({
      user: safeUser, school, absoluteExpiry: fcAbsExpiry,
      ...(fcAvailableSchools.length ? { availableSchools: fcAvailableSchools } : {}),
    });
  } catch (err) {
    console.error('[auth/force-change]', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

/* ── POST /auth/ping — lightweight keepalive for "Stay signed in" ───────────
   Called ONLY when the user clicks "Stay signed in" after 29 min of inactivity.
   Real API calls already update lastActivity via authMiddleware._touchActivity.
   Never issues a new JWT — the 8-hour token stays valid throughout.          */
router.post('/ping', authMiddleware, async (req, res) => {
  try {
    const { userId, sessionId, absoluteExpiry } = req.jwtUser;

    // Absolute session check (authMiddleware already checks, but be explicit here too)
    if (absoluteExpiry && new Date(absoluteExpiry) < new Date()) {
      return res.status(401).json({
        error: 'SESSION_ABSOLUTE_EXPIRED',
        message: 'Your session has been active for 8 hours. Please sign in again.',
      });
    }

    // Validate session status (catches admin revocation in near-real-time)
    if (sessionId) {
      const session = await SessionService.refreshSession(sessionId, userId);
      if (!session) {
        return res.status(401).json({
          error: 'SESSION_REVOKED',
          message: 'This session has been terminated. Please sign in again.',
        });
      }
    }

    return res.json({ success: true, absoluteExpiry: absoluteExpiry ?? null });
  } catch (err) {
    console.error('[auth/ping]', err);
    return res.status(500).json({ error: 'Ping failed' });
  }
});

/* ── POST /auth/logout — explicit logout ────────────────────── */
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.jwtUser;
    await SessionService.terminateCurrentSession(sessionId);
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    return res.json({ success: true }); // client clears session regardless
  }
});

/* ── GET /auth/sessions — list user's own active sessions ──── */
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId } = req.jwtUser;
    const sessions = await SessionService.listSessions(userId, schoolId);
    return res.json({ success: true, data: sessions });
  } catch (err) {
    console.error('[auth/sessions GET]', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/* ── DELETE /auth/sessions/:id — terminate a specific session ─ */
router.delete('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const { userId, schoolId } = req.jwtUser;
    const terminated = await SessionService.terminateSession(req.params.id, userId, schoolId);
    if (!terminated) return res.status(404).json({ error: 'Session not found or already terminated' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth/sessions DELETE]', err);
    return res.status(500).json({ error: 'Failed to terminate session' });
  }
});

/* ── POST /auth/sessions/revoke-all — admin revokes all sessions for a user ─ */
router.post('/sessions/revoke-all', authMiddleware, async (req, res) => {
  try {
    const { role, userId: actorId, schoolId } = req.jwtUser;
    const { userId: targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'userId required' });

    // Only admin/superadmin can revoke other users; users can revoke themselves
    if (!['admin', 'superadmin'].includes(role) && actorId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await SessionService.revokeAllUserSessions(targetUserId, schoolId, actorId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth/sessions revoke-all]', err);
    return res.status(500).json({ error: 'Failed to revoke sessions' });
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
    const User = tenantModel('users', { schoolId: school.id });
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
      const createdUser = await User.create(newUser);
      user = newUser;
      // C8/MR-001 Phase 0 (ADR-0003, Shadow) — non-blocking, self-healing,
      // same convention as onboard.js's immediate org provisioning.
      try {
        await provisionIdentityForUser(createdUser);
      } catch (err) {
        console.error('[auth/google] identity provisioning failed (will self-heal at next restart):', err.message);
      }
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

    const token = sign(await _buildTokenPayload(user, school.id));
    // Issue a short-lived exchange code — JWT never appears in the URL or logs
    const code = _issueExchangeCode(token);
    res.redirect(`${publicUrl}/login?code=${code}&school=${encodeURIComponent(school.slug)}&provider=google`);
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

    const User = tenantModel('users', { schoolId: school.id });
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
      const createdUser = await User.create(newUser);
      user = newUser;
      // C8/MR-001 Phase 0 (ADR-0003, Shadow) — non-blocking, self-healing,
      // same convention as onboard.js's immediate org provisioning.
      try {
        await provisionIdentityForUser(createdUser);
      } catch (err) {
        console.error('[auth/microsoft] identity provisioning failed (will self-heal at next restart):', err.message);
      }
    } else {
      await User.updateOne({ id: user.id }, { $set: { microsoftId: msId, lastLogin: new Date().toISOString() } });
    }

    if (!user.isActive) return res.redirect(`${publicUrl}/login?error=account_inactive`);

    const token = sign(await _buildTokenPayload(user, school.id));
    const code  = _issueExchangeCode(token);
    res.redirect(`${publicUrl}/login?code=${code}&school=${encodeURIComponent(school.slug)}&provider=microsoft`);
  } catch (err) {
    console.error('[auth/microsoft/callback]', err);
    res.redirect(`${publicUrl}/login?error=microsoft_failed`);
  }
});

/* GET /api/auth/me — verify token + return current user */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const User = tenantModel('users', tenantContext(req));
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

    const User = tenantModel('users', tenantContext(req));
    const user = await User.findOne({ id: req.jwtUser.userId, schoolId: req.jwtUser.schoolId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // C8/MR-001 Phase 3 (ADR-0003, Cutover) — same identity-fetch-and-use
    // pattern as /login, including the identityLookupAttempted tracking
    // that keeps a dangling identityId from silently falling back to
    // users.password — see the matching comment in /login above.
    const identityLookupAttempted = isIdentityCutoverEnabled() && !!user.identityId;
    let identity = null;
    if (identityLookupAttempted) {
      identity = await _model('identities').findOne({ id: user.identityId }).lean();
    }

    const match = identityLookupAttempted
      ? (identity?.passwordHash?.startsWith('$2') ? await bcrypt.compare(currentPassword, identity.passwordHash) : false)
      : (user.password?.startsWith('$2') ? await bcrypt.compare(currentPassword, user.password) : false);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ id: req.jwtUser.userId, schoolId: req.jwtUser.schoolId }, {
      password: hashed,
      passwordChangedAt: new Date().toISOString(),
      mustChangePassword: false
    });

    // C8/MR-001 Phase 1 (ADR-0003 Decision 3/4) — dual-write the identical
    // hash (never re-hash — bcrypt is salted per call) to the shared
    // credential when this user has one, then revoke sessions. Always
    // revoke this school's tokens (closes a pre-existing gap: password
    // change never revoked anything before this); also revoke the shared
    // identity's tokens across every school when identityId is set.
    try {
      if (user.identityId) {
        await _model('identities').updateOne(
          { id: user.identityId },
          { $set: { passwordHash: hashed, updatedAt: new Date().toISOString() } }
        );
      }
      await revokeUserTokens(req.jwtUser.userId);
      if (user.identityId) await revokeIdentityTokens(user.identityId);
    } catch (revokeErr) {
      console.error('[auth/change-password] dual-write/revocation failed (non-fatal):', revokeErr.message);
    }

    // Send security confirmation email (non-blocking)
    const School = _model('schools');
    const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();
    email.sendPasswordChanged({
      name:        user.name,
      email:       user.email,
      schoolName:  school?.name || '',
      schoolEmail: school?.systemEmail || '',
      schoolId:    req.jwtUser.schoolId,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/exchange
   Converts a short-lived OAuth exchange code into a full session.
   The code is single-use and expires after 30 seconds.
   Returns { token, user, school } — same shape as the login endpoint.
   ══════════════════════════════════════════════════════════════ */
const exchangeLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,  // 5 minutes
  max:             10,              // 10 attempts per IP — each OAuth login uses exactly 1
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many exchange attempts. Please try again in a few minutes.' },
  skip:            () => process.env.NODE_ENV === 'test',
});

router.post('/exchange', exchangeLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Exchange code required' });
    }

    // Single-use: delete the entry immediately regardless of outcome
    const entry = _exchangeCodes.get(code);
    _exchangeCodes.delete(code);

    if (!entry) {
      return res.status(410).json({ error: 'Exchange code not found or already used' });
    }
    if (entry.expiresAt < Date.now()) {
      return res.status(410).json({ error: 'Exchange code expired. Please sign in again.' });
    }

    // Verify the token is still cryptographically valid
    const payload = verify(entry.token);
    if (!payload) {
      return res.status(401).json({ error: 'Exchange token invalid' });
    }

    // Build the full session response — mirrors GET /api/auth/me
    // payload.schoolId comes from a cryptographically verified JWT (verify()
    // above), so it's an equally valid tenant context even without req.jwtUser.
    const User    = tenantModel('users', { schoolId: payload.schoolId });
    const Photos  = tenantModel('user_photos', { schoolId: payload.schoolId });
    const Schools = _model('schools');

    const [user, photo, school] = await Promise.all([
      User.findOne({ id: payload.userId, schoolId: payload.schoolId }).lean(),
      Photos.findOne({ userId: payload.userId, schoolId: payload.schoolId }).lean(),
      Schools.findOne({ id: payload.schoolId }).lean(),
    ]);

    if (!user || !school) {
      return res.status(404).json({ error: 'User or school not found' });
    }

    const safeUser = { ...user, password: undefined, passwordHash: undefined, mfaOtp: undefined, mfaExpiry: undefined };
    safeUser.photoUrl = photo
      ? `/api/users/${user.id}/photo?schoolId=${encodeURIComponent(payload.schoolId)}`
      : null;

    const exchangeAvailableSchools = await _availableSchools(payload);

    _setAuthCookie(res, entry.token);
    return res.json({
      user: safeUser, school,
      ...(exchangeAvailableSchools.length ? { availableSchools: exchangeAvailableSchools } : {}),
    });
  } catch (err) {
    console.error('[auth/exchange]', err);
    res.status(500).json({ error: 'Exchange failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/switch-school — C9 (D-004, Constitution §10 Stage 4)

   Switches the caller's active school context without a full
   re-login. Mints a fresh token server-side and hands back only a
   short-lived exchange code — reuses the existing OAuth exchange
   machinery (_issueExchangeCode / POST /exchange) rather than a new
   token-delivery mechanism, since the browser has one HttpOnly cookie
   per origin (not per tab — see Constitution §7's corrected text).

   Provably inert today: fails closed at the multiSchoolEnabled check
   below for every organization that hasn't explicitly opted in
   (currently all of them — see _buildTokenPayload).
   ══════════════════════════════════════════════════════════════ */
const switchSchoolLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { error: 'Too many school-switch attempts. Please try again in a few minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/switch-school', authMiddleware, switchSchoolLimiter, async (req, res) => {
  try {
    const { schoolId: targetSchoolId } = req.body;
    if (!targetSchoolId || typeof targetSchoolId !== 'string') {
      return res.status(400).json({ error: 'schoolId is required' });
    }
    if (targetSchoolId === req.jwtUser.schoolId) {
      return res.status(400).json({ error: 'Already in that school context' });
    }

    const userId = req.jwtUser.userId;

    // Every real per-school account minted since identity provisioning
    // (ADR-0003 Phase 0, unconditional, not gated by cutover) carries
    // identityId on the JWT. Its absence means this account predates
    // identity provisioning or was never backfilled — fail closed rather
    // than fall back to the userId-matching bug this replaces (see below).
    const identityId = req.jwtUser.identityId;
    if (!identityId) {
      return res.status(404).json({ error: 'You do not have access to that school.' });
    }

    // The target school's organization must have explicitly opted into
    // multi-school (Constitution §10 Stage 3) — the sole activation
    // lever for this entire endpoint.
    const Schools = _model('schools');
    const Orgs    = _model('organizations');
    const targetSchool = await Schools.findOne({ id: targetSchoolId }).lean();
    if (!targetSchool) return res.status(404).json({ error: 'School not found.' });

    const targetOrg = targetSchool.organizationId
      ? await Orgs.findOne({ id: targetSchool.organizationId }).lean()
      : null;
    if (!targetOrg?.multiSchoolEnabled) {
      return res.status(403).json({ error: 'School switching is not enabled for this organization.' });
    }

    // Same-organization boundary (Constitution §6) — never allow
    // switching across organizations, mirroring POST /memberships'
    // existing cross-org 409. Checked fresh against the DB rather than
    // trusting the caller's current token, since an older still-valid
    // token may predate this org's multiSchoolEnabled activation and
    // therefore may not carry orgId at all.
    const currentSchool = await Schools.findOne({ id: req.jwtUser.schoolId }).lean();
    if (!currentSchool || currentSchool.organizationId !== targetSchool.organizationId) {
      return res.status(409).json({ error: 'Cross-organization switching is not supported.' });
    }

    // Resolve via the shared identity-based resolver (auth.js, above),
    // not a Membership grant or a userId match — see that function's
    // comment. This was previously TargetUsers.findOne({id: userId,
    // schoolId: targetSchoolId}), which matched the CURRENT session's
    // userId against the TARGET school's users.id — but every per-school
    // account gets its own independently-generated id (confirmed across
    // every user-creation path), so that lookup could never succeed for
    // a real two-school account. Fixed here: the correct target-school
    // userId comes from the resolver's own result, never from the
    // session's current userId.
    const eligible = await _resolveIdentitySchools(identityId, targetOrg.id);
    const match    = eligible.find(s => s.schoolId === targetSchoolId);
    if (!match) {
      return res.status(404).json({ error: 'No account exists for you at that school yet.' });
    }

    // Re-fetch fresh rather than trust the resolver's snapshot verbatim —
    // catches deactivation in the gap between resolution and mint.
    const TargetUsers = tenantModel('users', { schoolId: targetSchoolId });
    const targetUser  = await TargetUsers.findOne({ id: match.userId, schoolId: targetSchoolId, isActive: { $ne: false } }).lean();
    if (!targetUser) {
      return res.status(404).json({ error: 'No account exists for you at that school yet.' });
    }

    const { sessionId, absoluteExpiry } = await SessionService.createSession(
      targetUser.id, targetSchoolId, targetUser.primaryRole || targetUser.role,
      req.headers['cf-connecting-ip'] || req.ip,
      req.headers['user-agent'] || '',
    );

    const token = sign({ ...(await _buildTokenPayload(targetUser, targetSchoolId)), sessionId, absoluteExpiry });
    const code  = _issueExchangeCode(token);

    // NOTE: AuditService.log()'s internal org/membership enrichment looks
    // up memberships.findOne({userId: actor.userId, schoolId}) — using
    // the CURRENT (source) school's userId against the TARGET schoolId,
    // which will not match a native target-school membership doc (keyed
    // on the target school's own userId). Non-fatal, enrichment-only:
    // orgId/membershipId simply stay null on this specific action's audit
    // entry. Not fixed here — using the target-school id as `actor.userId`
    // would make the stored actor identity inconsistent with actor.role/
    // actor.email (still the source session), a worse tradeoff than a
    // blank enrichment field for a non-security, display-only gap.
    AuditService.log({
      action: 'auth.school_switch',
      actor:  { userId, role: req.jwtUser.role, email: req.jwtUser.email },
      schoolId: targetSchoolId,
      target: { type: 'school', id: targetSchoolId, label: targetSchool.name },
      details: { fromSchoolId: req.jwtUser.schoolId },
      req,
    });

    res.json({ code });
  } catch (err) {
    console.error('[auth/switch-school]', err);
    res.status(500).json({ error: 'School switch failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
   Organization-first login (org-shared-slug login)

   User visits an organization's single URL, authenticates once, and
   either lands directly in their one school or picks from several —
   completing the Organization/Identity/Membership layer's intended
   behavior (PLATFORM_ARCHITECTURE_EVOLUTION_v1.md §15), not a new one.

   Two independent gates, none redundant:
     - organizations.multiSchoolEnabled — JWT orgId/membershipId + C9
       switching AND the org-slug public login surface, per-org,
       platform-admin togglable. Originally split into two separate
       flags (this one plus a since-removed orgSlugLoginEnabled) so
       enabling switching could never silently expose the public login
       endpoint too. Collapsed into one (ADR-0007 amendment) once real
       usage showed the split added an activation step without adding
       real safety: multiSchoolEnabled is already a deliberate, rare,
       platform-admin-only action, and the single-eligible-school fast
       path below means a person whose org has 2+ schools but who only
       has an account at one of them never sees a picker or learns the
       others exist — the "public surface" risk doesn't scale with org
       size, only with how many schools *that identity* can reach.
     - IDENTITY_CUTOVER_ENABLED — platform-global env var. Dual-write
       (ADR-0003 Phase 1, already shipped, unconditional) keeps
       identities.passwordHash correct regardless of this flag, so it
       is not strictly required for correctness here — requiring it
       anyway is a deliberate, near-zero-cost conservative choice: this
       new public credential-check endpoint cannot go live in any
       deployment until an operator has made the informed, platform-
       wide decision that identities are authoritative.

   Unlike switch-school (an already-authenticated user re-scoping,
   handed off via the OAuth exchange-code mechanism), org-login and
   complete-org-login are first-time credential entry — same shape as
   POST /login and POST /verify-otp, both of which mint the token and
   set the HttpOnly cookie directly in the same response. Following
   that existing, proven pattern here rather than introducing a second
   one: no exchange code anywhere in this section.
   ══════════════════════════════════════════════════════════════ */
const orgLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

/* Single-use, ~2-minute picker codes — a Map SEPARATE from
   _exchangeCodes above. Entries here are never a signed JWT, only a
   server-computed, server-locked allowlist of {schoolId, userId} pairs
   an already-password-verified identity may redeem from. Structurally
   incapable of being handed to POST /exchange (different Map, entirely
   different entry shape) — the class of bug this guards against is a
   partially-verified "identity confirmed, no school chosen yet" code
   ever being redeemable as if it were a full session. 120s TTL (a human
   clicking a picker), not the 30s used for machine-immediate OAuth/
   switch-school codes. */
const _orgPickCodes = new Map();
function _issueOrgPickCode(entry) {
  const code = crypto.randomBytes(32).toString('hex');
  _orgPickCodes.set(code, { ...entry, expiresAt: Date.now() + 120_000 });
  for (const [k, v] of _orgPickCodes) {
    if (v.expiresAt <= Date.now()) _orgPickCodes.delete(k);
  }
  return code;
}

/* POST /api/auth/org-login
   Body: { orgSlug, email, password }
   Not tenantMiddleware-gated — no school is known yet; this route
   resolves the organization itself, independently. */
router.post('/org-login', orgLoginLimiter, async (req, res) => {
  try {
    const { orgSlug, email: rawEmail, password } = req.body;
    const email = (rawEmail || '').toLowerCase().trim();
    if (!orgSlug || !email || !password) {
      return res.status(400).json({ error: 'orgSlug, email, and password are required' });
    }

    // Same not-found shape whether the slug matches nothing, matches an
    // org that hasn't opted in, or any other negative — no existence
    // leakage via response-shape difference (mirrors resolve-portal).
    const NOT_FOUND = () => res.status(404).json({ error: 'Portal not found' });

    const Org = _model('organizations');
    const org = await Org.findOne({ slug: orgSlug.toLowerCase() }).lean();
    if (!org?.multiSchoolEnabled || !isIdentityCutoverEnabled()) {
      return NOT_FOUND();
    }

    // Layer 2 lockout, reused unmodified — orgId passed in the schoolId
    // slot, which SecurityService accepts fine (_key() is just a string
    // composite, not schema-bound to a real school).
    const retryAfter = await SecurityService.checkAccountLock(org.id, email);
    if (retryAfter !== null) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Please wait before trying again.',
        retryAfter,
      });
    }

    // status:'active' excludes collision_pending identities by
    // construction — never matches this query, never a separate branch,
    // so "not found," "collision_pending," and "wrong password" all
    // produce the byte-identical response below (closes the enumeration
    // side-channel a collision_pending state would otherwise open).
    const Identities = _model('identities');
    const identity = await Identities.findOne({ orgId: org.id, email, status: 'active' }).lean();
    const match = identity?.passwordHash?.startsWith('$2')
      ? await bcrypt.compare(password, identity.passwordHash)
      : false;

    if (!match) {
      const clientIp = req.headers['cf-connecting-ip'] || req.ip;
      SecurityService.recordFail(org.id, email, clientIp, org).catch(() => {});
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    SecurityService.clearFail(org.id, email).catch(() => {});

    const eligible = await _resolveIdentitySchools(identity.id, org.id);
    if (eligible.length === 0) {
      return res.status(403).json({ error: 'No school access found for this account in this organization.' });
    }

    if (eligible.length > 1) {
      const code = _issueOrgPickCode({
        identityId: identity.id,
        orgId: org.id,
        allowedSchools: eligible,
      });
      return res.json({
        schools: eligible.map(s => ({ id: s.schoolId, name: s.name, slug: s.slug })),
        code,
      });
    }

    // Exactly one eligible school — complete the session now, identical
    // shape to the single-school POST /login below this point.
    const target = eligible[0];
    const TargetUsers = tenantModel('users', { schoolId: target.schoolId });
    const user = await TargetUsers.findOne({ id: target.userId, schoolId: target.schoolId, isActive: { $ne: false } }).lean();
    if (!user) {
      return res.status(403).json({ error: 'No school access found for this account in this organization.' });
    }

    const Schools = _model('schools');
    const school = await Schools.findOne({ id: target.schoolId }).lean();
    return await _completeOrgLoginSession(req, res, user, school, identity);
  } catch (err) {
    console.error('[auth/org-login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* POST /api/auth/complete-org-login
   Body: { code, schoolId }
   Redeems a picker code from org-login's 2+-eligible-schools branch. */
router.post('/complete-org-login', orgLoginLimiter, async (req, res) => {
  try {
    const { code, schoolId } = req.body;
    if (!code || !schoolId) {
      return res.status(400).json({ error: 'code and schoolId are required' });
    }

    const entry = _orgPickCodes.get(code);
    _orgPickCodes.delete(code); // single-use regardless of outcome

    if (!entry || entry.expiresAt <= Date.now()) {
      return res.status(400).json({ error: 'This selection has expired. Please sign in again.' });
    }

    // The hard security boundary: the server never trusts the client's
    // school choice beyond selecting from the set it already locked in
    // at org-login time. `match.userId` — never anything client-supplied
    // — is what gets used below.
    const match = entry.allowedSchools.find(s => s.schoolId === schoolId);
    if (!match) {
      return res.status(403).json({ error: 'That school is not available for this account.' });
    }

    // TOCTOU re-check: re-fetch the school fresh and confirm it still
    // belongs to the org the identity was authenticated against — closes
    // the narrow window (up to 120s) where a platform admin could
    // re-parent the school to a different organization between org-login
    // and this redemption.
    const Schools = _model('schools');
    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!school || school.organizationId !== entry.orgId) {
      return res.status(403).json({ error: 'That school is not available for this account.' });
    }

    // Re-fetch the specific user doc fresh via the userId captured at
    // mint time — never re-derived from anything client-supplied —
    // catching deactivation in the gap since org-login ran.
    const TargetUsers = tenantModel('users', { schoolId });
    const user = await TargetUsers.findOne({ id: match.userId, schoolId, isActive: { $ne: false } }).lean();
    if (!user) {
      return res.status(403).json({ error: 'That school is not available for this account.' });
    }

    const Identities = _model('identities');
    const identity = await Identities.findOne({ id: entry.identityId }).lean();

    return await _completeOrgLoginSession(req, res, user, school, identity);
  } catch (err) {
    console.error('[auth/complete-org-login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* Shared terminal step for org-login (1-eligible fast path) and
   complete-org-login (post-picker) — MFA branch mirrors POST /login's
   exactly (same MFA_ROLES set, same mfaOtp/mfaExpiry write, same
   response shape, handed off to the EXISTING, unmodified
   POST /verify-otp — no parallel OTP-verification logic here), then
   mints the token and sets the cookie directly, matching /login's and
   /verify-otp's own pattern (no exchange code — see section header). */
async function _completeOrgLoginSession(req, res, user, school, identity) {
  const userRole = user.primaryRole || user.role;
  const isDemo   = school?.slug === 'demo';
  const mfaEnabled = identity ? identity.mfaEnabled : user.mfaEnabled;

  if (!isDemo && MFA_ROLES.has(userRole) && mfaEnabled !== false) {
    const otp     = _genOTP();
    const otpHash = _hashOTP(otp);
    const expiry  = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await tenantModel('users', { schoolId: school.id }).updateOne({ _id: user._id }, { mfaOtp: otpHash, mfaExpiry: expiry });

    email.sendLoginOTP({
      name:        user.name,
      email:       user.email,
      otp,
      schoolName:  school.name || school.slug,
      schoolEmail: school.systemEmail || '',
      schoolId:    school.id,
    }).catch(err => console.error('[org-login 2FA email]', err.message));

    return res.json({
      mfaRequired: true,
      userId:      user.id || user._id.toString(),
      schoolId:    school.id,
      schoolSlug:  school.slug,
      hint:        `A 6-digit code has been sent to ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`,
    });
  }

  await tenantModel('users', { schoolId: school.id }).updateOne({ _id: user._id }, { lastLogin: new Date().toISOString() });
  AuditService.log({ action: 'auth.login', actor: { userId: user.id, role: userRole, email: user.email }, schoolId: school.id, details: { via: 'org_login' }, req });

  const { sessionId, absoluteExpiry } = await SessionService.createSession(
    user.id, school.id, userRole,
    req.headers['cf-connecting-ip'] || req.ip,
    req.headers['user-agent'] || '',
  );

  const tokenPayload = await _buildTokenPayload(user, school.id);
  const token = sign({ ...tokenPayload, sessionId, absoluteExpiry });

  const safeUser = { ...user, password: undefined };
  const allRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [userRole];
  const mergedPerms = await _loadMergedPermissions(school.id, allRoles, user.id);
  if (mergedPerms !== null) safeUser.permissions = mergedPerms;

  const availableSchools = await _availableSchools(tokenPayload);

  _checkTrialAndNotify(school).catch(() => {});
  _setAuthCookie(res, token, absoluteExpiry);
  res.json({
    user: safeUser, school, absoluteExpiry,
    ...(availableSchools.length ? { availableSchools } : {}),
  });
}

module.exports = router;
