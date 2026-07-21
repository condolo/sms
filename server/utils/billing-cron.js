/* ============================================================
   Msingi — Billing Cron
   Runs daily at 06:00 Kenya time (03:00 UTC).
   For each school, checks if today is any term's start date.
   If yes (and no snapshot exists for that term), auto-generates
   a billing snapshot and emails the school admin.
   ============================================================ */
'use strict';

const cron   = require('node-cron');
const { _model }  = require('./model');
const emailUtil   = require('./email');
const { createBillingSnapshot } = require('../routes/billing');

/* Daily 06:00 Kenya (UTC+3) = 03:00 UTC */
const CRON_BILLING_DAILY = process.env.BILLING_CRON || '0 3 * * *';

function _todayKenyaDate() {
  // Returns YYYY-MM-DD in Africa/Nairobi timezone
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

async function runBillingCheck() {
  const today = _todayKenyaDate();
  console.log(`[billing-cron] Running billing check for ${today}`);

  const Schools = _model('schools');
  const Users   = _model('users');

  let schools;
  try {
    schools = await Schools.find({
      'termDates.startDate': today,   // any term that starts today
    }).lean();
  } catch (err) {
    console.error('[billing-cron] Failed to query schools:', err.message);
    return;
  }

  if (!schools.length) {
    console.log(`[billing-cron] No term starts today (${today})`);
    return;
  }

  console.log(`[billing-cron] ${schools.length} school(s) have a term starting today`);

  for (const school of schools) {
    try {
      const termDates = school.termDates || [];
      const startingTerms = termDates.filter(t => t.startDate === today);

      for (const termDef of startingTerms) {
        const legacyMap = { core: 'base', standard: 'student', premium: 'family' };
        const tier = legacyMap[school.plan] || school.plan || 'base';

        const { existing, snapshot } = await createBillingSnapshot(school.id, {
          academicYear: school.academicYear,
          term:         termDef.term,
          tier,
          triggerType:  'auto',
        });

        if (existing) {
          console.log(`[billing-cron] Snapshot already exists for ${school.id} | ${school.academicYear} T${termDef.term} — skipping`);
          continue;
        }

        // Email the school admin(s)
        await _sendInvoiceEmail(school, snapshot, Users);
      }
    } catch (err) {
      console.error(`[billing-cron] Error processing school ${school.id}:`, err.message);
    }
  }
}

async function _sendInvoiceEmail(school, snapshot, Users) {
  try {
    const admins = await Users.find({
      schoolId: school.id,
      role: { $in: ['admin', 'principal'] },
    }).lean();

    for (const admin of admins) {
      if (!admin.email) continue;
      await emailUtil.sendInvoiceEmail({
        name:           admin.name,
        email:          admin.email,
        schoolName:     school.name,
        schoolEmail:    school.systemEmail,
        schoolId:       school.id,
        invoiceRef:     snapshot.invoiceRef,
        academicYear:   snapshot.academicYear,
        term:           snapshot.term,
        activeCount:    snapshot.activeCount,
        ratePerStudent: snapshot.ratePerStudent,
        totalAmount:    snapshot.totalAmount,
      });
      console.log(`[billing-cron] Invoice email sent to ${admin.email} for ${snapshot.invoiceRef}`);
    }
  } catch (err) {
    console.error(`[billing-cron] Failed to send invoice email for school ${school.id}:`, err.message);
  }
}

function startBillingCron() {
  if (!cron.validate(CRON_BILLING_DAILY)) {
    console.error(`[billing-cron] Invalid cron expression: ${CRON_BILLING_DAILY}`);
    return;
  }
  cron.schedule(CRON_BILLING_DAILY, runBillingCheck, { timezone: 'UTC' });
  console.log(`[billing-cron] Scheduled — ${CRON_BILLING_DAILY} UTC (06:00 Nairobi) · override via BILLING_CRON env var`);
}

module.exports = { startBillingCron, runBillingCheck };
