/* ============================================================
   Msingi — Email Utility (Gmail SMTP via nodemailer)

   Two sending modes:
   ─ Platform emails  (registration, approval, system notices)
     From: "Msingi Platform" <platform SMTP user>

   ─ School emails  (2FA, passwords, messages, invites, etc.)
     From: "<School Name> via Msingi" <platform SMTP user>
     Reply-To: school.systemEmail  (if configured, else PLATFORM_EMAIL)

   All mail physically routes through one Gmail SMTP account.
   Reply-To lets schools receive replies at their own address.
   When a school later provides their own SMTP, only _send()
   needs to change — callers are already passing schoolEmail.
   ============================================================ */
const nodemailer = require('nodemailer');

const SMTP_USER      = process.env.SMTP_USER;
// Gmail App Passwords are displayed as "xxxx xxxx xxxx xxxx" — strip spaces
const SMTP_PASS      = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const SMTP_READY     = !!(SMTP_USER && SMTP_PASS);
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL || SMTP_USER || '';
// Contact address shown to users in email templates (not the SMTP sender)
const SUPPORT_EMAIL  = process.env.SUPPORT_EMAIL  || 'support@msingi.io';
const APP_URL        = process.env.APP_URL || 'https://msingi.io';

if (!SMTP_READY) {
  console.warn('[EMAIL] ⚠️  SMTP_USER / SMTP_PASS not set — all emails will be skipped. Set them in Render dashboard → Environment.');
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

// Default From for platform-level emails
const PLATFORM_FROM = `"Msingi Platform" <${SMTP_USER}>`;

/* ── Core send helper ──────────────────────────────────────
   opts.fromName  — display name override (e.g. "Greenwood School via Msingi")
   opts.replyTo   — Reply-To address (school's systemEmail)
*/
async function _send(to, subject, html, opts = {}) {
  if (!SMTP_READY) {
    console.warn(`[EMAIL] SKIPPED (no SMTP): "${subject}" → ${to}`);
    return false;
  }
  try {
    const from = opts.fromName
      ? `"${opts.fromName}" <${SMTP_USER}>`
      : PLATFORM_FROM;

    const mailOpts = { from, to, subject, html };
    if (opts.replyTo) mailOpts.replyTo = opts.replyTo;

    await transporter.sendMail(mailOpts);
    console.log(`[EMAIL] ✅ Sent "${subject}" → ${to}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] ❌ Failed "${subject}" → ${to}: ${err.message}`);
    return false;
  }
}

/* ── Convenience: send as a school ────────────────────────
   schoolName  — shown in From display name
   schoolEmail — school's systemEmail; used as Reply-To
                 falls back to PLATFORM_EMAIL if blank
*/
function _sendAsSchool(to, subject, html, { schoolName, schoolEmail } = {}) {
  const fromName = schoolName ? `${schoolName} via Msingi` : 'Msingi';
  const replyTo  = schoolEmail || PLATFORM_EMAIL;
  return _send(to, subject, html, { fromName, replyTo });
}

/* ── Shared HTML wrapper ───────────────────────────────────
   schoolName — if provided, shown as a subtitle under the logo
*/
function _wrap(body, schoolName) {
  const subtitle = schoolName
    ? `<p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:13px">${schoolName}</p>`
    : '<p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px">School Management Platform</p>';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Inter,Arial,sans-serif;background:#f8fafc;margin:0;padding:0}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .hd{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;text-align:center}
    .hd h1{color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:-.3px}
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
    <div class="hd"><h1>🎓 Msingi</h1>${subtitle}</div>
    <div class="bd">${body}</div>
    <div class="ft">© 2026 Msingi · <a href="${APP_URL}" style="color:#4f46e5">msingi.io</a><br>
    This is an automated message — please do not reply directly to this address.</div>
  </div></body></html>`;
}

/* ══════════════════════════════════════════════════════════════
   PLATFORM EMAILS — sent from Msingi Platform identity
   (school registration flow, system notices, platform alerts)
   ══════════════════════════════════════════════════════════════ */

/* 1. School registered — pending review */
async function sendRegistrationPending({ adminName, adminEmail, schoolName, plan }) {
  const html = _wrap(`
    <h2>Your application is under review 👋</h2>
    <p>Hi ${adminName},</p>
    <p>Thank you for registering <strong>${schoolName}</strong> on Msingi. We have received your application and our team is reviewing it.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Status:</strong> <span class="badge pending">⏳ Pending Review</span></p>
    </div>
    <p>You will receive another email within <strong>24 hours</strong> once your account has been reviewed. If approved, you will receive your login credentials and can start setting up your school immediately.</p>
    <p>If you have any questions, contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
    <p>Thank you for choosing Msingi!</p>
  `);
  return _send(adminEmail, `Application Received — ${schoolName} | Msingi`, html);
}

/* 2. New school registered — alert to platform admin */
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
  return _send(PLATFORM_EMAIL, `[Msingi] New School Registration — ${schoolName}`, html);
}

/* 3. School approved — welcome email with credentials */
async function sendApprovalWelcome({ adminName, adminEmail, schoolName, slug, plan, tempPassword }) {
  // Build the school's dedicated subdomain URL.
  // APP_URL might be "https://school-management-ecosystem.onrender.com" or
  // "https://msingi.io". We extract the base host and prepend the slug.
  let loginUrl = `${APP_URL}/login`;
  try {
    const u     = new URL(APP_URL);
    const parts = u.hostname.split('.');
    // If the host already has 3+ parts it has a subdomain — strip it to get base
    const base  = parts.length >= 3 ? parts.slice(1).join('.') : u.hostname;
    // localhost / raw IPs → keep the path-based fallback
    if (!u.hostname.match(/^\d+\.\d+/) && u.hostname !== 'localhost') {
      loginUrl = `${u.protocol}//${slug}.${base}`;
    }
  } catch { /* keep default */ }

  const hasPassword = !!tempPassword;
  const html = _wrap(`
    <h2>🎉 Your school is approved!</h2>
    <p>Hi ${adminName},</p>
    <p>Great news! <strong>${schoolName}</strong> has been approved on Msingi. Your account is now active and ready to use.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Status:</strong> <span class="badge approved">✓ Approved</span></p>
      <p><strong>Your dedicated portal:</strong> <a href="${loginUrl}" style="color:#4f46e5;font-weight:600">${loginUrl}</a></p>
    </div>
    <div style="background:#ede9fe;border-radius:8px;padding:14px 18px;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#4c1d95">
        📌 <strong>Bookmark this URL</strong> — it's your school's permanent home on Msingi.
        Share it with your staff so they can log in directly.
      </p>
    </div>
    <h2>Your Login Credentials</h2>
    <div class="info">
      <p><strong>Email:</strong> ${adminEmail}</p>
      ${hasPassword ? `<p><strong>Temporary Password:</strong> <span style="font-family:monospace;font-size:16px;font-weight:700;color:#4f46e5;background:#ede9fe;padding:4px 10px;border-radius:4px;letter-spacing:1px">${tempPassword}</span></p>` : ''}
    </div>
    ${hasPassword ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px 18px;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#92400e"><strong>⚠️ Important:</strong> You will be asked to set a new password on your first login. Choose something strong — this temporary password will no longer work after you change it.</p>
    </div>` : ''}
    <p style="text-align:center">
      <a href="${loginUrl}" class="btn">Log In to Msingi →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">Need help? Contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
    <p style="font-size:12px;color:#9ca3af">⚠️ Never share your password with anyone — Msingi will never ask for it by email.</p>
  `);
  return _send(adminEmail, `✅ Your Msingi account is approved — ${schoolName}`, html);
}

/* 4. School rejected */
async function sendRejectionEmail({ adminName, adminEmail, schoolName, reason }) {
  const html = _wrap(`
    <h2>Application Update — ${schoolName}</h2>
    <p>Hi ${adminName},</p>
    <p>Thank you for your interest in Msingi. After reviewing your application for <strong>${schoolName}</strong>, we are unable to approve it at this time.</p>
    ${reason ? `<div class="info"><p><strong>Reason:</strong> ${reason}</p></div>` : ''}
    <p>If you believe this is an error or would like to discuss further, please contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
    <p style="font-size:13px;color:#6b7280">You are welcome to re-apply after addressing any concerns raised.</p>
  `);
  return _send(adminEmail, `Msingi Application Update — ${schoolName}`, html);
}

/* 5. Platform admin approved alert (internal cc) */
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
  return _send(PLATFORM_EMAIL, `[Msingi] Approved: ${schoolName}`, html);
}

/* 6. Trial expiry reminder (platform → school admin) */
async function sendTrialReminder({ adminName, adminEmail, schoolName, schoolEmail, plan, daysLeft, trialEnds }) {
  const urgency = daysLeft === 0 ? '🚨 Today is your last day' : daysLeft === 1 ? '⚠️ 1 day left' : `⏰ ${daysLeft} days left`;
  const support = schoolEmail || SUPPORT_EMAIL;
  const html = _wrap(`
    <h2>${urgency} on your free trial</h2>
    <p>Hi ${adminName},</p>
    <p>Your 30-day free trial for <strong>${schoolName}</strong> ${daysLeft === 0 ? 'ends <strong>today at midnight</strong>' : `ends in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>`}.</p>
    <div class="info">
      <p><strong>School:</strong> ${schoolName}</p>
      <p><strong>Current Plan:</strong> ${plan}</p>
      <p><strong>Trial Ends:</strong> ${trialEnds}</p>
    </div>
    <p>To keep your school running smoothly with no interruption, please confirm your subscription before the trial expires.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Manage My Subscription →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
  `, schoolName);
  return _send(adminEmail, `${urgency} — Msingi trial for ${schoolName}`, html);
}

/* 12. System-wide update / maintenance notice to school admins */
async function sendSystemUpdateNotice({ adminName, adminEmail, schoolName, title, description, type, scheduledAt, affectsAt }) {
  const typeIcons  = { maintenance:'🔧', update:'🚀', security:'🔒', info:'ℹ️' };
  const typeLabels = { maintenance:'Scheduled Maintenance', update:'Platform Update', security:'Security Notice', info:'Platform Notice' };
  const icon   = typeIcons[type]  || 'ℹ️';
  const label  = typeLabels[type] || 'Platform Notice';
  const urgent = type === 'maintenance' || type === 'security';

  const scheduledLine = scheduledAt
    ? `<p><strong>Scheduled:</strong> ${new Date(scheduledAt).toLocaleString('en-GB', { dateStyle:'long', timeStyle:'short' })}</p>`
    : '';
  const affectsLine = affectsAt
    ? `<p><strong>Maintenance window:</strong> ${new Date(affectsAt).toLocaleString('en-GB', { dateStyle:'long', timeStyle:'short' })}</p>`
    : '';

  const html = _wrap(`
    <h2>${icon} ${label}</h2>
    <p>Hi ${adminName},</p>
    <p>You are receiving this notice as the administrator of <strong>${schoolName}</strong> on Msingi.</p>
    <div class="info">
      <p><strong>Notice:</strong> ${title}</p>
      ${scheduledLine}
      ${affectsLine}
    </div>
    <p style="white-space:pre-line">${description}</p>
    ${urgent ? `
    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#92400e"><strong>⚠️ Action recommended:</strong> Before this update, please log in and create a data backup. This takes less than a minute and ensures your data is safe.</p>
    </div>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Log In & Back Up Now →</a>
    </p>` : `
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Visit Your Dashboard →</a>
    </p>`}
    <p style="font-size:13px;color:#6b7280">Questions about this notice? Contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
  `);
  return _send(adminEmail, `${icon} Msingi — ${label}: ${title}`, html);
}

/* ══════════════════════════════════════════════════════════════
   SCHOOL EMAILS — sent from the school's identity
   From:     "<School Name> via Msingi" <SMTP_USER env var>
   Reply-To: school.systemEmail  (falls back to PLATFORM_EMAIL)

   All school-level functions accept schoolEmail as the last
   destructured param. Callers pass school.systemEmail.
   ══════════════════════════════════════════════════════════════ */

/* 7. Two-factor authentication OTP */
async function sendLoginOTP({ name, email, otp, schoolName, schoolEmail }) {
  const support = schoolEmail || SUPPORT_EMAIL;
  const html = _wrap(`
    <h2>Your sign-in code 🔐</h2>
    <p>Hi ${name},</p>
    <p>Someone (hopefully you!) is signing in to <strong>${schoolName}</strong> on Msingi. Use the code below to complete your login.</p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#f1f5f9;border:2px dashed #c7d2fe;border-radius:12px;padding:18px 36px">
        <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#4f46e5;font-family:monospace">${otp}</div>
      </div>
    </div>
    <p style="font-size:13px;color:#6b7280">This code expires in <strong>5 minutes</strong>. If you did not attempt to sign in, please change your password immediately and contact <a href="mailto:${support}">${support}</a>.</p>
    <p style="font-size:12px;color:#9ca3af">Do not share this code with anyone — Msingi will never ask for it.</p>
  `, schoolName);
  return _sendAsSchool(email, `${otp} — Your ${schoolName} sign-in code`, html, { schoolName, schoolEmail });
}

/* 8. New user welcome — sends temporary login credentials */
async function sendWelcomeCredentials({ name, email, tempPassword, schoolName, schoolEmail, role, loginUrl }) {
  const roleLabel = (role || 'staff').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const support   = schoolEmail || PLATFORM_EMAIL;
  const html = _wrap(`
    <h2>Welcome to ${schoolName}! 🎉</h2>
    <p>Hi ${name},</p>
    <p>Your account on <strong>${schoolName}</strong> has been created. Here are your login credentials to get started.</p>
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
    <p style="font-size:13px;color:#6b7280">If you did not expect this email, contact your school administrator at <a href="mailto:${support}">${support}</a>.</p>
    <p style="font-size:12px;color:#9ca3af">⚠️ Never share your password with anyone — Msingi will never ask for it.</p>
  `, schoolName);
  return _sendAsSchool(email, `Your ${schoolName} account is ready — welcome aboard`, html, { schoolName, schoolEmail });
}

/* 9. Password expiry reminder */
async function sendPasswordExpirySoon({ name, email, schoolName, schoolEmail, daysLeft }) {
  const urgency = daysLeft <= 1 ? '🚨 Urgent' : daysLeft <= 3 ? '⚠️ Action needed' : '🔑 Reminder';
  const support = schoolEmail || SUPPORT_EMAIL;
  const html = _wrap(`
    <h2>${urgency}: Your password expires ${daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}</h2>
    <p>Hi ${name},</p>
    <p>Your password for <strong>${schoolName}</strong> ${daysLeft <= 0 ? 'has expired' : `will expire in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>`} as part of our 60-day security policy.</p>
    <p>Please sign in and update your password now to avoid being locked out.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Update Password Now →</a>
    </p>
    <p style="font-size:13px;color:#6b7280">Need help? Contact your school administrator at <a href="mailto:${support}">${support}</a>.</p>
  `, schoolName);
  return _sendAsSchool(email, `${urgency} — password expires ${daysLeft <= 0 ? 'today' : `in ${daysLeft} days`} · ${schoolName}`, html, { schoolName, schoolEmail });
}

/* 10. Password changed — security confirmation */
async function sendPasswordChanged({ name, email, schoolName, schoolEmail }) {
  const support = schoolEmail || SUPPORT_EMAIL;
  const html = _wrap(`
    <h2>✅ Password updated successfully</h2>
    <p>Hi ${name},</p>
    <p>Your password for <strong>${schoolName}</strong> was just changed. Your next password change will be due in <strong>60 days</strong>.</p>
    <p style="font-size:13px;color:#6b7280">If you did not make this change, contact your school administrator immediately at <a href="mailto:${support}">${support}</a>.</p>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">Sign In →</a>
    </p>
  `, schoolName);
  return _sendAsSchool(email, `Password changed — ${schoolName}`, html, { schoolName, schoolEmail });
}

/* 11. Role / permission change notification */
async function sendRoleChanged({ name, email, schoolName, schoolEmail, oldRole, newRole, changedBy }) {
  const fmt    = r => (r || 'staff').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const support = schoolEmail || SUPPORT_EMAIL;
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
    <p style="font-size:13px;color:#6b7280">If you believe this change was made in error, contact your school administrator at <a href="mailto:${support}">${support}</a>.</p>
  `, schoolName);
  return _sendAsSchool(email, `Your role has changed — ${schoolName}`, html, { schoolName, schoolEmail });
}

/* 13. In-app message / announcement notification */
async function sendMessageNotification({ recipientName, recipientEmail, senderName, subject, preview, schoolName, schoolEmail, isDirect, appUrl }) {
  const url   = appUrl || APP_URL;
  const icon  = isDirect ? '✉️' : '📢';
  const label = isDirect ? 'New Message' : 'School Announcement';
  const html  = _wrap(`
    <h2>${icon} ${label}</h2>
    <p>Hi ${recipientName},</p>
    <p>${isDirect ? `<strong>${senderName}</strong> has sent you a message` : `<strong>${senderName}</strong> posted a school announcement`} on <strong>${schoolName}</strong>.</p>
    <div class="info">
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Preview:</strong> ${preview}</p>
      ${!isDirect ? `<p><strong>From:</strong> ${senderName} · ${schoolName}</p>` : ''}
    </div>
    <p>Log in to read the full message and reply.</p>
    <p style="text-align:center">
      <a href="${url}" class="btn">Open ${schoolName} →</a>
    </p>
    <p style="font-size:12px;color:#9ca3af">You are receiving this because you are a member of <strong>${schoolName}</strong>. Log in to manage your notification preferences.</p>
  `, schoolName);
  return _sendAsSchool(recipientEmail, `${icon} ${label}: ${subject} — ${schoolName}`, html, { schoolName, schoolEmail });
}

/* 13. Assessment reminder — sent to teachers */
async function sendAssessmentReminder({
  name, email: toEmail, assessment, termNumber, dateFrom, dateTo,
  status, schoolName, schoolEmail,
}) {
  const statusDetails = {
    upcoming: { icon: '📅', title: 'Upcoming Assessment', color: '#4f46e5', msg: `opens on <strong>${dateFrom}</strong> and closes on <strong>${dateTo}</strong>` },
    open:     { icon: '✏️',  title: 'Assessment Open',    color: '#16a34a', msg: `is currently open and closes on <strong>${dateTo}</strong>` },
    overdue:  { icon: '⚠️',  title: 'Overdue Assessment', color: '#dc2626', msg: `closed on <strong>${dateTo}</strong> — please enter marks as soon as possible` },
  }[status] || { icon: '📋', title: 'Assessment Reminder', color: '#4f46e5', msg: '' };

  const html = _wrap(`
    <h2>${statusDetails.icon} ${statusDetails.title}</h2>
    <p>Hi ${name},</p>
    <p>This is a reminder from <strong>${schoolName}</strong> about the following assessment:</p>
    <div class="info">
      <p><strong>Assessment:</strong> ${assessment}</p>
      <p><strong>Term:</strong> Term ${termNumber}</p>
      <p><strong>Period:</strong> ${dateFrom} → ${dateTo}</p>
      <p><strong>Status:</strong> <span style="color:${statusDetails.color};font-weight:700">${status.toUpperCase()}</span></p>
    </div>
    <p>This assessment ${statusDetails.msg}. Please log in to enter or review marks.</p>
    <p style="text-align:center">
      <a href="${APP_URL}/exams" class="btn">Open Gradebook →</a>
    </p>
    <p style="font-size:12px;color:#9ca3af">You are receiving this as a teacher at <strong>${schoolName}</strong>.</p>
  `, schoolName);

  return _sendAsSchool(toEmail, `${statusDetails.icon} ${schoolName} — ${assessment} (Term ${termNumber}) ${status}`, html, { schoolName, schoolEmail });
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
  sendSystemUpdateNotice,
  sendMessageNotification,
  sendAssessmentReminder,
};
