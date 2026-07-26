/* ============================================================
   Msingi — /api/report-card-templates  (RC11)

   The Template Engine's registry + resolution chain, scoped
   deliberately per docs/audits/REPORT_CARD_ARCHITECTURE_CONSOLIDATION_PLAN.md
   Phase 3, "Minimal: registry + resolution only" (explicitly chosen over
   the full generalized rendering engine that plan also describes —
   configurable section layout, page geometry, per-template branding —
   which stays out of scope here: it's a much larger effort the plan's
   own header gates behind separate explicit acceptance, same as every
   other Kernel-tier item this codebase has required one for).

   A template document here is METADATA ONLY (name, curriculum tag for
   discovery, section scoping, default flag, a revision counter) — it
   describes *which* template a report should use, not *how* that
   template renders. Every school still renders through today's exact
   PDF/HTML layout (report-cards.js's _drawReportPage/_computeReportHTML)
   regardless of which template resolves — there is only one real
   layout today, "Legacy Tabular," which needs no document of its own
   (see resolveTemplate() below). This registry exists so
   templateId/templateVersion can be snapshotted at publish time
   (Consolidation Plan §2.2) now, so a future rendering engine has
   real history to attach to instead of needing a backfill.

   rc_templates (competency-band templates, server/routes/rc-templates.js)
   is a separate, already-complete, already-live feature — untouched by
   this file. Nothing here retires or absorbs it; that migration only
   makes sense once a real rendering engine exists to receive its shape.

   Plan: grades | RBAC: settings:{read,update}
   ============================================================ */
'use strict';

const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();

const CURRICULUM_TAGS = ['kcse', 'cambridge', 'ib', 'cbc', 'american', 'custom'];

/* Always resolvable, always present, never a real document — the
   Consolidation Plan's "platform built-in, never deletable" fallback.
   No rendering logic differs for it today; every school's PDF/HTML
   output IS this layout regardless of which template resolves. */
const LEGACY_TABULAR = { templateId: 'legacy_tabular', templateVersion: 1, builtIn: true };

const TemplateSchema = z.object({
  name:          z.string().min(1).max(150).trim(),
  curriculumTag: z.enum(CURRICULUM_TAGS).optional().nullable(),
  sectionId:     z.string().optional().nullable(),
  isDefault:     z.boolean().optional().default(false),
});

/* ══════════════════════════════════════════════════════════════
   GET /api/report-card-templates  — list
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.sectionId) filter.sectionId = req.query.sectionId;
    const docs = await tenantModel('report_card_templates', tenantContext(req))
      .find(filter).sort({ isDefault: -1, name: 1 }).select('-__v').lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[report-card-templates GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/report-card-templates  — create
   ══════════════════════════════════════════════════════════════ */
router.post('/', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const parsed = TemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }
    const d = parsed.data;
    const Templates = tenantModel('report_card_templates', tenantContext(req));

    // Setting as default clears any other default in the same scope
    // (section-scoped, or school-wide when sectionId is unset) — same
    // convention as assessment.js's grade-scales isDefault handling.
    if (d.isDefault) {
      const scopeFilter = { schoolId };
      if (d.sectionId) scopeFilter.sectionId = d.sectionId;
      else scopeFilter.$or = [{ sectionId: null }, { sectionId: { $exists: false } }];
      await Templates.updateMany(scopeFilter, { $set: { isDefault: false } });
    }

    const doc = await Templates.create({
      id:            uuidv4(),
      schoolId,
      name:          d.name,
      curriculumTag: d.curriculumTag ?? null,
      sectionId:     d.sectionId ?? null,
      isDefault:     d.isDefault,
      revision:      1,
      createdBy:     userId,
      updatedBy:     userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[report-card-templates POST]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   PUT /api/report-card-templates/:id  — update
   ══════════════════════════════════════════════════════════════ */
router.put('/:id', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Templates = tenantModel('report_card_templates', tenantContext(req));
    const existing = await Templates.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Template not found');

    const parsed = TemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }
    const d = parsed.data;

    if (d.isDefault === true) {
      const scopeId = d.sectionId !== undefined ? d.sectionId : existing.sectionId;
      const scopeFilter = { schoolId, id: { $ne: req.params.id } };
      if (scopeId) scopeFilter.sectionId = scopeId;
      else scopeFilter.$or = [{ sectionId: null }, { sectionId: { $exists: false } }];
      await Templates.updateMany(scopeFilter, { $set: { isDefault: false } });
    }

    const setFields = { updatedBy: userId };
    if (d.name          !== undefined) setFields.name          = d.name;
    if (d.curriculumTag !== undefined) setFields.curriculumTag = d.curriculumTag ?? null;
    if (d.sectionId     !== undefined) setFields.sectionId     = d.sectionId ?? null;
    if (d.isDefault     !== undefined) setFields.isDefault     = d.isDefault;

    const doc = await Templates.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: setFields, $inc: { revision: 1 } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[report-card-templates PUT]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   DELETE /api/report-card-templates/:id
   Cannot delete a template currently marked default for its scope —
   same posture as grade-scales (§ assessment.js) — a school must pick
   a new default first so resolution never silently falls back mid-use
   without the admin choosing that.
   ══════════════════════════════════════════════════════════════ */
router.delete('/:id', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Templates = tenantModel('report_card_templates', tenantContext(req));
    const doc = await Templates.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Template not found');
    if (doc.isDefault) {
      return E.badRequest(res, 'Cannot delete the default template for this scope. Set another template as default first.');
    }
    await Templates.deleteOne({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[report-card-templates DELETE]', err);
    return E.serverError(res);
  }
});

/**
 * resolveTemplate — the Consolidation Plan §3.3 chain:
 *   schoolId + sectionId → template marked default for that section
 *   → schoolId → template marked school-wide default
 *   → "Legacy Tabular" (platform built-in, always resolvable)
 *
 * Exported for report-cards.js's POST /publish to call directly (same
 * cross-module-import convention already used for
 * assessment.js's getConfig / academic-config.js's resolveGrade).
 */
async function resolveTemplate(ctx, schoolId, sectionId) {
  const Templates = tenantModel('report_card_templates', ctx);
  if (sectionId) {
    const sectionDefault = await Templates.findOne({ schoolId, sectionId, isDefault: true }).select('id revision').lean();
    if (sectionDefault) return { templateId: sectionDefault.id, templateVersion: sectionDefault.revision, builtIn: false };
  }
  const schoolDefault = await Templates.findOne({
    schoolId, isDefault: true, $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
  }).select('id revision').lean();
  if (schoolDefault) return { templateId: schoolDefault.id, templateVersion: schoolDefault.revision, builtIn: false };

  return { ...LEGACY_TABULAR };
}

module.exports = router;
module.exports.resolveTemplate = resolveTemplate;
module.exports.LEGACY_TABULAR  = LEGACY_TABULAR;
