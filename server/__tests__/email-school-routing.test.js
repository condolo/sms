/* ============================================================
   server/utils/email.js — school-addressed mail routing + failure log

   Pins the fix for "school mail leaving through the platform sender":
   trial reminders, system-update notices and plan-expiry reminders used
   to call _send (platform identity) directly and could never use a
   school's custom SMTP; sendSmartReminder never awaited _wrap (sending
   a Promise object as HTML) and dropped the school logo. All four now
   go through _sendAsSchool with the schoolId threaded from their
   callers, so a configured school sends from its own address and an
   unconfigured one falls back to platform exactly as before.

   Also pins the failure log: every failed send upserts one hourly-
   deduped row into `email_failures` (scope = schoolId, or
   '__platform__' for platform mail), which backs the school Settings
   list (GET /settings/school/smtp/failures) and the platform feed
   (GET /platform/email-failures).

   nodemailer is mocked; sendMail behaviour is keyed off which account
   created the transporter, and every captured mail is inspectable.
   ============================================================ */
'use strict';

process.env.SMTP_USER      = 'platform@example.com';
process.env.SMTP_PASS      = 'platformpass';
process.env.PLATFORM_EMAIL = 'platform@example.com';

let mockSchoolDoc      = null;
let mockUpdateOneCalls = [];
let mockSendMailImpl   = () => Promise.resolve({});
let mockCapturedMails      = [];

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
    updateOne: jest.fn((filter, update, options) => {
      mockUpdateOneCalls.push({ filter, update, options });
      return Promise.resolve({ matchedCount: 1 });
    }),
    deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 0 })),
  })),
}));

jest.mock('../utils/smtpEncrypt', () => ({
  decrypt: jest.fn(() => 'decrypted-pass'),
  smtpEncryptReady: jest.fn(() => true),
}));

jest.mock('../utils/demo', () => ({ isDemoSchool: jest.fn(() => Promise.resolve(false)) }));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn((config) => ({
    sendMail: jest.fn((mailOpts) => {
      mockCapturedMails.push({ config, mailOpts });
      return mockSendMailImpl(config, mailOpts);
    }),
  })),
}));

const {
  sendTrialReminder,
  sendSystemUpdateNotice,
  sendPlanExpiryReminder,
  sendSmartReminder,
  sendContactConfirmation,
  invalidateSmtpCache,
} = require('../utils/email');

beforeEach(() => {
  mockSchoolDoc    = null;
  mockUpdateOneCalls = [];
  mockSendMailImpl   = () => Promise.resolve({});
  mockCapturedMails      = [];
});

function customSchool(id, overrides = {}) {
  return {
    id, name: 'Test School', email: 'office@test.example', systemEmail: null,
    smtpEnabled: true, smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false,
    smtpUser: 'school@test.example', smtpPassEnc: 'iv:tag:ct',
    smtpFromName: 'Test School', smtpFromEmail: 'school@test.example',
    ...overrides,
  };
}

const lastMail = () => mockCapturedMails[mockCapturedMails.length - 1];

describe('school-addressed platform mail routes through the school SMTP', () => {
  test('trial reminder uses the school address when custom SMTP is configured', async () => {
    invalidateSmtpCache('sch_trial_custom');
    mockSchoolDoc = customSchool('sch_trial_custom');

    const ok = await sendTrialReminder({
      adminName: 'Ada', adminEmail: 'ada@test.example', schoolName: 'Test School',
      schoolEmail: '', schoolId: 'sch_trial_custom', plan: 'standard', daysLeft: 3, trialEnds: '1 Jan 2027',
    });

    expect(ok).toBe(true);
    expect(lastMail().mailOpts.from).toBe('"Test School" <school@test.example>');
    // No fallback error recorded — the custom path succeeded.
    expect(mockUpdateOneCalls.find(c => c.filter.id === 'sch_trial_custom' && c.update.$set?.smtpLastError)).toBeUndefined();
  });

  test('trial reminder falls back to the platform sender with the school name when no custom SMTP', async () => {
    invalidateSmtpCache('sch_trial_plain');
    mockSchoolDoc = { id: 'sch_trial_plain', name: 'Plain School', email: 'office@plain.example', smtpEnabled: false };

    const ok = await sendTrialReminder({
      adminName: 'Ada', adminEmail: 'ada@plain.example', schoolName: 'Plain School',
      schoolEmail: '', schoolId: 'sch_trial_plain', plan: 'standard', daysLeft: 1, trialEnds: '1 Jan 2027',
    });

    expect(ok).toBe(true);
    expect(lastMail().mailOpts.from).toBe('"Plain School via Msingi" <platform@example.com>');
  });

  test('system-update notice uses the school address when custom SMTP is configured', async () => {
    invalidateSmtpCache('sch_sys_custom');
    mockSchoolDoc = customSchool('sch_sys_custom');

    const ok = await sendSystemUpdateNotice({
      adminName: 'Ada', adminEmail: 'ada@test.example', schoolName: 'Test School',
      schoolEmail: '', schoolId: 'sch_sys_custom',
      title: 'Maintenance', description: 'Downtime Sunday', type: 'maintenance',
      scheduledAt: null, affectsAt: null,
    });

    expect(ok).toBe(true);
    expect(lastMail().mailOpts.from).toBe('"Test School" <school@test.example>');
  });

  test('plan-expiry reminder uses the school address when custom SMTP is configured', async () => {
    invalidateSmtpCache('sch_plan_custom');
    mockSchoolDoc = customSchool('sch_plan_custom');

    const ok = await sendPlanExpiryReminder({
      adminName: 'Ada', adminEmail: 'ada@test.example', schoolName: 'Test School',
      schoolEmail: '', schoolId: 'sch_plan_custom', plan: 'base', daysLeft: 7, expiresAt: '1 Feb 2027',
    });

    expect(ok).toBe(true);
    expect(lastMail().mailOpts.from).toBe('"Test School" <school@test.example>');
  });

  test('smart reminder sends real HTML (awaited wrap), not a Promise object', async () => {
    invalidateSmtpCache('sch_smart');
    mockSchoolDoc = { id: 'sch_smart', name: 'Plain School', email: 'office@plain.example', smtpEnabled: false };

    const ok = await sendSmartReminder({
      recipientName: 'Teacher', recipientEmail: 't@plain.example',
      title: 'Mark registers', lines: ['3 unmarked registers'],
      schoolName: 'Plain School', schoolEmail: '', schoolId: 'sch_smart',
    });

    expect(ok).toBe(true);
    expect(typeof lastMail().mailOpts.html).toBe('string');
    expect(lastMail().mailOpts.html).toMatch(/Mark registers/);
  });
});

describe('email failure log', () => {
  test('a failed custom send upserts an email_failures row scoped to the school', async () => {
    invalidateSmtpCache('sch_faillog');
    mockSchoolDoc = customSchool('sch_faillog');
    mockSendMailImpl = (config) => config.auth?.user === 'school@test.example'
      ? Promise.reject(new Error('535 Authentication failed'))
      : Promise.resolve({});

    const { sendLoginOTP } = require('../utils/email');
    await sendLoginOTP({
      name: 'Parent', email: 'p@test.example', otp: '123456',
      schoolName: 'Test School', schoolEmail: '', schoolId: 'sch_faillog',
    });

    const logCall = mockUpdateOneCalls.find(c => c.filter.scope === 'sch_faillog');
    expect(logCall).toBeDefined();
    expect(logCall.options).toMatchObject({ upsert: true });
    expect(logCall.update.$inc).toMatchObject({ count: 1 });
    expect(logCall.update.$set.via).toBe('custom');
  });

  test('a failed platform send is logged under the platform scope', async () => {
    mockSendMailImpl = () => Promise.reject(new Error('connection refused'));

    await sendContactConfirmation({ name: 'Visitor', email: 'v@example.com', institution: 'Acme' });

    const logCall = mockUpdateOneCalls.find(c => c.filter.scope === '__platform__');
    expect(logCall).toBeDefined();
    expect(logCall.update.$set.via).toBe('platform');
  });
});
