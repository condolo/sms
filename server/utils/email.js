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

/* ══════════════════════════════════════════════════════════════
   6. Two-factor authentication OTP
   ══════════════════════════════════════════════════════════════ */
async function sendLoginOTP({ name, email, otp, schoolName }) {
  const html = _wrap(`
    <h2>Your sign-in code 🔐</h2>
    <p>Hi ${name},</p>
    <p>Someone (hopefully you!) is signing in to <strong>${schoolName}</strong> on InnoLearn. Use the code below to complete your login.</p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#f1f5f9;border:2px dashed #c7d2fe;border-radius:12px;padding:18px 36px">
        <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#4f46e5;font-family:monospace">${otp}</div>
      </div>
    </div>
    <p style="font-size:13px;color:#6b7280">This code expires in <strong>5 minutes</strong>. If you did not attempt to sign in, please change your password immediately and contact <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
    <p style="font-size:12px;color:#9ca3af">Do not share this code with anyone — InnoLearn will never ask for it.</p>
  `);
  return _send(email, `${otp} — Your InnoLearn sign-in code`, html);
}

/* ══════════════════════════════════════════════════════════════
   7. Trial expiry reminder
   ══════════════════════════════════════════════════════════════ */
async function sendTrialReminder({ adminName, adminEmail, schoolName, plan, daysLeft, trialEnds }) {
  const urgency = daysLeft === 0 ? '🚨 Today is your last day' : daysLeft === 1 ? '⚠️ 1 day left' : `⏰ ${daysLeft} days left`;
  const html = _wrap(`
    <h2>${urgency} on your free trial</h2>
    <p>Hi ${adminName},</p>
    <p>Your 30-day free trial for <strong>${schoolName}</strong> ${daysLeft === 0 ? 'ends <strong>today at midnight</strong>' : `ends in <strong>${daysLeft} day${daysLeft!==1?'s':''}</strong>`}.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Current Plan:</strong> ${plan}</p>
      <p><strong>Trial Ends:</strong> ${trialEnds}</p>
    </div>
    <p>To keep your school running smoothly with no interruption, please confirm your subscription before the trial expires.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Manage My Subscription →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">If you need help choosing a plan or have any questions, contact us at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
  `);
  return _send(adminEmail, `${urgency} — InnoLearn trial for ${schoolName}`, html);
}

/* ══════════════════════════════════════════════════════════════
   8. New user welcome — sends temporary login credentials
   ══════════════════════════════════════════════════════════════ */
async function sendWelcomeCredentials({ name, email, tempPassword, schoolName, role, loginUrl }) {
  const roleLabel = (role || 'staff').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const html = _wrap(`
    <h2>Welcome to ${schoolName}! 🎉</h2>
    <p>Hi ${name},</p>
    <p>Your account on <strong>InnoLearn</strong> has been created. Here are your login credentials to get started.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Role:</strong> ${roleLabel}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Temporary Password:</strong> <span style="font-family:monospace;font-size:15px;font-weight:700;color:#4f46e5;background:#ede9fe;padding:3px 8px;border-radius:4px">${tempPassword}</span></p>
    </div>
    <p>⚠️ You will be asked to <strong>change your password</strong> when you first sign in. Choose something strong and unique.</p>
    <p style="text-align:center">
      <a href="${loginUrl || APP_URL}" class="btn">Sign In Now →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">If you did not expect this email, please contact your school administrator or reach us at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
    <p style="font-size:12px;color:#9ca3af">⚠️ Never share your password with anyone — InnoLearn will never ask for it.</p>
  `);
  return _send(email, `Your InnoLearn account is ready — ${schoolName}`, html);
}

/* ══════════════════════════════════════════════════════════════
   9. Password expiry reminder (sent 7 days before 60-day limit)
   ══════════════════════════════════════════════════════════════ */
async function sendPasswordExpirySoon({ name, email, schoolName, daysLeft }) {
  const urgency = daysLeft <= 1 ? '🚨 Urgent' : daysLeft <= 3 ? '⚠️ Action needed' : '🔑 Reminder';
  const html = _wrap(`
    <h2>${urgency}: Your password expires ${daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}</h2>
    <p>Hi ${name},</p>
    <p>Your InnoLearn password for <strong>${schoolName}</strong> ${daysLeft <= 0 ? 'has expired' : `will expire in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>`} as part of our 60-day security policy.</p>
    <p>Please sign in and update your password now to avoid being locked out.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Update Password Now →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">If you need help, contact your school admin or reach us at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
  `);
  return _send(email, `${urgency} — InnoLearn password expires ${daysLeft <= 0 ? 'today' : `in ${daysLeft} days`}`, html);
}

/* ══════════════════════════════════════════════════════════════
   10. Password changed — security confirmation
   ══════════════════════════════════════════════════════════════ */
async function sendPasswordChanged({ name, email, schoolName }) {
  const html = _wrap(`
    <h2>✅ Password updated successfully</h2>
    <p>Hi ${name},</p>
    <p>Your InnoLearn password for <strong>${schoolName}</strong> was just changed. Your next password change will be due in <strong>60 days</strong>.</p>
    <p style="font-size:13px;color:#6b7280">If you did not make this change, please contact your school administrator immediately and reach us at <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Sign In →</a>
    </p>
  `);
  return _send(email, `InnoLearn password changed — ${schoolName}`, html);
}

/* ══════════════════════════════════════════════════════════════
   11. Role / permission change notification
   ══════════════════════════════════════════════════════════════ */
async function sendRoleChanged({ name, email, schoolName, oldRole, newRole, changedBy }) {
  const fmt = r => (r || 'staff').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const html = _wrap(`
    <h2>🔄 Your account permissions have changed</h2>
    <p>Hi ${name},</p>
    <p>Your role on <strong>${schoolName}</strong> has been updated by an administrator.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Previous role:</strong> ${fmt(oldRole)}</p>
      <p><strong>New role:</strong> <span style="font-weight:700;color:#4f46e5">${fmt(newRole)}</span></p>
      ${changedBy ? `<p><strong>Changed by:</strong> ${changedBy}</p>` : ''}
    </div>
    <p>Your access level may have changed. Sign in to see your updated dashboard.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Sign In →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">If you believe this change was made in error, contact your school administrator or <a href="mailto:${PLATFORM_EMAIL}">${PLATFORM_EMAIL}</a>.</p>
  `);
  return _send(email, `Your InnoLearn role has changed — ${schoolName}`, html);
}

module.exports = {
  sendRegistrationPending,
  sendAdminNewSchoolAlert,
  sendApprovalWelcome,
  sendRejectionEmail,
  sendAdminApprovalAlert,
  sendLoginOTP,
  sendTrialReminder,
  sendWelcomeCredentials,
  sendPasswordExpirySoon,
  sendPasswordChanged,
  sendRoleChanged,
};
