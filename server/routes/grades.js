/* ============================================================
   Msingi — /api/grades  (Gradebook)
   Continuous assessment grades per student per subject per term.
   Plan: core | RBAC: grades:{read,create,update,delete}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { isYearArchived, firstArchivedYear } = require('../utils/archival');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Helpers ────────────────────────────────────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/* ── Validation ─────────────────────────────────────────────── */
const GradeSchema = z.object({
  studentId:      z.string().min(1),
  subjectId:      z.string().min(1),
  classId:        z.string().optional(),
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  assessmentType: z.enum(['classwork', 'homework', 'project', 'test', 'midterm', 'final', 'coursework', 'other']).default('classwork'),
  title:          z.string().max(200).optional(),
  score:          z.number().min(0),
  maxScore:       z.number().positive(),
  weight:         z.number().min(0).max(100).default(100),  // percentage weight for weighted average
  date:           z.string().optional(),
  gradedBy:       z.string().optional(),   // overridden by JWT
  notes:          z.string().max(500).optional(),
  isPublished:    z.boolean().default(true),
});

const BulkGradeSchema = z.object({
  grades: z.array(GradeSchema).min(1).max(500),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/grades ─ Paginated list ───────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.assessmentType) filter.assessmentType = req.query.assessmentType;
    if (req.query.isPublished)    filter.isPublished    = req.query.isPublished === 'true';

    const Grades = _model('grades');
    const [docs, total] = await Promise.all([
      Grades.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Grades.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[grades GET]', err); return E.serverError(res); }
});

/* ── GET /api/grades/report ─ Term report data per student ──── */
router.get('/report', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    if (!req.query.studentId && !req.query.classId) {
      return E.badRequest(res, 'studentId or classId is required for report');
    }

    const filter = { schoolId, isPublished: true };
    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;

    const Grades = _model('grades');

    // Aggregate: weighted average per student per subject
    const report = await Grades.aggregate([
      { $match: filter },
      {
        $group: {
          _id:       { studentId: '$studentId', subjectId: '$subjectId' },
          entries:   { $sum: 1 },
          // Weighted sum: sum(score/maxScore * weight) / sum(weight) * 100
          weightedScoreSum: { $sum: { $multiply: [{ $divide: ['$score', { $max: ['$maxScore', 1] }] }, '$weight'] } },
          totalWeight:      { $sum: '$weight' },
          rawAvg:    { $avg: { $multiply: [{ $divide: ['$score', { $max: ['$maxScore', 1] }] }, 100] } },
        }
      },
      {
        $addFields: {
          weightedAverage: {
            $round: [
              { $cond: [
                { $gt: ['$totalWeight', 0] },
                { $multiply: [{ $divide: ['$weightedScoreSum', '$totalWeight'] }, 100] },
                '$rawAvg'
              ]},
              1
            ]
          }
        }
      },
      { $sort: { '_id.studentId': 1, '_id.subjectId': 1 } }
    ]);

    return ok(res, report);
  } catch (err) { console.error('[grades/report GET]', err); return E.serverError(res); }
});

/* ── GET /api/grades/:id ──────────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('grades').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Grade not found');
    return ok(res, doc);
  } catch (err) { console.error('[grades GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/grades ─ Create grade ────────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(GradeSchema, req.body);
    if (error) return E.validation(res, error);

    // Block writes to archived academic years — log the attempt for auditability
    if (await isYearArchived(schoolId, data.academicYearId)) {
      _model('mark_audit_log').create({
        action:        'WRITE_BLOCKED_ARCHIVED_YEAR',
        schoolId,
        academicYearId: data.academicYearId,
        route:         'POST /api/grades',
        attemptedBy:   userId,
        payload:       { studentId: data.studentId, subjectId: data.subjectId, assessmentType: data.assessmentType },
        timestamp:     new Date().toISOString(),
      }).catch(e => console.error('[grades] audit log failed:', e.message));
      return E.badRequest(res, `Academic year "${data.academicYearId}" has been archived — grade entries are no longer allowed for this year.`);
    }

    if (data.score > data.maxScore) return E.badRequest(res, `Score (${data.score}) cannot exceed maxScore (${data.maxScore})`);

    const doc = await _model('grades').create({
      ...data,
      id:          uuidv4(),
      schoolId,
      percentage:  _round((data.score / data.maxScore) * 100),
      gradedBy:    userId,
      date:        data.date || new Date().toISOString().slice(0, 10),
      createdBy:   userId,
      updatedBy:   userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[grades POST]', err); return E.serverError(res); }
});

/* ── POST /api/grades/bulk ─ Bulk upsert ────────────────────── */
router.post('/bulk', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkGradeSchema, req.body);
    if (error) return E.validation(res, error);

    // Block bulk writes to archived academic years — check all distinct yearIds in the payload
    const blockedYear = await firstArchivedYear(schoolId, data.grades.map(g => g.academicYearId));
    if (blockedYear) {
      _model('mark_audit_log').create({
        action:        'WRITE_BLOCKED_ARCHIVED_YEAR',
        schoolId,
        academicYearId: blockedYear,
        route:         'POST /api/grades/bulk',
        attemptedBy:   userId,
        payload:       { gradeCount: data.grades.length },
        timestamp:     new Date().toISOString(),
      }).catch(e => console.error('[grades/bulk] audit log failed:', e.message));
      return E.badRequest(res, `Academic year "${blockedYear}" has been archived — grade entries are no longer allowed for this year.`);
    }

    const invalid = data.grades.filter(g => g.score > g.maxScore);
    if (invalid.length) return E.badRequest(res, `${invalid.length} grade(s) have score exceeding maxScore`);

    const Grades = _model('grades');
    const ops = data.grades.map(g => ({
      updateOne: {
        filter: {
          schoolId,
          studentId: g.studentId,
          subjectId: g.subjectId,
          assessmentType: g.assessmentType,
          termId:    g.termId || null,
          title:     g.title || ''
        },
        update: {
          $set: {
            ...g,
            schoolId,
            percentage: _round((g.score / g.maxScore) * 100),
            gradedBy:   userId,
            updatedBy:  userId,
            date:       g.date || new Date().toISOString().slice(0, 10),
          },
          $setOnInsert: { id: uuidv4(), createdBy: userId }
        },
        upsert: true
      }
    }));

    const result = await Grades.bulkWrite(ops, { ordered: false });
    return ok(res, { upserted: result.upsertedCount, modified: result.modifiedCount, total: data.grades.length }, null, 201);
  } catch (err) { console.error('[grades POST /bulk]', err); return E.serverError(res); }
});

/* ── PUT /api/grades/:id ──────────────────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(GradeSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    // Always fetch existing record — needed for audit trail and percentage recalc
    const existing = await _model('grades').findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Grade not found');

    // Recalculate percentage if score or maxScore changes
    if (data.score != null || data.maxScore != null) {
      const score    = data.score    ?? existing.score;
      const maxScore = data.maxScore ?? existing.maxScore;
      if (score > maxScore) return E.badRequest(res, `Score (${score}) cannot exceed maxScore (${maxScore})`);
      data.percentage = _round((score / maxScore) * 100);
    }

    const now = new Date().toISOString();
    const doc = await _model('grades').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId, updatedAt: now },
      { new: true, runValidators: false }
    ).lean();

    // Write audit entry if score changed
    const newScore = data.score ?? existing.score;
    if (data.score != null && data.score !== existing.score) {
      await _model('mark_audit_log').create({
        action:        'GRADE_UPDATED',
        gradeId:       req.params.id,
        studentId:     existing.studentId,
        subjectId:     existing.subjectId,
        schoolId,
        editedBy:      userId,
        actingAs:      req.body.actingAs || null,
        previousValue: existing.score,
        previousState: 'present',
        newValue:      newScore,
        newState:      'present',
        reason:        req.body.reason || data.notes || '',
        timestamp:     now,
      });
    }

    return ok(res, doc);
  } catch (err) { console.error('[grades PUT/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/grades/:id ───────────────────────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('grades', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('grades').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Grade not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[grades DELETE/:id]', err); return E.serverError(res); }
});

module.exports = router;
