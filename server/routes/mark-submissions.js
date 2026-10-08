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
const { moduleGate }     = require('../middleware/module-gate');
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const AuditService = require('../services/audit');
const { getWorkflowConfig, resolveStep } = require('../utils/workflow-config');
const { enqueueJob, registerHandler } = require('../utils/job-queue');
const { _model } = require('../utils/model');
const { isManagement } = require('../utils/subject-scope');
const { isElective, canTeachElective } = require('../utils/elective-scope');
const { restrictToTaught, taughtPairs } = require('../utils/teaching-scope');

const router = express.Router();
const PLAN   = planGate('mark_submissions');
const MODGATE = moduleGate('grades');

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'locked'];
const MARKS_UNLOCK_WORKFLOW_KEY = 'marks_unlock';
const MARKS_REVIEW_WORKFLOW_KEY = 'marks_review';
const RELOCK_DELAY_MS = 24 * 60 * 60 * 1000; // 24h — Governance Spec §3

// Same helper, same precedent, as assessment.js's/academic-calc.js's own
// _yearFilterPart — matches the given year OR a legacy null-tagged row,
// never a DIFFERENT explicitly-tagged year. Needed here (not imported —
// neither of those files exports it) for GET / below. A falsy input
// returns {} (no filter), the right default for a LIST endpoint: "no
// year given" reasonably means "show every year" (same convention
// GET /schedule in assessment.js already uses).
function _yearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : {};
}

// Same precedent, but NOT identical — see _yearFilterPart's own comment
// on why a bare {} default is right for a list. A lock is a narrowing,
// mutating action, not a list: if the submission itself has no
// academicYearId (a legacy row predating consistent year-tagging), it
// must still only touch OTHER legacy-tagged marks, never silently fall
// through to "every year's marks for this natural key" the way a bare
// {} filter would.
function _lockYearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : { $or: [{ academicYearId: null }, { academicYearId: { $exists: false } }] };
}

const SubmitSchema = z.object({
  classId:        z.string().min(1),
  subjectId:      z.string().min(1),
  termNumber:     z.number().int().min(1).max(3),
  academicYearId: z.string().optional().nullable(),
  assessmentType: z.string().min(1),
  instance:       z.number().int().min(1).default(1),
  examSeriesId:   z.string().optional().nullable(),
  // A submission is per stream: a teacher submits the stream they teach. Absent =
  // legacy whole-class submission (covers every stream), kept for existing rows.
  streamId:       z.string().optional().nullable(),
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
router.get('/', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    // _yearFilterPart, not a strict equality match — the Markbook grid
    // (ExamsPage.jsx) now always sends its resolved academicYearId (see
    // its submit call and this fix's own notes elsewhere in this file),
    // and a strict match here would have hidden every submission created
    // before that — the exact backward-compat concern _yearFilterPart
    // exists for everywhere else it's used.
    Object.assign(filter, _yearFilterPart(req.query.academicYearId || null));
    if (req.query.assessmentType) filter.assessmentType = req.query.assessmentType;
    if (req.query.status)         filter.status         = req.query.status;
    if (req.query.examSeriesId)   filter.examSeriesId   = req.query.examSeriesId;
    // Same rule the mark guards use: this stream's submissions, plus legacy whole-class ones.
    if (req.query.streamId)       filter.streamId       = { $in: [req.query.streamId, null] };

    // Submissions carry marks snapshots: only the subjects this caller teaches.
    await restrictToTaught(req, filter);
    const docs = await tenantModel('mark_submissions', tenantContext(req))
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
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('mark_submissions', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Submission not found');
    const pairs = await taughtPairs(req);
    if (pairs && !pairs.some(p => p.classId === doc.classId && p.subjectId === doc.subjectId && (!p.streamId || !doc.streamId || p.streamId === doc.streamId))) {
      return E.forbidden(res, 'You do not teach this subject in this class.');
    }
    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions GET /:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions  (teacher submits marks) ── */
router.post('/', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SubmitSchema, req.body);
    if (error) return E.validation(res, error);

    // A teacher whose assignment is for one stream submits that stream. A whole-class
    // submission (no streamId) would lock every stream of the class, so it is only
    // open to management and to a whole-class assignment.
    // An elective is one group across streams: no stream, and the caller must teach it.
    const elective = await isElective(req, data.classId, data.subjectId);
    if (elective) {
      data.streamId = null;
      if (!(await canTeachElective(req, data.classId, data.subjectId))) {
        return E.forbidden(res, 'You are not assigned to teach this elective in this class.');
      }
    } else if (!data.streamId && !isManagement(req)) {
      const wholeClass = await tenantModel('teaching_assignments', tenantContext(req)).findOne({
        schoolId, teacherId: userId, classId: data.classId, subjectId: data.subjectId,
        $or: [{ streamId: null }, { streamId: { $exists: false } }],
      }).select('id').lean();
      if (!wholeClass) return E.forbidden(res, 'Submit marks per stream — choose the stream you teach.');
    }

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
    if (data.streamId) markFilter.streamId = data.streamId;
    const marks = await tenantModel('assessment_marks', tenantContext(req)).find(markFilter).select('studentId rawScore').lean();

    // Upsert: one submission per class/subject/term/type/instance combination
    const now = new Date().toISOString();
    const existing = await tenantModel('mark_submissions', tenantContext(req)).findOne({ schoolId, ...markFilter }).lean();

    // For the reviewer notification only — best-effort, never blocks the submit itself.
    const [classDoc, subjectDoc] = await Promise.all([
      tenantModel('classes',  tenantContext(req)).findOne({ id: data.classId,   schoolId }).select('name').lean(),
      tenantModel('subjects', tenantContext(req)).findOne({ id: data.subjectId, schoolId }).select('name').lean(),
    ]);
    const notifyLabel = `${subjectDoc?.name ?? data.subjectId} — ${classDoc?.name ?? data.classId}`;
    const notifyBody  = `${data.assessmentType} marks for Term ${data.termNumber} have been submitted for review.`;

    if (existing) {
      if (existing.status === 'locked') {
        return res.status(400).json({ error: 'These marks are locked. Submit an unlock request instead.' });
      }
      if (existing.status === 'submitted' || existing.status === 'approved') {
        return res.status(400).json({ error: `Marks are already ${existing.status}. Recall first to re-submit.` });
      }
      // Re-submit (from draft or rejected)
      const doc = await tenantModel('mark_submissions', tenantContext(req)).findOneAndUpdate(
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
      await _notifyReviewers(req, notifyLabel, notifyBody);
      return ok(res, doc);
    }

    const doc = await tenantModel('mark_submissions', tenantContext(req)).create({
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
    await _notifyReviewers(req, notifyLabel, notifyBody);
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[mark-submissions POST /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/recall  (teacher recalls) */
router.post('/:id/recall', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const sub = await tenantModel('mark_submissions', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status === 'locked') return res.status(400).json({ error: 'Cannot recall locked marks.' });
    if (sub.status === 'approved') return res.status(400).json({ error: 'Cannot recall an approved submission without admin override.' });
    if (sub.status !== 'submitted') return res.status(400).json({ error: `Cannot recall a ${sub.status} submission.` });

    const doc = await tenantModel('mark_submissions', tenantContext(req)).findOneAndUpdate(
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
router.post('/:id/review', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    // Permission Granularity Plan 2026-09, Priority 0 — this was an
    // unconditional hardcoded role list, invisible to and unconfigurable
    // from Settings (a BYPASS finding — found while implementing this
    // fix, not originally documented at this precision in the Plan).
    // admin/principal/section_head remain an unconditional floor, and a
    // school can additionally grant grades.mark_submissions to another
    // role/person via Settings. Uses hasExplicitSubGrant (no coarse
    // fallback) for the same reason as report-card publishing: falling
    // back to plain grades:update would hand reviewer authority to any
    // teacher who can edit their own marks — the exact separation of
    // duties this permission exists to enforce.
    const isFloorRole = ['admin', 'principal', 'section_head'].includes(role);
    if (!isFloorRole && !(await hasExplicitSubGrant(req, 'grades', 'mark_submissions', 'update'))) {
      return E.forbidden(res, 'Only admins, principals, section heads, or explicitly granted reviewers can review submissions.');
    }
    const { data, error } = _validate(ReviewSchema, req.body);
    if (error) return E.validation(res, error);

    const sub = await tenantModel('mark_submissions', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
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

    const doc = await tenantModel('mark_submissions', tenantContext(req)).findOneAndUpdate(
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

/* ── Unlock-workflow helpers (Governance Spec §3) ──────────── */

/* Submitted-for-review notification — nothing told a reviewer a submission
   was waiting before this; the only existing notify path (_notifyUnlockParties
   below) fires on the unlock-request step, well past where a reviewer first
   needs to know. Same shape/fallback as that one: a configured marks_review
   workflow step if the school has set one (none do yet — no Settings UI
   exposes this key — so this always falls through to the actual floor roles
   the /review route itself enforces, admin/principal/section_head, today). */
async function _notifyReviewers(req, label, body) {
  try {
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    const config = await getWorkflowConfig(ctx, schoolId, MARKS_REVIEW_WORKFLOW_KEY);
    const Users = tenantModel('users', ctx);
    const targets = config
      ? await resolveStep(ctx, schoolId, config.steps[0])
      : await Users.find({ schoolId, role: { $in: ['admin', 'principal', 'section_head'] }, isActive: { $ne: false } }).select('id').lean();
    for (const u of targets) {
      await tenantModel('messages', ctx).create({
        id: uuidv4(), schoolId, senderId: req.jwtUser.userId, senderName: 'System', senderRole: 'system',
        recipients: [u.id], subject: 'Marks submitted for review', body: `${label}: ${body}`, type: 'direct', isRead: {}, createdAt: new Date().toISOString(),
      });
    }
  } catch (err) { console.error('[mark-submissions notify reviewers]', err); }
}

async function _notifyUnlockParties(req, sub, subject, body) {
  try {
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    const config = await getWorkflowConfig(ctx, schoolId, MARKS_UNLOCK_WORKFLOW_KEY);
    const Users = tenantModel('users', ctx);
    const targets = config
      ? await resolveStep(ctx, schoolId, config.steps[0])
      : await Users.find({ schoolId, role: { $in: ['admin', 'principal'] }, isActive: { $ne: false } }).select('id').lean();
    for (const u of targets) {
      await tenantModel('messages', ctx).create({
        id: uuidv4(), schoolId, senderId: req.jwtUser.userId, senderName: 'System', senderRole: 'system',
        recipients: [u.id], subject, body, type: 'direct', isRead: {}, createdAt: new Date().toISOString(),
      });
    }
  } catch (err) { console.error('[mark-submissions notify unlock]', err); }
}

async function _notifyUser(req, userId, subject, body) {
  try {
    const { schoolId } = req.jwtUser;
    await tenantModel('messages', tenantContext(req)).create({
      id: uuidv4(), schoolId, senderId: req.jwtUser.userId, senderName: 'System', senderRole: 'system',
      recipients: [userId], subject, body, type: 'direct', isRead: {}, createdAt: new Date().toISOString(),
    });
  } catch (err) { console.error('[mark-submissions notify user]', err); }
}

/* 24h auto-relock — runs with no req (background worker), so it uses the
   raw _model() directly, filtered explicitly by schoolId (the tenant-
   isolation posture other background jobs, e.g. audit.js's webhook
   handler, already use). Only re-locks if the submission is still in the
   post-unlock 'approved' state — an admin who already manually re-locked
   or otherwise moved it on is never clobbered. */
async function _autoRelock(payload) {
  const { submissionId, schoolId } = payload || {};
  if (!submissionId || !schoolId) return;
  const Sub = _model('mark_submissions');
  const sub = await Sub.findOne({ id: submissionId, schoolId }).lean();
  if (!sub || sub.status !== 'approved') return;

  const now = new Date().toISOString();
  await Sub.updateOne(
    { id: submissionId, schoolId },
    { $set: { status: 'locked', lockedBy: 'system_auto_relock', lockedAt: now, updatedAt: now, unlockRequestStatus: null } },
  );
  const markFilter = {
    schoolId, classId: sub.classId, subjectId: sub.subjectId,
    termNumber: sub.termNumber, assessmentType: sub.assessmentType, instance: sub.instance,
    ...(sub.streamId ? { streamId: sub.streamId } : {}),
  };
  await _model('assessment_marks').updateMany(markFilter, { $set: { isLocked: true, lockedAt: now, lockedBySubmissionId: sub.id } });
  await AuditService.log({
    action: 'marks.auto_relocked', actor: { userId: 'system', role: 'system', email: null }, schoolId,
    target: { type: 'mark_submission', id: sub.id }, details: {},
  });
}
registerHandler('marks_relock', _autoRelock);

/* ── POST /api/mark-submissions/:id/request-unlock ──────────── */
router.post('/:id/request-unlock', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role, email } = req.jwtUser;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to request an unlock.' });

    const ctx = tenantContext(req);
    const Sub = tenantModel('mark_submissions', ctx);
    const sub = await Sub.findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status !== 'locked') return res.status(400).json({ error: 'Only a locked submission can have an unlock requested.' });
    if (sub.unlockRequestStatus === 'pending') return res.status(400).json({ error: 'An unlock request is already pending.' });

    const now = new Date().toISOString();
    const doc = await Sub.findOneAndUpdate(
      { id: req.params.id },
      { $set: { unlockRequestStatus: 'pending', unlockRequestedBy: userId, unlockRequestedAt: now, unlockRequestReason: reason.trim() } },
      { new: true }
    ).lean();

    await AuditService.log({
      action: 'marks.unlock_requested', actor: { userId, role, email }, schoolId,
      target: { type: 'mark_submission', id: doc.id }, details: { reason: reason.trim() }, req,
    });
    await _notifyUnlockParties(req, doc, 'Mark-unlock request pending your review', reason.trim());

    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/request-unlock]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/reject-unlock-request ───── */
router.post('/:id/reject-unlock-request', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role, email } = req.jwtUser;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to reject an unlock request.' });

    const ctx = tenantContext(req);
    const Sub = tenantModel('mark_submissions', ctx);
    const sub = await Sub.findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.unlockRequestStatus !== 'pending') return res.status(400).json({ error: 'No unlock request is pending.' });

    const config = await getWorkflowConfig(ctx, schoolId, MARKS_UNLOCK_WORKFLOW_KEY);
    if (config) {
      const eligible = await resolveStep(ctx, schoolId, config.steps[0]);
      if (!eligible.some(u => u.id === userId)) {
        return res.status(403).json({ error: 'You are not the configured approver for unlock requests.' });
      }
    } else if (!['admin', 'principal'].includes(role)) {
      return E.forbidden(res, 'Only admins and principals can decide unlock requests.');
    }

    const doc = await Sub.findOneAndUpdate(
      { id: req.params.id },
      { $set: { unlockRequestStatus: 'rejected', updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();

    await AuditService.log({
      action: 'marks.unlock_request_rejected', actor: { userId, role, email }, schoolId,
      target: { type: 'mark_submission', id: doc.id }, details: { reason: reason.trim() }, req,
    });
    if (sub.unlockRequestedBy) await _notifyUser(req, sub.unlockRequestedBy, 'Unlock request declined', reason.trim());

    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/reject-unlock-request]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/lock  (system — called by report-cards publish) */
router.post('/:id/lock', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'principal'].includes(role)) {
      return E.forbidden(res, 'Only admins and principals can lock submissions.');
    }
    const sub = await tenantModel('mark_submissions', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status === 'locked') return ok(res, sub);  // idempotent

    const doc = await tenantModel('mark_submissions', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id },
      { $set: { status: 'locked', lockedBy: userId, lockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();

    // Also lock the underlying assessment_marks records. academicYearId
    // included (via _lockYearFilterPart) — found during a full exam-config →
    // Markbook → report-card flow audit: without it, locking THIS
    // submission (one specific academic year's window) also silently
    // locked every OTHER year's assessment_marks sharing the same class/
    // subject/term/type/instance/stream — e.g. locking this year's Term 2
    // CA1 submission would also re-lock last year's already-settled Term
    // 2 CA1 marks, and vice versa were a historical submission ever
    // (re-)locked after a new year's matching window opened.
    const markFilter = {
      schoolId,
      classId:        sub.classId,
      subjectId:      sub.subjectId,
      termNumber:     sub.termNumber,
      assessmentType: sub.assessmentType,
      instance:       sub.instance,
      ...(sub.streamId ? { streamId: sub.streamId } : {}),
      ..._lockYearFilterPart(sub.academicYearId || null),
    };
    await tenantModel('assessment_marks', tenantContext(req)).updateMany(markFilter, {
      $set: { isLocked: true, lockedAt: new Date().toISOString(), lockedBySubmissionId: sub.id },
    });

    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/lock]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/mark-submissions/:id/unlock  (approver unlocks with reason) ──
   No workflow_configs('marks_unlock') doc for this school: exactly today's
   behavior, unchanged — unilateral admin/principal action, no request needed.
   A config exists: this route becomes the approval step of a request →
   approve flow — requires a pending unlock request first, and the caller
   must be the config's resolved approver, not just admin/principal. */
router.post('/:id/unlock', authMiddleware, PLAN, MODGATE, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role, email } = req.jwtUser;
    const ctx = tenantContext(req);
    const Sub = tenantModel('mark_submissions', ctx);
    const sub = await Sub.findOne({ id: req.params.id, schoolId }).lean();
    if (!sub) return E.notFound(res, 'Submission not found');
    if (sub.status !== 'locked') return res.status(400).json({ error: 'Submission is not locked.' });

    const config = await getWorkflowConfig(ctx, schoolId, MARKS_UNLOCK_WORKFLOW_KEY);
    let reason = req.body.reason;

    if (config) {
      if (sub.unlockRequestStatus !== 'pending') {
        return res.status(400).json({ error: 'An unlock request must be submitted first.' });
      }
      const eligible = await resolveStep(ctx, schoolId, config.steps[0]);
      if (!eligible.some(u => u.id === userId)) {
        return res.status(403).json({ error: 'You are not the configured approver for unlock requests.' });
      }
      reason = (reason && reason.trim()) || sub.unlockRequestReason;
    } else if (!['admin', 'principal'].includes(role)) {
      return E.forbidden(res, 'Only admins and principals can unlock submissions.');
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'An unlock reason is required.' });
    }

    const now = new Date().toISOString();
    const doc = await Sub.findOneAndUpdate(
      { id: req.params.id },
      {
        $set:  { status: 'approved', unlockedBy: userId, unlockedAt: now, unlockReason: reason.trim(), updatedAt: now, unlockRequestStatus: config ? 'approved' : (sub.unlockRequestStatus ?? null) },
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
      ...(sub.streamId ? { streamId: sub.streamId } : {}),
    };
    await tenantModel('assessment_marks', ctx).updateMany(markFilter, {
      $set: { isLocked: false, unlockedAt: now },
    });

    await AuditService.log({
      action: 'marks.unlocked', actor: { userId, role, email }, schoolId,
      target: { type: 'mark_submission', id: doc.id }, details: { reason: reason.trim() }, req,
    });

    // Governance Spec §3 — 24h auto-relock via the existing durable job queue.
    await enqueueJob({ type: 'marks_relock', payload: { submissionId: doc.id, schoolId }, runAt: new Date(Date.now() + RELOCK_DELAY_MS) });

    return ok(res, doc);
  } catch (err) {
    console.error('[mark-submissions POST /:id/unlock]', err);
    return E.serverError(res);
  }
});

module.exports = router;
