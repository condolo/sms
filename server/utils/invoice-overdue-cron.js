/* ============================================================
   Msingi — Invoice Overdue Cron

   Runs once daily. For every school, finds invoices past their
   dueDate that are still unpaid/partial and reminds each invoiced
   student's guardian(s) via the standard notification pipeline
   (notif-settings.js's invoice_due_soon/invoice_overdue events —
   school-configured channel, same as every other notification event).

   Schedule (per-school configurable — GET/PUT
   /api/finance/invoice-reminder-config, defaults below): a reminder
   `beforeDueDays` days before the due date, one on the due date
   itself, then recurring every `afterDueIntervalDays` days after —
   NOT a reminder on every single overdue day, so a family isn't
   emailed daily for a stale invoice.
   ============================================================ */
'use strict';

const cron  = require('node-cron');
const { _model } = require('./model');
const { notifyGuardiansForStudents } = require('./notify-students');
const email = require('./email');

const CRON_INVOICE_OVERDUE = process.env.INVOICE_OVERDUE_CRON || '0 4 * * *'; // 07:00 Nairobi

// Mirrors finance.js's DEFAULT_INVOICE_REMINDER_CONFIG — duplicated rather
// than imported to keep this a leaf util with no dependency on routes/.
const DEFAULT_REMINDER_CONFIG = {
  enabled:              true,
  beforeDueDays:        3,
  onDueDate:            true,
  afterDueIntervalDays: 4,
};

function _todayKenyaDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

/** Whole days between two YYYY-MM-DD (or full ISO) date strings, a − b. */
function _daysBetween(a, b) {
  const da = new Date(`${String(a).slice(0, 10)}T00:00:00Z`);
  const db = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
  return Math.round((da - db) / 86400000);
}

/** Classifies one invoice against today + the school's reminder schedule.
 *  Returns null when no reminder is due today. */
function _classify(invoice, today, cfg) {
  const diff = _daysBetween(today, invoice.dueDate); // >0 overdue, 0 due today, <0 days remaining
  if (diff < 0 && cfg.beforeDueDays > 0 && -diff === cfg.beforeDueDays) {
    return { kind: 'due_soon', daysRemaining: -diff };
  }
  if (diff === 0 && cfg.onDueDate) {
    return { kind: 'due_today', daysOverdue: 0 };
  }
  if (diff > 0 && cfg.afterDueIntervalDays > 0 && diff % cfg.afterDueIntervalDays === 0) {
    return { kind: 'overdue', daysOverdue: diff };
  }
  return null;
}

async function runInvoiceOverdueCheck() {
  const today = _todayKenyaDate();
  const Schools   = _model('schools');
  const Invoices  = _model('invoices');
  const Students  = _model('students');
  const ReminderConfig = _model('invoice_reminder_config');

  let schools;
  try {
    schools = await Schools.find({ isActive: { $ne: false } }).select('id name systemEmail').lean();
  } catch (err) {
    console.error('[invoice-overdue-cron] Failed to query schools:', err.message);
    return;
  }
  if (!schools.length) return;

  for (const school of schools) {
    try {
      const savedCfg = await ReminderConfig.findOne({ schoolId: school.id }).lean();
      const cfg = { ...DEFAULT_REMINDER_CONFIG, ...(savedCfg || {}) };
      if (!cfg.enabled) continue;

      const candidates = await Invoices.find({
        schoolId: school.id,
        status:   { $in: ['unpaid', 'partial'] },
        dueDate:  { $ne: null },
      }).select('id studentId invoiceNumber total currency balance dueDate').lean();
      if (!candidates.length) continue;

      const dueSoon = [];
      const dueOrOverdue = [];
      for (const inv of candidates) {
        const cls = _classify(inv, today, cfg);
        if (!cls) continue;
        (cls.kind === 'due_soon' ? dueSoon : dueOrOverdue).push({ inv, cls });
      }
      if (!dueSoon.length && !dueOrOverdue.length) continue;

      const studentIds = [...new Set([...dueSoon, ...dueOrOverdue].map(x => x.inv.studentId).filter(Boolean))];
      const students = await Students.find({ schoolId: school.id, id: { $in: studentIds } })
        .select('id firstName lastName').lean();
      const nameById = Object.fromEntries(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
      const schoolName  = school.name || '';
      const schoolEmail = school.systemEmail || '';

      if (dueSoon.length) {
        await notifyGuardiansForStudents({
          ctx: { schoolId: school.id }, schoolId: school.id, eventKey: 'invoice_due_soon',
          items: dueSoon.map(({ inv, cls }) => {
            const studentName = nameById[inv.studentId] || inv.studentId;
            return {
              studentId: inv.studentId,
              inAppSubject: `Fee due soon — ${inv.invoiceNumber}`,
              inAppBody:    `Invoice ${inv.invoiceNumber} for ${studentName} (${inv.currency} ${inv.balance}) is due in ${cls.daysRemaining} day${cls.daysRemaining === 1 ? '' : 's'} (${inv.dueDate}).`,
              emailDigestSubject: `Fee due soon — ${inv.invoiceNumber}`,
              emailDigestBody:    `Invoice ${inv.invoiceNumber} for ${studentName} is due soon.`,
              sendEmail: (recipient) => email.sendInvoiceDueSoonAlert({
                recipientName: recipient.name, recipientEmail: recipient.email,
                studentName, invoiceNumber: inv.invoiceNumber, balance: inv.balance, currency: inv.currency,
                dueDate: inv.dueDate, daysRemaining: cls.daysRemaining,
                schoolName, schoolEmail, schoolId: school.id,
              }),
            };
          }),
        });
      }

      if (dueOrOverdue.length) {
        await notifyGuardiansForStudents({
          ctx: { schoolId: school.id }, schoolId: school.id, eventKey: 'invoice_overdue',
          items: dueOrOverdue.map(({ inv, cls }) => {
            const studentName = nameById[inv.studentId] || inv.studentId;
            const statusPhrase = cls.kind === 'due_today' ? 'is due today' : `is overdue (was due ${inv.dueDate})`;
            return {
              studentId: inv.studentId,
              inAppSubject: `${cls.kind === 'due_today' ? 'Fee due today' : 'Overdue invoice'} — ${inv.invoiceNumber}`,
              inAppBody:    `Invoice ${inv.invoiceNumber} for ${studentName} (${inv.currency} ${inv.balance}) ${statusPhrase}.`,
              emailDigestSubject: `${cls.kind === 'due_today' ? 'Fee due today' : 'Overdue invoice'} — ${inv.invoiceNumber}`,
              emailDigestBody:    `Invoice ${inv.invoiceNumber} for ${studentName} ${statusPhrase}.`,
              sendEmail: (recipient) => email.sendInvoiceOverdueAlert({
                recipientName: recipient.name, recipientEmail: recipient.email,
                studentName, invoiceNumber: inv.invoiceNumber, balance: inv.balance, currency: inv.currency, dueDate: inv.dueDate,
                schoolName, schoolEmail, schoolId: school.id,
              }),
            };
          }),
        });
      }
    } catch (err) {
      console.error(`[invoice-overdue-cron] Error processing school ${school.id}:`, err.message);
    }
  }
}

function startInvoiceOverdueCron() {
  if (!cron.validate(CRON_INVOICE_OVERDUE)) {
    console.error(`[invoice-overdue-cron] Invalid cron expression: ${CRON_INVOICE_OVERDUE}`);
    return;
  }
  cron.schedule(CRON_INVOICE_OVERDUE, runInvoiceOverdueCheck, { timezone: 'UTC' });
  console.log(`[invoice-overdue-cron] Scheduled — ${CRON_INVOICE_OVERDUE} UTC · override via INVOICE_OVERDUE_CRON env var`);
}

module.exports = { startInvoiceOverdueCron, runInvoiceOverdueCheck };
