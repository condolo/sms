/* ============================================================
   Msingi — Platform outreach service

   A deliberately small sales workspace for prospect schools:
   import → segment → sequence → reply/demo. It is platform-level
   data, never tenant data, and every send re-checks suppression,
   campaign state and the daily cap immediately before SMTP.
   ============================================================ */
'use strict';

const crypto = require('crypto');
const { platformModel } = require('../utils/tenant-model');
const { enqueueJob, registerHandler, registerRecoveryHook } = require('../utils/job-queue');
const AuditService = require('./audit');
const email = require('../utils/email');
const {
  renderOutreachEmail,
  unresolvedPlaceholders,
  validateTemplate,
} = require('../utils/outreach-email-template');
const { appUrl } = require('../utils/app-url');

const LEAD_STATUSES = [
  'new', 'contacted', 'replied', 'interested', 'demo_booked',
  'not_interested', 'unsubscribed', 'bounced', 'invalid',
];
const TERMINAL_LEAD_STATUSES = new Set([
  'replied', 'interested', 'demo_booked', 'not_interested',
  'unsubscribed', 'bounced', 'invalid',
]);
const ELIGIBLE_LEAD_STATUSES = ['new', 'contacted'];
const CAMPAIGN_STATUSES = ['draft', 'launching', 'running', 'paused', 'attention', 'cancelled', 'completed'];
const SEND_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped', 'held', 'needs_review', 'bounced', 'replied', 'unsubscribed'];
const SEQUENCE_DELAYS = [0, 4, 9];
const DEFAULT_TEMPLATE_VERSION = 2;
const SEND_LEASE_MS = parseInt(process.env.OUTREACH_SEND_LEASE_MS || '900000', 10);
const MAX_IMPORT_ROWS = 2000;
const MAX_CSV_BYTES = 2 * 1024 * 1024;

const DEFAULT_TEMPLATES = [
  {
    key: 'general-intro',
    name: 'General introduction',
    description: 'Best first message for a generic school inbox.',
    category: 'initial',
    subject: 'A connected school system for {{school_name}}',
    preheader: 'Attendance, academics, fees and parent communication on one record.',
    headline: 'One school record. Fewer manual handoffs.',
    intro: 'Most schools run attendance, CBC/CAIE markbooks, and M-Pesa fee reconciliation across separate registers, spreadsheets, and WhatsApp threads.\n\nMsingi connects all 29 school modules into one live institutional record—built specifically for Kenyan schools.',
    benefits: [
      { title: 'One record, less re-entry', body: 'Admissions, daily attendance, academics, and student fee balances stay synchronized in real time across every portal.' },
      { title: 'Smoother term-end & QR-verifiable report cards', body: 'Move from teacher marks entry (CBC, CAIE, IB, or British) to principal approval and QR-verifiable PDF report cards.' },
      { title: 'Automated M-Pesa reconciliation', body: 'STK Push and Paybill payments match automatically to student accounts—cutting finance reconciliation from mornings to minutes.' },
    ],
    ctaLabel: 'Book a 30-Min Discovery Session',
    ctaUrl: '{{demo_url}}',
    closing: 'We’re onboarding partner schools for the upcoming term. Book a 30-minute walkthrough tailored to your curriculum and fee workflow.',
  },
  {
    key: 'academic-principal',
    name: 'Principal / academic leadership',
    description: 'Focuses on assessment, approval and report-card workflow.',
    category: 'initial',
    subject: 'Fewer handoffs between marks and report cards',
    preheader: 'See how Msingi connects assessment, approval and parent publishing.',
    headline: 'From marks entry to published report cards.',
    intro: 'When term ends, how many handoffs sit between teachers entering marks and parents receiving the final report card?\n\nMsingi connects the whole workflow.',
    benefits: [
      { title: 'Enter once', body: 'Assessment results flow into totals, averages and grades automatically.' },
      { title: 'Review before publishing', body: 'Teacher, reviewer and principal approval stay visible in one process.' },
      { title: 'A verifiable academic archive', body: 'Report cards are signed and QR-verifiable, term by term.' },
    ],
    ctaLabel: 'See the academic workflow',
    ctaUrl: '{{demo_url}}',
    closing: 'Would a 30-minute look at how this would work for {{school_name}} be useful?',
  },
  {
    key: 'finance-director',
    name: 'Director / finance leadership',
    description: 'Focuses on fees, arrears, M-Pesa and collection visibility.',
    category: 'initial',
    subject: 'Fee reconciliation without the spreadsheet bridge',
    preheader: 'Fee statements, M-Pesa payments and parent receipts in one place.',
    headline: 'A clearer view of school collections.',
    intro: 'Many school leaders spend too much time reconciling fee statements, arrears and M-Pesa payments separately.\n\nMsingi links finance to the same student record used for academics.',
    benefits: [
      { title: 'M-Pesa built in', body: 'Reconcile Paybill payments without a separate spreadsheet.' },
      { title: 'Live collection visibility', body: 'See fee structures, arrears and collection progress from the leadership dashboard.' },
      { title: 'Parents stay informed', body: 'Families can see statements and receipts in their portal.' },
    ],
    ctaLabel: 'Book a finance walkthrough',
    ctaUrl: '{{demo_url}}',
    closing: 'If this is a priority for {{school_name}}, we’d be happy to show you in 30 minutes.',
  },
  {
    key: 'curriculum-specific',
    name: 'Curriculum-specific introduction',
    description: 'Use when the school’s curriculum is known.',
    category: 'initial',
    subject: '{{curriculum}} academics on one connected platform',
    preheader: 'Assessment, report cards and school operations designed around your curriculum.',
    headline: 'Built around {{curriculum}}.',
    intro: 'Msingi supports {{curriculum}} inside the same academic engine used for attendance, report cards and school operations.\n\nThere is no separate curriculum module or customisation fee.',
    benefits: [
      { title: 'Curriculum-aware assessment', body: 'Record results against the criteria your school uses.' },
      { title: 'Connected report cards', body: 'Generate, review and publish report cards from the same grade data.' },
      { title: 'One institutional record', body: 'Academic and operational data stay connected across the school.' },
    ],
    ctaLabel: 'Explore Msingi for {{school_name}}',
    ctaUrl: '{{demo_url}}',
    closing: 'Would you be open to a 30-minute walkthrough using {{school_name}}’s workflow?',
  },
  {
    key: 'followup-value',
    name: 'Follow-up — one useful module',
    description: 'Short value-led follow-up, sent four days after the first email.',
    category: 'followup',
    subject: 'One part of Msingi that may help {{school_name}}',
    preheader: 'A quick look at attendance and parent notifications.',
    headline: 'Quick daily attendance, with parent notifications',
    intro: 'One part of Msingi may be particularly relevant: teachers can mark attendance on any device, and absences can trigger parent notifications automatically.',
    benefits: [
      { title: 'Fast daily register', body: 'Mark attendance on any device without a separate paper process.' },
      { title: 'Automatic parent updates', body: 'Absences can trigger notifications through the parent portal.' },
      { title: 'Live leadership visibility', body: 'Attendance trends appear in the director dashboard as data is entered.' },
    ],
    ctaLabel: 'See attendance in action',
    ctaUrl: '{{demo_url}}',
    closing: 'If useful, I can focus a short demo on attendance, report cards or fee reconciliation—whichever matters most at {{school_name}}.',
  },
  {
    key: 'followup-close',
    name: 'Follow-up — close the loop',
    description: 'Polite final follow-up that stops the sequence.',
    category: 'followup',
    subject: 'Should I close the loop?',
    preheader: 'A final note about school-system plans for the coming term.',
    headline: 'Is this a priority for the coming term?',
    intro: 'We haven’t heard back, so we’ll assume the timing isn’t right.\n\nIf {{school_name}} plans to review its systems for the coming term, reply “later” and we’ll follow up then.',
    benefits: [
      { title: 'A focused walkthrough', body: 'Thirty minutes, using the modules and questions that matter to your school.' },
      { title: 'Your curriculum and workflow', body: 'See how Msingi fits the way your school already operates.' },
      { title: 'No pressure', body: 'If it isn’t relevant, we won’t keep emailing.' },
    ],
    ctaLabel: 'Request a discovery session',
    ctaUrl: '{{demo_url}}',
    closing: 'Thanks for your time,\n\n{{sender_name}}',
  },
];

function model(name) {
  return platformModel(name);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCsv(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new Error('CSV is larger than 2 MB.');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter(values => values.some(value => String(value).trim()));
}

const HEADER_ALIASES = {
  school: 'schoolName', schoolname: 'schoolName', institution: 'schoolName',
  name: 'contactName', contact: 'contactName', contactname: 'contactName',
  email: 'email', emailaddress: 'email',
  phone: 'phone', phonenumber: 'phone',
  role: 'role', title: 'role',
  city: 'city', town: 'city',
  country: 'country',
  size: 'schoolSize', schoolsize: 'schoolSize',
  curriculum: 'curriculum',
  website: 'website',
  source: 'source',
  notes: 'notes',
};

function csvHeaderMap(headerRow) {
  return headerRow.map(value => {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return HEADER_ALIASES[key] || null;
  });
}

async function ensureDefaultTemplates() {
  const Templates = model('outreach_templates');
  const operations = DEFAULT_TEMPLATES.flatMap(template => [
    {
      updateOne: {
        filter: { key: template.key },
        update: { $setOnInsert: { ...template, id: `otpl_${crypto.randomUUID()}`, isArchived: false, systemVersion: DEFAULT_TEMPLATE_VERSION, createdAt: new Date(), updatedAt: new Date() } },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { key: template.key, systemVersion: { $lt: DEFAULT_TEMPLATE_VERSION }, isSystemEdited: { $ne: true } },
        update: { $set: { ...template, systemVersion: DEFAULT_TEMPLATE_VERSION, updatedAt: new Date() } },
      },
    },
  ]);
  if (typeof Templates.bulkWrite === 'function') {
    await Templates.bulkWrite(operations, { ordered: false });
  } else {
    for (const template of DEFAULT_TEMPLATES) {
      const exists = await Templates.findOne({ key: template.key }).lean();
      if (!exists) {
        await Templates.create({ ...template, id: `otpl_${crypto.randomUUID()}`, isArchived: false, systemVersion: DEFAULT_TEMPLATE_VERSION });
      } else if ((exists.systemVersion || 0) < DEFAULT_TEMPLATE_VERSION && !exists.isSystemEdited) {
        await Templates.updateOne({ id: exists.id }, { $set: { ...template, systemVersion: DEFAULT_TEMPLATE_VERSION, updatedAt: new Date() } });
      }
    }
  }
}

async function listLeads({ q = '', status = '', page = 1, pageSize = 50 } = {}) {
  const Leads = model('outreach_leads');
  const filter = {};
  if (status && LEAD_STATUSES.includes(status)) filter.status = status;
  if (q) {
    const needle = escapeRegex(q);
    filter.$or = [
      { schoolName: { $regex: needle, $options: 'i' } },
      { contactName: { $regex: needle, $options: 'i' } },
      { email: { $regex: needle, $options: 'i' } },
      { phone: { $regex: needle, $options: 'i' } },
    ];
  }
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 100);
  const number = Math.max(parseInt(page, 10) || 1, 1);
  const [items, total] = await Promise.all([
    Leads.find(filter).sort({ updatedAt: -1 }).skip((number - 1) * size).limit(size).lean(),
    Leads.countDocuments(filter),
  ]);
  return { data: items, pagination: { page: number, limit: size, total, pages: Math.ceil(total / size) } };
}

async function getLead(id) {
  return model('outreach_leads').findOne({ id }).lean();
}

async function getLeadStats() {
  const Leads = model('outreach_leads');
  const [total, contacted, replied, demos, unsubscribed] = await Promise.all([
    Leads.countDocuments({}),
    Leads.countDocuments({ status: { $in: ['contacted', 'replied', 'interested', 'demo_booked'] } }),
    Leads.countDocuments({ status: { $in: ['replied', 'interested', 'demo_booked'] } }),
    Leads.countDocuments({ status: 'demo_booked' }),
    Leads.countDocuments({ status: 'unsubscribed' }),
  ]);
  return { total, contacted, replied, demos, unsubscribed };
}

async function importLeads({ csv, actor }) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('Include a header row and at least one school.');
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`Import at most ${MAX_IMPORT_ROWS} schools at once.`);
  const headers = csvHeaderMap(rows[0]);
  if (!headers.includes('schoolName') || !headers.includes('email')) {
    throw new Error('CSV must include school_name and email columns.');
  }

  const Leads = model('outreach_leads');
  const Suppressions = model('outreach_suppressions');
  const seen = new Set();
  const candidates = [];
  const errors = [];
  let skipped = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];
    const raw = {};
    headers.forEach((header, column) => { if (header) raw[header] = String(values[column] || '').trim(); });
    const emailAddress = normalizeEmail(raw.email);
    const schoolName = String(raw.schoolName || '').trim();
    if (!schoolName || !isValidEmail(emailAddress)) {
      errors.push({ row: index + 1, email: raw.email || '', message: 'A valid school name and email are required.' });
      continue;
    }
    if (seen.has(emailAddress)) {
      skipped += 1;
      continue;
    }
    seen.add(emailAddress);
    candidates.push({ emailAddress, schoolName, raw });
  }

  const emails = candidates.map(candidate => candidate.emailAddress);
  const suppressedRows = emails.length
    ? await Suppressions.find({ email: { $in: emails } }).select('email').lean()
    : [];
  const suppressedEmails = new Set(suppressedRows.map(row => normalizeEmail(row.email)));
  const operations = [];
  let suppressed = 0;

  for (const { emailAddress, schoolName, raw } of candidates) {
    if (suppressedEmails.has(emailAddress)) {
      suppressed += 1;
      continue;
    }
    operations.push({
      updateOne: {
        filter: { email: emailAddress },
        update: {
          $set: {
            schoolName: schoolName.slice(0, 200),
            contactName: String(raw.contactName || '').slice(0, 160),
            email: emailAddress,
            phone: String(raw.phone || '').slice(0, 50),
            role: String(raw.role || '').slice(0, 100),
            city: String(raw.city || '').slice(0, 100),
            country: String(raw.country || '').slice(0, 100),
            schoolSize: String(raw.schoolSize || '').slice(0, 60),
            curriculum: String(raw.curriculum || '').slice(0, 120),
            website: String(raw.website || '').slice(0, 300),
            source: String(raw.source || 'csv').slice(0, 100),
            importNotes: String(raw.notes || '').slice(0, 2000),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            id: `lead_${crypto.randomUUID()}`,
            status: 'new',
            ownerId: actor?.userId || null,
            ownerName: actor?.name || actor?.email || '',
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  let created = 0;
  if (operations.length) {
    if (typeof Leads.bulkWrite === 'function') {
      for (let offset = 0; offset < operations.length; offset += 200) {
        const result = await Leads.bulkWrite(operations.slice(offset, offset + 200), { ordered: false });
        created += result.upsertedCount || 0;
      }
    } else {
      for (const operation of operations) {
        const result = await Leads.updateOne(operation.updateOne.filter, operation.updateOne.update, { upsert: true });
        if (result.upsertedCount) created += 1;
      }
    }
  }
  const updated = operations.length - created;

  AuditService.log({
    action: 'platform.outreach.leads_imported',
    actor: actor || {}, schoolId: null,
    target: { type: 'outreach_import', id: null, label: 'CSV import' },
    details: { created, updated, skipped, suppressed, errors: errors.length },
  });
  return { created, updated, skipped, suppressed, errors: errors.slice(0, 50), errorCount: errors.length };
}

async function validateDemoRequestId(value) {
  if (!value) return null;
  const request = await platformModel('demo_requests').findOne({ id: String(value) }).select('id').lean();
  if (!request) throw new Error('Linked demo request was not found.');
  return String(value);
}

async function createLead({ input = {}, actor }) {
  const schoolName = String(input.schoolName || '').trim().slice(0, 200);
  const emailAddress = normalizeEmail(input.email);
  if (!schoolName || !isValidEmail(emailAddress)) throw new Error('A school name and valid email are required.');
  const Leads = model('outreach_leads');
  if (await Leads.exists({ email: emailAddress })) throw new Error('A lead with that email already exists.');
  if (await model('outreach_suppressions').exists({ email: emailAddress })) throw new Error('That email is suppressed and cannot be added as a lead.');
  const doc = {
    id: `lead_${crypto.randomUUID()}`,
    schoolName,
    contactName: String(input.contactName || '').slice(0, 160),
    email: emailAddress,
    phone: String(input.phone || '').slice(0, 50),
    role: String(input.role || '').slice(0, 100),
    city: String(input.city || '').slice(0, 100),
    country: String(input.country || '').slice(0, 100),
    schoolSize: String(input.schoolSize || '').slice(0, 60),
    curriculum: String(input.curriculum || '').slice(0, 120),
    website: String(input.website || '').slice(0, 300),
    source: String(input.source || 'manual').slice(0, 100),
    status: 'new',
    ownerId: actor?.userId || null,
    ownerName: actor?.name || actor?.email || '',
    nextFollowUpAt: input.nextFollowUpAt || null,
    demoRequestId: await validateDemoRequestId(input.demoRequestId),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await Leads.create(doc);
  AuditService.log({ action: 'platform.outreach.lead_created', actor: actor || {}, schoolId: null, target: { type: 'outreach_lead', id: doc.id, label: schoolName }, details: {} });
  return doc;
}

async function updateLead({ id, patch = {}, actor }) {
  const Leads = model('outreach_leads');
  const existing = await Leads.findOne({ id }).lean();
  if (!existing) throw new Error('Lead not found.');
  const allowed = ['schoolName', 'contactName', 'email', 'phone', 'role', 'city', 'country', 'schoolSize', 'curriculum', 'website', 'source', 'ownerId', 'ownerName', 'status', 'nextFollowUpAt', 'demoRequestId'];
  const update = { updatedAt: new Date() };
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === 'email') update.email = normalizeEmail(patch.email);
    else if (key === 'nextFollowUpAt') update[key] = patch[key] || null;
    else if (key === 'demoRequestId') update[key] = await validateDemoRequestId(patch[key]);
    else update[key] = patch[key];
  }
  if (update.email && !isValidEmail(update.email)) throw new Error('Enter a valid email address.');
  if (update.email && update.email !== existing.email) {
    if (await model('outreach_reservations').exists({ leadId: id })) throw new Error('Change the email after the active campaign completes or is cancelled.');
    if (await model('outreach_reservations').exists({ email: update.email })) throw new Error('That email is reserved by another campaign.');
    if (await model('outreach_leads').exists({ email: update.email, id: { $ne: id } })) throw new Error('Another lead already uses that email.');
    if (await model('outreach_suppressions').exists({ email: update.email })) throw new Error('That email is suppressed and cannot be used.');
    await model('outreach_sends').updateMany(
      { leadId: id, status: { $in: ['queued', 'held', 'failed', 'needs_review'] }, email: existing.email },
      { $set: { email: update.email, updatedAt: new Date() } },
    );
  }
  if (update.status && !LEAD_STATUSES.includes(update.status)) throw new Error('Unknown lead status.');
  await Leads.updateOne({ id }, { $set: update });

  if (update.status && TERMINAL_LEAD_STATUSES.has(update.status)) {
    const affected = await model('outreach_sends').find({ leadId: id, status: { $in: ['queued', 'held'] } }).select('campaignId').lean();
    await model('outreach_sends').updateMany(
      { leadId: id, status: { $in: ['queued', 'held'] } },
      { $set: { status: 'skipped', skipReason: `lead_${update.status}`, updatedAt: new Date() } },
    );
    for (const campaignId of [...new Set(affected.map(row => row.campaignId))]) await maybeCompleteCampaign(campaignId);
  }
  if (update.status === 'unsubscribed' || update.status === 'bounced') {
    await suppressEmail(update.email || existing.email, update.status);
  }
  AuditService.log({
    action: 'platform.outreach.lead_updated', actor: actor || {}, schoolId: null,
    target: { type: 'outreach_lead', id, label: existing.schoolName },
    details: { status: update.status || existing.status },
  });
  return getLead(id);
}

async function addLeadNote({ id, body, actor }) {
  const note = String(body || '').trim().slice(0, 4000);
  if (!note) throw new Error('Write a note first.');
  const Leads = model('outreach_leads');
  const result = await Leads.updateOne(
    { id },
    {
      $push: { notes: { id: `note_${crypto.randomUUID()}`, body: note, authorName: actor?.name || actor?.email || 'Platform operator', createdAt: new Date() } },
      $set: { updatedAt: new Date() },
    },
  );
  if (!result.modifiedCount) throw new Error('Lead not found.');
  return getLead(id);
}

// Opt-in page helper for outreach lists. Existing callers pass nothing and
// keep receiving the full array, so the console contract does not break.
function _pageOf(pagination, cap) {
  const page = Math.max(1, parseInt(pagination?.page) || 1);
  const pageSize = Math.min(cap, Math.max(1, parseInt(pagination?.pageSize ?? pagination?.limit) || cap));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function _pageMeta(page, pageSize, total) {
  return { page, limit: pageSize, total, pages: Math.ceil(total / pageSize) || 1 };
}

async function listTemplates(pagination = null) {
  await ensureDefaultTemplates();
  const Templates = model('outreach_templates');
  const filter = { isArchived: { $ne: true } };
  if (!pagination) {
    return Templates.find(filter).sort({ category: 1, name: 1 }).lean();
  }
  const { page, pageSize, skip } = _pageOf(pagination, 100);
  const [rows, total] = await Promise.all([
    Templates.find(filter).sort({ category: 1, name: 1 }).skip(skip).limit(pageSize).lean(),
    Templates.countDocuments(filter),
  ]);
  return { data: rows, pagination: _pageMeta(page, pageSize, total) };
}

async function getTemplate(id) {
  return model('outreach_templates').findOne({ id }).lean();
}

function cleanTemplateInput(input = {}) {
  return {
    name: String(input.name || '').trim().slice(0, 120),
    description: String(input.description || '').trim().slice(0, 300),
    category: input.category === 'followup' ? 'followup' : 'initial',
    subject: String(input.subject || '').trim().slice(0, 200),
    preheader: String(input.preheader || '').trim().slice(0, 300),
    headline: String(input.headline || '').trim().slice(0, 200),
    intro: String(input.intro || '').trim().slice(0, 3000),
    benefits: Array.isArray(input.benefits) ? input.benefits.slice(0, 3).map(item => ({
      title: String(item.title || '').trim().slice(0, 120),
      body: String(item.body || '').trim().slice(0, 500),
    })) : [],
    ctaLabel: String(input.ctaLabel || 'Book a Demo').trim().slice(0, 80),
    ctaUrl: String(input.ctaUrl || '{{demo_url}}').trim().slice(0, 500),
    closing: String(input.closing || '').trim().slice(0, 2000),
  };
}

async function createTemplate({ input, actor }) {
  const template = cleanTemplateInput(input);
  const errors = validateTemplate(template);
  if (errors.length) throw new Error(errors.join(' '));
  const doc = { ...template, id: `otpl_${crypto.randomUUID()}`, isArchived: false, createdAt: new Date(), updatedAt: new Date() };
  await model('outreach_templates').create(doc);
  AuditService.log({ action: 'platform.outreach.template_created', actor: actor || {}, schoolId: null, target: { type: 'outreach_template', id: doc.id, label: doc.name }, details: {} });
  return doc;
}

async function updateTemplate({ id, input, actor }) {
  const existing = await getTemplate(id);
  if (!existing) throw new Error('Template not found.');
  const template = cleanTemplateInput({ ...existing, ...input });
  const errors = validateTemplate(template);
  if (errors.length) throw new Error(errors.join(' '));
  await model('outreach_templates').updateOne({ id }, { $set: { ...template, isSystemEdited: Boolean(existing.key && existing.systemVersion), updatedAt: new Date() } });
  AuditService.log({ action: 'platform.outreach.template_updated', actor: actor || {}, schoolId: null, target: { type: 'outreach_template', id, label: template.name }, details: {} });
  return getTemplate(id);
}

const DEFAULT_OUTREACH_SETTINGS = {
  enabled: false,
  fromName: 'Msingi Schools Team',
  fromRole: 'Schools Team',
  replyTo: '',
  dailyLimit: 25,
  logoUrl: 'https://msingi.io/api/public/platform-asset/logo',
  phone: '+254 769 024 153',
  trustLine: 'Tenant-isolated records • Audited operator actions',
  pricingLine: 'Starting at KSh 250 / student / term',
  legalName: 'Msingi',
  postalAddress: '',
};

function cleanOutreachSettings(input = {}) {
  const text = (value, fallback, max) => String(value ?? fallback).trim().slice(0, max);
  return {
    enabled: input.enabled === true,
    fromName: text(input.fromName, DEFAULT_OUTREACH_SETTINGS.fromName, 120),
    fromRole: text(input.fromRole, DEFAULT_OUTREACH_SETTINGS.fromRole, 120),
    replyTo: text(input.replyTo, '', 300).toLowerCase(),
    dailyLimit: Math.min(Math.max(parseInt(input.dailyLimit, 10) || DEFAULT_OUTREACH_SETTINGS.dailyLimit, 1), 100),
    logoUrl: text(input.logoUrl, DEFAULT_OUTREACH_SETTINGS.logoUrl, 500),
    phone: text(input.phone, DEFAULT_OUTREACH_SETTINGS.phone, 50),
    trustLine: text(input.trustLine, DEFAULT_OUTREACH_SETTINGS.trustLine, 300),
    pricingLine: text(input.pricingLine, DEFAULT_OUTREACH_SETTINGS.pricingLine, 300),
    legalName: text(input.legalName, DEFAULT_OUTREACH_SETTINGS.legalName, 200),
    postalAddress: text(input.postalAddress, '', 300),
  };
}

async function getOutreachSettings() {
  const Settings = platformModel('platform_settings');
  const doc = await Settings.findOne({ id: 'global' }).lean();
  if (!doc?.outreach) {
    const outreach = cleanOutreachSettings(DEFAULT_OUTREACH_SETTINGS);
    await Settings.updateOne(
      { id: 'global' },
      { $set: { outreach, updatedAt: new Date() }, $setOnInsert: { id: 'global' } },
      { upsert: true },
    );
    return outreach;
  }
  return cleanOutreachSettings({ ...DEFAULT_OUTREACH_SETTINGS, ...doc.outreach });
}

async function updateOutreachSettings({ input = {}, actor }) {
  const current = await getOutreachSettings();
  const settings = cleanOutreachSettings({ ...current, ...input });
  if (settings.enabled && !isValidEmail(settings.replyTo)) {
    throw new Error('Enter a valid monitored Reply-To address before enabling outreach.');
  }
  try {
    const logo = new URL(settings.logoUrl);
    if (!['http:', 'https:'].includes(logo.protocol)) throw new Error('invalid');
  } catch {
    throw new Error('Logo URL must be a valid HTTP(S) address.');
  }
  await platformModel('platform_settings').updateOne(
    { id: 'global' },
    { $set: { outreach: settings, updatedAt: new Date() } },
    { upsert: true },
  );
  AuditService.log({
    action: 'platform.outreach.settings_updated', actor: actor || {}, schoolId: null,
    target: { type: 'platform_settings', id: 'global', label: 'Outreach settings' },
    details: { enabled: settings.enabled, dailyLimit: settings.dailyLimit },
  });
  return settings;
}

async function senderConfig() {
  return getOutreachSettings();
}

async function outreachReady() {
  const settings = await getOutreachSettings();
  return !!(email.outreachReady && email.outreachReady(settings));
}

async function previewTemplate({ templateId, leadId }) {
  const template = await getTemplate(templateId);
  if (!template) throw new Error('Template not found.');
  const lead = leadId ? await getLead(leadId) : {
    schoolName: 'Example School', contactName: 'Grace', city: 'Nairobi', country: 'Kenya', curriculum: 'CBC', role: 'Principal',
  };
  if (!lead) throw new Error('Lead not found.');
  return renderOutreachEmail({
    template, lead, campaign: { id: 'preview' }, sender: await senderConfig(),
    unsubscribeUrl: `${appUrl('/api/outreach/unsubscribe/preview')}`,
  });
}

async function testTemplate({ templateId, to, actor }) {
  if (!isValidEmail(to)) throw new Error('Enter a valid test email address.');
  if (!(await outreachReady())) throw new Error('Outreach sending is disabled in Platform → Outreach settings, or the Reply-To address is invalid.');
  if (await model('outreach_suppressions').exists({ email: normalizeEmail(to) })) {
    throw new Error('That address is on the suppression list and cannot receive outreach email.');
  }
  const preview = await previewTemplate({ templateId });
  const sender = await senderConfig();
  const sent = await email.sendOutreach({
    to: normalizeEmail(to), subject: `[TEST] ${preview.subject}`, html: preview.html, text: preview.text,
    fromName: sender.fromName, replyTo: sender.replyTo, settings: sender,
    headers: { 'X-Msingi-Outreach-Test': 'true' },
  });
  AuditService.log({ action: 'platform.outreach.test_sent', actor: actor || {}, schoolId: null, target: { type: 'outreach_template', id: templateId, label: 'Test email' }, details: { to: normalizeEmail(to), sent } });
  if (!sent) throw new Error('The test email could not be sent. Check the server email logs.');
  return { sent: true };
}

async function listCampaigns(pagination = null) {
  const Campaigns = model('outreach_campaigns');
  if (!pagination) {
    const campaigns = await Campaigns.find({}).sort({ createdAt: -1 }).limit(100).lean();
    return Promise.all(campaigns.map(async campaign => ({
      ...campaign,
      stats: await campaignStats(campaign.id),
    })));
  }
  const { page, pageSize, skip } = _pageOf(pagination, 100);
  const [campaigns, total] = await Promise.all([
    Campaigns.find({}).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Campaigns.countDocuments({}),
  ]);
  const withStats = await Promise.all(campaigns.map(async campaign => ({
    ...campaign,
    stats: await campaignStats(campaign.id),
  })));
  return { data: withStats, pagination: _pageMeta(page, pageSize, total) };
}

async function campaignStats(campaignId) {
  const Sends = model('outreach_sends');
  const rows = typeof Sends.aggregate === 'function'
    ? await Sends.aggregate([{ $match: { campaignId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray()
    : [];
  const stats = { total: 0, recipients: 0, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, held: 0, needs_review: 0, bounced: 0, replied: 0, unsubscribed: 0 };
  for (const row of rows) {
    stats.total += row.count;
    if (row._id in stats) stats[row._id] = row.count;
  }
  if (typeof Sends.distinct === 'function') {
    stats.recipients = (await Sends.distinct('leadId', { campaignId })).length;
  } else {
    stats.recipients = stats.total;
  }
  return stats;
}

async function createCampaign({ input, actor }) {
  const name = String(input.name || '').trim().slice(0, 160);
  if (!name) throw new Error('Campaign name is required.');
  const requestedIds = Array.isArray(input.templateIds) && input.templateIds.length ? input.templateIds.slice(0, 3) : null;
  if (requestedIds && new Set(requestedIds).size !== requestedIds.length) throw new Error('Use each template only once in a sequence.');
  let templates;
  if (requestedIds) {
    templates = await Promise.all(requestedIds.map(id => getTemplate(id)));
    if (templates.some(template => !template)) throw new Error('One or more templates were not found.');
  } else {
    await ensureDefaultTemplates();
    templates = await model('outreach_templates').find({ key: { $in: ['general-intro', 'followup-value', 'followup-close'] } }).lean();
    const order = ['general-intro', 'followup-value', 'followup-close'];
    templates.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  if (!templates.length) throw new Error('Create a template first.');
  if (templates[0].category !== 'initial' || templates.slice(1).some(template => template.category !== 'followup')) {
    throw new Error('A sequence must start with one initial email, followed only by follow-up templates.');
  }
  for (const template of templates) {
    const errors = validateTemplate(template);
    if (errors.length) throw new Error(`${template.name}: ${errors.join(' ')}`);
  }
  const leadIds = Array.isArray(input.leadIds) ? [...new Set(input.leadIds.map(String))].slice(0, 5000) : null;
  const settings = await getOutreachSettings();
  const doc = {
    id: `camp_${crypto.randomUUID()}`,
    name,
    status: 'draft',
    audience: leadIds ? 'selected' : 'eligible',
    leadIds,
    steps: templates.map((template, index) => ({ ...template, delayDays: SEQUENCE_DELAYS[index] ?? SEQUENCE_DELAYS[SEQUENCE_DELAYS.length - 1] })),
    dailyLimit: Math.min(Math.max(parseInt(input.dailyLimit || settings.dailyLimit || 25, 10) || 25, 1), 100),
    scheduledAt: null,
    createdBy: actor?.userId || null,
    createdByName: actor?.name || actor?.email || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await model('outreach_campaigns').create(doc);
  AuditService.log({ action: 'platform.outreach.campaign_created', actor: actor || {}, schoolId: null, target: { type: 'outreach_campaign', id: doc.id, label: name }, details: { steps: templates.length, audience: doc.audience } });
  return doc;
}

function scheduledSlot(start, dayOffset, slot, dailyLimit) {
  const startLocal = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const local = new Date(startLocal);
  local.setUTCDate(local.getUTCDate() + dayOffset);
  local.setUTCHours(0, 0, 0, 0);
  while (local.getUTCDay() === 0 || local.getUTCDay() === 6) local.setUTCDate(local.getUTCDate() + 1);

  let earliestMinute = 8 * 60;
  if (dayOffset === 0 && local.toISOString().slice(0, 10) === startLocal.toISOString().slice(0, 10)) {
    earliestMinute = Math.max(earliestMinute, startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes());
  }
  if (earliestMinute >= 16 * 60) {
    local.setUTCDate(local.getUTCDate() + 1);
    while (local.getUTCDay() === 0 || local.getUTCDay() === 6) local.setUTCDate(local.getUTCDate() + 1);
    earliestMinute = 8 * 60;
  }

  const spread = Math.min(slot, Math.max(dailyLimit - 1, 0)) / Math.max(dailyLimit, 1);
  const windowMinutes = 16 * 60 - earliestMinute;
  local.setUTCMinutes(earliestMinute + Math.round(spread * windowMinutes));
  return new Date(local.getTime() - 3 * 60 * 60 * 1000);
}

async function enqueueSend(send, runAt) {
  const Sends = model('outreach_sends');
  await Sends.updateOne({ id: send.id }, { $set: { runAt, updatedAt: new Date() } });
  await model('queue_jobs').deleteMany({ dedupeKey: `outreach_send:${send.id}` });
  await enqueueJob({
    type: 'outreach_send', payload: { sendId: send.id }, maxAttempts: 1, runAt,
    dedupeKey: `outreach_send:${send.id}`,
  });
}

async function releaseReservations(campaignId) {
  await model('outreach_reservations').deleteMany({ campaignId });
}

async function releaseReservationsIfNoInFlight(campaignId) {
  const campaign = await model('outreach_campaigns').findOne({ id: campaignId }).lean();
  if (!campaign || !['cancelled', 'completed'].includes(campaign.status)) return;
  const inFlight = await model('outreach_sends').countDocuments({ campaignId, status: 'sending' });
  if (!inFlight) await releaseReservations(campaignId);
}

async function reserveRecipients(campaignId, leads) {
  const Reservations = model('outreach_reservations');
  const reserved = [];
  for (let offset = 0; offset < leads.length; offset += 25) {
    const results = await Promise.all(leads.slice(offset, offset + 25).map(async lead => {
      const emailAddress = normalizeEmail(lead.email);
      try {
        const result = await Reservations.updateOne(
          { email: emailAddress },
          { $setOnInsert: { id: `res_${crypto.randomUUID()}`, email: emailAddress, leadId: lead.id, campaignId, createdAt: new Date() } },
          { upsert: true },
        );
        return result.upsertedCount ? lead : null;
      } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
      }
    }));
    reserved.push(...results.filter(Boolean));
  }
  return reserved;
}

async function reconcileCampaignJobs(campaignId) {
  const Sends = model('outreach_sends');
  const sends = await Sends.find({ campaignId, status: { $in: ['queued', 'held'] } }).lean();
  if (!sends.length) return;
  const ids = sends.map(send => send.id);
  const jobs = await model('queue_jobs').find({
    dedupeKey: { $in: ids.map(id => `outreach_send:${id}`) },
    status: { $in: ['pending', 'processing'] },
  }).select('dedupeKey').lean();
  const active = new Set(jobs.map(job => job.dedupeKey));
  let promoted = false;
  for (let offset = 0; offset < sends.length; offset += 25) {
    await Promise.all(sends.slice(offset, offset + 25).map(async send => {
      const key = `outreach_send:${send.id}`;
      if (active.has(key)) return;
      if (send.status === 'held') {
        if (!(await outreachReady())) return;
        await Sends.updateOne({ id: send.id, status: 'held' }, { $set: { status: 'queued', updatedAt: new Date() } });
        promoted = true;
      }
      await enqueueJob({
        type: 'outreach_send', payload: { sendId: send.id }, maxAttempts: 1,
        runAt: new Date(Math.max(Date.now(), new Date(send.runAt).getTime())), dedupeKey: key,
      });
    }));
  }
  if (promoted) {
    await model('outreach_campaigns').updateOne({ id: campaignId, status: 'attention' }, { $set: { status: 'running', updatedAt: new Date() } });
  }
}

let _lastOutreachRecoveryAt = 0;

async function maybeRecoverOutreach() {
  if (Date.now() - _lastOutreachRecoveryAt < 60_000) return;
  _lastOutreachRecoveryAt = Date.now();
  await recoverStaleOutreach().catch(() => {});
}

async function recoverStaleOutreach() {
  const cutoff = new Date(Date.now() - SEND_LEASE_MS);
  const staleSends = await model('outreach_sends').find({ status: 'sending', updatedAt: { $lt: cutoff } }).select('campaignId').lean();
  await model('outreach_sends').updateMany(
    { status: 'sending', updatedAt: { $lt: cutoff } },
    { $set: { status: 'needs_review', lastError: 'Send lease expired. Delivery may be ambiguous; review before retrying.', updatedAt: new Date() } },
  );
  for (const campaignId of [...new Set(staleSends.map(send => send.campaignId))]) {
    await maybeCompleteCampaign(campaignId);
    await releaseReservationsIfNoInFlight(campaignId);
  }
  const activeCampaigns = await model('outreach_campaigns').find({ status: { $in: ['running', 'attention'] } }).select('id').lean();
  for (const campaign of activeCampaigns) await reconcileCampaignJobs(campaign.id).catch(() => {});
  const staleLaunches = await model('outreach_campaigns').find({ status: 'launching', updatedAt: { $lt: cutoff } }).select('id expectedSends plannedLeads').lean();
  for (const campaign of staleLaunches) {
    const [sendCount, reservationCount] = await Promise.all([
      model('outreach_sends').countDocuments({ campaignId: campaign.id }),
      model('outreach_reservations').countDocuments({ campaignId: campaign.id }),
    ]);
    const complete = campaign.expectedSends > 0 && sendCount === campaign.expectedSends && reservationCount === (campaign.plannedLeads || 0);
    if (complete) {
      await model('outreach_campaigns').updateOne({ id: campaign.id, status: 'launching' }, { $set: { status: 'running', updatedAt: new Date() } });
      await reconcileCampaignJobs(campaign.id);
    } else {
      await model('outreach_sends').deleteMany({ campaignId: campaign.id });
      await releaseReservations(campaign.id);
      await model('outreach_campaigns').updateOne({ id: campaign.id, status: 'launching' }, { $set: { status: 'draft', expectedSends: 0, plannedLeads: 0, updatedAt: new Date() } });
    }
  }
}

async function requeueSuccessors(campaign, leadId, sentStepIndex, sentAt) {
  const successors = await model('outreach_sends').find({
    campaignId: campaign.id,
    leadId,
    stepIndex: { $gt: sentStepIndex },
    status: 'skipped',
    skipReason: 'predecessor_not_sent',
  }).lean();
  for (const send of successors) {
    const sentDelay = campaign.steps?.[sentStepIndex]?.delayDays ?? 0;
    const nextDelay = campaign.steps?.[send.stepIndex]?.delayDays ?? sentDelay + 1;
    const runAt = scheduledSlot(new Date(new Date(sentAt).getTime() + Math.max(nextDelay - sentDelay, 1) * 24 * 60 * 60 * 1000), 0, 0, campaign.dailyLimit);
    await model('outreach_sends').updateOne(
      { id: send.id, status: 'skipped', skipReason: 'predecessor_not_sent' },
      { $set: { status: 'queued', runAt, skipReason: null, updatedAt: new Date() } },
    );
    await enqueueSend(send, runAt);
  }
}

async function launchCampaign({ id, scheduledAt, dailyLimit, actor }) {
  const Campaigns = model('outreach_campaigns');
  const campaign = await Campaigns.findOne({ id }).lean();
  if (!campaign) throw new Error('Campaign not found.');
  if (campaign.status !== 'draft') throw new Error('Only a draft campaign can be launched.');
  if (!(await outreachReady())) throw new Error('Outreach sending is disabled in Platform → Outreach settings, or the Reply-To address is invalid.');
  const start = scheduledAt ? new Date(scheduledAt) : new Date();
  if (Number.isNaN(start.getTime())) throw new Error('Choose a valid launch date.');
  const limit = Math.min(Math.max(parseInt(dailyLimit || campaign.dailyLimit || 25, 10) || 25, 1), 100);

  const claimed = await Campaigns.updateOne({ id, status: 'draft' }, { $set: { status: 'launching', updatedAt: new Date() } });
  if (!claimed.modifiedCount) throw new Error('Campaign launch was already claimed or the campaign was cancelled.');

  const sends = [];
  try {
    const Leads = model('outreach_leads');
    const Suppressions = model('outreach_suppressions');
    const filter = campaign.leadIds ? { id: { $in: campaign.leadIds }, status: { $in: ELIGIBLE_LEAD_STATUSES } } : { status: { $in: ELIGIBLE_LEAD_STATUSES } };
    const leads = await Leads.find(filter).limit(5001).lean();
    const overflow = Math.max(leads.length - 5000, 0);
    const candidates = leads.slice(0, 5000);
    const emails = candidates.map(lead => normalizeEmail(lead.email)).filter(Boolean);
    const suppressed = new Set((await Suppressions.find({ email: { $in: emails } }).select('email').lean()).map(row => normalizeEmail(row.email)));
    const validCandidates = candidates.filter(lead => isValidEmail(lead.email) && !suppressed.has(normalizeEmail(lead.email)));
    const eligible = await reserveRecipients(id, validCandidates);
    if (!eligible.length) throw new Error('No eligible leads. Exclude replied, unsubscribed, bounced, demo-booked or already-reserved schools.');

    eligible.forEach((lead, index) => {
      campaign.steps.forEach((step, stepIndex) => {
        const runAt = scheduledSlot(start, Math.floor(index / limit) + (step.delayDays || 0), index % limit, limit);
        sends.push({
          id: `send_${crypto.randomUUID()}`,
          campaignId: id, leadId: lead.id, email: normalizeEmail(lead.email), schoolName: lead.schoolName,
          stepIndex, status: 'queued', runAt, attempts: 0, createdAt: new Date(), updatedAt: new Date(),
        });
      });
    });
    await Campaigns.updateOne({ id, status: 'launching' }, { $set: { expectedSends: sends.length, plannedLeads: eligible.length, updatedAt: new Date() } });
    await model('outreach_sends').insertMany(sends, { ordered: false });
    for (let offset = 0; offset < sends.length; offset += 25) {
      await Promise.all(sends.slice(offset, offset + 25).map(send => enqueueJob({
        type: 'outreach_send', payload: { sendId: send.id }, maxAttempts: 1, runAt: send.runAt,
        dedupeKey: `outreach_send:${send.id}`,
      })));
    }
    const finalized = await Campaigns.updateOne(
      { id, status: 'launching' },
      { $set: { status: 'running', scheduledAt: start, dailyLimit: limit, launchedAt: new Date(), updatedAt: new Date() } },
    );
    if (!finalized.modifiedCount) throw new Error('Campaign was cancelled while launching.');
    AuditService.log({ action: 'platform.outreach.campaign_launched', actor: actor || {}, schoolId: null, target: { type: 'outreach_campaign', id, label: campaign.name }, details: { leads: eligible.length, sends: sends.length, dailyLimit: limit, scheduledAt: start.toISOString(), overflow } });
    return { campaignId: id, leads: eligible.length, sends: sends.length, skipped: candidates.length - eligible.length + overflow, overflow };
  } catch (error) {
    await model('outreach_sends').deleteMany({ campaignId: id });
    await model('queue_jobs').deleteMany({ dedupeKey: { $in: sends.map(send => `outreach_send:${send.id}`) } });
    await releaseReservations(id);
    await Campaigns.updateOne({ id, status: 'launching' }, { $set: { status: 'draft', expectedSends: 0, plannedLeads: 0, updatedAt: new Date() } });
    throw error;
  }
}

async function setCampaignStatus({ id, status, actor }) {
  const Campaigns = model('outreach_campaigns');
  const campaign = await Campaigns.findOne({ id }).lean();
  if (!campaign) throw new Error('Campaign not found.');
  let updated;
  if (status === 'paused') {
    updated = await Campaigns.updateOne({ id, status: 'running' }, { $set: { status, updatedAt: new Date() } });
    if (!updated.modifiedCount) throw new Error('Only a running campaign can be paused.');
  } else if (status === 'running') {
    updated = await Campaigns.updateOne({ id, status: { $in: ['paused', 'attention'] } }, { $set: { status, updatedAt: new Date() } });
    if (!updated.modifiedCount) throw new Error('Only a paused or attention campaign can be resumed.');
  } else if (status === 'cancelled') {
    updated = await Campaigns.updateOne({ id, status: { $in: ['draft', 'launching', 'running', 'paused', 'attention'] } }, { $set: { status, updatedAt: new Date() } });
    if (!updated.modifiedCount) throw new Error('This campaign cannot be cancelled.');
  } else {
    throw new Error('Unknown campaign action.');
  }

  if (status === 'cancelled') {
    await model('outreach_sends').updateMany({ campaignId: id, status: { $in: ['queued', 'held'] } }, { $set: { status: 'skipped', skipReason: 'campaign_cancelled', updatedAt: new Date() } });
    await releaseReservationsIfNoInFlight(id);
  }
  if (status === 'running') {
    const queued = await model('outreach_sends').find({ campaignId: id, status: 'queued' }).sort({ runAt: 1, stepIndex: 1 }).lean();
    for (let index = 0; index < queued.length; index += 1) {
      const send = queued[index];
      const spread = scheduledSlot(new Date(), Math.floor(index / campaign.dailyLimit), index % campaign.dailyLimit, campaign.dailyLimit);
      let earliest = spread.getTime();
      if (send.stepIndex > 0) {
        const previous = await model('outreach_sends').findOne({
          campaignId: id, leadId: send.leadId, stepIndex: { $lt: send.stepIndex }, status: 'sent',
        }).sort({ stepIndex: -1 }).lean();
        if (previous?.sentAt) {
          const previousDelay = campaign.steps?.[previous.stepIndex]?.delayDays ?? 0;
          const currentDelay = campaign.steps?.[send.stepIndex]?.delayDays ?? 0;
          earliest = Math.max(
            earliest,
            new Date(previous.sentAt).getTime() + Math.max(currentDelay - previousDelay, 1) * 24 * 60 * 60 * 1000,
          );
        }
      }
      const runAt = new Date(Math.max(earliest, new Date(send.runAt).getTime()));
      await enqueueSend(send, runAt);
    }
    await maybeCompleteCampaign(id);
  }
  AuditService.log({ action: `platform.outreach.campaign_${status}`, actor: actor || {}, schoolId: null, target: { type: 'outreach_campaign', id, label: campaign.name }, details: {} });
  return Campaigns.findOne({ id }).lean();
}

async function maybeCompleteCampaign(campaignId) {
  const Sends = model('outreach_sends');
  const remaining = await Sends.countDocuments({ campaignId, status: { $in: ['queued', 'sending'] } });
  if (remaining) return;
  const unresolved = await Sends.countDocuments({ campaignId, status: { $in: ['failed', 'needs_review', 'held'] } });
  if (unresolved) {
    await model('outreach_campaigns').updateOne({ id: campaignId, status: { $in: ['running', 'paused'] } }, { $set: { status: 'attention', updatedAt: new Date() } });
    return;
  }
  const completed = await model('outreach_campaigns').updateOne({ id: campaignId, status: { $in: ['running', 'paused'] } }, { $set: { status: 'completed', completedAt: new Date(), updatedAt: new Date() } });
  if (completed.modifiedCount) await releaseReservations(campaignId);
}

async function getCampaign({ id, page = 1, pageSize = 200, status = '' }) {
  const campaign = await model('outreach_campaigns').findOne({ id }).lean();
  if (!campaign) return null;
  await reconcileCampaignJobs(id).catch(() => {});
  const filter = { campaignId: id };
  if (status && SEND_STATUSES.includes(status)) filter.status = status;
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 200, 1), 500);
  const number = Math.max(parseInt(page, 10) || 1, 1);
  const [sends, sendTotal] = await Promise.all([
    model('outreach_sends').find(filter).sort({ runAt: 1, stepIndex: 1 }).skip((number - 1) * size).limit(size).lean(),
    model('outreach_sends').countDocuments(filter),
  ]);
  const leadIds = [...new Set(sends.map(send => send.leadId))];
  const leads = await model('outreach_leads').find({ id: { $in: leadIds } }).select('id schoolName contactName email status').lean();
  const leadMap = new Map(leads.map(lead => [lead.id, lead]));
  return {
    ...campaign,
    stats: await campaignStats(id),
    sendPage: { page: number, limit: size, total: sendTotal, pages: Math.ceil(sendTotal / size), status: status || 'all' },
    sends: sends.map(send => ({ ...send, lead: leadMap.get(send.leadId) || null })),
  };
}

async function recordSendOutcome({ id, outcome, actor }) {
  const Sends = model('outreach_sends');
  const send = await Sends.findOne({ id }).lean();
  if (!send) throw new Error('Send not found.');
  if (!['replied', 'bounced', 'unsubscribed'].includes(outcome)) throw new Error('Unknown outcome.');
  await Sends.updateOne({ id }, { $set: { status: outcome, updatedAt: new Date() } });
  const leadStatus = outcome === 'replied' ? 'replied' : outcome;
  await model('outreach_leads').updateOne({ id: send.leadId }, { $set: { status: leadStatus, updatedAt: new Date() } });
  if (outcome !== 'replied') await suppressEmail(send.email, outcome);
  await model('outreach_sends').updateMany(
    { leadId: send.leadId, status: { $in: ['queued', 'held'] } },
    { $set: { status: 'skipped', skipReason: `lead_${leadStatus}`, updatedAt: new Date() } },
  );
  await maybeCompleteCampaign(send.campaignId);
  AuditService.log({ action: 'platform.outreach.send_outcome', actor: actor || {}, schoolId: null, target: { type: 'outreach_send', id, label: send.schoolName }, details: { outcome } });
  return { updated: true };
}

async function retrySend({ id, actor }) {
  const Sends = model('outreach_sends');
  const send = await Sends.findOne({ id }).lean();
  if (!send) throw new Error('Send not found.');
  if (!['failed', 'needs_review', 'held'].includes(send.status)) throw new Error('Only failed, review-required or held sends can be retried.');
  const campaign = await model('outreach_campaigns').findOne({ id: send.campaignId }).lean();
  if (!campaign || !['running', 'paused', 'attention'].includes(campaign.status)) throw new Error('The campaign is not active.');
  if (campaign.status === 'attention') {
    const resumed = await model('outreach_campaigns').updateOne({ id: campaign.id, status: 'attention' }, { $set: { status: 'running', updatedAt: new Date() } });
    if (!resumed.modifiedCount) throw new Error('Campaign state changed. Refresh and try again.');
  }
  await Sends.updateOne({ id, status: { $in: ['failed', 'needs_review', 'held'] } }, { $set: { status: 'queued', runAt: new Date(), lastError: null, updatedAt: new Date() } });
  await enqueueSend(send, new Date());
  AuditService.log({ action: 'platform.outreach.send_retried', actor: actor || {}, schoolId: null, target: { type: 'outreach_send', id, label: send.schoolName }, details: { previousStatus: send.status } });
  return { queued: true };
}

async function listSuppressions({ q = '', page = 1, pageSize = 50 } = {}) {
  const Suppressions = model('outreach_suppressions');
  const filter = q ? { email: { $regex: escapeRegex(q), $options: 'i' } } : {};
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 100);
  const number = Math.max(parseInt(page, 10) || 1, 1);
  const [items, total] = await Promise.all([
    Suppressions.find(filter).sort({ createdAt: -1 }).skip((number - 1) * size).limit(size).lean(),
    Suppressions.countDocuments(filter),
  ]);
  return { data: items, pagination: { page: number, limit: size, total, pages: Math.ceil(total / size) } };
}

async function addSuppression({ email, reason = 'manual', actor }) {
  const address = normalizeEmail(email);
  if (!isValidEmail(address)) throw new Error('Enter a valid email address.');
  await suppressEmail(address, reason);
  AuditService.log({ action: 'platform.outreach.suppression_added', actor: actor || {}, schoolId: null, target: { type: 'outreach_suppression', id: null, label: address }, details: { reason } });
  return { email: address, reason };
}

async function suppressEmail(emailAddress, reason = 'manual') {
  const normalized = normalizeEmail(emailAddress);
  if (!normalized) return;
  const Suppressions = model('outreach_suppressions');
  await Suppressions.updateOne(
    { email: normalized },
    { $setOnInsert: { id: `supp_${crypto.randomUUID()}`, email: normalized, reason, createdAt: new Date() } },
    { upsert: true },
  );
  const affected = await model('outreach_sends').find({ email: normalized, status: { $in: ['queued', 'held'] } }).select('campaignId').lean();
  await model('outreach_sends').updateMany(
    { email: normalized, status: { $in: ['queued', 'held'] } },
    { $set: { status: 'skipped', skipReason: `suppressed_${reason}`, updatedAt: new Date() } },
  );
  for (const campaignId of [...new Set(affected.map(row => row.campaignId))]) await maybeCompleteCampaign(campaignId);
}

function unsubscribeSecret() {
  const secret = process.env.OUTREACH_UNSUBSCRIBE_SECRET || process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('OUTREACH_UNSUBSCRIBE_SECRET or PLATFORM_JWT_SECRET is required.');
  return secret;
}

function createUnsubscribeToken(sendId) {
  const payload = Buffer.from(JSON.stringify({ sendId, exp: Date.now() + 60 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', unsubscribeSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyUnsubscribeToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', unsubscribeSecret()).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.sendId && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

async function unsubscribeByToken(token) {
  const data = verifyUnsubscribeToken(token);
  if (!data) return { ok: false, message: 'This unsubscribe link is invalid or has expired.' };
  const send = await model('outreach_sends').findOne({ id: data.sendId }).lean();
  if (!send) return { ok: false, message: 'This unsubscribe link is invalid or has expired.' };
  await suppressEmail(send.email, 'unsubscribed');
  await model('outreach_leads').updateOne({ email: send.email }, { $set: { status: 'unsubscribed', updatedAt: new Date() } });
  AuditService.log({
    action: 'platform.outreach.unsubscribed',
    actor: { userId: 'public', role: 'public', email: send.email },
    schoolId: null,
    target: { type: 'outreach_send', id: send.id, label: send.schoolName || send.email },
    details: { reason: 'unsubscribe_link' },
  });
  return { ok: true, email: send.email };
}

async function processOutreachSend(sendId) {
  await maybeRecoverOutreach();
  const Sends = model('outreach_sends');
  const send = await Sends.findOne({ id: sendId }).lean();
  if (!send || send.status !== 'queued') return;
  if (!(await outreachReady())) {
    await Sends.updateOne({ id: sendId, status: 'queued' }, { $set: { status: 'held', lastError: 'Outreach sending is disabled or not configured.', updatedAt: new Date() } });
    await maybeCompleteCampaign(send.campaignId);
    return;
  }
  const now = new Date();
  const claimed = await Sends.updateOne({ id: sendId, status: 'queued' }, { $set: { status: 'sending', updatedAt: now } });
  if (!claimed.modifiedCount) return;
  const sender = await senderConfig();
  let smtpAccepted = false;

  try {
    const [campaign, lead, suppressed] = await Promise.all([
      model('outreach_campaigns').findOne({ id: send.campaignId }).lean(),
      model('outreach_leads').findOne({ id: send.leadId }).lean(),
      model('outreach_suppressions').exists({ email: send.email }),
    ]);
    const step = campaign?.steps?.[send.stepIndex];
    if (!campaign || !lead || !step) {
      await Sends.updateOne({ id: sendId }, { $set: { status: 'skipped', skipReason: !campaign ? 'missing_campaign' : !step ? 'missing_template' : 'missing_lead', updatedAt: new Date() } });
      await maybeCompleteCampaign(send.campaignId);
      return;
    }
    if (campaign.status === 'launching' || campaign.status === 'paused') {
      await Sends.updateOne({ id: sendId }, { $set: { status: 'queued', updatedAt: new Date() } });
      return;
    }
    if (campaign.status !== 'running') {
      await Sends.updateOne({ id: sendId }, { $set: { status: 'skipped', skipReason: `campaign_${campaign.status}`, updatedAt: new Date() } });
      await maybeCompleteCampaign(send.campaignId);
      return;
    }
    if (suppressed || TERMINAL_LEAD_STATUSES.has(lead.status)) {
      await Sends.updateOne({ id: sendId }, { $set: { status: 'skipped', skipReason: suppressed ? 'suppressed' : `lead_${lead.status}`, updatedAt: new Date() } });
      await maybeCompleteCampaign(send.campaignId);
      return;
    }
    if (send.stepIndex > 0) {
      const previous = await Sends.findOne({ campaignId: send.campaignId, leadId: send.leadId, stepIndex: send.stepIndex - 1 }).lean();
      if (!previous || previous.status !== 'sent') {
        await Sends.updateOne({ id: sendId }, { $set: { status: 'skipped', skipReason: 'predecessor_not_sent', updatedAt: new Date() } });
        await maybeCompleteCampaign(send.campaignId);
        return;
      }
    }

    const dayStart = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    dayStart.setUTCHours(0, 0, 0, 0);
    const utcDayStart = new Date(dayStart.getTime() - 3 * 60 * 60 * 1000);
    const sentToday = await Sends.countDocuments({ campaignId: campaign.id, status: 'sent', sentAt: { $gte: utcDayStart } });
    if (sentToday >= campaign.dailyLimit) {
      const originalLocal = new Date(new Date(send.runAt).getTime() + 3 * 60 * 60 * 1000);
      const slot = Math.min(campaign.dailyLimit - 1, Math.max(0, Math.round(((originalLocal.getUTCHours() * 60 + originalLocal.getUTCMinutes()) - 480) / 480 * campaign.dailyLimit)));
      const nextRunAt = scheduledSlot(now, 1, slot, campaign.dailyLimit);
      await Sends.updateOne({ id: sendId }, { $set: { status: 'queued', runAt: nextRunAt, updatedAt: new Date() } });
      await enqueueSend(send, nextRunAt);
      return;
    }

    const preview = renderOutreachEmail({
      template: step, lead, campaign, sender, stepIndex: send.stepIndex,
      unsubscribeUrl: appUrl(`/api/outreach/unsubscribe/${createUnsubscribeToken(sendId)}`),
    });
    if ([preview.subject, preview.html, preview.text].some(value => unresolvedPlaceholders(value).length)) {
      throw new Error('The email still contains an unknown placeholder.');
    }

    /* Last compliance check immediately before SMTP. A pause/unsubscribe that
       lands after this point may race with an already-started SMTP call. */
    const [finalCampaign, finalLead, finalSuppression, finalSend] = await Promise.all([
      model('outreach_campaigns').findOne({ id: send.campaignId }).lean(),
      model('outreach_leads').findOne({ id: send.leadId }).lean(),
      model('outreach_suppressions').exists({ email: send.email }),
      Sends.findOne({ id: sendId }).lean(),
    ]);
    if (!finalSend || finalSend.status !== 'sending' || !finalCampaign || finalCampaign.status !== 'running' || !finalLead || TERMINAL_LEAD_STATUSES.has(finalLead.status) || finalSuppression || normalizeEmail(finalLead.email) !== normalizeEmail(send.email)) {
      const paused = finalCampaign?.status === 'paused' || finalCampaign?.status === 'launching';
      const reason = finalSuppression ? 'suppressed' : finalLead && normalizeEmail(finalLead.email) !== normalizeEmail(send.email) ? 'lead_email_changed' : 'state_changed';
      await Sends.updateOne({ id: sendId }, { $set: paused ? { status: 'queued', updatedAt: new Date() } : { status: 'skipped', skipReason: reason, updatedAt: new Date() } });
      if (!paused) await maybeCompleteCampaign(send.campaignId);
      return;
    }

    let providerMessageId = null;
    const sent = await email.sendOutreach({
      to: send.email,
      subject: preview.subject,
      html: preview.html,
      text: preview.text,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      settings: sender,
      onSuccess: info => { providerMessageId = info?.messageId || null; },
      headers: {
        'X-Msingi-Outreach-Campaign': campaign.id,
        'X-Msingi-Outreach-Send': sendId,
        'List-Unsubscribe': `<${appUrl(`/api/outreach/unsubscribe/${createUnsubscribeToken(sendId)}`)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (!sent) throw new Error('SMTP did not accept the message.');
    smtpAccepted = true;
    await Sends.updateOne({ id: sendId }, { $set: { status: 'sent', sentAt: new Date(), providerMessageId, updatedAt: new Date() } });
    await model('outreach_leads').updateOne(
      { id: lead.id, status: lead.status },
      { $set: { status: lead.status === 'new' ? 'contacted' : lead.status, lastContactedAt: new Date(), updatedAt: new Date() } },
    );
    await requeueSuccessors(campaign, lead.id, send.stepIndex, new Date());
    await maybeCompleteCampaign(campaign.id);
  } catch (error) {
    if (smtpAccepted) {
      await Sends.updateOne(
        { id: sendId, status: 'sending' },
        { $set: { status: 'needs_review', lastError: `SMTP accepted the message but bookkeeping failed: ${String(error.message || error).slice(0, 400)}`, updatedAt: new Date() } },
      );
    } else {
      await Sends.updateOne({ id: sendId }, { $set: { status: 'failed', lastError: String(error.message || error).slice(0, 500), updatedAt: new Date() } });
    }
    await maybeCompleteCampaign(send.campaignId);
  } finally {
    await releaseReservationsIfNoInFlight(send.campaignId);
  }
}

registerHandler('outreach_send', payload => processOutreachSend(payload?.sendId));
registerRecoveryHook(() => recoverStaleOutreach());

module.exports = {
  CAMPAIGN_STATUSES,
  DEFAULT_TEMPLATES,
  ELIGIBLE_LEAD_STATUSES,
  LEAD_STATUSES,
  MAX_IMPORT_ROWS,
  SEND_STATUSES,
  addLeadNote,
  campaignStats,
  createCampaign,
  createLead,
  createTemplate,
  createUnsubscribeToken,
  ensureDefaultTemplates,
  getCampaign,
  getLead,
  getLeadStats,
  getOutreachSettings,
  getTemplate,
  importLeads,
  launchCampaign,
  listCampaigns,
  listLeads,
  listTemplates,
  listSuppressions,
  addSuppression,
  normalizeEmail,
  outreachReady,
  parseCsv,
  previewTemplate,
  processOutreachSend,
  reconcileCampaignJobs,
  recordSendOutcome,
  recoverStaleOutreach,
  retrySend,
  safeSenderConfig: senderConfig,
  scheduledSlot,
  setCampaignStatus,
  suppressEmail,
  testTemplate,
  unsubscribeByToken,
  updateLead,
  updateOutreachSettings,
  updateTemplate,
  validateTemplate,
  verifyUnsubscribeToken,
};
