/* ============================================================
   Demo lifecycle cron — hourly sweep.

   Sends day-3 / 2-days-left / final notices, expires tenants whose
   expiresAt has passed, and purges tenants 30 days after expiry.
   Idempotent: each notice is recorded on the school (`demoNotices`), so a
   restart or a double tick cannot email twice.
   ============================================================ */
'use strict';

const cron = require('node-cron');
const demoService = require('../services/demoService');

const SCHEDULE = process.env.DEMO_SWEEP_CRON || '17 * * * *'; // hourly at :17

let _started = false;

function startDemoCron() {
  if (_started) return;
  _started = true;

  cron.schedule(SCHEDULE, async () => {
    try {
      const stats = await demoService.sweep();
      if (stats.warned || stats.expired || stats.purged) {
        console.log(`[demo-cron] notices:${stats.warned} expired:${stats.expired} purged:${stats.purged}`);
      }
    } catch (err) {
      console.error('[demo-cron] sweep failed:', err.message);
    }
  });

  console.log(`[demo-cron] Scheduled — ${SCHEDULE} (notices, expiry, purge)`);
}

module.exports = { startDemoCron };
