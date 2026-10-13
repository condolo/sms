/* ============================================================
   Msingi — /api/indicator-marks
   Competency-band indicator scores (Kindergarten / early-childhood),
   parallel to assessment.js's /marks for ordinary numeric CA/HW/MT/ET
   marks — a different shape (many indicators per subject, not one
   number), so not forced into assessment_marks.

   Scope/RBAC mirrors assessment.js's /marks exactly: canWriteSubject/
   isElective (subject-teacher scoping, unconditional), year-archival
   guard. Wired to mark_submissions review-state (2026-10) — a teacher
   can no longer keep editing indicator marks after "submitting" them,
   the same guard the numeric Markbook already enforces, reusing the
   SAME mark_submissions collection/state-machine via the reserved
   KG_INDICATORS_TYPE sentinel (indicator marks have no real
   assessmentType/instance of their own) rather than a second moderation
   system. Deliberately NOT wired to assessment_schedule locking — that
   is a separate, unrelated concern (the exam office's whole-window
   lock) nobody has asked for here yet.

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
   class in the same school. */
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
const { canWriteSubject, unassignedPairs } = require('../utils/subject-scope');
const { isElective, electiveMarkProblem }  = require('../utils/elective-scope');
const { isYearArchived } = require('../utils/archival');
const ScopeEngine         = require('../utils/scopeEngine');
const { restrictToTaught } = require('../utils/teaching-scope');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const { KG_INDICATORS_TYPE } = require('./mark-submissions');
const { resolveRcTemplate } = require('../utils/rc-template-scale');

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
  score:          z.number().min(0),
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
    const maxScoreByIndicator = {};
    const seenTemplateIds = new Set();
    for (const classId of classIds) {
      const t = resolvedByClass[classId];
      if (!t || seenTemplateIds.has(t.id)) continue;
      seenTemplateIds.add(t.id);
      for (const subj of t.subjects ?? []) {
        for (const ind of subj.indicators ?? []) {
          maxScoreByIndicator[`${t.id}::${ind.id}`] = ind.maxScore ?? 10;
        }
      }
    }
    for (const d of marks) {
      const template = resolvedByClass[d.classId];
      if (!template || template.id !== d.templateId) {
        return E.badRequest(res, `Template "${d.templateId}" is not the assigned Kindergarten template for class "${d.classId}".`);
      }
      const maxScore = maxScoreByIndicator[`${d.templateId}::${d.indicatorId}`];
      if (maxScore === undefined) {
        return E.badRequest(res, `Unknown indicator "${d.indicatorId}" for this template.`);
      }
      if (d.score > maxScore) {
        return E.badRequest(res, `Score ${d.score} exceeds this indicator's maximum of ${maxScore}.`);
      }
    }

    // Guard: reject if any target mark is locked (post-approval lock) —
    // same mechanism assessment.js's /marks/bulk uses, mark-submissions.js's
    // own /lock route sets isLocked on indicator_marks too whenever the
    // submission's assessmentType is the KG sentinel below.
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
      return E.forbidden(res, 'This mark is locked — it has been approved and locked for this term. Contact an administrator to unlock it.');
    }

    // Guard: reject if the relevant mark_submissions record is under
    // review (submitted or already approved) — closes the exact gap this
    // file's own header comment flagged: a teacher could submit a
    // subject's indicator marks for review and keep silently editing them.
    // Same KG_INDICATORS_TYPE sentinel mark-submissions.js uses to route
    // its own lock/unlock propagation at indicator_marks instead of
    // assessment_marks — not a second moderation system, the same one.
    const subOr = [...new Set(marks.map(d => `${d.classId}::${d.subjectId}::${d.termNumber}::${streamByStudent[d.studentId] ?? ''}::${d.academicYearId || ''}`))]
      .map(k => {
        const [classId, subjectId, termNumber, sid, academicYearId] = k.split('::');
        return {
          classId, subjectId, termNumber: Number(termNumber),
          streamId: { $in: [sid || null, null] },
          ..._yearFilterPart(academicYearId || null),
        };
      });
    const underReview = await tenantModel('mark_submissions', tenantContext(req)).findOne({
      schoolId,
      status: { $in: ['submitted', 'approved'] },
      assessmentType: KG_INDICATORS_TYPE,
      $or: subOr,
    }).lean();
    if (underReview) {
      return E.forbidden(res, `These marks are ${underReview.status} for review and cannot be edited — recall the submission first.`);
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

module.exports = router;
