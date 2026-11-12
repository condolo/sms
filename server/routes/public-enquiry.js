/* ============================================================
   Msingi — Public admissions enquiry form (no auth)

   The school's own short enquiry form: parents leave a name, phone,
   optional email, the learner's age and the class they are asking
   about, plus the follow-up flags the admissions team tracks (school
   tour, assessment, where they heard about the school).

   Everything is optional except ONE way to reach the family — a form
   that produces a lead nobody can call back is not a lead. Every
   submission lands in the existing admissions pipeline at stage
   'enquiry', so the same board, filters and CSV cover it.

   OPT-IN: a school must enable the form in Settings (School →
   Public Enquiry Form). Absent config means OFF — this route never
   exposes a form a school did not ask for. Disabled/unknown schools
   get one generic 404, so slugs cannot be enumerated.

   Abuse control: per-IP limiter, honeypot field, minimum fill time.
   No cookies, no auth, no PII in logs.
   ============================================================ */
'use strict';

const express   = require('express');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const { z }     = require('zod');
const { v4: uuidv4 } = require('uuid');

const { _model }              = require('../utils/model');
const { tenantModel }         = require('../utils/tenant-model');
const { ok, created, E }      = require('../utils/response');
const { resolvePublicEnquiryConfig } = require('../utils/admission-requirements');
const { isModuleEnabled }     = require('../middleware/module-gate');
const { dispatchNotification } = require('../utils/notify-dispatch');

const router = express.Router();

const HEARD_ABOUT = [
  'word_of_mouth', 'social_media', 'google', 'event',
  'referral', 'walk_in', 'other',
];

/* Public-safe school fields only — never admissionConfig itself, never
   addresses of enrolled families, nothing beyond the branding the login
   page already exposes. */
const SCHOOL_FIELDS =
  'id slug name shortName logoUrl primaryColor accentColor tagline city country isActive status admissionConfig academicYear';

const EnquirySchema = z.object({
  parentName:  z.string().trim().max(200).optional().default(''),
  parentPhone: z.string().trim().max(30).optional().default(''),
  parentEmail: z.string().trim().max(200).optional().default('')
    .refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address.'),
  learnerAge:  z.union([z.number(), z.string()]).optional().nullable(),
  applyingForClass: z.string().trim().max(100).optional().default(''),
  tourCompleted:       z.boolean().nullable().optional(),
  assessmentCompleted: z.boolean().nullable().optional(),
  heardAbout:          z.enum(HEARD_ABOUT).optional().nullable(),
  heardAboutOther:     z.string().trim().max(160).optional().default(''),
  /* Honeypot: hidden from humans, bots fill it. `startedAt` is the epoch ms
     when the form rendered, used for a soft minimum-fill-time check. */
  website:   z.string().max(200).optional().default(''),
  startedAt: z.number().optional(),
});

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_ENQUIRY_RATE_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many enquiries — please try again later.' },
  },
});

function _slug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null;
}

async function _school(slug) {
  const school = await _model('schools')
    .findOne({ slug })
    .select(SCHOOL_FIELDS)
    .lean();
  if (!school) return null;
  if (school.isActive === false) return null;
  if (school.status && school.status !== 'active') return null;
  return school;
}

async function _enquiryOpen(school) {
  if (!resolvePublicEnquiryConfig(school.admissionConfig).enabled) return false;
  return isModuleEnabled(school.id, 'admissions');
}

/* GET /api/public/enquiry/:slug — branding + the class choices.
   The response deliberately says nothing about the school's admission
   requirements; the enquiry form only needs the list of classes. */
router.get('/:slug', async (req, res) => {
  try {
    const slug = _slug(req.params.slug);
    if (!slug) return E.notFound(res, 'Enquiry form not available.');

    const school = await _school(slug);
    if (!school || !(await _enquiryOpen(school))) {
      return E.notFound(res, 'Enquiry form not available.');
    }

    const classes = await tenantModel('classes', { schoolId: school.id })
      .find({ status: { $ne: 'inactive' } })
      .sort({ order: 1, name: 1 })
      .select('id name')
      .limit(100)
      .lean();

    return ok(res, {
      enabled: true,
      school: {
        slug:         school.slug,
        name:         school.name || 'School',
        shortName:    school.shortName || school.name || 'School',
        logoUrl:      school.logoUrl || null,
        primaryColor: school.primaryColor || '#4f46e5',
        accentColor:  school.accentColor || '#7c3aed',
        tagline:      school.tagline || null,
        city:         school.city || null,
        country:      school.country || null,
      },
      classes: classes.map(c => ({ id: c.id, name: c.name })),
    });
  } catch (err) {
    console.error('[public/enquiry GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/public/enquiry/:slug — create an enquiry in the pipeline. */
router.post('/:slug', submitLimiter, async (req, res) => {
  try {
    const slug = _slug(req.params.slug);
    if (!slug) return E.notFound(res, 'Enquiry form not available.');

    const school = await _school(slug);
    if (!school || !(await _enquiryOpen(school))) {
      return E.notFound(res, 'Enquiry form not available.');
    }

    const parsed = EnquirySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      })));
    }
    const data = parsed.data;

    /* Honeypot + minimum fill time. A human takes more than two seconds to
       type an enquiry; a script posts immediately. */
    if (data.website) return E.badRequest(res, 'Invalid submission.');
    if (data.startedAt && Date.now() - data.startedAt < 2000) {
      return E.badRequest(res, 'Please take a moment to review your enquiry.');
    }

    const parentName  = data.parentName;
    const parentPhone = data.parentPhone;
    const parentEmail = data.parentEmail.toLowerCase();
    if (!parentName && !parentPhone && !parentEmail) {
      return E.badRequest(res, 'Leave at least a name or a way to reach you, so the school can follow up.');
    }

    let learnerAge = null;
    if (data.learnerAge !== undefined && data.learnerAge !== null && String(data.learnerAge).trim() !== '') {
      learnerAge = Number(data.learnerAge);
      if (!Number.isInteger(learnerAge) || learnerAge < 2 || learnerAge > 25) {
        return E.badRequest(res, 'Learner age must be between 2 and 25.');
      }
    }

    /* The class must belong to THIS school — the form's options come from
       the same school-scoped list, and an id from elsewhere is not a
       valid enquiry about one of this school's classes. */
    let classId = null;
    let className = '';
    if (data.applyingForClass) {
      const cls = await tenantModel('classes', { schoolId: school.id })
        .findOne({ id: data.applyingForClass })
        .select('id name')
        .lean();
      if (!cls) return E.badRequest(res, 'Pick a class from the list.');
      classId = cls.id;
      className = cls.name;
    }

    const yearLabel = school.academicYear ?? String(new Date().getFullYear());
    const yearCode  = yearLabel.match(/\d{4}/)?.[0] ?? String(new Date().getFullYear());
    const ref       = `APP-${yearCode}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now       = new Date().toISOString();

    const doc = {
      id: uuidv4(),
      schoolId: school.id,
      applicationRef: ref,
      /* The enquiry is intentionally not a full application: learner names,
         DOB, gender and guardian split are collected later, when the family
         decides to apply. The pipeline's display falls back to parentName. */
      firstName: '', lastName: '', middleName: '',
      parentName,
      parentPhone,
      parentEmail,
      learnerAge,
      applyingForClass: classId,
      applyingForClassName: className,
      tourCompleted:       data.tourCompleted ?? null,
      assessmentCompleted: data.assessmentCompleted ?? null,
      heardAbout:          data.heardAbout || null,
      heardAboutOther:     data.heardAboutOther || '',
      enquirySource:       'public_form',
      stage: 'enquiry',
      priority: 'normal',
      sibling: false,
      specialNeeds: false,
      documents: [],
      notes: '',
      enquiryDate: now.slice(0, 10),
      stageHistory: [{ stage: 'enquiry', date: now, changedBy: 'public' }],
      createdBy: 'public',
      updatedBy: 'public',
    };

    await tenantModel('admissions', { schoolId: school.id }).create(doc);

    /* Follow-up notification to whoever can actually work the pipeline.
       In-app is the reliable channel here; email follows the school's own
       notification settings (a school that has not configured this event
       still gets the in-app record). Never allowed to fail the submission. */
    _notifyAdmissions(school, doc).catch(() => {});

    return created(res, { ref, schoolName: school.name || 'School' });
  } catch (err) {
    console.error('[public/enquiry POST]', err);
    return E.serverError(res);
  }
});

async function _notifyAdmissions(school, doc) {
  const ctx = { schoolId: school.id };
  const roleDocs = await tenantModel('role_permissions', { schoolId: school.id })
    .find({})
    .select('roleKey permissions')
    .lean();
  const roles = [...new Set(
    (roleDocs || [])
      .filter(r => Array.isArray(r?.permissions?.admissions) && r.permissions.admissions.length > 0)
      .map(r => r.roleKey)
      .filter(Boolean),
  )];
  if (!roles.length) return;

  const users = await tenantModel('users', ctx)
    .find({ schoolId: school.id, role: { $in: roles }, isActive: { $ne: false } })
    .select('id name email')
    .limit(25)
    .lean();
  if (!users.length) return;

  const who = doc.parentName || doc.parentPhone || doc.parentEmail || 'A parent';
  const about = doc.applyingForClassName ? ` about ${doc.applyingForClassName}` : '';
  const age = doc.learnerAge ? ` (learner age ${doc.learnerAge})` : '';
  const subject = `New admissions enquiry — ${doc.applicationRef}`;
  const body = `${who} enquired${about}${age}. Open Admissions to follow up.`;

  await dispatchNotification({
    ctx,
    schoolId: school.id,
    eventKey: 'admission_enquiry',
    actorUserId: 'system',
    recipients: users.map(u => ({ userId: u.id, name: u.name, email: u.email })),
    inAppSubject: subject,
    inAppBody: body,
    emailDigestSubject: subject,
    emailDigestBody: body,
  });
}

module.exports = router;
