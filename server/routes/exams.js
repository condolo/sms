/* ============================================================
   InnoLearn — /api/exams  (Exam Scheduling + Results)
   Sub-routes:
     /api/exams              — exam definitions
     /api/exams/:id/results  — results for one exam
     /api/exams/results      — query all results (cross-exam)
   Plan: standard | RBAC: exams:{read,create,update,delete}
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
const PLAN   = planGate('exams');

/* ── Helpers ────────────────────────────────────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** Convert raw score to grade letter based on school's grading scale */
function _calcGrade(score, maxScore, gradeScale = []) {
  if (!maxScore || maxScore === 0) return null;
  const pct = _round((score / maxScore) * 100);
  if (!gradeScale.length) return null;
  const sorted = [...gradeScale].sort((a, b) => b.min - a.min);
  const band   = sorted.find(g => pct >= g.min);
  return { percentage: pct, grade: band?.grade || null, points: band?.points || null };
}

/* ── Validation ─────────────────────────────────────────────── */
const ExamSchema = z.object({
  title:          z.string().min(1).max(200).trim(),
  subjectId:      z.string().optional(),
  classId:        z.string().optional(),
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  type:           z.enum(['test', 'mock', 'terminal', 'internal', 'external', 'coursework']).default('test'),
  date:           z.string().optional(),
  startTime:      z.string().optional(),
  duration:       z.number().int().min(1).optional(),    // minutes
  maxScore:       z.number().positive(),
  passMark:       z.number().min(0).optional(),
  room:           z.string().max(100).optional(),
  invigilatorId:  z.string().optional(),
  instructions:   z.string().max(1000).optional(),
  status:         z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).default('scheduled'),
});

const ResultSchema = z.object({
  studentId:  z.string().min(1),
  score:      z.number().min(0),
  absent:     z.boolean().default(false),
  notes:      z.string().max(500).optional(),
  gradedBy:   z.string().optional(),   // overridden by JWT
});

const BulkResultSchema = z.object({
  results: z.array(ResultSchema).min(1).max(500),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   EXAMS
   ══════════════════════════════════════════════════════════════ */

router.get('/', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId)      filter.classId      = req.query.classId;
    if (req.query.subjectId)    filter.subjectId    = req.query.subjectId;
    if (req.query.termId)       filter.termId       = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.type)         filter.type         = req.query.type;
    if (req.query.status)       filter.status       = req.query.status;

    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.title = rx;
    }

    const Exams = _model('exams');
    const [docs, total] = await Promise.all([
      Exams.find(filter).sort({ date: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Exams.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[exams GET]', err); return E.serverError(res); }
});

router.get('/:id', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('exams').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Exam not found');
    return ok(res, doc);
  } catch (err) { console.error('[exams GET/:id]', err); return E.serverError(res); }
});

router.post('/', authMiddleware, PLAN, rbac('exams', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ExamSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await _model('exams').create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[exams POST]', err); return E.serverError(res); }
});

router.put('/:id', authMiddleware, PLAN, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ExamSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const doc = await _model('exams').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Exam not found');
    return ok(res, doc);
  } catch (err) { console.error('[exams PUT/:id]', err); return E.serverError(res); }
});

router.delete('/:id', authMiddleware, PLAN, rbac('exams', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await _model('exams').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'cancelled', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Exam not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[exams DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   RESULTS  (scoped to one exam, or cross-exam query)
   ══════════════════════════════════════════════════════════════ */

/* GET /api/exams/:id/results */
router.get('/:id/results', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const exam = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    const filter = { schoolId, examId: req.params.id };
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.absent === 'true') filter.absent = true;

    const Results = _model('exam_results');
    const [docs, total] = await Promise.all([
      Results.find(filter).sort({ score: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Results.countDocuments(filter)
    ]);

    // Compute class statistics server-side
    const allScores  = docs.filter(d => !d.absent).map(d => d.score);
    const stats      = allScores.length ? {
      count:   allScores.length,
      highest: Math.max(...allScores),
      lowest:  Math.min(...allScores),
      average: _round(allScores.reduce((s, n) => s + n, 0) / allScores.length),
      passCount: exam.passMark != null ? allScores.filter(s => s >= exam.passMark).length : null,
    } : null;

    return ok(res, { results: docs, stats, exam: { id: exam.id, title: exam.title, maxScore: exam.maxScore, passMark: exam.passMark } }, paginate(page, limit, total));
  } catch (err) { console.error('[exams/:id/results GET]', err); return E.serverError(res); }
});

/* POST /api/exams/:id/results  — bulk upsert results for this exam */
router.post('/:id/results', authMiddleware, PLAN, rbac('exams', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkResultSchema, req.body);
    if (error) return E.validation(res, error);

    const exam = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    // Validate all scores are within maxScore
    const overscored = data.results.filter(r => !r.absent && r.score > exam.maxScore);
    if (overscored.length) {
      return E.badRequest(res, `${overscored.length} result(s) exceed the exam maximum score of ${exam.maxScore}`);
    }

    const Results = _model('exam_results');
    const ops = data.results.map(r => {
      const gradeInfo = _calcGrade(r.score, exam.maxScore, exam.gradeScale || []);
      return {
        updateOne: {
          filter: { schoolId, examId: req.params.id, studentId: r.studentId },
          update: {
            $set: {
              score:      r.absent ? null : r.score,
              absent:     r.absent,
              notes:      r.notes || '',
              gradedBy:   userId,
              updatedBy:  userId,
              examId:     req.params.id,
              schoolId,
              studentId:  r.studentId,
              classId:    exam.classId,
              subjectId:  exam.subjectId,
              ...(gradeInfo || {}),
            },
            $setOnInsert: { id: uuidv4(), createdBy: userId }
          },
          upsert: true
        }
      };
    });

    const result = await Results.bulkWrite(ops, { ordered: false });

    // Mark exam as completed if it was just fully entered
    if (exam.status === 'in_progress' || exam.status === 'scheduled') {
      await _model('exams').updateOne({ id: req.params.id }, { status: 'completed' });
    }

    return ok(res, { upserted: result.upsertedCount, modified: result.modifiedCount, total: data.results.length }, null, 201);
  } catch (err) { console.error('[exams/:id/results POST]', err); return E.serverError(res); }
});

/* GET /api/exams/results — cross-exam results query */
router.get('/results/all', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.studentId)    filter.studentId    = req.query.studentId;
    if (req.query.classId)      filter.classId      = req.query.classId;
    if (req.query.subjectId)    filter.subjectId    = req.query.subjectId;
    if (req.query.examId)       filter.examId       = req.query.examId;

    const Results = _model('exam_results');
    const [docs, total] = await Promise.all([
      Results.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Results.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[exams/results/all GET]', err); return E.serverError(res); }
});

module.exports = router;
