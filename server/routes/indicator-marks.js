/* ============================================================
   Msingi — /api/indicator-marks
   Competency-band indicator scores (Kindergarten / early-childhood),
   parallel to assessment.js's /marks for ordinary numeric CA/HW/MT/ET
   marks — a different shape (many indicators per subject, not one
   number), so not forced into assessment_marks.

   Scope/RBAC mirrors assessment.js's /marks exactly: canWriteSubject/
   isElective (subject-teacher scoping, unconditional), year-archival
   guard, isLocked. Submit-for-review was wired here on 2026-10-13 and
   REMOVED the same day as part of a deliberate workflow redesign — a
   teacher has full autonomy over indicator marks until the report card
   is actually published; isLocked is now set automatically AT PUBLISH
   time (report-cards.js's /kg/publish), reusing the KG_INDICATORS_TYPE
   sentinel on the mark_submissions doc it creates directly in 'locked'
   state, so the pre-existing unlock-request/approve/24h-auto-relock
   machinery (mark-submissions.js) still works for a rare post-publish
   correction — see that file's own header. Deliberately NOT wired to
   assessment_schedule locking — that is a separate, unrelated concern
   (the exam office's whole-window lock) nobody has asked for here.

   There is no "classType: kindergarten" field anywhere in this
   codebase, by design — see rc-template-scale.js's header comment.
   This route (and every other KG-aware route) treats "does this class
   use indicator entry?" as answered SOLELY by resolveRcTemplate's
   explicit-classIds-or-section-default resolution, confirmed by a
   full-codebase audit (2026-10-13). POST /bulk now RE-VERIFIES the
   submitted templateId against resolveRcTemplate(schoolId, classId)
   rather than trusting any templateId that merely exists somewhere in
   the school — closes a real gap the audit found: a client could
   previously submit marks against a template belonging to a different
   class in the same school.

   Indicator TEXT moved OUT of the template (2026-10-19, direct
   request): "whoever is setting the template is like an admin, he
   doesn't know all the indicators per subject, and these indicators
   vary depending on what content was set, so they can't be static."
   The template (rc_templates) still decides WHICH subjects use
   indicator-based entry and the performance bands/scoring structure —
   that's genuinely school-wide, admin-owned config, same as
   assessment_config's weights/types for the numeric Markbook. But the
   indicators THEMSELVES are now owned by the subject teacher, scoped
   per {classId, subjectId, termNumber[, academicYearId]} in the new
   indicator_definitions collection below (GET/POST/PUT/DELETE
   /definitions) — managed directly from the Markbook, not Settings,
   and free to differ term to term as the actual content taught
   changes. POST /bulk's score-vs-maxScore validation now reads this
   collection instead of template.subjects[].indicators. */
'use strict';

const express  = require('express');
const { z }    = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }           = require('../utils/response');
const { canWriteSubject, unassignedPairs, isManagement } = require('../utils/subject-scope');
const { isElective, isInCurriculum, electiveMarkProblem, pairsNotInCurriculum, canTeachElective } = require('../utils/elective-scope');
const { isYearArchived } = require('../utils/archival');
const ScopeEngine         = require('../utils/scopeEngine');
const { restrictToTaught } = require('../utils/teaching-scope');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const { resolveRcTemplate, effectiveBandsForSubjectId, isBandOnlySubject } = require('../utils/rc-template-scale');

const router  = express.Router();
const PLAN    = planGate('grades');
const MODGATE = moduleGate('grades');

/* Mirrors academic-calc.js's _yearFilterPart exactly — a requested
   academicYearId must also match a record stored with no year at all,
   same backward-compat posture used everywhere else marks are read. */
function _yearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : {};
}

const IndicatorMarkSchema = z.object({
  studentId:      z.string().min(1),
  classId:        z.string().min(1),
  subjectId:      z.string().min(1),
  templateId:     z.string().min(1),
  indicatorId:    z.string().min(1),
  bandId:         z.string().nullish(),
  // Required for ordinary numeric entry; a band-only subject sends no
  // score at all (the teacher only picks a band) — the server resolves
  // it from the picked band's own points below, never trusting a
  // client-supplied number for one of these marks even if it sent one.
  score:          z.number().min(0).optional(),
  termNumber:     z.number().int().min(1).max(3),
  academicYearId: z.string().nullish(),
  isPublished:    z.boolean().default(true),
});

const BulkIndicatorMarkSchema = z.object({
  marks: z.array(IndicatorMarkSchema).min(1).max(500),
});

/**
 * GET /api/indicator-marks
 * List indicator marks. Query: studentId, classId, subjectId, templateId, termNumber, academicYearId.
 */
router.get('/', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.studentId)  filter.studentId  = req.query.studentId;
    if (req.query.classId)    filter.classId    = req.query.classId;
    if (req.query.subjectId)  filter.subjectId  = req.query.subjectId;
    if (req.query.templateId) filter.templateId = req.query.templateId;
    if (req.query.termNumber) filter.termNumber = Number(req.query.termNumber);
    Object.assign(filter, _yearFilterPart(req.query.academicYearId));

    // Same data-scope posture as assessment.js's GET /marks — a plain
    // grades:read holder is narrowed to their own class/stream scope and
    // the subjects they actually teach, not every mark in the school.
    ScopeEngine.applyToFilter(req, 'assessment', filter);
    await restrictToTaught(req, filter);

    const docs = await tenantModel('indicator_marks', tenantContext(req)).find(filter)
      .sort({ subjectId: 1, indicatorId: 1 }).limit(5000).lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[indicator-marks GET]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/indicator-marks/bulk
 * Upsert many indicator marks at once — the Markbook's per-student save
 * (one subject's full set of indicators for one student in a single
 * request). Natural key: studentId+subjectId+indicatorId+termNumber
 * (+academicYearId, _yearFilterPart-tolerant like everywhere else).
 */
router.post('/bulk', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const parsed = BulkIndicatorMarkSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }
    const { marks } = parsed.data;

    // Guard: reject writes to archived academic years — same check every
    // other mark-writing route in this codebase uses.
    const yearIds = [...new Set(marks.map(d => d.academicYearId).filter(Boolean))];
    for (const yId of yearIds) {
      if (await isYearArchived(schoolId, yId)) {
        return E.badRequest(res, 'This academic year is locked — marks cannot be added or modified.');
      }
    }

    // Guard: subject-teacher scoping (RC6) — unconditional, same as
    // assessment.js's /marks/bulk. Resolve each student's stream first
    // (a teacher scoped to one stream of a class must not write marks
    // for a different stream's student).
    const studentIds = [...new Set(marks.map(d => d.studentId))];
    const studentDocs = await tenantModel('students', tenantContext(req))
      .find({ schoolId, id: { $in: studentIds } }).select('id streamId').lean();
    const streamByStudent = Object.fromEntries(studentDocs.map(s => [s.id, s.streamId ?? null]));

    const distinctPairs = [...new Map(
      marks.map(d => {
        const streamId = streamByStudent[d.studentId] ?? null;
        return [`${d.classId}::${d.subjectId}::${streamId}`, { classId: d.classId, subjectId: d.subjectId, streamId }];
      })
    ).values()];
    // Guard: curriculum integrity — same as assessment.js's /marks/bulk
    // (same bug class, reported directly against the ordinary Markbook):
    // every {classId, subjectId} pair must actually be in that class's
    // curriculum, for every role including management.
    const uncurriculumPairs = await pairsNotInCurriculum(req, [...new Map(
      distinctPairs.map(p => [`${p.classId}::${p.subjectId}`, { classId: p.classId, subjectId: p.subjectId }])
    ).values()]);
    if (uncurriculumPairs.length > 0) {
      return E.badRequest(res, `Not part of this class's curriculum — add in Curriculum first: ${uncurriculumPairs.map(p => p.subjectId).join(', ')}`);
    }

    const electiveKeys = new Set();
    for (const p of distinctPairs) {
      if (await isElective(req, p.classId, p.subjectId)) electiveKeys.add(`${p.classId}::${p.subjectId}`);
    }
    const electiveProblem = await electiveMarkProblem(req, marks);
    if (electiveProblem) return E.forbidden(res, electiveProblem);
    const denied = await unassignedPairs(req, distinctPairs.filter(p => !electiveKeys.has(`${p.classId}::${p.subjectId}`)));
    if (denied.length > 0) {
      return E.forbidden(res, `You are not assigned to teach: ${denied.map(p => p.subjectId).join(', ')}`);
    }

    // Guard: the submitted templateId must be the template actually
    // ASSIGNED to this mark's class — resolved the exact same way the
    // Markbook's own "does this class use indicator entry?" check does
    // (rc-template-scale.js's resolveRcTemplate: explicit classIds, else
    // the class's section default). Previously this route only checked
    // that templateId existed SOMEWHERE in the school, not that it
    // belonged to the class being written for — subject-teacher scoping
    // above still gates WHO can write, but not which template a class's
    // marks get attributed to; a client could otherwise submit marks
    // against a template belonging to a different class in the same
    // school. Resolved once per distinct classId in the batch.
    const classIds = [...new Set(marks.map(d => d.classId))];
    const resolvedByClass = {};
    for (const classId of classIds) {
      resolvedByClass[classId] = await resolveRcTemplate(schoolId, classId);
    }

    // Validate every score against its OWN indicator's maxScore — not a
    // universal 10, confirmed per the schema's own header comment.
    // Indicator identity/maxScore now comes from indicator_definitions
    // (teacher-managed, per class+subject+term), not the template —
    // see this file's header, 2026-10-19.
    const defKeys = [...new Set(marks.map(d => `${d.classId}::${d.subjectId}::${d.termNumber}::${d.academicYearId || ''}`))];
    const maxScoreByIndicator = {};
    for (const key of defKeys) {
      const [classId, subjectId, termNumber, academicYearId] = key.split('::');
      const defs = await tenantModel('indicator_definitions', tenantContext(req)).find({
        schoolId, classId, subjectId, termNumber: Number(termNumber), ..._yearFilterPart(academicYearId || null),
      }).select('id maxScore').lean();
      for (const def of defs) maxScoreByIndicator[`${key}::${def.id}`] = def.maxScore ?? 10;
    }
    for (const d of marks) {
      const template = resolvedByClass[d.classId];
      if (!template || template.id !== d.templateId) {
        return E.badRequest(res, `Template "${d.templateId}" is not the assigned Kindergarten template for class "${d.classId}".`);
      }
      const key = `${d.classId}::${d.subjectId}::${d.termNumber}::${d.academicYearId || ''}`;
      const maxScore = maxScoreByIndicator[`${key}::${d.indicatorId}`];
      if (maxScore === undefined) {
        return E.badRequest(res, `Unknown indicator "${d.indicatorId}" — add it in the Markbook first.`);
      }
      // Band-only subject: no number is ever typed or trusted from the
      // client — resolve the mark's score server-side from the band's
      // own points, the moment the mark is saved, so every existing
      // reader downstream (kg-report.js, the PDF/portal renderers) keeps
      // reading a plain `score` number without needing to know where it
      // came from. The legacy per-indicator maxScore check below simply
      // doesn't apply here (the ceiling is the band set's own max, a
      // subject-wide constant kg-report.js already accounts for).
      if (isBandOnlySubject(template, d.subjectId)) {
        if (!d.bandId) return E.badRequest(res, 'A band must be selected for this indicator.');
        const bands = effectiveBandsForSubjectId(template, d.subjectId);
        const band = bands.find(b => b.id === d.bandId);
        if (!band) return E.badRequest(res, `Band "${d.bandId}" does not belong to this subject's performance bands.`);
        d.score = band.defaultScore;
        continue;
      }
      if (d.score == null) {
        return E.badRequest(res, 'score is required for this indicator.');
      }
      if (d.score > maxScore) {
        return E.badRequest(res, `Score ${d.score} exceeds this indicator's maximum of ${maxScore}.`);
      }
    }

    // Guard: reject if any target mark is locked (post-approval lock) —
    // same mechanism assessment.js's /marks/bulk uses. Submit-for-review
    // no longer blocks editing (2026-10-13 workflow redesign) — isLocked
    // is now set automatically AT PUBLISH time (report-cards.js's
    // /kg/publish), not by a review step; this is the only pre-publish
    // gate that still applies.
    const lockedSample = await tenantModel('indicator_marks', tenantContext(req)).findOne({
      schoolId,
      isLocked: true,
      $or: marks.map(d => ({
        studentId:      d.studentId,
        subjectId:      d.subjectId,
        indicatorId:    d.indicatorId,
        termNumber:     d.termNumber,
        academicYearId: d.academicYearId || null,
      })),
    }).lean();
    if (lockedSample) {
      return E.forbidden(res, 'This mark is locked — the report card for this term has been published. Ask an administrator to unlock it for a correction.');
    }

    const now = new Date().toISOString();
    const Marks = tenantModel('indicator_marks', tenantContext(req));
    const results = [];
    for (const d of marks) {
      const filter = {
        schoolId, studentId: d.studentId, subjectId: d.subjectId, indicatorId: d.indicatorId,
        termNumber: d.termNumber, ..._yearFilterPart(d.academicYearId || null),
      };
      const existing = await Marks.findOne(filter).lean();
      const streamId = streamByStudent[d.studentId] ?? null;
      if (existing) {
        await Marks.updateOne({ _id: existing._id }, {
          $set: {
            score: d.score, bandId: d.bandId ?? null, classId: d.classId, templateId: d.templateId,
            streamId, academicYearId: d.academicYearId || null, isPublished: d.isPublished,
            updatedAt: now, updatedBy: userId,
          },
        });
        results.push({ id: existing.id, action: 'updated' });
      } else {
        const doc = {
          id: uuidv4(), schoolId, studentId: d.studentId, classId: d.classId, streamId,
          subjectId: d.subjectId, templateId: d.templateId, indicatorId: d.indicatorId,
          bandId: d.bandId ?? null, score: d.score, termNumber: d.termNumber,
          academicYearId: d.academicYearId || null, isPublished: d.isPublished,
          createdAt: now, updatedAt: now, createdBy: userId, updatedBy: userId,
        };
        await Marks.create(doc);
        results.push({ id: doc.id, action: 'created' });
      }
    }

    return ok(res, { saved: results.length, results });
  } catch (err) {
    console.error('[indicator-marks POST/bulk]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   INDICATOR DEFINITIONS — /api/indicator-marks/definitions
   Teacher-managed, per {classId, subjectId, termNumber[, academicYearId]}
   — see this file's header, 2026-10-19. The template still gates WHICH
   subjects use indicator entry and the performance bands; this is the
   indicator TEXT itself.
   ══════════════════════════════════════════════════════════════ */

const IndicatorDefinitionSchema = z.object({
  classId:        z.string().min(1),
  subjectId:      z.string().min(1),
  termNumber:     z.number().int().min(1).max(3),
  academicYearId: z.string().nullish(),
  text:           z.string().min(1).max(400).trim(),
  maxScore:       z.number().min(1).max(1000).default(10),
  order:          z.number().int().min(0).optional(),
});

/** Whether the caller may manage (add/edit/delete) this class+subject's
 *  indicators — same rights as writing marks for it (canWriteSubject/
 *  isElective+canTeachElective), but NOT stream-scoped: indicators are
 *  class-wide, same scope the template's own subject assignment uses,
 *  so a teacher assigned to just one stream of a whole-class subject
 *  must still be able to manage it. Returns an error message, or null
 *  when allowed. */
async function _indicatorManageDenial(req, classId, subjectId) {
  if (!(await isInCurriculum(req, classId, subjectId))) {
    return 'This subject is not part of this class\'s curriculum — add it in Curriculum first.';
  }
  if (await isElective(req, classId, subjectId)) {
    if (!(await canTeachElective(req, classId, subjectId))) {
      return 'You are not assigned to teach this elective in this class.';
    }
    return null;
  }
  if (isManagement(req)) return null;
  const { schoolId, userId } = req.jwtUser;
  const doc = await tenantModel('teaching_assignments', tenantContext(req))
    .findOne({ schoolId, teacherId: userId, classId, subjectId }).select('id').lean();
  return doc ? null : 'You are not assigned to teach this subject in this class.';
}

/** Whether this class+subject+term's indicator marks are already
 *  locked (post-publish) — the structure feeding a frozen mark set
 *  must freeze too, same posture the numeric Markbook's assessment
 *  types have via schedule-entry locking. */
async function _indicatorsLocked(req, schoolId, classId, subjectId, termNumber, academicYearId) {
  const locked = await tenantModel('indicator_marks', tenantContext(req)).findOne({
    schoolId, classId, subjectId, termNumber, isLocked: true, ..._yearFilterPart(academicYearId || null),
  }).lean();
  return !!locked;
}

/**
 * GET /api/indicator-marks/definitions
 * List indicators for one class+subject+term — what the Markbook
 * renders and scores against.
 */
router.get('/definitions', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId, termNumber, academicYearId } = req.query;
    if (!classId || !subjectId || !termNumber) {
      return E.badRequest(res, 'classId, subjectId and termNumber are required');
    }
    const filter = { schoolId, classId, subjectId, termNumber: Number(termNumber), ..._yearFilterPart(academicYearId) };
    const docs = await tenantModel('indicator_definitions', tenantContext(req)).find(filter)
      .sort({ order: 1, createdAt: 1 }).limit(200).lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[indicator-marks GET/definitions]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/indicator-marks/definitions
 * Add one indicator for this class+subject+term.
 */
router.post('/definitions', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const parsed = IndicatorDefinitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }
    const d = parsed.data;

    if (d.academicYearId && await isYearArchived(schoolId, d.academicYearId)) {
      return E.badRequest(res, 'This academic year is locked — indicators cannot be added or modified.');
    }
    if (!(await isInCurriculum(req, d.classId, d.subjectId))) {
      return E.badRequest(res, 'This subject is not part of this class\'s curriculum — add it in Curriculum first.');
    }
    const denial = await _indicatorManageDenial(req, d.classId, d.subjectId);
    if (denial) return E.forbidden(res, denial);

    // The class must actually resolve to a competency template with this
    // subject assigned — indicators can't exist for a subject the admin
    // hasn't marked as indicator-based in Kindergarten Templates.
    const template = await resolveRcTemplate(schoolId, d.classId);
    if (!template || !(template.subjects ?? []).some(s => s.subjectId === d.subjectId)) {
      return E.badRequest(res, 'This class/subject is not assigned a Kindergarten/competency template — add it in Kindergarten Templates first.');
    }

    if (await _indicatorsLocked(req, schoolId, d.classId, d.subjectId, d.termNumber, d.academicYearId)) {
      return E.forbidden(res, 'Indicators are locked — the report card for this term has been published. Ask an administrator to unlock it for a correction.');
    }

    const existingCount = await tenantModel('indicator_definitions', tenantContext(req)).countDocuments({
      schoolId, classId: d.classId, subjectId: d.subjectId, termNumber: d.termNumber, ..._yearFilterPart(d.academicYearId || null),
    });

    const now = new Date().toISOString();
    const doc = {
      id: uuidv4(), schoolId, classId: d.classId, subjectId: d.subjectId,
      termNumber: d.termNumber, academicYearId: d.academicYearId || null,
      text: d.text, maxScore: d.maxScore, order: d.order ?? existingCount,
      createdAt: now, updatedAt: now, createdBy: userId, updatedBy: userId,
    };
    await tenantModel('indicator_definitions', tenantContext(req)).create(doc);
    return ok(res, doc, null, 201);
  } catch (err) {
    console.error('[indicator-marks POST/definitions]', err);
    return E.serverError(res);
  }
});

/**
 * PUT /api/indicator-marks/definitions/:id
 * Edit an indicator's text/maxScore/order.
 */
router.put('/definitions/:id', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const existing = await tenantModel('indicator_definitions', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Indicator not found');

    const denial = await _indicatorManageDenial(req, existing.classId, existing.subjectId);
    if (denial) return E.forbidden(res, denial);
    if (await _indicatorsLocked(req, schoolId, existing.classId, existing.subjectId, existing.termNumber, existing.academicYearId)) {
      return E.forbidden(res, 'Indicators are locked — the report card for this term has been published. Ask an administrator to unlock it for a correction.');
    }

    const BodySchema = z.object({
      text:     z.string().min(1).max(400).trim().optional(),
      maxScore: z.number().min(1).max(1000).optional(),
      order:    z.number().int().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }

    const doc = await tenantModel('indicator_definitions', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...parsed.data, updatedAt: new Date().toISOString(), updatedBy: userId } },
      { new: true },
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[indicator-marks PUT/definitions/:id]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/indicator-marks/definitions/:id
 * Rejected with 409 if any indicator_marks already score against it.
 */
router.delete('/definitions/:id', authMiddleware, PLAN, MODGATE, rbac('grades', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const existing = await tenantModel('indicator_definitions', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Indicator not found');

    const denial = await _indicatorManageDenial(req, existing.classId, existing.subjectId);
    if (denial) return E.forbidden(res, denial);
    if (await _indicatorsLocked(req, schoolId, existing.classId, existing.subjectId, existing.termNumber, existing.academicYearId)) {
      return E.forbidden(res, 'Indicators are locked — the report card for this term has been published. Ask an administrator to unlock it for a correction.');
    }

    const markCount = await tenantModel('indicator_marks', tenantContext(req)).countDocuments({ schoolId, indicatorId: req.params.id });
    if (markCount > 0) {
      return E.badRequest(res, `Cannot delete — ${markCount} student score${markCount === 1 ? '' : 's'} already recorded against this indicator. Remove those scores first.`);
    }

    await tenantModel('indicator_definitions', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[indicator-marks DELETE/definitions/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
