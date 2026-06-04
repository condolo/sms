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
      await emailUtil.sendEmail({
        to:      admin.email,
        subject: `[Msingi] Invoice ${snapshot.invoiceRef} — ${school.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
            <div style="background:#4f46e5;padding:24px 32px;border-radius:12px 12px 0 0;">
              <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Msingi Platform Invoice</h1>
              <p style="margin:4px 0 0;color:#c7d2fe;font-size:13px;">${school.name}</p>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Invoice ref</td>
                    <td style="padding:6px 0;font-weight:700;text-align:right;font-size:13px;">${snapshot.invoiceRef}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Academic year</td>
                    <td style="padding:6px 0;text-align:right;font-size:13px;">${snapshot.academicYear} — Term ${snapshot.term}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Active students</td>
                    <td style="padding:6px 0;text-align:right;font-size:13px;">${snapshot.activeCount}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Rate</td>
                    <td style="padding:6px 0;text-align:right;font-size:13px;">KSh ${snapshot.ratePerStudent} / student</td></tr>
                <tr style="border-top:2px solid #e2e8f0;">
                  <td style="padding:12px 0;font-weight:700;font-size:16px;">Total due</td>
                  <td style="padding:12px 0;font-weight:700;font-size:20px;color:#4f46e5;text-align:right;">KSh ${snapshot.totalAmount.toLocaleString()}</td>
                </tr>
              </table>
              <p style="font-size:13px;color:#64748b;margin:0 0 16px;">
                Log in to your school portal, go to <strong>Settings → Subscription</strong>, and pay via M-Pesa STK Push.
                Your platform access continues uninterrupted while your invoice is pending.
              </p>
              <a href="https://msingi.io/platform"
                 style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
                Open Subscription Settings →
              </a>
            </div>
            <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;">
              Msingi · innolearnnetwork@gmail.com · msingi.io
            </p>
          </div>
        `,
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
