/* ============================================================
   Msingi — /api/rc-templates
   Competency-based report card template definitions.
   Admin-only CRUD. Each template defines performance bands,
   subjects, and learning indicators for a class group (e.g. KG).
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

/* ── Schemas ────────────────────────────────────────────────── */
const BandSchema = z.object({
  id:           z.string().optional(),
  label:        z.string().min(1).max(60).trim(),
  defaultScore: z.number().min(0).max(100).default(10),
  grade:        z.string().min(1).max(6).trim().toUpperCase(),
  color:        z.string().max(20).trim().default('slate'),
});

const IndicatorSchema = z.object({
  id:    z.string().optional(),
  text:  z.string().min(1).max(400).trim(),
  order: z.number().int().min(0).default(0),
});

const SubjectSchema = z.object({
  id:         z.string().optional(),
  name:       z.string().min(1).max(100).trim(),
  order:      z.number().int().min(0).default(0),
  indicators: z.array(IndicatorSchema).default([]),
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
  classIds:         z.array(z.string()).default([]),
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
router.get('/', authMiddleware, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const docs = await tenantModel('rc_templates', tenantContext(req))
      .find({ schoolId })
      .sort({ createdAt: -1 })
      .select('-__v')
      .lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[rc-templates GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/rc-templates/:id
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, rbac('settings', 'read'), async (req, res) => {
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
router.post('/', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const parsed = TemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        field: i.path.join('.'), message: i.message,
      })));
    }
    const data = parsed.data;

    const doc = await tenantModel('rc_templates', tenantContext(req)).create({
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
router.put('/:id', authMiddleware, rbac('settings', 'update'), async (req, res) => {
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

    if (data.performanceBands) data.performanceBands = _stampBands(data.performanceBands);
    if (data.subjects)         data.subjects         = _stampSubjects(data.subjects);

    const doc = await tenantModel('rc_templates', tenantContext(req)).findOneAndUpdate(
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
router.delete('/:id', authMiddleware, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('rc_templates', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Template not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[rc-templates DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
