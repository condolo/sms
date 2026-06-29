/* ============================================================
   Msingi — Email Queue / Batched Sender

   Prevents bursting into Gmail's SMTP rate limits during
   school-wide announcements (which can target hundreds of users).

   Instead of firing all emails concurrently, this module sends
   them in small batches with a short delay between each batch.

   Config (env vars):
     EMAIL_BATCH_SIZE     — emails per batch  (default: 20)
     EMAIL_BATCH_DELAY_MS — ms between batches (default: 1500)

   Usage:
     const { enqueueBatch } = require('../utils/email-queue');

     // Collect thunks — functions that return a Promise, NOT
     // already-executing Promises.  This prevents all SMTP calls
     // from starting simultaneously before batching can kick in.
     const jobs = [];
     for (const u of targets) {
       jobs.push(() => email.sendMessageNotification({ ... }));
     }
     enqueueBatch(jobs).catch(err => console.error('[send] email queue error:', err));
   ============================================================ */
'use strict';

const BATCH_SIZE     = parseInt(process.env.EMAIL_BATCH_SIZE     || '20',   10);
const BATCH_DELAY_MS = parseInt(process.env.EMAIL_BATCH_DELAY_MS || '1500', 10);

/**
 * Execute an array of email thunks in batches of BATCH_SIZE,
 * pausing BATCH_DELAY_MS between each batch.
 *
 * @param {Array<() => Promise<any>>} thunks
 * @returns {Promise<void>}
 */
async function enqueueBatch(thunks) {
  if (!thunks || !thunks.length) return;

  let failed = 0;
  let sent   = 0;

  for (let i = 0; i < thunks.length; i += BATCH_SIZE) {
    const batch = thunks.slice(i, i + BATCH_SIZE);

    // Invoke each thunk now — only this batch is in-flight at once
    const results = await Promise.allSettled(batch.map(fn => fn()));

    for (const r of results) {
      if (r.status === 'rejected') failed++;
      else sent++;
    }

    // Pause before the next batch, but not after the very last one
    if (i + BATCH_SIZE < thunks.length) {
      await _sleep(BATCH_DELAY_MS);
    }
  }

  if (failed) {
    console.warn(`[email-queue] ${failed}/${thunks.length} notification emails failed`);
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { enqueueBatch };
