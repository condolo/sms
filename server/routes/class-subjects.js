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
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const ScopeEngine         = require('../utils/scopeEngine');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');

const router = express.Router();

/* ── Helper: find a class by either custom id (UUID) or _id (ObjectId string) ─
   Classes created before the id field was added only have _id. The GET /classes
   route normalises both into `id` for the frontend, but writes in other routes
   must tolerate the legacy _id-as-id case. */
function _classQuery(schoolId, classId) {
  const isOid = /^[a-f\d]{24}$/i.test(classId);
  return isOid
    ? { schoolId, $or: [{ id: classId }, { _id: classId }] }
    : { schoolId, id: classId };
}

/* Same pattern for class_subjects docs — some legacy docs may only have _id */
function _linkQuery(schoolId, linkId) {
  const isOid = /^[a-f\d]{24}$/i.test(linkId);
  return isOid
    ? { schoolId, $or: [{ id: linkId }, { _id: linkId }] }
    : { schoolId, id: linkId };
}

/* ── GET /api/class-subjects/counts ─────────────────────────────
   Returns { [classId]: subjectCount }
   Used by class cards and the class dropdown to show curriculum size. */
router.get('/counts', authMiddleware, async (req, res) => { // rbac: intentionally open to every authenticated user — reference/count data
  try {
    const { schoolId } = req.jwtUser;
    const agg = await tenantModel('class_subjects', tenantContext(req)).aggregate([
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

/* ── GET /api/class-subjects/enrollment-warnings ────────────────
   Subject count warnings based on subject_rules.
   ?classId=X  → single-class report (students below min / above max)
   (no params)  → school-wide summary: all classes with any violations

   Rule resolution per class (most specific wins):
     1. classPattern rule — regex matched against classId (e.g. "f[34]")
     2. section rule      — matched against class.sectionKey (e.g. "alevel")
     3. no rule           → class is flagged as unconfigured

   Returns:
   {
     classes: [{
       classId, className, sectionKey,
       rule: { minSubjects, maxSubjects } | null,
       students: [{
         id, firstName, lastName, admissionNumber,
         subjectCount, status: 'ok'|'below_min'|'above_max'
       }],
       summary: { ok, belowMin, aboveMax, total }
     }]
   }
*/
router.get('/enrollment-warnings', authMiddleware, async (req, res) => { // rbac: intentionally open to every authenticated user — reference data
  try {
    const { schoolId } = req.jwtUser;
    const { classId: qClassId } = req.query;

    /* 1. Load all subject rules for this school */
    const allRules = await tenantModel('subject_rules', tenantContext(req))
      .find({ schoolId })
      .lean();

    /* Helper: find the best-matching rule for a given class */
    function resolveRule(classId, sectionKey) {
      // Priority 1: classPattern match
      for (const r of allRules) {
        if (r.classPattern) {
          try {
            if (new RegExp(r.classPattern, 'i').test(classId)) return r;
          } catch (_) { /* skip invalid pattern */ }
        }
      }
      // Priority 2: section match
      for (const r of allRules) {
        if (!r.classPattern && r.section && r.section === sectionKey) return r;
      }
      return null;
    }

    /* 2. Determine which classes to analyse */
    const classFilter = { schoolId, status: { $ne: 'inactive' } };
    if (qClassId) classFilter.id = qClassId;

    const classes = await tenantModel('classes', tenantContext(req))
      .find(classFilter)
      .sort({ order: 1 })
      .select('id name sectionKey order')
      .lean();

    if (classes.length === 0) {
      return ok(res, { classes: [] });
    }

    const classIds = classes.map(c => c.id);

    /* 3. Load all active students in the relevant classes */
    const students = await tenantModel('students', tenantContext(req))
      .find({ schoolId, classId: { $in: classIds }, status: { $ne: 'inactive' } })
      .select('id firstName lastName admissionNumber classId')
      .lean();

    /* 4. Count enrollments per student via aggregation */
    const enrollAgg = await tenantModel('student_subjects', tenantContext(req)).aggregate([
      { $match: { schoolId, classId: { $in: classIds } } },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]);
    const enrollMap = Object.fromEntries(enrollAgg.map(e => [e._id, e.count]));

    /* 5. Group students by class and evaluate against rules */
    const classBuckets = {};
    for (const c of classes) {
      classBuckets[c.id] = { ...c, rule: resolveRule(c.id, c.sectionKey), studentRows: [] };
    }
    for (const s of students) {
      const bucket = classBuckets[s.classId];
      if (!bucket) continue;
      const count  = enrollMap[s.id] ?? 0;
      const rule   = bucket.rule;
      let status   = 'no_rule';
      if (rule) {
        if (count < rule.minSubjects)      status = 'below_min';
        else if (count > rule.maxSubjects) status = 'above_max';
        else                               status = 'ok';
      }
      bucket.studentRows.push({
        id:               s.id,
        firstName:        s.firstName,
        lastName:         s.lastName,
        admissionNumber:  s.admissionNumber,
        subjectCount:     count,
        status,
      });
    }

    /* 6. Build result — school-wide mode only returns classes that have violations */
    const result = [];
    for (const c of classes) {
      const b   = classBuckets[c.id];
      const rows = b.studentRows;
      const summary = {
        ok:        rows.filter(r => r.status === 'ok').length,
        belowMin:  rows.filter(r => r.status === 'below_min').length,
        aboveMax:  rows.filter(r => r.status === 'above_max').length,
        noRule:    rows.filter(r => r.status === 'no_rule').length,
        total:     rows.length,
      };

      // School-wide mode: only include classes with at least one warning
      if (!qClassId && summary.belowMin === 0 && summary.aboveMax === 0) continue;

      result.push({
        classId:    c.id,
        className:  c.name,
        sectionKey: c.sectionKey,
        rule:       b.rule
          ? { minSubjects: b.rule.minSubjects, maxSubjects: b.rule.maxSubjects, notes: b.rule.notes }
          : null,
        students:   rows,
        summary,
      });
    }

    return ok(res, { classes: result });
  } catch (err) {
    console.error('[class-subjects GET /enrollment-warnings]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/class-subjects/enrollment-analytics ───────────────
   Per-class SUBJECT-enrollment coverage — a different axis than
   enrollment-warnings above (which checks per-STUDENT subject counts
   against min/max rules). This checks, for every subject on a class's
   curriculum, how many of that class's active students are actually
   enrolled in it — and separately flags students with ZERO subject
   enrollments at all. Direct motivation: this is exactly the shape of
   gap that hid 6 students missing from a Kiswahili elective roster
   for weeks with nothing surfacing it (4 had no elective enrollment
   at all; 2 were enrolled in French instead) — this view is what
   would have caught that immediately instead of only after a parent
   complaint.
   A compulsory subject should cover every active student in the
   class — any shortfall there is a missed enrollment, not a choice,
   so it's flagged (`gap`). An elective's shortfall is expected (the
   roster splits across electives) — no gap is computed for those.
   Scope: same posture as every other teacher-facing roster view this
   session touched — unrestricted for management, narrowed to the
   caller's own assigned classes otherwise (resolveClassPickerScope,
   same pattern used by assessment.js's analytics `availableClasses`).
   ?classId=X narrows to one class (still subject to scope above).
   Exported as _buildEnrollmentAnalytics so assessment.js's PDF export
   can render the exact same data without a second HTTP round trip. */
async function _buildEnrollmentAnalytics(req) {
  const { schoolId } = req.jwtUser;
  const { classId: qClassId } = req.query;

  // req.scope is null for a school-level role (admin/principal/etc) —
  // applyToFilter/resolveClassPickerScope both no-op in that case, same
  // as assessment.js's analytics availableClasses resolution.
  const originalScope = req.scope;
  req.scope = await ScopeEngine.resolveClassPickerScope(req);
  const classesFilter = ScopeEngine.applyToFilter(req, 'classes', { schoolId, status: { $ne: 'inactive' } });
  req.scope = originalScope;
  if (qClassId) classesFilter.id = qClassId;

  const classes = await tenantModel('classes', tenantContext(req))
    .find(classesFilter).sort({ order: 1 }).select('id name').lean();
  if (!classes.length) return { classes: [] };

  const classIds = classes.map(c => c.id);

  const [links, students, enrollAgg, enrollments] = await Promise.all([
    tenantModel('class_subjects', tenantContext(req))
      .find({ schoolId, classId: { $in: classIds }, isActive: { $ne: false } }).lean(),
    tenantModel('students', tenantContext(req))
      .find({ schoolId, classId: { $in: classIds }, status: { $ne: 'inactive' } })
      .select('id classId').lean(),
    tenantModel('student_subjects', tenantContext(req)).aggregate([
      { $match: { schoolId, classId: { $in: classIds } } },
      { $group: { _id: { classId: '$classId', subjectId: '$subjectId' }, count: { $sum: 1 } } },
    ]),
    tenantModel('student_subjects', tenantContext(req))
      .find({ schoolId, classId: { $in: classIds } }).select('studentId classId').lean(),
  ]);

  const subjectIds = [...new Set(links.map(l => l.subjectId))];
  const subjectDocs = subjectIds.length
    ? await tenantModel('subjects', tenantContext(req)).find({ schoolId, id: { $in: subjectIds } }).select('id name').lean()
    : [];
  const subjectNameMap = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));

  const rosterByClass = {};
  for (const s of students) (rosterByClass[s.classId] ??= []).push(s.id);

  const enrollCountMap = {}; // `${classId}::${subjectId}` -> count
  for (const e of enrollAgg) enrollCountMap[`${e._id.classId}::${e._id.subjectId}`] = e.count;

  const enrolledStudentKeys = new Set(enrollments.map(e => `${e.classId}::${e.studentId}`));

  const result = classes.map(c => {
    const roster = rosterByClass[c.id] ?? [];
    const subjects = links
      .filter(l => l.classId === c.id)
      .map(l => {
        const enrolled = enrollCountMap[`${c.id}::${l.subjectId}`] ?? 0;
        const isCompulsory = !!l.isCompulsoryForClass;
        return {
          subjectId:    l.subjectId,
          subject:      subjectNameMap[l.subjectId] ?? l.subjectId,
          isCompulsory,
          enrolled,
          rosterSize:   roster.length,
          enrollmentPct: roster.length ? Math.round((enrolled / roster.length) * 1000) / 10 : null,
          gap: isCompulsory ? Math.max(0, roster.length - enrolled) : null,
        };
      })
      .sort((a, b) => a.subject.localeCompare(b.subject));

    const unenrolledStudents = roster.filter(sid => !enrolledStudentKeys.has(`${c.id}::${sid}`)).length;

    return { classId: c.id, className: c.name, rosterSize: roster.length, subjects, unenrolledStudents };
  });

  return { classes: result };
}

router.get('/enrollment-analytics', authMiddleware, rbac('subjects', 'read'), scopeMiddleware, async (req, res) => {
  try {
    return ok(res, await _buildEnrollmentAnalytics(req));
  } catch (err) {
    console.error('[class-subjects GET /enrollment-analytics]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/class-subjects ─────────────────────────────────────
   ?classId=X   → curriculum for a class (includes full subject + dept details)
   ?subjectId=X → all classes that offer a given subject (includes class meta)
   One of the two query params is required. */
router.get('/', authMiddleware, async (req, res) => { // rbac: intentionally open to every authenticated user — reference data
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId } = req.query;

    if (!classId && !subjectId) {
      return E.badRequest(res, 'classId or subjectId query param required');
    }

    const filter = { schoolId, isActive: { $ne: false } };
    if (classId)   filter.classId   = classId;
    if (subjectId) filter.subjectId = subjectId;

    const docs = await tenantModel('class_subjects', tenantContext(req))
      .find(filter)
      .sort({ createdAt: 1 })
      .lean();

    /* ── Populate subject + department when listing by class ── */
    if (classId && docs.length > 0) {
      const subjectIds = [...new Set(docs.map(d => d.subjectId))];
      const subjects   = await tenantModel('subjects', tenantContext(req))
        .find({ schoolId, id: { $in: subjectIds } })
        .select('id name code shortName departmentId sections isCompulsory color order')
        .lean();

      const deptIds = [...new Set(subjects.map(s => s.departmentId).filter(Boolean))];
      const depts   = deptIds.length
        ? await tenantModel('departments', tenantContext(req))
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
        ? await tenantModel('classes', tenantContext(req))
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
   Body: { classId, subjectId, isCompulsoryForClass? }
   When isCompulsoryForClass is omitted, the new curriculum link inherits
   the subject's own catalog-level `isCompulsory` flag as its starting
   value (Tier 2 defaults from Tier 1 — see the module header). Confirmed
   directly against live data (2026-10-15): a school can mark a subject
   compulsory in the Catalog believing it applies everywhere, while every
   curriculum link created afterwards defaulted to `false` regardless,
   because this route never looked at the catalog flag at all — the two
   "compulsory" concepts never agreed unless an admin also toggled the
   per-class flag separately in the Curriculum tab. This default makes
   the common case agree out of the box; an explicit true/false in the
   request body still always wins, so a class can still legitimately
   diverge from the catalog default when a school intends that. */
router.post('/', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, isCompulsoryForClass } = req.body;

    if (!classId || !subjectId) {
      return E.badRequest(res, 'classId and subjectId required');
    }

    /* Validate both entities exist in this school */
    const [cls, subject] = await Promise.all([
      tenantModel('classes', tenantContext(req)).findOne(_classQuery(schoolId, classId)).lean(),
      tenantModel('subjects', tenantContext(req)).findOne({ schoolId, id: subjectId, isActive: { $ne: false } }).lean(),
    ]);
    if (!cls)     return E.notFound(res, 'Class not found');
    if (!subject) return E.notFound(res, 'Subject not found or deactivated');

    /* Duplicate guard */
    const existing = await tenantModel('class_subjects', tenantContext(req))
      .findOne({ schoolId, classId, subjectId })
      .lean();
    if (existing) return E.conflict(res, 'Subject is already in this class curriculum');

    const resolvedCompulsory = typeof isCompulsoryForClass === 'boolean'
      ? isCompulsoryForClass
      : Boolean(subject.isCompulsory);

    const doc = await tenantModel('class_subjects', tenantContext(req)).create({
      id:                   uuidv4(),
      schoolId,
      classId,
      subjectId,
      isCompulsoryForClass: resolvedCompulsory,
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

    const cls = await tenantModel('classes', tenantContext(req)).findOne(_classQuery(schoolId, classId)).lean();
    if (!cls) return E.notFound(res, 'Class not found');

    const subjectIds = [...new Set(subjects.map(s => s.subjectId).filter(Boolean))];
    if (subjectIds.length === 0) return E.badRequest(res, 'No valid subjectIds provided');

    /* Validate all subject IDs exist and are active */
    const validSubjects = await tenantModel('subjects', tenantContext(req))
      .find({ schoolId, id: { $in: subjectIds }, isActive: { $ne: false } })
      .select('id isCompulsory')
      .lean();
    const validIds = new Set(validSubjects.map(s => s.id));
    const catalogCompulsoryById = new Map(validSubjects.map(s => [s.id, Boolean(s.isCompulsory)]));

    /* Already in curriculum — skip silently */
    const alreadyAssigned = await tenantModel('class_subjects', tenantContext(req))
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
        /* Same catalog-default inheritance as POST / (see its header
           comment) — an explicit per-subject flag in the request still wins. */
        isCompulsoryForClass: typeof s.isCompulsoryForClass === 'boolean'
          ? s.isCompulsoryForClass
          : catalogCompulsoryById.get(s.subjectId) ?? false,
        isActive:             true,
        createdBy:            userId,
        updatedBy:            userId,
      }));

    if (toInsert.length > 0) await tenantModel('class_subjects', tenantContext(req)).insertMany(toInsert);

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

    const doc = await tenantModel('class_subjects', tenantContext(req)).findOneAndUpdate(
      _linkQuery(schoolId, req.params.id),
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

    const link = await tenantModel('class_subjects', tenantContext(req))
      .findOne(_linkQuery(schoolId, req.params.id))
      .lean();
    if (!link) return E.notFound(res, 'Class-subject link not found');

    /* Guard: refuse if students are still enrolled */
    const enrolledCount = await tenantModel('student_subjects', tenantContext(req)).countDocuments({
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

    await tenantModel('class_subjects', tenantContext(req)).deleteOne(_linkQuery(schoolId, req.params.id));
    return ok(res, { message: 'Subject removed from class curriculum' });
  } catch (err) {
    console.error('[class-subjects DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
module.exports._buildEnrollmentAnalytics = _buildEnrollmentAnalytics;
