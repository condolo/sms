/* ============================================================
   Msingi — /api/lessons   (Lessons & Syllabus Tracker)
   Live curriculum coverage tracking per teacher per class.

   Collections:
     syllabus_topics   — shared curriculum per subject (schoolId + subjectId + academicYear)
     lesson_coverage   — per-teacher-per-class coverage records

   Plan:  standard
   RBAC:  lessons:{read, create, update, delete}

   Key design decisions:
   • Topics are SHARED per subject — any teacher of Maths sees the same
     curriculum. Creating/editing a topic is visible to all teachers of
     that subject in the school.
   • Coverage is PER TEACHER PER CLASS — each teacher independently marks
     what they have covered for each of their assigned classes.
   • Co-teacher sync: when teacher A covers a topic for class X, teacher B
     of the same subject + class X also sees it as covered (shared coverage
     for the same class-subject pair).
   • Copy from colleague: copy another teacher's topics for the same subject.
   ============================================================ */
'use strict';

const express         = require('express');
const { z }           = require('zod');
const { v4: uuidv4 }  = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('lessons');

/* ── Role helpers ────────────────────────────────────────────── */
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'deputy_principal', 'principal', 'section_head', 'teacher', 'hod', 'deputy']);

function _eff(req) {
  const role       = req.jwtUser?.role       ?? '';
  const roles      = req.jwtUser?.roles      ?? [];
  const extraRoles = req.jwtUser?.extraRoles ?? [];
  return new Set([role, ...roles, ...extraRoles]);
}

function isTeacher(req) {
  const eff = _eff(req);
  return eff.has('teacher') || eff.has('hod');
}

function isAdmin(req) {
  const eff = _eff(req);
  return eff.has('admin') || eff.has('superadmin') || eff.has('principal') || eff.has('deputy') || eff.has('deputy_principal');
}

function isHodOrAdmin(req) {
  const eff = _eff(req);
  return isAdmin(req) || eff.has('hod') || eff.has('section_head');
}

/* ── Validation ─────────────────────────────────────────────── */
const SubtopicSchema = z.object({
  id:    z.string().optional(),
  title: z.string().min(1).max(200).trim(),
  order: z.number().int().min(0).default(0),
});

const TopicSchema = z.object({
  subjectId:    z.string().min(1),
  subjectName:  z.string().max(200).trim().optional(),
  academicYear: z.string().max(20).trim().optional(),
  title:        z.string().min(1).max(300).trim(),
  description:  z.string().max(1000).trim().optional(),
  order:        z.number().int().min(0).default(0),
  subtopics:    z.array(SubtopicSchema).optional().default([]),
});

const CoverageSchema = z.object({
  teacherId:    z.string().optional(),   // admin can submit on behalf
  classId:      z.string().min(1),
  subjectId:    z.string().min(1),
  topicId:      z.string().min(1),       // syllabus_topics.id
  subtopicId:   z.string().optional(),   // id within topic.subtopics
  coveredAt:    z.string().optional(),   // ISO date — defaults to now
  notes:        z.string().max(500).trim().optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── Helper: get teacher's assignments ─────────────────────── */
async function _teacherAssignments(schoolId, teacherId) {
  return _model('teaching_assignments')
    .find({ schoolId, teacherId })
    .select('classId className subjectId subjectName')
    .lean();
}

/* ── Helper: build coverage map for a set of class-subjects ─── */
async function _coverageMap(schoolId, classId, subjectId, academicYear) {
  const filter = { schoolId, classId, subjectId };
  if (academicYear) filter.academicYear = academicYear;
  const records = await _model('lesson_coverage').find(filter).lean();
  // Map: topicId_subtopicId → record (or topicId → record for full topic)
  const map = {};
  records.forEach(r => {
    const key = r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId;
    map[key] = r;
  });
  return map;
}

/* ═══════════════════════════════════════════════════════════════
   TOPIC ROUTES
   ═══════════════════════════════════════════════════════════════ */

/* ── GET /api/lessons/topics ─ list topics for a subject ────── */
router.get('/topics', authMiddleware, PLAN, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { subjectId, academicYear } = req.query;
    if (!subjectId) return E.validation(res, [{ field: 'subjectId', message: 'subjectId is required' }]);

    const filter = { schoolId, subjectId };
    if (academicYear) filter.academicYear = academicYear;

    const topics = await _model('syllabus_topics')
      .find(filter)
      .sort({ order: 1, createdAt: 1 })
      .lean();

    return ok(res, topics);
  } catch (err) { console.error('[lessons/topics GET]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/topics ─ create topic ────────────────── */
router.post('/topics', authMiddleware, PLAN, rbac('lessons', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(TopicSchema, req.body);
    if (error) return E.validation(res, error);

    // Resolve subject name if not provided
    let subjectName = data.subjectName;
    if (!subjectName) {
      const sub = await _model('subjects').findOne({ id: data.subjectId, schoolId }).select('name').lean();
      subjectName = sub?.name ?? '';
    }

    // Get academic year from school if not provided
    let academicYear = data.academicYear;
    if (!academicYear) {
      const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
      academicYear = school?.academicYear ?? String(new Date().getFullYear());
    }

    // Assign subtopic IDs if missing
    const subtopics = (data.subtopics || []).map((st, i) => ({
      id:    st.id || uuidv4(),
      title: st.title,
      order: st.order ?? i,
    }));

    const doc = await _model('syllabus_topics').create({
      id: uuidv4(),
      schoolId,
      subjectId:    data.subjectId,
      subjectName,
      academicYear,
      title:        data.title,
      description:  data.description || '',
      order:        data.order,
      subtopics,
      createdBy:    userId,
      updatedBy:    userId,
    });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[lessons/topics POST]', err); return E.serverError(res); }
});

/* ── PUT /api/lessons/topics/:id ─ update topic ─────────────── */
router.put('/topics/:id', authMiddleware, PLAN, rbac('lessons', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(TopicSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const update = { ...data, updatedBy: userId };
    // Ensure subtopic IDs
    if (update.subtopics) {
      update.subtopics = update.subtopics.map((st, i) => ({
        id:    st.id || uuidv4(),
        title: st.title,
        order: st.order ?? i,
      }));
    }

    const doc = await _model('syllabus_topics').findOneAndUpdate(
      { id: req.params.id, schoolId },
      update,
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Topic not found');
    return ok(res, doc);
  } catch (err) { console.error('[lessons/topics PUT/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/topics/:id ─ delete topic ──────────── */
router.delete('/topics/:id', authMiddleware, PLAN, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('syllabus_topics').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Topic not found');
    // Also remove coverage records for this topic
    await _model('lesson_coverage').deleteMany({ schoolId, topicId: req.params.id });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[lessons/topics DELETE/:id]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/topics/reorder ─ reorder topics ─────── */
router.post('/topics/reorder', authMiddleware, PLAN, rbac('lessons', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    // Body: { subjectId, academicYear, order: [{ id, order }] }
    const { subjectId, academicYear, order } = req.body;
    if (!subjectId || !Array.isArray(order)) return E.validation(res, [{ field: 'order', message: 'order array is required' }]);

    await Promise.all(order.map(({ id, order: o }) =>
      _model('syllabus_topics').updateOne({ id, schoolId, subjectId }, { order: o, updatedBy: userId })
    ));
    return ok(res, { reordered: order.length });
  } catch (err) { console.error('[lessons/topics/reorder POST]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/topics/copy-from ─ copy from colleague ─ */
/*
  Copy syllabus topics from another teacher's records for the
  same subject/academicYear. Used when a co-teacher has already
  populated the curriculum.
  Body: { fromTeacherId, subjectId, academicYear }
  Since topics are now SHARED (not per-teacher), this copies topics
  from another school's syllabus or another academic year.
*/
router.post('/topics/copy-from', authMiddleware, PLAN, rbac('lessons', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { fromAcademicYear, toAcademicYear, subjectId } = req.body;
    if (!fromAcademicYear || !toAcademicYear || !subjectId) {
      return E.validation(res, [{ field: 'fromAcademicYear', message: 'fromAcademicYear, toAcademicYear, and subjectId are required' }]);
    }
    if (fromAcademicYear === toAcademicYear) {
      return E.validation(res, [{ field: 'fromAcademicYear', message: 'Cannot copy from same academic year' }]);
    }

    const sourceDocs = await _model('syllabus_topics')
      .find({ schoolId, subjectId, academicYear: fromAcademicYear })
      .lean();

    if (!sourceDocs.length) return ok(res, { copied: 0, message: 'No topics found in source year' });

    // Check if target already has topics
    const existing = await _model('syllabus_topics').countDocuments({ schoolId, subjectId, academicYear: toAcademicYear });
    if (existing > 0) return E.conflict(res, `Target year already has ${existing} topic(s). Delete them first or choose a different year.`);

    const newDocs = sourceDocs.map(src => ({
      ...src,
      _id:          undefined,
      id:           uuidv4(),
      academicYear: toAcademicYear,
      subtopics:    (src.subtopics || []).map(st => ({ ...st, id: uuidv4() })),
      createdBy:    userId,
      updatedBy:    userId,
      createdAt:    new Date(),
      updatedAt:    new Date(),
    }));

    await _model('syllabus_topics').insertMany(newDocs);
    return ok(res, { copied: newDocs.length });
  } catch (err) { console.error('[lessons/topics/copy-from POST]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   COVERAGE ROUTES
   ═══════════════════════════════════════════════════════════════ */

/* ── GET /api/lessons/my-classes ─ teacher's class overview ─── */
/*
  Returns each of the teacher's assigned class-subject pairs
  enriched with coverage percentage for the current academic year.
*/
router.get('/my-classes', authMiddleware, PLAN, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    // Get academic year from school
    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = school?.academicYear ?? String(new Date().getFullYear());

    // Teacher's assignments
    const assignments = await _teacherAssignments(schoolId, userId);
    if (!assignments.length) return ok(res, []);

    // For each assignment, calculate coverage
    const results = await Promise.all(assignments.map(async (a) => {
      // Total subtopic items for this subject/year
      const topics = await _model('syllabus_topics')
        .find({ schoolId, subjectId: a.subjectId, academicYear })
        .select('id subtopics')
        .lean();

      // Count coverable items (each subtopic counts separately; if no subtopics, topic itself counts)
      let totalItems = 0;
      topics.forEach(t => {
        totalItems += t.subtopics?.length ? t.subtopics.length : 1;
      });

      // Count covered items for this class-subject
      const coveredCount = await _model('lesson_coverage').countDocuments({
        schoolId, classId: a.classId, subjectId: a.subjectId, academicYear,
      });

      const pct = totalItems > 0 ? Math.round((Math.min(coveredCount, totalItems) / totalItems) * 100) : 0;

      return {
        classId:     a.classId,
        className:   a.className,
        subjectId:   a.subjectId,
        subjectName: a.subjectName,
        totalTopics: topics.length,
        totalItems,
        coveredItems: Math.min(coveredCount, totalItems),
        pct,
        academicYear,
      };
    }));

    return ok(res, results);
  } catch (err) { console.error('[lessons/my-classes GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/coverage ─ detailed coverage for class ── */
/*
  Returns topics with coverage markers for a given classId + subjectId.
  Used by the teacher drill-down view.
  Query: classId, subjectId, academicYear (optional)
*/
router.get('/coverage', authMiddleware, PLAN, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId, academicYear } = req.query;
    if (!classId || !subjectId) {
      return E.validation(res, [{ field: 'classId', message: 'classId and subjectId are required' }]);
    }

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const year = academicYear || school?.academicYear || String(new Date().getFullYear());

    const [topics, coverageRecords] = await Promise.all([
      _model('syllabus_topics')
        .find({ schoolId, subjectId, academicYear: year })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
      _model('lesson_coverage')
        .find({ schoolId, classId, subjectId, academicYear: year })
        .lean(),
    ]);

    // Build coverage lookup
    const covered = {};
    coverageRecords.forEach(r => {
      const key = r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId;
      covered[key] = { coveredAt: r.coveredAt, notes: r.notes, id: r.id, teacherName: r.teacherName };
    });

    // Enrich topics with coverage
    const enriched = topics.map(t => {
      const topicKey = t.id;
      const enrichedSubtopics = (t.subtopics || []).map(st => ({
        ...st,
        covered:   !!covered[`${t.id}__${st.id}`],
        coverage:  covered[`${t.id}__${st.id}`] || null,
      }));

      const hasSubs  = enrichedSubtopics.length > 0;
      const allDone  = hasSubs && enrichedSubtopics.every(s => s.covered);
      const someDone = hasSubs && enrichedSubtopics.some(s => s.covered);
      const topicCov = !hasSubs ? (covered[topicKey] || null) : null;

      return {
        ...t,
        subtopics:   enrichedSubtopics,
        covered:     hasSubs ? allDone : !!topicCov,
        partial:     hasSubs ? (someDone && !allDone) : false,
        coverage:    topicCov,
      };
    });

    return ok(res, { topics: enriched, academicYear: year });
  } catch (err) { console.error('[lessons/coverage GET]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/coverage ─ mark topic/subtopic covered ─ */
router.post('/coverage', authMiddleware, PLAN, rbac('lessons', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CoverageSchema, req.body);
    if (error) return E.validation(res, error);

    // Teachers can only submit for themselves unless admin
    const effectiveTeacherId = (isAdmin(req) && data.teacherId) ? data.teacherId : userId;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = school?.academicYear ?? String(new Date().getFullYear());

    // Validate topic exists
    const topic = await _model('syllabus_topics').findOne({ id: data.topicId, schoolId }).lean();
    if (!topic) return E.notFound(res, 'Topic not found');

    // If subtopicId provided, validate it belongs to the topic
    if (data.subtopicId) {
      const stExists = (topic.subtopics || []).some(st => st.id === data.subtopicId);
      if (!stExists) return E.notFound(res, 'Subtopic not found on this topic');
    }

    // Get teacher name
    let teacherName = req.jwtUser.name ?? '';
    if (effectiveTeacherId !== userId) {
      const t = await _model('users').findOne({ id: effectiveTeacherId, schoolId }).select('name').lean();
      teacherName = t?.name ?? teacherName;
    }

    // Upsert — prevent duplicate coverage records for same class-subject-topic-subtopic
    const filter = {
      schoolId,
      classId:    data.classId,
      subjectId:  data.subjectId,
      topicId:    data.topicId,
      academicYear,
      ...(data.subtopicId ? { subtopicId: data.subtopicId } : { subtopicId: { $exists: false } }),
    };

    const update = {
      $setOnInsert: { id: uuidv4(), createdBy: userId },
      $set: {
        teacherId:   effectiveTeacherId,
        teacherName,
        className:   data.classId,   // will be enriched below
        subjectName: topic.subjectName || '',
        topicTitle:  topic.title,
        coveredAt:   data.coveredAt || new Date().toISOString(),
        notes:       data.notes || '',
        updatedBy:   userId,
      },
    };

    // Enrich with className
    const cls = await _model('classes').findOne({ id: data.classId, schoolId }).select('name').lean();
    if (cls) update.$set.className = cls.name;

    const doc = await _model('lesson_coverage').findOneAndUpdate(filter, update, { new: true, upsert: true, runValidators: false }).lean();
    return ok(res, doc);
  } catch (err) { console.error('[lessons/coverage POST]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/coverage/:id ─ unmark coverage ─────── */
router.delete('/coverage/:id', authMiddleware, PLAN, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const filter = { id: req.params.id, schoolId };
    // Teachers can only delete their own records
    if (!isAdmin(req)) filter.teacherId = userId;

    const doc = await _model('lesson_coverage').findOneAndDelete(filter);
    if (!doc) return E.notFound(res, 'Coverage record not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[lessons/coverage DELETE/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/coverage (bulk unmark for class-subject-topic) */
router.delete('/coverage', authMiddleware, PLAN, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, topicId, subtopicId } = req.query;
    if (!classId || !subjectId || !topicId) {
      return E.validation(res, [{ field: 'classId', message: 'classId, subjectId, and topicId are required' }]);
    }

    const filter = { schoolId, classId, subjectId, topicId };
    if (subtopicId) filter.subtopicId = subtopicId;
    if (!isAdmin(req)) filter.teacherId = userId;

    const result = await _model('lesson_coverage').deleteMany(filter);
    return ok(res, { deleted: result.deletedCount });
  } catch (err) { console.error('[lessons/coverage DELETE bulk]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   ADMIN / HOD / PORTAL SUMMARY ROUTES
   ═══════════════════════════════════════════════════════════════ */

/* ── GET /api/lessons/summary ─ school-wide overview (admin/HOD) */
/*
  Returns all teaching assignments enriched with coverage %.
  Used by admin/HOD overview grid.
*/
router.get('/summary', authMiddleware, PLAN, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYear: yearQ, subjectId, classId, departmentId } = req.query;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = yearQ || school?.academicYear || String(new Date().getFullYear());

    let assignFilter = { schoolId };
    if (subjectId)    assignFilter.subjectId   = subjectId;
    if (classId)      assignFilter.classId      = classId;
    if (departmentId) assignFilter.departmentId = departmentId;

    const assignments = await _model('teaching_assignments').find(assignFilter).lean();

    // Aggregate topics count per subject
    const topicCounts = {};
    const uniqueSubjects = [...new Set(assignments.map(a => a.subjectId))];
    await Promise.all(uniqueSubjects.map(async sid => {
      const topics = await _model('syllabus_topics').find({ schoolId, subjectId: sid, academicYear }).select('id subtopics').lean();
      let total = 0;
      topics.forEach(t => { total += t.subtopics?.length ? t.subtopics.length : 1; });
      topicCounts[sid] = total;
    }));

    // Coverage per class-subject
    const coverageCounts = {};
    await Promise.all(assignments.map(async a => {
      const key = `${a.classId}__${a.subjectId}`;
      const count = await _model('lesson_coverage').countDocuments({
        schoolId, classId: a.classId, subjectId: a.subjectId, academicYear,
      });
      coverageCounts[key] = count;
    }));

    const rows = assignments.map(a => {
      const totalItems   = topicCounts[a.subjectId] || 0;
      const covered      = coverageCounts[`${a.classId}__${a.subjectId}`] || 0;
      const pct          = totalItems > 0 ? Math.round((Math.min(covered, totalItems) / totalItems) * 100) : 0;
      return {
        teacherId:   a.teacherId,
        teacherName: a.teacherName,
        classId:     a.classId,
        className:   a.className,
        subjectId:   a.subjectId,
        subjectName: a.subjectName,
        totalItems,
        coveredItems: Math.min(covered, totalItems),
        pct,
        academicYear,
      };
    });

    return ok(res, rows);
  } catch (err) { console.error('[lessons/summary GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/class-summary/:classId ─ student/parent portal */
/*
  Returns per-subject coverage for a class.
  Used in student and parent dashboards.
*/
router.get('/class-summary/:classId', authMiddleware, PLAN, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId } = req.params;
    const { academicYear: yearQ } = req.query;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = yearQ || school?.academicYear || String(new Date().getFullYear());

    // Get subjects taught in this class via teaching assignments
    const assignments = await _model('teaching_assignments')
      .find({ schoolId, classId })
      .select('subjectId subjectName teacherName')
      .lean();

    const uniqueBySubject = Object.values(
      assignments.reduce((acc, a) => { acc[a.subjectId] = a; return acc; }, {})
    );

    const rows = await Promise.all(uniqueBySubject.map(async (a) => {
      const topics = await _model('syllabus_topics')
        .find({ schoolId, subjectId: a.subjectId, academicYear })
        .select('id title subtopics order')
        .sort({ order: 1 })
        .lean();

      let totalItems = 0;
      topics.forEach(t => { totalItems += t.subtopics?.length ? t.subtopics.length : 1; });

      const coverageRecords = await _model('lesson_coverage')
        .find({ schoolId, classId, subjectId: a.subjectId, academicYear })
        .lean();

      const coveredKeys = new Set(coverageRecords.map(r =>
        r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId
      ));

      // Enrich topics for the portal view
      const enrichedTopics = topics.map(t => {
        if (t.subtopics?.length) {
          const coveredSubs = t.subtopics.filter(st => coveredKeys.has(`${t.id}__${st.id}`)).length;
          return {
            title:    t.title,
            total:    t.subtopics.length,
            covered:  coveredSubs,
            pct:      Math.round((coveredSubs / t.subtopics.length) * 100),
          };
        }
        return {
          title:   t.title,
          total:   1,
          covered: coveredKeys.has(t.id) ? 1 : 0,
          pct:     coveredKeys.has(t.id) ? 100 : 0,
        };
      });

      const pct = totalItems > 0
        ? Math.round((Math.min(coveredKeys.size, totalItems) / totalItems) * 100)
        : 0;

      return {
        subjectId:   a.subjectId,
        subjectName: a.subjectName,
        teacherName: a.teacherName,
        totalItems,
        coveredItems: Math.min(coveredKeys.size, totalItems),
        pct,
        topics:      enrichedTopics,
        academicYear,
      };
    }));

    return ok(res, rows);
  } catch (err) { console.error('[lessons/class-summary GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/pending-teachers ─ HOD: who hasn't updated */
/*
  Returns teachers who have uncovered topics for the current week.
  Used by HOD escalation view and reminder system.
*/
router.get('/pending-teachers', authMiddleware, PLAN, async (req, res) => {
  try {
    if (!isHodOrAdmin(req)) return E.forbidden(res, 'HOD or admin access required');
    const { schoolId } = req.jwtUser;
    const { academicYear: yearQ, subjectId, departmentId } = req.query;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = yearQ || school?.academicYear || String(new Date().getFullYear());

    let assignFilter = { schoolId };
    if (subjectId)    assignFilter.subjectId    = subjectId;
    if (departmentId) assignFilter.departmentId = departmentId;

    const assignments = await _model('teaching_assignments').find(assignFilter).lean();

    // Group by teacher
    const byTeacher = {};
    assignments.forEach(a => {
      if (!byTeacher[a.teacherId]) {
        byTeacher[a.teacherId] = { teacherId: a.teacherId, teacherName: a.teacherName, classes: [] };
      }
      byTeacher[a.teacherId].classes.push({ classId: a.classId, className: a.className, subjectId: a.subjectId, subjectName: a.subjectName });
    });

    // Check coverage completeness per teacher
    const results = await Promise.all(Object.values(byTeacher).map(async (t) => {
      let totalItems = 0, coveredItems = 0;
      await Promise.all(t.classes.map(async (c) => {
        const topics = await _model('syllabus_topics')
          .find({ schoolId, subjectId: c.subjectId, academicYear })
          .select('id subtopics').lean();
        topics.forEach(tp => { totalItems += tp.subtopics?.length ? tp.subtopics.length : 1; });

        const cov = await _model('lesson_coverage').countDocuments({
          schoolId, classId: c.classId, subjectId: c.subjectId, academicYear,
        });
        coveredItems += cov;
      }));

      const pct = totalItems > 0 ? Math.round((Math.min(coveredItems, totalItems) / totalItems) * 100) : 100;
      return { ...t, totalItems, coveredItems: Math.min(coveredItems, totalItems), pct, hasPending: pct < 100 };
    }));

    return ok(res, results.filter(t => t.hasPending));
  } catch (err) { console.error('[lessons/pending-teachers GET]', err); return E.serverError(res); }
});

module.exports = router;
