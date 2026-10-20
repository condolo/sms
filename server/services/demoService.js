/* ============================================================
   Demo tenant lifecycle service.

   request → OTP verify → provision (clone template) → active N days
           → lifecycle notices → expiry → 30-day freeze → purge

   The tenant itself is a normal `schools` document flagged `isDemo`, so
   converting to paid is just clearing the flag (no data migration).
   ============================================================ */
'use strict';

const crypto    = require('crypto');
const mongoose  = require('mongoose');
const bcrypt    = require('bcryptjs');

const { _model }        = require('../utils/model');
const AuditService      = require('../services/audit');
const email             = require('../utils/email');
const demo              = require('../utils/demo');

const OTP_TTL_MS        = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS  = 5;
const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PER_IP        = 3;
const MAX_PER_EMAIL     = 1;

/* Platform/operational collections that must never be copied into a demo
   tenant. Everything else is cloned when its documents carry the template's
   schoolId — that is what makes new demo tenants look exactly like the
   sales demo without a second seed script to drift. */
const CLONE_DENY = new Set([
  'schools', 'organizations', 'platform_operators', 'platform_settings',
  'landing_content', 'system_announcements', 'release_certificates',
  'app_migrations', 'queue_jobs', 'audit_logs', 'security_events',
  'login_failures', 'sessions', 'identities', 'memberships',
  'backup_logs', 'billing_snapshots', 'notification_digests', 'notifications',
  'messages', 'elearning_tokens', 'mpesa_transactions', 'mark_audit_log',
  'report_card_counters', 'demo_requests', 'tickets', 'user_photos',
  'staff_documents',
]);

function _hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function _randomOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function _verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // dev/test
  if (!token) return false;
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (ip) params.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const json = await res.json();
    return !!json.success;
  } catch (err) {
    console.error('[demo] Turnstile verify failed:', err.message);
    return false;
  }
}

/* ── Request ─────────────────────────────────────────────────── */
async function createRequest({ name, schoolName, role, email: emailAddr, phone, schoolSize, turnstileToken, ip, userAgent }) {
  const email_ = String(emailAddr || '').trim().toLowerCase();
  const Requests = _model('demo_requests');
  const now = new Date();

  const ipCount = await Requests.countDocuments({ ip, createdAt: { $gte: new Date(Date.now() - REQUEST_WINDOW_MS) } });
  if (ipCount >= MAX_PER_IP) {
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many demo requests from this network today. Try again tomorrow or contact sales.' };
  }
  const recent = await Requests.findOne({ email: email_, createdAt: { $gte: new Date(Date.now() - REQUEST_WINDOW_MS) } }).lean();
  if (recent) {
    return { ok: false, code: 'ALREADY_REQUESTED', message: 'A demo was already requested with this email in the last 24 hours. Check your inbox, or use the latest email to verify.' };
  }

  const captchaOk = await _verifyTurnstile(turnstileToken, ip);
  if (!captchaOk) {
    return { ok: false, code: 'CAPTCHA_FAILED', message: 'Captcha verification failed — please try again.' };
  }

  const id = `dr_${crypto.randomUUID()}`;
  const code = _randomOtp();
  const doc = {
    id,
    name: String(name || '').trim().slice(0, 120),
    schoolName: String(schoolName || '').trim().slice(0, 160),
    role: String(role || '').trim().slice(0, 80),
    email: email_,
    phone: String(phone || '').trim().slice(0, 40),
    schoolSize: String(schoolSize || '').trim().slice(0, 40),
    status: 'pending_otp',
    ip,
    userAgent: String(userAgent || '').slice(0, 300),
    otpHash: _hashOtp(code),
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    otpAttempts: 0,
    otpSentAt: now,
    autoApprove: process.env.DEMO_REQUIRE_REVIEW !== 'true',
    createdAt: now,
    updatedAt: now,
  };
  await Requests.create(doc);

  await email.sendDemoOtp({ to: email_, name: doc.name, code, schoolName: doc.schoolName }).catch(() => {});
  AuditService.log({
    action: 'demo.request.created',
    actor: { userId: 'public', role: 'public', email: email_ },
    schoolId: null,
    target: { type: 'demo_request', id, label: doc.schoolName },
    details: { ip, autoApprove: doc.autoApprove },
  });

  return { ok: true, data: { id, email: email_, expiresInSeconds: OTP_TTL_MS / 1000 } };
}

async function resendOtp({ id, email: emailAddr }) {
  const Requests = _model('demo_requests');
  const email_ = String(emailAddr || '').trim().toLowerCase();
  const req = await Requests.findOne({ id, email: email_ }).lean();
  if (!req) return { ok: false, code: 'NOT_FOUND', message: 'Request not found.' };
  if (req.status !== 'pending_otp') return { ok: false, code: 'ALREADY_VERIFIED', message: 'This request is already verified.' };
  if (req.otpSentAt && Date.now() - new Date(req.otpSentAt).getTime() < 60_000) {
    return { ok: false, code: 'TOO_SOON', message: 'Please wait a minute before requesting another code.' };
  }
  const code = _randomOtp();
  await Requests.updateOne({ id }, { $set: {
    otpHash: _hashOtp(code), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    otpAttempts: 0, otpSentAt: new Date(), updatedAt: new Date(),
  } });
  await email.sendDemoOtp({ to: email_, name: req.name, code, schoolName: req.schoolName }).catch(() => {});
  return { ok: true, data: { id, email: email_, expiresInSeconds: OTP_TTL_MS / 1000 } };
}

/* ── Verify OTP → provision ──────────────────────────────────── */
async function verifyOtp({ id, email: emailAddr, code }) {
  const Requests = _model('demo_requests');
  const email_ = String(emailAddr || '').trim().toLowerCase();
  const req = await Requests.findOne({ id, email: email_ }).lean();
  if (!req) return { ok: false, code: 'NOT_FOUND', message: 'Request not found.' };
  if (req.status === 'provisioned') return { ok: true, data: { status: 'provisioned', loginUrl: demo.loginUrlFor(req.tenantSlug) } };
  if (req.status === 'provisioning') return { ok: false, code: 'IN_PROGRESS', message: 'Your workspace is being created — this takes a few seconds. Check your email for the logins shortly.' };
  if (req.status === 'pending_review') return { ok: true, data: { status: 'pending_review' } };
  if (req.status === 'rejected') return { ok: false, code: 'REJECTED', message: 'This request was not approved.' };

  if (!req.otpHash || !req.otpExpiresAt) return { ok: false, code: 'NO_OTP', message: 'Request a new code.' };
  if (new Date(req.otpExpiresAt) < new Date()) return { ok: false, code: 'OTP_EXPIRED', message: 'That code has expired — request a new one.' };
  if (req.otpAttempts >= OTP_MAX_ATTEMPTS) return { ok: false, code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts — request a new code.' };

  if (_hashOtp(code) !== req.otpHash) {
    await Requests.updateOne({ id }, { $inc: { otpAttempts: 1 }, $set: { updatedAt: new Date() } });
    return { ok: false, code: 'INVALID_OTP', message: 'That code is not correct.' };
  }

  await Requests.updateOne({ id }, { $set: {
    status: req.autoApprove ? 'verified' : 'pending_review',
    verifiedAt: new Date(),
    otpHash: null, otpExpiresAt: null,
    updatedAt: new Date(),
  } });

  AuditService.log({
    action: 'demo.request.verified',
    actor: { userId: 'public', role: 'public', email: email_ },
    schoolId: null,
    target: { type: 'demo_request', id, label: req.schoolName },
    details: { autoApprove: req.autoApprove },
  });

  if (!req.autoApprove) {
    await _createDemoTicket(req, 'waiting').catch(() => {});
    return { ok: true, data: { status: 'pending_review' } };
  }

  const provisioned = await provisionDemo(id).catch(async (err) => {
    console.error('[demo] provisioning failed:', err.message);
    await Requests.updateOne({ id }, { $set: { status: 'failed', failureReason: String(err.message || 'provision_failed').slice(0, 300), updatedAt: new Date() } }).catch(() => {});
    return { ok: false, code: 'PROVISION_FAILED', message: 'We could not set up your demo automatically. Our team has been notified.' };
  });
  return provisioned;
}

/* ── Provision ───────────────────────────────────────────────── */
/* Two guards, because they cover different failures:

   1. This in-process set stops a double-click on "verify" from starting a
      second build in the SAME process without paying for a DB round trip.
   2. The atomic claim in provisionDemo() below is the real one: it stops a
      second WORKER (or a restart mid-build, which loses this set entirely)
      from building a second tenant for the same request.

   What matters is not the lock itself but that only one builder ever gets
   past it: every insert below happens after the claim and before the
   request is marked provisioned, so a duplicate build would leave a
   school nobody asked for, with its own cloned data. */
const _provisioning = new Set();

/* A claim older than this is treated as abandoned (the process that took it
   died mid-build) and may be re-claimed. Long enough that a slow clone of a
   large template is never mistaken for a crash. */
const PROVISION_STALE_MS = 10 * 60 * 1000;

async function provisionDemo(requestId) {
  if (_provisioning.has(requestId)) {
    return { ok: false, code: 'IN_PROGRESS', message: 'Your workspace is being created — try again in a few seconds.' };
  }
  _provisioning.add(requestId);
  try {
    const Requests = _model('demo_requests');

    /* Atomic claim: findOneAndUpdate on one document, so concurrent builders
       cannot both match. Only a verified request (or an expired claim) can be
       taken; everything else is either in flight, already done, or not a
       state this function may act on. */
    const claimed = await Requests.findOneAndUpdate(
      {
        id: requestId,
        $or: [
          { status: 'verified' },
          { status: 'provisioning', provisioningStartedAt: { $lt: new Date(Date.now() - PROVISION_STALE_MS) } },
        ],
      },
      { $set: { status: 'provisioning', provisioningStartedAt: new Date(), updatedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      /* Report the real state rather than a generic failure: "already yours"
         and "someone is building it" both retry successfully and must not
         look like errors the user should give up on. */
      const current = await Requests.findOne({ id: requestId }).lean();
      if (!current) return { ok: false, code: 'NOT_FOUND', message: 'Request not found.' };
      if (current.status === 'provisioned') {
        return { ok: true, data: { status: 'provisioned', loginUrl: demo.loginUrlFor(current.tenantSlug) } };
      }
      if (current.status === 'provisioning') {
        return { ok: false, code: 'IN_PROGRESS', message: 'Your workspace is being created — try again in a few seconds.' };
      }
      return { ok: false, code: 'NOT_PROVISIONABLE', message: 'This demo request can no longer be set up automatically. Our team has been notified.' };
    }

    try {
      return await _provisionDemo(requestId);
    } catch (err) {
      /* A thrown build must not leave the claim standing: without this the
         request sits in 'provisioning' until the staleness window expires,
         and an operator retry would look like a no-op. verifyOtp's own
         catch still turns this into the user-facing "could not set up"
         message — this only makes the record retryable. */
      await Requests.updateOne({ id: requestId }, { $set: {
        status: 'failed',
        failureReason: String(err?.message || 'provision_failed').slice(0, 300),
        updatedAt: new Date(),
      } }).catch(() => {});
      throw err;
    }
  } finally {
    _provisioning.delete(requestId);
  }
}

async function _provisionDemo(requestId) {
  const Requests = _model('demo_requests');
  const req = await Requests.findOne({ id: requestId }).lean();
  if (!req) return { ok: false, code: 'NOT_FOUND', message: 'Request not found.' };
  if (req.status === 'provisioned') {
    return { ok: true, data: { status: 'provisioned', loginUrl: demo.loginUrlFor(req.tenantSlug) } };
  }

  const db = mongoose.connection.db;

  /* Another worker may have finished between the status read and here. */
  const already = await db.collection('schools').findOne({ demoRequestId: req.id });
  if (already) {
    await Requests.updateOne({ id: requestId }, { $set: { status: 'provisioned', tenantId: already.id, tenantSlug: already.slug, updatedAt: new Date() } });
    return { ok: true, data: { status: 'provisioned', loginUrl: demo.loginUrlFor(already.slug) } };
  }

  const templateId = demo.TEMPLATE_SCHOOL_ID;
  const template = await db.collection('schools').findOne({ id: templateId });
  if (!template) {
    console.error(`[demo] Template school "${templateId}" not found — cannot provision.`);
    await Requests.updateOne({ id: requestId }, { $set: { status: 'failed', failureReason: 'template_missing', updatedAt: new Date() } });
    return { ok: false, code: 'TEMPLATE_MISSING', message: 'Demo provisioning is not configured on this server.' };
  }

  const short = demo.shortId(6);
  const schoolId = `sch_demo_${short}`;
  const slug = demo.makeDemoSlug(req.schoolName);
  const password = demo.generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const expiresAt = demo.addDays(now, demo.TRIAL_DAYS);

  /* 1. Copy every tenant-owned collection, remapping ids so references
        (classId/studentId/teacherId/…) stay internally consistent. */
  const idMap = new Map([[templateId, schoolId]]);
  const collections = await db.listCollections().toArray();
  const snapshot = []; // [{ name, docs }]

  for (const c of collections) {
    if (CLONE_DENY.has(c.name) || c.name.startsWith('system.')) continue;
    let docs;
    try {
      docs = await db.collection(c.name).find({ schoolId: templateId }).toArray();
    } catch {
      continue; // collection without schoolId shape — not tenant data
    }
    if (!docs.length) continue;
    for (const d of docs) if (d.id) idMap.set(d.id, `${short}_${d.id}`);
    snapshot.push({ name: c.name, docs });
  }

  const remap = (value) => {
    if (typeof value === 'string') return idMap.get(value) || value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = remap(v);
      return out;
    }
    return value;
  };

  for (const { name, docs } of snapshot) {
    const prepared = docs.map((d) => {
      const copy = remap(d);
      delete copy._id;
      delete copy.__v;
      return copy;
    });
    await db.collection(name).insertMany(prepared, { ordered: false }).catch((err) => {
      console.error(`[demo] clone ${name} partially failed:`, err.message);
    });
  }

  /* 2. School + organization documents. */
  const organizationId = `org_${crypto.randomUUID()}`;
  const school = {
    id: schoolId,
    slug,
    name: req.schoolName,
    shortName: req.schoolName.slice(0, 24),
    type: template.type || 'private',
    country: template.country || 'Kenya',
    city: template.city || '',
    currency: template.currency || 'KES',
    currencySymbol: template.currencySymbol || 'KSh',
    timezone: template.timezone || 'Africa/Nairobi',
    curriculum: template.curriculum || [],
    sections: template.sections || ['primary'],
    primaryColor: template.primaryColor || '#4f46e5',
    accentColor: template.accentColor || '#7c3aed',
    plan: template.plan || 'family',
    addOns: [],
    adminName: req.name,
    adminEmail: req.email,
    organizationId,
    isActive: true,
    status: 'active',
    isDemo: true,
    demoRequestId: req.id,
    demoExpiresAt: expiresAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    demoExtensionCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.collection('schools').insertOne(school);

  await db.collection('organizations').insertOne({
    id: organizationId,
    name: req.schoolName,
    slug,
    status: 'active',
    multiSchoolEnabled: false,
    provisionedFromSchoolId: schoolId,
    createdBy: 'system:demo-provision',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  /* 3. Role logins: keep the cloned user docs (so teacherId/studentId links
        stay valid) but replace identity + credentials on the six roles. */
  const Users = db.collection('users');
  const clonedUsers = await Users.find({ schoolId }).toArray();
  const byRole = {};
  for (const u of clonedUsers) byRole[u.role || u.primaryRole] = u;

  const firstStudent = await db.collection('students').findOne({ schoolId }, { sort: { admissionNumber: 1 } });

  for (const roleDef of demo.DEMO_ROLE_LOGINS) {
    const user = byRole[roleDef.role];
    if (!user) continue;
    const patch = {
      name: `${roleDef.label} (Demo)`,
      password: passwordHash,
      role: roleDef.role,
      primaryRole: roleDef.role,
      roles: [roleDef.role],
      username: roleDef.username,
      email: roleDef.role === 'admin' ? req.email : null,
      isActive: true,
      mustChangePassword: false,
      passwordChangedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (roleDef.role === 'student' && firstStudent) patch.studentId = firstStudent.id;
    if (roleDef.role === 'parent' && firstStudent) {
      patch.studentIds = [firstStudent.id];
      patch.guardianOf = [firstStudent.id];
    }
    await Users.updateOne({ _id: user._id }, { $set: patch });
  }

  await Requests.updateOne({ id: req.id }, { $set: {
    status: 'provisioned',
    tenantId: schoolId,
    tenantSlug: slug,
    provisionedAt: now,
    expiresAt,
    updatedAt: now,
  } });

  await _createDemoTicket({ ...req, tenantId: schoolId, tenantSlug: slug }, 'resolved').catch(() => {});

  await email.sendDemoCredentials({
    to: req.email,
    name: req.name,
    schoolName: req.schoolName,
    slug,
    password,
    expiresAt,
    trialDays: demo.TRIAL_DAYS,
  }).catch(() => {});

  AuditService.log({
    action: 'demo.request.provisioned',
    actor: { userId: 'system', role: 'system', email: null },
    schoolId,
    target: { type: 'demo_request', id: req.id, label: req.schoolName },
    details: { slug, expiresAt: expiresAt.toISOString(), trialDays: demo.TRIAL_DAYS },
  });
  demo.invalidateDemoCache(schoolId);

  return { ok: true, data: { status: 'provisioned', loginUrl: demo.loginUrlFor(slug), slug, expiresAt } };
}

/* ── Approval / rejection / extension ────────────────────────── */
async function approveRequest(requestId, actor) {
  const Requests = _model('demo_requests');
  const req = await Requests.findOne({ id: requestId }).lean();
  if (!req) return { ok: false, code: 'NOT_FOUND', message: 'Request not found.' };
  if (req.status === 'provisioned') return { ok: true, data: { status: 'provisioned' } };
  /* Record who approved it, but never reset an in-flight or finished build:
     handing a live claim back to 'verified' would release it for a second
     builder. A request that is mid-build answers IN_PROGRESS below, which is
     the truth — it IS being set up. */
  await Requests.updateOne({ id: requestId }, { $set: { approvedAt: new Date(), approvedBy: actor?.email || 'platform', updatedAt: new Date() } });
  await Requests.updateOne({ id: requestId, status: { $nin: ['provisioning', 'provisioned'] } }, { $set: { status: 'verified' } });
  AuditService.log({
    action: 'demo.request.approved',
    actor: actor || { userId: 'platform', role: 'platform', email: null },
    schoolId: null,
    target: { type: 'demo_request', id: requestId, label: req.schoolName },
  });
  return provisionDemo(requestId);
}

async function rejectRequest(requestId, reason, actor) {
  const Requests = _model('demo_requests');
  const req = await Requests.findOne({ id: requestId }).lean();
  if (!req) return { ok: false, code: 'NOT_FOUND', message: 'Request not found.' };
  await Requests.updateOne({ id: requestId }, { $set: {
    status: 'rejected', rejectedAt: new Date(), rejectionReason: String(reason || '').slice(0, 500), updatedAt: new Date(),
  } });
  AuditService.log({
    action: 'demo.request.rejected',
    actor: actor || { userId: 'platform', role: 'platform', email: null },
    schoolId: null,
    target: { type: 'demo_request', id: requestId, label: req.schoolName },
    details: { reason: String(reason || '').slice(0, 200) },
  });
  await email.sendDemoRejected({ to: req.email, name: req.name, schoolName: req.schoolName, reason }).catch(() => {});
  return { ok: true, data: { status: 'rejected' } };
}

async function extendDemo(schoolId, days = demo.EXTENSION_DAYS, actor) {
  const Schools = _model('schools');
  const school = await Schools.findOne({ id: schoolId }).lean();
  if (!school) return { ok: false, code: 'NOT_FOUND', message: 'School not found.' };
  if (!school.isDemo) return { ok: false, code: 'NOT_DEMO', message: 'Not a demo tenant.' };
  const used = school.demoExtensionCount || 0;
  if (used >= demo.MAX_EXTENSIONS) return { ok: false, code: 'MAX_EXTENSIONS', message: `Extension limit reached (${demo.MAX_EXTENSIONS}).` };

  const base = school.expiresAt && new Date(school.expiresAt) > new Date() ? new Date(school.expiresAt) : new Date();
  const newExpiry = demo.addDays(base, days);
  await Schools.updateOne({ id: schoolId }, { $set: {
    expiresAt: newExpiry.toISOString(),
    demoExpiresAt: newExpiry.toISOString(),
    demoExtensionCount: used + 1,
    demoExpired: false,
    updatedAt: new Date().toISOString(),
  } });
  demo.invalidateDemoCache(schoolId);

  const Requests = _model('demo_requests');
  const req = await Requests.findOne({ tenantId: schoolId }).lean();
  if (req) {
    /* Keep the request record's expiry in step with the tenant: the
       platform console's Demo Requests list renders request.expiresAt, so
       without this an extended demo kept showing its original end date
       even though the tenant (and the confirmation email) had moved on. */
    await Requests.updateOne(
      { tenantId: schoolId },
      { $set: { expiresAt: newExpiry, updatedAt: new Date().toISOString() } }
    );
    await email.sendDemoExtended({ to: req.email, name: req.name, schoolName: school.name, expiresAt: newExpiry }).catch(() => {});
  }
  AuditService.log({
    action: 'demo.tenant.extended',
    actor: actor || { userId: 'platform', role: 'platform', email: null },
    schoolId,
    target: { type: 'school', id: schoolId, label: school.name },
    details: { days, newExpiresAt: newExpiry.toISOString(), extensionsUsed: used + 1 },
  });
  return { ok: true, data: { expiresAt: newExpiry } };
}

/* ── Expiry & purge ──────────────────────────────────────────── */
async function expireDemo(schoolId) {
  const Schools = _model('schools');
  const school = await Schools.findOne({ id: schoolId }).lean();
  if (!school || !school.isDemo || school.demoExpired) return false;
  await Schools.updateOne({ id: schoolId }, { $set: { demoExpired: true, demoExpiredAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  demo.invalidateDemoCache(schoolId);
  const req = await _model('demo_requests').findOne({ tenantId: schoolId }).lean();
  if (req) await email.sendDemoExpired({ to: req.email, name: req.name, schoolName: school.name }).catch(() => {});
  AuditService.log({
    action: 'demo.tenant.expired',
    actor: { userId: 'system', role: 'system', email: null },
    schoolId,
    target: { type: 'school', id: schoolId, label: school.name },
  });
  return true;
}

async function purgeDemo(schoolId) {
  const db = mongoose.connection.db;
  const Schools = _model('schools');
  const school = await Schools.findOne({ id: schoolId }).lean();
  if (!school || !school.isDemo) return false;
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    if (c.name.startsWith('system.')) continue;
    await db.collection(c.name).deleteMany({ schoolId }).catch(() => {});
  }
  await db.collection('schools').deleteOne({ id: schoolId });
  if (school.organizationId) await db.collection('organizations').deleteOne({ id: school.organizationId }).catch(() => {});
  await _model('demo_requests').updateOne({ tenantId: schoolId }, { $set: { status: 'purged', purgedAt: new Date(), updatedAt: new Date() } });
  demo.invalidateDemoCache(schoolId);
  AuditService.log({
    action: 'demo.tenant.purged',
    actor: { userId: 'system', role: 'system', email: null },
    schoolId: null,
    target: { type: 'school', id: schoolId, label: school.name },
  });
  return true;
}

/* ── Hourly sweep ────────────────────────────────────────────── */
async function sweep() {
  const Schools = _model('schools');
  const Requests = _model('demo_requests');
  const now = Date.now();
  const demos = await Schools.find({ isDemo: true }).lean();
  const stats = { warned: 0, expired: 0, purged: 0 };

  for (const school of demos) {
    const req = await Requests.findOne({ tenantId: school.id }).lean();
    const expiry = school.expiresAt ? new Date(school.expiresAt).getTime() : null;
    if (!expiry) continue;
    const days = Math.ceil((expiry - now) / 86400000);
    const notices = school.demoNotices || {};

    if (!school.demoExpired && days <= 0) {
      if (await expireDemo(school.id)) stats.expired += 1;
      continue;
    }
    if (school.demoExpired) {
      if (demo.isPurgeDue(school)) {
        if (await purgeDemo(school.id)) stats.purged += 1;
      }
      continue;
    }
    if (!req) continue;

    const send = async (key, kind, extra = {}) => {
      if (notices[key]) return;
      await email.sendDemoLifecycle({
        to: req.email, name: req.name, schoolName: school.name,
        kind, daysLeft: Math.max(0, days), loginUrl: demo.loginUrlFor(school.slug), ...extra,
      }).catch(() => {});
      await Schools.updateOne({ id: school.id }, { $set: { [`demoNotices.${key}`]: new Date().toISOString() } });
      stats.warned += 1;
    };

    if (days <= 1) await send('final', 'final');
    else if (days <= 2) await send('warning', 'warning');
    else if (days <= 3) await send('nudge', 'nudge');
  }
  return stats;
}

/* ── Ticketing bridge ────────────────────────────────────────── */
async function _createDemoTicket(req, status = 'open') {
  const Tickets = _model('tickets');
  const existing = await Tickets.findOne({ demoRequestId: req.id }).lean();
  if (existing) {
    if (status === 'resolved' && existing.status !== 'resolved') {
      await Tickets.updateOne({ id: existing.id }, { $set: { status: 'resolved', resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    }
    return existing.id;
  }
  const id = `tck_${crypto.randomUUID()}`;
  const seq = await Tickets.countDocuments({});
  const ref = `DEM-${String(seq + 1).padStart(4, '0')}`;
  const now = new Date().toISOString();
  await Tickets.create({
    id, ref,
    subject: `Demo request — ${req.schoolName}`,
    description: [
      `Requester: ${req.name} <${req.email}>`,
      `Role: ${req.role || '—'}`,
      `School size: ${req.schoolSize || '—'}`,
      `Phone: ${req.phone || '—'}`,
      `Source IP: ${req.ip || '—'}`,
    ].join('\n'),
    category: 'demo',
    priority: 'normal',
    status,
    source: 'demo_request',
    requesterName: req.name,
    requesterEmail: req.email,
    schoolName: req.schoolName,
    demoRequestId: req.id,
    tenantId: req.tenantId || null,
    assignee: null,
    tags: ['demo'],
    messages: [],
    slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
    resolvedAt: status === 'resolved' ? now : null,
  });
  return id;
}

module.exports = {
  createRequest,
  resendOtp,
  verifyOtp,
  provisionDemo,
  approveRequest,
  rejectRequest,
  extendDemo,
  expireDemo,
  purgeDemo,
  sweep,
  OTP_TTL_MS,
};
