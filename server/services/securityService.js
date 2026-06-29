'use strict';

const { _model }           = require('../utils/model');
const { sendSecurityAlert } = require('../utils/email');

/* ── Progressive lockout tiers ──────────────────────────────────
   Evaluated in descending threshold order — highest tier wins.
   WINDOW_MS: rolling window for counting failures (24 h).
   ─────────────────────────────────────────────────────────────── */
const TIERS = [
  { threshold: 30, durationMs: 24 * 60 * 60 * 1000, label: '24 hours' },
  { threshold: 20, durationMs:      60 * 60 * 1000, label: '1 hour'   },
  { threshold: 10, durationMs:  15 * 60 * 1000,     label: '15 minutes' },
  { threshold:  5, durationMs:       60 * 1000,      label: '1 minute'  },
];

const WINDOW_MS    = 24 * 60 * 60 * 1000;        // failure counting window
const TTL_BUFFER   = 60 * 60 * 1000;             // extra hour after window for cleanup
const AUDIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;  // security_events kept for 90 days

/* Ensure TTL indexes exist — idempotent, safe on every startup */
(async () => {
  try {
    await _model('login_failures').collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true, name: 'ttl_expiry' },
    );
    await _model('security_events').collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true, name: 'ttl_expiry' },
    );
  } catch (e) {
    console.error('[SecurityService] TTL index init:', e.message);
  }
})();

function _key(schoolId, loginId) { return `fail:${schoolId}:${loginId}`; }

function _activeTier(count) {
  for (const tier of TIERS) {
    if (count >= tier.threshold) return tier;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────
   checkAccountLock(schoolId, loginId)
   Returns seconds remaining in the lockout, or null if unlocked.
   Fails open on DB error — a DB hiccup should not lock out users.
   ───────────────────────────────────────────────────────────────── */
async function checkAccountLock(schoolId, loginId) {
  try {
    const doc = await _model('login_failures')
      .findOne({ key: _key(schoolId, loginId) })
      .lean();

    if (!doc) return null;

    if (doc.lockedUntil && new Date(doc.lockedUntil) > new Date()) {
      return Math.ceil((new Date(doc.lockedUntil) - Date.now()) / 1000);
    }
    return null;
  } catch (e) {
    console.error('[SecurityService.checkAccountLock]', e.message);
    return null;  // fail open — don't block legitimate logins on DB error
  }
}

/* ─────────────────────────────────────────────────────────────────
   recordFail(schoolId, loginId, ip, school)
   Increments the failure count.  Applies the appropriate progressive
   lockout tier.  Logs a security_event.  Notifies the school admin
   when the 30-failure threshold is crossed (and every 10 after that).
   ───────────────────────────────────────────────────────────────── */
async function recordFail(schoolId, loginId, ip, school = {}) {
  try {
    const now         = new Date();
    const windowFloor = new Date(Date.now() - WINDOW_MS);

    // Atomically increment within the current 24-hour window
    let doc = await _model('login_failures').findOneAndUpdate(
      { key: _key(schoolId, loginId), windowStart: { $gte: windowFloor } },
      {
        $inc: { count: 1 },
        $set: {
          lastIp:    ip,
          updatedAt: now,
          expiresAt: new Date(Date.now() + WINDOW_MS + TTL_BUFFER),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    if (!doc) {
      // No doc in the current window — start fresh (delete stale first)
      await _model('login_failures').deleteOne({ key: _key(schoolId, loginId) });
      const created = await _model('login_failures').create({
        key:         _key(schoolId, loginId),
        schoolId,
        loginId,
        count:       1,
        windowStart: now,
        lastIp:      ip,
        updatedAt:   now,
        expiresAt:   new Date(Date.now() + WINDOW_MS + TTL_BUFFER),
      });
      doc = created.toObject ? created.toObject() : created;
    }

    const count    = doc.count ?? 1;
    const tier     = _activeTier(count);
    const prevTier = _activeTier(count - 1);

    // Apply lockout if we crossed (or stayed in) a tier
    let lockedUntil = null;
    if (tier) {
      lockedUntil = new Date(Date.now() + tier.durationMs);
      await _model('login_failures').updateOne(
        { key: _key(schoolId, loginId) },
        { $set: { lockedUntil } },
      );
    }

    // Log security event
    const isTierCrossed = tier && tier !== prevTier;
    await _model('security_events').create({
      type:           isTierCrossed ? 'LOGIN_LOCKOUT' : 'LOGIN_FAILURE',
      schoolId,
      loginId,
      ip,
      count,
      lockDurationMs: tier ? tier.durationMs : null,
      lockLabel:      tier ? tier.label       : null,
      lockedUntil:    lockedUntil ? lockedUntil.toISOString() : null,
      timestamp:      now.toISOString(),
      expiresAt:      new Date(Date.now() + AUDIT_TTL_MS),
    }).catch(e => console.error('[SecurityService] audit log write failed:', e.message));

    // Notify school admins at 30 failures and every 10 after that
    if (count >= 30 && count % 10 === 0) {
      _notifyAdmins(schoolId, loginId, count, ip, school).catch(() => {});
    }
  } catch (e) {
    console.error('[SecurityService.recordFail]', e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────
   clearFail(schoolId, loginId)
   Called on successful authentication.  Removes the failure record
   so the user starts with a clean slate on the next attempt.
   ───────────────────────────────────────────────────────────────── */
async function clearFail(schoolId, loginId) {
  try {
    await _model('login_failures').deleteOne({ key: _key(schoolId, loginId) });
  } catch (e) {
    console.error('[SecurityService.clearFail]', e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────
   _notifyAdmins — emails all active admin accounts in the school
   ───────────────────────────────────────────────────────────────── */
async function _notifyAdmins(schoolId, loginId, count, ip, school) {
  const admins = await _model('users').find({
    schoolId,
    role:     { $in: ['admin', 'superadmin'] },
    isActive: true,
  }).select('email name').lean();

  for (const admin of admins) {
    await sendSecurityAlert({
      adminEmail:  admin.email,
      adminName:   admin.name,
      schoolName:  school.name  || schoolId,
      schoolEmail: school.systemEmail || null,
      schoolId,
      loginId,
      count,
      ip,
    }).catch(e => console.error('[SecurityService._notifyAdmins]', e.message));
  }
}

module.exports = { checkAccountLock, recordFail, clearFail };
