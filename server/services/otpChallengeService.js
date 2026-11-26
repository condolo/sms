'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const challengeSchema = new mongoose.Schema({
  _id: String,
  codeHash: String,
  expiresAt: Date,
  attempts: Number,
  accounts: Array,
  lastSentAt: Date,
  sendTimes: [Date],
  consumedAt: Date,
}, { timestamps: true, id: false });
const OtpChallenge = mongoose.models.OtpChallenge
  || mongoose.model('OtpChallenge', challengeSchema, 'otp_challenges');

const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;
const LOGIN_OTP_MAX_ATTEMPTS = 5;
const LOGIN_OTP_RESEND_MS = 60 * 1000;
const LOGIN_OTP_MAX_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

/**
 * One authoritative challenge per normalized email address. The document is
 * claimed atomically on send and consumed atomically on verify, so a parent
 * with accounts at several schools cannot spend one code once per school.
 */
async function claimEmailCode(email, accounts, { codeHash, expiresAt, sentAt }) {
  const now = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const resendCutoff = new Date(now.getTime() - LOGIN_OTP_RESEND_MS);
  const claimId = crypto.randomUUID();
  const recentSends = {
    $filter: {
      input: { $ifNull: ['$sendTimes', []] },
      as: 'send',
      cond: { $gte: ['$$send', hourAgo] },
    },
  };
  const canSend = {
    $and: [
      { $or: [
        { $eq: [{ $ifNull: ['$lastSentAt', null] }, null] },
        { $lte: ['$lastSentAt', resendCutoff] },
      ] },
      { $lt: [{ $size: recentSends }, LOGIN_OTP_MAX_PER_HOUR] },
    ],
  };
  const whenClaimed = value => ({ $cond: [canSend, value, '$$REMOVE'] });
  const pipeline = [
    { $set: {
      claimId: whenClaimed(claimId),
      codeHash: { $cond: [canSend, codeHash, '$codeHash'] },
      expiresAt: { $cond: [canSend, expiresAt, '$expiresAt'] },
      attempts: { $cond: [canSend, 0, '$attempts'] },
      accounts: { $cond: [canSend, accounts, '$accounts'] },
      lastSentAt: { $cond: [canSend, now, '$lastSentAt'] },
      sendTimes: { $cond: [canSend, { $concatArrays: [recentSends, [now]] }, '$sendTimes'] },
    } },
    { $set: {
      consumedAt: { $cond: [canSend, '$$REMOVE', '$consumedAt'] },
    } },
  ];
  const upsert = () => OtpChallenge.findOneAndUpdate(
    { _id: email },
    pipeline,
    { upsert: true, returnDocument: 'after' },
  ).lean();
  let doc;
  try {
    doc = await upsert();
  } catch (err) {
    if (err.code !== 11000) throw err;
    doc = await upsert();
  }
  return doc?.claimId === claimId ? doc : null;
}

/**
 * Return the consumed challenge, or null for unknown, wrong, expired, consumed,
 * or attempt-capped codes. A wrong code increments the live challenge's attempt
 * counter without touching a newer challenge that may have replaced it.
 */
async function consumeEmailCode(email, codeHash, { schoolId = null } = {}) {
  const Challenges = OtpChallenge;
  const now = new Date();
  const challenge = await Challenges.findOne({ _id: email }).lean();
  if (!challenge?.codeHash || challenge.consumedAt || challenge.expiresAt <= now) return null;
  if ((challenge.attempts ?? 0) >= LOGIN_OTP_MAX_ATTEMPTS) return null;
  if (schoolId && !(challenge.accounts || []).some(account => account.schoolId === schoolId)) return null;
  const schoolFilter = schoolId ? { accounts: { $elemMatch: { schoolId } } } : {};

  if (challenge.codeHash !== codeHash) {
    await Challenges.updateOne(
      {
        _id: email,
        codeHash: challenge.codeHash,
        expiresAt: { $gt: now },
        consumedAt: { $exists: false },
        attempts: { $lt: LOGIN_OTP_MAX_ATTEMPTS },
        ...schoolFilter,
      },
      { $inc: { attempts: 1 } },
    );
    return null;
  }

  return Challenges.findOneAndUpdate(
    {
      _id: email,
      codeHash,
      expiresAt: { $gt: now },
      consumedAt: { $exists: false },
      attempts: { $lt: LOGIN_OTP_MAX_ATTEMPTS },
      ...schoolFilter,
    },
    { $set: { consumedAt: now }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).lean();
}

module.exports = {
  LOGIN_OTP_TTL_MS,
  LOGIN_OTP_MAX_ATTEMPTS,
  LOGIN_OTP_RESEND_MS,
  LOGIN_OTP_MAX_PER_HOUR,
  claimEmailCode,
  consumeEmailCode,
};
