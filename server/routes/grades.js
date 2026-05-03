/* ============================================================
   InnoLearn — /api/grades  (Gradebook)
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
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(GradeSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    // Recalculate percentage if score or maxScore changes
    if (data.score != null || data.maxScore != null) {
      const existing = await _model('grades').findOne({ id: req.params.id, schoolId }).lean();
      if (existing) {
        const score    = data.score    ?? existing.score;
        const maxScore = data.maxScore ?? existing.maxScore;
        if (score > maxScore) return E.badRequest(res, `Score (${score}) cannot exceed maxScore (${maxScore})`);
        data.percentage = _round((score / maxScore) * 100);
      }
    }

    const doc = await _model('grades').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Grade not found');
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
