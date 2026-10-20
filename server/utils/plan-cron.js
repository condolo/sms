/* ============================================================
   Subscription expiry reminders.

   Runs daily (not on login, unlike the older trial reminder): a school
   that stops logging in is exactly the one that must still be warned.
   Sends at 30 / 14 / 7 / 1 / 0 days left, once per threshold, and records
   the first restricted observation for the audit trail.

   Only `planExpiresAt` is handled here. The onboarding trial (`trialEnds`)
   keeps its existing login-triggered reminders in routes/auth.js.
   ============================================================ */
'use strict';

const cron = require('node-cron');
const { _model } = require('./model');
const email = require('./email');
const AuditService = require('../services/audit');
const { getPlanState } = require('../middleware/plan');

const SCHEDULE = process.env.PLAN_REMINDER_CRON || '0 5 * * *'; // 08:00 EAT
const THRESHOLDS = [30, 14, 7, 1, 0];

let _started = false;

function _fmt(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function runPlanReminders() {
  const Schools = _model('schools');
  const schools = await Schools.find({
    isDemo: { $ne: true },
    planExpiresAt: { $ne: null },
  }).lean();

  const stats = { reminded: 0, expiredNotices: 0, restricted: 0 };

  for (const school of schools) {
    try {
      if (!school.planExpiresAt || !school.adminEmail) continue;
      const expiry = new Date(school.planExpiresAt);
      if (Number.isNaN(expiry.getTime())) continue;

      const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
      const state = await getPlanState(school.id);
      const todayKey = new Date().toISOString().slice(0, 10);

      if (daysLeft > 0 && THRESHOLDS.includes(daysLeft)) {
        if (school[`planNoticeSent_${daysLeft}`] === todayKey) continue;
        await email.sendPlanExpiryReminder({
          adminName:  school.adminName || school.name,
          adminEmail: school.adminEmail,
          schoolName: school.name,
          plan:       school.plan || 'base',
          daysLeft,
          expiresAt:  _fmt(expiry),
        }).catch(() => {});
        await Schools.updateOne(
          { id: school.id },
          { $set: { [`planNoticeSent_${daysLeft}`]: todayKey } }
        );
        stats.reminded += 1;
        continue;
      }

      if (daysLeft <= 0) {
        if (!school.planExpiredNotifiedAt) {
          await email.sendPlanExpiryReminder({
            adminName:  school.adminName || school.name,
            adminEmail: school.adminEmail,
            schoolName: school.name,
            plan:       school.plan || 'base',
            daysLeft:   0,
            expiresAt:  _fmt(expiry),
          }).catch(() => {});
          await Schools.updateOne(
            { id: school.id },
            { $set: { planExpiredNotifiedAt: new Date().toISOString() } }
          );
          stats.expiredNotices += 1;
          AuditService.log({
            action: 'plan.expired',
            actor: { userId: 'system', role: 'system', email: null },
            schoolId: school.id,
            target: { type: 'school', id: school.id, label: school.name },
            details: { plan: school.plan, expiresAt: school.planExpiresAt, enforced: state.enforced, restricted: state.restricted },
          });
        }
        if (state.restricted && !school.planRestrictedAt) {
          await Schools.updateOne(
            { id: school.id },
            { $set: { planRestrictedAt: new Date().toISOString() } }
          );
          stats.restricted += 1;
          AuditService.log({
            action: 'plan.restricted',
            actor: { userId: 'system', role: 'system', email: null },
            schoolId: school.id,
            target: { type: 'school', id: school.id, label: school.name },
            details: { plan: school.plan, expiresAt: school.planExpiresAt, graceDays: state.graceDays },
          });
        }
      }
    } catch (err) {
      console.error(`[plan-cron] school ${school.id} failed:`, err.message);
    }
  }

  return stats;
}

function startPlanCron() {
  if (_started) return;
  _started = true;
  cron.schedule(SCHEDULE, async () => {
    try {
      const stats = await runPlanReminders();
      if (stats.reminded || stats.expiredNotices || stats.restricted) {
        console.log(`[plan-cron] reminders:${stats.reminded} expired:${stats.expiredNotices} restricted:${stats.restricted}`);
      }
    } catch (err) {
      console.error('[plan-cron] run failed:', err.message);
    }
  });
  console.log(`[plan-cron] Scheduled — ${SCHEDULE} (30/14/7/1/0-day subscription notices)`);
}

module.exports = { startPlanCron, runPlanReminders };
