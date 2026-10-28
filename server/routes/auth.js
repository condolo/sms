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
const { MODULE_REGISTRY } = require('../config/moduleRegistry');
const { _mergeUserOverrides } = require('../middleware/rbac');
const { issueCsrfCookie, clearCsrfCookie } = require('../utils/csrf');
const passwordTicket = require('../utils/password-ticket');
const { schoolLoginUrl } = require('../utils/school-url');

const router = express.Router();

/* ── Auth cookie helper ──────────────────────────────────
   Sets the JWT as an HttpOnly cookie so JS (and XSS) cannot
   read it. Uses SameSite=Strict to reduce CSRF exposure — NOT to fully
   block it (see utils/csrf.js: a sibling *.msingi.io subdomain is
   same-site, so SameSite=Strict alone doesn't block a forged request
   from one). issueCsrfCookie() sets the actual CSRF defense — a second,
   readable-by-JS cookie every state-changing request must also echo back
   in a header, checked in middleware/auth.js.
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
  issueCsrfCookie(res, maxAge);
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

/* ── Password tickets ─────────────────────────────────────
   See utils/password-ticket.js. A force-change ticket is minted ONLY after
   the caller has proved the password (the login route's passwordExpired
   branches), and a reset ticket only after proving control of the inbox. It
   is stored hashed on the user document and is single-use.

   This exists because POST /auth/force-change used to take a bare
   client-supplied `userId` and set that account's password with no proof of
   anything — an anonymous takeover of any account whose id could be guessed
   or obtained. */
async function _mintForceChangeTicket(user, schoolId) {
  const { token, set } = passwordTicket.issueTicket('forceChange');
  await tenantModel('users', { schoolId }).updateOne({ _id: user._id }, { $set: set });
  return token;
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
async function _buildTokenPayload(user, schoolId, schoolDoc = null) {
  const role  = user.primaryRole || user.role;
  const payload = {
    userId:   user.id || user._id.toString(),
    schoolId: schoolId,
    email:    user.email,
    role,
    roles:    user.roles || [role],
    tv:       user.tokenVersion ?? 0,  // token version — enables revocation
  };

  /* Demo tenants: mark the token so the auth middleware only pays for the
     expiry lookup on demo sessions, never on ordinary school traffic. */
  if (schoolDoc?.isDemo) {
    payload.demo = true;
    payload.demoExpiresAt = schoolDoc.expiresAt || null;
  }

  // Include guardian link only for roles that use it — keeps tokens lean for everyone else
  if (role === 'parent' || role === 'guardian') {
    payload.guardianOf = Array.isArray(user.guardianOf) ? user.guardianOf : [];
    payload.studentIds = Array.isArray(user.studentIds) ? user.studentIds : (payload.guardianOf || []);
  }
  // Include studentId for student role so portal endpoints can scope data
  if (role === 'student') {
    payload.studentId = user.studentId || null;
  }

  // extraRoles (hod / class_teacher / timetabler / exam_officer / deputy /
  // principal) and departmentId live only on the linked `teachers` record
  // (see teachers.js's TeacherUpdateSchema) — neither was ever copied onto
  // the JWT, so every server-side check gated on req.jwtUser.extraRoles
  // (teaching-assignments.js's HOD-scoped assignment management, lessons.js,
  // weekly-snapshots.js) silently evaluated as "no extra roles" for every
  // real login, regardless of what was actually set on the staff profile.
  // departmentId matters together with extraRoles, not instead of it:
  // teaching-assignments.js's HOD department-scope check is
  // `subject.departmentId !== hodDeptId` — with hodDeptId always undefined
  // (unfixed), that comparison's `&&` chain short-circuits false, meaning
  // an HOD would have been UNRESTRICTED across every department the
  // moment extraRoles alone started working, not correctly scoped to
  // their own. Both must be fixed together for HOD to mean what it says.
  // Non-fatal by the same convention as every other lookup in this
  // function — a failure here must not block login, and most users (no
  // linked teacher record) get nothing added, keeping tokens lean.
  try {
    const teacher = await tenantModel('teachers', { schoolId })
      .findOne({ schoolId, $or: [{ userId: payload.userId }, { email: user.email }] })
      .select('extraRoles departmentId').lean();
    if (Array.isArray(teacher?.extraRoles) && teacher.extraRoles.length) {
      payload.extraRoles = teacher.extraRoles;
    }
    if (teacher?.departmentId) {
      payload.departmentId = teacher.departmentId;
    }
  } catch (err) {
    console.error('[auth] _buildTokenPayload extraRoles/departmentId lookup failed (non-fatal):', err.message);
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

// extraRoles/departmentId are computed once in _buildTokenPayload and land
// on the JWT (req.jwtUser.extraRoles) — real, server-side authorization has
// always seen them correctly. But every login-family response builds its
// `user` object (the one the CLIENT stores and reads, e.g. useRole() in
// LessonsPage.jsx) from the raw `users` collection document, which never
// carries these fields at all (they live on the linked `teachers` record).
// The client-side extraRoles check was consequently always evaluating
// against an empty array — safe-direction (it can only under-show
// capability the server independently and correctly grants), but genuinely
// dead code. Call this on every safeUser right after computing a token
// payload so the two stay in sync — one place, not five copies that can
// drift.
function _attachExtraRoleFields(safeUser, tokenPayload) {
  if (tokenPayload?.extraRoles)   safeUser.extraRoles   = tokenPayload.extraRoles;
  if (tokenPayload?.departmentId) safeUser.departmentId = tokenPayload.departmentId;
  return safeUser;
}

// The avatar is not on the `users` document — it lives in `user_photos`, which
// is why the mobile app showed initials for everyone: the login/verify payload
// never carried a URL for <Image> to load. Same lookup and same URL shape the
// session-exchange route below already uses.
async function _attachPhotoUrl(safeUser, schoolId) {
  const uid = safeUser.id || safeUser._id?.toString();
  const photo = uid
    ? await tenantModel('user_photos', { schoolId })
      .findOne({ userId: uid, schoolId }).lean().catch(() => null)
    : null;
  safeUser.photoUrl = photo
    ? `/api/users/${uid}/photo?schoolId=${encodeURIComponent(schoolId)}`
    : null;
  return safeUser;
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
   the DB. Limit is generous enough for a school computer lab — or a
   ~100-person teacher training session on one venue's WiFi — logging in
   simultaneously, but blocks sustained volumetric attacks. Raised from
   100 to 300 alongside index.js's own authLimiter (the outer, MORE
   restrictive per-IP gate this route sits behind): that one was raised
   for the exact same reason, and leaving this one at 100 would have just
   made IT the new bottleneck the moment the outer limiter stopped being
   the tightest.
   Uses CF-Connecting-IP when behind Cloudflare so the real client IP
   is used rather than Cloudflare's edge node IP.               ── */
const loginIpLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            300,
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
   Body: { email | identifier, password }
   Header: X-School-Slug: demo         (or resolved from subdomain by tenant middleware)
   Returns: { token, user, school } — or, for platform: 'mobile', the same
   payload inside { success, data } with no cookie (students sign in this way).
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
      if (_isMobileClient(req)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PASSWORD_EXPIRED',
            message: 'Your administrator set a temporary password. Change it on the school website, then sign in here.',
          },
        });
      }
      return res.json({
        passwordExpired: true,
        reason: 'first_login',
        // A one-shot ticket, NOT the userId: the password was just proved, so
        // this caller may set a new one once. Nothing else may.
        ticket:   await _mintForceChangeTicket(user, req.school.id),
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
      if (_isMobileClient(req)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PASSWORD_EXPIRED',
            message: 'Your password has expired. Change it on the school website, then sign in here.',
          },
        });
      }
      return res.json({
        passwordExpired: true,
        reason: 'expired',
        // Same one-shot ticket as the first_login branch above.
        ticket:   await _mintForceChangeTicket(user, req.school.id),
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
    const isDemo     = !!req.school?.isDemo || req.school?.slug === 'demo';   // every demo tenant + the legacy shared demo slug
    // C8/MR-001 Phase 3 — mfaEnabled becomes identity-level once cutover
    // is live and this user has one (ADR-0003 Decision 4, Open Question
    // 3 — a deliberate, tested decision, not a silent behavior change).
    const mfaEnabled = identity ? identity.mfaEnabled : user.mfaEnabled;
    if (!isDemo && MFA_ROLES.has(userRole) && mfaEnabled !== false) {
      const otp      = _genOTP();
      const otpHash  = _hashOTP(otp);          // store hash, not plaintext
      const expiry   = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
      await tenantModel('users', { schoolId: req.school.id }).updateOne({ _id: user._id }, { mfaOtp: otpHash, mfaExpiry: expiry });

      /* The password is already verified by the time we get here, so there is
         no enumeration left to protect: if the code cannot be delivered, SAY
         SO. This used to be fire-and-forget, and sendLoginOTP reports a failed
         send by RETURNING FALSE, not by rejecting — so the .catch() never
         fired, nothing was logged, and the caller was told "a code has been
         sent" to an inbox that never received one. Same fix in
         _stepUpIfRequired and _completeOrgLoginSession below.
         clearFail moves above the send on purpose: the password was correct,
         so a mail failure must not leave the failed-attempt counter hot. */
      SecurityService.clearFail(req.school.id, loginId).catch(() => {});
      const sent = await email.sendLoginOTP({
        name:        user.name,
        email:       user.email,
        otp,                                   // send plaintext code, store hash
        schoolName:  req.school.name || req.school.slug,
        schoolEmail: req.school.systemEmail || '',
        schoolId:    req.school.id,
      }).catch(err => { console.error('[2FA email]', err.message); return false; });

      if (!sent) {
        console.error(`[auth/login] 2FA email to ${user.email} was NOT delivered — refusing the challenge rather than claiming it was sent.`);
        return res.status(502).json({
          success: false,
          error: {
            code:    'MFA_EMAIL_FAILED',
            message: "We could not email your verification code. Please try again, or ask your administrator to check the school's email settings.",
          },
        });
      }

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

    const tokenPayload = await _buildTokenPayload(user, req.school.id, req.school);
    const token = sign({ ...tokenPayload, sessionId, absoluteExpiry });

    // Check trial expiry and send reminder if needed
    _checkTrialAndNotify(req.school).catch(() => {});

    const safeUser = { ...user, password: undefined };
    _attachExtraRoleFields(safeUser, tokenPayload);
    await _attachPhotoUrl(safeUser, req.school.id);

    // Attach merged role permissions so the client sidebar can filter correctly.
    // Merges across all roles the user holds (union of actions per module).
    const allRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [userRole];
    const mergedPerms = await _loadMergedPermissions(req.school.id, allRoles, user.id);
    if (mergedPerms !== null) {
      safeUser.permissions = mergedPerms;
    }

    const availableSchools = await _availableSchools(tokenPayload);

    SecurityService.clearFail(req.school.id, loginId).catch(() => {});
    // The app presents platform: 'mobile' and gets the token in the body — no
    // cookies, same contract as /otp/verify (see "Mobile sign-in" below). This
    // is what lets students, who have no email on file, sign in by admission
    // number.
    if (_isMobileClient(req)) {
      return res.json({ success: true, data: { token, user: safeUser, school: req.school, absoluteExpiry } });
    }
    _setAuthCookie(res, token, absoluteExpiry);
    res.json({
      user: safeUser, school: req.school, absoluteExpiry, moduleRegistry: MODULE_REGISTRY,
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
    _attachExtraRoleFields(safeUser, otpTokenPayload);
    await _attachPhotoUrl(safeUser, user.schoolId);
    const otpAllRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [_otpUserRole];
    const otpMergedPerms = await _loadMergedPermissions(user.schoolId, otpAllRoles, user.id);
    if (otpMergedPerms !== null) safeUser.permissions = otpMergedPerms;

    const otpAvailableSchools = await _availableSchools(otpTokenPayload);

    _checkTrialAndNotify(school).catch(() => {});
    // Mobile clients (the app) get the token in the body and NO cookies — see
    // the "Mobile sign-in" section below for why that is also what keeps the
    // CSRF double-submit check out of the app's way. Web keeps the HttpOnly
    // cookie, and its JS still can never read the token.
    if (_isMobileClient(req)) {
      return res.json({ success: true, data: { token, user: safeUser, school, absoluteExpiry: otpAbsExpiry } });
    }

    _setAuthCookie(res, token, otpAbsExpiry);
    res.json({
      user: safeUser, school, absoluteExpiry: otpAbsExpiry, moduleRegistry: MODULE_REGISTRY,
      ...(otpAvailableSchools.length ? { availableSchools: otpAvailableSchools } : {}),
    });
  } catch (err) {
    console.error('[auth/verify-otp]', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
   Mobile sign-in (app only) — PLAN.md §3

   The app has three ways in:
     POST /login         → admission number + password (students)
     POST /otp/request   → a 6-digit code by email (parents, teachers)
     POST /otp/verify    → that code, exchanged for a session
     POST /mobile/google → a Firebase ID token from the device

   Students have no email on file, so the email-code path cannot serve them;
   /login answers a mobile caller with the token in the body instead of the
   web's HttpOnly cookie. Three deliberate properties:

   1. NO COOKIES, EVER. The token comes back in the response body and the app
      keeps it in the device keystore. This is also why the app never trips
      the CSRF double-submit check — utils/csrf.js passes a caller through
      that presents no csrf_token cookie, and the app presents none. That
      defence exists for cookie-authenticated browser requests; the app makes
      none.
   2. NO ACCOUNT ENUMERATION on the email-code path. Requesting a code answers
      identically whether the email exists or not, and a wrong code fails like
      an unknown email. A school's parent list is not something an
      unauthenticated caller gets to probe. (The password path necessarily
      confirms the pair matched — it is the school's own admission number, not
      a directory.)
   3. IDENTICAL CLAIMS. Sessions are built through the same
      _buildTokenPayload → sign() path as web, so tv/itv/absoluteExpiry and
      demo expiry behave the same. Revocation and demo lockout cannot drift
      between the two clients.
   ══════════════════════════════════════════════════════════════ */

const { verifyIdToken: verifyFirebaseIdToken } = require('../utils/firebase');

const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;
const LOGIN_OTP_MAX_ATTEMPTS = 5;
const LOGIN_OTP_RESEND_MS = 60 * 1000;   // silent: no second email, identical answer
const LOGIN_OTP_MAX_PER_HOUR = 5;        // silent: protects the parent's inbox
const MFA_STEP_UP_TTL_MS = 5 * 60 * 1000;

/* 150 per 15 min, NOT 20: an entire school sits behind one campus NAT IP, and
   the whole point of the app is that every parent uses it — a parents' meeting
   where 40 people request a code at once must not lock the school out. The
   real abuse bounds are per-account (5 codes/hour, 5 verify attempts) and the
   platform-wide authLimiter in index.js, exactly as on the web login. */
const mobileAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please try again shortly.' } },
});

/** The app identifies itself so web behaviour can never change by accident. */
function _isMobileClient(req) {
  return req.body?.platform === 'mobile' || req.get('x-client-platform') === 'mobile';
}

function _maskEmail(value) {
  return String(value || '').replace(/(.{2})(.*)(@.*)/, '$1***$3');
}

/**
 * Second factor for privileged roles — the decision recorded in PLAN.md §3:
 * Google and the email code are a FIRST factor only, and admin / deputy /
 * principal / finance still complete a code sent to their inbox. Reuses the
 * exact `mfaOtp` fields, `/verify-otp` endpoint and email the password flow
 * already uses, so there is one step-up mechanism rather than two.
 * Returns true when it has already answered the request.
 */
async function _stepUpIfRequired(req, res, user) {
  const role = user.primaryRole || user.role;
  const isDemo = !!req.school?.isDemo || req.school?.slug === 'demo';
  if (isDemo || !MFA_ROLES.has(role) || user.mfaEnabled === false) return false;

  const otp = _genOTP();
  await tenantModel('users', { schoolId: req.school.id }).updateOne({ _id: user._id }, { $set: {
    mfaOtp: _hashOTP(otp),
    mfaExpiry: new Date(Date.now() + MFA_STEP_UP_TTL_MS).toISOString(),
  } });

  const sent = await email.sendLoginOTP({
    name: user.name,
    email: user.email,
    otp,
    schoolName: req.school.name || req.school.slug,
    schoolEmail: req.school.systemEmail || '',
    schoolId: req.school.id,
  }).catch(err => { console.error('[2FA email]', err.message); return false; });

  /* Same reasoning as /login's own step-up: the caller reached here by proving
     a first factor, so a failed delivery is not worth hiding — and answering
     "code sent" when it was not leaves them stuck with no code and no way to
     tell why. */
  if (!sent) {
    console.error(`[2FA email] code to ${user.email} was NOT delivered — refusing the step-up.`);
    res.status(502).json({
      success: false,
      error: {
        code:    'MFA_EMAIL_FAILED',
        message: "We could not email your verification code. Please try again, or ask your administrator to check the school's email settings.",
      },
    });
    return true;
  }

  res.json({
    success: true,
    data: {
      mfaRequired: true,
      userId: user.id || user._id.toString(),
      schoolId: req.school.id,
      hint: `A 6-digit code has been sent to ${_maskEmail(user.email)}`,
    },
  });
  return true;
}

/** Issue an app session: same claims as web, no cookies, token in the body. */
async function _issueMobileSession(req, user, school, { deviceId = null, action } = {}) {
  const role = user.primaryRole || user.role;
  const userId = user.id || user._id.toString();

  const { sessionId, absoluteExpiry } = await SessionService.createSession(
    userId, school.id, role,
    req.headers['cf-connecting-ip'] || req.ip,
    req.headers['user-agent'] || '',
  );

  const tokenPayload = await _buildTokenPayload(user, school.id, school);
  const token = sign({
    ...tokenPayload,
    sessionId,
    absoluteExpiry,
    platform: 'mobile',
    ...(deviceId ? { deviceId } : {}),
  });

  await tenantModel('users', { schoolId: school.id }).updateOne(
    { _id: user._id },
    { $set: { lastLogin: new Date().toISOString() } },
  );

  AuditService.log({
    action: action || 'auth.mobile.login',
    actor: { userId, role, email: user.email },
    schoolId: school.id,
    req,
  });

  const safeUser = {
    ...user,
    password: undefined, mfaOtp: undefined, mfaExpiry: undefined,
    loginOtp: undefined, loginOtpExpiry: undefined, loginOtpAttempts: undefined, loginOtpSends: undefined,
  };
  _attachExtraRoleFields(safeUser, tokenPayload);

  return { token, user: safeUser, school, absoluteExpiry };
}

/* POST /api/auth/otp/request — email a sign-in code (app only) */
router.post('/otp/request', mobileAuthLimiter, tenantMiddleware, async (req, res) => {
  try {
    const email_ = String(req.body?.email || '').trim().toLowerCase();
    if (!email_) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email required' } });
    }

    // Property 2: the same answer in every branch below.
    const ok = { success: true, data: { sent: true, expiresInSeconds: LOGIN_OTP_TTL_MS / 1000 } };

    const User = tenantModel('users', { schoolId: req.school.id });
    const user = await User.findOne({ email: email_, schoolId: req.school.id }).lean();

    if (!user || !user.isActive) {
      AuditService.log({ action: 'auth.otp.request_unknown', actor: { userId: 'public', role: 'public', email: email_ }, schoolId: req.school.id, req });
      return res.json(ok);
    }

    const lastSent = user.loginOtpSentAt ? new Date(user.loginOtpSentAt).getTime() : 0;
    if (lastSent && Date.now() - lastSent < LOGIN_OTP_RESEND_MS) return res.json(ok);

    const recentSends = Array.isArray(user.loginOtpSends)
      ? user.loginOtpSends.filter(t => Date.now() - new Date(t).getTime() < 60 * 60 * 1000)
      : [];
    if (recentSends.length >= LOGIN_OTP_MAX_PER_HOUR) {
      console.warn(`[auth/otp] ${email_} hit the ${LOGIN_OTP_MAX_PER_HOUR}-codes-per-hour limit — not sending another.`);
      return res.json(ok);
    }

    const otp = _genOTP();
    await User.updateOne({ _id: user._id }, { $set: {
      loginOtp: _hashOTP(otp),
      loginOtpExpiry: new Date(Date.now() + LOGIN_OTP_TTL_MS).toISOString(),
      loginOtpAttempts: 0,
      loginOtpSentAt: new Date().toISOString(),
      loginOtpSends: [...recentSends, new Date().toISOString()],
    } });

    email.sendLoginOTP({
      name: user.name,
      email: user.email,
      otp,
      schoolName: req.school.name || req.school.slug,
      schoolEmail: req.school.systemEmail || '',
      schoolId: req.school.id,
      ttlMinutes: LOGIN_OTP_TTL_MS / 60000,
    }).then(sent => {
      /* The RESPONSE stays deliberately generic (Property 2 above) — an
         unknown address, the resend window, the hourly cap and a delivery
         failure must be indistinguishable to a caller. But a delivery failure
         still has to be visible SOMEWHERE, or unconfigured SMTP looks exactly
         like "no parent has a code waiting". Log only; never answer. */
      if (!sent) console.error(`[auth/otp] code for ${email_} was NOT delivered (SMTP failure or unconfigured).`);
    }).catch(err => console.error('[auth/otp] send failed:', err.message));

    AuditService.log({ action: 'auth.otp.requested', actor: { userId: user.id, role: user.primaryRole || user.role, email: email_ }, schoolId: req.school.id, req });
    return res.json(ok);
  } catch (err) {
    console.error('[auth/otp/request]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'We could not send a code right now.' } });
  }
});

/* POST /api/auth/otp/verify — exchange the code for a session (app only) */
router.post('/otp/verify', mobileAuthLimiter, tenantMiddleware, async (req, res) => {
  try {
    const email_ = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.slice(0, 64) : null;

    if (!email_ || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter the 6-digit code from your email.' } });
    }

    // One failure shape for every reason — an unknown email must be
    // indistinguishable from a wrong code.
    const invalid = { success: false, error: { code: 'INVALID_OTP', message: 'That code isn’t right, or it has expired. Ask for a new one.' } };

    const User = tenantModel('users', { schoolId: req.school.id });
    const user = await User.findOne({ email: email_, schoolId: req.school.id });
    if (!user || !user.isActive) return res.status(401).json(invalid);

    if (!user.loginOtp || !user.loginOtpExpiry) return res.status(401).json(invalid);
    if (new Date(user.loginOtpExpiry) < new Date()) {
      await User.updateOne({ _id: user._id }, { $unset: { loginOtp: 1, loginOtpExpiry: 1 } });
      return res.status(401).json(invalid);
    }
    if ((user.loginOtpAttempts ?? 0) >= LOGIN_OTP_MAX_ATTEMPTS) return res.status(401).json(invalid);

    if (!_verifyOTP(code, user.loginOtp)) {
      await User.updateOne({ _id: user._id }, { $inc: { loginOtpAttempts: 1 } });
      return res.status(401).json(invalid);
    }

    // Consume the code BEFORE anything else that can fail, so it can never be
    // replayed even if the step-up email or session creation throws.
    await User.updateOne({ _id: user._id }, { $unset: {
      loginOtp: 1, loginOtpExpiry: 1, loginOtpAttempts: 1, loginOtpSentAt: 1, loginOtpSends: 1,
    } });

    const fresh = { ...user.toObject(), loginOtp: undefined, loginOtpExpiry: undefined };

    if (await _stepUpIfRequired(req, res, fresh)) {
      AuditService.log({ action: 'auth.otp.step_up_required', actor: { userId: fresh.id, role: fresh.primaryRole || fresh.role, email: email_ }, schoolId: req.school.id, req });
      return;
    }

    const session = await _issueMobileSession(req, fresh, req.school, { deviceId, action: 'auth.otp.login' });
    return res.json({ success: true, data: session });
  } catch (err) {
    console.error('[auth/otp/verify]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'We could not verify that code.' } });
  }
});

/* POST /api/auth/mobile/google — Firebase ID token → session (app only) */
router.post('/mobile/google', mobileAuthLimiter, tenantMiddleware, async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || '');
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.slice(0, 64) : null;
    if (!idToken) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'idToken required' } });
    }

    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      if (err?.code === 'GOOGLE_NOT_CONFIGURED') {
        // Honest 503 — the app keeps its Google button disabled on this code
        // rather than pretending the tap did something.
        return res.status(503).json({ success: false, error: { code: 'GOOGLE_NOT_CONFIGURED', message: 'Google sign-in is not available yet.' } });
      }
      return res.status(401).json({ success: false, error: { code: 'GOOGLE_TOKEN_INVALID', message: 'Google sign-in could not be verified. Try again.' } });
    }

    const email_ = String(decoded?.email || '').trim().toLowerCase();
    if (!email_ || decoded.email_verified !== true) {
      return res.status(403).json({ success: false, error: { code: 'GOOGLE_EMAIL_UNVERIFIED', message: 'That Google account has no verified email address.' } });
    }

    const user = await tenantModel('users', { schoolId: req.school.id }).findOne({ email: email_, schoolId: req.school.id }).lean();

    // Decided in PLAN.md §3: refuse, don't provision. The app turns this code
    // into "ask the office" — kinder than creating an account the school never
    // agreed to, and there is no activation surface in the app until Phase 5.
    if (!user || !user.isActive) {
      AuditService.log({ action: 'auth.mobile.google_not_enrolled', actor: { userId: 'public', role: 'public', email: email_ }, schoolId: req.school.id, req, details: { googleUid: decoded.uid } });
      return res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'This email isn’t on the school’s records yet. Ask the office to add you, then try again.' } });
    }

    // Record the provider link for the audit trail, never clobbering an
    // existing mapping (one person can legitimately hold two Google accounts).
    if (!user.googleId && decoded.uid) {
      await tenantModel('users', { schoolId: req.school.id })
        .updateOne({ _id: user._id }, { $set: { googleId: decoded.uid, authProvider: user.authProvider || 'google' } })
        .catch(() => {});
    }

    if (await _stepUpIfRequired(req, res, user)) {
      AuditService.log({ action: 'auth.mobile.google.step_up_required', actor: { userId: user.id, role: user.primaryRole || user.role, email: email_ }, schoolId: req.school.id, req });
      return;
    }

    const session = await _issueMobileSession(req, user, req.school, { deviceId, action: 'auth.mobile.google' });
    return res.json({ success: true, data: session });
  } catch (err) {
    console.error('[auth/mobile/google]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'We could not sign you in with Google.' } });
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

  // Apply per-user overrides on top of role permissions.
  // 2026-09 fix — this used to be its own `{...roleResult, ...userDoc.
  // permissions}` spread, a second, independent implementation of the
  // exact merge rbac.js's _isAllowed uses for real API authorization.
  // The two drifted: rbac.js was fixed (2026-08, then again 2026-09 to
  // close the bare-coarse-key gap that broke Ann Wanjiku's admissions
  // access) but this sidebar/login-snapshot path never was — a stale
  // per-user override document could silently hide a module here while
  // the backend would still (now correctly) grant it, or vice versa.
  // Reusing rbac.js's _mergeUserOverrides directly, rather than keeping
  // a second copy in sync by hand, is the actual fix: one merge
  // implementation, not two that can quietly disagree again later.
  if (userId) {
    const userDoc = await RolePerms.findOne({ schoolId, userId }).lean();
    if (userDoc?.permissions) {
      return _mergeUserOverrides(roleResult, userDoc.permissions);
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
   No JWT required (the user is locked at the password screen), and that is
   deliberate: they have just proved the password but cannot yet hold a
   session.

   Body: { ticket, newPassword }
   The `ticket` is minted ONLY by the login route's passwordExpired branches
   (see utils/password-ticket.js) — single-use, 15 minutes, hashed at rest.
   It is the entire authorization.

   This used to take { userId, schoolId, newPassword } and look the user up by
   that id with no proof of anything, which let an anonymous caller set any
   account's password and receive a session for it. There is no id-based
   lookup left to abuse: the ticket's hash, purpose and expiry are matched by
   the database.
*/
const forceChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/force-change', forceChangeLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { ticket, newPassword } = req.body;
    if (!ticket || !newPassword) return res.status(400).json({ error: 'ticket and newPassword required' });
    if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const sid = req.school?.id;
    if (!sid) return res.status(400).json({ error: 'Could not resolve school from request' });
    const User = tenantModel('users', { schoolId: sid });

    /* The TICKET is the authorization, and the database decides it: the query
       matches on the ticket's hash, its purpose, and an unexpired window, so a
       guessed id, a replayed ticket or one minted for a different purpose
       cannot match. The ticket is minted only in the login route's
       passwordExpired branches, i.e. only after the password was verified.

       This replaced a lookup on a client-supplied `userId`, which authorized
       nothing whatsoever: an anonymous POST with a guessed id set that
       account's password and returned a session for it. */
    const user = await User.findOne({
      schoolId: sid,
      ...passwordTicket.ticketFilter(ticket, 'forceChange'),
    }).lean();
    if (!user) {
      return res.status(401).json({ error: 'This password change is no longer valid. Please sign in again.' });
    }

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
      // Single-use: the ticket dies with the password it changed.
      ...passwordTicket.clearTicketSet(),
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
    _attachExtraRoleFields(safeUser, fcTokenPayload);
    const fcAvailableSchools = await _availableSchools(fcTokenPayload);
    _setAuthCookie(res, token, fcAbsExpiry);
    res.json({
      user: safeUser, school, absoluteExpiry: fcAbsExpiry, moduleRegistry: MODULE_REGISTRY,
      ...(fcAvailableSchools.length ? { availableSchools: fcAvailableSchools } : {}),
    });
  } catch (err) {
    console.error('[auth/force-change]', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/forgot-password — email a reset link
   POST /auth/reset-password  — spend it

   The caller cannot know the current password (that is the whole point), so
   control of the inbox IS the proof. Requests answer IDENTICALLY whether or
   not the address is enrolled — the same non-enumeration rule /otp/request
   follows — and the link carries a single-use, hour-lived, hashed ticket.

   Reset deliberately does NOT hand back a session. A reset proves control of
   an inbox, not knowledge of the password; making the user sign in with the
   new one confirms it actually worked.
   ══════════════════════════════════════════════════════════════ */
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip || 'unknown',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } },
});

router.post('/forgot-password', forgotPasswordLimiter, tenantMiddleware, async (req, res) => {
  // Property 2: one answer, every branch below.
  const ok = {
    success: true,
    data: { sent: true, message: 'If that address is on this school\u2019s records, a reset link is on its way.' },
  };

  const email_ = String(req.body?.email || '').trim().toLowerCase();
  if (!email_) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email required' } });
  }

  try {
    const sid  = req.school?.id;
    const User = tenantModel('users', { schoolId: sid });
    const user = await User.findOne({ email: email_, schoolId: sid }).lean();

    if (!user || !user.isActive) {
      AuditService.log({ action: 'auth.forgot_password_unknown', actor: { userId: 'public', role: 'public', email: email_ }, schoolId: sid, req });
      return res.json(ok);
    }

    const { token, set } = passwordTicket.issueTicket('reset');
    await User.updateOne({ _id: user._id }, { $set: set });

    /* Built from the school's OWN sign-in host, never PUBLIC_URL — PUBLIC_URL
       is not provisioned in production, which is exactly what made every
       Google redirect_uri relative. See utils/school-url.js. The slug is
       carried too, so the link still resolves if a school has no subdomain. */
    const base = await schoolLoginUrl(sid);
    const resetUrl = `${base}/reset-password?ticket=${encodeURIComponent(token)}`
      + (req.school?.slug ? `&school=${encodeURIComponent(req.school.slug)}` : '');

    email.sendPasswordReset({
      name:        user.name,
      email:       user.email,
      resetUrl,
      schoolName:  req.school?.name || req.school?.slug || 'your school',
      schoolEmail: req.school?.systemEmail || '',
      schoolId:    sid,
      ttlMinutes:  passwordTicket.PURPOSES.reset.ttlMs / 60000,
    }).then(sent => {
      // The RESPONSE stays generic, but a delivery failure must be visible
      // somewhere or unconfigured SMTP looks exactly like "no such user".
      if (!sent) console.error(`[auth/forgot-password] reset link for ${email_} was NOT delivered (SMTP failure or unconfigured).`);
    }).catch(err => console.error('[auth/forgot-password] send failed:', err.message));

    AuditService.log({ action: 'auth.forgot_password_requested', actor: { userId: user.id, role: user.primaryRole || user.role, email: email_ }, schoolId: sid, req });
    return res.json(ok);
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    // Answer identically even here: an error only on the enrolled-address path
    // would itself be an existence oracle.
    return res.json(ok);
  }
});

router.post('/reset-password', forgotPasswordLimiter, tenantMiddleware, async (req, res) => {
  try {
    const { ticket, newPassword } = req.body;
    const sid = req.school?.id;
    if (!sid) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Could not resolve school from request.' } });
    }
    if (!ticket || !newPassword) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ticket and newPassword required' } });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } });
    }

    const User = tenantModel('users', { schoolId: sid });
    // The ticket's hash, purpose and expiry are matched by the database.
    const user = await User.findOne({ schoolId: sid, ...passwordTicket.ticketFilter(ticket, 'reset') }).lean();
    if (!user) {
      return res.status(401).json({ success: false, error: { code: 'RESET_LINK_INVALID', message: 'This reset link is invalid or has expired. Please request a new one.' } });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, error: { code: 'ACCOUNT_INACTIVE', message: 'This account is not active. Please contact your school office.' } });
    }

    const now    = new Date().toISOString();
    const hashed = await bcrypt.hash(newPassword, 12);
    const updateFilter = user.id ? { id: user.id } : { _id: user._id };

    await User.updateOne(updateFilter, {
      password:           hashed,
      passwordChangedAt:  now,
      mustChangePassword: false,
      mustChangePwd:      false,
      loginOtp:           null,
      loginOtpExpiry:     null,
      ...passwordTicket.clearTicketSet(),
    });

    const _rpUserId = user.id || user._id.toString();

    /* A reset is the strongest signal an account may have been compromised, so
       every existing session on every device is revoked — the same ordering
       force-change uses. Dual-write keeps the shared credential in step. */
    try {
      if (user.identityId) {
        await _model('identities').updateOne(
          { id: user.identityId },
          { $set: { passwordHash: hashed, updatedAt: now } },
        );
      }
      await revokeUserTokens(_rpUserId);
      if (user.identityId) await revokeIdentityTokens(user.identityId);
    } catch (revokeErr) {
      console.error('[auth/reset-password] dual-write/revocation failed (non-fatal):', revokeErr.message);
    }

    email.sendPasswordChanged({
      name:       user.name,
      email:      user.email,
      schoolName: req.school?.name || '',
      schoolEmail: req.school?.systemEmail || '',
      schoolId:   sid,
    }).catch(() => {});

    AuditService.log({ action: 'auth.password_reset', actor: { userId: _rpUserId, role: user.primaryRole || user.role, email: user.email }, schoolId: sid, req });

    return res.json({ success: true, data: { reset: true, message: 'Your password has been changed. You can now sign in.' } });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Could not reset the password. Please try again.' } });
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
    clearCsrfCookie(res);
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    clearCsrfCookie(res);
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

    const token = sign(await _buildTokenPayload(user, school.id, school));
    // Issue a short-lived exchange code — JWT never appears in the URL or logs.
    // Named exchangeCode (not `code`) to avoid shadowing the `code` from
    // req.query destructured at the top of this handler (line ~1303) — a
    // same-block const redeclaration would throw a TDZ ReferenceError at
    // runtime, silently routing every successful Google sign-in to
    // google_failed.
    const exchangeCode = _issueExchangeCode(token);
    res.redirect(`${publicUrl}/login?code=${exchangeCode}&school=${encodeURIComponent(school.slug)}&provider=google`);
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

    const token = sign(await _buildTokenPayload(user, school.id, school));
    // Same rename as the Google callback above — avoid shadowing the `code`
    // from `req.query` destructured at the top of this handler (TDZ bug).
    const exchangeCode = _issueExchangeCode(token);
    res.redirect(`${publicUrl}/login?code=${exchangeCode}&school=${encodeURIComponent(school.slug)}&provider=microsoft`);
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

    const safeUser = { ...user, password: undefined };
    _attachExtraRoleFields(safeUser, req.jwtUser); // already-verified JWT — same values _buildTokenPayload put there at login, no extra DB round trip needed
    res.json({ user: safeUser, school });
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
    _attachExtraRoleFields(safeUser, payload);
    safeUser.photoUrl = photo
      ? `/api/users/${user.id}/photo?schoolId=${encodeURIComponent(payload.schoolId)}`
      : null;

    const exchangeAvailableSchools = await _availableSchools(payload);

    _setAuthCookie(res, entry.token);
    return res.json({
      user: safeUser, school, moduleRegistry: MODULE_REGISTRY,
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
    // PLAT-01 remediation — an impersonated session is locked to the one
    // school it was granted for. This route mints a completely fresh
    // token (line ~1399 below) via the same _buildTokenPayload() call
    // impersonation itself uses — which means it would NOT carry forward
    // impersonated/impersonationId/sessionId, silently dropping the PLAT-03
    // attribution on the very next action taken. Preserving that context
    // through this path would mean duplicating the impersonation-session
    // machinery here too — more surface area for the exact "another route
    // added later, forgot to check" drift this whole remediation exists to
    // close. Blocking outright is the one-line, unambiguous alternative:
    // a legitimate reason to look at a second school is a new, separately
    // authorized, separately reasoned, separately audited impersonation
    // grant for THAT school — never a silent hop from one to another.
    // Inert for a genuinely dormant feature today (switch-school itself
    // fails closed below for every org that hasn't opted into
    // multiSchoolEnabled — currently none have), but cheap to close now
    // rather than the moment that changes.
    if (req.jwtUser.impersonated) {
      return res.status(403).json({ error: 'An impersonated session cannot switch schools. Start a new impersonation session for the other school instead.' });
    }

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
    const exchangeCode = _issueExchangeCode(token);

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

    res.json({ code: exchangeCode });
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

   One gate: organizations.multiSchoolEnabled — JWT orgId/membershipId +
   C9 switching AND the org-slug public login surface (both the page
   AND the credential check below), per-org, platform-admin togglable.
   Originally split into two separate flags (this one plus a
   since-removed orgSlugLoginEnabled) so enabling switching could never
   silently expose the public login endpoint too. Collapsed into one
   (ADR-0007 amendment) once real usage showed the split added an
   activation step without adding real safety: multiSchoolEnabled is
   already a deliberate, rare, platform-admin-only action, and the
   single-eligible-school fast path below means a person whose org has
   2+ schools but who only has an account at one of them never sees a
   picker or learns the others exist — the "public surface" risk
   doesn't scale with org size, only with how many schools *that
   identity* can reach.

   2026-07-21 correction: this route ALSO required the platform-global
   IDENTITY_CUTOVER_ENABLED env var, on top of multiSchoolEnabled — an
   asymmetry with GET /api/public/resolve-portal (which only ever
   checked multiSchoolEnabled). That meant an org whose admin had
   turned multiSchoolEnabled on got a fully-rendered, branded org-login
   PAGE (resolve-portal succeeded) that could never actually complete a
   sign-in (this route 404'd "Portal not found" on every attempt,
   indistinguishable from a wrong password) until a platform operator
   separately flipped a global env var most schools have no way to know
   exists — confirmed live, blocking a real customer. Dual-write
   (ADR-0003 Phase 1, unconditional, already shipped) keeps
   identities.passwordHash correct regardless of cutover, so the extra
   gate was never protecting correctness here — it was a deliberately
   conservative circuit breaker on a *different* thing (whether
   single-school POST /login trusts identities over users.password),
   applied to this route too "just in case," with no actual dependency
   requiring it. Removed. This route now gates on multiSchoolEnabled
   only, matching resolve-portal exactly — see ADR-0007 correction 7.

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
    // leakage via response-shape difference (mirrors resolve-portal,
    // including now echoing the caller's own slug in the message, same
    // as resolve-portal's `Portal '${slug}' not found` — safe, since
    // it's only echoing input the caller already supplied).
    const NOT_FOUND = () => res.status(404).json({ error: `Portal '${orgSlug}' not found` });

    const Org = _model('organizations');
    const org = await Org.findOne({ slug: orgSlug.toLowerCase() }).lean();
    if (!org?.multiSchoolEnabled) {
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
  const isDemo   = !!school?.isDemo || school?.slug === 'demo';   // every demo tenant + the legacy shared demo slug
  const mfaEnabled = identity ? identity.mfaEnabled : user.mfaEnabled;

  if (!isDemo && MFA_ROLES.has(userRole) && mfaEnabled !== false) {
    const otp     = _genOTP();
    const otpHash = _hashOTP(otp);
    const expiry  = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await tenantModel('users', { schoolId: school.id }).updateOne({ _id: user._id }, { mfaOtp: otpHash, mfaExpiry: expiry });

    const sent = await email.sendLoginOTP({
      name:        user.name,
      email:       user.email,
      otp,
      schoolName:  school.name || school.slug,
      schoolEmail: school.systemEmail || '',
      schoolId:    school.id,
    }).catch(err => { console.error('[org-login 2FA email]', err.message); return false; });

    if (!sent) {
      console.error(`[org-login 2FA email] code to ${user.email} was NOT delivered — refusing the challenge.`);
      return res.status(502).json({
        success: false,
        error: {
          code:    'MFA_EMAIL_FAILED',
          message: "We could not email your verification code. Please try again, or ask your administrator to check the school's email settings.",
        },
      });
    }

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

  const tokenPayload = await _buildTokenPayload(user, school.id, school);
  const token = sign({ ...tokenPayload, sessionId, absoluteExpiry });

  const safeUser = { ...user, password: undefined };
  _attachExtraRoleFields(safeUser, tokenPayload);
  const allRoles = Array.isArray(user.roles) && user.roles.length ? user.roles : [userRole];
  const mergedPerms = await _loadMergedPermissions(school.id, allRoles, user.id);
  if (mergedPerms !== null) safeUser.permissions = mergedPerms;

  const availableSchools = await _availableSchools(tokenPayload);

  _checkTrialAndNotify(school).catch(() => {});
  _setAuthCookie(res, token, absoluteExpiry);
  res.json({
    user: safeUser, school, absoluteExpiry, moduleRegistry: MODULE_REGISTRY,
    ...(availableSchools.length ? { availableSchools } : {}),
  });
}

// Exposed for platform.js's impersonate route so an impersonated session
// gets an identically-shaped JWT (orgId/membershipId/identityId/itv) and
// availableSchools list to a real login — same lightweight in-process reuse
// convention as qa-health.js's _identityMigrationStatus (no HTTP round trip,
// same server, lazily required to avoid loading auth.js's dependency graph
// into every module that merely requires platform.js).
router._buildTokenPayload    = _buildTokenPayload;
router._availableSchools     = _availableSchools;
router._loadMergedPermissions = _loadMergedPermissions; // test-only access, same pattern as the two exports above

/* Child linking (parent-portal POST /link/confirm) re-issues a session after
   it grants access to a new child: the child lists are baked into the token at
   sign-in, so without a fresh token the parent would be linked on the server
   and still refused by every child endpoint until they signed out and back in.
   Exported rather than duplicated so there is ONE place that decides what a
   mobile session contains. */
router._issueMobileSession = _issueMobileSession;

module.exports = router;
