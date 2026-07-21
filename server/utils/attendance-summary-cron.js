/* ============================================================
   Msingi — Attendance Summary Cron

   Runs once daily, after the school day ends. For every school with
   at least one attendance record marked today, sends admin/principal
   staff a rollup (present/absent/late/total) via the standard
   notification pipeline (notif-settings.js's attendance_summary
   event — staff audience, in-app by default).
   ============================================================ */
'use strict';

const cron  = require('node-cron');
const { _model } = require('./model');
const { dispatchNotification } = require('./notify-dispatch');
const email = require('./email');

const CRON_ATTENDANCE_SUMMARY = process.env.ATTENDANCE_SUMMARY_CRON || '0 15 * * *'; // 18:00 Nairobi

function _todayKenyaDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

async function runAttendanceSummary() {
  const today = _todayKenyaDate();
  const Schools     = _model('schools');
  const Attendance  = _model('attendance');
  const Users       = _model('users');

  let schools;
  try {
    schools = await Schools.find({ isActive: { $ne: false } }).select('id name systemEmail').lean();
  } catch (err) {
    console.error('[attendance-summary-cron] Failed to query schools:', err.message);
    return;
  }
  if (!schools.length) return;

  for (const school of schools) {
    try {
      const records = await Attendance.find({ schoolId: school.id, date: today })
        .select('status').lean();
      if (!records.length) continue;

      const summary = records.reduce((acc, r) => {
        acc.total += 1;
        if (r.status === 'present') acc.present += 1;
        else if (r.status === 'absent') acc.absent += 1;
        else if (r.status === 'late') acc.late += 1;
        return acc;
      }, { total: 0, present: 0, absent: 0, late: 0 });

      const staff = await Users.find({
        schoolId: school.id,
        role: { $in: ['admin', 'principal'] },
        isActive: { $ne: false },
      }).select('id name email').lean();
      if (!staff.length) continue;

      const schoolName  = school.name || '';
      const schoolEmail = school.systemEmail || '';
      const subject = `Daily Attendance Summary — ${today}`;
      const body    = `${summary.present} present, ${summary.absent} absent, ${summary.late} late out of ${summary.total} record(s) today.`;

      await dispatchNotification({
        ctx: { schoolId: school.id }, schoolId: school.id, eventKey: 'attendance_summary',
        actorUserId: 'system',
        recipients: staff.map(s => ({ userId: s.id, name: s.name, email: s.email })),
        inAppSubject: subject,
        inAppBody:    body,
        emailDigestSubject: subject,
        emailDigestBody:    body,
        sendEmail: (recipient) => email.sendAttendanceSummaryAlert({
          recipientName: recipient.name, recipientEmail: recipient.email,
          date: today, ...summary,
          schoolName, schoolEmail, schoolId: school.id,
        }),
      });
    } catch (err) {
      console.error(`[attendance-summary-cron] Error processing school ${school.id}:`, err.message);
    }
  }
}

function startAttendanceSummaryCron() {
  if (!cron.validate(CRON_ATTENDANCE_SUMMARY)) {
    console.error(`[attendance-summary-cron] Invalid cron expression: ${CRON_ATTENDANCE_SUMMARY}`);
    return;
  }
  cron.schedule(CRON_ATTENDANCE_SUMMARY, runAttendanceSummary, { timezone: 'UTC' });
  console.log(`[attendance-summary-cron] Scheduled — ${CRON_ATTENDANCE_SUMMARY} UTC · override via ATTENDANCE_SUMMARY_CRON env var`);
}

module.exports = { startAttendanceSummaryCron, runAttendanceSummary };
