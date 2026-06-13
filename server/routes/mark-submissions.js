/* ============================================================
   Msingi — /api/mark-submissions
   Multi-step CA mark approval workflow.

   Status machine:
     draft → submitted (teacher) → approved (section head / admin)
           → rejected (back to draft with reason)
           → locked   (post-publish, system)

   Unlock requires an explicit request + admin approval.

   Plan: standard  |  RBAC: grades:{read,create,update}
   ============================================================ */
'use strict';

const express            = require('express');
const { v4: uuidv4 }    = require('uuid');
const { z }              = require('zod');
const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('mark_submissions');

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'locked'];

const SubmitSchema = z.object({
  classId:        z.string().min(1),
  subjectId:      z.string().min(1),
  termNumber:     z.number().int().min(1).max(3),
  academicYearId: z.string().optional().nullable(),
  assessmentType: z.string().min(1),
  instance:       z.number().int().min(1).default(1),
  examSeriesId:   z.string().optional().nullable(),
  notes:          z.string().max(1000).optional(),
});

const ReviewSchema = z.object({
  action:          z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(1000).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/mark-submissions ──────────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.assessmentType) filter.assessmentType = req.query.assessmentType;
    if (req.query.status)         filter.status         = req.query.status;
    if (req.query.examSeriesId)   filter.examSeriesId   = req.query.examSeriesId;

    const docs = await _model('mark_submissions')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[mark-submissions GET /]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/mark-submissions/:id ─────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('mark_submissions').findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Submission not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions GET /:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions  (teacher submits marks) ── */
router.post('/', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SubmitSchema, req.body);
    if (error) return E.validation(res, error);

    // Snapshot current marks for audit trail
    const markFilter = {
      schoolId,
      classId:        data.classId,
      subjectId:      data.subjectId,
      termNumber:     data.termNumber,
      assessmentType: data.assessmentType,
      instance:       data.instance,
    };
    if (data.academicYearId) markFilter.academicYearId = data.academicYearId;
    const marks = await _model('assessment_marks').find(markFilter).select('studentId rawScore').lean();

    // Upsert: one submission per class/subject/term/type/instance combination
    const now = new Date().toISOString();
    const existing = await _model('mark_submissions').findOne({ schoolId, ...markFilter }).lean();

    if (existing) {
      if (existing.status === 'locked') {
        return res.status(400).json({ error: 'These marks are locked. Submit an unlock request instead.' });
      }
      if (existing.status === 'submitted' || existing.status === 'approved') {
        return res.status(400).json({ error: `Marks are already ${existing.status}. Recall first to re-submit.` });
      }
      // Re-submit (from draft or rejected)
      const doc = await _model('mark_submissions').findOneAndUpdate(
        { id: existing.id },
        {
          $set: {
            status:          'submitted',
            submittedBy:     userId,
            submittedAt:     now,
            updatedAt:       now,
            marksSnapshot:   marks,
            notes:           data.notes ?? existing.notes,
            examSeriesId:    data.examSeriesId ?? existing.examSeriesId,
            reviewedBy:      null,
            reviewedAt:      null,
            rejectionReason: null,
          },
        },
        { new: true }
      ).lean();
      return ok(res, doc);
    }

    const doc = await _model('mark_submissions').create({
      ...markFilter,
      id:              uuidv4(),
      schoolId,
      examSeriesId:    data.examSeriesId ?? null,
      notes:           data.notes ?? null,
      status:          'submitted',
      submittedBy:     userId,
      submittedAt:     now,
      marksSnapshot:   marks,
      reviewedBy:      null,
      reviewedAt:      null,
      rejectionReason: null,
      createdAt:       now,
      updatedAt:       now,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[mark-submissions POST /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/recall  (teacher recalls) */
router.post('/:id/recall', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const sub = await _model('mark_submissions').findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status === 'locked') return res.status(400).json({ error: 'Cannot recall locked marks.' });
    if (sub.status === 'approved') return res.status(400).json({ error: 'Cannot recall an approved submission without admin override.' });
    if (sub.status !== 'submitted') return res.status(400).json({ error: `Cannot recall a ${sub.status} submission.` });

    const doc = await _model('mark_submissions').findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'draft', updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/recall]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/review  (admin/section head reviews) */
router.post('/:id/review', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'principal', 'section_head'].includes(role)) {
      return E.forbidden(res, 'Only admins and section heads can review submissions.');
    }
    const { data, error } = _validate(ReviewSchema, req.body);
    if (error) return E.validation(res, error);

    const sub = await _model('mark_submissions').findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status !== 'submitted') {
      return res.status(400).json({ error: `Cannot review a ${sub.status} submission.` });
    }

    const now    = new Date().toISOString();
    const update = {
      reviewedBy: userId,
      reviewedAt: now,
      updatedAt:  now,
      status:     data.action === 'approve' ? 'approved' : 'rejected',
    };
    if (data.action === 'reject') {
      update.rejectionReason = data.rejectionReason ?? 'No reason given';
    }

    const doc = await _model('mark_submissions').findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/review]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/lock  (system — called by report-cards publish) */
router.post('/:id/lock', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'principal'].includes(role)) {
      return E.forbidden(res, 'Only admins and principals can lock submissions.');
    }
    const sub = await _model('mark_submissions').findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status === 'locked') return ok(res, sub);  // idempotent

    const doc = await _model('mark_submissions').findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'locked', lockedBy: userId, lockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();

    // Also lock the underlying assessment_marks records
    const markFilter = {
      schoolId,
      classId:        sub.classId,
      subjectId:      sub.subjectId,
      termNumber:     sub.termNumber,
      assessmentType: sub.assessmentType,
      instance:       sub.instance,
    };
    await _model('assessment_marks').updateMany(markFilter, {
      $set: { isLocked: true, lockedAt: new Date().toISOString(), lockedBySubmissionId: sub.id },
    });

    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/lock]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/unlock  (admin unlocks with reason) */
router.post('/:id/unlock', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'principal'].includes(role)) {
      return E.forbidden(res, 'Only admins and principals can unlock submissions.');
    }
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'An unlock reason is required.' });
    }

    const sub = await _model('mark_submissions').findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status !== 'locked') return res.status(400).json({ error: 'Submission is not locked.' });

    const now = new Date().toISOString();
    const doc = await _model('mark_submissions').findOneAndUpdate(
      { id: req.params.id },
      {
        $set:  { status: 'approved', unlockedBy: userId, unlockedAt: now, unlockReason: reason.trim(), updatedAt: now },
        $push: { unlockLog: { by: userId, at: now, reason: reason.trim() } },
      },
      { new: true }
    ).lean();

    // Unlock the underlying marks
    const markFilter = {
      schoolId,
      classId:        sub.classId,
      subjectId:      sub.subjectId,
      termNumber:     sub.termNumber,
      assessmentType: sub.assessmentType,
      instance:       sub.instance,
    };
    await _model('assessment_marks').updateMany(markFilter, {
      $set: { isLocked: false, unlockedAt: now },
    });

    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/unlock]', err);
    return E.serverError(res);
  }
});

module.exports = router;
