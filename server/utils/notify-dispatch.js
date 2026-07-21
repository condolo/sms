/* ============================================================
   Msingi — Notification Dispatch

   Central per-event fan-out: resolves a school's configured channel +
   frequency (notif-settings.js) for each recipient, then:
     - writes an in-app message (existing `messages` collection), and/or
     - sends the email immediately, or
     - queues it into `notification_digests` for the once-daily batch
       (notification-digest-cron.js) — the school's own choice per event,
       never hardcoded per caller.

   One dispatch helper, reused by every trigger site, instead of each
   route re-implementing the enabled/frequency branching independently.

   Usage:
     const { dispatchNotification } = require('../utils/notify-dispatch');
     await dispatchNotification({
       ctx, schoolId, eventKey: 'behaviour_incident', actorUserId,
       recipients: [{ userId, name, email }],
       inAppSubject, inAppBody,
       emailDigestSubject, emailDigestBody,   // used only if frequency='daily_digest'
       sendEmail: (recipient) => email.sendBehaviourIncidentAlert({ ... }),
     });
   ============================================================ */
const { v4: uuidv4 } = require('uuid');
const { tenantModel } = require('./tenant-model');
const notif = require('./notif-settings');

async function dispatchNotification({
  ctx, schoolId, eventKey, actorUserId, recipients,
  inAppSubject, inAppBody, emailDigestSubject, emailDigestBody, sendEmail,
}) {
  for (const r of recipients || []) {
    if (!r?.userId) continue;
    try {
      const [inAppOn, emailOn] = await Promise.all([
        notif.isEnabled(schoolId, eventKey, 'inApp'),
        notif.isEnabled(schoolId, eventKey, 'email'),
      ]);

      if (inAppOn && inAppSubject) {
        await tenantModel('messages', ctx).create({
          id: uuidv4(),
          schoolId,
          senderId:   actorUserId || 'system',
          senderName: 'System',
          senderRole: 'system',
          recipients: [r.userId],
          subject:    inAppSubject,
          body:       inAppBody || inAppSubject,
          type:       'direct',
          isRead:     {},
          createdAt:  new Date().toISOString(),
        });
      }

      if (emailOn && r.email) {
        const frequency = await notif.getFrequency(schoolId, eventKey);
        if (frequency === 'daily_digest') {
          await tenantModel('notification_digests', ctx).create({
            id: uuidv4(),
            schoolId,
            userId:         r.userId,
            recipientEmail: r.email,
            recipientName:  r.name || '',
            eventKey,
            subject: emailDigestSubject || inAppSubject,
            body:    emailDigestBody || inAppBody,
            createdAt: new Date().toISOString(),
          });
        } else if (sendEmail) {
          await sendEmail(r);
        }
      }
    } catch (err) {
      // One recipient failing must never block the others or the
      // caller's own request — same "must never break other work"
      // discipline as AuditService.log().
      console.error(`[notify-dispatch] ${eventKey} → ${r.userId} failed:`, err.message);
    }
  }
}

module.exports = { dispatchNotification };
