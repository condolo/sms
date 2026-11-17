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

/* ── System in-app messages: taxonomy + write-time coalescing ──

   Every automated notification used to land as an ordinary
   type:'direct' message indistinguishable from a human's, with no
   link to the student/class/route it is about. A timetable publish
   that moved 15 lessons then wrote 15 separate rows per guardian —
   the "inbox minus the noise" promise broke at the write, not the
   render.

   Two fields fix the taxonomy at the source:
     kind          'system' for automated rows, absent for human ones —
                   an inbox can split or style them without pattern-
                   matching subjects.
     systemEventKey  the notif-settings event that produced the row
                   (timetable_change, attendance_summary, …), plus
                   studentId/classId/entityId linkage when the caller
                   has one.

   And one behaviour: when the caller passes coalesceKey, a second
   event with the SAME key for the SAME recipient on the SAME day
   appends its lines to the existing message instead of creating a
   new row. A day's timetable edits become one message listing every
   change; duplicate daily summaries collapse into the first. The
   body is capped — a run-away key degrades to a new row, never an
   unbounded document. */
const SYSTEM_BODY_CAP = 8_000;

function _dayStartUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Create a system in-app message, or append to today's coalesced one.
 * Returns the document written (the survivor). Callers that need the
 * created row's id for push data get it either way.
 */
async function createSystemMessage({
  ctx, schoolId, eventKey, senderId = 'system',
  recipientUserId, subject, body,
  coalesceKey = null, meta = null,
}) {
  const Msg = tenantModel('messages', ctx);
  const extra = {
    kind: 'system',
    systemEventKey: eventKey,
    ...(meta && typeof meta === 'object' ? meta : {}),
  };

  if (coalesceKey) {
    const dayStart = _dayStartUTC();
    const existing = await Msg.findOne({
      schoolId,
      senderRole: 'system',
      kind: 'system',
      systemEventKey: eventKey,
      coalesceKey,
      recipients: recipientUserId,
      createdAt: { $gte: dayStart },
    }).sort({ createdAt: -1 }).lean();

    if (existing) {
      const combined = existing.body
        ? `${existing.body}\n${body}`
        : body;
      if (combined.length > SYSTEM_BODY_CAP) {
        // Degrade to a fresh row rather than grow without bound; the
        // reader sees a continuation message instead of a truncated one.
      } else {
        await Msg.updateOne(
          { id: existing.id, schoolId },
          { $set: { body: combined, updatedAt: new Date().toISOString() } },
        );
        return { ...existing, body: combined, coalesced: true };
      }
    }
  }

  const doc = await Msg.create({
    id: uuidv4(),
    schoolId,
    senderId,
    senderName: 'System',
    senderRole: 'system',
    recipients: [recipientUserId],
    subject,
    body: body || subject,
    type: 'direct',
    isRead: {},
    ...(coalesceKey ? { coalesceKey } : {}),
    ...extra,
    createdAt: new Date().toISOString(),
  });
  return doc.toObject ? doc.toObject() : doc;
}

async function dispatchNotification({
  ctx, schoolId, eventKey, actorUserId, recipients,
  inAppSubject, inAppBody, emailDigestSubject, emailDigestBody, sendEmail,
  /* Optional: coalesceKey (see createSystemMessage) and meta linkage
     ({ studentId, classId, entityId }) stamped on the in-app row. */
  coalesceKey, meta,
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
        await createSystemMessage({
          ctx, schoolId, eventKey, senderId: actorUserId || 'system',
          recipientUserId: r.userId,
          subject: inAppSubject, body: inAppBody || inAppSubject,
          coalesceKey, meta,
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

module.exports = { dispatchNotification, createSystemMessage, SYSTEM_BODY_CAP };
