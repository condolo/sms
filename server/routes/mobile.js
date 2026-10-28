/* ============================================================
   Mobile platform API — /api/mobile

   Everything the app needs that is NOT school data:
     GET    /bootstrap          public  — force-update gate + maintenance flag
     POST   /devices     authenticated  — register this phone for push
     DELETE /devices/:token     authenticated  — forget it on sign-out

   Bootstrap is public on purpose: the app must be able to learn "you are too
   old, here is the update" BEFORE it can authenticate — otherwise a broken
   build has no way to tell its user what happened.
   ============================================================ */
'use strict';

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const push = require('../utils/push');

const router = express.Router();

/* ── GET /api/mobile/bootstrap ─────────────────────────────────── */
router.get('/bootstrap', (req, res) => {
  const maintenanceOn = process.env.MOBILE_MAINTENANCE === '1' || process.env.MOBILE_MAINTENANCE === 'true';
  res.json({
    success: true,
    data: {
      minSupportedVersion: process.env.MOBILE_MIN_VERSION || '1.0.0',
      updateUrl: process.env.MOBILE_UPDATE_URL || null,
      serverTime: new Date().toISOString(),
      maintenance: maintenanceOn
        ? { active: true, message: process.env.MOBILE_MAINTENANCE_MESSAGE || 'Msingi is being updated. Please try again shortly.' }
        : { active: false },
    },
  });
});

/* ── POST /api/mobile/devices ──────────────────────────────────── */
router.post('/devices', authMiddleware, async (req, res) => {
  try {
    const { token, platform, appVersion, deviceName } = req.body ?? {};
    if (!token || typeof token !== 'string' || token.length < 20) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'A device token is required.' } });
    }

    const id = await push.registerDevice({
      userId: req.jwtUser.userId,
      schoolId: req.jwtUser.schoolId,
      token,
      platform: platform === 'ios' ? 'ios' : 'android',
      appVersion: typeof appVersion === 'string' ? appVersion.slice(0, 32) : null,
      deviceName: typeof deviceName === 'string' ? deviceName.slice(0, 64) : null,
    });

    return res.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[mobile POST /devices]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Could not register this device.' } });
  }
});

/* ── DELETE /api/mobile/devices/:token ─────────────────────────── */
router.delete('/devices/:token', authMiddleware, async (req, res) => {
  try {
    // Scoped to the caller's own school AND their own tokens: a leaked token
    // string must not let someone unsubscribe another school's parent.
    const removed = await push.unregisterDevice({ schoolId: req.jwtUser.schoolId, token: req.params.token });
    return res.json({ success: true, data: { removed } });
  } catch (err) {
    console.error('[mobile DELETE /devices]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Could not remove this device.' } });
  }
});

module.exports = router;
