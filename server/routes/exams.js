/* ============================================================
   Msingi — /api/exams  (Exam Scheduling + Results)
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
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const { isYearArchived } = require('../utils/archival');

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
/* ── Exam status state machine ──────────────────────────────────
   Allowed transitions (server enforces — clients cannot skip states):
     scheduled    → in_progress | cancelled
     in_progress  → completed   | cancelled
     completed    → moderated   | locked     (admin only)
     moderated    → approved    | completed  (admin can reopen)
     approved     → locked                   (admin only)
     locked       → published   | approved   (unlock = back to approved)
     published    → archived
   ─────────────────────────────────────────────────────────────── */
const EXAM_TRANSITIONS = {
  scheduled:   ['in_progress', 'cancelled'],
  in_progress: ['completed',   'cancelled'],
  completed:   ['moderated',   'locked'],
  moderated:   ['approved',    'completed'],
  approved:    ['locked'],
  locked:      ['published',   'approved'],   // 'approved' = unlock
  published:   ['archived'],
  archived:    [],
  cancelled:   [],
};

/* Roles allowed to drive each transition */
const TRANSITION_ROLES = {
  in_progress: ['teacher', 'admin', 'superadmin'],
  completed:   ['teacher', 'admin', 'superadmin'],
  cancelled:   ['admin', 'superadmin'],
  moderated:   ['admin', 'superadmin'],
  approved:    ['admin', 'superadmin'],
  locked:      ['admin', 'superadmin'],
  published:   ['admin', 'superadmin'],
  archived:    ['admin', 'superadmin'],
};

/* Mark states — distinct from absent boolean for backward compat */
const MARK_STATES = ['present', 'ABS', 'MIS', 'EXM', 'INC'];
// present = has a valid score
// ABS     = absent (not treated as zero — excluded from averages unless school config says otherwise)
// MIS     = missing mark — teacher has not entered score yet (flags for action)
// EXM     = exempted — excluded from averaging entirely
// INC     = incomplete — blocks report approval until resolved

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
  // Extended status — old values (scheduled/in_progress/completed/cancelled) still valid
  status: z.enum([
    'scheduled', 'in_progress', 'completed', 'cancelled',
    'moderated', 'approved', 'locked', 'published', 'archived'
  ]).default('scheduled'),
  // Teacher-subject ownership (set when creating — used for validation)
  ownerId:       z.string().optional(),   // userId of subject teacher who owns this exam
  weightPercent: z.number().min(0).max(100).optional(),  // how much this exam contributes to term grade
  // Assessment type linkage (v4.33.0) — connected to academic-config assessmentWeights
  assessmentType:  z.string().max(50).optional(),   // key from assessmentWeights, e.g. 'midterm', 'classwork'
  assessmentLabel: z.string().max(100).optional(),  // display label, e.g. 'Mid-Term Exam', 'CA 1'
  termLabel:       z.string().max(100).optional(),  // denormalized term name, e.g. 'Term 1'
  subjectName:     z.string().max(100).optional(),  // denormalized subject name for quick display
});

const ResultSchema = z.object({
  studentId:  z.string().min(1),
  score:      z.number().min(0).optional(),  // optional — absent/missing/exempted have no score
  // markState replaces absent:boolean — backward-compat: absent:true → ABS, absent:false → present
  markState:  z.enum(MARK_STATES).default('present'),
  absent:     z.boolean().default(false),    // kept for backward compat — derived from markState
  notes:      z.string().max(500).optional(),
  gradedBy:   z.string().optional(),         // overridden by JWT
  // Audit: who entered/changed this result
  actingAs:   z.string().optional(),         // if admin acting as teacher: teacherId
});

const BulkResultSchema = z.object({
  results: z.array(ResultSchema).min(1).max(500),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/** Validate exam status transition — returns error string or null */
function _checkTransition(fromStatus, toStatus, userRole) {
  const allowed = EXAM_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return `Cannot transition from "${fromStatus}" to "${toStatus}". Allowed next states: [${allowed.join(', ')}]`;
  }
  const roleOk = TRANSITION_ROLES[toStatus] || [];
  if (roleOk.length && !roleOk.includes(userRole)) {
    return `Your role ("${userRole}") cannot set status to "${toStatus}"`;
  }
  return null;
}

/** Resolve markState + absent for backward compat.
 *  If markState is given, derive absent from it.
 *  If only absent is given, derive markState from it. */
function _resolveMarkState(data) {
  if (data.markState && data.markState !== 'present') {
    return { markState: data.markState, absent: data.markState === 'ABS', score: null };
  }
  if (data.absent === true && (!data.markState || data.markState === 'present')) {
    return { markState: 'ABS', absent: true, score: null };
  }
  return { markState: 'present', absent: false, score: data.score ?? null };
}

/* ══════════════════════════════════════════════════════════════
   EXAMS
   ══════════════════════════════════════════════════════════════ */

router.get('/', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _cid = strParam(req.query.classId);
    const _sub = strParam(req.query.subjectId);
    const _tid = strParam(req.query.termId);
    const _ay  = strParam(req.query.academicYearId);
    const _typ = strParam(req.query.type);
    const _st  = strParam(req.query.status);
    if (_cid) filter.classId        = _cid;
    if (_sub) filter.subjectId      = _sub;
    if (_tid) filter.termId         = _tid;
    if (_ay)  filter.academicYearId = _ay;
    if (_typ) filter.type           = _typ;
    if (_st)  filter.status         = _st;

    const _at = strParam(req.query.assessmentType);
    const _tl = strParam(req.query.termLabel);
    if (_at) filter.assessmentType = _at;
    if (_tl) filter.termLabel      = _tl;

    const _df = strParam(req.query.dateFrom);
    const _dt = strParam(req.query.dateTo);
    if (_df || _dt) {
      filter.date = {};
      if (_df) filter.date.$gte = _df;
      if (_dt) filter.date.$lte = _dt;
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

    // Enrich with subject names and class names via FK lookup
    const subjectIds = [...new Set(docs.map(d => d.subjectId).filter(Boolean))];
    const classIds   = [...new Set(docs.map(d => d.classId).filter(Boolean))];
    const [subjectDocs, classDocs] = await Promise.all([
      subjectIds.length ? _model('subjects').find({ id: { $in: subjectIds }, schoolId }).select('id name').lean() : Promise.resolve([]),
      classIds.length   ? _model('classes').find({ id: { $in: classIds }, schoolId }).select('id name').lean()   : Promise.resolve([]),
    ]);
    const subjectMap = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));
    const classMap   = Object.fromEntries(classDocs.map(c => [c.id, c.name]));
    const enriched   = docs.map(d => ({
      ...d,
      subjectName: d.subjectId ? (subjectMap[d.subjectId] ?? d.subjectName ?? null) : (d.subjectName ?? null),
      className:   d.classId   ? (classMap[d.classId]     ?? d.className   ?? null) : (d.className   ?? null),
    }));

    return ok(res, enriched, paginate(page, limit, total));
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
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(ExamSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const existing = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Exam not found');

    // Block edits to locked/published/archived exams (except by admin via unlock flow)
    if (['locked', 'published', 'archived'].includes(existing.status) && !data.status) {
      return E.badRequest(res, `Exam is "${existing.status}" — use the unlock endpoint to allow edits`);
    }

    // Validate status transition if status is being changed
    if (data.status && data.status !== existing.status) {
      const transitionError = _checkTransition(existing.status, data.status, role);
      if (transitionError) return E.badRequest(res, transitionError);

      // Log the transition in audit
      data.statusChangedBy = userId;
      data.statusChangedAt = new Date().toISOString();
      data.statusHistory   = [
        ...(existing.statusHistory || []),
        { from: existing.status, to: data.status, by: userId, at: new Date().toISOString(), reason: req.body.reason || '' }
      ];
    }

    const doc = await _model('exams').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
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
   EXAM STATUS MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

/** POST /api/exams/:id/lock — admin locks an exam (approved → locked) */
router.post('/:id/lock', authMiddleware, PLAN, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'superadmin'].includes(role)) return E.forbidden(res, 'Only admins can lock exams');

    const exam = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    const transitionError = _checkTransition(exam.status, 'locked', role);
    if (transitionError) return E.badRequest(res, transitionError);

    const now = new Date().toISOString();
    const doc = await _model('exams').findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        status: 'locked', lockedBy: userId, lockedAt: now, updatedBy: userId,
        $push: { statusHistory: { from: exam.status, to: 'locked', by: userId, at: now, reason: req.body.reason || 'Admin locked' } }
      },
      { new: true }
    ).lean();

    console.log(`[EXAMS] Locked exam "${exam.title}" by ${userId}`);
    return ok(res, doc);
  } catch (err) { console.error('[exams/:id/lock]', err); return E.serverError(res); }
});

/** POST /api/exams/:id/unlock — admin unlocks (locked → approved) with mandatory reason */
router.post('/:id/unlock', authMiddleware, PLAN, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'superadmin'].includes(role)) return E.forbidden(res, 'Only admins can unlock exams');

    const reason = (req.body.reason || '').trim();
    if (!reason) return E.badRequest(res, 'A reason is required when unlocking an exam');

    const exam = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');
    if (exam.status !== 'locked') return E.badRequest(res, `Exam is "${exam.status}" — only locked exams can be unlocked`);

    const now = new Date().toISOString();
    const doc = await _model('exams').findOneAndUpdate(
      { id: req.params.id, schoolId },
      {
        status: 'approved', unlockedBy: userId, unlockedAt: now, unlockReason: reason, updatedBy: userId,
        $push: { statusHistory: { from: 'locked', to: 'approved', by: userId, at: now, reason } }
      },
      { new: true }
    ).lean();

    // Write to audit log
    await _model('mark_audit_log').create({
      action: 'EXAM_UNLOCKED', examId: req.params.id, schoolId,
      editedBy: userId, reason, timestamp: now
    });

    console.log(`[EXAMS] Unlocked exam "${exam.title}" by ${userId}: ${reason}`);
    return ok(res, doc);
  } catch (err) { console.error('[exams/:id/unlock]', err); return E.serverError(res); }
});

/** GET /api/exams/:id/status-history — audit trail of status changes */
router.get('/:id/status-history', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const exam = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');
    return ok(res, { examId: req.params.id, title: exam.title, currentStatus: exam.status, history: exam.statusHistory || [] });
  } catch (err) { console.error('[exams/:id/status-history]', err); return E.serverError(res); }
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
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(BulkResultSchema, req.body);
    if (error) return E.validation(res, error);

    const exam = await _model('exams').findOne({ id: req.params.id, schoolId }).lean();
    if (!exam) return E.notFound(res, 'Exam not found');

    // Block writes to locked/published/archived exams
    if (['locked', 'published', 'archived'].includes(exam.status)) {
      return E.badRequest(res, `Exam is "${exam.status}" — results are read-only. An admin must unlock it to allow changes.`);
    }

    // Block writes to archived academic years — log the attempt for auditability
    if (await isYearArchived(schoolId, exam.academicYearId)) {
      _model('mark_audit_log').create({
        action:        'WRITE_BLOCKED_ARCHIVED_YEAR',
        schoolId,
        academicYearId: exam.academicYearId,
        examId:        req.params.id,
        route:         'POST /api/exams/:id/results',
        attemptedBy:   userId,
        payload:       { resultCount: data.results.length },
        timestamp:     new Date().toISOString(),
      }).catch(e => console.error('[exams/results] audit log failed:', e.message));
      return E.badRequest(res, `Academic year for this exam has been archived — results are permanently read-only.`);
    }

    // Teacher ownership check — if enforced, only the exam owner (or admin) can write results
    if (exam.ownerId && exam.ownerId !== userId && !['admin', 'superadmin'].includes(role)) {
      return E.forbidden(res, 'Only the assigned subject teacher can enter results for this exam');
    }

    // If admin is acting as teacher, require actingAs field
    const actingAs = req.body.actingAs || null;
    if (['admin', 'superadmin'].includes(role) && actingAs) {
      // Will be written to audit log
    }

    // Validate scores — only 'present' results require a score; ABS/MIS/EXM/INC do not
    const presentResults = data.results.filter(r => r.markState === 'present' && !r.absent);
    const overscored = presentResults.filter(r => r.score != null && r.score > exam.maxScore);
    if (overscored.length) {
      return E.badRequest(res, `${overscored.length} result(s) exceed the exam maximum score of ${exam.maxScore}`);
    }

    // Fetch existing results for audit trail
    const existingResults = await _model('exam_results').find({
      schoolId, examId: req.params.id,
      studentId: { $in: data.results.map(r => r.studentId) }
    }).lean();
    const existingMap = Object.fromEntries(existingResults.map(r => [r.studentId, r]));

    const now    = new Date().toISOString();
    const auditEntries = [];
    const Results = _model('exam_results');

    const ops = data.results.map(r => {
      const resolved  = _resolveMarkState(r);
      const gradeInfo = resolved.markState === 'present' && resolved.score != null
        ? _calcGrade(resolved.score, exam.maxScore, exam.gradeScale || [])
        : null;

      // Build audit entry if score changed
      const existing = existingMap[r.studentId];
      if (existing && existing.score !== resolved.score) {
        auditEntries.push({
          action:        'RESULT_UPDATED',
          examId:        req.params.id,
          studentId:     r.studentId,
          subjectId:     exam.subjectId,
          schoolId,
          editedBy:      userId,
          actingAs:      actingAs || null,
          previousValue: existing.score,
          previousState: existing.markState || (existing.absent ? 'ABS' : 'present'),
          newValue:      resolved.score,
          newState:      resolved.markState,
          reason:        r.notes || '',
          timestamp:     now,
        });
      }

      return {
        updateOne: {
          filter: { schoolId, examId: req.params.id, studentId: r.studentId },
          update: {
            $set: {
              score:      resolved.score,
              markState:  resolved.markState,
              absent:     resolved.absent,          // backward compat
              notes:      r.notes || '',
              gradedBy:   userId,
              updatedBy:  userId,
              examId:     req.params.id,
              schoolId,
              studentId:  r.studentId,
              classId:    exam.classId,
              subjectId:  exam.subjectId,
              updatedAt:  now,
              ...(gradeInfo || {}),
            },
            $setOnInsert: { id: uuidv4(), createdBy: userId, createdAt: now }
          },
          upsert: true
        }
      };
    });

    const [result] = await Promise.all([
      Results.bulkWrite(ops, { ordered: false }),
      auditEntries.length ? _model('mark_audit_log').insertMany(auditEntries) : Promise.resolve()
    ]);

    // Auto-advance exam to 'completed' when marks are first entered
    if (['scheduled', 'in_progress'].includes(exam.status)) {
      await _model('exams').updateOne({ id: req.params.id }, { status: 'completed', updatedBy: userId });
    }

    // Check for any INC/MIS marks remaining — surface as warning, not error
    const incCount = data.results.filter(r => ['INC', 'MIS'].includes(r.markState)).length;

    return ok(res, {
      upserted:  result.upsertedCount,
      modified:  result.modifiedCount,
      total:     data.results.length,
      audited:   auditEntries.length,
      warnings:  incCount ? [`${incCount} result(s) marked as INC/MIS — resolve before approving`] : [],
    }, null, 201);
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
