/* ============================================================
   Msingi — Notify Students' Guardians (fan-out helper)

   Every parent-facing notification event (behaviour incidents,
   report cards, exam results, invoices, absences) resolves the same
   way: given a studentId, find that student's parent(s)/guardian(s)
   (`users.studentIds` — the relationship `students.js` writes on
   Link Parent) and dispatch through notify-dispatch.js. This is that
   one shared resolution, reused by every trigger site instead of
   each route re-implementing the guardian lookup independently.

   Some events are inherently bulk (report cards published for a
   whole class, a class marked absent) — `items` accepts one entry
   per student so each guardian gets a message scoped to their own
   child, not a generic broadcast.
   ============================================================ */
const { tenantModel } = require('./tenant-model');
const { dispatchNotification } = require('./notify-dispatch');

/**
 * @param {object} opts
 * @param {object} opts.ctx - tenant context ({schoolId})
 * @param {string} opts.schoolId
 * @param {string} opts.eventKey - notif-settings.js EVENT_REGISTRY key
 * @param {Array<{studentId, inAppSubject, inAppBody, emailDigestSubject, emailDigestBody, sendEmail}>} opts.items
 */
async function notifyGuardiansForStudents({ ctx, schoolId, eventKey, items }) {
  for (const item of items || []) {
    if (!item?.studentId) continue;
    try {
      const guardians = await tenantModel('users', ctx)
        .find({ schoolId, role: 'parent', studentIds: item.studentId, isActive: { $ne: false } })
        .select('id name email').lean();
      if (!guardians.length) continue;

      await dispatchNotification({
        ctx, schoolId, eventKey, actorUserId: 'system',
        recipients: guardians.map(g => ({ userId: g.id, name: g.name, email: g.email })),
        inAppSubject: item.inAppSubject,
        inAppBody:    item.inAppBody,
        emailDigestSubject: item.emailDigestSubject,
        emailDigestBody:    item.emailDigestBody,
        sendEmail: item.sendEmail,
      });
    } catch (err) {
      // One student's notification failing must never block the rest —
      // same discipline as dispatchNotification's own per-recipient guard.
      console.error(`[notify-students] ${eventKey} → student ${item.studentId} failed:`, err.message);
    }
  }
}

module.exports = { notifyGuardiansForStudents };
