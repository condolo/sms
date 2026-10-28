/* ============================================================
   Push notifications — FCM HTTP v1 via firebase-admin.

   Shares one service account with Google sign-in (utils/firebase.js), so a
   deployment configures Firebase once and both features come alive.

   Two rules this module exists to enforce:

   1. A DEMO tenant never pushes to a real device. Demo schools are cloned
      from the sales demo and are full of fictional parents with fictional
      phone numbers — a "your fees are overdue" push reaching a real person's
      phone from a demo is exactly the kind of thing that ends a school's
      trust in the product. Same suppression the email layer already applies
      (utils/email.js), applied here at the source.
   2. A dead token is deleted, not retried forever. FCM tells us plainly
      which tokens are gone; keeping them would mean every send reports a
      growing failure count that nobody can act on.

   Delivery is best-effort by design: callers pass notifications as a side
   effect of something that already succeeded (a message was sent, a notice
   was posted). A push failure must never fail that action.
   ============================================================ */
'use strict';

const crypto = require('crypto');
const { _model } = require('./model');
const { getFirebaseAdmin } = require('./firebase');
const { isDemoSchool } = require('./demo');

const COLLECTION = 'mobile_devices';

/** Tokens we know FCM has retired — no point keeping them. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/* ── Device registry ───────────────────────────────────────────── */

/**
 * Register (or refresh) one device token for a user.
 * A token belongs to a device, not an account: the same phone signing in as a
 * different user must MOVE ownership, never end up notified for both.
 */
async function registerDevice({ userId, schoolId, token, platform = 'android', appVersion = null, deviceName = null }) {
  if (!userId || !schoolId || !token) return null;
  const Devices = _model(COLLECTION);
  const now = new Date().toISOString();
  const existing = await Devices.findOne({ token }).lean();

  if (existing) {
    await Devices.updateOne({ id: existing.id }, { $set: {
      userId, schoolId, platform, appVersion: appVersion || existing.appVersion || null,
      deviceName: deviceName || existing.deviceName || null,
      lastSeenAt: now, updatedAt: now,
    } });
    return existing.id;
  }

  const id = `dev_${crypto.randomUUID()}`;
  await Devices.create({
    id, userId, schoolId, token, platform, appVersion, deviceName,
    lastSeenAt: now, createdAt: now, updatedAt: now,
  });
  return id;
}

/** Forget a device (sign-out, or the app telling us the token rotated away). */
async function unregisterDevice({ schoolId, token }) {
  if (!token) return 0;
  const res = await _model(COLLECTION).deleteMany({ token, ...(schoolId ? { schoolId } : {}) });
  return res?.deletedCount ?? 0;
}

async function tokensForUsers({ schoolId, userIds }) {
  const Devices = _model(COLLECTION);
  const query = { schoolId, ...(userIds?.length ? { userId: { $in: userIds } } : {}) };
  const rows = await Devices.find(query).select('token').lean();
  return [...new Set(rows.map((r) => r.token).filter(Boolean))];
}

/* ── Sending ───────────────────────────────────────────────────── */

/**
 * Send one notification to a set of device tokens.
 * Returns a summary rather than throwing — callers are mid-flow.
 */
async function sendToTokens({ tokens, title, body, data }) {
  const list = [...new Set((tokens ?? []).filter(Boolean))];
  if (!list.length) return { sent: 0, failed: 0, invalidTokens: [], skipped: 'no_devices' };

  const admin = getFirebaseAdmin();
  if (!admin) return { sent: 0, failed: 0, invalidTokens: [], skipped: 'not_configured' };

  // FCM data values must be strings.
  const stringData = data
    ? Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))
    : undefined;

  try {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: list,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high', notification: { channelId: 'default' } },
    });

    const invalidTokens = [];
    res.responses.forEach((r, i) => {
      if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) invalidTokens.push(list[i]);
    });

    if (invalidTokens.length) {
      await _model(COLLECTION).deleteMany({ token: { $in: invalidTokens } }).catch(() => {});
      console.warn(`[push] pruned ${invalidTokens.length} dead device token(s)`);
    }

    return { sent: res.successCount ?? 0, failed: res.failureCount ?? 0, invalidTokens };
  } catch (err) {
    console.error('[push] send failed:', err.message);
    return { sent: 0, failed: list.length, invalidTokens: [], skipped: 'error' };
  }
}

/** Send to specific users of one school, honouring the demo-tenant rule. */
async function sendToUsers({ schoolId, userIds, title, body, data }) {
  if (!schoolId) return { sent: 0, failed: 0, invalidTokens: [], skipped: 'no_school' };

  if (await isDemoSchool(schoolId).catch(() => false)) {
    console.warn(`[push] demo tenant ${schoolId}: "${title}" suppressed.`);
    return { sent: 0, failed: 0, invalidTokens: [], skipped: 'demo_tenant' };
  }

  const tokens = await tokensForUsers({ schoolId, userIds });
  return sendToTokens({ tokens, title, body, data });
}

module.exports = {
  registerDevice,
  unregisterDevice,
  tokensForUsers,
  sendToTokens,
  sendToUsers,
};
