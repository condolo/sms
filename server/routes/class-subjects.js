/* ============================================================
   Msingi — /api/class-subjects
   Class curriculum registry: which subjects each class offers.

   Tier 2 of the 3-tier subject model:
     1. Subject catalog     (subjects)        ← school-wide list
     2. Class curriculum    (class_subjects)  ← which class offers what
     3. Student enrollment  (student_subjects) ← which student takes what

   Consumers: Subjects page (curriculum tab), Timetable (slot editor),
              Grade entry (subject filter), Student enrollment guard.
   ============================================================ */
'use strict';

const express        = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();

/* ── GET /api/class-subjects/counts ─────────────────────────────
   Returns { [classId]: subjectCount }
   Used by class cards and the class dropdown to show curriculum size. */
router.get('/counts', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const agg = await _model('class_subjects').aggregate([
      { $match: { schoolId, isActive: { $ne: false } } },
      { $group: { _id: '$classId', count: { $sum: 1 } } },
    ]);
    const map = {};
    for (const { _id, count } of agg) map[_id] = count;
    return ok(res, map);
  } catch (err) {
    console.error('[class-subjects GET /counts]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/class-subjects ─────────────────────────────────────
   ?classId=X   → curriculum for a class (includes full subject + dept details)
   ?subjectId=X → all classes that offer a given subject (includes class meta)
   One of the two query params is required. */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId } = req.query;

    if (!classId && !subjectId) {
      return E.badRequest(res, 'classId or subjectId query param required');
    }

    const filter = { schoolId, isActive: { $ne: false } };
    if (classId)   filter.classId   = classId;
    if (subjectId) filter.subjectId = subjectId;

    const docs = await _model('class_subjects')
      .find(filter)
      .sort({ createdAt: 1 })
      .lean();

    /* ── Populate subject + department when listing by class ── */
    if (classId && docs.length > 0) {
      const subjectIds = [...new Set(docs.map(d => d.subjectId))];
      const subjects   = await _model('subjects')
        .find({ schoolId, id: { $in: subjectIds } })
        .select('id name code shortName departmentId sections isCompulsory color order')
        .lean();

      const deptIds = [...new Set(subjects.map(s => s.departmentId).filter(Boolean))];
      const depts   = deptIds.length
        ? await _model('departments')
            .find({ schoolId, id: { $in: deptIds } })
            .select('id name code color')
            .lean()
        : [];

      const subMap  = Object.fromEntries(subjects.map(s => [s.id, s]));
      const deptMap = Object.fromEntries(depts.map(d => [d.id, d]));

      return ok(res, docs.map(d => {
        const subj = subMap[d.subjectId] ?? null;
        return {
          ...d,
          subject:    subj,
          department: subj ? (deptMap[subj.departmentId] ?? null) : null,
        };
      }));
    }

    /* ── Populate class meta when listing by subject ── */
    if (subjectId && docs.length > 0) {
      const classIds = [...new Set(docs.map(d => d.classId))];
      const classes  = classIds.length
        ? await _model('classes')
            .find({ schoolId, id: { $in: classIds } })
            .select('id name sectionKey order')
            .lean()
        : [];
      const clsMap = Object.fromEntries(classes.map(c => [c.id, c]));
      return ok(res, docs.map(d => ({ ...d, class: clsMap[d.classId] ?? null })));
    }

    return ok(res, docs);
  } catch (err) {
    console.error('[class-subjects GET /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/class-subjects — assign a single subject to a class ─
   Body: { classId, subjectId, isCompulsoryForClass? } */
router.post('/', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, isCompulsoryForClass = false } = req.body;

    if (!classId || !subjectId) {
      return E.badRequest(res, 'classId and subjectId required');
    }

    /* Validate both entities exist in this school */
    const [cls, subject] = await Promise.all([
      _model('classes').findOne({ schoolId, id: classId }).lean(),
      _model('subjects').findOne({ schoolId, id: subjectId, isActive: { $ne: false } }).lean(),
    ]);
    if (!cls)     return E.notFound(res, 'Class not found');
    if (!subject) return E.notFound(res, 'Subject not found or deactivated');

    /* Duplicate guard */
    const existing = await _model('class_subjects')
      .findOne({ schoolId, classId, subjectId })
      .lean();
    if (existing) return E.conflict(res, 'Subject is already in this class curriculum');

    const doc = await _model('class_subjects').create({
      id:                   uuidv4(),
      schoolId,
      classId,
      subjectId,
      isCompulsoryForClass: Boolean(isCompulsoryForClass),
      isActive:             true,
      createdBy:            userId,
      updatedBy:            userId,
    });
    return created(res, doc.toObject());
  } catch (err) {
    console.error('[class-subjects POST /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/class-subjects/bulk — assign many subjects to a class ─
   Body: { classId, subjects: [{ subjectId, isCompulsoryForClass }] }
   Idempotent: already-assigned subjects are skipped, not errored. */
router.post('/bulk', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjects } = req.body;

    if (!classId || !Array.isArray(subjects) || subjects.length === 0) {
      return E.badRequest(res, 'classId and subjects[] required');
    }

    const cls = await _model('classes').findOne({ schoolId, id: classId }).lean();
    if (!cls) return E.notFound(res, 'Class not found');

    const subjectIds = [...new Set(subjects.map(s => s.subjectId).filter(Boolean))];
    if (subjectIds.length === 0) return E.badRequest(res, 'No valid subjectIds provided');

    /* Validate all subject IDs exist and are active */
    const validSubjects = await _model('subjects')
      .find({ schoolId, id: { $in: subjectIds }, isActive: { $ne: false } })
      .select('id')
      .lean();
    const validIds = new Set(validSubjects.map(s => s.id));

    /* Already in curriculum — skip silently */
    const alreadyAssigned = await _model('class_subjects')
      .find({ schoolId, classId, subjectId: { $in: subjectIds } })
      .select('subjectId')
      .lean();
    const alreadyIds = new Set(alreadyAssigned.map(e => e.subjectId));

    const toInsert = subjects
      .filter(s => validIds.has(s.subjectId) && !alreadyIds.has(s.subjectId))
      .map(s => ({
        id:                   uuidv4(),
        schoolId,
        classId,
        subjectId:            s.subjectId,
        isCompulsoryForClass: Boolean(s.isCompulsoryForClass),
        isActive:             true,
        createdBy:            userId,
        updatedBy:            userId,
      }));

    if (toInsert.length > 0) await _model('class_subjects').insertMany(toInsert);

    return ok(res, {
      assigned: toInsert.length,
      skipped:  alreadyIds.size,
      invalid:  subjectIds.length - validIds.size,
      message: `Assigned ${toInsert.length} subject${toInsert.length !== 1 ? 's' : ''} to ${cls.name}`
        + (alreadyIds.size ? `, ${alreadyIds.size} already in curriculum` : ''),
    });
  } catch (err) {
    console.error('[class-subjects POST /bulk]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/class-subjects/:id — update compulsory flag ────────
   Body: { isCompulsoryForClass: true|false } */
router.put('/:id', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { isCompulsoryForClass } = req.body;

    if (typeof isCompulsoryForClass === 'undefined') {
      return E.badRequest(res, 'isCompulsoryForClass required');
    }

    const doc = await _model('class_subjects').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { isCompulsoryForClass: Boolean(isCompulsoryForClass), updatedBy: userId },
      { new: true },
    );
    if (!doc) return E.notFound(res, 'Class-subject link not found');
    return ok(res, doc.toObject());
  } catch (err) {
    console.error('[class-subjects PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/class-subjects/:id — remove subject from curriculum ─
   Blocked if students in this class are still enrolled in the subject. */
router.delete('/:id', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const link = await _model('class_subjects')
      .findOne({ id: req.params.id, schoolId })
      .lean();
    if (!link) return E.notFound(res, 'Class-subject link not found');

    /* Guard: refuse if students are still enrolled */
    const enrolledCount = await _model('student_subjects').countDocuments({
      schoolId,
      classId:   link.classId,
      subjectId: link.subjectId,
    });
    if (enrolledCount > 0) {
      return E.badRequest(res,
        `Cannot remove — ${enrolledCount} student${enrolledCount !== 1 ? 's' : ''} `
        + `still enrolled in this subject for this class. Unenroll them first.`
      );
    }

    await _model('class_subjects').deleteOne({ id: req.params.id, schoolId });
    return ok(res, { message: 'Subject removed from class curriculum' });
  } catch (err) {
    console.error('[class-subjects DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
