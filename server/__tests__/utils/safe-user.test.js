'use strict';

/* ============================================================
   safe-user.js — the single user-serialization boundary.

   Regression guard for the production finding on 2026-11-26:
   auth responses spread the raw Mongo user document, so
   `mfaOtp`/`loginOtp` (unsalted SHA-256 of a six-digit code)
   went out to the client. A six-digit space is reversible in
   under a second, so those fields must never serialize.
   ============================================================ */

const { safeUser, USER_SECRET_FIELDS } = require('../../utils/safe-user');

const RAW = {
  _id: '507f1f77bcf86cd799439011',
  id: 'usr_1',
  email: 'a@example.com',
  name: 'Amina',
  role: 'admin',
  roles: ['admin'],
  isActive: true,
  passwordChangedAt: '2026-01-01T00:00:00.000Z',
  password: 'bcrypt-password',
  passwordHash: 'legacy-bcrypt-password',
  pinHash: 'bcrypt-pin',
  tempPassword: 'TempPass123!',
  twoFactorSecret: 'totp-secret',
  mfaSecret: 'mfa-secret',
  mfaOtp: 'a'.repeat(64),
  mfaExpiry: '2026-11-26T12:00:00.000Z',
  loginOtp: 'b'.repeat(64),
  loginOtpExpiry: '2026-11-26T12:00:00.000Z',
  loginOtpAttempts: 2,
  loginOtpSentAt: '2026-11-26T11:55:00.000Z',
  loginOtpSends: ['2026-11-26T11:55:00.000Z'],
  resetToken: 'reset-token',
  resetTokenExpiry: '2026-11-26T12:00:00.000Z',
  resetExpires: '2026-11-26T12:00:00.000Z',
  passwordResetToken: 'password-reset-token',
  passwordResetExpires: '2026-11-26T12:00:00.000Z',
  emailVerificationToken: 'email-verification-token',
  verificationToken: 'verification-token',
};

describe('safeUser', () => {
  test('removes every credential and one-time-code field', () => {
    const safe = safeUser(RAW);

    for (const field of USER_SECRET_FIELDS) {
      expect(safe).not.toHaveProperty(field);
    }

    expect(safe).toMatchObject({
      _id: RAW._id,
      id: 'usr_1',
      email: 'a@example.com',
      name: 'Amina',
      role: 'admin',
      roles: ['admin'],
      isActive: true,
      passwordChangedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('does not mutate the input document', () => {
    const copy = structuredClone(RAW);
    safeUser(RAW);
    expect(RAW).toEqual(copy);
  });

  test('returns non-objects unchanged', () => {
    expect(safeUser(null)).toBeNull();
    expect(safeUser(undefined)).toBeUndefined();
  });
});
