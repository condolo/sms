/* ============================================================
   Msingi — /api/rc-templates
   Competency-based report card template definitions.
   Admin-only CRUD. Each template defines performance bands,
   subjects, and learning indicators for a class group (e.g. KG).

   RBAC moved from settings:{read,update} to report_cards:{read,update}
   (2026-10) — the UI this gates moved out of the generic Settings page
   (and out of Report Cards' own "Settings" sub-tab) into its own
   top-level "Kindergarten Templates" tab in the Report Cards module;
   the permission gate moved in the SAME change, not a follow-up, so a
   role granted Report Cards access but not generic Settings access
   was never briefly unable to reach a screen that's no longer under
   Settings at all — and vice versa, nobody kept settings:update access
   to this after it left Settings.
   ============================================================ */
'use strict';

const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const { resolveRcTemplate } = require('../utils/rc-template-scale');

const router = express.Router();

/* ── Schemas ────────────────────────────────────────────────── */
const BandSchema = z.object({
  id:           z.string().optional(),
  label:        z.string().min(1).max(60).trim(),
  defaultScore: z.number().min(0).max(100).default(10),
  grade:        z.string().min(1).max(6).trim().toUpperCase(),
  color:        z.string().max(20).trim().default('slate'),
});

const IndicatorSchema = z.object({
  id:       z.string().optional(),
  text:     z.string().min(1).max(400).trim(),
  order:    z.number().int().min(0).default(0),
  // Confirmed against real samples (2026-10) — NOT universally 10. One
  // school's ICT indicators scored up to 18; another's Science/Literacy
  // used 10. Per-indicator, not a template- or subject-wide constant, so
  // a subject's % is always (sum of scores earned) / (sum of maxScore
  // across its indicators) * 100 — no "must add up to 100" problem, and
  // no ambiguity about whether an 8 means 8/10 or 8/20.
  maxScore: z.number().min(1).max(1000).default(10),
});

const SubjectSchema = z.object({
  id:         z.string().optional(),
  // Links to the school's real `subjects` collection — required (2026-10,
  // caught before the Markbook entry screen was built on top of this).
  // Without it, there is no `teaching_assignments` row to check against,
  // so nothing could ever scope WHO may enter marks for a template
  // subject — canWriteSubject/teaching_assignments only ever check a
  // real subjectId. `name` stays a denormalized cache of the real
  // subject's name (same convention as classId/className elsewhere),
  // not the source of truth, so the template can render its own subject
  // list without a join.
  subjectId:  z.string().min(1),
  name:       z.string().min(1).max(100).trim(),
  order:      z.number().int().min(0).default(0),
  indicators: z.array(IndicatorSchema).default([]),
  // Optional per-subject override of the template's performanceBands —
  // confirmed against real samples that this varies: one school's
  // Science "Excellent" was worth more than its Literacy "Excellent" in
  // the same report. Undefined/empty means "use the template's own
  // bands for this subject" (the common case); set only when a subject
  // genuinely needs its own scale.
  performanceBands: z.array(BandSchema).optional(),
});

const DisplaySchema = z.object({
  showScore:      z.boolean().default(true),
  showGrade:      z.boolean().default(true),
  showSubjectAvg: z.boolean().default(true),
  showOverallAvg: z.boolean().default(true),
}).default({});

const TemplateSchema = z.object({
  name:             z.string().min(1).max(150).trim(),
  description:      z.string().max(500).trim().default(''),
  // Resolution mirrors grade-scale.js's resolveGradeScale exactly, on
  // purpose, rather than inventing a second scoping convention: explicit
  // classIds (most specific) wins outright; otherwise a template marked
  // isDefault for this class's section applies. Unlike grade scales,
  // there is no school-wide fallback tier — a class with neither match
  // simply has no indicator-based template and uses the ordinary
  // numeric Markbook, which is the correct default for most classes.
  classIds:         z.array(z.string()).default([]),
  sectionId:        z.string().nullish(),
  isDefault:        z.boolean().default(false),
  performanceBands: z.array(BandSchema).min(1).max(12),
  subjects:         z.array(SubjectSchema).default([]),
  display:          DisplaySchema,
  status:           z.enum(['draft', 'active']).default('draft'),
});

/* ── Helpers ─────────────────────────────────────────────────── */
function _stampBands(bands) {
  return bands.map(b => ({ ...b, id: b.id || uuidv4() }));
}

function _stampSubjects(subjects) {
  return subjects.map((s, si) => ({
    ...s,
    id:    s.id || uuidv4(),
    order: s.order ?? si,
    indicators: (s.indicators ?? []).map((ind, ii) => ({
      ...ind,
      id:    ind.id || uuidv4(),
      order: ind.order ?? ii,
    })),
  }));
}

/* ══════════════════════════════════════════════════════════════
   GET /api/rc-templates  — list all school templates
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.sectionId) filter.sectionId = req.query.sectionId;
    const docs = await tenantModel('rc_templates', tenantContext(req))
      .find(filter)
      .sort({ isDefault: -1, createdAt: -1 })
      .select('-__v')
      .lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[rc-templates GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/rc-templates/resolve?classId=  — which template (if any)
   applies to this class. Gated by grades:read, not report_cards:read
   — this is consumed by the Markbook (Exams module) to decide whether
   a class/subject uses indicator-based entry, not by the Report Cards
   template-building screen; a teacher with ordinary Markbook access
   needs this without needing report_cards:read too. Registered above
   GET /:id — same single-segment route-ordering rule documented
   elsewhere in this codebase (students.js's /purge, report-cards.js's
   /bulk-pdf) — otherwise Express would treat "resolve" as an :id.
   ══════════════════════════════════════════════════════════════ */
router.get('/resolve', authMiddleware, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId } = req.query;
    if (!classId) return E.badRequest(res, 'classId is required');
    const template = await resolveRcTemplate(schoolId, classId);
    return ok(res, template);
  } catch (err) {
    console.error('[rc-templates GET/resolve]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/rc-templates/:id
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, rbac('report_cards', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('rc_templates', tenantContext(req))
      .findOne({ id: req.params.id, schoolId })
      .select('-__v')
      .lean();
    if (!doc) return E.notFound(res, 'Template not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[rc-templates GET/:id]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/rc-templates  — create
   ══════════════════════════════════════════════════════════════ */
router.post('/', authMiddleware, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const parsed = TemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        field: i.path.join('.'), message: i.message,
      })));
    }
    const data = parsed.data;

    if (data.isDefault && !data.sectionId) {
      return E.validation(res, [{ field: 'sectionId', message: 'isDefault requires a sectionId — a default with no section would never resolve for any class.' }]);
    }

    const Templates = tenantModel('rc_templates', tenantContext(req));

    // Setting as default clears any other default in the same section —
    // same convention report-card-templates.js's own isDefault already uses.
    if (data.isDefault) {
      await Templates.updateMany({ schoolId, sectionId: data.sectionId }, { $set: { isDefault: false } });
    }

    const doc = await Templates.create({
      ...data,
      performanceBands: _stampBands(data.performanceBands),
      subjects:         _stampSubjects(data.subjects),
      id:        uuidv4(),
      schoolId,
      createdBy: userId,
      updatedBy: userId,
    });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[rc-templates POST]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   PUT /api/rc-templates/:id  — update
   ══════════════════════════════════════════════════════════════ */
router.put('/:id', authMiddleware, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const existing = await tenantModel('rc_templates', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Template not found');

    const parsed = TemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        field: i.path.join('.'), message: i.message,
      })));
    }
    const data = parsed.data;

    const effectiveSectionId = data.sectionId !== undefined ? data.sectionId : existing.sectionId;
    const effectiveIsDefault = data.isDefault !== undefined ? data.isDefault : existing.isDefault;
    if (effectiveIsDefault && !effectiveSectionId) {
      return E.validation(res, [{ field: 'sectionId', message: 'isDefault requires a sectionId — a default with no section would never resolve for any class.' }]);
    }

    if (data.performanceBands) data.performanceBands = _stampBands(data.performanceBands);
    if (data.subjects)         data.subjects         = _stampSubjects(data.subjects);

    const Templates = tenantModel('rc_templates', tenantContext(req));

    if (data.isDefault === true) {
      await Templates.updateMany(
        { schoolId, sectionId: effectiveSectionId, id: { $ne: req.params.id } },
        { $set: { isDefault: false } },
      );
    }

    const doc = await Templates.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId, updatedAt: new Date() },
      { new: true, runValidators: false },
    ).lean();

    return ok(res, doc);
  } catch (err) {
    console.error('[rc-templates PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   DELETE /api/rc-templates/:id
   ══════════════════════════════════════════════════════════════ */
router.delete('/:id', authMiddleware, rbac('report_cards', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Templates = tenantModel('rc_templates', tenantContext(req));
    const existing = await Templates.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Template not found');
    if (existing.isDefault) {
      return E.badRequest(res, 'Cannot delete the default template for this section. Set another template as default first, or clear isDefault.');
    }
    const doc = await Templates.findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Template not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[rc-templates DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
