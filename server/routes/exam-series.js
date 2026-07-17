/* ============================================================
   Msingi — /api/exam-series
   Named groupings of formal exams for a term period.
   Prerequisite for approval workflow and mark locking.

   Status machine:  draft → open → moderation → closed
   Plan: standard  |  RBAC: exams:{read,create,update,delete}
   ============================================================ */
'use strict';

const express            = require('express');
const { v4: uuidv4 }    = require('uuid');
const { z }              = require('zod');
const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('exam_series');

const STATUSES = ['draft', 'open', 'moderation', 'closed'];

const SeriesSchema = z.object({
  name:           z.string().min(1).max(200),
  description:    z.string().max(1000).optional(),
  academicYearId: z.string().optional().nullable(),
  termId:         z.string().optional().nullable(),
  termNumber:     z.number().int().min(1).max(3).optional().nullable(),
  startDate:      z.string().optional().nullable(),
  endDate:        z.string().optional().nullable(),
  classIds:       z.array(z.string()).max(100).optional(),
  examIds:        z.array(z.string()).max(200).optional(),
  status:         z.enum(STATUSES).default('draft'),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/exam-series ───────────────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.status)         filter.status         = req.query.status;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    const docs = await tenantModel('exam_series', tenantContext(req))
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[exam-series GET /]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/exam-series/:id ───────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('exams', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('exam_series', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Exam series not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[exam-series GET /:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/exam-series ──────────────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('exams', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SeriesSchema, req.body);
    if (error) return E.validation(res, error);
    const now = new Date().toISOString();
    const doc = await tenantModel('exam_series', tenantContext(req)).create({
      ...data,
      id:        uuidv4(),
      schoolId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[exam-series POST /]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/exam-series/:id ───────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SeriesSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const existing = await tenantModel('exam_series', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Exam series not found');
    if (existing.status === 'closed') {
      return res.status(400).json({ error: 'A closed series cannot be edited.' });
    }

    const doc = await tenantModel('exam_series', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[exam-series PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/exam-series/:id ────────────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('exams', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const existing = await tenantModel('exam_series', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Exam series not found');
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft series can be deleted.' });
    }
    await tenantModel('exam_series', tenantContext(req)).deleteOne({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[exam-series DELETE /:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/exam-series/:id/exams ────────────────────── add exam to series */
router.post('/:id/exams', authMiddleware, PLAN, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { examId } = req.body;
    if (!examId) return res.status(400).json({ error: 'examId is required' });

    const existing = await tenantModel('exam_series', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Exam series not found');
    if (existing.status === 'closed') {
      return res.status(400).json({ error: 'Cannot add exams to a closed series.' });
    }
    if ((existing.examIds ?? []).includes(examId)) {
      return res.status(400).json({ error: 'Exam already in this series.' });
    }

    const doc = await tenantModel('exam_series', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $push: { examIds: examId }, $set: { updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[exam-series POST /:id/exams]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/exam-series/:id/exams/:examId ──────────── remove exam */
router.delete('/:id/exams/:examId', authMiddleware, PLAN, rbac('exams', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const existing = await tenantModel('exam_series', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Exam series not found');
    if (existing.status === 'closed') {
      return res.status(400).json({ error: 'Cannot modify a closed series.' });
    }
    const doc = await tenantModel('exam_series', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $pull: { examIds: req.params.examId }, $set: { updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[exam-series DELETE /:id/exams/:examId]', err);
    return E.serverError(res);
  }
});

module.exports = router;
