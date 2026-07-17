/* ============================================================
   Msingi — Lesson Plans
   Teachers plan future lessons by linking to curriculum topics
   and adding objectives, activities, and notes.
   No file uploads — planning only.

   GET  /api/lesson-plans              — list plans (teacher: own; admin: all)
   POST /api/lesson-plans              — create plan
   PUT  /api/lesson-plans/:id          — update plan
   DELETE /api/lesson-plans/:id        — delete plan
   PATCH /api/lesson-plans/:id/deliver — mark as delivered (auto-creates coverage)
   ============================================================ */
'use strict';

const express            = require('express');
const { authMiddleware } = require('../middleware/auth');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }          = require('../utils/response');
const { v4: uuidv4 }     = require('uuid');
const { resolveTeacher } = require('../utils/resolveTeacher');

const router = express.Router();

const ADMIN_ROLES = ['superadmin', 'admin', 'principal', 'head_teacher'];

/* ── helpers ── */
function _isAdmin(req) { return ADMIN_ROLES.includes(req.jwtUser?.role); }
function _isTeacher(req) {
  const r = req.jwtUser?.role;
  return r === 'teacher' || r === 'staff';
}
function _can(req, res) {
  if (!_isTeacher(req) && !_isAdmin(req)) {
    E.forbidden(res, 'Lesson plans require a teacher or admin account.');
    return false;
  }
  return true;
}

const _resolveTeacher = (userId, email, schoolId) =>
  resolveTeacher(userId, email, schoolId, 'firstName lastName email');

/* ══════════════════════════════════════════════════════════════
   GET /api/lesson-plans
   Query params: classId, subjectId, from (ISO date), to (ISO date), status
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, async (req, res) => {
  if (!_can(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, from, to, status } = req.query;

    const LessonPlans = tenantModel('lesson_plans', tenantContext(req));

    const filter = { schoolId };

    // Non-admin teachers see only their own plans
    if (!_isAdmin(req)) {
      const teacher = await _resolveTeacher(userId, req.jwtUser.email, schoolId);
      if (!teacher) return E.forbidden(res, 'Teacher record not found.');
      filter.teacherId = teacher.id;
    }

    if (classId)   filter.classId   = classId;
    if (subjectId) filter.subjectId = subjectId;
    if (status)    filter.status    = status;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to)   filter.date.$lte = to;
    }

    const plans = await LessonPlans.find(filter)
      .sort({ date: 1, startTime: 1 })
      .lean();

    return ok(res, plans);
  } catch (err) {
    console.error('[lesson-plans GET /]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/lesson-plans
   Body: { classId, subjectId, topicId?, topicTitle, date,
           startTime?, objectives?, activities?, notes? }
   ══════════════════════════════════════════════════════════════ */
router.post('/', authMiddleware, async (req, res) => {
  if (!_can(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, topicId, topicTitle, date,
            startTime, objectives, activities, notes } = req.body;

    if (!classId || !subjectId || !topicTitle || !date) {
      return E.badRequest(res, 'classId, subjectId, topicTitle and date are required.');
    }

    const teacher = await _resolveTeacher(userId, req.jwtUser.email, schoolId);
    if (!teacher) {
      // Admin accounts without a staff profile cannot create plans — teacherId
      // would fall back to the auth userId (wrong namespace), corrupting teacher lookups.
      if (!_isAdmin(req)) return E.forbidden(res, 'Teacher record not found.');
      return E.badRequest(res, 'Add a staff profile for your account before creating lesson plans, or use a teacher account.');
    }

    // Verify teacher is assigned to this class+subject (skip for admins)
    if (!_isAdmin(req)) {
      const Assignments = tenantModel('teaching_assignments', tenantContext(req));
      const assigned = await Assignments.findOne({ schoolId, teacherId: teacher.id, classId, subjectId }).lean();
      if (!assigned) {
        return E.forbidden(res, 'You are not assigned to teach this subject in this class.');
      }
    }

    const Classes  = tenantModel('classes', tenantContext(req));
    const Subjects = tenantModel('subjects', tenantContext(req));
    const [cls, sub] = await Promise.all([
      Classes.findOne({ id: classId, schoolId }).select('name').lean().catch(() => null),
      Subjects.findOne({ id: subjectId, schoolId }).select('name').lean().catch(() => null),
    ]);

    const LessonPlans = tenantModel('lesson_plans', tenantContext(req));
    const plan = {
      id:          `lp_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
      schoolId,
      teacherId:   teacher.id,
      teacherName: `${teacher.firstName} ${teacher.lastName}`,
      classId,
      className:   cls?.name || '',
      subjectId,
      subjectName: sub?.name || '',
      topicId:     topicId || null,
      topicTitle:  topicTitle.trim(),
      date,
      startTime:   startTime || null,
      objectives:  objectives?.trim() || '',
      activities:  activities?.trim() || '',
      notes:       notes?.trim() || '',
      status:      'planned',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
    };

    await LessonPlans.create(plan);
    return ok(res, plan, 201);
  } catch (err) {
    console.error('[lesson-plans POST /]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   PUT /api/lesson-plans/:id
   ══════════════════════════════════════════════════════════════ */
router.put('/:id', authMiddleware, async (req, res) => {
  if (!_can(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const LessonPlans = tenantModel('lesson_plans', tenantContext(req));
    const plan = await LessonPlans.findOne({ id: req.params.id, schoolId }).lean();
    if (!plan) return E.notFound(res, 'Lesson plan not found.');

    if (!_isAdmin(req)) {
      const teacher = await _resolveTeacher(userId, req.jwtUser.email, schoolId);
      if (!teacher || plan.teacherId !== teacher.id) {
        return E.forbidden(res, 'You can only edit your own lesson plans.');
      }
    }

    const allowed = ['topicTitle','date','startTime','objectives','activities','notes','status'];
    const updates = { updatedAt: new Date().toISOString() };
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }

    const updated = await LessonPlans.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: updates },
      { new: true }
    ).lean();

    return ok(res, updated);
  } catch (err) {
    console.error('[lesson-plans PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   PATCH /api/lesson-plans/:id/deliver
   Marks the plan as delivered and creates a lesson_coverage record
   so the syllabus tracker stays in sync.
   ══════════════════════════════════════════════════════════════ */
router.patch('/:id/deliver', authMiddleware, async (req, res) => {
  if (!_can(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const LessonPlans = tenantModel('lesson_plans', tenantContext(req));
    const plan = await LessonPlans.findOne({ id: req.params.id, schoolId }).lean();
    if (!plan) return E.notFound(res, 'Lesson plan not found.');

    if (!_isAdmin(req)) {
      const teacher = await _resolveTeacher(userId, req.jwtUser.email, schoolId);
      if (!teacher || plan.teacherId !== teacher.id) {
        return E.forbidden(res, 'You can only deliver your own lesson plans.');
      }
    }

    if (plan.status === 'delivered') {
      return E.badRequest(res, 'This plan is already marked as delivered.');
    }

    // Mark plan as delivered
    await LessonPlans.updateOne({ id: plan.id }, { $set: { status: 'delivered', deliveredAt: new Date().toISOString() } });

    // Create coverage record if linked to a topic
    if (plan.topicId) {
      const Coverage = tenantModel('lesson_coverage', tenantContext(req));
      const existing = await Coverage.findOne({ schoolId, teacherId: plan.teacherId, classId: plan.classId, subjectId: plan.subjectId, topicId: plan.topicId }).lean();
      if (!existing) {
        await Coverage.create({
          id:         `cov_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
          schoolId,
          teacherId:  plan.teacherId,
          classId:    plan.classId,
          subjectId:  plan.subjectId,
          topicId:    plan.topicId,
          subtopicId: null,
          coveredAt:  plan.date,
          notes:      plan.notes || '',
          createdAt:  new Date().toISOString(),
        });
      }
    }

    return ok(res, { id: plan.id, status: 'delivered' });
  } catch (err) {
    console.error('[lesson-plans PATCH /:id/deliver]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   DELETE /api/lesson-plans/:id
   ══════════════════════════════════════════════════════════════ */
router.delete('/:id', authMiddleware, async (req, res) => {
  if (!_can(req, res)) return;
  try {
    const { schoolId, userId } = req.jwtUser;
    const LessonPlans = tenantModel('lesson_plans', tenantContext(req));
    const plan = await LessonPlans.findOne({ id: req.params.id, schoolId }).lean();
    if (!plan) return E.notFound(res, 'Lesson plan not found.');

    if (!_isAdmin(req)) {
      const teacher = await _resolveTeacher(userId, req.jwtUser.email, schoolId);
      if (!teacher || plan.teacherId !== teacher.id) {
        return E.forbidden(res, 'You can only delete your own lesson plans.');
      }
    }

    await LessonPlans.deleteOne({ id: req.params.id, schoolId });
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[lesson-plans DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
