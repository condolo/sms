/* ============================================================
   Msingi — Notification Digest Cron

   Runs once daily. A school can configure any notification event's
   email to send as a daily digest instead of immediately
   (notif-settings.js's getFrequency()) — each occurrence lands in
   `notification_digests` (notify-dispatch.js) instead of triggering
   an email right away. This groups pending rows by {schoolId,userId},
   sends one combined email per recipient, then clears them.
   ============================================================ */
'use strict';

const cron  = require('node-cron');
const { _model } = require('./model');
const email = require('./email');

const CRON_DIGEST_DAILY = process.env.NOTIFICATION_DIGEST_CRON || '0 5 * * *'; // 08:00 Nairobi

async function runDigestSend() {
  const Digests = _model('notification_digests');
  const Schools = _model('schools');

  let pending;
  try {
    pending = await Digests.find({}).lean();
  } catch (err) {
    console.error('[notification-digest-cron] Failed to query pending digests:', err.message);
    return;
  }
  if (!pending.length) return;

  // Group by schoolId → userId → items
  const bySchool = new Map();
  for (const row of pending) {
    if (!bySchool.has(row.schoolId)) bySchool.set(row.schoolId, new Map());
    const byUser = bySchool.get(row.schoolId);
    if (!byUser.has(row.userId)) byUser.set(row.userId, []);
    byUser.get(row.userId).push(row);
  }

  console.log(`[notification-digest-cron] ${pending.length} pending item(s) across ${bySchool.size} school(s)`);

  for (const [schoolId, byUser] of bySchool) {
    let school;
    try {
      school = await Schools.findOne({ id: schoolId }).select('name systemEmail').lean();
    } catch (err) {
      console.error(`[notification-digest-cron] Failed to load school ${schoolId}:`, err.message);
      continue;
    }
    const schoolName  = school?.name || '';
    const schoolEmail = school?.systemEmail || '';

    for (const [, items] of byUser) {
      const sentIds = [];
      try {
        const { recipientName, recipientEmail } = items[0];
        if (!recipientEmail) continue;
        await email.sendDigestSummary({
          recipientName, recipientEmail,
          items: items.map(it => ({ subject: it.subject, body: it.body })),
          schoolName, schoolEmail, schoolId,
        });
        sentIds.push(...items.map(it => it.id));
      } catch (err) {
        console.error(`[notification-digest-cron] Failed to send digest for school ${schoolId}:`, err.message);
        continue; // leave these rows queued — they'll be retried (and merged with any new ones) tomorrow
      }
      try {
        await Digests.deleteMany({ id: { $in: sentIds } });
      } catch (err) {
        console.error(`[notification-digest-cron] Sent but failed to clear digest rows for school ${schoolId}:`, err.message);
      }
    }
  }
}

function startNotificationDigestCron() {
  if (!cron.validate(CRON_DIGEST_DAILY)) {
    console.error(`[notification-digest-cron] Invalid cron expression: ${CRON_DIGEST_DAILY}`);
    return;
  }
  cron.schedule(CRON_DIGEST_DAILY, runDigestSend, { timezone: 'UTC' });
  console.log(`[notification-digest-cron] Scheduled — ${CRON_DIGEST_DAILY} UTC · override via NOTIFICATION_DIGEST_CRON env var`);
}

module.exports = { startNotificationDigestCron, runDigestSend };
