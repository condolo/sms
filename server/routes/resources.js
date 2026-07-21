/* ============================================================
   Msingi — /api/resources  (Governance Spec §5)

   New — no prior "resources"/"links"/shared-repository module existed.
   The "Library" module is an unrelated physical/digital book-lending
   system. Visibility generalizes messages.js's flat role-group keyword
   approach, adding the class/section/individual/custom-group
   granularity that didn't exist anywhere in the codebase before.

   Class/section targeting is resolved against the CALLER's own class
   membership (a student's own class, or a parent's linked children's
   classes) — the realistic "send this to Class 8A" / "send this to the
   whole Secondary section" case. Teacher/staff-side class targeting
   (e.g. "resources for teachers of 8A") is out of scope for this pass;
   staff reach relevant resources via role-based targeting instead.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('resources');

/* Principal/admin see everything unfiltered — matches how audit
   visibility already works for admin roles elsewhere in the codebase. */
const FULL_ACCESS_ROLES = new Set(['admin', 'superadmin', 'principal', 'deputy_principal']);

/* ── Validation ─────────────────────────────────────────────── */
const VisibilitySchema = z.object({
  scope:       z.enum(['all', 'targeted']).default('all'),
  roles:       z.array(z.string().max(50)).max(20).default([]),
  sectionKeys: z.array(z.string().max(30)).max(20).default([]),
  classIds:    z.array(z.string()).max(100).default([]),
  userIds:     z.array(z.string()).max(200).default([]),
  groupId:     z.string().optional().nullable(),
});

const ResourceSchema = z.object({
  title:       z.string().min(1).max(200).trim(),
  description: z.string().max(2000).trim().optional(),
  url:         z.string().url(),
  category:    z.string().max(100).trim().optional(),
  visibility:  VisibilitySchema.default({}),
  expiresAt:   z.string().optional().nullable(),
});

const GroupSchema = z.object({
  name:          z.string().min(1).max(100).trim(),
  memberUserIds: z.array(z.string()).min(1).max(500),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── Visibility resolution ────────────────────────────────────
   Everyone in FULL_ACCESS_ROLES sees everything. Everyone else's
   reads are filtered by whichever visibility dimension matches them. */
async function _visibleFilter(req) {
  const { schoolId, userId, role, studentId, studentIds, guardianOf } = req.jwtUser;
  const today = new Date().toISOString().slice(0, 10);
  const notExpired = { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gte: today } }] };

  if (FULL_ACCESS_ROLES.has(role)) return { schoolId, ...notExpired };

  const ctx = tenantContext(req);
  const or = [
    { 'visibility.scope': 'all' },
    { 'visibility.roles': role },
    { 'visibility.userIds': userId },
  ];

  const groups = await tenantModel('resource_groups', ctx).find({ schoolId, memberUserIds: userId }).select('id').lean();
  if (groups.length) or.push({ 'visibility.groupId': { $in: groups.map(g => g.id) } });

  const relevantStudentIds = role === 'student' && studentId ? [studentId]
    : (role === 'parent' || role === 'guardian') ? (studentIds || guardianOf || [])
    : [];

  if (relevantStudentIds.length) {
    const students = await tenantModel('students', ctx).find({ id: { $in: relevantStudentIds } }).select('classId').lean();
    const classIds = [...new Set(students.map(s => s.classId).filter(Boolean))];
    if (classIds.length) {
      or.push({ 'visibility.classIds': { $in: classIds } });
      const classes = await tenantModel('classes', ctx).find({ id: { $in: classIds } }).select('sectionKey').lean();
      const sectionKeys = [...new Set(classes.map(c => c.sectionKey).filter(Boolean))];
      if (sectionKeys.length) or.push({ 'visibility.sectionKeys': { $in: sectionKeys } });
    }
  }

  return { schoolId, $and: [{ $or: or }, notExpired] };
}

/* ══════════════════════════════════════════════════════════════
   RESOURCES
   ══════════════════════════════════════════════════════════════ */

router.get('/', authMiddleware, PLAN, rbac('resources', 'read'), async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = await _visibleFilter(req);
    const category = strParam(req.query.category);
    if (category) filter.category = category;

    const [docs, total] = await Promise.all([
      tenantModel('resources', tenantContext(req)).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('resources', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[resources GET]', err); return E.serverError(res); }
});

router.get('/:id', authMiddleware, PLAN, rbac('resources', 'read'), async (req, res) => {
  try {
    const filter = await _visibleFilter(req);
    filter.id = req.params.id;
    const doc = await tenantModel('resources', tenantContext(req)).findOne(filter).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Resource not found');
    return ok(res, doc);
  } catch (err) { console.error('[resources GET/:id]', err); return E.serverError(res); }
});

router.post('/', authMiddleware, PLAN, rbac('resources', 'create'), async (req, res) => {
  try {
    const { schoolId, userId, name } = req.jwtUser;
    const { data, error } = _validate(ResourceSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('resources', tenantContext(req)).create({
      ...data,
      id: uuidv4(),
      schoolId,
      creatorId:   userId,
      creatorName: name ?? '',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[resources POST]', err); return E.serverError(res); }
});

router.put('/:id', authMiddleware, PLAN, rbac('resources', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(ResourceSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const Resources = tenantModel('resources', tenantContext(req));
    const existing = await Resources.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Resource not found');
    if (!FULL_ACCESS_ROLES.has(role) && existing.creatorId !== userId) {
      return E.forbidden(res, 'You can only edit resources you shared');
    }

    const doc = await Resources.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedAt: new Date().toISOString() },
      { new: true, runValidators: false }
    ).lean();
    return ok(res, doc);
  } catch (err) { console.error('[resources PUT/:id]', err); return E.serverError(res); }
});

router.delete('/:id', authMiddleware, PLAN, rbac('resources', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const Resources = tenantModel('resources', tenantContext(req));
    const existing = await Resources.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Resource not found');
    if (!FULL_ACCESS_ROLES.has(role) && existing.creatorId !== userId) {
      return E.forbidden(res, 'You can only delete resources you shared');
    }
    await Resources.findOneAndDelete({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[resources DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   CUSTOM GROUPS  — served from /api/resources/groups
   Narrowly scoped to serving Resources visibility, not a general-
   purpose grouping primitive.
   ══════════════════════════════════════════════════════════════ */

router.get('/groups/list', authMiddleware, PLAN, rbac('resources', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const docs = await tenantModel('resource_groups', tenantContext(req)).find({ schoolId }).sort({ name: 1 }).select('-__v').lean();
    return ok(res, docs);
  } catch (err) { console.error('[resources/groups GET]', err); return E.serverError(res); }
});

router.post('/groups', authMiddleware, PLAN, rbac('resources', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(GroupSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('resource_groups', tenantContext(req)).create({
      ...data, id: uuidv4(), schoolId, createdBy: userId, createdAt: new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[resources/groups POST]', err); return E.serverError(res); }
});

router.delete('/groups/:id', authMiddleware, PLAN, rbac('resources', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('resource_groups', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Group not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[resources/groups DELETE/:id]', err); return E.serverError(res); }
});

module.exports = router;
