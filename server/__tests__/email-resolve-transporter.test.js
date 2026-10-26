/* ============================================================
   server/utils/email.js — _resolveTransporter() Reply-To fallback
   chain (2026-10-26)

   Reported directly: "we set up email smtp for each school and
   sometimes i still get direct emails from the users in a particular
   system." Traced to `systemEmail` being read everywhere as the
   Reply-To fallback for the platform-SMTP path, but having no
   Settings UI field and not being in settings.js's PATCH whitelist —
   confirmed directly against production: every real school's
   `systemEmail` is null, with no way for an admin to ever set it. Any
   email sent via the platform-SMTP fallback (custom SMTP not
   configured, or it fails) therefore always had its Reply-To collapse
   to PLATFORM_EMAIL — the platform owner's own inbox — regardless of
   which school it was "from".

   This pins the fix: `school.email` (the school's own general contact
   address, which schools commonly do have set even without
   `systemEmail`) is now also tried before falling through to the
   platform's address.

   All DB calls mocked — no MongoDB required.
   ============================================================ */
'use strict';

process.env.SMTP_USER = 'platform@example.com';
process.env.SMTP_PASS = 'platformpass';
process.env.PLATFORM_EMAIL = 'platform@example.com';

let mockSchoolDoc = null;

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
  })),
}));

// Custom SMTP never configured for these schools in this file's tests —
// smtpEncryptReady() is irrelevant to the Reply-To fallback itself, but
// must exist so _resolveTransporter doesn't throw requiring the real module.
jest.mock('../utils/smtpEncrypt', () => ({
  decrypt: jest.fn(() => 'decrypted-pass'),
  smtpEncryptReady: jest.fn(() => false),
}));

const { _resolveTransporter, invalidateSmtpCache } = require('../utils/email');

beforeEach(() => {
  mockSchoolDoc = null;
});

describe('_resolveTransporter — Reply-To fallback chain', () => {
  test('no schoolId at all (platform-level email) — falls straight to PLATFORM_EMAIL', async () => {
    const r = await _resolveTransporter(null, { schoolName: 'Anyone' });
    expect(r.isCustom).toBe(false);
    expect(r.replyTo).toBe('platform@example.com');
  });

  test('schoolId given, caller passes an explicit schoolEmail — that wins over everything', async () => {
    invalidateSmtpCache('sch_1');
    mockSchoolDoc = { id: 'sch_1', email: 'office@school.example', systemEmail: null };
    const r = await _resolveTransporter('sch_1', { schoolName: 'Test School', schoolEmail: 'explicit@caller.example' });
    expect(r.replyTo).toBe('explicit@caller.example');
  });

  test("caller passes '' (the real students.js pattern: school.systemEmail || '') and systemEmail is unset — falls back to school.email, NOT the platform owner", async () => {
    invalidateSmtpCache('sch_2');
    mockSchoolDoc = { id: 'sch_2', email: 'admin@realschool.example', systemEmail: null };
    const r = await _resolveTransporter('sch_2', { schoolName: 'Real School', schoolEmail: '' });
    expect(r.replyTo).toBe('admin@realschool.example');
    expect(r.replyTo).not.toBe('platform@example.com');
  });

  test('systemEmail IS set — it wins over school.email (more specific than the general contact address)', async () => {
    invalidateSmtpCache('sch_3');
    mockSchoolDoc = { id: 'sch_3', email: 'general@school.example', systemEmail: 'notifications@school.example' };
    const r = await _resolveTransporter('sch_3', { schoolName: 'School', schoolEmail: '' });
    expect(r.replyTo).toBe('notifications@school.example');
  });

  test('neither systemEmail nor school.email is set — only then falls back to the platform address', async () => {
    invalidateSmtpCache('sch_4');
    mockSchoolDoc = { id: 'sch_4', email: null, systemEmail: null };
    const r = await _resolveTransporter('sch_4', { schoolName: 'New School', schoolEmail: '' });
    expect(r.replyTo).toBe('platform@example.com');
  });

  test('school lookup itself fails (DB error) — fails open to the platform address, never throws', async () => {
    invalidateSmtpCache('sch_5');
    const { _model } = require('../utils/model');
    _model.mockImplementationOnce(() => ({ findOne: () => ({ lean: () => Promise.reject(new Error('boom')) }) }));
    const r = await _resolveTransporter('sch_5', { schoolName: 'Flaky', schoolEmail: '' });
    expect(r.isCustom).toBe(false);
    expect(r.replyTo).toBe('platform@example.com');
  });

  test('a cached result is reused, but an explicit per-call schoolEmail still overrides the cached replyTo', async () => {
    invalidateSmtpCache('sch_6');
    mockSchoolDoc = { id: 'sch_6', email: 'cached@school.example', systemEmail: null };
    const first  = await _resolveTransporter('sch_6', { schoolName: 'Cache Test', schoolEmail: '' });
    expect(first.replyTo).toBe('cached@school.example');

    // Second call within TTL — even if the DB doc changed, the cache wins
    // unless this call passes its own explicit override.
    mockSchoolDoc = { id: 'sch_6', email: 'changed@school.example', systemEmail: null };
    const second = await _resolveTransporter('sch_6', { schoolName: 'Cache Test', schoolEmail: '' });
    expect(second.replyTo).toBe('cached@school.example'); // still the cached value, not re-queried

    const overridden = await _resolveTransporter('sch_6', { schoolName: 'Cache Test', schoolEmail: 'override@caller.example' });
    expect(overridden.replyTo).toBe('override@caller.example');
  });
});
