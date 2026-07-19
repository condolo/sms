/* ============================================================
   Msingi — /api/assessment
   Structured CA / HW / MT / ET assessment system.

   Sub-routes:
     /config          — weights, template, instances (admin)
     /schedule        — date ranges per assessment (admin)
     /types           — assessment type CRUD (admin)
     /grade-scales    — grading boundary scales CRUD (admin)
     /marks           — mark entry & retrieval (teachers)
     /report          — computed report card data
     /reminders       — upcoming/overdue assessment alerts
   ============================================================ */

'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { z }    = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const email              = require('../utils/email');
const {
  validateWeights,
  aggregateMarks,
  buildSubjectReport,
} = require('../utils/grade-calc');
const { isYearArchived, firstArchivedYear } = require('../utils/archival');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Constants ──────────────────────────────────────────────── */

const DEFAULT_ASSESSMENT_TYPES = ['CA', 'HW', 'MT', 'ET'];  // kept for migration
const TERM_NUMBERS             = [1, 2, 3];
const TEMPLATES                = ['detailed', 'summary'];

const DEFAULT_WEIGHTS   = { CA: 20, HW: 10, MT: 30, ET: 40 };
const DEFAULT_INSTANCES = { CA: 2, HW: 2 };

const VALID_COLORS = ['violet','purple','amber','red','blue','emerald','sky','orange','rose','teal','indigo','cyan'];

/** Default assessment types — used to seed schools with no customTypes yet */
const DEFAULT_CUSTOM_TYPES = [
  { key: 'CA', label: 'Continuous Assessment', weight: 20, instances: 2, color: 'violet' },
  { key: 'HW', label: 'Homework / Assignment',  weight: 10, instances: 2, color: 'purple' },
  { key: 'MT', label: 'Mid-Term Exam',           weight: 30, instances: 1, color: 'amber'  },
  { key: 'ET', label: 'End-Term Exam',           weight: 40, instances: 1, color: 'red'    },
];

/* ── Helpers ─────────────────────────────────────────────────── */

function _ok(res, data, meta)    { return ok(res, data, meta); }
function _err(res, msg, code=400){ return res.status(code).json({ error: msg }); }

/** Fetch or create the assessment config doc for a school/year */
async function _getConfig(schoolId, academicYearId) {
  const Config = tenantModel('assessment_config', { schoolId });
  let doc = await Config.findOne({ schoolId, academicYearId }).lean();
  if (!doc) {
    doc = {
      id:             uuidv4(),
      schoolId,
      academicYearId,
      weights:        { ...DEFAULT_WEIGHTS },
      instances:      { ...DEFAULT_INSTANCES },
      reportTemplate: 'detailed',
      customTypes:    DEFAULT_CUSTOM_TYPES.map(t => ({ ...t })),
    };
    await Config.create(doc);
  }
  // Migrate: synthesize customTypes from legacy weights/instances if field is missing
  if (!doc.customTypes || doc.customTypes.length === 0) {
    const w    = doc.weights   || DEFAULT_WEIGHTS;
    const inst = doc.instances || DEFAULT_INSTANCES;
    doc.customTypes = DEFAULT_ASSESSMENT_TYPES.map(key => ({
      key,
      label:     DEFAULT_CUSTOM_TYPES.find(d => d.key === key)?.label ?? key,
      weight:    w[key] ?? 0,
      instances: inst[key] ?? 1,
      color:     DEFAULT_CUSTOM_TYPES.find(d => d.key === key)?.color ?? 'sky',
    }));
  }
  return doc;
}

/** Build label from type + instance. Single-instance types use key only. */
function _label(type, instance) {
  return (!instance || instance <= 1) ? type : `${type} ${instance}`;
}

/** Sync legacy weights/instances fields from customTypes for backward compat */
function _syncLegacyFields(customTypes) {
  const weights   = Object.fromEntries(customTypes.map(t => [t.key, t.weight]));
  const instances = Object.fromEntries(
    customTypes.filter(t => t.instances > 1).map(t => [t.key, t.instances])
  );
  return { weights, instances };
}

/* ══════════════════════════════════════════════════════════════
   CONFIG  —  GET / PATCH /api/assessment/config
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/config
 * Returns the school's assessment configuration (weights, template, instances).
 * Falls back to defaults if not yet configured.
 */
router.get('/config', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId } = req.query;
    const [doc, defaultScale] = await Promise.all([
      _getConfig(schoolId, academicYearId || null),
      tenantModel('grade_boundaries', tenantContext(req)).findOne({ schoolId, isDefault: true }).lean(),
    ]);
    return _ok(res, {
      ...doc,
      gradeScale: defaultScale ? { id: defaultScale.id, name: defaultScale.name, bands: defaultScale.bands } : null,
    });
  } catch (err) {
    console.error('[assessment/config GET]', err);
    return E.serverError(res);
  }
});

/**
 * PATCH /api/assessment/config
 * Update weights, template, and/or instance counts.
 *
 * Body (all optional):
 *   weights:        { CA, HW, MT, ET }  — must sum to 100
 *   reportTemplate: 'detailed' | 'summary'
 *   instances:      { CA: number, HW: number }  — min 1, max 10
 *   academicYearId: string
 */
router.patch('/config', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId, weights, reportTemplate, instances } = req.body;

    const update = {};

    // ── Validate weights ──
    if (weights) {
      const cfg  = await _getConfig(schoolId, academicYearId || null);
      const keys = cfg.customTypes.map(t => t.key);
      const w = {};
      for (const t of keys) {
        const val = Number(weights[t]);
        if (isNaN(val) || val < 0) {
          return _err(res, `Weight for "${t}" must be a non-negative number`);
        }
        w[t] = val;
      }
      const { valid, total } = validateWeights(w);
      if (!valid) {
        return _err(res, `Assessment weights must sum to 100%. Current total: ${total}%`);
      }
      update.weights = w;
    }

    // ── Validate template ──
    if (reportTemplate !== undefined) {
      if (!TEMPLATES.includes(reportTemplate)) {
        return _err(res, `reportTemplate must be one of: ${TEMPLATES.join(', ')}`);
      }
      update.reportTemplate = reportTemplate;
    }

    // ── Validate instances (CA/HW only) ──
    if (instances) {
      const inst = {};
      for (const t of ['CA', 'HW']) {
        if (instances[t] !== undefined) {
          const n = Number(instances[t]);
          if (!Number.isInteger(n) || n < 1 || n > 10) {
            return _err(res, `instances.${t} must be an integer between 1 and 10`);
          }
          inst[t] = n;
        }
      }
      update.instances = inst;
    }

    if (Object.keys(update).length === 0) {
      return _err(res, 'No valid fields to update');
    }

    const Config = tenantModel('assessment_config', tenantContext(req));
    const doc = await Config.findOneAndUpdate(
      { schoolId, academicYearId: academicYearId || null },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/config PATCH]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   SCHEDULE  —  GET / PUT /api/assessment/schedule
   ══════════════════════════════════════════════════════════════ */

const ScheduleEntrySchema = z.object({
  termNumber:     z.number().int().min(1).max(3),
  assessmentType: z.string().min(1).max(20),
  instance:       z.number().int().min(1).max(10).default(1),
  label:          z.string().max(100).optional(),
  dateFrom:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  dateTo:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  academicYearId: z.string().optional(),
});

/**
 * GET /api/assessment/schedule
 * Returns all assessment date ranges for the school.
 */
router.get('/schedule', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);

    const docs = await tenantModel('assessment_schedule', tenantContext(req)).find(filter)
      .sort({ termNumber: 1, assessmentType: 1, instance: 1 }).limit(200).lean();
    return _ok(res, docs);
  } catch (err) {
    console.error('[assessment/schedule GET]', err);
    return E.serverError(res);
  }
});

/**
 * PUT /api/assessment/schedule
 * Upsert a single schedule entry.
 * Body: ScheduleEntrySchema
 */
router.put('/schedule', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const parsed = ScheduleEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = { ...parsed.data, assessmentType: parsed.data.assessmentType.toUpperCase() };

    // Validate assessmentType against school's configured types
    const schedCfg  = await _getConfig(schoolId, null);
    const validSched = new Set(schedCfg.customTypes.map(t => t.key));
    if (!validSched.has(d.assessmentType)) {
      return _err(res, `Invalid assessment type "${d.assessmentType}". Configured types: ${[...validSched].join(', ')}`);
    }

    if (d.dateFrom > d.dateTo) {
      return _err(res, 'dateFrom must be on or before dateTo');
    }

    const label = d.label || _label(d.assessmentType, d.instance);

    const doc = await tenantModel('assessment_schedule', tenantContext(req)).findOneAndUpdate(
      {
        schoolId,
        academicYearId: d.academicYearId || null,
        termNumber:     d.termNumber,
        assessmentType: d.assessmentType,
        instance:       d.instance,
      },
      {
        $set: { dateFrom: d.dateFrom, dateTo: d.dateTo, label },
        $setOnInsert: { id: uuidv4(), schoolId, academicYearId: d.academicYearId || null },
      },
      { new: true, upsert: true }
    ).lean();

    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/schedule PUT]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/schedule/:id
 */
router.delete('/schedule/:id', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('assessment_schedule', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Schedule entry not found');
    return _ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[assessment/schedule DELETE]', err);
    return E.serverError(res);
  }
});

/* Roles allowed to lock/unlock schedule entries */
const LOCK_ROLES = new Set(['admin', 'superadmin', 'deputy_principal', 'exams_officer', 'principal']);

/**
 * POST /api/assessment/schedule/:id/lock
 * Lock a schedule entry so no further marks can be entered.
 * Body: { note? }
 */
router.post('/schedule/:id/lock', authMiddleware, PLAN, rbac('assessment', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const Sched = tenantModel('assessment_schedule', tenantContext(req));
    const entry = await Sched.findOne({ id: req.params.id, schoolId }).lean();
    if (!entry) return E.notFound(res, 'Schedule entry not found');
    if (entry.isLocked) return _err(res, 'This schedule entry is already locked.');

    const user = await tenantModel('users', tenantContext(req)).findOne({ id: userId, schoolId }).select('name').lean();
    const now  = new Date().toISOString();
    const note = (req.body.note || '').trim();

    const doc = await Sched.findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        $set: {
          isLocked:     true,
          lockedBy:     userId,
          lockedByName: user?.name ?? userId,
          lockedAt:     now,
          lockedNote:   note,
        },
      },
      { new: true }
    ).lean();

    await tenantModel('assessment_audit_log', tenantContext(req)).create({
      id:              uuidv4(),
      schoolId,
      scheduleId:      req.params.id,
      action:          'SCHEDULE_LOCKED',
      performedBy:     userId,
      performedByName: user?.name ?? userId,
      performedAt:     now,
      note,
    }).catch(() => {});

    console.log(`[ASSESSMENT] Schedule "${entry.label}" locked by ${userId}`);
    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/schedule/:id/lock]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/schedule/:id/unlock
 * Unlock a locked schedule entry. Requires a reason.
 * Body: { reason }
 */
router.post('/schedule/:id/unlock', authMiddleware, PLAN, rbac('assessment', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const reason = (req.body.reason || '').trim();
    if (!reason) return _err(res, 'A reason is required when unlocking a schedule entry.');

    const Sched = tenantModel('assessment_schedule', tenantContext(req));
    const entry = await Sched.findOne({ id: req.params.id, schoolId }).lean();
    if (!entry) return E.notFound(res, 'Schedule entry not found');
    if (!entry.isLocked) return _err(res, 'This schedule entry is not locked.');

    const user = await tenantModel('users', tenantContext(req)).findOne({ id: userId, schoolId }).select('name').lean();
    const now  = new Date().toISOString();

    const doc = await Sched.findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        $set: {
          isLocked:        false,
          unlockedBy:      userId,
          unlockedByName:  user?.name ?? userId,
          unlockedAt:      now,
          unlockReason:    reason,
        },
        $unset: { lockedBy: '', lockedByName: '', lockedAt: '', lockedNote: '' },
      },
      { new: true }
    ).lean();

    await tenantModel('assessment_audit_log', tenantContext(req)).create({
      id:              uuidv4(),
      schoolId,
      scheduleId:      req.params.id,
      action:          'SCHEDULE_UNLOCKED',
      performedBy:     userId,
      performedByName: user?.name ?? userId,
      performedAt:     now,
      note:            reason,
    }).catch(() => {});

    console.log(`[ASSESSMENT] Schedule "${entry.label}" unlocked by ${userId}: ${reason}`);
    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/schedule/:id/unlock]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ASSESSMENT TYPES  —  /api/assessment/types
   Full CRUD for the school's assessment type definitions.
   Stored in assessment_config.customTypes (global config, academicYearId: null).
   Changes sync back to legacy weights/instances fields for backward compat.
   ══════════════════════════════════════════════════════════════ */

const TypeSchema = z.object({
  key:       z.string().min(1).max(10).regex(/^[A-Z0-9_]+$/, 'Key must be uppercase letters, digits, or underscores'),
  label:     z.string().min(1).max(100).trim(),
  weight:    z.number().min(0).max(100),
  instances: z.number().int().min(1).max(10).default(1),
  color:     z.string().refine(v => VALID_COLORS.includes(v), { message: `Color must be one of: ${VALID_COLORS.join(', ')}` }),
});

/**
 * GET /api/assessment/types
 * Returns the school's configured assessment types array.
 */
router.get('/types', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const cfg = await _getConfig(schoolId, null);
    return _ok(res, cfg.customTypes);
  } catch (err) {
    console.error('[assessment/types GET]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/types
 * Add a new assessment type to the school's configuration.
 * Body: { key, label, weight, instances, color }
 */
router.post('/types', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const input  = { ...req.body, key: (req.body.key || '').toUpperCase().trim() };
    const parsed = TypeSchema.safeParse(input);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const newType = parsed.data;

    const Config = tenantModel('assessment_config', tenantContext(req));
    const cfg    = await _getConfig(schoolId, null);

    if (cfg.customTypes.some(t => t.key === newType.key)) {
      return _err(res, `Assessment type "${newType.key}" already exists`);
    }
    if (cfg.customTypes.length >= 20) {
      return _err(res, 'Maximum of 20 assessment types allowed');
    }

    const updated              = [...cfg.customTypes, newType];
    const { weights, instances } = _syncLegacyFields(updated);

    const doc = await Config.findOneAndUpdate(
      { schoolId, academicYearId: null },
      { $set: { customTypes: updated, weights, instances } },
      { new: true, upsert: true }
    ).lean();

    return created(res, doc.customTypes);
  } catch (err) {
    console.error('[assessment/types POST]', err);
    return E.serverError(res);
  }
});

/**
 * PUT /api/assessment/types
 * Replace the entire customTypes array (bulk save for edits).
 * Body: { customTypes: [{ key, label, weight, instances, color }, ...] }
 * Weights must sum to exactly 100.
 */
router.put('/types', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const raw = req.body.customTypes;
    if (!Array.isArray(raw) || raw.length === 0) {
      return _err(res, 'customTypes must be a non-empty array');
    }
    if (raw.length > 20) {
      return _err(res, 'Maximum of 20 assessment types allowed');
    }

    const validated = [];
    const keys      = new Set();
    for (const item of raw) {
      const input  = { ...item, key: (item.key || '').toUpperCase().trim() };
      const parsed = TypeSchema.safeParse(input);
      if (!parsed.success) {
        return _err(res, `Type "${input.key}": ${parsed.error.issues.map(i => i.message).join('; ')}`);
      }
      if (keys.has(parsed.data.key)) {
        return _err(res, `Duplicate key: "${parsed.data.key}"`);
      }
      keys.add(parsed.data.key);
      validated.push(parsed.data);
    }

    const { valid, total } = validateWeights(Object.fromEntries(validated.map(t => [t.key, t.weight])));
    if (!valid) {
      return _err(res, `Assessment weights must sum to 100%. Current total: ${total}%`);
    }

    const { weights, instances } = _syncLegacyFields(validated);
    const Config = tenantModel('assessment_config', tenantContext(req));
    const doc = await Config.findOneAndUpdate(
      { schoolId, academicYearId: null },
      { $set: { customTypes: validated, weights, instances } },
      { new: true, upsert: true }
    ).lean();

    return _ok(res, doc.customTypes);
  } catch (err) {
    console.error('[assessment/types PUT]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/types/:key
 * Remove an assessment type.
 * Rejected with 409 if any assessment_marks exist for this type.
 */
router.delete('/types/:key', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const key = req.params.key.toUpperCase();

    const cfg    = await _getConfig(schoolId, null);
    const exists = cfg.customTypes.some(t => t.key === key);
    if (!exists) return E.notFound(res, `Assessment type "${key}" not found`);

    if (cfg.customTypes.length <= 1) {
      return _err(res, 'Cannot delete the last assessment type');
    }

    // Guard: check for existing marks using this type
    const markCount = await tenantModel('assessment_marks', tenantContext(req)).countDocuments({ schoolId, assessmentType: key });
    if (markCount > 0) {
      return _err(
        res,
        `Cannot delete "${key}" — ${markCount} mark${markCount === 1 ? '' : 's'} exist for this type. Remove all marks first or reassign them.`,
        409
      );
    }

    const updated              = cfg.customTypes.filter(t => t.key !== key);
    const { weights, instances } = _syncLegacyFields(updated);
    const Config = tenantModel('assessment_config', tenantContext(req));
    const doc = await Config.findOneAndUpdate(
      { schoolId, academicYearId: null },
      { $set: { customTypes: updated, weights, instances } },
      { new: true }
    ).lean();

    return _ok(res, doc.customTypes);
  } catch (err) {
    console.error('[assessment/types DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GRADE SCALES  —  /api/assessment/grade-scales
   Full CRUD for the school's grading boundary definitions.
   Stored in the grade_boundaries collection.
   Each document is one named scale (e.g. "Standard KCSE", "Primary").
   A school can have many scales; exactly one can be isDefault=true.
   Scales can optionally be scoped to a section (sectionId).
   ══════════════════════════════════════════════════════════════ */

const BandSchema = z.object({
  min:    z.number().min(0).max(100),
  grade:  z.string().min(1).max(10).trim(),
  points: z.number().min(0).max(100).optional().default(0),
  label:  z.string().max(100).trim().optional().default(''),
});

const GradeScaleSchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  description: z.string().max(300).trim().optional().default(''),
  sectionId:   z.string().optional().nullable(),
  isDefault:   z.boolean().optional().default(false),
  bands:       z.array(BandSchema).min(1).max(30),
});

/** Convert a percentage score to a grade letter using this scale's bands.
 *  Returns { grade, points, label } or null if no matching band. */
function _applyGradeScale(score, bands) {
  if (!bands || !bands.length || score == null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const band   = sorted.find(b => score >= b.min);
  return band ? { grade: band.grade, points: band.points ?? 0, label: band.label ?? '' } : null;
}

/**
 * GET /api/assessment/grade-scales
 * Returns all grading scales for the school.
 * Query param: sectionId (optional filter)
 */
router.get('/grade-scales', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.sectionId) filter.sectionId = req.query.sectionId;

    const docs = await tenantModel('grade_boundaries', tenantContext(req))
      .find(filter)
      .sort({ isDefault: -1, name: 1 })
      .limit(50)
      .lean();
    return _ok(res, docs);
  } catch (err) {
    console.error('[assessment/grade-scales GET]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/grade-scales
 * Create a new grading scale.
 * If isDefault:true, clears isDefault on all other school-wide (or same-section) scales.
 */
router.post('/grade-scales', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const parsed = GradeScaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = parsed.data;

    // Validate bands: check for duplicate grade letters and overlapping mins
    const gradeKeys = d.bands.map(b => b.grade.toUpperCase());
    if (new Set(gradeKeys).size !== gradeKeys.length) {
      return _err(res, 'Grade letters must be unique within a scale');
    }
    const mins = d.bands.map(b => b.min);
    if (new Set(mins).size !== mins.length) {
      return _err(res, 'Band minimum scores must be unique');
    }
    // Lowest band must start at 0 so every score resolves to a grade
    if (!d.bands.some(b => b.min === 0)) {
      return _err(res, 'At least one band must start at 0 (to cover the lowest possible score)');
    }

    const Scales = tenantModel('grade_boundaries', tenantContext(req));

    // If this scale is being set as default, clear previous default for the same scope
    if (d.isDefault) {
      const scopeFilter = { schoolId };
      if (d.sectionId) scopeFilter.sectionId = d.sectionId;
      else scopeFilter.$or = [{ sectionId: null }, { sectionId: { $exists: false } }];
      await Scales.updateMany(scopeFilter, { $set: { isDefault: false } });
    }

    const doc = await Scales.create({
      id:          uuidv4(),
      schoolId,
      name:        d.name,
      description: d.description,
      sectionId:   d.sectionId ?? null,
      isDefault:   d.isDefault,
      bands:       d.bands,
      createdBy:   userId,
      updatedBy:   userId,
    });

    // If this is the school's first scale, automatically make it default
    const count = await Scales.countDocuments({ schoolId });
    if (count === 1 && !d.isDefault) {
      await Scales.updateOne({ id: doc.id }, { $set: { isDefault: true } });
      doc.isDefault = true;
    }

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[assessment/grade-scales POST]', err);
    return E.serverError(res);
  }
});

/**
 * PUT /api/assessment/grade-scales/:id
 * Update an existing scale's name, description, bands, sectionId, or isDefault.
 */
router.put('/grade-scales/:id', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Scales = tenantModel('grade_boundaries', tenantContext(req));
    const existing = await Scales.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Grade scale not found');

    const parsed = GradeScaleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = parsed.data;

    // Validate bands if provided
    if (d.bands) {
      const gradeKeys = d.bands.map(b => b.grade.toUpperCase());
      if (new Set(gradeKeys).size !== gradeKeys.length) {
        return _err(res, 'Grade letters must be unique within a scale');
      }
      const mins = d.bands.map(b => b.min);
      if (new Set(mins).size !== mins.length) {
        return _err(res, 'Band minimum scores must be unique');
      }
      if (!d.bands.some(b => b.min === 0)) {
        return _err(res, 'At least one band must start at 0');
      }
    }

    // If setting as default, clear others in same scope
    if (d.isDefault === true) {
      const scopeId  = d.sectionId !== undefined ? d.sectionId : existing.sectionId;
      const scopeFilter = { schoolId, id: { $ne: req.params.id } };
      if (scopeId) scopeFilter.sectionId = scopeId;
      else scopeFilter.$or = [{ sectionId: null }, { sectionId: { $exists: false } }];
      await Scales.updateMany(scopeFilter, { $set: { isDefault: false } });
    }

    const update = { updatedBy: userId };
    if (d.name        !== undefined) update.name        = d.name;
    if (d.description !== undefined) update.description = d.description;
    if (d.sectionId   !== undefined) update.sectionId   = d.sectionId ?? null;
    if (d.isDefault   !== undefined) update.isDefault   = d.isDefault;
    if (d.bands       !== undefined) update.bands       = d.bands;

    const doc = await Scales.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: update },
      { new: true }
    ).lean();

    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/grade-scales PUT]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/grade-scales/:id
 * Delete a grade scale.
 * Cannot delete the last scale for a school.
 * Cannot delete the default scale if there are others — must re-assign default first.
 */
router.delete('/grade-scales/:id', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Scales = tenantModel('grade_boundaries', tenantContext(req));
    const doc = await Scales.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Grade scale not found');

    const total = await Scales.countDocuments({ schoolId });
    if (total <= 1) {
      return _err(res, 'Cannot delete the last grade scale. Add another scale before deleting this one.');
    }
    if (doc.isDefault) {
      return _err(
        res,
        'Cannot delete the default scale. Set another scale as default first, then delete this one.',
        409
      );
    }

    await Scales.deleteOne({ id: req.params.id, schoolId });
    return _ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[assessment/grade-scales DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   MARKS  —  /api/assessment/marks
   ══════════════════════════════════════════════════════════════ */

const MarkSchema = z.object({
  studentId:      z.string().min(1),
  subjectId:      z.string().min(1),
  classId:        z.string().min(1),
  academicYearId: z.string().optional(),
  termNumber:     z.number().int().min(1).max(3),
  assessmentType: z.string().min(1).max(20),
  instance:       z.number().int().min(1).max(10).default(1),
  rawScore:       z.number().min(0).max(100),
  label:          z.string().max(100).optional(),
  isPublished:    z.boolean().default(true),
  // Optimistic concurrency (mirrors exam_results/ResultSchema's _v — see
  // POST /api/exams/:id/results). Optional: omitting it skips the version
  // check entirely, same "no behavior change until a client sends it"
  // contract as the exam-results endpoint.
  _v:             z.number().int().min(0).optional(),
});

const BulkMarkSchema = z.object({
  marks: z.array(MarkSchema).min(1).max(1000),
});

/**
 * GET /api/assessment/marks
 * List marks with flexible filters.
 *
 * Query params: studentId, subjectId, classId, termNumber,
 *               academicYearId, assessmentType, isPublished
 */
router.get('/marks', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };

    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.assessmentType) filter.assessmentType = req.query.assessmentType.toUpperCase();
    if (req.query.isPublished !== undefined) {
      filter.isPublished = req.query.isPublished === 'true';
    }

    const docs = await tenantModel('assessment_marks', tenantContext(req)).find(filter)
      .sort({ termNumber: 1, assessmentType: 1, instance: 1 }).limit(5000).lean();
    return _ok(res, docs);
  } catch (err) {
    console.error('[assessment/marks GET]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/marks
 * Enter or update a single mark (upsert by student+subject+term+type+instance).
 */
router.post('/marks', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const rawParsed = MarkSchema.safeParse(req.body);
    if (!rawParsed.success) {
      return _err(res, rawParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = { ...rawParsed.data, assessmentType: rawParsed.data.assessmentType.toUpperCase() };

    // Guard: reject writes to archived academic years
    if (d.academicYearId && await isYearArchived(schoolId, d.academicYearId)) {
      return _err(res, 'This academic year is locked — marks cannot be added or modified.', 403);
    }

    // Load config once (shared for type validation + permission check)
    const markConfig = await _getConfig(schoolId, d.academicYearId || null);

    // Validate assessmentType against school's configured types
    const validMarkKeys = new Set(markConfig.customTypes.map(t => t.key));
    if (!validMarkKeys.has(d.assessmentType)) {
      return _err(res, `Invalid assessment type "${d.assessmentType}". Configured types: ${[...validMarkKeys].join(', ')}`);
    }

    // Enforce that only admin/superadmin can add MT and ET
    // (teachers add CA and HW by default; MT/ET require elevated permission)
    const role = req.jwtUser.role;
    const canAddExams = ['admin', 'superadmin', 'deputy_principal'].includes(role);
    if (['MT', 'ET'].includes(d.assessmentType) && !canAddExams) {
      const teacherCanEnterExams = markConfig.teacherExamEntry === true;
      if (!teacherCanEnterExams) {
        return _err(res, 'MT and ET marks can only be entered by admin or deputy. Contact your admin to enable teacher exam entry.', 403);
      }
    }

    const label = d.label || _label(d.assessmentType, d.instance);

    const doc = await tenantModel('assessment_marks', tenantContext(req)).findOneAndUpdate(
      {
        schoolId,
        studentId:      d.studentId,
        subjectId:      d.subjectId,
        termNumber:     d.termNumber,
        assessmentType: d.assessmentType,
        instance:       d.instance,
        academicYearId: d.academicYearId || null,
      },
      {
        $set: {
          rawScore:    d.rawScore,
          classId:     d.classId,
          label,
          isPublished: d.isPublished,
          updatedBy:   userId,
        },
        $setOnInsert: {
          id:        uuidv4(),
          schoolId,
          createdBy: userId,
        },
      },
      { new: true, upsert: true }
    ).lean();

    return created(res, doc);
  } catch (err) {
    console.error('[assessment/marks POST]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/marks/bulk
 * Bulk upsert marks — used for class-wide mark entry.
 * Body: { marks: [...] }
 */
router.post('/marks/bulk', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const bulkParsed = BulkMarkSchema.safeParse(req.body);
    if (!bulkParsed.success) {
      return _err(res, bulkParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const marks = bulkParsed.data.marks.map(d => ({ ...d, assessmentType: d.assessmentType.toUpperCase() }));

    // Guard: reject if any mark targets an archived academic year
    const yearIds = marks.map(d => d.academicYearId).filter(Boolean);
    if (yearIds.length > 0) {
      const lockedYid = await firstArchivedYear(schoolId, yearIds);
      if (lockedYid) {
        return _err(res, `Academic year "${lockedYid}" is locked — marks cannot be added or modified.`, 403);
      }
    }

    // Load config once for type validation + permission check
    const bulkConfig = await _getConfig(schoolId, marks[0]?.academicYearId || null);
    const validBulkKeys = new Set(bulkConfig.customTypes.map(t => t.key));

    // Validate all assessment types against school's configured types
    const invalidMark = marks.find(d => !validBulkKeys.has(d.assessmentType));
    if (invalidMark) {
      return _err(res, `Invalid assessment type "${invalidMark.assessmentType}". Configured types: ${[...validBulkKeys].join(', ')}`);
    }

    // Enforce that only admin/deputy_principal can bulk-enter MT and ET
    const role = req.jwtUser.role;
    const canAddExams = ['admin', 'superadmin', 'deputy_principal'].includes(role);
    const hasExamTypes = marks.some(d => ['MT', 'ET'].includes(d.assessmentType));
    if (hasExamTypes && !canAddExams) {
      if (!bulkConfig.teacherExamEntry) {
        return _err(res, 'MT and ET marks can only be entered by admin or deputy. Contact your admin to enable teacher exam entry.', 403);
      }
    }

    // Guard: reject if the relevant schedule entry is locked by admin
    const schedOr = [...new Set(marks.map(d => `${d.assessmentType}__${d.termNumber}`))].map(k => {
      const [assessmentType, termNumber] = k.split('__');
      return { assessmentType, termNumber: Number(termNumber) };
    });
    const lockedScheduleEntry = await tenantModel('assessment_schedule', tenantContext(req)).findOne({
      schoolId,
      isLocked: true,
      $or: schedOr,
    }).lean();
    if (lockedScheduleEntry) {
      return _err(
        res,
        `"${lockedScheduleEntry.label || lockedScheduleEntry.assessmentType}" for Term ${lockedScheduleEntry.termNumber} has been locked by admin. Mark entry is not allowed until it is unlocked.`,
        403
      );
    }

    // Guard: reject if any target marks are locked (post-approval lock)
    const Marks = tenantModel('assessment_marks', tenantContext(req));
    const lockedSample = await Marks.findOne({
      schoolId,
      isLocked: true,
      $or: marks.map(d => ({
        studentId:      d.studentId,
        subjectId:      d.subjectId,
        termNumber:     d.termNumber,
        assessmentType: d.assessmentType,
        instance:       d.instance,
      })),
    }).lean();
    if (lockedSample) {
      return _err(res, 'Some marks in this batch are locked. Submit an unlock request via the approval workflow.', 403);
    }

    // Optimistic concurrency (mirrors exams.js's POST /:id/results — same
    // pattern, applied here because this endpoint, not exam_results, is
    // the one live mark-entry UI (ExamsPage's Markbook) actually calls).
    // Composite key since uniqueness here is a 6-field tuple, not a bare
    // studentId. Fetch existing docs once, split submitted marks into
    // conflicts (stale _v) and writable; conflicts are never sent to
    // bulkWrite — encoding _v into an upsert filter would make a stale
    // version silently create a duplicate instead of correctly failing to
    // match. Omitting _v (as older clients do) skips the check entirely.
    const _markKey = d => `${d.studentId}|${d.subjectId}|${d.termNumber}|${d.assessmentType}|${d.instance}|${d.academicYearId || ''}`;
    const existingMarks = await Marks.find({
      schoolId,
      $or: marks.map(d => ({
        studentId:      d.studentId,
        subjectId:      d.subjectId,
        termNumber:     d.termNumber,
        assessmentType: d.assessmentType,
        instance:       d.instance,
        academicYearId: d.academicYearId || null,
      })),
    }).lean();
    const existingMarkMap = Object.fromEntries(existingMarks.map(m => [_markKey(m), m]));

    const conflicts = [];
    const writableMarks = [];
    for (const d of marks) {
      const existing = existingMarkMap[_markKey(d)];
      if (existing && d._v != null && Number(d._v) !== (existing._v ?? 0)) {
        conflicts.push({
          studentId:       d.studentId,
          subjectId:       d.subjectId,
          assessmentType:  d.assessmentType,
          instance:        d.instance,
          yourVersion:     Number(d._v),
          currentVersion:  existing._v ?? 0,
          currentRawScore: existing.rawScore,
        });
        continue;
      }
      writableMarks.push(d);
    }

    const ops = writableMarks.map(d => ({
      updateOne: {
        filter: {
          schoolId,
          studentId:      d.studentId,
          subjectId:      d.subjectId,
          termNumber:     d.termNumber,
          assessmentType: d.assessmentType,
          instance:       d.instance,
          academicYearId: d.academicYearId || null,
        },
        update: {
          $set: {
            rawScore:    d.rawScore,
            classId:     d.classId,
            label:       d.label || _label(d.assessmentType, d.instance),
            isPublished: d.isPublished !== false,
            updatedBy:   userId,
          },
          $setOnInsert: {
            id:        uuidv4(),
            schoolId,
            createdBy: userId,
          },
          $inc: { _v: 1 },
        },
        upsert: true,
      },
    }));

    const result = ops.length
      ? await Marks.bulkWrite(ops, { ordered: false })
      : { upsertedCount: 0, modifiedCount: 0 };
    return _ok(res, {
      upserted:  result.upsertedCount,
      modified:  result.modifiedCount,
      total:     marks.length,
      conflicts,
    }, null, 201);
  } catch (err) {
    console.error('[assessment/marks/bulk POST]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/marks/:id
 */
router.delete('/marks/:id', authMiddleware, PLAN, rbac('grades', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('assessment_marks', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Mark not found');
    return _ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[assessment/marks DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   REPORT CARD  —  GET /api/assessment/report
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/report
 * Compute a full structured report card for a student or an entire class.
 *
 * Query params (one required):
 *   studentId     — single student report
 *   classId       — class-wide report (all students in class)
 *   academicYearId — filter to academic year
 *   termNumber     — 1|2|3 → returns only that term's data
 *                    omit  → returns all 3 terms
 *   half           — 'true' → return half-term totals (CA+HW+MT only)
 *
 * Response structure (per student, per subject):
 *   terms: {
 *     1: { typeAvgs, breakdown, halfTermTotal, termTotal, finalGrade, etRunningAvg, etRef }
 *     2: { ... etRef: { ET1 } }
 *     3: { ... etRef: { ET1, ET2 } }
 *   }
 *   summaryAverage: number  (Template B — avg of T1+T2+T3 totals)
 */
router.get('/report', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId, classId, academicYearId, termNumber, half } = req.query;

    if (!studentId && !classId) {
      return _err(res, 'studentId or classId is required');
    }

    // Load config (weights, template) + default grade scale in parallel
    const [config, defaultScale] = await Promise.all([
      _getConfig(schoolId, academicYearId || null),
      tenantModel('grade_boundaries', tenantContext(req)).findOne({ schoolId, isDefault: true }).lean(),
    ]);
    // Derive weights from customTypes (new) or fall back to legacy weights map
    const weights = config.customTypes && config.customTypes.length > 0
      ? Object.fromEntries(config.customTypes.map(t => [t.key, t.weight]))
      : (config.weights || DEFAULT_WEIGHTS);

    // Fetch all published marks
    const marksFilter = { schoolId, isPublished: true };
    if (studentId)      marksFilter.studentId      = studentId;
    if (classId)        marksFilter.classId        = classId;
    if (academicYearId) marksFilter.academicYearId = academicYearId;
    if (termNumber)     marksFilter.termNumber     = Number(termNumber);

    // Safety ceiling: 10,000 marks = ~50 students × 14 subjects × 4 types × 3-4 instances
    // Bounded further by the classId/termNumber filters applied above
    const allMarks = await tenantModel('assessment_marks', tenantContext(req)).find(marksFilter).limit(10000).lean();

    // Group marks by studentId → subjectId
    const byStudentSubject = {};
    for (const m of allMarks) {
      const key = `${m.studentId}__${m.subjectId}`;
      byStudentSubject[key] = byStudentSubject[key] || {
        studentId: m.studentId,
        subjectId: m.subjectId,
        classId:   m.classId,
        marks:     [],
      };
      byStudentSubject[key].marks.push(m);
    }

    // Compute report per student per subject
    const reportsByStudent = {};
    for (const { studentId: sid, subjectId, classId: cid, marks } of Object.values(byStudentSubject)) {
      reportsByStudent[sid] = reportsByStudent[sid] || { studentId: sid, classId: cid, subjects: {} };
      reportsByStudent[sid].subjects[subjectId] = buildSubjectReport({ marks, weights });
    }

    // If half-term mode, strip ET from results and highlight halfTermTotal
    const isHalf = half === 'true';
    if (isHalf) {
      for (const student of Object.values(reportsByStudent)) {
        for (const subReport of Object.values(student.subjects)) {
          for (const term of Object.values(subReport.terms)) {
            delete term.finalGrade;
            delete term.etRunningAvg;
            // halfTermTotal is the key metric
          }
        }
      }
    }

    // Attach config so frontend knows template, weights, types, and grade scale used
    const result = {
      config: {
        weights,
        customTypes:    config.customTypes || DEFAULT_CUSTOM_TYPES,
        reportTemplate: config.reportTemplate,
        instances:      config.instances || DEFAULT_INSTANCES,
        gradeScale:     defaultScale ? { id: defaultScale.id, name: defaultScale.name, bands: defaultScale.bands } : null,
      },
      students: Object.values(reportsByStudent),
    };

    // If single student, unwrap for convenience
    if (studentId) {
      return _ok(res, {
        ...result,
        student: reportsByStudent[studentId] || { studentId, subjects: {} },
      });
    }

    return _ok(res, result);
  } catch (err) {
    console.error('[assessment/report GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   REMINDERS  —  GET /api/assessment/reminders
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/reminders
 * Returns upcoming and overdue assessments for the calling teacher
 * (or all assessments if admin).
 *
 * An assessment is:
 *   - "upcoming"  if dateFrom is within the next 7 days (not yet open)
 *   - "open"      if today is between dateFrom and dateTo
 *   - "overdue"   if dateTo has passed and marks are incomplete
 *   - "completed" if dateTo has passed and marks are entered
 *
 * Query params:
 *   academicYearId
 *   classId        — scope to specific class
 *   subjectId      — scope to specific subject
 *   days           — days ahead to look for upcoming (default: 7)
 */
router.get('/reminders', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId, classId, subjectId } = req.query;
    const daysAhead = Number(req.query.days) || 7;

    const today      = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr   = today.toISOString().slice(0, 10);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    // Load schedule
    const schedFilter = { schoolId };
    if (academicYearId) schedFilter.academicYearId = academicYearId;

    const schedules = await tenantModel('assessment_schedule', tenantContext(req)).find(schedFilter).lean();

    // For each schedule entry, check if marks have been entered
    const reminders = [];

    for (const sched of schedules) {
      const status =
        sched.dateTo < todayStr   ? 'overdue' :
        sched.dateFrom <= todayStr ? 'open'    :
        sched.dateFrom <= futureDateStr ? 'upcoming' : null;

      if (!status) continue;

      // Count marks entered for this assessment
      const marksFilter = {
        schoolId,
        termNumber:     sched.termNumber,
        assessmentType: sched.assessmentType,
        instance:       sched.instance,
        academicYearId: sched.academicYearId || null,
      };
      if (classId)   marksFilter.classId   = classId;
      if (subjectId) marksFilter.subjectId = subjectId;

      const marksCount = await tenantModel('assessment_marks', tenantContext(req)).countDocuments(marksFilter);

      reminders.push({
        scheduleId:     sched.id,
        termNumber:     sched.termNumber,
        assessmentType: sched.assessmentType,
        instance:       sched.instance,
        label:          sched.label,
        dateFrom:       sched.dateFrom,
        dateTo:         sched.dateTo,
        status,
        marksEntered:   marksCount,
        academicYearId: sched.academicYearId,
      });
    }

    // Sort: overdue first, then open, then upcoming
    const ORDER = { overdue: 0, open: 1, upcoming: 2 };
    reminders.sort((a, b) =>
      (ORDER[a.status] - ORDER[b.status]) ||
      (a.dateFrom > b.dateFrom ? 1 : -1)
    );

    return _ok(res, reminders);
  } catch (err) {
    console.error('[assessment/reminders GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   SEND REMINDERS  —  POST /api/assessment/reminders/notify
   Trigger email + in-app notifications for overdue/open assessments.
   Typically called by a cron job but can also be triggered manually by admin.
   ══════════════════════════════════════════════════════════════ */

router.post('/reminders/notify', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId } = req.body;

    const today     = new Date().toISOString().slice(0, 10);
    const upcoming  = new Date();
    upcoming.setDate(upcoming.getDate() + 3);
    const upcomingStr = upcoming.toISOString().slice(0, 10);

    // Schedules that are open, overdue, or opening within 3 days
    const schedules = await tenantModel('assessment_schedule', tenantContext(req)).find({
      schoolId,
      ...(academicYearId ? { academicYearId } : {}),
      dateFrom: { $lte: upcomingStr },
    }).lean();

    if (!schedules.length) return _ok(res, { sent: 0, message: 'No assessments in reminder window' });

    // Load school info for email branding
    const school = await _model('schools').findOne({ id: schoolId }).lean();

    // Load all teachers for this school
    const teachers = await tenantModel('users', tenantContext(req)).find({ schoolId, role: 'teacher' }).limit(200).lean();

    let notified = 0;
    for (const sched of schedules) {
      const status =
        sched.dateTo < today    ? 'overdue'  :
        sched.dateFrom <= today ? 'open'     : 'upcoming';

      const statusMsg = {
        upcoming: `📅 Upcoming: ${sched.label} opens on ${sched.dateFrom}`,
        open:     `✏️  Open now: ${sched.label} — marks due by ${sched.dateTo}`,
        overdue:  `⚠️  Overdue: ${sched.label} closed on ${sched.dateTo} — please enter marks immediately`,
      }[status];

      // Create in-app notifications
      for (const teacher of teachers) {
        await tenantModel('notifications', tenantContext(req)).create({
          id:        uuidv4(),
          schoolId,
          userId:    teacher.id,
          type:      'assessment_reminder',
          title:     `Assessment Reminder — ${sched.label}`,
          body:      statusMsg,
          status,
          scheduleId: sched.id,
          read:       false,
          createdAt:  new Date().toISOString(),
        }).catch(() => {}); // non-fatal

        // Send email if teacher has email
        if (teacher.email && email.sendAssessmentReminder) {
          await email.sendAssessmentReminder({
            name:        teacher.name,
            email:       teacher.email,
            assessment:  sched.label,
            termNumber:  sched.termNumber,
            dateFrom:    sched.dateFrom,
            dateTo:      sched.dateTo,
            status,
            schoolName:  school?.name || schoolId,
            schoolEmail: school?.systemEmail || '',
            schoolId,
          }).catch(e => console.error('[assessment/reminders/notify] email failed:', e.message));
        }
        notified++;
      }
    }

    return _ok(res, { sent: notified, assessments: schedules.length });
  } catch (err) {
    console.error('[assessment/reminders/notify POST]', err);
    return E.serverError(res);
  }
});

/* ── Class mark-entry summary ───────────────────────────────── */

/**
 * GET /api/assessment/marks/summary
 * Returns for each student in a class: which assessments have marks entered.
 * Useful for showing the teacher a completion grid.
 *
 * Query: classId (required), subjectId, termNumber, academicYearId
 */
router.get('/marks/summary', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId, termNumber, academicYearId } = req.query;

    if (!classId) return _err(res, 'classId is required');

    const filter = { schoolId, classId };
    if (subjectId)      filter.subjectId      = subjectId;
    if (termNumber)     filter.termNumber     = Number(termNumber);
    if (academicYearId) filter.academicYearId = academicYearId;

    // classId is required (enforced above) — bounded to one class, safe ceiling
    const marks = await tenantModel('assessment_marks', tenantContext(req)).find(filter).limit(5000).lean();

    // Group by studentId → assessmentType+instance → rawScore
    const grid = {};
    for (const m of marks) {
      grid[m.studentId] = grid[m.studentId] || {};
      const key = `${m.assessmentType}${m.instance}`;
      grid[m.studentId][key] = m.rawScore;
    }

    return _ok(res, grid);
  } catch (err) {
    console.error('[assessment/marks/summary GET]', err);
    return E.serverError(res);
  }
});

module.exports = router;
module.exports.getConfig          = _getConfig;
module.exports.DEFAULT_CUSTOM_TYPES = DEFAULT_CUSTOM_TYPES;
