/* ============================================================
   Msingi — Platform referral program

   "Anyone can refer a school": the referrer is a normal person, not
   necessarily a school user, so a referral partner is its own record
   (`referral_partners`) holding a public code, contact details, and a
   private hub token. A school is attributed once, at signup (onboard
   form, demo request, or operator provisioning), by entering the code.

   A conversion is recorded the first time the school actually pays
   for its platform subscription — M-Pesa subscription callback, or an
   operator recording an offline payment. The bounty is snapshotted on
   the conversion row at that moment, so later settings changes never
   rewrite what a partner was promised. Payouts are recorded, not
   assumed: a conversion stays `pending` until an operator marks it
   paid with a reference.

   The referred school's incentive is dynamic (platform settings):
   none, a percentage, or a fixed amount off its FIRST platform
   invoice. It is applied once, to the first billing snapshot only.

   Deliberately separate from the school-side "Referral" FEE discount
   (`students.isReferralFamily` / `discount_policies.type='referral'`),
   which is the school charging its own parents. This is the SaaS
   growth program; the two never read or write each other.
   ============================================================ */
'use strict';

const crypto = require('crypto');

const { platformModel } = require('../utils/tenant-model');
const { appUrl } = require('../utils/app-url');
const email = require('../utils/email');
const AuditService = require('./audit');

const DEFAULT_PROGRAM = {
  // Closed until an operator turns it on in Platform → Referrals. A money
  // program must not go live by accident on a deployment that has never
  // reviewed its bounty or incentive.
  enabled: false,
  bountyAmount: 5000,
  currency: 'KES',
  codePrefix: 'MSINGI',
  refereeIncentive: { type: 'none', value: 0 },
  termsUrl: '/terms',
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const MAX_CODE_ATTEMPTS = 8;

/* ── helpers ─────────────────────────────────────────────────── */

function _nowIso() {
  return new Date().toISOString();
}

function _uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function _hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function _randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function _randomCodeChars(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

function _clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _normalisePrefix(raw) {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return cleaned || DEFAULT_PROGRAM.codePrefix;
}

/** Uppercase, trim and strip anything a code can never contain. */
function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 40);
}

function normaliseProgram(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const incentive = p.refereeIncentive && typeof p.refereeIncentive === 'object' ? p.refereeIncentive : {};
  const type = ['none', 'percent', 'fixed'].includes(incentive.type) ? incentive.type : 'none';
  const maxValue = type === 'percent' ? 100 : 100_000_000;
  return {
    enabled: p.enabled === true,
    bountyAmount: Math.round(_clampNumber(p.bountyAmount, 0, 100_000_000, DEFAULT_PROGRAM.bountyAmount)),
    currency: String(p.currency || DEFAULT_PROGRAM.currency).trim().toUpperCase().slice(0, 3) || 'KES',
    codePrefix: _normalisePrefix(p.codePrefix),
    refereeIncentive: {
      type,
      value: type === 'none' ? 0 : Math.round(_clampNumber(incentive.value, 0, maxValue, 0)),
    },
    termsUrl: String(p.termsUrl || DEFAULT_PROGRAM.termsUrl).trim().slice(0, 300) || DEFAULT_PROGRAM.termsUrl,
  };
}

/** Program settings are stored under `referralProgram` on the singleton
 *  platform_settings doc. Missing fields fall back to defaults, so a
 *  deployment that has never opened the Referrals screen still has a
 *  coherent (and safe) program configuration. */
async function getProgramSettings() {
  const Settings = platformModel('platform_settings');
  const doc = await Settings.findOne({ id: 'global' }).select('referralProgram').lean();
  return normaliseProgram(doc?.referralProgram || {});
}

async function saveProgramSettings(patch) {
  const current = await getProgramSettings();
  const next = normaliseProgram({
    ...current,
    ...(patch || {}),
    refereeIncentive: {
      ...current.refereeIncentive,
      ...((patch && patch.refereeIncentive) || {}),
    },
  });
  const Settings = platformModel('platform_settings');
  await Settings.updateOne(
    { id: 'global' },
    { $set: { id: 'global', referralProgram: next, updatedAt: _nowIso() } },
    { upsert: true },
  );
  return next;
}

function generateCode(prefix) {
  return `${_normalisePrefix(prefix)}-${_randomCodeChars(6)}`;
}

function buildLinks(partner, hubToken) {
  const code = encodeURIComponent(partner.code);
  return {
    onboardUrl: appUrl(`/onboard?ref=${code}`),
    demoUrl: appUrl(`/demo?ref=${code}`),
    hubUrl: hubToken ? appUrl(`/refer/hub/${hubToken}`) : null,
  };
}

function _publicPartner(partner) {
  return {
    id: partner.id,
    name: partner.name,
    code: partner.code,
    status: partner.status,
    createdAt: partner.createdAt,
  };
}

function maskPhone(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length <= 3) return '•••';
  return `${s.slice(0, Math.max(0, s.length - 3)).replace(/\d/g, '•')}${s.slice(-3)}`;
}

function maskAccount(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

/** Whether the partner has enough details for their chosen payout method. */
function payoutDetailsComplete(partner) {
  if (!partner) return false;
  if ((partner.payoutMethod || 'mpesa') === 'bank') {
    return !!(partner.bankName && partner.bankAccountName && partner.bankAccountNumber);
  }
  return !!(partner.payoutPhone || partner.phone);
}

/** The partner-facing/platform-facing payout summary. Full details are
 *  returned (the hub link holder is the partner); UIs may mask them. */
function payoutSummary(partner) {
  const method = partner?.payoutMethod === 'bank' ? 'bank' : 'mpesa';
  const phone = String(partner?.payoutPhone || partner?.phone || '').trim();
  const bankAccountNumber = String(partner?.bankAccountNumber || '').trim();
  return {
    method,
    phone,
    phoneMasked: maskPhone(phone),
    bankName: partner?.bankName || '',
    bankAccountName: partner?.bankAccountName || '',
    bankAccountNumber,
    bankAccountNumberMasked: maskAccount(bankAccountNumber),
    bankBranch: partner?.bankBranch || '',
    updatedAt: partner?.payoutDetailsUpdatedAt || null,
    complete: payoutDetailsComplete(partner),
  };
}

function payoutMethodLabel(payout) {
  if (!payout || payout.method === 'mpesa') {
    return `M-Pesa · ${payout?.phoneMasked || payout?.phone || 'no number'}`;
  }
  return `${payout.bankName || 'Bank'} · ${payout.bankAccountNumberMasked || 'no account'}`;
}

async function _partnerByHubToken(token) {
  if (!token) return null;
  const hash = _hashToken(token);
  const Partners = platformModel('referral_partners');
  /* A re-issued link must not instantly kill the one the partner is
     reading: the previous hash stays valid for a short grace window so a
     resend can never lock somebody out of their own dashboard (or let a
     third party DoS it by requesting a resend). */
  return Partners.findOne({
    $or: [
      { hubTokenHash: hash },
      { hubTokenHashPrev: hash, hubTokenPrevUntil: { $gt: new Date() } },
    ],
  }).lean();
}

/** Issue a fresh dashboard token, keeping the previous one valid for
 *  HUB_TOKEN_GRACE_MS so an email handover never strands the partner. */
const HUB_TOKEN_GRACE_MS = 15 * 60 * 1000;

async function _rotateHubToken(partner, Partners) {
  const token = _randomToken();
  const now = new Date();
  await Partners.updateOne({ id: partner.id }, {
    $set: {
      hubTokenHash: _hashToken(token),
      hubTokenHashPrev: partner.hubTokenHash || null,
      hubTokenPrevUntil: new Date(now.getTime() + HUB_TOKEN_GRACE_MS).toISOString(),
      updatedAt: now.toISOString(),
    },
  });
  return token;
}

/** Validate/normalise a payout-details patch. Returns the exact fields to
 *  $set and (when switching methods) the stale fields to $unset. */
function _normalisePayoutPatch(patch = {}, partner = {}) {
  const now = _nowIso();
  const hasBankFields = ['bankName', 'bankAccountName', 'bankAccountNumber', 'bankBranch']
    .some((key) => patch[key] !== undefined);
  const hasPhoneField = patch.payoutPhone !== undefined;
  const method = patch.method === 'bank' || patch.payoutMethod === 'bank'
    ? 'bank'
    : (patch.method === 'mpesa' || patch.payoutMethod === 'mpesa'
        ? 'mpesa'
        : (hasPhoneField && !hasBankFields
            ? 'mpesa'
            : (partner.payoutMethod === 'bank' ? 'bank' : 'mpesa')));

  if (method === 'mpesa') {
    const phone = String(patch.payoutPhone ?? partner.payoutPhone ?? partner.phone ?? '').trim().slice(0, 40);
    if (!phone) {
      return { ok: false, code: 'PAYOUT_DETAILS_INVALID', message: 'Enter the M-Pesa number that should receive the payout.' };
    }
    return {
      ok: true,
      fields: {
        payoutMethod: 'mpesa',
        payoutPhone: phone,
        payoutDetailsUpdatedAt: now,
        updatedAt: now,
      },
      unset: { bankName: '', bankAccountName: '', bankAccountNumber: '', bankBranch: '' },
    };
  }

  const bankName = String(patch.bankName ?? partner.bankName ?? '').trim().slice(0, 120);
  const bankAccountName = String(patch.bankAccountName ?? partner.bankAccountName ?? '').trim().slice(0, 120);
  const bankAccountNumber = String(patch.bankAccountNumber ?? partner.bankAccountNumber ?? '').trim().slice(0, 40);
  const bankBranch = String(patch.bankBranch ?? partner.bankBranch ?? '').trim().slice(0, 120);

  if (!bankName || !bankAccountName || !bankAccountNumber) {
    return {
      ok: false,
      code: 'PAYOUT_DETAILS_INVALID',
      message: 'Bank name, account name and account number are required.',
    };
  }

  return {
    ok: true,
    fields: {
      payoutMethod: 'bank',
      bankName,
      bankAccountName,
      bankAccountNumber,
      bankBranch,
      payoutDetailsUpdatedAt: now,
      updatedAt: now,
    },
    unset: {},
  };
}

function _payoutRequestSummary(request, { masked = false } = {}) {
  const details = request.payoutDetails || {};
  return {
    id: request.id,
    amount: request.amount,
    currency: request.currency,
    status: request.status,
    method: request.method || details.method || 'mpesa',
    methodLabel: masked
      ? payoutMethodLabel({ ...details, method: request.method || details.method })
      : payoutMethodLabel({ ...details, method: request.method || details.method }),
    requestedAt: request.requestedAt,
    reviewedAt: request.reviewedAt || null,
    paidAt: request.paidAt || null,
    payoutReference: request.payoutReference || null,
    rejectionReason: request.rejectionReason || null,
    conversionCount: Array.isArray(request.conversionIds) ? request.conversionIds.length : 0,
  };
}

function _requestPayoutDetails(request) {
  const d = request.payoutDetails || {};
  return {
    method: d.method || request.method || 'mpesa',
    phone: d.phone || '',
    phoneMasked: d.phoneMasked || maskPhone(d.phone),
    bankName: d.bankName || '',
    bankAccountName: d.bankAccountName || '',
    bankAccountNumber: d.bankAccountNumber || '',
    bankAccountNumberMasked: d.bankAccountNumberMasked || maskAccount(d.bankAccountNumber),
    bankBranch: d.bankBranch || '',
  };
}

/* ── partner creation / lookup ───────────────────────────────── */

async function createPartner({ name, email: emailAddr, phone, payoutPhone, schoolName, note, ip }) {
  const Partners = platformModel('referral_partners');
  const email_ = String(emailAddr || '').trim().toLowerCase();

  const existing = await Partners.findOne({ email: email_ }).select('id code status hubTokenHash').lean();
  if (existing) {
    if (existing.status === 'blocked') {
      return {
        ok: false,
        code: 'EMAIL_TAKEN',
        message: 'This account is not active. Please contact support if you believe this is a mistake.',
      };
    }
    // Re-send the welcome mail so a genuine partner who lost the first one
    // can recover. A fresh hub token is issued (the old one is stored only
    // as a hash and can never be recovered); the previous link stays valid
    // for a short grace window so nobody is locked out by the handover.
    const settings = await getProgramSettings();
    const freshToken = await _rotateHubToken(existing, Partners);
    const freshPartner = await Partners.findOne({ id: existing.id }).lean();
    if (freshPartner) {
      await _sendWelcome(freshPartner, settings, buildLinks(freshPartner, freshToken)).catch(() => {});
    }
    return {
      ok: false,
      code: 'EMAIL_TAKEN',
      message: 'This email is already registered. We have re-sent your referral code and dashboard link — check your inbox.',
    };
  }

  const settings = await getProgramSettings();
  if (!settings.enabled) {
    return { ok: false, code: 'PROGRAM_DISABLED', message: 'The referral program is not accepting new partners right now.' };
  }

  let partner = null;
  let hubToken = null;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    hubToken = _randomToken();
    const doc = {
      id: _uid('ref'),
      code: generateCode(settings.codePrefix),
      name: String(name || '').trim().slice(0, 120),
      email: email_,
      phone: String(phone || '').trim().slice(0, 40),
      payoutPhone: String(payoutPhone || phone || '').trim().slice(0, 40),
      payoutMethod: 'mpesa',
      payoutDetailsUpdatedAt: _nowIso(),
      schoolName: String(schoolName || '').trim().slice(0, 160),
      note: String(note || '').trim().slice(0, 500),
      status: 'active',
      hubTokenHash: _hashToken(hubToken),
      signupIp: String(ip || '').slice(0, 80),
      createdAt: _nowIso(),
      updatedAt: _nowIso(),
    };
    try {
      const created = await Partners.create(doc);
      partner = created?.toObject ? created.toObject() : created;
      break;
    } catch (err) {
      lastError = err;
      // Unique index on `code` (and `email`) is the final authority. Retry a
      // code collision; anything else is a real failure.
      if (err && err.code === 11000) {
        if (err.keyPattern?.email || /email/i.test(String(err.message || ''))) {
          return { ok: false, code: 'EMAIL_TAKEN', message: 'This email is already registered.' };
        }
        continue;
      }
      throw err;
    }
  }

  if (!partner) {
    console.error('[referral] could not allocate a unique code:', lastError?.message);
    return { ok: false, code: 'CODE_EXHAUSTED', message: 'Could not create a referral code right now. Please try again.' };
  }

  const links = buildLinks(partner, hubToken);
  await _sendWelcome(partner, settings, links).catch((err) => {
    console.error('[referral] welcome email failed:', err.message);
  });

  AuditService.log({
    action: 'platform.referral_partner.created',
    actor: { userId: 'public', role: 'public', email: email_ },
    schoolId: null,
    target: { type: 'referral_partner', id: partner.id, label: partner.code },
    details: { schoolName: partner.schoolName || null },
  });

  return {
    ok: true,
    partner: _publicPartner(partner),
    links,
    program: settings,
  };
}

async function _sendWelcome(partner, settings, links) {
  if (!partner?.email) return;
  const resolvedLinks = links || {
    onboardUrl: appUrl(`/onboard?ref=${encodeURIComponent(partner.code)}`),
    demoUrl: appUrl(`/demo?ref=${encodeURIComponent(partner.code)}`),
    hubUrl: null,
  };
  return email.sendReferralPartnerWelcome({
    name: partner.name,
    email: partner.email,
    code: partner.code,
    onboardUrl: resolvedLinks.onboardUrl,
    demoUrl: resolvedLinks.demoUrl,
    hubUrl: resolvedLinks.hubUrl,
    bountyAmount: settings.bountyAmount,
    currency: settings.currency,
    payoutMethodLabel: payoutMethodLabel(payoutSummary(partner)),
    payout: payoutSummary(partner),
  });
}

/** Resolve an entered code into the fields stored on a school/demo request.
 *  Never throws for a bad code — callers decide whether an invalid code
 *  must block the signup (it does, so the referrer is not silently lost). */
async function resolveAttribution({ code, email: emailAddr }) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: true, attribution: null };

  const Partners = platformModel('referral_partners');
  const partner = await Partners.findOne({ code: normalized }).lean();
  if (!partner || partner.status !== 'active') {
    return { ok: false, code: 'INVALID_REFERRAL', message: 'That referral code is not recognised. Please check it or leave it blank.' };
  }

  const email_ = String(emailAddr || '').trim().toLowerCase();
  if (email_ && partner.email && String(partner.email).toLowerCase() === email_) {
    return { ok: false, code: 'SELF_REFERRAL', message: 'You cannot use your own referral code.' };
  }

  return {
    ok: true,
    attribution: {
      referralCode: partner.code,
      referralPartnerId: partner.id,
      referralAttributedAt: _nowIso(),
    },
    partner: _publicPartner(partner),
  };
}

/* ── conversion ──────────────────────────────────────────────── */

async function recordConversion({
  schoolId,
  trigger = 'subscription_payment',
  amountPaid = null,
  reference = null,
  note = '',
  actor = null,
} = {}) {
  if (!schoolId) return { ok: false, code: 'SCHOOL_NOT_FOUND', message: 'School not found.' };
  const Schools = platformModel('schools');
  const Conversions = platformModel('referral_conversions');
  const Partners = platformModel('referral_partners');
  const Snapshots = platformModel('billing_snapshots');

  const school = await Schools.findOne({ id: schoolId })
    .select('id name slug adminEmail isDemo referralCode referralPartnerId referralAttributedAt')
    .lean();
  if (!school) return { ok: false, code: 'SCHOOL_NOT_FOUND', message: 'School not found.' };
  if (school.isDemo) return { ok: true, recorded: false, reason: 'demo_school' };
  if (!school.referralPartnerId) return { ok: true, recorded: false, reason: 'not_referred' };

  const existing = await Conversions.findOne({ schoolId }).lean();
  if (existing) return { ok: true, recorded: false, reason: 'already_converted', conversion: existing };

  const partner = await Partners.findOne({ id: school.referralPartnerId }).lean();
  if (!partner) return { ok: true, recorded: false, reason: 'partner_missing' };
  if (partner.status !== 'active') return { ok: true, recorded: false, reason: 'partner_blocked' };

  const program = await getProgramSettings();
  if (!program.enabled) return { ok: true, recorded: false, reason: 'program_disabled' };

  // A subscription-payment callback can be a renewal, not the first payment.
  // The snapshot is marked paid immediately before this call, so exactly one
  // paid snapshot means "this is the first one". Manual conversions are
  // exempt: an operator is recording an offline first payment.
  if (trigger === 'subscription_payment') {
    const paidCount = await Snapshots.countDocuments({ schoolId, status: 'paid' });
    if (paidCount > 1) return { ok: true, recorded: false, reason: 'not_first_payment' };
  }

  const now = _nowIso();
  const paidAmount = amountPaid == null ? null : Number(amountPaid);
  const doc = {
    id: _uid('rcv'),
    partnerId: partner.id,
    partnerCode: partner.code,
    partnerName: partner.name,
    partnerEmail: partner.email,
    referralCode: school.referralCode || partner.code,
    schoolId,
    schoolName: school.name || schoolId,
    schoolSlug: school.slug || '',
    trigger,
    amountPaid: Number.isFinite(paidAmount) ? paidAmount : null,
    reference: reference ? String(reference).slice(0, 120) : null,
    note: String(note || '').slice(0, 500),
    bountyAmount: program.bountyAmount,
    currency: program.currency,
    rewardStatus: 'pending',
    paidAt: null,
    payoutReference: null,
    payoutMethod: null,
    createdBy: actor ? { userId: actor.userId || null, role: actor.role || null, email: actor.email || null } : null,
    createdAt: now,
    updatedAt: now,
  };

  let conversion;
  try {
    const created = await Conversions.create(doc);
    conversion = created?.toObject ? created.toObject() : created;
  } catch (err) {
    if (err && err.code === 11000) {
      const raced = await Conversions.findOne({ schoolId }).lean();
      return { ok: true, recorded: false, reason: 'already_converted', conversion: raced };
    }
    throw err;
  }

  await Partners.updateOne({ id: partner.id }, { $inc: { conversionCount: 1 }, $set: { updatedAt: now } });

  AuditService.log({
    action: 'platform.referral_conversion.recorded',
    actor: actor || { userId: 'system', role: 'system', email: null },
    schoolId: null,
    target: { type: 'referral_conversion', id: conversion.id, label: school.name || schoolId },
    details: {
      partnerId: partner.id,
      partnerCode: partner.code,
      bountyAmount: program.bountyAmount,
      trigger,
      reference: doc.reference,
    },
  });

  await email.sendReferralConversion({
    name: partner.name,
    email: partner.email,
    schoolName: school.name || schoolId,
    bountyAmount: program.bountyAmount,
    currency: program.currency,
  }).catch((err) => console.error('[referral] conversion email failed:', err.message));

  return { ok: true, recorded: true, conversion, partner: _publicPartner(partner), program };
}

/* ── payout ──────────────────────────────────────────────────── */

async function markPayout({ partnerId, conversionIds, method = 'mpesa', reference, actor = null }) {
  if (!partnerId) return { ok: false, code: 'PARTNER_NOT_FOUND', message: 'Referral partner not found.' };
  const Partners = platformModel('referral_partners');
  const Conversions = platformModel('referral_conversions');

  const partner = await Partners.findOne({ id: partnerId }).lean();
  if (!partner) return { ok: false, code: 'PARTNER_NOT_FOUND', message: 'Referral partner not found.' };

  const filter = { partnerId, rewardStatus: 'pending', payoutRequestId: null };
  if (Array.isArray(conversionIds) && conversionIds.length) filter.id = { $in: conversionIds };

  const pending = await Conversions.find(filter).lean();
  if (!pending.length) {
    return { ok: false, code: 'NOTHING_TO_PAY', message: 'No pending conversions match this payout.' };
  }

  const referenceText = String(reference || '').trim();
  if (!referenceText) {
    return { ok: false, code: 'REFERENCE_REQUIRED', message: 'A payout reference (M-Pesa code or bank transaction ID) is required.' };
  }

  const now = _nowIso();
  const currencies = new Set(pending.map((c) => c.currency || 'KES'));
  if (currencies.size > 1) {
    return {
      ok: false,
      code: 'MIXED_CURRENCY',
      message: 'These conversions use more than one currency. Pay each currency separately.',
    };
  }
  const methodText = String(method || 'mpesa').trim().slice(0, 40) || 'mpesa';
  const total = pending.reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0);
  const currency = [...currencies][0];
  await Conversions.updateMany(
    { id: { $in: pending.map((c) => c.id) } },
    {
      $set: {
        rewardStatus: 'paid',
        paidAt: now,
        payoutReference: referenceText.slice(0, 120),
        payoutMethod: methodText,
        payoutBy: actor ? { userId: actor.userId || null, email: actor.email || null } : null,
        updatedAt: now,
      },
    },
  );

  AuditService.log({
    action: 'platform.referral_payout.recorded',
    actor: actor || { userId: 'system', role: 'system', email: null },
    schoolId: null,
    target: { type: 'referral_partner', id: partner.id, label: partner.code },
    details: { conversionIds: pending.map((c) => c.id), total, currency, method: methodText, reference: referenceText },
  });

  await email.sendReferralPayout({
    name: partner.name,
    email: partner.email,
    amount: total,
    currency,
    method: methodText,
    reference: referenceText,
    schoolNames: pending.map((c) => c.schoolName).filter(Boolean),
  }).catch((err) => console.error('[referral] payout email failed:', err.message));

  return { ok: true, paid: pending.length, total, currency, conversionIds: pending.map((c) => c.id) };
}

/* ── referee discount (first invoice only) ───────────────────── */

/** Re-issue a private dashboard link by email. Always returns the same
 *  generic result so the endpoint cannot be used to enumerate partners. */
async function resendHubLink({ email: emailAddr } = {}) {
  const email_ = String(emailAddr || '').trim().toLowerCase();
  const Partners = platformModel('referral_partners');
  const partner = await Partners.findOne({ email: email_ }).lean();
  if (!partner || partner.status !== 'active') return { ok: true, sent: false };

  const settings = await getProgramSettings();
  const token = await _rotateHubToken(partner, Partners);
  const now = _nowIso();

  const fresh = { ...partner, hubTokenHash: _hashToken(token) };
  await _sendWelcome(fresh, settings, buildLinks(fresh, token)).catch((err) => {
    console.error('[referral] dashboard link email failed:', err.message);
  });

  AuditService.log({
    action: 'referral.dashboard_link_resent',
    actor: { userId: partner.id, role: 'referral_partner', email: partner.email },
    schoolId: null,
    target: { type: 'referral_partner', id: partner.id, label: partner.code },
    details: {},
  });

  return { ok: true, sent: true };
}

/* ── payout details + manual payout requests ────────────────── */

/** Partner updates their payout destination from the private hub. Blocked
 *  while a request is under review, so the destination being paid cannot
 *  change after ops have picked it up. */
async function updatePayoutDetails({ token, patch = {} }) {
  const partner = await _partnerByHubToken(token);
  if (!partner) return { ok: false, code: 'NOT_FOUND', message: 'This referral dashboard link is not valid.' };
  if (partner.status !== 'active') return { ok: false, code: 'PARTNER_BLOCKED', message: 'This partner account is not active.' };

  const Requests = platformModel('referral_payout_requests');
  const openRequest = await Requests.findOne({ partnerId: partner.id, status: 'requested' }).select('id').lean();
  if (openRequest) {
    return {
      ok: false,
      code: 'PAYOUT_IN_REVIEW',
      message: 'A payout request is already under review. Payout details cannot change until it is settled.',
    };
  }

  const previousLabel = payoutMethodLabel(payoutSummary(partner));

  const normalised = _normalisePayoutPatch(patch, partner);
  if (!normalised.ok) return normalised;

  const Partners = platformModel('referral_partners');
  const update = { $set: normalised.fields };
  if (Object.keys(normalised.unset).length) update.$unset = normalised.unset;
  await Partners.updateOne({ id: partner.id }, update);

  const updated = { ...partner, ...normalised.fields };
  for (const key of Object.keys(normalised.unset)) delete updated[key];
  const payout = payoutSummary(updated);

  await email.sendReferralPayoutDetailsUpdated({
    name: partner.name,
    email: partner.email,
    methodLabel: payoutMethodLabel(payout),
  }).catch((err) => console.error('[referral] payout details email failed:', err.message));

  /* Ops must know a payout destination moved: the dashboard link is a
     bearer credential, so a leaked link could otherwise redirect a payout
     without anyone noticing until the money went out. */
  await email.sendReferralPayoutDetailsAlert({
    partnerName: partner.name,
    partnerEmail: partner.email,
    previousLabel,
    methodLabel: payoutMethodLabel(payout),
  }).catch((err) => console.error('[referral] payout details alert failed:', err.message));

  AuditService.log({
    action: 'referral.payout_details_updated',
    actor: { userId: partner.id, role: 'referral_partner', email: partner.email },
    schoolId: null,
    target: { type: 'referral_partner', id: partner.id, label: partner.code },
    details: { method: payout.method, phoneMasked: payout.phoneMasked, bankName: payout.bankName, accountMasked: payout.bankAccountNumberMasked },
  });

  return { ok: true, payout };
}

/** Partner asks for the currently-unlocked pending conversions to be paid.
 *  This only creates a request; an operator still settles the money. */
async function requestPayout({ token, note = '' }) {
  const partner = await _partnerByHubToken(token);
  if (!partner) return { ok: false, code: 'NOT_FOUND', message: 'This referral dashboard link is not valid.' };
  if (partner.status !== 'active') return { ok: false, code: 'PARTNER_BLOCKED', message: 'This partner account is not active.' };
  if (!payoutDetailsComplete(partner)) {
    return { ok: false, code: 'PAYOUT_DETAILS_REQUIRED', message: 'Add your payout details before requesting a payout.' };
  }

  const Requests = platformModel('referral_payout_requests');
  const Conversions = platformModel('referral_conversions');
  const existing = await Requests.findOne({ partnerId: partner.id, status: 'requested' }).lean();
  if (existing) {
    return { ok: false, code: 'REQUEST_IN_PROGRESS', message: 'You already have a payout request under review.', request: _payoutRequestSummary(existing) };
  }

  const available = await Conversions.find({
    partnerId: partner.id,
    rewardStatus: 'pending',
    payoutRequestId: null,
  }).sort({ createdAt: 1 }).lean();

  if (!available.length) {
    return { ok: false, code: 'NO_PENDING', message: 'There is no pending reward to request yet.' };
  }

  const currencies = new Set(available.map((c) => c.currency || 'KES'));
  if (currencies.size > 1) {
    return { ok: false, code: 'MIXED_CURRENCY', message: 'Your pending rewards use more than one currency. Contact support.' };
  }

  const now = _nowIso();
  const payout = payoutSummary(partner);
  const requestId = _uid('rpr');
  const requestDoc = {
    id: requestId,
    partnerId: partner.id,
    partnerCode: partner.code,
    partnerName: partner.name,
    partnerEmail: partner.email,
    amount: available.reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0),
    currency: [...currencies][0],
    conversionIds: available.map((c) => c.id),
    status: 'requested',
    method: payout.method,
    payoutDetails: payout,
    note: String(note || '').slice(0, 500),
    requestedAt: now,
    reviewedAt: null,
    paidAt: null,
    payoutReference: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await Requests.create(requestDoc);
  } catch (err) {
    if (err && err.code === 11000) {
      const raced = await Requests.findOne({ partnerId: partner.id, status: 'requested' }).lean();
      return { ok: false, code: 'REQUEST_IN_PROGRESS', message: 'You already have a payout request under review.', request: raced ? _payoutRequestSummary(raced) : null };
    }
    throw err;
  }

  /* Lock the conversions. The unique open-request index means a second
     request cannot race this; the extra filter keeps a manually paid
     conversion out of the request if ops settled it in the same moment. */
  await Conversions.updateMany(
    { id: { $in: requestDoc.conversionIds }, rewardStatus: 'pending', payoutRequestId: null },
    { $set: { payoutRequestId: requestId, payoutRequestedAt: now, updatedAt: now } },
  );

  const claimed = await Conversions.find({ payoutRequestId: requestId })
    .select('id bountyAmount currency')
    .lean();

  if (!claimed.length) {
    await Requests.deleteOne({ id: requestId });
    return { ok: false, code: 'NO_PENDING', message: 'There is no pending reward to request yet.' };
  }

  const claimedAmount = claimed.reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0);
  const claimedCurrency = claimed[0].currency || requestDoc.currency;
  await Requests.updateOne(
    { id: requestId },
    { $set: { conversionIds: claimed.map((c) => c.id), amount: claimedAmount, currency: claimedCurrency, updatedAt: _nowIso() } },
  );

  const request = { ...requestDoc, amount: claimedAmount, currency: claimedCurrency, conversionIds: claimed.map((c) => c.id) };

  await email.sendReferralPayoutRequested({
    name: partner.name,
    email: partner.email,
    amount: claimedAmount,
    currency: claimedCurrency,
    methodLabel: payoutMethodLabel(payout),
  }).catch((err) => console.error('[referral] payout request email failed:', err.message));

  await email.sendReferralPayoutRequestAlert({
    partnerName: partner.name,
    partnerEmail: partner.email,
    amount: claimedAmount,
    currency: claimedCurrency,
    methodLabel: payoutMethodLabel(payout),
    payout,
    requestId,
  }).catch((err) => console.error('[referral] payout request alert failed:', err.message));

  AuditService.log({
    action: 'referral.payout_requested',
    actor: { userId: partner.id, role: 'referral_partner', email: partner.email },
    schoolId: null,
    target: { type: 'referral_payout_request', id: requestId, label: partner.code },
    details: { amount: claimedAmount, currency: claimedCurrency, method: payout.method, conversionIds: request.conversionIds },
  });

  return { ok: true, request: _payoutRequestSummary(request, { masked: true }), payout };
}

/** Operator settles an affiliate's request. Manual by design: a reference
 *  is mandatory, and the request is the audit unit (not a loose conversion). */
async function payPayoutRequest({ requestId, reference, method, actor = null }) {
  if (!requestId) return { ok: false, code: 'NOT_FOUND', message: 'Payout request not found.' };
  const Requests = platformModel('referral_payout_requests');
  const Conversions = platformModel('referral_conversions');

  const request = await Requests.findOne({ id: requestId }).lean();
  if (!request) return { ok: false, code: 'NOT_FOUND', message: 'Payout request not found.' };
  if (request.status !== 'requested') {
    return { ok: false, code: 'ALREADY_SETTLED', message: `This request is already ${request.status}.` };
  }

  const referenceText = String(reference || '').trim();
  if (!referenceText) {
    return { ok: false, code: 'REFERENCE_REQUIRED', message: 'A payout reference (M-Pesa code or bank transaction ID) is required.' };
  }
  const methodText = String(method || request.method || 'mpesa').trim().slice(0, 40) || 'mpesa';
  const methodLabel = methodText === 'bank' ? 'Bank transfer' : methodText === 'mpesa' ? 'M-Pesa' : methodText;
  const now = _nowIso();

  const conversions = await Conversions.find({ id: { $in: request.conversionIds || [] } })
    .select('id schoolName bountyAmount currency')
    .lean();

  const settled = await Requests.updateOne(
    { id: request.id, status: 'requested' },
    {
      $set: {
        status: 'paid',
        reviewedAt: now,
        paidAt: now,
        payoutReference: referenceText.slice(0, 120),
        payoutMethod: methodText,
        payoutBy: actor ? { userId: actor.userId || null, email: actor.email || null } : null,
        updatedAt: now,
      },
    },
  );

  /* Two operators (or a retry) can land here at the same time. The write
     filter above is the arbiter: whoever did not change the row must not
     send the "paid" email or claim the money twice. */
  if (!settled || settled.modifiedCount === 0) {
    return { ok: false, code: 'ALREADY_SETTLED', message: 'This request was already settled by another operator.' };
  }

  await Conversions.updateMany(
    { id: { $in: request.conversionIds || [] }, rewardStatus: 'pending' },
    {
      $set: {
        rewardStatus: 'paid',
        paidAt: now,
        payoutReference: referenceText.slice(0, 120),
        payoutMethod: methodText,
        payoutRequestId: request.id,
        updatedAt: now,
      },
    },
  );

  /* Report what was actually marked paid, not what the request claimed. */
  const paidConversions = await Conversions.find({ payoutRequestId: request.id, rewardStatus: 'paid' })
    .select('id schoolName bountyAmount currency')
    .lean();
  const paidAmount = paidConversions.reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0);
  const settledAmount = paidAmount || Number(request.amount) || 0;

  AuditService.log({
    action: 'platform.referral_payout_request.paid',
    actor: actor || { userId: 'system', role: 'system', email: null },
    schoolId: null,
    target: { type: 'referral_payout_request', id: request.id, label: request.partnerCode },
    details: { amount: settledAmount, currency: request.currency, method: methodText, reference: referenceText, conversionIds: request.conversionIds },
  });

  await email.sendReferralPayout({
    name: request.partnerName,
    email: request.partnerEmail,
    amount: settledAmount,
    currency: request.currency,
    method: methodLabel,
    reference: referenceText,
    schoolNames: (paidConversions.length ? paidConversions : conversions).map((c) => c.schoolName).filter(Boolean),
  }).catch((err) => console.error('[referral] payout email failed:', err.message));

  return {
    ok: true,
    request: { ..._payoutRequestSummary({ ...request, status: 'paid', paidAt: now, payoutReference: referenceText, payoutMethod: methodText }), payoutDetails: _requestPayoutDetails(request) },
  };
}

async function rejectPayoutRequest({ requestId, reason = '', actor = null }) {
  if (!requestId) return { ok: false, code: 'NOT_FOUND', message: 'Payout request not found.' };
  const Requests = platformModel('referral_payout_requests');
  const Conversions = platformModel('referral_conversions');

  const request = await Requests.findOne({ id: requestId }).lean();
  if (!request) return { ok: false, code: 'NOT_FOUND', message: 'Payout request not found.' };
  if (request.status !== 'requested') {
    return { ok: false, code: 'ALREADY_SETTLED', message: `This request is already ${request.status}.` };
  }

  const now = _nowIso();
  const reasonText = String(reason || '').trim().slice(0, 500);
  const rejected = await Requests.updateOne(
    { id: request.id, status: 'requested' },
    {
      $set: {
        status: 'rejected',
        reviewedAt: now,
        rejectionReason: reasonText || null,
        reviewedBy: actor ? { userId: actor.userId || null, email: actor.email || null } : null,
        updatedAt: now,
      },
    },
  );

  /* Same arbitration as the pay path: a request that another operator has
     already settled must not be "rejected" here, and must not have its
     locked conversions released. */
  if (!rejected || rejected.modifiedCount === 0) {
    return { ok: false, code: 'ALREADY_SETTLED', message: 'This request was already settled by another operator.' };
  }

  await Conversions.updateMany(
    { id: { $in: request.conversionIds || [] }, payoutRequestId: request.id },
    { $unset: { payoutRequestId: '', payoutRequestedAt: '' }, $set: { updatedAt: now } },
  );

  AuditService.log({
    action: 'platform.referral_payout_request.rejected',
    actor: actor || { userId: 'system', role: 'system', email: null },
    schoolId: null,
    target: { type: 'referral_payout_request', id: request.id, label: request.partnerCode },
    details: { amount: request.amount, currency: request.currency, reason: reasonText },
  });

  await email.sendReferralPayoutRejected({
    name: request.partnerName,
    email: request.partnerEmail,
    amount: request.amount,
    currency: request.currency,
    reason: reasonText,
  }).catch((err) => console.error('[referral] payout rejection email failed:', err.message));

  return { ok: true, request: _payoutRequestSummary({ ...request, status: 'rejected', reviewedAt: now, rejectionReason: reasonText }) };
}

/** Returns the discount to apply to a school's FIRST billing snapshot, or
 *  null. Pure calculation against settings; the caller owns persistence. */
async function firstInvoiceDiscount({ school, grossAmount, priorSnapshotCount = 0 }) {
  if (!school || !school.referralPartnerId) return null;
  if (priorSnapshotCount > 0) return null;

  const program = await getProgramSettings();
  if (!program.enabled) return null;
  const { type, value } = program.refereeIncentive;
  if (type === 'none' || !value) return null;

  const gross = Math.max(0, Number(grossAmount) || 0);
  let amount = type === 'percent' ? Math.round((gross * value) / 100) : Math.round(value);
  amount = Math.max(0, Math.min(gross, amount));
  if (!amount) return null;

  return {
    type,
    value,
    amount,
    currency: program.currency,
    code: school.referralCode || null,
    partnerId: school.referralPartnerId,
  };
}

/* ── platform console reads ──────────────────────────────────── */

async function listPartners({ limit = 500 } = {}) {
  const Partners = platformModel('referral_partners');
  const Conversions = platformModel('referral_conversions');
  const Schools = platformModel('schools');

  const partners = await Partners.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 500, 1000))
    .lean();

  const [conversionGroups, schoolCounts, program] = await Promise.all([
    /* Grouped in the database: the console must not pull every conversion
       row in the platform into memory just to count them per partner. */
    Conversions.aggregate([
      { $group: { _id: { partnerId: '$partnerId', rewardStatus: '$rewardStatus' }, count: { $sum: 1 }, amount: { $sum: '$bountyAmount' } } },
    ]),
    Schools.aggregate([
      { $match: { referralPartnerId: { $ne: null } } },
      { $group: { _id: '$referralPartnerId', count: { $sum: 1 } } },
    ]),
    getProgramSettings(),
  ]);

  const counts = new Map(schoolCounts.map((r) => [r._id, r.count]));
  const byPartner = new Map();
  for (const group of conversionGroups) {
    const partnerId = group._id?.partnerId;
    if (!partnerId) continue;
    if (!byPartner.has(partnerId)) byPartner.set(partnerId, { conversions: 0, pendingAmount: 0, paidAmount: 0 });
    const agg = byPartner.get(partnerId);
    agg.conversions += group.count || 0;
    const amount = Number(group.amount) || 0;
    if (group._id?.rewardStatus === 'pending') agg.pendingAmount += amount;
    if (group._id?.rewardStatus === 'paid') agg.paidAmount += amount;
  }

  return partners.map((p) => {
    const agg = byPartner.get(p.id) || { conversions: 0, pendingAmount: 0, paidAmount: 0 };
    return {
      ..._publicPartner(p),
      email: p.email,
      phone: p.phone,
      payoutPhone: p.payoutPhone,
      schoolName: p.schoolName || '',
      signups: counts.get(p.id) || 0,
      conversions: agg.conversions,
      pendingAmount: agg.pendingAmount,
      paidAmount: agg.paidAmount,
      currency: p.currency || program.currency,
    };
  });
}

async function getPartner(id) {
  if (!id) return { ok: false, code: 'NOT_FOUND', message: 'Referral partner not found.' };
  const Partners = platformModel('referral_partners');
  const Conversions = platformModel('referral_conversions');
  const Schools = platformModel('schools');
  const Requests = platformModel('referral_payout_requests');

  const partner = await Partners.findOne({ id }).lean();
  if (!partner) return { ok: false, code: 'NOT_FOUND', message: 'Referral partner not found.' };

  const [schools, conversions, payoutRequests] = await Promise.all([
    Schools.find({ referralPartnerId: partner.id })
      .select('id name slug status isActive isDemo referralCode referralAttributedAt createdAt plan adminEmail')
      .sort({ createdAt: -1 })
      .lean(),
    Conversions.find({ partnerId: partner.id }).sort({ createdAt: -1 }).lean(),
    Requests.find({ partnerId: partner.id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  const bySchool = new Map(conversions.map((c) => [c.schoolId, c]));
  const referrals = schools.map((s) => {
    const conversion = bySchool.get(s.id) || null;
    return {
      schoolId: s.id,
      schoolName: s.name,
      schoolSlug: s.slug,
      schoolAdminEmail: s.adminEmail || null,
      plan: s.plan || null,
      isDemo: !!s.isDemo,
      schoolStatus: s.status || (s.isActive === false ? 'inactive' : 'active'),
      joinedAt: s.referralAttributedAt || s.createdAt || null,
      conversion: conversion
        ? {
            id: conversion.id,
            bountyAmount: conversion.bountyAmount,
            currency: conversion.currency,
            rewardStatus: conversion.rewardStatus,
            trigger: conversion.trigger,
            reference: conversion.reference,
            amountPaid: conversion.amountPaid,
            createdAt: conversion.createdAt,
            paidAt: conversion.paidAt,
            payoutReference: conversion.payoutReference,
            payoutRequestId: conversion.payoutRequestId || null,
          }
        : null,
    };
  });

  return {
    ok: true,
    partner: {
      ..._publicPartner(partner),
      email: partner.email,
      phone: partner.phone,
      payoutPhone: partner.payoutPhone,
      schoolName: partner.schoolName || '',
      note: partner.note || '',
      payout: payoutSummary(partner),
    },
    payoutRequests: payoutRequests.map((r) => ({
      ..._payoutRequestSummary(r),
      payoutDetails: _requestPayoutDetails(r),
      note: r.note || '',
    })),
    referrals,
  };
}

/** Update the fields an operator may need to correct before a payout
 *  (status, contact numbers, note). A block is just one field; the same
 *  endpoint is used by the console's "Payout number" action. */
async function updatePartner(id, patch = {}) {
  if (!id) return { ok: false, code: 'NOT_FOUND', message: 'Referral partner not found.' };
  const Partners = platformModel('referral_partners');
  const partner = await Partners.findOne({ id }).lean();
  if (!partner) return { ok: false, code: 'NOT_FOUND', message: 'Referral partner not found.' };

  const update = { updatedAt: _nowIso() };
  const unset = {};
  if (patch.status !== undefined) {
    if (!['active', 'blocked'].includes(patch.status)) {
      return { ok: false, code: 'INVALID_STATUS', message: 'Status must be active or blocked.' };
    }
    update.status = patch.status;
  }
  if (patch.phone !== undefined) update.phone = String(patch.phone || '').trim().slice(0, 40);
  if (patch.note !== undefined) update.note = String(patch.note || '').trim().slice(0, 500);

  const payoutKeys = ['method', 'payoutMethod', 'payoutPhone', 'bankName', 'bankAccountName', 'bankAccountNumber', 'bankBranch'];
  if (payoutKeys.some((key) => patch[key] !== undefined)) {
    const normalised = _normalisePayoutPatch(patch, partner);
    if (!normalised.ok) return normalised;
    Object.assign(update, normalised.fields);
    Object.assign(unset, normalised.unset);
  }

  if (Object.keys(update).length === 1) {
    return { ok: false, code: 'NO_CHANGES', message: 'Nothing to update.' };
  }

  const dbUpdate = { $set: update };
  if (Object.keys(unset).length) dbUpdate.$unset = unset;
  await Partners.updateOne({ id }, dbUpdate);
  const merged = { ...partner, ...update };
  for (const key of Object.keys(unset)) delete merged[key];
  return {
    ok: true,
    partner: {
      ..._publicPartner(merged),
      status: merged.status,
      phone: merged.phone,
      payoutPhone: merged.payoutPhone,
      note: merged.note,
      payout: payoutSummary(merged),
    },
  };
}

/** Operator attaches (or overrides) a referral code on an existing school.
 *  `force` allows correcting a wrong code; without it an existing
 *  attribution is never silently replaced. */
async function attachToSchool({ schoolId, code, force = false, actor = null }) {
  if (!schoolId) return { ok: false, code: 'SCHOOL_NOT_FOUND', message: 'School not found.' };
  const Schools = platformModel('schools');
  const Conversions = platformModel('referral_conversions');
  const school = await Schools.findOne({ id: schoolId }).select('id name slug referralPartnerId referralCode').lean();
  if (!school) return { ok: false, code: 'SCHOOL_NOT_FOUND', message: 'School not found.' };

  /* Once a conversion exists the reward has already been assigned to a
     specific partner; re-pointing the school would leave the payout row
     attached to someone else. Corrections must happen before payment, not
     after. */
  const existingConversion = await Conversions.findOne({ schoolId }).select('id partnerId').lean();
  if (existingConversion) {
    return {
      ok: false,
      code: 'ALREADY_CONVERTED',
      message: 'This school already has a recorded referral conversion; its reward belongs to the original partner.',
    };
  }

  if (school.referralPartnerId && !force) {
    return { ok: false, code: 'ALREADY_ATTRIBUTED', message: 'This school already has a referral attribution. Use force to replace it.' };
  }

  const resolved = await resolveAttribution({ code, email: null });
  if (!resolved.ok) return resolved;

  if (!resolved.attribution) {
    await Schools.updateOne({ id: schoolId }, {
      $unset: { referralCode: '', referralPartnerId: '', referralAttributedAt: '', referralSource: '' },
      $set: { updatedAt: _nowIso() },
    });
    return { ok: true, attribution: null };
  }

  await Schools.updateOne({ id: schoolId }, {
    $set: { ...resolved.attribution, referralSource: 'operator', updatedAt: _nowIso() },
  });

  AuditService.log({
    action: 'platform.referral.attached',
    actor: actor || { userId: 'system', role: 'system', email: null },
    schoolId: null,
    target: { type: 'school', id: schoolId, label: school.name || schoolId },
    details: { code: resolved.attribution.referralCode, partnerId: resolved.attribution.referralPartnerId, replaced: !!school.referralPartnerId },
  });

  return { ok: true, attribution: resolved.attribution, partner: resolved.partner };
}

/** Private partner dashboard. The token itself is never stored — only its
 *  hash — so this lookup is the only way to turn a link back into a
 *  partner. School names are shown; contact details and money are not
 *  exposed beyond the partner's own aggregate. */
async function getHub(token) {
  if (!token) return { ok: false, code: 'NOT_FOUND', message: 'This referral dashboard link is not valid.' };
  const Conversions = platformModel('referral_conversions');
  const Schools = platformModel('schools');
  const Requests = platformModel('referral_payout_requests');

  const partner = await _partnerByHubToken(token);
  if (!partner) return { ok: false, code: 'NOT_FOUND', message: 'This referral dashboard link is not valid.' };

  const [schools, conversions, program, payoutRequests] = await Promise.all([
    Schools.find({ referralPartnerId: partner.id })
      .select('id name status isActive isDemo referralAttributedAt createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    Conversions.find({ partnerId: partner.id }).sort({ createdAt: -1 }).lean(),
    getProgramSettings(),
    Requests.find({ partnerId: partner.id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  const bySchool = new Map(conversions.map((c) => [c.schoolId, c]));
  const referrals = schools.map((s) => {
    const conversion = bySchool.get(s.id) || null;
    let status = s.isDemo ? 'demo' : 'signed_up';
    if (conversion) {
      status = conversion.rewardStatus === 'paid'
        ? 'reward_paid'
        : (conversion.payoutRequestId ? 'payout_requested' : 'converted');
    }
    return {
      schoolName: s.name,
      joinedAt: s.referralAttributedAt || s.createdAt || null,
      status,
      bountyAmount: conversion ? conversion.bountyAmount : null,
      currency: conversion ? conversion.currency : program.currency,
    };
  });

  const availableAmount = conversions
    .filter((c) => c.rewardStatus === 'pending' && !c.payoutRequestId)
    .reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0);
  const requestedAmount = conversions
    .filter((c) => c.rewardStatus === 'pending' && c.payoutRequestId)
    .reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0);
  const paidAmount = conversions
    .filter((c) => c.rewardStatus === 'paid')
    .reduce((sum, c) => sum + (Number(c.bountyAmount) || 0), 0);

  return {
    ok: true,
    data: {
      partner: _publicPartner(partner),
      program,
      links: buildLinks(partner, token),
      payout: payoutSummary(partner),
      referrals,
      payoutRequests: payoutRequests.map((r) => _payoutRequestSummary(r, { masked: true })),
      totals: {
        signups: schools.length,
        conversions: conversions.length,
        availableAmount,
        requestedAmount,
        pendingAmount: availableAmount,
        paidAmount,
        currency: program.currency,
      },
    },
  };
}

module.exports = {
  DEFAULT_PROGRAM,
  normalizeCode,
  normaliseProgram,
  getProgramSettings,
  saveProgramSettings,
  generateCode,
  buildLinks,
  createPartner,
  resendHubLink,
  resolveAttribution,
  recordConversion,
  markPayout,
  updatePayoutDetails,
  requestPayout,
  payPayoutRequest,
  rejectPayoutRequest,
  firstInvoiceDiscount,
  listPartners,
  getPartner,
  updatePartner,
  attachToSchool,
  getHub,
};
