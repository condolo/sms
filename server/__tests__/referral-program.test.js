/* ============================================================
   Referral program — service rules

   No MongoDB: the collections the service reads are in-memory fakes
   with just enough of the Mongoose surface (find/findOne/count/
   create/updateOne/updateMany + select/sort/limit/lean) to exercise
   the real service code.

   Covers the decisions that must not drift:
     • codes are normalised and self-referral is refused
     • a blocked partner cannot be credited
     • conversion is idempotent and only the first payment counts
     • payout marks only pending conversions and reports the total
     • the referee discount is first-invoice only and respects the
       dynamic program setting (none / percent / fixed)
   ============================================================ */
'use strict';

const crypto = require('crypto');

jest.mock('../utils/tenant-model', () => {
  function matches(doc, filter = {}) {
    return Object.entries(filter).every(([key, expected]) => {
      const actual = doc[key];
      if (expected === null) return actual == null;
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if ('$in' in expected) return expected.$in.includes(actual);
        if ('$ne' in expected) return actual !== expected.$ne;
      }
      return actual === expected;
    });
  }

  function chain(value) {
    const api = {
      select: () => api,
      sort:   () => api,
      limit:  () => api,
      lean:   async () => value,
    };
    return api;
  }

  function makeCollection() {
    const docs = [];
    function applyUpdate(doc, update) {
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
      if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    }
    return {
      _docs: docs,
      find(filter = {})        { return chain(docs.filter((d) => matches(d, filter))); },
      findOne(filter = {})     { return chain(docs.find((d) => matches(d, filter)) || null); },
      countDocuments(filter = {}) { return Promise.resolve(docs.filter((d) => matches(d, filter)).length); },
      create(doc)              { const copy = { ...doc }; docs.push(copy); return Promise.resolve(copy); },
      updateOne(filter, update) {
        const doc = docs.find((d) => matches(d, filter));
        if (doc) applyUpdate(doc, update);
        return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
      },
      updateMany(filter, update) {
        const hits = docs.filter((d) => matches(d, filter));
        hits.forEach((d) => applyUpdate(d, update));
        return Promise.resolve({ modifiedCount: hits.length });
      },
      deleteOne(filter = {}) {
        const index = docs.findIndex((d) => matches(d, filter));
        if (index >= 0) docs.splice(index, 1);
        return Promise.resolve({ deletedCount: index >= 0 ? 1 : 0 });
      },
      aggregate()              { return Promise.resolve([]); },
      insertMany(items)        { docs.push(...items.map((d) => ({ ...d }))); return Promise.resolve(items); },
    };
  }

  const collections = {};
  return {
    platformModel: (name) => collections[name] || (collections[name] = makeCollection()),
    __collections: collections,
  };
});

jest.mock('../utils/email', () => ({
  sendReferralPartnerWelcome: jest.fn(async () => true),
  sendReferralConversion:     jest.fn(async () => true),
  sendReferralPayout:         jest.fn(async () => true),
  sendReferralPayoutRequested: jest.fn(async () => true),
  sendReferralPayoutRequestAlert: jest.fn(async () => true),
  sendReferralPayoutDetailsUpdated: jest.fn(async () => true),
  sendReferralPayoutRejected: jest.fn(async () => true),
}));

jest.mock('../services/audit', () => ({ log: jest.fn() }));

const { platformModel } = require('../utils/tenant-model');
const email = require('../utils/email');
const referral = require('../services/referralService');

function seed(name, docs) {
  const col = platformModel(name);
  col._docs.length = 0;
  docs.forEach((d) => col._docs.push({ ...d }));
  return col;
}

beforeEach(() => {
  const cols = require('../utils/tenant-model').__collections;
  for (const key of Object.keys(cols)) cols[key]._docs.length = 0;
  jest.clearAllMocks();
});

describe('codes and settings', () => {
  test('normalizeCode trims, uppercases and strips impossible characters', () => {
    expect(referral.normalizeCode('  msingi-ab12cd ')).toBe('MSINGI-AB12CD');
    expect(referral.normalizeCode('msingi_ab12cd!')).toBe('MSINGIAB12CD');
    expect(referral.normalizeCode('')).toBe('');
  });

  test('generateCode uses the configured prefix and a readable alphabet', () => {
    const code = referral.generateCode('partner');
    expect(code).toMatch(/^PARTNER-[A-HJ-NP-Z2-9]{6}$/);
  });

  test('normaliseProgram clamps values and defaults an unknown incentive to none', () => {
    expect(referral.normaliseProgram({ bountyAmount: -50, refereeIncentive: { type: 'percent', value: 400 } }))
      .toMatchObject({ bountyAmount: 0, refereeIncentive: { type: 'percent', value: 100 } });
    expect(referral.normaliseProgram({ refereeIncentive: { type: 'nonsense', value: 5 } }).refereeIncentive)
      .toEqual({ type: 'none', value: 0 });
  });

  test('program settings fall back to defaults when platform_settings has never been written', async () => {
    seed('platform_settings', []);
    await expect(referral.getProgramSettings()).resolves.toMatchObject({
      enabled: false,
      bountyAmount: 5000,
      codePrefix: 'MSINGI',
    });
  });
});

describe('resolveAttribution', () => {
  test('blank code is allowed and simply not attributed', async () => {
    await expect(referral.resolveAttribution({ code: '' })).resolves.toMatchObject({ ok: true, attribution: null });
  });

  test('unknown code is rejected with a message a school can act on', async () => {
    seed('referral_partners', []);
    await expect(referral.resolveAttribution({ code: 'MSINGI-NOPE99' })).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_REFERRAL',
    });
  });

  test('blocked partners cannot earn new attributions', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', status: 'blocked', email: 'a@b.com' }]);
    await expect(referral.resolveAttribution({ code: 'MSINGI-ABC234' })).resolves.toMatchObject({ ok: false, code: 'INVALID_REFERRAL' });
  });

  test('a partner cannot refer themselves', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', status: 'active', email: 'Jane@Example.com' }]);
    await expect(referral.resolveAttribution({ code: 'MSINGI-ABC234', email: 'jane@example.com' })).resolves.toMatchObject({
      ok: false,
      code: 'SELF_REFERRAL',
    });
  });

  test('a valid code returns exactly the fields stored on the school', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', status: 'active', email: 'a@b.com' }]);
    const result = await referral.resolveAttribution({ code: 'msingi-abc234', email: 'new@school.com' });
    expect(result.ok).toBe(true);
    expect(result.attribution).toMatchObject({
      referralCode: 'MSINGI-ABC234',
      referralPartnerId: 'ref_1',
    });
    expect(result.attribution.referralAttributedAt).toEqual(expect.any(String));
  });
});

describe('createPartner', () => {
  test('creates a unique code, hashes the hub token and emails the partner', async () => {
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true, bountyAmount: 7500, codePrefix: 'JOIN' } }]);
    const result = await referral.createPartner({
      name: 'Jane Wanjiru',
      email: 'Jane@Example.com',
      phone: '+254700000000',
      ip: '1.2.3.4',
    });

    expect(result.ok).toBe(true);
    expect(result.partner.code).toMatch(/^JOIN-[A-HJ-NP-Z2-9]{6}$/);
    expect(result.links.onboardUrl).toContain(encodeURIComponent(result.partner.code));
    expect(result.links.hubUrl).toContain('/refer/hub/');

    const stored = platformModel('referral_partners')._docs[0];
    expect(stored.email).toBe('jane@example.com');
    expect(stored.hubTokenHash).not.toBe(result.links.hubUrl.split('/refer/hub/')[1]);
    expect(email.sendReferralPartnerWelcome).toHaveBeenCalledWith(expect.objectContaining({ code: result.partner.code }));
  });

  test('an existing email is not disclosed with a code, but the welcome mail is re-sent', async () => {
    seed('referral_partners', [{
      id: 'ref_1', code: 'MSINGI-OLD234', email: 'jane@example.com', status: 'active',
      name: 'Jane', hubTokenHash: 'old',
    }]);

    const result = await referral.createPartner({ name: 'Jane', email: 'jane@example.com', phone: '0700' });
    expect(result).toMatchObject({ ok: false, code: 'EMAIL_TAKEN' });
    expect(result.partner).toBeUndefined();
    expect(email.sendReferralPartnerWelcome).toHaveBeenCalled();
  });

  test('resendHubLink rotates the private token for a known active partner', async () => {
    seed('referral_partners', [{
      id: 'ref_1', code: 'MSINGI-OLD234', email: 'jane@example.com', status: 'active',
      name: 'Jane', phone: '0700', payoutPhone: '0700', payoutMethod: 'mpesa', hubTokenHash: 'old',
    }]);

    const result = await referral.resendHubLink({ email: 'Jane@Example.com' });
    expect(result).toMatchObject({ ok: true, sent: true });
    expect(platformModel('referral_partners')._docs[0].hubTokenHash).not.toBe('old');
    expect(email.sendReferralPartnerWelcome).toHaveBeenCalled();
  });

  test('resendHubLink gives the same generic result for unknown or blocked emails', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-OLD234', email: 'blocked@example.com', status: 'blocked' }]);
    await expect(referral.resendHubLink({ email: 'missing@example.com' })).resolves.toMatchObject({ ok: true, sent: false });
    await expect(referral.resendHubLink({ email: 'blocked@example.com' })).resolves.toMatchObject({ ok: true, sent: false });
    expect(email.sendReferralPartnerWelcome).not.toHaveBeenCalled();
  });
});

describe('recordConversion', () => {
  const school = {
    id: 'sch_1',
    name: 'Riverside Academy',
    slug: 'riverside',
    referralPartnerId: 'ref_1',
    referralCode: 'MSINGI-ABC234',
  };
  const partner = { id: 'ref_1', code: 'MSINGI-ABC234', name: 'Jane', email: 'jane@example.com', status: 'active' };

  test('records the first payment, snapshots the bounty and notifies the partner', async () => {
    seed('schools', [school]);
    seed('referral_partners', [partner]);
    seed('referral_conversions', []);
    seed('billing_snapshots', [{ schoolId: 'sch_1', status: 'paid' }]);
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true, bountyAmount: 5000 } }]);

    const result = await referral.recordConversion({ schoolId: 'sch_1', trigger: 'subscription_payment', amountPaid: 120000, reference: 'QK123456' });

    expect(result).toMatchObject({ ok: true, recorded: true });
    expect(result.conversion).toMatchObject({
      schoolId: 'sch_1',
      partnerId: 'ref_1',
      bountyAmount: 5000,
      rewardStatus: 'pending',
      reference: 'QK123456',
    });
    expect(platformModel('referral_partners')._docs[0].conversionCount).toBe(1);
    expect(email.sendReferralConversion).toHaveBeenCalled();
  });

  test('is idempotent — a second callback never pays twice', async () => {
    seed('schools', [school]);
    seed('referral_partners', [partner]);
    seed('referral_conversions', []);
    seed('billing_snapshots', [{ schoolId: 'sch_1', status: 'paid' }]);
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true } }]);

    await referral.recordConversion({ schoolId: 'sch_1', trigger: 'subscription_payment' });
    const second = await referral.recordConversion({ schoolId: 'sch_1', trigger: 'subscription_payment' });

    expect(second).toMatchObject({ ok: true, recorded: false, reason: 'already_converted' });
    expect(platformModel('referral_conversions')._docs).toHaveLength(1);
  });

  test('a renewal is not the first payment', async () => {
    seed('schools', [school]);
    seed('referral_partners', [partner]);
    seed('referral_conversions', []);
    seed('billing_snapshots', [
      { schoolId: 'sch_1', status: 'paid' },
      { schoolId: 'sch_1', status: 'paid' },
    ]);
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true } }]);

    await expect(referral.recordConversion({ schoolId: 'sch_1', trigger: 'subscription_payment' }))
      .resolves.toMatchObject({ ok: true, recorded: false, reason: 'not_first_payment' });
  });

  test('a school with no referral attribution is ignored', async () => {
    seed('schools', [{ id: 'sch_2', name: 'Other' }]);
    await expect(referral.recordConversion({ schoolId: 'sch_2' }))
      .resolves.toMatchObject({ ok: true, recorded: false, reason: 'not_referred' });
  });
});

describe('payout details and manual payout requests', () => {
  const TOKEN = 'test-hub-token-1234567890';
  const HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');
  const partner = {
    id: 'ref_1',
    code: 'MSINGI-ABC234',
    name: 'Jane',
    email: 'jane@example.com',
    phone: '+254700000000',
    payoutPhone: '+254700000000',
    payoutMethod: 'mpesa',
    status: 'active',
    hubTokenHash: HASH,
  };

  test('updates M-Pesa details and can switch to bank details', async () => {
    seed('referral_partners', [partner]);
    seed('referral_payout_requests', []);

    const mpesa = await referral.updatePayoutDetails({ token: TOKEN, patch: { method: 'mpesa', payoutPhone: '+254711111111' } });
    expect(mpesa).toMatchObject({ ok: true, payout: { method: 'mpesa', phone: '+254711111111', complete: true } });

    const bank = await referral.updatePayoutDetails({
      token: TOKEN,
      patch: {
        method: 'bank',
        bankName: 'Equity Bank',
        bankAccountName: 'Jane Wanjiru',
        bankAccountNumber: '1234567890',
        bankBranch: 'Westlands',
      },
    });
    expect(bank).toMatchObject({ ok: true, payout: { method: 'bank', bankName: 'Equity Bank', complete: true } });
    expect(platformModel('referral_partners')._docs[0].payoutMethod).toBe('bank');
  });

  test('refuses bank details that are incomplete, or edits while a request is open', async () => {
    seed('referral_partners', [partner]);
    seed('referral_payout_requests', []);

    await expect(referral.updatePayoutDetails({ token: TOKEN, patch: { method: 'bank', bankName: 'Equity' } }))
      .resolves.toMatchObject({ ok: false, code: 'PAYOUT_DETAILS_INVALID' });

    seed('referral_payout_requests', [{ id: 'rpr_open', partnerId: 'ref_1', status: 'requested' }]);
    await expect(referral.updatePayoutDetails({ token: TOKEN, patch: { method: 'mpesa', payoutPhone: '+254711111111' } }))
      .resolves.toMatchObject({ ok: false, code: 'PAYOUT_IN_REVIEW' });
  });

  test('creates a request, locks conversions, and pays it with a reference', async () => {
    seed('referral_partners', [partner]);
    seed('referral_conversions', [
      { id: 'rcv_1', partnerId: 'ref_1', schoolName: 'Riverside', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending' },
      { id: 'rcv_2', partnerId: 'ref_1', schoolName: 'Hilltop', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending' },
    ]);
    seed('referral_payout_requests', []);

    const requested = await referral.requestPayout({ token: TOKEN });
    expect(requested).toMatchObject({ ok: true, request: { amount: 10000, currency: 'KES', status: 'requested' } });
    expect(platformModel('referral_conversions')._docs.every((c) => c.payoutRequestId === requested.request.id)).toBe(true);
    expect(email.sendReferralPayoutRequested).toHaveBeenCalled();
    expect(email.sendReferralPayoutRequestAlert).toHaveBeenCalled();

    await expect(referral.requestPayout({ token: TOKEN })).resolves.toMatchObject({ ok: false, code: 'REQUEST_IN_PROGRESS' });

    await expect(referral.payPayoutRequest({ requestId: requested.request.id })).resolves.toMatchObject({ ok: false, code: 'REFERENCE_REQUIRED' });
    const paid = await referral.payPayoutRequest({ requestId: requested.request.id, reference: 'MPESA-123', method: 'mpesa' });
    expect(paid).toMatchObject({ ok: true, request: { status: 'paid', payoutReference: 'MPESA-123' } });
    expect(platformModel('referral_conversions')._docs.every((c) => c.rewardStatus === 'paid')).toBe(true);
    expect(platformModel('referral_payout_requests')._docs[0].status).toBe('paid');
  });

  test('rejecting a request unlocks its conversions', async () => {
    seed('referral_partners', [partner]);
    seed('referral_conversions', [
      { id: 'rcv_1', partnerId: 'ref_1', schoolName: 'Riverside', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending', payoutRequestId: 'rpr_1' },
    ]);
    seed('referral_payout_requests', [{ id: 'rpr_1', partnerId: 'ref_1', partnerCode: 'MSINGI-ABC234', partnerName: 'Jane', partnerEmail: 'jane@example.com', amount: 5000, currency: 'KES', conversionIds: ['rcv_1'], status: 'requested' }]);

    const rejected = await referral.rejectPayoutRequest({ requestId: 'rpr_1', reason: 'Wrong details' });
    expect(rejected).toMatchObject({ ok: true, request: { status: 'rejected', rejectionReason: 'Wrong details' } });
    expect(platformModel('referral_conversions')._docs[0].payoutRequestId).toBeUndefined();
    expect(email.sendReferralPayoutRejected).toHaveBeenCalled();
  });

  test('requesting requires saved payout details and a pending reward', async () => {
    seed('referral_partners', [{ ...partner, payoutPhone: '', phone: '' }]);
    seed('referral_payout_requests', []);
    await expect(referral.requestPayout({ token: TOKEN })).resolves.toMatchObject({ ok: false, code: 'PAYOUT_DETAILS_REQUIRED' });

    seed('referral_partners', [partner]);
    seed('referral_conversions', []);
    await expect(referral.requestPayout({ token: TOKEN })).resolves.toMatchObject({ ok: false, code: 'NO_PENDING' });
  });

  test('direct markPayout skips conversions already locked in a request', async () => {
    seed('referral_partners', [partner]);
    seed('referral_conversions', [
      { id: 'rcv_1', partnerId: 'ref_1', schoolName: 'Available', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending' },
      { id: 'rcv_2', partnerId: 'ref_1', schoolName: 'Locked', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending', payoutRequestId: 'rpr_1' },
    ]);

    const result = await referral.markPayout({ partnerId: 'ref_1', reference: 'MPESA-1' });
    expect(result).toMatchObject({ ok: true, paid: 1, total: 5000, conversionIds: ['rcv_1'] });
  });
});

describe('updatePartner', () => {
  test('updates the payout number and status in one call', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', name: 'Jane', email: 'jane@example.com', phone: '0700', payoutPhone: '0700', status: 'active' }]);
    const result = await referral.updatePartner('ref_1', { payoutPhone: '+254711111111', status: 'blocked' });

    expect(result).toMatchObject({ ok: true, partner: { status: 'blocked', payoutPhone: '+254711111111' } });
    expect(platformModel('referral_partners')._docs[0]).toMatchObject({ status: 'blocked', payoutPhone: '+254711111111' });
  });

  test('rejects an unknown status and an empty patch', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', status: 'active' }]);
    await expect(referral.updatePartner('ref_1', { status: 'deleted' })).resolves.toMatchObject({ ok: false, code: 'INVALID_STATUS' });
    await expect(referral.updatePartner('ref_1', {})).resolves.toMatchObject({ ok: false, code: 'NO_CHANGES' });
  });
});

describe('attachToSchool', () => {
  test('refuses to re-point a school whose reward is already assigned', async () => {
    seed('schools', [{ id: 'sch_1', name: 'Riverside', referralPartnerId: 'ref_1', referralCode: 'MSINGI-ABC234' }]);
    seed('referral_conversions', [{ id: 'rcv_1', schoolId: 'sch_1', partnerId: 'ref_1', rewardStatus: 'pending' }]);

    await expect(referral.attachToSchool({ schoolId: 'sch_1', code: 'MSINGI-OTHER', force: true }))
      .resolves.toMatchObject({ ok: false, code: 'ALREADY_CONVERTED' });
  });
});

describe('markPayout', () => {
  test('refuses to mix currencies in one payout', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', name: 'Jane', email: 'jane@example.com', status: 'active' }]);
    seed('referral_conversions', [
      { id: 'rcv_1', partnerId: 'ref_1', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending' },
      { id: 'rcv_2', partnerId: 'ref_1', bountyAmount: 5000, currency: 'UGX', rewardStatus: 'pending' },
    ]);

    await expect(referral.markPayout({ partnerId: 'ref_1', reference: 'X' }))
      .resolves.toMatchObject({ ok: false, code: 'MIXED_CURRENCY' });
    expect(platformModel('referral_conversions')._docs.every((c) => c.rewardStatus === 'pending')).toBe(true);
  });

  test('pays only pending conversions, records the reference and reports the total', async () => {
    seed('referral_partners', [{ id: 'ref_1', code: 'MSINGI-ABC234', name: 'Jane', email: 'jane@example.com', status: 'active' }]);
    seed('referral_conversions', [
      { id: 'rcv_1', partnerId: 'ref_1', schoolId: 'sch_1', schoolName: 'Riverside', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending' },
      { id: 'rcv_2', partnerId: 'ref_1', schoolId: 'sch_2', schoolName: 'Hilltop', bountyAmount: 5000, currency: 'KES', rewardStatus: 'pending' },
      { id: 'rcv_3', partnerId: 'ref_1', schoolId: 'sch_3', schoolName: 'Paid', bountyAmount: 5000, currency: 'KES', rewardStatus: 'paid' },
    ]);

    const result = await referral.markPayout({ partnerId: 'ref_1', conversionIds: ['rcv_1', 'rcv_2'], reference: 'MPESA-XYZ', method: 'mpesa' });
    expect(result).toMatchObject({ ok: true, paid: 2, total: 10000, currency: 'KES' });

    const docs = platformModel('referral_conversions')._docs;
    expect(docs.filter((d) => d.rewardStatus === 'paid')).toHaveLength(3);
    expect(docs[0].payoutReference).toBe('MPESA-XYZ');
    expect(email.sendReferralPayout).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000 }));
  });
});

describe('firstInvoiceDiscount', () => {
  const referred = { name: 'Riverside', referralPartnerId: 'ref_1', referralCode: 'MSINGI-ABC234' };

  test('percent incentive is applied to the first invoice only', async () => {
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true, refereeIncentive: { type: 'percent', value: 10 } } }]);
    await expect(referral.firstInvoiceDiscount({ school: referred, grossAmount: 100000, priorSnapshotCount: 0 }))
      .resolves.toMatchObject({ type: 'percent', value: 10, amount: 10000 });
    await expect(referral.firstInvoiceDiscount({ school: referred, grossAmount: 100000, priorSnapshotCount: 1 }))
      .resolves.toBeNull();
  });

  test('fixed incentive is clamped to the invoice total', async () => {
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true, refereeIncentive: { type: 'fixed', value: 50000 } } }]);
    await expect(referral.firstInvoiceDiscount({ school: referred, grossAmount: 30000, priorSnapshotCount: 0 }))
      .resolves.toMatchObject({ amount: 30000 });
  });

  test('no discount when the program is off, incentive is none, or the school was not referred', async () => {
    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: false, refereeIncentive: { type: 'percent', value: 10 } } }]);
    await expect(referral.firstInvoiceDiscount({ school: referred, grossAmount: 100000 })).resolves.toBeNull();

    seed('platform_settings', [{ id: 'global', referralProgram: { enabled: true, refereeIncentive: { type: 'none', value: 0 } } }]);
    await expect(referral.firstInvoiceDiscount({ school: referred, grossAmount: 100000 })).resolves.toBeNull();

    await expect(referral.firstInvoiceDiscount({ school: {}, grossAmount: 100000 })).resolves.toBeNull();
  });
});
