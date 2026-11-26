'use strict';

/**
 * The one place that decides which `users` fields may leave the server.
 *
 * `password`/`passwordHash`/`pinHash` are bcrypt, but `mfaOtp` and `loginOtp`
 * are plain SHA-256 of a six-digit code. A six-digit space is only 1,000,000
 * values, so that hash is reversible in well under a second — returning it
 * hands an attacker the current second factor. Every auth response must build
 * its user through `safeUser()`; never spread a raw user document into JSON.
 *
 * Keep this list exhaustive: a new credential or one-time-code field belongs
 * here the same day it is added to the `users` document.
 */
const USER_SECRET_FIELDS = Object.freeze([
  'password',
  'passwordHash',
  'pinHash',
  'tempPassword',
  'twoFactorSecret',
  'mfaSecret',
  'mfaOtp',
  'mfaExpiry',
  'loginOtp',
  'loginOtpExpiry',
  'loginOtpAttempts',
  'loginOtpSentAt',
  'loginOtpSends',
  'resetToken',
  'resetTokenExpiry',
  'resetExpires',
  'passwordResetToken',
  'passwordResetExpires',
  'emailVerificationToken',
  'verificationToken',
]);

function safeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const safe = { ...user };
  for (const field of USER_SECRET_FIELDS) delete safe[field];
  return safe;
}

module.exports = { safeUser, USER_SECRET_FIELDS };
