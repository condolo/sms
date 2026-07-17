/* ============================================================
   Msingi — /api/comment-banks
   Pre-written teacher comment templates for report card remarks.
   Plan: grades (core)
   RBAC: grades:{read,create,update,delete}
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
const PLAN   = planGate('grades');

const CATEGORIES = ['academic', 'behaviour', 'general', 'subject'];

const CommentBankSchema = z.object({
  text:      z.string().min(1).max(500),
  category:  z.enum(CATEGORIES).default('general'),
  subjectId: z.string().optional().nullable(),
  tags:      z.array(z.string().max(30)).max(10).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/comment-banks ──────────────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;
    if (req.query.q) {
      const escaped = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.text   = new RegExp(escaped, 'i');
    }
    const docs = await tenantModel('comment_banks', tenantContext(req))
      .find(filter)
      .sort({ category: 1, createdAt: -1 })
      .limit(500)
      .lean();
    return ok(res, docs);
  } catch (err) {
    console.error('[comment-banks GET /]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/comment-banks ─────────────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CommentBankSchema, req.body);
    if (error) return E.validation(res, error);
    const now = new Date().toISOString();
    const doc = await tenantModel('comment_banks', tenantContext(req)).create({
      ...data,
      id:        uuidv4(),
      schoolId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[comment-banks POST /]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/comment-banks/:id ──────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CommentBankSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    const doc = await tenantModel('comment_banks', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Comment not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[comment-banks PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/comment-banks/:id ──────────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('grades', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('comment_banks', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Comment not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[comment-banks DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
