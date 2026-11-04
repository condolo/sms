/* ============================================================
   Msingi — the app-lock PIN, stored on the account.

   The PIN is not authentication: Google / email OTP already decided who
   the user is. It is what stops a handed-over phone from opening receipts
   and message previews, and storing it on the account is what keeps the
   same lock after a reinstall or on a second device.

   The rules that follow from that:
     • every route requires a signed-in session (authMiddleware);
     • a wrong PIN answers 400, never 401 — the app's HTTP client treats
       401 as an expired session and would sign the user out;
     • five wrong attempts lock the PIN for 15 minutes, server-side, so
       the 10,000-value space cannot be walked from one stolen session;
     • the hash is bcrypt — a database dump yields no PIN to type.
   ============================================================ */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { authMiddleware } = require('../middleware/auth');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { pinProblem } = require('../utils/pin-policy');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const BCRYPT_COST = 10;

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Sized like the login limiter: a school's shared WiFi puts many people
  // behind one IP, and each app open makes two PIN calls. The per-account
  // 5-attempt lock is what actually stops guessing; this only stops scripts.
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many PIN attempts — please wait 15 minutes.' } },
  skip: () => process.env.NODE_ENV === 'test',
});

router.use(authMiddleware);
router.use(pinLimiter);

function _lockMinutesLeft(user, now = Date.now()) {
  const until = user?.pinLockedUntil ? new Date(user.pinLockedUntil).getTime() : 0;
  if (!Number.isFinite(until) || until <= now) return 0;
  return Math.max(1, Math.ceil((until - now) / 60000));
}

function _attemptsLeft(user) {
  if (_lockMinutesLeft(user) > 0) return 0;
  return Math.max(0, MAX_ATTEMPTS - (user.pinFailedAttempts || 0));
}

async function _loadUser(req) {
  const ctx = tenantContext(req);
  const User = tenantModel('users', ctx);
  const user = await User.findOne({ id: req.jwtUser.userId, schoolId: req.jwtUser.schoolId }).lean();
  return { User, user };
}

/**
 * Compare a PIN and apply the lockout. Returns null on a match, or the
 * ready-to-send error response on a miss or while locked.
 */
async function _checkPin(User, user, pin, now) {
  const lockedFor = _lockMinutesLeft(user, now);
  if (lockedFor > 0) {
    return {
      status: 423,
      body: {
        error: {
          code: 'PIN_LOCKED',
          message: `Too many wrong PINs. Try again in ${lockedFor} minute${lockedFor === 1 ? '' : 's'}.`,
          retryAfter: lockedFor * 60,
        },
      },
    };
  }

  const match = typeof pin === 'string' && pin.length > 0 && user.pinHash
    ? await bcrypt.compare(pin, user.pinHash)
    : false;
  if (match) return null;

  const attempts = (user.pinFailedAttempts || 0) + 1;
  const locked = attempts >= MAX_ATTEMPTS;
  await User.updateOne(
    { id: user.id, schoolId: user.schoolId },
    {
      $set: locked
        ? { pinFailedAttempts: 0, pinLockedUntil: new Date(now + LOCK_MS).toISOString() }
        : { pinFailedAttempts: attempts },
    }
  );

  if (locked) {
    const minutes = Math.round(LOCK_MS / 60000);
    return {
      status: 423,
      body: {
        error: {
          code: 'PIN_LOCKED',
          message: `Too many wrong PINs. Try again in ${minutes} minutes.`,
          retryAfter: LOCK_MS / 1000,
        },
      },
    };
  }

  return {
    status: 400,
    body: {
      error: {
        code: 'PIN_WRONG',
        message: 'That PIN is not right.',
        attemptsRemaining: MAX_ATTEMPTS - attempts,
      },
    },
  };
}

/* ── GET /api/auth/pin — is a PIN set, and is it locked? ─────────── */
router.get('/', async (req, res) => { // rbac: account-level (your OWN app-lock PIN) — no module grant can express it; user comes from req.jwtUser only
  try {
    const { user } = await _loadUser(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      success: true,
      data: {
        enabled: Boolean(user.pinHash),
        lockedForMinutes: _lockMinutesLeft(user),
        attemptsRemaining: user.pinHash ? _attemptsLeft(user) : MAX_ATTEMPTS,
      },
    });
  } catch (err) {
    console.error('[auth/pin] status failed:', err.message);
    res.status(500).json({ error: 'Failed to read the PIN status' });
  }
});

/* ── POST /api/auth/pin — set it, or change it with the old one ──── */
router.post('/', async (req, res) => { // rbac: account-level (your OWN app-lock PIN) — see GET / above
  try {
    const { pin, currentPin } = req.body || {};
    const problem = pinProblem(pin);
    if (problem) {
      return res.status(400).json({ error: { code: 'PIN_WEAK', message: problem } });
    }

    const { User, user } = await _loadUser(req);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.pinHash) {
      if (!currentPin) {
        return res.status(400).json({
          error: { code: 'PIN_CURRENT_REQUIRED', message: 'Enter your current PIN to change it.' },
        });
      }
      const failure = await _checkPin(User, user, currentPin, Date.now());
      if (failure) return res.status(failure.status).json(failure.body);
    }

    const hash = await bcrypt.hash(pin, BCRYPT_COST);
    await User.updateOne(
      { id: user.id, schoolId: user.schoolId },
      {
        $set: {
          pinHash: hash,
          pinSetAt: new Date().toISOString(),
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        },
      }
    );
    res.json({ success: true, data: { enabled: true } });
  } catch (err) {
    console.error('[auth/pin] set failed:', err.message);
    res.status(500).json({ error: 'Failed to save the PIN' });
  }
});

/* ── POST /api/auth/pin/verify — the unlock check ─────────────────
   No session is minted here: the caller already holds one. This only
   answers whether the PIN is right, so it cannot become a login path
   for the 10,000-value space. */
router.post('/verify', async (req, res) => { // rbac: account-level (your OWN app-lock PIN) — no session is minted; the caller only checks their own
  try {
    const { pin } = req.body || {};
    if (typeof pin !== 'string' || pin.length === 0) {
      return res.status(400).json({ error: { code: 'PIN_REQUIRED', message: 'Enter your PIN.' } });
    }

    const { User, user } = await _loadUser(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.pinHash) {
      return res.status(409).json({ error: { code: 'PIN_NOT_SET', message: 'No PIN is set on this account.' } });
    }

    const failure = await _checkPin(User, user, pin, Date.now());
    if (failure) return res.status(failure.status).json(failure.body);

    await User.updateOne(
      { id: user.id, schoolId: user.schoolId },
      { $set: { pinFailedAttempts: 0, pinLockedUntil: null } }
    );
    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    console.error('[auth/pin] verify failed:', err.message);
    res.status(500).json({ error: 'Failed to check the PIN' });
  }
});

/* ── POST /api/auth/pin/forgot — remove a forgotten PIN ──────────
   The app sends this only after the user has signed in again with OTP or
   password, which is control of the account. The PIN was never a data
   permission — the session can already read everything it gates — so
   re-authentication is the right bar for removing it, and a forgotten
   4-digit code can never become a permanent lock-out. */
router.post('/forgot', async (req, res) => { // rbac: account-level (your OWN app-lock PIN) — removal is about control of this account
  try {
    const { User, user } = await _loadUser(req);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await User.updateOne(
      { id: user.id, schoolId: user.schoolId },
      {
        $unset: { pinHash: '', pinSetAt: '' },
        $set: { pinFailedAttempts: 0, pinLockedUntil: null },
      }
    );
    res.json({ success: true, data: { enabled: false } });
  } catch (err) {
    console.error('[auth/pin] forgot failed:', err.message);
    res.status(500).json({ error: 'Failed to reset the PIN' });
  }
});

/* ── DELETE /api/auth/pin — turning the lock off ──────────────────
   The current PIN is required: turning the lock off is exactly what a
   handed-over phone would try first. */
router.delete('/', async (req, res) => { // rbac: account-level (your OWN app-lock PIN) — current PIN required, see below
  try {
    const { pin } = req.body || {};
    const { User, user } = await _loadUser(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.pinHash) {
      return res.status(409).json({ error: { code: 'PIN_NOT_SET', message: 'No PIN is set on this account.' } });
    }
    if (typeof pin !== 'string' || pin.length === 0) {
      return res.status(400).json({ error: { code: 'PIN_REQUIRED', message: 'Enter your PIN.' } });
    }

    const failure = await _checkPin(User, user, pin, Date.now());
    if (failure) return res.status(failure.status).json(failure.body);

    await User.updateOne(
      { id: user.id, schoolId: user.schoolId },
      {
        $unset: { pinHash: '', pinSetAt: '' },
        $set: { pinFailedAttempts: 0, pinLockedUntil: null },
      }
    );
    res.json({ success: true, data: { enabled: false } });
  } catch (err) {
    console.error('[auth/pin] delete failed:', err.message);
    res.status(500).json({ error: 'Failed to turn the PIN off' });
  }
});

module.exports = router;
