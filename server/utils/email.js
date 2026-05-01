/* ============================================================
   InnoLearn — Email Utility (Gmail SMTP via nodemailer)
   ============================================================ */
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"InnoLearn" <${process.env.SMTP_USER}>`;
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL || process.env.SMTP_USER;
const APP_URL = process.env.APP_URL || 'https://school-management-ecosystem.onrender.com';

/* ── Shared HTML wrapper ───────────────────────────────────── */
function _wrap(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Inter,Arial,sans-serif;background:#f8fafc;margin:0;padding:0}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .hd{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;text-align:center}
    .hd h1{color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:-.3px}
    .hd p{color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px}
    .bd{padding:32px}
    .bd p{color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px}
    .bd h2{color:#1e1b4b;font-size:17px;margin:0 0 12px}
    .info{background:#f1f5f9;border-radius:8px;padding:16px 20px;margin:16px 0}
    .info p{margin:4px 0;font-size:14px;color:#374151}
    .info strong{color:#1e1b4b}
    .btn{display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff!important;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;margin:8px 0}
    .ft{padding:20px 32px;background:#f8fafc;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .badge.pending{background:#fef3c7;color:#92400e}
    .badge.approved{background:#d1fae5;color:#065f46}
    .badge.rejected{background:#fee2e2;color:#991b1b}
  </style></head><body>
  <div class="wrap">
    <div class="hd"><h1>🎓 InnoLearn</h1><p>School Management Platform</p></div>
    <div class="bd">${body}</div>
    <div class="ft">© 2026 InnoLearn · <a href="${APP_URL}" style="color:#4f46e5">school-management-ecosystem.onrender.com</a><br>
    This is an automated message — please do not reply directly.</div>
  </div></body></html>`;
}

async function _send(to, subject, html) {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    console.log(`[EMAIL] Sent "${subject}" → ${to}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send "${subject}" → ${to}:`, err.message);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   1. School registered — email to school admin (pending review)
   ══════════════════════════════════════════════════════════════ */
async function sendRegistrationPending({ adminName, adminEmail, schoolName, plan }) {
  const html = _wrap(`
    <h2>Your application is under review 👋</h2>
    <p>Hi ${adminName},</p>
    <p>Thank you for registering <strong>${schoolName}</strong> on InnoLearn. We have received your application and our team is reviewing it.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Status:</strong> <span class="badge pending">⏳ Pending Review</span></p>
    </div>
    <p>You will receive another email within <strong>24 hours</strong> once your account has been reviewed. If approved, you will receive your login credentials and can start setting up your school immediately.</p>
    <p>If you have any questions, reply to this email or contact us at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
    <p>Thank you for choosing InnoLearn!</p>
  `);
  return _send(adminEmail, `Application Received — ${schoolName} | InnoLearn`, html);
}

/* ══════════════════════════════════════════════════════════════
   2. New school registered — alert to platform admin
   ══════════════════════════════════════════════════════════════ */
async function sendAdminNewSchoolAlert({ schoolName, slug, adminName, adminEmail, plan, country, city, curriculum, sections }) {
  const html = _wrap(`
    <h2>🏫 New School Registration</h2>
    <p>A new school has registered and is awaiting your approval.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Slug:</strong> ${slug}</p>
      <p><strong>Admin:</strong> ${adminName} (${adminEmail})</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Location:</strong> ${city}, ${country}</p>
      <p><strong>Curriculum:</strong> ${(curriculum || []).join(', ')}</p>
      <p><strong>Sections:</strong> ${(sections || []).join(', ')}</p>
      <p><strong>Status:</strong> <span class="badge pending">⏳ Pending Approval</span></p>
    </div>
    <p style="text-align:center">
      <a href="${APP_URL}/platform" class="btn">Review in Platform Dashboard →</a>
    </p>
  `);
  return _send(PLATFORM_EMAIL, `[InnoLearn] New School Registration — ${schoolName}`, html);
}

/* ══════════════════════════════════════════════════════════════
   3. School approved — welcome email to school admin
   ══════════════════════════════════════════════════════════════ */
async function sendApprovalWelcome({ adminName, adminEmail, schoolName, slug, plan }) {
  const loginUrl = `${APP_URL}`;
  const html = _wrap(`
    <h2>🎉 Your school is approved!</h2>
    <p>Hi ${adminName},</p>
    <p>Great news! <strong>${schoolName}</strong> has been approved on InnoLearn. Your account is now active and ready to use.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Status:</strong> <span class="badge approved">✓ Approved</span></p>
      <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
    </div>
    <p>Log in using the email address and password you set during registration. You will be guided through setting up your school profile on first login.</p>
    <p style="text-align:center">
      <a href="${loginUrl}" class="btn">Log In to InnoLearn →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">Need help? Check out our <a href="${APP_URL}/docs">School Admin Guide</a> or contact us at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
  `);
  return _send(adminEmail, `✅ Your InnoLearn account is approved — ${schoolName}`, html);
}

/* ══════════════════════════════════════════════════════════════
   4. School rejected
   ══════════════════════════════════════════════════════════════ */
async function sendRejectionEmail({ adminName, adminEmail, schoolName, reason }) {
  const html = _wrap(`
    <h2>Application Update — ${schoolName}</h2>
    <p>Hi ${adminName},</p>
    <p>Thank you for your interest in InnoLearn. After reviewing your application for <strong>${schoolName}</strong>, we are unable to approve it at this time.</p>
    ${reason ? `<div class="info"><p><strong>Reason:</strong> ${reason}</p></div>` : ''}
    <p>If you believe this is an error or would like to discuss further, please contact us directly at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a> and we will be happy to help.</p>
    <p style="font-size:13px;color:#6b7280">You are welcome to re-apply after addressing any concerns raised.</p>
  `);
  return _send(adminEmail, `InnoLearn Application Update — ${schoolName}`, html);
}

/* ══════════════════════════════════════════════════════════════
   5. Platform admin approved alert (cc to yourself)
   ══════════════════════════════════════════════════════════════ */
async function sendAdminApprovalAlert({ schoolName, adminEmail, plan }) {
  const html = _wrap(`
    <h2>✅ School Approved</h2>
    <p>You approved <strong>${schoolName}</strong>.</p>
    <div class="info">
      <p><strong>Admin email:</strong> ${adminEmail}</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Status:</strong> <span class="badge approved">✓ Active</span></p>
    </div>
    <p style="text-align:center">
      <a href="${APP_URL}/platform" class="btn">View in Platform Dashboard →</a>
    </p>
  `);
  return _send(PLATFORM_EMAIL, `[InnoLearn] Approved: ${schoolName}`, html);
}

module.exports = {
  sendRegistrationPending,
  sendAdminNewSchoolAlert,
  sendApprovalWelcome,
  sendRejectionEmail,
  sendAdminApprovalAlert,
};
