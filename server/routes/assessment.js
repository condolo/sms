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
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const email              = require('../utils/email');
const { mergeConfig, resolveCurrentPeriod } = require('./academic-config');
const { aggregateAssessmentMarks, computeFinalScores } = require('../utils/academic-calc');
const { isYearArchived, firstArchivedYear } = require('../utils/archival');
const { canWriteSubject, unassignedPairs } = require('../utils/subject-scope');
const { isElective, electiveMarkProblem } = require('../utils/elective-scope');
const { restrictToTaught, taughtSubjectIds } = require('../utils/teaching-scope');
const ScopeEngine         = require('../utils/scopeEngine');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const { MARK_STATES }     = require('../utils/mark-states');

const router = express.Router();
const PLAN   = planGate('grades');
const MODGATE = moduleGate('grades');

/* ── Constants ──────────────────────────────────────────────── */

const DEFAULT_ASSESSMENT_TYPES = ['CA', 'HW', 'MT', 'ET'];  // kept for migration
const TERM_NUMBERS             = [1, 2, 3];

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

/** Validate that a weights object sums to 100. Returns { valid, total }. */
function validateWeights(weights) {
  const total = Object.values(weights).reduce((s, n) => s + Number(n), 0);
  return { valid: Math.abs(total - 100) < 0.01, total: Math.round((total + Number.EPSILON) * 100) / 100 };
}

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
      customTypes:    DEFAULT_CUSTOM_TYPES.map(t => ({ ...t })),
      subjectTeacherCommentsEnabled: true,
    };
    await Config.create(doc);
  }
  if (doc.subjectTeacherCommentsEnabled === undefined) doc.subjectTeacherCommentsEnabled = true;
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

/* A requested academicYearId must also match any record stored with
   academicYearId: null — the Config screen's Assessment Schedule form
   (and, historically, the Markbook mark-entry payload — see the dual-mode
   lookup in PUT /marks below) has never required or sent a year, so
   EVERY real assessment_schedule document in production carries
   academicYearId: null (confirmed directly against the live database,
   2026-09-30 — 8 of 8 documents, no exceptions). A strict equality filter
   against a real yearId therefore matches nothing at all: the Markbook's
   "Assessment" dropdown, the reminders panel, and the marks grid/summary
   all read empty the moment the caller has a real academic year
   selected — which is always, since that's the whole point of the
   selector. Treating a stored null as "applies to every year" (the same
   backward-compatible posture this file's own mark-save path already
   uses) fixes the read side to match. */
function _yearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : {};
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

   RBAC note (2026-09): every route from here through GET/POST/PUT/
   DELETE /grade-scales and POST /reminders/notify was previously
   gated on rbac('settings', ...) — a genuinely different RBAC
   resource from 'exams'/'grades'/'assessment'/'report_cards'.
   Granting a role full access to the exam/report-card modules (e.g.
   the built-in 'exams_officer' role, which holds assessment:RCUD by
   default — repairPermissions.js) never grants 'settings', so these
   config screens stayed 403 no matter how much exam/grades access was
   granted. Found live: an admin gave a teacher the Exams Officer role
   with full exam/report-card access, and that account still hit
   "Your role does not have 'read' permission on 'settings'" the
   moment the Exams page loaded (GET /config fires unconditionally on
   mount, not just when opening the Configuration tab). Fixed by
   switching every one of these to rbac('assessment', ...) — the same
   resource /schedule/:id/lock and /unlock already correctly used.
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/config
 * Returns the school's assessment configuration (weights, template, instances).
 * Falls back to defaults if not yet configured.
 */
router.get('/config', authMiddleware, PLAN, MODGATE, rbac('assessment', 'read'), async (req, res) => {
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
 * Update weights and/or instance counts.
 *
 * Body (all optional):
 *   weights:        { CA, HW, MT, ET }  — must sum to 100
 *   instances:      { CA: number, HW: number }  — min 1, max 10
 *   subjectTeacherCommentsEnabled: boolean — RC7 capability toggle; when
 *     false, Mark Entry stops collecting the field and Report Cards'
 *     Subject Teacher Comments section renders zero trace (no header, no
 *     placeholder rows) rather than an empty section
 *   academicYearId: string
 */
router.patch('/config', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId, weights, instances, subjectTeacherCommentsEnabled } = req.body;

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

    // ── Validate subjectTeacherCommentsEnabled ──
    if (subjectTeacherCommentsEnabled !== undefined) {
      if (typeof subjectTeacherCommentsEnabled !== 'boolean') {
        return _err(res, 'subjectTeacherCommentsEnabled must be a boolean');
      }
      update.subjectTeacherCommentsEnabled = subjectTeacherCommentsEnabled;
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
  // Per assessment: whether teachers are asked for a comment alongside marks in the Markbook.
  commentsEnabled: z.boolean().optional(),
});

/**
 * GET /api/assessment/schedule
 * Returns all assessment date ranges for the school.
 */
router.get('/schedule', authMiddleware, PLAN, MODGATE, rbac('assessment', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, ..._yearFilterPart(req.query.academicYearId) };
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
router.put('/schedule', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
    const Schedule = tenantModel('assessment_schedule', tenantContext(req));
    const naturalKey = { schoolId, termNumber: d.termNumber, assessmentType: d.assessmentType, instance: d.instance };

    let doc;
    if (d.academicYearId) {
      // Explicit year given (e.g. scheduling ahead for next year) — exact
      // match/create for that year only, unchanged behavior, never touches
      // a legacy null-tagged row under this same key.
      doc = await Schedule.findOneAndUpdate(
        { ...naturalKey, academicYearId: d.academicYearId },
        {
          $set: { dateFrom: d.dateFrom, dateTo: d.dateTo, label, ...(d.commentsEnabled === undefined ? {} : { commentsEnabled: d.commentsEnabled }) },
          $setOnInsert: { id: uuidv4(), schoolId, academicYearId: d.academicYearId },
        },
        { new: true, upsert: true }
      ).lean();
    } else {
      // Default to the school's current academic year instead of ever
      // persisting another null. Every one of the 8 live schedule documents
      // (checked directly) had a null academicYearId — the root cause of
      // the Markbook's "none scheduled" bug (v5.166.0). Legacy null rows
      // keep matching reads via _yearFilterPart's own fallback; this stops
      // NEW rows from joining them — and adopts/backfills an existing
      // legacy row for this same key the moment it's saved again, same
      // precedent as POST /marks' own adoption logic, so re-saving an old
      // entry doesn't upsert a duplicate instead of updating it.
      const years = await tenantModel('academic_years', tenantContext(req)).find({ schoolId }).lean();
      const { year } = resolveCurrentPeriod(years);
      const resolvedYearId = year?.id ?? null;

      const existing = await Schedule.findOne({ ...naturalKey, academicYearId: null }).lean();
      doc = await Schedule.findOneAndUpdate(
        { ...naturalKey, academicYearId: existing ? null : resolvedYearId },
        {
          $set: { dateFrom: d.dateFrom, dateTo: d.dateTo, label, academicYearId: resolvedYearId, ...(d.commentsEnabled === undefined ? {} : { commentsEnabled: d.commentsEnabled }) },
          $setOnInsert: { id: uuidv4(), schoolId },
        },
        { new: true, upsert: true }
      ).lean();
    }

    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/schedule PUT]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/schedule/:id
 */
router.delete('/schedule/:id', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.post('/schedule/:id/lock', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.post('/schedule/:id/unlock', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.get('/types', authMiddleware, PLAN, MODGATE, rbac('assessment', 'read'), async (req, res) => {
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
router.post('/types', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.put('/types', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.delete('/types/:key', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.get('/grade-scales', authMiddleware, PLAN, MODGATE, rbac('assessment', 'read'), async (req, res) => {
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
router.post('/grade-scales', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.put('/grade-scales/:id', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
router.delete('/grade-scales/:id', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
  rawScore:       z.number().min(0).max(100).optional(),
  // Mark state — present/ABS/MIS/EXM/INC, shared with the (now legacy)
  // exam_results vocabulary (server/utils/mark-states.js), since the
  // Markbook is becoming the one place every assessment type's marks are
  // entered, including absent/exempted/incomplete cases that previously
  // only the Exams → Results screen could represent.
  markState:      z.enum(MARK_STATES).default('present'),
  label:          z.string().max(100).optional(),
  isPublished:    z.boolean().default(true),
  // Optimistic concurrency (mirrors exam_results/ResultSchema's _v — see
  // POST /api/exams/:id/results). Optional: omitting it skips the version
  // check entirely, same "no behavior change until a client sends it"
  // contract as the exam-results endpoint.
  _v:             z.number().int().min(0).optional(),
}).superRefine((d, ctx) => {
  if (d.markState === 'present' && d.rawScore == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rawScore'], message: 'rawScore is required when markState is "present"' });
  }
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
router.get('/marks', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };

    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    Object.assign(filter, _yearFilterPart(req.query.academicYearId));
    if (req.query.assessmentType) filter.assessmentType = req.query.assessmentType.toUpperCase();
    if (req.query.isPublished !== undefined) {
      filter.isPublished = req.query.isPublished === 'true';
    }

    // Data scope — same mechanism GET /analytics already uses below;
    // this route had none at all before, so any grades:read holder could
    // list every mark in the school regardless of class/stream assignment.
    ScopeEngine.applyToFilter(req, 'assessment', filter);
    // Class and stream scope does not narrow by subject: only the subjects this caller teaches.
    await restrictToTaught(req, filter);

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
router.post('/marks', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const rawParsed = MarkSchema.safeParse(req.body);
    if (!rawParsed.success) {
      return _err(res, rawParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = {
      ...rawParsed.data,
      assessmentType: rawParsed.data.assessmentType.toUpperCase(),
      // A non-present state carries no score — nulled server-side so a
      // stale client-supplied rawScore can never masquerade as a real mark.
      rawScore: rawParsed.data.markState === 'present' ? rawParsed.data.rawScore : null,
    };

    // Guard: reject writes to archived academic years
    if (d.academicYearId && await isYearArchived(schoolId, d.academicYearId)) {
      return _err(res, 'This academic year is locked — marks cannot be added or modified.', 403);
    }

    // Resolve the student's stream once — needed both for the scope check
    // below (a teacher whose only assignment for this class+subject is
    // scoped to ONE stream — a compulsory subject, see teaching-
    // assignments.js — must not be able to write marks for a different
    // stream's student) and to denormalize streamId onto the mark itself,
    // same as classId, so reads can be scoped the same way later.
    const markStudent = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: d.studentId }).select('streamId').lean();

    // Guard: subject-teacher scoping (RC6) — unconditional (see subject-scope.js)
    // Electives: teaching and enrolment are checked per student, not by stream.
    const electiveProblem = await electiveMarkProblem(req, [{ classId: d.classId, subjectId: d.subjectId, studentId: d.studentId }]);
    if (electiveProblem) return _err(res, electiveProblem, 403);
    if (!(await isElective(req, d.classId, d.subjectId)) && !(await canWriteSubject(req, d.classId, d.subjectId, markStudent?.streamId))) {
      return _err(res, 'You are not assigned to teach this subject in this class.', 403);
    }

    // Load config once (shared for type validation + permission check)
    const markConfig = await _getConfig(schoolId, d.academicYearId || null);

    // Validate assessmentType against school's configured types
    const validMarkKeys = new Set(markConfig.customTypes.map(t => t.key));
    if (!validMarkKeys.has(d.assessmentType)) {
      return _err(res, `Invalid assessment type "${d.assessmentType}". Configured types: ${[...validMarkKeys].join(', ')}`);
    }

    // MT and ET marks are entered the same way CA and HW are: by the subject teacher this
    // route already checked above (canWriteSubject / isElective). There used to be a second,
    // admin/deputy-only gate here for MT and ET specifically, behind a markConfig.teacherExamEntry
    // toggle — but that toggle was never written anywhere (no route, no Settings screen), so it
    // could never be true, and the gate blocked every teacher, for every school, unconditionally.
    // The Markbook owns marks for every assessment type alike; moderation (mark_submissions), not
    // an entry-time role check, is the intended safeguard for exam-type marks.

    // Guard: reject if the relevant schedule entry is locked by admin, if
    // this specific mark is already locked (post-approval), or if its
    // mark_submissions record is under review (submitted/approved but not
    // yet locked). /marks/bulk — the Markbook grid's own save path — has
    // always had the first two checks; this single-mark route had none of
    // them at all, a real gap now that the Markbook is the only mark-entry
    // surface. Kept separate from /marks/bulk's own (near-identical) guards
    // rather than factored out, since the two routes' data shapes differ
    // (one mark vs an array) enough that a shared helper would need its own
    // array-wrapping boilerplate at each call site anyway.
    const lockedScheduleEntry = await tenantModel('assessment_schedule', tenantContext(req)).findOne({
      schoolId, isLocked: true, assessmentType: d.assessmentType, termNumber: d.termNumber,
    }).lean();
    if (lockedScheduleEntry) {
      return _err(res, `"${lockedScheduleEntry.label || lockedScheduleEntry.assessmentType}" for Term ${lockedScheduleEntry.termNumber} has been locked by admin. Mark entry is not allowed until it is unlocked.`, 403);
    }

    const label = d.label || _label(d.assessmentType, d.instance);
    const Marks = tenantModel('assessment_marks', tenantContext(req));
    const naturalKey = {
      schoolId,
      studentId:      d.studentId,
      subjectId:      d.subjectId,
      termNumber:     d.termNumber,
      assessmentType: d.assessmentType,
      instance:       d.instance,
    };

    const lockedExisting = await Marks.findOne({ ...naturalKey, isLocked: true }).lean();
    if (lockedExisting) {
      return _err(res, 'This mark is locked. Submit an unlock request via the approval workflow.', 403);
    }
    // Per stream: only a submission for this student's stream (or a legacy whole-class one) locks this mark.
    const underReview = await tenantModel('mark_submissions', tenantContext(req)).findOne({
      schoolId, classId: d.classId, subjectId: d.subjectId, termNumber: d.termNumber,
      assessmentType: d.assessmentType, instance: d.instance, status: { $in: ['submitted', 'approved'] },
      streamId: { $in: [markStudent?.streamId ?? null, null] },
    }).lean();
    if (underReview) {
      return _err(res, `These marks are ${underReview.status} for review and cannot be edited — recall the submission first.`, 403);
    }

    // Which existing document (if any) this save should land on. Every mark
    // entered before this fix was saved with academicYearId: null (the
    // Markbook UI never sent one — see ExamsPage.jsx/report-cards.js's
    // comments on the same gap). Matching on the real academicYearId alone
    // would silently miss that legacy row and upsert:true would then INSERT
    // A DUPLICATE for the same student/subject/term/type/instance instead of
    // updating it — real data corruption on the very first re-save after
    // this fix ships. So: match the real-year row if one already exists
    // (the normal case for anything saved after this fix), else adopt the
    // legacy null-tagged row for this same key if one exists (this is what
    // backfills it), else fall through to a genuine new upsert.
    const existing = d.academicYearId
      ? await Marks.findOne({ ...naturalKey, $or: [{ academicYearId: d.academicYearId }, { academicYearId: null }] })
          .sort({ academicYearId: -1 }) // real year (truthy) sorts before null
          .lean()
      : await Marks.findOne({ ...naturalKey, academicYearId: null }).lean();

    const matchFilter = existing
      ? { ...naturalKey, academicYearId: existing.academicYearId ?? null }
      : { ...naturalKey, academicYearId: d.academicYearId || null };

    const doc = await Marks.findOneAndUpdate(
      matchFilter,
      {
        $set: {
          rawScore:      d.rawScore,
          markState:     d.markState,
          classId:       d.classId,
          streamId:      markStudent?.streamId ?? null,
          label,
          isPublished:   d.isPublished,
          updatedBy:     userId,
          // Backfills a legacy null-tagged row the moment it's touched
          // again; a no-op $set when it already matches.
          academicYearId: d.academicYearId || null,
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
router.post('/marks/bulk', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const bulkParsed = BulkMarkSchema.safeParse(req.body);
    if (!bulkParsed.success) {
      return _err(res, bulkParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const marks = bulkParsed.data.marks.map(d => ({
      ...d,
      assessmentType: d.assessmentType.toUpperCase(),
      rawScore: d.markState === 'present' ? d.rawScore : null,
    }));

    // Guard: reject if any mark targets an archived academic year
    const yearIds = marks.map(d => d.academicYearId).filter(Boolean);
    if (yearIds.length > 0) {
      const lockedYid = await firstArchivedYear(schoolId, yearIds);
      if (lockedYid) {
        return _err(res, `Academic year "${lockedYid}" is locked — marks cannot be added or modified.`, 403);
      }
    }

    // Resolve every submitted student's stream once — needed both for the
    // scope check below (a teacher whose only assignment for a class+
    // subject is scoped to ONE stream must not write marks for a different
    // stream's student) and to denormalize streamId onto each mark.
    const bulkStudentIds = [...new Set(marks.map(d => d.studentId))];
    const bulkStudentDocs = await tenantModel('students', tenantContext(req))
      .find({ schoolId, id: { $in: bulkStudentIds } }).select('id streamId').lean();
    const streamByStudent = Object.fromEntries(bulkStudentDocs.map(s => [s.id, s.streamId ?? null]));

    // Guard: subject-teacher scoping (RC6) — unconditional (see subject-scope.js);
    // one query for every distinct {classId, subjectId, streamId} triple in
    // the batch. Deduped by triple, not just {classId, subjectId} — within one class+
    // subject, 7i and 7ii can have different assigned teachers, so the same
    // pair can be assigned for one stream and not the other.
    const distinctPairs = [...new Map(
      marks.map(d => {
        const streamId = streamByStudent[d.studentId] ?? null;
        return [`${d.classId}::${d.subjectId}::${streamId}`, { classId: d.classId, subjectId: d.subjectId, streamId }];
      })
    ).values()];
    // Elective pairs are checked by enrolment and teaching (elective-scope.js), not by stream.
    const electiveKeys = new Set();
    for (const p of distinctPairs) {
      if (await isElective(req, p.classId, p.subjectId)) electiveKeys.add(`${p.classId}::${p.subjectId}`);
    }
    const electiveProblem = await electiveMarkProblem(req, marks);
    if (electiveProblem) return _err(res, electiveProblem, 403);
    const denied = await unassignedPairs(req, distinctPairs.filter(p => !electiveKeys.has(`${p.classId}::${p.subjectId}`)));
    if (denied.length > 0) {
      return _err(res, `You are not assigned to teach: ${denied.map(p => p.subjectId).join(', ')}`, 403);
    }

    // Load config once for type validation + permission check
    const bulkConfig = await _getConfig(schoolId, marks[0]?.academicYearId || null);
    const validBulkKeys = new Set(bulkConfig.customTypes.map(t => t.key));

    // Validate all assessment types against school's configured types
    const invalidMark = marks.find(d => !validBulkKeys.has(d.assessmentType));
    if (invalidMark) {
      return _err(res, `Invalid assessment type "${invalidMark.assessmentType}". Configured types: ${[...validBulkKeys].join(', ')}`);
    }

    // MT and ET marks are entered the same way CA and HW are: by the subject teacher
    // (unassignedPairs / electiveMarkProblem, checked above). See the single-mark route's
    // own comment for why the former admin/deputy-only gate here was removed.

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

    // Guard: reject if any target marks are locked (post-approval lock).
    // academicYearId deliberately included now — found during the Academic
    // Year dependency-map fix below: an unscoped $or here meant a locked
    // mark from one year could block writing the *same* student/subject/
    // term/type/instance key in a completely different, unrelated year.
    // That was mostly invisible before (every mark shared academicYearId:
    // null, so year never differentiated anything); it becomes a real,
    // user-visible false-block the moment marks are correctly year-tagged,
    // so it has to move together with that fix, not after it.
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
        academicYearId: d.academicYearId || null,
      })),
    }).lean();
    // Guard: reject if the relevant mark_submissions record is under review
    // (submitted or already approved, but not yet locked — the terminal
    // 'locked' state is already caught above via assessment_marks.isLocked,
    // which mark-submissions.js's own lock route sets). Closes a real gap:
    // before this, a teacher could submit a class/subject's marks for
    // review and then keep silently editing them right up until an admin
    // got around to locking — defeating the entire point of "submitted".
    // Matched on the same key mark-submissions.js itself uses by default
    // (no academicYearId — that field is optional there too, same
    // null-prone legacy posture every other assessment collection has).
    const subOr = [...new Set(marks.map(d => `${d.classId}::${d.subjectId}::${d.termNumber}::${d.assessmentType}::${d.instance}::${streamByStudent[d.studentId] ?? ''}`))]
      .map(k => {
        const [classId, subjectId, termNumber, assessmentType, instance, sid] = k.split('::');
        return { classId, subjectId, termNumber: Number(termNumber), assessmentType, instance: Number(instance), streamId: { $in: [sid || null, null] } };
      });
    const underReview = await tenantModel('mark_submissions', tenantContext(req)).findOne({
      schoolId,
      status: { $in: ['submitted', 'approved'] },
      $or: subOr,
    }).lean();
    if (underReview) {
      return _err(res, `These marks are ${underReview.status} for review and cannot be edited — recall the submission first.`, 403);
    }

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
    //
    // Widened deliberately: every mark saved before this fix has
    // academicYearId: null (the Markbook UI never sent one — see
    // ExamsPage.jsx/report-cards.js's comments on the same gap). Matching
    // only on the real year would miss that legacy row entirely and
    // upsert:true below would INSERT A DUPLICATE instead of updating it —
    // so for any mark that now carries a real academicYearId, this also
    // looks for its legacy null-tagged twin so _findExisting() can adopt
    // (and backfill) it instead of orphaning it.
    const _markKey = d => `${d.studentId}|${d.subjectId}|${d.termNumber}|${d.assessmentType}|${d.instance}|${d.academicYearId || ''}`;
    const existingMarks = await Marks.find({
      schoolId,
      $or: marks.flatMap(d => {
        const base = {
          studentId:      d.studentId,
          subjectId:      d.subjectId,
          termNumber:     d.termNumber,
          assessmentType: d.assessmentType,
          instance:       d.instance,
        };
        return d.academicYearId
          ? [{ ...base, academicYearId: d.academicYearId }, { ...base, academicYearId: null }]
          : [{ ...base, academicYearId: null }];
      }),
    }).lean();
    const existingMarkMap = Object.fromEntries(existingMarks.map(m => [_markKey(m), m]));
    // Real-year match first (the normal case for anything saved after this
    // fix); falls back to the legacy null-tagged twin so it gets adopted
    // (and backfilled) instead of orphaned into a duplicate row.
    const _findExisting = d =>
      existingMarkMap[_markKey(d)]
      ?? (d.academicYearId ? existingMarkMap[_markKey({ ...d, academicYearId: null })] : undefined);

    const conflicts = [];
    const writableMarks = [];
    for (const d of marks) {
      const existing = _findExisting(d);
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

    const ops = writableMarks.map(d => {
      const existing = _findExisting(d);
      return {
        updateOne: {
          filter: {
            schoolId,
            studentId:      d.studentId,
            subjectId:      d.subjectId,
            termNumber:     d.termNumber,
            assessmentType: d.assessmentType,
            instance:       d.instance,
            // Target whichever document actually exists (its own real
            // academicYearId, or the legacy null tag) rather than the
            // incoming value — matching on d.academicYearId alone when only
            // a null-tagged legacy row exists would upsert:true a duplicate.
            academicYearId: existing ? (existing.academicYearId ?? null) : (d.academicYearId || null),
          },
          update: {
            $set: {
              rawScore:    d.rawScore,
              markState:   d.markState,
              classId:     d.classId,
              streamId:    streamByStudent[d.studentId] ?? null,
              label:       d.label || _label(d.assessmentType, d.instance),
              isPublished: d.isPublished !== false,
              updatedBy:   userId,
              // Backfills a legacy null-tagged row the moment it's touched
              // again; a no-op $set when it's already correctly tagged.
              academicYearId: d.academicYearId || null,
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
      };
    });

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
router.delete('/marks/:id', authMiddleware, PLAN, MODGATE, rbac('grades', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Marks = tenantModel('assessment_marks', tenantContext(req));

    // Same RC6 subject-teacher guard as POST /marks — this route had none
    // at all before, so any grades:delete holder could remove any mark in
    // the school regardless of subject assignment, even with enforcement
    // turned on for every other write path. Closed here using the exact
    // same helper, not a new mechanism, since it's the natural counterpart
    // to the write-side check that already existed for POST.
    const target = await Marks.findOne({ id: req.params.id, schoolId }).select('classId subjectId streamId').lean();
    if (!target) return E.notFound(res, 'Mark not found');
    if (!(await canWriteSubject(req, target.classId, target.subjectId, target.streamId))) {
      return _err(res, 'You are not assigned to teach this subject in this class.', 403);
    }

    const doc = await Marks.findOneAndDelete({ id: req.params.id, schoolId });
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
 * Compute each subject's current weighted score for a student or an entire
 * class, via academic-calc.js's aggregateAssessmentMarks/computeFinalScores
 * — the same single source of truth report-cards.js uses, so this endpoint
 * can never drift from what a published report card actually shows.
 *
 * Query params (one required):
 *   studentId     — single student report (classId resolved from the
 *                    student's own record when omitted)
 *   classId       — class-wide report (all students in class)
 *   academicYearId — filter to academic year
 *   termNumber     — 1|2|3 → scores computed from that term's marks only
 *                    omit  → marks from every term are averaged per type
 *
 * Response (per student):
 *   subjects: [{ subjectId, subject, avgPct, grade, examCount }]
 */
router.get('/report', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    let { studentId, classId, academicYearId, termNumber } = req.query;

    if (!studentId && !classId) {
      return _err(res, 'studentId or classId is required');
    }

    // aggregateAssessmentMarks requires classId; resolve it from the
    // student's own record when the route was called with studentId only.
    // streamId is resolved alongside it either way — needed for the scope
    // check below, since a teacher whose only assignment for this class is
    // scoped to ONE stream must not pull a report for a different stream's
    // student.
    let studentStreamId = null;
    if (!classId && studentId) {
      const studentDoc = await tenantModel('students', tenantContext(req))
        .findOne({ schoolId, id: studentId }).select('classId streamId').lean();
      classId = studentDoc?.classId || null;
      studentStreamId = studentDoc?.streamId || null;
    } else if (classId && studentId) {
      const studentDoc = await tenantModel('students', tenantContext(req))
        .findOne({ schoolId, id: studentId }).select('streamId').lean();
      studentStreamId = studentDoc?.streamId || null;
    }

    // Data scope — this route had no check at all before; any grades:read
    // holder could pull any class's/student's computed report.
    if (classId && !ScopeEngine.isClassInScope(req, 'assessment', classId, studentStreamId)) {
      return _err(res, 'This class is not in your assigned scope.', 403);
    }

    // Load config (weights, template) + default grade scale in parallel
    const [config, defaultScale, academicCfg] = await Promise.all([
      _getConfig(schoolId, academicYearId || null),
      tenantModel('grade_boundaries', tenantContext(req)).findOne({ schoolId, isDefault: true }).lean(),
      tenantModel('academic_config', tenantContext(req)).findOne({ schoolId }).lean(),
    ]);

    const customTypes = (config.customTypes && config.customTypes.length > 0)
      ? config.customTypes
      : DEFAULT_CUSTOM_TYPES;
    const assessmentWeights = customTypes.map(t => ({
      assessmentType: t.key,
      label:          t.label || t.key,
      weight:         t.weight ?? 0,
    }));
    // Prefer grade_boundaries default scale over legacy academic_config.gradingSchema
    const gradingSchema = defaultScale?.bands ?? mergeConfig(academicCfg).gradingSchema;

    let finalScores = {};
    if (classId) {
      const aggregated = await aggregateAssessmentMarks(
        schoolId, classId,
        termNumber ? Number(termNumber) : null,
        academicYearId || null,
        studentId || null,
      );
      if (Object.keys(aggregated).length > 0) {
        finalScores = computeFinalScores(aggregated, {}, assessmentWeights, gradingSchema);
      }
    }

    // Resolve subject display names for every subjectId referenced
    const allSubjectIds = new Set();
    for (const report of Object.values(finalScores)) {
      for (const sub of Object.keys(report.subjects || {})) allSubjectIds.add(sub);
    }
    const subjectDocs = allSubjectIds.size
      ? await tenantModel('subjects', tenantContext(req))
          .find({ schoolId, id: { $in: [...allSubjectIds] } }).select('id name').lean()
      : [];
    const subjectNameMap = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));

    const _flattenSubjects = (subjectsObj) => Object.entries(subjectsObj || {}).map(([subjectId, data]) => ({
      subjectId,
      subject:   subjectNameMap[subjectId] ?? subjectId,
      avgPct:    data.finalScore ?? null,
      grade:     data.grade ?? null,
      examCount: Object.keys(data.breakdown || {}).length,
    }));

    // Only the subjects this caller teaches (null = management, unrestricted).
    const taught = await taughtSubjectIds(req, classId);
    const students = Object.values(finalScores).map(r => ({
      studentId: r.studentId,
      classId,
      subjects:  _flattenSubjects(r.subjects).filter(x => !taught || taught.has(x.subjectId)),
    }));

    // Attach config so frontend knows weights, types, and grade scale used
    const result = {
      config: {
        weights:        Object.fromEntries(assessmentWeights.map(w => [w.assessmentType, w.weight])),
        customTypes,
        instances:      config.instances || DEFAULT_INSTANCES,
        gradeScale:     defaultScale ? { id: defaultScale.id, name: defaultScale.name, bands: defaultScale.bands } : null,
      },
      students,
    };

    // If single student, unwrap for convenience
    if (studentId) {
      return _ok(res, {
        ...result,
        student: students.find(s => s.studentId === studentId) || { studentId, classId: classId || null, subjects: [] },
      });
    }

    return _ok(res, result);
  } catch (err) {
    console.error('[assessment/report GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ANALYTICS  —  GET /api/assessment/analytics
   (2026-09 — replaces the Reports page's Academic tab, which called
   GET /marks/summary with no classId and always got rejected — see
   CHANGELOG.md. That endpoint's shape — one class's per-student grid —
   was never the right one for this anyway; this is school-wide,
   subject-grouped, and role-scoped from the start.)

   Whole-school (or whole-class, if classId given) average-per-subject,
   with an optional comparison against the previous term or the same
   term last year. Source: assessment_marks (the Continuous Assessment
   module — CA/HW/MT/ET-style marks — NOT the separate formal Exams
   module's exam_results, a deliberate choice for this view).

   Visibility: a management-tier role (see scopeEngine.js) sees the
   whole school; anyone else sees only the classes they hold a
   teaching_assignments record for (`scope: 'assigned'` in the
   response — the client uses this to label the view correctly rather
   than implying "whole school" to someone who isn't seeing it).
   Passing a classId outside that scope is rejected the same way every
   other scoped module already handles it (ScopeEngine.applyToFilter).

   Query params:
     classId          — optional, narrows to one class (still subject
                         to scope above)
     subjectId         — optional, narrows to one subject
     academicYearId, termNumber — the "current" period; both default to
                         the live-resolved current period when omitted
     compareTo         — 'previousTerm' (default) | 'previousYear' | 'none'
   ══════════════════════════════════════════════════════════════ */

/* Given the school's academic_years (sorted by startDate) and a
   {year, termNumber} anchor, resolves the comparison period:
     'previousTerm' — termNumber-1 in the same year; the same year's
                       last term is used when the anchor is term 1... i.e.
                       falls back to the previous YEAR's last term.
     'previousYear' — the previous year's SAME termNumber (null if that
                       year doesn't have that many terms).
   Returns null when there is no earlier period to compare against
   (e.g. the school's very first recorded year/term). */
function _resolvePreviousPeriod(sortedYears, year, termNumber, mode) {
  if (!year || !termNumber || mode === 'none') return null;
  const yearIdx = sortedYears.findIndex(y => (y.id ?? String(y._id)) === (year.id ?? String(year._id)));

  if (mode === 'previousYear') {
    const prevYear = yearIdx > 0 ? sortedYears[yearIdx - 1] : null;
    if (!prevYear) return null;
    const terms = Array.isArray(prevYear.terms) ? prevYear.terms : [];
    if (termNumber > terms.length) return null; // that year didn't run this many terms
    return { year: prevYear, termNumber };
  }

  // 'previousTerm' (default)
  if (termNumber > 1) return { year, termNumber: termNumber - 1 };
  const prevYear = yearIdx > 0 ? sortedYears[yearIdx - 1] : null;
  if (!prevYear) return null;
  const terms = Array.isArray(prevYear.terms) ? prevYear.terms : [];
  if (terms.length === 0) return null;
  return { year: prevYear, termNumber: terms.length };
}

function _periodLabel(p) {
  if (!p) return null;
  const yearId = p.year.id ?? String(p.year._id);
  return { academicYearId: yearId, academicYearName: p.year.name ?? yearId, termNumber: p.termNumber };
}

/* One aggregation, faceted into per-subject rows and a school/class-wide
   overall — avoids a second round trip for the "overall" KPI row. */
// Score bands for the distribution histogram — a $bucket boundary is the
// band's lower bound, inclusive; 101 as the final boundary is what makes a
// perfect 100 fall into the 90–100 band rather than being dropped by
// $bucket's exclusive-upper-bound-of-last-explicit-boundary behavior.
const _DISTRIBUTION_BOUNDARIES = [0, 40, 50, 60, 70, 80, 90, 101];
const _DISTRIBUTION_LABELS     = ['0–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–100'];

async function _aggregateAnalyticsPeriod(Marks, baseFilter, academicYearId, termNumber, passMark) {
  if (!academicYearId || !termNumber) return { bySubject: [], byClass: [], distribution: [], overall: null };
  const filter = { ...baseFilter, ..._yearFilterPart(academicYearId), termNumber };
  const _byDimension = (field) => ([
    { $group: {
        _id: `$${field}`,
        avgPct:    { $avg: '$rawScore' },
        count:     { $sum: 1 },
        passCount: { $sum: { $cond: [{ $gte: ['$rawScore', passMark] }, 1, 0] } },
    }},
    { $project: {
        [field]:   '$_id', _id: 0,
        avgPct:    { $round: ['$avgPct', 1] },
        count:     1,
        passRate:  { $round: [{ $multiply: [{ $divide: ['$passCount', '$count'] }, 100] }, 1] },
    }},
  ]);
  const [result] = await Marks.aggregate([
    { $match: filter },
    { $facet: {
        bySubject: _byDimension('subjectId'),
        byClass:   _byDimension('classId'),
        distribution: [
          { $bucket: { groupBy: '$rawScore', boundaries: _DISTRIBUTION_BOUNDARIES, output: { count: { $sum: 1 } } } },
        ],
        overall: [
          { $group: {
              _id: null,
              avgPct:    { $avg: '$rawScore' },
              count:     { $sum: 1 },
              passCount: { $sum: { $cond: [{ $gte: ['$rawScore', passMark] }, 1, 0] } },
              minScore:  { $min: '$rawScore' },
              maxScore:  { $max: '$rawScore' },
              // $stdDevPop (not $percentile — version-dependent, MongoDB 7.0+,
              // unconfirmed here) — long-standard since MongoDB 3.2. Median
              // needs the raw scores regardless, so it's computed in JS below
              // from this same push rather than a second query.
              stdDev:    { $stdDevPop: '$rawScore' },
              scores:    { $push: '$rawScore' },
          }},
          { $project: {
              _id: 0, count: 1, minScore: 1, maxScore: 1, scores: 1,
              avgPct:    { $round: ['$avgPct', 1] },
              passRate:  { $round: [{ $multiply: [{ $divide: ['$passCount', '$count'] }, 100] }, 1] },
              stdDev:    { $round: ['$stdDev', 1] },
          }},
        ],
    }},
  ]);

  const overallRaw = result?.overall?.[0] ?? null;
  let overall = null;
  if (overallRaw) {
    const { scores = [], ...rest } = overallRaw;
    const sorted = [...scores].sort((a, b) => a - b);
    const mid    = sorted.length ? Math.floor((sorted.length - 1) / 2) : null;
    const median = sorted.length === 0 ? null
      : sorted.length % 2 === 1 ? sorted[mid]
      : Math.round(((sorted[mid] + sorted[mid + 1]) / 2) * 10) / 10;
    overall = { ...rest, median };
  }

  const distribution = (result?.distribution ?? [])
    .map(b => ({ band: _DISTRIBUTION_LABELS[_DISTRIBUTION_BOUNDARIES.indexOf(b._id)] ?? String(b._id), count: b.count }))
    .sort((a, b) => _DISTRIBUTION_LABELS.indexOf(a.band) - _DISTRIBUTION_LABELS.indexOf(b.band));

  return { bySubject: result?.bySubject ?? [], byClass: result?.byClass ?? [], distribution, overall };
}

router.get('/analytics', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    const { classId: qClassId, subjectId, academicYearId: qYearId, termNumber: qTermNumber } = req.query;
    const compareTo = ['previousTerm', 'previousYear', 'none'].includes(req.query.compareTo)
      ? req.query.compareTo : 'previousTerm';

    const [years, academicCfg] = await Promise.all([
      tenantModel('academic_years', ctx).find({ schoolId }).sort({ startDate: 1 }).lean(),
      tenantModel('academic_config', ctx).findOne({ schoolId }).select('passMark').lean(),
    ]);
    const passMark = academicCfg?.passMark ?? 40;

    let currentYear, currentTermNumber;
    if (qYearId) {
      currentYear = years.find(y => (y.id ?? String(y._id)) === qYearId);
      if (!currentYear) return E.badRequest(res, `academicYearId "${qYearId}" does not match any academic year for this school`);
      currentTermNumber = qTermNumber ? Number(qTermNumber) : resolveCurrentPeriod(years).termNumber;
    } else {
      const current = resolveCurrentPeriod(years);
      currentYear = current.year;
      currentTermNumber = qTermNumber ? Number(qTermNumber) : current.termNumber;
    }

    // A brand-new school with no academic years configured yet — same
    // "don't error, just return an empty picture" treatment
    // resolveAcademicPeriod() gives every other caller of this pattern.
    if (!currentYear || !currentTermNumber) {
      return _ok(res, {
        scope: ScopeEngine.isUnrestricted(req, 'assessment') ? 'whole_school' : 'assigned',
        currentPeriod: null, previousPeriod: null, passMark,
        overall: null, distribution: [], subjects: [], classes: [], availableClasses: [],
      });
    }

    const currentYearId = currentYear.id ?? String(currentYear._id);
    const previous = _resolvePreviousPeriod(years, currentYear, currentTermNumber, compareTo);

    /* Base filter — classId scoping happens BEFORE ScopeEngine.applyToFilter
       so an explicitly-requested classId outside the caller's scope is
       rejected (replaced with an impossible match), not silently widened. */
    const baseFilter = { schoolId, isPublished: true };
    if (qClassId) baseFilter.classId = qClassId;
    ScopeEngine.applyToFilter(req, 'assessment', baseFilter);
    if (subjectId) baseFilter.subjectId = subjectId;
    // Analytics totals are built only from the subjects this caller teaches.
    await restrictToTaught(req, baseFilter);

    const Marks = tenantModel('assessment_marks', ctx);
    const [currentAgg, previousAgg] = await Promise.all([
      _aggregateAnalyticsPeriod(Marks, baseFilter, currentYearId, currentTermNumber, passMark),
      previous ? _aggregateAnalyticsPeriod(Marks, baseFilter, previous.year.id ?? String(previous.year._id), previous.termNumber, passMark) : Promise.resolve({ bySubject: [], byClass: [], distribution: [], overall: null }),
    ]);

    // Resolve subject display names for everything either period touched
    const allSubjectIds = new Set([...currentAgg.bySubject.map(r => r.subjectId), ...previousAgg.bySubject.map(r => r.subjectId)]);
    const subjectDocs = allSubjectIds.size
      ? await tenantModel('subjects', ctx).find({ schoolId, id: { $in: [...allSubjectIds] } }).select('id name').lean()
      : [];
    const subjectNameMap = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));
    const prevBySubject = Object.fromEntries(previousAgg.bySubject.map(r => [r.subjectId, r]));

    const subjects = currentAgg.bySubject
      .map(cur => {
        const prev = prevBySubject[cur.subjectId] ?? null;
        return {
          subjectId: cur.subjectId,
          subject:   subjectNameMap[cur.subjectId] ?? cur.subjectId,
          current:   { avgPct: cur.avgPct, count: cur.count, passRate: cur.passRate },
          previous:  prev ? { avgPct: prev.avgPct, count: prev.count, passRate: prev.passRate } : null,
          delta:     prev ? Math.round((cur.avgPct - prev.avgPct) * 10) / 10 : null,
        };
      })
      .sort((a, b) => a.current.avgPct - b.current.avgPct); // weakest subject first

    // Performance by class — same current-vs-previous shape as subjects.
    // Resolved independently of the filter-dropdown's classDocs below
    // (a different, picker-specific scope) so a class can never go
    // unnamed just because it fell outside that scope's own resolution.
    const allClassIds  = new Set([...currentAgg.byClass.map(r => r.classId), ...previousAgg.byClass.map(r => r.classId)]);
    const classNameDocs = allClassIds.size
      ? await tenantModel('classes', ctx).find({ schoolId, id: { $in: [...allClassIds] } }).select('id name').lean()
      : [];
    const classNameMap = Object.fromEntries(classNameDocs.map(c => [c.id, c.name]));
    const prevByClass  = Object.fromEntries(previousAgg.byClass.map(r => [r.classId, r]));

    const classes = currentAgg.byClass
      .map(cur => {
        const prev = prevByClass[cur.classId] ?? null;
        return {
          classId:   cur.classId,
          className: classNameMap[cur.classId] ?? cur.classId,
          current:   { avgPct: cur.avgPct, count: cur.count, passRate: cur.passRate },
          previous:  prev ? { avgPct: prev.avgPct, count: prev.count, passRate: prev.passRate } : null,
          delta:     prev ? Math.round((cur.avgPct - prev.avgPct) * 10) / 10 : null,
        };
      })
      .sort((a, b) => a.current.avgPct - b.current.avgPct); // weakest class first

    // Classes available to filter by — every class in the school for an
    // unrestricted (leadership) caller, or only the caller's assigned
    // classes otherwise. Names resolved so the client never needs a
    // second "my classes" call just to populate this dropdown.
    // resolveClassPickerScope() folds any stream-only assignment (a
    // compulsory subject taught per-stream — see teaching-assignments.js)
    // into its parent class before scoping `classes` itself, which — unlike
    // `assessment` above — has no streamId field of its own to match a
    // stream-scoped grant against (see scopeEngine.js's MODULE_SCOPE
    // comment on `classes`); without this, a teacher whose only assignments
    // were stream-scoped got an empty availableClasses list here despite
    // real, valid assignments — the same bug classes.js's own GET / had.
    // Uses a request-local scope, restored right after, since scopeMiddleware
    // caches req.scope per userId::schoolId for other routes to read as-is.
    const originalScope = req.scope;
    req.scope = await ScopeEngine.resolveClassPickerScope(req);
    const classesFilter = ScopeEngine.applyToFilter(req, 'classes', { schoolId });
    req.scope = originalScope;
    const classDocs = await tenantModel('classes', ctx).find(classesFilter).select('id name').lean();

    return _ok(res, {
      scope:            ScopeEngine.isUnrestricted(req, 'assessment') ? 'whole_school' : 'assigned',
      currentPeriod:    _periodLabel({ year: currentYear, termNumber: currentTermNumber }),
      previousPeriod:   _periodLabel(previous),
      passMark,
      overall:          currentAgg.overall,
      distribution:     currentAgg.distribution,
      subjects,
      classes,
      availableClasses: classDocs.map(c => ({ id: c.id ?? String(c._id), name: c.name })),
    });
  } catch (err) {
    console.error('[assessment/analytics GET]', err);
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
router.get('/reminders', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
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
    const schedFilter = { schoolId, ..._yearFilterPart(academicYearId) };

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

router.post('/reminders/notify', authMiddleware, PLAN, MODGATE, rbac('assessment', 'update'), async (req, res) => {
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
      ..._yearFilterPart(academicYearId),
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
router.get('/marks/summary', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId, termNumber, academicYearId, streamId } = req.query;

    if (!classId) return _err(res, 'classId is required');

    // Data scope — this route had no check at all before; any grades:read
    // holder could pull the completion grid for any class in the school.
    // streamId is optional (this route predates any client passing one —
    // confirmed unused today, client.js's marksSummary() has no caller) but
    // accepted so a stream-only-scoped teacher can narrow to their own
    // stream instead of being denied outright, same as GET /report's
    // studentStreamId handling just above.
    if (!ScopeEngine.isClassInScope(req, 'assessment', classId, streamId)) {
      return _err(res, 'This class is not in your assigned scope.', 403);
    }

    const filter = { schoolId, classId, ..._yearFilterPart(academicYearId) };
    if (subjectId)      filter.subjectId      = subjectId;
    if (termNumber)     filter.termNumber     = Number(termNumber);
    if (streamId)       filter.streamId       = streamId;

    // classId is required (enforced above) — bounded to one class, safe ceiling
    await restrictToTaught(req, filter);
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
