/* ============================================================
   Msingi — Outreach email renderer

   Cold outreach is conversational, so it deliberately does not use
   the transactional _wrap() in utils/email.js (that wrapper says
   "automated message — please do not reply"). This renderer is
   table-based, inline-styled and safe for the major email clients.
   ============================================================ */
'use strict';

const DEFAULT_DEMO_URL = 'https://msingi.io/contact';
const DEFAULT_PLATFORM_URL = 'https://msingi.io/platform-overview';
const DEFAULT_LOGO_URL = 'https://msingi.io/api/public/platform-asset/logo';
const DEFAULT_PHONE = '+254 769 024 153';
const SUPPORTED_PLACEHOLDERS = new Set([
  'first_name', 'school_name', 'city', 'country', 'curriculum', 'role',
  'sender_name', 'sender_role', 'reply_to', 'phone', 'trust_line',
  'pricing_line', 'legal_name', 'postal_address', 'demo_url', 'platform_url', 'unsubscribe_url',
]);

/* Values sampled from the live msingi.io landing page and logo on 2026-11-26.
   The legacy key names are retained to avoid churn in template call sites. */
const COLORS = {
  green950: '#0f172a', // slate-900 / dark hero and CTA panel
  green900: '#1e293b', // slate-800
  green700: '#0f172a', // navy for small text and footer links (AA on cream)
  gold: '#00e898',     // exact green sampled from the live Msingi logo
  cream: '#f8fafc',    // slate-50 / benefit panels
  paper: '#ffffff',
  canvas: '#f1f5f9',   // slate-100
  ink: '#0f172a',
  muted: '#475569',    // slate-600
  line: '#e2e8f0',     // slate-200
  softWhite: '#e2e8f0',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function safeUrl(value, fallback = DEFAULT_DEMO_URL) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function interpolate(value, context, escape = false) {
  return String(value ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key) => {
    const replacement = context[key.toLowerCase()] ?? '';
    return escape ? escapeHtml(replacement) : String(replacement);
  });
}

function unresolvedPlaceholders(value) {
  return [...String(value || '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(match => match[1]);
}

function validateTemplate(template) {
  const errors = [];
  const fields = ['subject', 'preheader', 'headline', 'intro', 'closing', 'ctaLabel', 'ctaUrl'];
  for (const field of fields) {
    const unknown = unresolvedPlaceholders(template[field]).filter(key => !SUPPORTED_PLACEHOLDERS.has(key));
    if (unknown.length) errors.push(`Unknown placeholder(s) in ${field}: ${unknown.join(', ')}.`);
  }
  for (const [index, benefit] of (template.benefits || []).entries()) {
    for (const field of ['title', 'body']) {
      const unknown = unresolvedPlaceholders(benefit[field]).filter(key => !SUPPORTED_PLACEHOLDERS.has(key));
      if (unknown.length) errors.push(`Unknown placeholder(s) in benefit ${index + 1} ${field}: ${unknown.join(', ')}.`);
    }
  }
  const cta = String(template.ctaUrl || '').trim();
  if (cta && !/^\{\{\s*(demo_url|platform_url)\s*\}\}$/i.test(cta)) {
    try {
      const url = new URL(cta);
      if (!['http:', 'https:'].includes(url.protocol)) errors.push('CTA URL must use HTTP or HTTPS.');
    } catch {
      errors.push('CTA URL must be a valid HTTP(S) URL or a supported placeholder.');
    }
  }
  if (!String(template.subject || '').trim()) errors.push('Subject is required.');
  if (!String(template.headline || '').trim()) errors.push('Headline is required.');
  if (!String(template.intro || '').trim()) errors.push('Introduction is required.');
  if (!Array.isArray(template.benefits) || template.benefits.length < 1 || template.benefits.length > 3) {
    errors.push('Add between one and three benefit blocks.');
  }
  for (const benefit of template.benefits || []) {
    if (!String(benefit.title || '').trim() || !String(benefit.body || '').trim()) {
      errors.push('Every benefit needs a title and description.');
    }
  }
  return errors;
}

function whatsappUrl(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function buildContext({ lead = {}, campaign = {}, sender = {}, unsubscribeUrl, stepIndex = 0 }) {
  const demoUrl = new URL(DEFAULT_DEMO_URL);
  demoUrl.searchParams.set('utm_source', 'outreach');
  demoUrl.searchParams.set('utm_medium', 'email');
  if (campaign.id) demoUrl.searchParams.set('utm_campaign', campaign.id);
  demoUrl.searchParams.set('utm_content', `step-${stepIndex + 1}`);

  return {
    first_name: lead.contactName || '',
    school_name: lead.schoolName || 'your school',
    city: lead.city || '',
    country: lead.country || '',
    curriculum: lead.curriculum || 'your curriculum',
    role: lead.role || '',
    sender_name: sender.name || 'The Msingi team',
    sender_role: sender.role || 'Schools Team',
    reply_to: sender.replyTo || '',
    phone: sender.phone || DEFAULT_PHONE,
    trust_line: sender.trustLine || 'Tenant-isolated records • Audited operator actions',
    pricing_line: sender.pricingLine || 'Starting at KSh 250 / student / term',
    legal_name: sender.legalName || 'Msingi',
    postal_address: sender.postalAddress || '',
    demo_url: demoUrl.toString(),
    platform_url: DEFAULT_PLATFORM_URL,
    unsubscribe_url: unsubscribeUrl || '#',
  };
}

function renderOutreachEmail({ template, lead = {}, campaign = {}, sender = {}, unsubscribeUrl, stepIndex = 0 }) {
  const context = buildContext({ lead, campaign, sender, unsubscribeUrl, stepIndex });
  const subject = interpolate(template.subject, context).replace(/[\r\n]+/g, ' ');
  const displaySubject = subject;
  const preheader = interpolate(template.preheader, context, true);
  const headline = interpolate(template.headline, context, true).replace(/\n/g, '<br>');
  const intro = interpolate(template.intro, context, true).replace(/\n/g, '<br>');
  const closing = interpolate(template.closing, context, true).replace(/\n/g, '<br>');
  const ctaLabel = interpolate(template.ctaLabel || 'Book a Demo', context, true);
  const ctaUrl = safeUrl(interpolate(template.ctaUrl || '{{demo_url}}', context));
  const logoUrl = safeUrl(sender.logoUrl || DEFAULT_LOGO_URL, DEFAULT_LOGO_URL);
  const phone = context.phone;
  const waUrl = whatsappUrl(phone);
  const benefits = (template.benefits || []).map(benefit => `
    <tr>
      <td style="padding:0 0 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLORS.cream}" style="background:${COLORS.cream};border:1px solid ${COLORS.line};border-radius:10px;">
          <tr>
            <td width="4" bgcolor="${COLORS.gold}" style="width:4px;background:${COLORS.gold};font-size:0;line-height:0;">&nbsp;</td>
            <td style="padding:17px 20px;">
              <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;font-weight:700;color:${COLORS.ink};">${interpolate(benefit.title, context, true)}</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:${COLORS.muted};">${interpolate(benefit.body, context, true)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(displaySubject)}</title>
  <style>
    @media only screen and (max-width:620px) {
      body, .email-body { margin:0 !important; padding:0 !important; }
      .email-container { width:100% !important; max-width:100% !important; }
      .email-pad { padding-left:22px !important; padding-right:22px !important; }
      .email-headline { font-size:30px !important; line-height:1.12 !important; }
      .email-panel-title { font-size:25px !important; line-height:1.18 !important; }
      .email-cta { display:block !important; width:100% !important; box-sizing:border-box !important; text-align:center !important; }
      .email-site { display:none !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background:${COLORS.canvas};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLORS.canvas};">
    <tr><td align="center" style="padding:28px 12px;">
      <!--[if mso]><table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td><![endif]-->
      <table role="presentation" class="email-container" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:${COLORS.paper};border:1px solid ${COLORS.line};border-radius:14px;overflow:hidden;box-shadow:0 14px 36px rgba(20,35,29,.10);">
        <tr><td class="email-pad" bgcolor="${COLORS.green950}" style="padding:22px 34px;background:${COLORS.green950};border-bottom:3px solid ${COLORS.gold};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td align="left" style="vertical-align:middle;"><img src="${escapeHtml(logoUrl)}" width="250" alt="Msingi — School Management Platform" style="display:block;width:250px;max-width:100%;height:auto;border:0;"></td>
            <td class="email-site" align="right" style="vertical-align:middle;"><a href="https://msingi.io" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;font-weight:700;color:${COLORS.softWhite};text-decoration:none;">msingi.io &nbsp;&rarr;</a></td>
          </tr></table>
        </td></tr>
        <tr><td class="email-pad" style="padding:34px 34px 30px;">
          <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${COLORS.muted};">Hello ${escapeHtml(lead.schoolName || 'there')} team,</p>
          <h1 class="email-headline" style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.1;font-weight:700;letter-spacing:-.9px;color:${COLORS.ink};">${headline}</h1>
          <p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:${COLORS.muted};">${intro}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${benefits}</table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLORS.green950}" style="margin-top:12px;background:${COLORS.green950};border-radius:12px;">
            <tr><td align="center" style="padding:30px 26px;">
              <h2 class="email-panel-title" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">See how Msingi fits ${escapeHtml(lead.schoolName || 'your school')}</h2>
              <p style="margin:0 auto 22px;max-width:440px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:${COLORS.softWhite};">${closing}</p>
              <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(ctaUrl)}" style="height:50px;v-text-anchor:middle;width:300px;" arcsize="16%" strokecolor="${COLORS.gold}" fillcolor="${COLORS.gold}"><w:anchorlock/><center style="color:${COLORS.green950};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;">${ctaLabel}</center></v:roundrect><![endif]-->
              <!--[if !mso]><!--><a class="email-cta" href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${COLORS.gold};color:${COLORS.green950};text-decoration:none;padding:16px 26px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:700;">${ctaLabel} &nbsp;&rarr;</a><!--<![endif]-->
              ${waUrl ? `<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.softWhite};">Or call / WhatsApp directly: <a href="${escapeHtml(waUrl)}" style="color:${COLORS.gold};text-decoration:underline;font-weight:700;">${escapeHtml(phone)}</a></p>` : ''}
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${COLORS.ink};font-weight:700;">${escapeHtml(sender.name || 'The Msingi team')}</p>
          <p style="margin:2px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(sender.role || 'Schools Team')} · Msingi</p>
          ${sender.replyTo ? `<p style="margin:2px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(sender.replyTo)}</p>` : ''}
        </td></tr>
        <tr><td class="email-pad" bgcolor="${COLORS.cream}" style="padding:22px 34px;background:${COLORS.cream};border-top:1px solid ${COLORS.line};">
          <p style="margin:0 0 7px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.green700};font-weight:700;">${escapeHtml(context.trust_line)}</p>
          <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.muted};">${escapeHtml(context.pricing_line)}</p>
          <p style="margin:0 0 7px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.muted};">${escapeHtml(context.legal_name)} · Nairobi, Kenya${context.postal_address ? ` · ${escapeHtml(context.postal_address)}` : ''} · <a href="https://msingi.io" style="color:${COLORS.green700};text-decoration:underline;">msingi.io</a> · <a href="https://msingi.io/privacy" style="color:${COLORS.green700};text-decoration:underline;">Privacy</a></p>
          <p style="margin:0 0 7px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${COLORS.muted};">We believe Msingi may be relevant to ${escapeHtml(lead.schoolName || 'your school')}. If it is not, use the link below and we will not contact this address again.</p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;"><a href="${escapeHtml(unsubscribeUrl || '#')}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;

  const benefitText = (template.benefits || []).map(benefit => `${interpolate(benefit.title, context)}\n${interpolate(benefit.body, context)}`).join('\n\n');
  const text = [
    `Hello ${lead.schoolName || 'there'} team,`,
    '',
    interpolate(template.headline, context),
    '',
    interpolate(template.intro, context),
    '',
    benefitText,
    '',
    `See how Msingi fits ${lead.schoolName || 'your school'}`,
    interpolate(template.closing, context),
    '',
    `${interpolate(template.ctaLabel || 'Book a Demo', context)}: ${ctaUrl}`,
    ...(waUrl ? [`Or call / WhatsApp directly: ${phone}`, waUrl] : []),
    '',
    `${sender.name || 'The Msingi team'}`,
    `${sender.role || 'Schools Team'} · Msingi`,
    ...(sender.replyTo ? [sender.replyTo] : []),
    '',
    context.trust_line,
    context.pricing_line,
    `${context.legal_name} · Nairobi, Kenya${context.postal_address ? ` · ${context.postal_address}` : ''} · https://msingi.io · https://msingi.io/privacy`,
    `We believe Msingi may be relevant to ${lead.schoolName || 'your school'}. If it is not, use the link below and we will not contact this address again.`,
    `Unsubscribe: ${unsubscribeUrl || ''}`,
  ].filter(Boolean).join('\n');

  return { subject: displaySubject, html, text };
}

module.exports = {
  COLORS,
  DEFAULT_DEMO_URL,
  DEFAULT_LOGO_URL,
  DEFAULT_PHONE,
  DEFAULT_PLATFORM_URL,
  SUPPORTED_PLACEHOLDERS,
  buildContext,
  escapeHtml,
  interpolate,
  renderOutreachEmail,
  safeUrl,
  unresolvedPlaceholders,
  validateTemplate,
  whatsappUrl,
};
