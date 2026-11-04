/* ============================================================
   Msingi — Smart Reminders runner

   One hourly tick. Every rule says which local hour it belongs to
   (utils/smart-reminders.js), and only the schools whose own clock
   is on that hour get evaluated. That matters more than it looks:
   a school in Lagos and one in Nairobi share a server, and "15:00
   registers" must be 15:00 in each of their days, not the server's.

   Nothing here decides who to message — the rule does. This file
   only asks each rule whether it is due, and lets runRule() refuse
   a window that has already gone out. A restart mid-hour, a doubled
   schedule, or two instances behind a proxy therefore produce one
   message, not three.
   ============================================================ */
'use strict';

const cron = require('node-cron');
const { _model } = require('./model');
const { RULES, runRule, _localHour, _localDate, _weekday, DEFAULT_TZ } = require('./smart-reminders');

const CRON_SMART_REMINDERS = process.env.SMART_REMINDERS_CRON || '5 * * * *';

async function runSmartReminders({ now = new Date() } = {}) {
  let schools;
  try {
    schools = await _model('schools')
      .find({ isActive: { $ne: false } })
      .select('id name timezone systemEmail')
      .lean();
  } catch (err) {
    console.error('[smart-reminders] Failed to query schools:', err.message);
    return { schools: 0, sent: 0 };
  }

  let sent = 0;
  for (const school of schools) {
    const tz = school.timezone || DEFAULT_TZ;
    const hour = _localHour(now, tz);
    const weekday = _weekday(_localDate(now, tz));

    for (const rule of RULES) {
      if (rule.runnable === false || !rule.previewable) continue;
      if (rule.hour == null || rule.hour !== hour) continue;
      if (rule.weekday && rule.weekday !== weekday) continue;

      try {
        const result = await runRule(rule.key, {
          schoolId: school.id, now, tz,
          schoolName: school.name || '', schoolEmail: school.systemEmail || '',
        });
        if (result?.sent) {
          sent += result.sent;
          console.log(`[smart-reminders] ${school.id} · ${rule.key} → ${result.sent} recipient(s)`);
        }
      } catch (err) {
        console.error(`[smart-reminders] ${school.id} · ${rule.key} failed:`, err.message);
      }
    }
  }

  return { schools: schools.length, sent };
}

function startSmartRemindersCron() {
  if (!cron.validate(CRON_SMART_REMINDERS)) {
    console.error(`[smart-reminders] Invalid cron expression: ${CRON_SMART_REMINDERS}`);
    return;
  }
  cron.schedule(CRON_SMART_REMINDERS, () => {
    runSmartReminders().catch(err => console.error('[smart-reminders] tick failed:', err.message));
  }, { timezone: 'UTC' });

  const labelled = RULES.filter(r => r.previewable)
    .map(r => `${r.key} @ ${String(r.hour).padStart(2, '0')}:00${r.weekday ? ` ${r.weekday}` : ''} local`)
    .join(' · ');
  console.log(`[smart-reminders] Scheduled — ${CRON_SMART_REMINDERS} UTC · ${labelled}`);
}

module.exports = { startSmartRemindersCron, runSmartReminders };
