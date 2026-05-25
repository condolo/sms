/* ============================================================
   Msingi — /api/subject-rules
   Min / max subject count rules per section or class pattern.
   Configured by the timetabler — analogous to the bell schedule.

   Rule resolution order (most specific wins):
     1. classPattern match (regex on classId)  e.g. "f[34]"  → Form 3/4
     2. section match                           e.g. "alevel"
     3. fallback: no rule → warnings suppressed

   Used by: Subjects module (enrollment warnings), Timetable (guard).
   ============================================================ */
'use strict';

const express        = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();

/* ── GET /api/subject-rules — list all rules for this school ──── */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const rules = await _model('subject_rules')
      .find({ schoolId })
      .sort({ section: 1, classPattern: 1 })
      .lean();
    return ok(res, rules);
  } catch (err) {
    console.error('[subject-rules GET /]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/subject-rules/:id ───────────────────────────────── */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const rule = await _model('subject_rules')
      .findOne({ id: req.params.id, schoolId })
      .lean();
    if (!rule) return E.notFound(res, 'Subject rule not found');
    return ok(res, rule);
  } catch (err) {
    console.error('[subject-rules GET /:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/subject-rules — create a new rule ──────────────
   Body: { section?, classPattern?, minSubjects, maxSubjects, notes? }
   At least one of section or classPattern is required. */
router.post('/', authMiddleware, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { section, classPattern, minSubjects, maxSubjects, notes } = req.body;

    if (!section && !classPattern) {
      return E.badRequest(res, 'section or classPattern required');
    }
    if (typeof minSubjects !== 'number' || typeof maxSubjects !== 'number') {
      return E.badRequest(res, 'minSubjects and maxSubjects must be numbers');
    }
    if (minSubjects < 1 || maxSubjects < minSubjects) {
      return E.badRequest(res, 'maxSubjects must be >= minSubjects >= 1');
    }

    /* Uniqueness: one rule per section, one per classPattern */
    if (section) {
      const dup = await _model('subject_rules').findOne({ schoolId, section }).lean();
      if (dup) return E.conflict(res, `A rule for section '${section}' already exists`);
    }
    if (classPattern) {
      const dup = await _model('subject_rules').findOne({ schoolId, classPattern }).lean();
      if (dup) return E.conflict(res, `A rule for classPattern '${classPattern}' already exists`);
    }

    const doc = await _model('subject_rules').create({
      id: uuidv4(),
      schoolId,
      section:      section      ?? null,
      classPattern: classPattern ?? null,
      minSubjects,
      maxSubjects,
      notes:        notes ?? '',
      createdBy:    userId,
      updatedBy:    userId,
    });
    return created(res, doc.toObject());
  } catch (err) {
    console.error('[subject-rules POST /]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/subject-rules/:id — update ─────────────────────── */
router.put('/:id', authMiddleware, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { section, classPattern, minSubjects, maxSubjects, notes } = req.body;

    if (typeof minSubjects !== 'undefined' && typeof maxSubjects !== 'undefined') {
      if (minSubjects < 1 || maxSubjects < minSubjects) {
        return E.badRequest(res, 'maxSubjects must be >= minSubjects >= 1');
      }
    }

    const update = { updatedBy: userId };
    if (typeof section       !== 'undefined') update.section       = section;
    if (typeof classPattern  !== 'undefined') update.classPattern  = classPattern;
    if (typeof minSubjects   !== 'undefined') update.minSubjects   = minSubjects;
    if (typeof maxSubjects   !== 'undefined') update.maxSubjects   = maxSubjects;
    if (typeof notes         !== 'undefined') update.notes         = notes;

    const doc = await _model('subject_rules').findOneAndUpdate(
      { id: req.params.id, schoolId },
      update,
      { new: true },
    );
    if (!doc) return E.notFound(res, 'Subject rule not found');
    return ok(res, doc.toObject());
  } catch (err) {
    console.error('[subject-rules PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/subject-rules/:id ───────────────────────────── */
router.delete('/:id', authMiddleware, rbac('timetable', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('subject_rules').findOneAndDelete({
      id: req.params.id,
      schoolId,
    });
    if (!doc) return E.notFound(res, 'Subject rule not found');
    return ok(res, { message: 'Subject rule deleted' });
  } catch (err) {
    console.error('[subject-rules DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
