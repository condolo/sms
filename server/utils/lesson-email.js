/* ============================================================
   Msingi — Lesson Coverage Email Templates
   Uses the shared email utility (_sendAsSchool) so all mail
   routes through the permanent SMTP sender.
   ============================================================ */
'use strict';

const nodemailer = require('nodemailer');

const SMTP_USER      = process.env.SMTP_USER;
const SMTP_PASS      = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const SMTP_READY     = !!(SMTP_USER && SMTP_PASS);
const APP_URL        = process.env.APP_URL || 'https://msingi.io';

if (!SMTP_READY) {
  // Warning already emitted by email.js — no need to repeat
}

const transporter = SMTP_READY ? nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
}) : null;

/* ── Core send ──────────────────────────────────────────────── */
async function _send(to, subject, html, fromName) {
  if (!SMTP_READY || !transporter) {
    console.warn(`[LessonEmail] SKIPPED (no SMTP): "${subject}" → ${to}`);
    return false;
  }
  try {
    await transporter.sendMail({
      from:    `"${fromName || 'Msingi'}" <${SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[LessonEmail] ✅ Sent "${subject}" → ${to}`);
    return true;
  } catch (err) {
    console.error(`[LessonEmail] ❌ Failed "${subject}" → ${to}: ${err.message}`);
    return false;
  }
}

/* ── Shared HTML wrapper ─────────────────────────────────────── */
function _wrap(body, schoolName) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Inter,Arial,sans-serif;background:#f8fafc;margin:0;padding:0}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .hd{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;text-align:center}
    .hd h1{color:#fff;margin:0;font-size:20px;font-weight:700}
    .hd p{color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px}
    .bd{padding:32px}
    .bd p{color:#374151;font-size:15px;line-height:1.6;margin:0 0 14px}
    .bd h2{color:#1e1b4b;font-size:16px;margin:0 0 10px}
    .info{background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:14px 0}
    .info p{margin:4px 0;font-size:14px;color:#374151}
    .warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:14px 0}
    .warn p{margin:0;font-size:14px;color:#92400e}
    .btn{display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff!important;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;margin:10px 0}
    .ft{padding:18px 32px;background:#f8fafc;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb}
    table{width:100%;border-collapse:collapse}
    th,td{text-align:left;padding:8px 12px;font-size:13px;border-bottom:1px solid #e5e7eb}
    th{background:#f1f5f9;font-weight:600;color:#374151}
  </style>
  </head><body>
  <div class="wrap">
    <div class="hd">
      <h1>Msingi</h1>
      <p>${schoolName || 'School Management Platform'}</p>
    </div>
    <div class="bd">${body}</div>
    <div class="ft">
      This is an automated reminder from Msingi.<br>
      <a href="${APP_URL}" style="color:#6366f1">Open Msingi</a>
    </div>
  </div>
  </body></html>`;
}

/* ── Teacher reminder email ──────────────────────────────────── */
/*
  type: 'friday' | 'saturday_morning'
*/
async function sendLessonReminder({ toEmail, toName, schoolName, type, pendingCount }) {
  const firstName = (toName || 'Teacher').split(' ')[0];

  const isSecond  = type === 'saturday_morning';
  const urgency   = isSecond ? '⚠️ Reminder' : '📝 Reminder';
  const subject   = `${urgency}: Please update your lesson coverage — ${schoolName}`;

  const introLine = isSecond
    ? `This is a follow-up reminder. You have not yet updated your lesson coverage for this week.`
    : `The school day has ended. Please take a moment to update your lesson coverage for today's classes.`;

  const body = `
    <h2>Hello ${firstName},</h2>
    <p>${introLine}</p>
    <div class="info">
      <p><strong>Pending updates:</strong> ${pendingCount} class–subject pair(s) with uncovered topics</p>
    </div>
    <p>Updating your coverage helps students and parents track the curriculum progress and helps your HOD plan effectively.</p>
    <p>
      <a class="btn" href="${APP_URL}/lessons">Update Lesson Coverage</a>
    </p>
    <p style="font-size:13px;color:#6b7280">This only takes a few minutes. Tap each topic or subtopic you covered to mark it done.</p>
  `;

  return _send(toEmail, subject, _wrap(body, schoolName), `${schoolName} via Msingi`);
}

/* ── HOD escalation email ────────────────────────────────────── */
async function sendHodEscalation({ toEmail, toName, schoolName, pending }) {
  const firstName   = (toName || 'HOD').split(' ')[0];
  const teacherCount = pending.length;

  const rows = pending.map(t =>
    `<tr>
      <td>${t.teacherName}</td>
      <td>${t.pending.map(c => `${c.subjectName} (${c.className})`).join(', ')}</td>
    </tr>`
  ).join('');

  const subject = `Action Required: ${teacherCount} teacher(s) have not updated lesson coverage — ${schoolName}`;

  const body = `
    <h2>Hello ${firstName},</h2>
    <p>This is an automated HOD escalation. The following teacher(s) have not updated their lesson coverage for this week's Friday lessons:</p>

    <table>
      <thead>
        <tr>
          <th>Teacher</th>
          <th>Pending Classes / Subjects</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="warn">
      <p><strong>Action needed:</strong> Please follow up with the above staff to ensure lesson coverage is updated promptly.</p>
    </div>

    <p>
      <a class="btn" href="${APP_URL}/lessons">View Lessons Overview</a>
    </p>
  `;

  return _send(toEmail, subject, _wrap(body, schoolName), `${schoolName} via Msingi`);
}

module.exports = { sendLessonReminder, sendHodEscalation };
