/* ============================================================
   server/utils/notificationTemplates.js

   Resolves a school's own wording for an automated message,
   falling back to the built-in default — see
   server/config/notificationTemplates.js for what's editable
   and why only the subject + narrative text (never the whole
   HTML email) is in scope.

   Storage: schools.notificationTemplateOverrides.<key> =
   { subject, body, updatedAt, updatedBy }. Sparse — only keys a
   school has actually edited are stored; everything else falls
   through to the registry default, so a new template added to
   the registry is immediately live for every school with no
   migration needed.
   ============================================================ */
const { _model } = require('./model');
const { MESSAGE_TEMPLATES } = require('../config/notificationTemplates');

const MAX_SUBJECT_LEN = 300;
const MAX_BODY_LEN     = 4000;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* {{token}} substitution — plain string replace, no nested lookups.
   An unknown placeholder in the template text (typo, or a school
   deleted a token they shouldn't have) resolves to '' rather than
   throwing, so a bad edit degrades gracefully instead of breaking
   the send. */
function substitute(str, vars = {}) {
  return String(str ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/* Plain text (subject+body are both authored as plain text, not HTML —
   see the Settings UI, which offers a textarea, not a rich editor) →
   escaped HTML paragraphs for the body; blank-line-separated blocks
   become <p>, a single newline inside a block becomes <br>. */
function bodyToHtml(bodyText) {
  const escaped = escapeHtml(bodyText);
  return escaped
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function getTemplateDef(key) {
  const def = MESSAGE_TEMPLATES[key];
  if (!def) throw new Error(`Unknown notification template key: ${key}`);
  return def;
}

/**
 * resolveMessageTemplate(schoolId, key, vars)
 * Returns { subject, bodyHtml } — the school's own override when one
 * exists for this key, otherwise the registry default. Both are run
 * through {{placeholder}} substitution with `vars`; bodyHtml is the
 * escaped-and-paragraphed HTML ready to splice into _wrap()'s markup
 * in place of the old hardcoded narrative paragraphs.
 */
async function resolveMessageTemplate(schoolId, key, vars = {}) {
  const def = getTemplateDef(key);
  let subject = def.defaultSubject;
  let body    = def.defaultBody;

  if (schoolId) {
    try {
      const Schools = _model('schools');
      const school = await Schools.findOne(
        { id: schoolId },
        { [`notificationTemplateOverrides.${key}`]: 1 }
      ).lean();
      const override = school?.notificationTemplateOverrides?.[key];
      if (override?.subject) subject = override.subject;
      if (override?.body)    body    = override.body;
    } catch (err) {
      console.error(`[notificationTemplates] override lookup failed for ${schoolId}/${key}: ${err.message} — using default`);
    }
  }

  return {
    subject:  substitute(subject, vars),
    bodyHtml: bodyToHtml(substitute(body, vars)),
  };
}

/** Full list of templates with each school's current effective text,
 *  for the Settings → Notification Templates screen. */
async function listTemplatesForSchool(schoolId) {
  const Schools = _model('schools');
  const school = await Schools.findOne({ id: schoolId }, { notificationTemplateOverrides: 1 }).lean();
  const overrides = school?.notificationTemplateOverrides ?? {};

  return Object.entries(MESSAGE_TEMPLATES).map(([key, def]) => {
    const override = overrides[key];
    return {
      key,
      category:    def.category,
      label:       def.label,
      desc:        def.desc,
      placeholders: def.placeholders,
      defaultSubject: def.defaultSubject,
      defaultBody:    def.defaultBody,
      subject:     override?.subject || def.defaultSubject,
      body:        override?.body    || def.defaultBody,
      isOverridden: !!override,
      updatedAt:   override?.updatedAt ?? null,
    };
  });
}

async function setTemplateOverride(schoolId, key, { subject, body }, updatedBy) {
  getTemplateDef(key); // throws on unknown key

  if (typeof subject !== 'string' || !subject.trim()) throw new Error('subject is required');
  if (typeof body !== 'string' || !body.trim())        throw new Error('body is required');
  if (subject.length > MAX_SUBJECT_LEN) throw new Error(`subject must be ${MAX_SUBJECT_LEN} characters or fewer`);
  if (body.length > MAX_BODY_LEN)       throw new Error(`body must be ${MAX_BODY_LEN} characters or fewer`);

  const Schools = _model('schools');
  await Schools.updateOne(
    { id: schoolId },
    { $set: {
      [`notificationTemplateOverrides.${key}`]: {
        subject: subject.trim(),
        body:    body.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || null,
      },
      updatedAt: new Date().toISOString(),
    } }
  );
}

async function resetTemplateOverride(schoolId, key) {
  getTemplateDef(key); // throws on unknown key
  const Schools = _model('schools');
  await Schools.updateOne(
    { id: schoolId },
    { $unset: { [`notificationTemplateOverrides.${key}`]: '' }, $set: { updatedAt: new Date().toISOString() } }
  );
}

module.exports = {
  resolveMessageTemplate,
  listTemplatesForSchool,
  setTemplateOverride,
  resetTemplateOverride,
  substitute,
  bodyToHtml,
  escapeHtml,
};
