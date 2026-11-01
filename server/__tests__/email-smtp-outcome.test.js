/* ============================================================
   server/utils/email.js — custom-SMTP outcome tracking

   A school's custom SMTP being fully configured (host/user/password all
   saved) says nothing about whether sends are actually succeeding
   through it — a bad credential or a server-side decrypt failure falls
   back to the platform sender silently today, with nothing recorded
   anywhere a school admin or platform admin would ever see. Reported
   directly: schools with "Custom SMTP active" showing green in Settings
   still had parent communications arriving from the platform's own SMTP
   account, not the school's.

   These tests pin the fix: _sendAsSchool now records smtpLastError /
   smtpLastErrorAt on a real send failure, and smtpLastSuccessAt
   (clearing any prior error) on a real success, on the school doc
   itself — throttled per school so a broken credential failing on every
   send in a batch doesn't turn into a write storm.

   nodemailer is mocked so no real network/SMTP connection is made. The
   mock's sendMail behaviour is keyed off which account created the
   transporter (platform vs. the school's own smtpUser), so a "custom
   SMTP fails, platform fallback succeeds" scenario can be modelled
   precisely.
   ============================================================ */
'use strict';

process.env.SMTP_USER     = 'platform@example.com';
process.env.SMTP_PASS     = 'platformpass';
process.env.PLATFORM_EMAIL = 'platform@example.com';

let mockSchoolDoc      = null;
let mockUpdateOneCalls = [];
let mockSendMailImpl       = () => Promise.resolve({});

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
    updateOne: jest.fn((filter, update) => {
      mockUpdateOneCalls.push({ filter, update });
      return Promise.resolve({ matchedCount: 1 });
    }),
  })),
}));

jest.mock('../utils/smtpEncrypt', () => ({
  decrypt: jest.fn(() => 'decrypted-pass'),
  smtpEncryptReady: jest.fn(() => true),
}));

jest.mock('../utils/demo', () => ({ isDemoSchool: jest.fn(() => Promise.resolve(false)) }));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn((config) => ({
    sendMail: jest.fn((mailOpts) => mockSendMailImpl(config, mailOpts)),
  })),
}));

const { sendLoginOTP, invalidateSmtpCache } = require('../utils/email');

beforeEach(() => {
  mockSchoolDoc  = null;
  mockUpdateOneCalls = [];
  mockSendMailImpl   = () => Promise.resolve({});
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

const otp = (schoolId, email) => sendLoginOTP({
  name: 'Parent', email, otp: '123456', schoolName: 'Test School', schoolEmail: '', schoolId,
});

describe('_sendAsSchool — custom SMTP outcome tracking', () => {
  test('a successful custom-SMTP send records smtpLastSuccessAt and clears any prior error', async () => {
    invalidateSmtpCache('sch_ok');
    mockSchoolDoc = customSchool('sch_ok');
    mockSendMailImpl  = () => Promise.resolve({});

    const ok = await otp('sch_ok', 'a@parent.example');
    expect(ok).toBe(true);

    const call = mockUpdateOneCalls.find(c => c.filter.id === 'sch_ok');
    expect(call).toBeTruthy();
    expect(call.update.$set.smtpLastSuccessAt).toBeTruthy();
    expect(call.update.$unset).toEqual({ smtpLastError: 1, smtpLastErrorAt: 1 });
  });

  test('a failed custom-SMTP send records smtpLastError/smtpLastErrorAt, then still delivers via the platform fallback', async () => {
    invalidateSmtpCache('sch_fail');
    mockSchoolDoc = customSchool('sch_fail');
    mockSendMailImpl  = (config) => config.auth.user === 'school@test.example'
      ? Promise.reject(new Error('535 Authentication failed'))
      : Promise.resolve({});

    const ok = await otp('sch_fail', 'b@parent.example');
    expect(ok).toBe(true); // platform retry still delivers it to the parent

    const call = mockUpdateOneCalls.find(c => c.filter.id === 'sch_fail');
    expect(call).toBeTruthy();
    expect(call.update.$set.smtpLastError).toMatch(/Authentication failed/);
    expect(call.update.$set.smtpLastErrorAt).toBeTruthy();
  });

  test('throttled — a second failure for the same school within the window does not write again', async () => {
    invalidateSmtpCache('sch_throttle');
    mockSchoolDoc = customSchool('sch_throttle');
    mockSendMailImpl  = (config) => config.auth.user === 'school@test.example'
      ? Promise.reject(new Error('connection refused'))
      : Promise.resolve({});

    await otp('sch_throttle', 'c1@parent.example');
    expect(mockUpdateOneCalls.filter(c => c.filter.id === 'sch_throttle')).toHaveLength(1);

    await otp('sch_throttle', 'c2@parent.example');
    expect(mockUpdateOneCalls.filter(c => c.filter.id === 'sch_throttle')).toHaveLength(1); // still 1 — throttled
  });

  test('a school with custom SMTP never configured records nothing (no custom path was attempted)', async () => {
    invalidateSmtpCache('sch_none');
    mockSchoolDoc = { id: 'sch_none', name: 'Plain School', email: 'office@plain.example', systemEmail: null, smtpEnabled: false };

    await otp('sch_none', 'd@parent.example');
    expect(mockUpdateOneCalls.find(c => c.filter.id === 'sch_none')).toBeUndefined();
  });
});
