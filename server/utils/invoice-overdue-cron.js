/* ============================================================
   Msingi — Invoice Overdue Cron

   Runs once daily. For every school, finds invoices past their
   dueDate that are still unpaid/partial and reminds each invoiced
   student's guardian(s) via the standard notification pipeline
   (notif-settings.js's invoice_overdue event — school-configured
   channel/frequency, same as every other notification event).
   Deliberately re-fires daily while an invoice stays overdue: it's
   a recurring reminder, not a one-time alert.
   ============================================================ */
'use strict';

const cron  = require('node-cron');
const { _model } = require('./model');
const { notifyGuardiansForStudents } = require('./notify-students');
const email = require('./email');

const CRON_INVOICE_OVERDUE = process.env.INVOICE_OVERDUE_CRON || '0 4 * * *'; // 07:00 Nairobi

function _todayKenyaDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

async function runInvoiceOverdueCheck() {
  const today = _todayKenyaDate();
  const Schools   = _model('schools');
  const Invoices  = _model('invoices');
  const Students  = _model('students');

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
      const overdue = await Invoices.find({
        schoolId: school.id,
        status:   { $in: ['unpaid', 'partial'] },
        dueDate:  { $ne: null, $lt: today },
      }).select('id studentId invoiceNumber total currency balance dueDate').lean();
      if (!overdue.length) continue;

      const studentIds = [...new Set(overdue.map(i => i.studentId).filter(Boolean))];
      const students = await Students.find({ schoolId: school.id, id: { $in: studentIds } })
        .select('id firstName lastName').lean();
      const nameById = Object.fromEntries(students.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
      const schoolName  = school.name || '';
      const schoolEmail = school.systemEmail || '';

      await notifyGuardiansForStudents({
        ctx: { schoolId: school.id }, schoolId: school.id, eventKey: 'invoice_overdue',
        items: overdue.map(inv => {
          const studentName = nameById[inv.studentId] || inv.studentId;
          return {
            studentId: inv.studentId,
            inAppSubject: `Overdue invoice — ${inv.invoiceNumber}`,
            inAppBody:    `Invoice ${inv.invoiceNumber} for ${studentName} (${inv.currency} ${inv.balance}) is overdue (was due ${inv.dueDate}).`,
            emailDigestSubject: `Overdue invoice — ${inv.invoiceNumber}`,
            emailDigestBody:    `Invoice ${inv.invoiceNumber} for ${studentName} is overdue.`,
            sendEmail: (recipient) => email.sendInvoiceOverdueAlert({
              recipientName: recipient.name, recipientEmail: recipient.email,
              studentName, invoiceNumber: inv.invoiceNumber, balance: inv.balance, currency: inv.currency, dueDate: inv.dueDate,
              schoolName, schoolEmail, schoolId: school.id,
            }),
          };
        }),
      });
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
