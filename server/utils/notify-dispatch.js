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
const push  = require('./push');

async function dispatchNotification({
  ctx, schoolId, eventKey, actorUserId, recipients,
  inAppSubject, inAppBody, emailDigestSubject, emailDigestBody, sendEmail,
}) {
  for (const r of recipients || []) {
    if (!r?.userId) continue;
    try {
      const [inAppOn, emailOn, pushOn] = await Promise.all([
        notif.isEnabled(schoolId, eventKey, 'inApp'),
        notif.isEnabled(schoolId, eventKey, 'email'),
        notif.isEnabled(schoolId, eventKey, 'push'),
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

      /* Push is its own channel, deliberately independent of inApp and email:
         a school may want a phone buzz for a fee reminder and no email at all
         (that is the common case — most parents have no inbox they check).
         It fires AFTER the in-app record exists, because the notification is
         only a nudge: whatever the parent taps must already be there.
         Demo tenants are suppressed inside push.sendToUsers, never here. */
      if (pushOn && inAppSubject) {
        await push.sendToUsers({
          schoolId,
          userIds: [r.userId],
          title: inAppSubject,
          body:  inAppBody || inAppSubject,
          data:  { type: 'notification', eventKey },
        }).catch(() => {});
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
