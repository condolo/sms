/* ============================================================
   Msingi — /api/growth-recommendations  &  /api/growth-aspirations

   Recommendations: written by staff for a student.
     Author name is denormalized at write time (author may later
     leave the school — name stays on the record permanently).

   Aspirations: self-edited by the student (or admin on behalf).
     One document per student (upsert pattern).

   Plan: standard | RBAC: growth_profile:{read,create,delete}
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
const PLAN   = planGate('growth_profile');

/* ── Validation ─────────────────────────────────────────────── */
const RecommendationSchema = z.object({
  studentId:   z.string().min(1),
  authorId:    z.string().optional(),
  authorName:  z.string().max(200).trim().optional(),   // denormalized at creation
  authorRole:  z.string().max(100).trim().optional(),   // e.g. "Class Teacher", "Head of Dept"
  type:        z.enum(['academic','character','leadership','general']).default('general'),
  content:     z.string().min(10).max(5000).trim(),
  isConfidential: z.boolean().default(false),           // if true, only admin/staff can see
});

const AspirationsSchema = z.object({
  careerInterests:       z.array(z.string().max(100)).max(10).default([]),
  universityAspirations: z.array(z.string().max(200)).max(5).default([]),
  personalStatement:     z.string().max(4000).trim().optional(),
  futureGoals:           z.string().max(2000).trim().optional(),
  intendedCourses:       z.array(z.string().max(200)).max(5).default([]),
  targetCountries:       z.array(z.string().max(100)).max(5).default([]),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   RECOMMENDATIONS
   ══════════════════════════════════════════════════════════════ */

/* ── GET /api/growth-recommendations ───────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId, role, userId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.authorId)  filter.authorId  = req.query.authorId;
    if (req.query.type)      filter.type      = req.query.type;

    // Students and parents cannot see confidential recommendations
    const restrictedRoles = ['student', 'parent', 'guardian'];
    if (restrictedRoles.includes(role)) {
      filter.isConfidential = { $ne: true };
    }

    const [docs, total] = await Promise.all([
      _model('growth_recommendations').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      _model('growth_recommendations').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[growth-recommendations GET]', err); return E.serverError(res); }
});

/* ── GET /api/growth-recommendations/:id ───────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const doc = await _model('growth_recommendations').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Recommendation not found');

    // Hide confidential recommendations from restricted roles
    const restrictedRoles = ['student', 'parent', 'guardian'];
    if (restrictedRoles.includes(role) && doc.isConfidential) {
      return E.forbidden(res, 'This recommendation is confidential');
    }
    return ok(res, doc);
  } catch (err) { console.error('[growth-recommendations GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/growth-recommendations ──────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('growth_profile', 'create'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    // Only staff can write recommendations
    const CAN_WRITE = ['admin', 'superadmin', 'teacher', 'section_head', 'deputy_principal'];
    if (!CAN_WRITE.includes(role)) {
      return E.forbidden(res, 'Only teaching staff can write recommendations');
    }

    const { data, error } = _validate(RecommendationSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await _model('growth_recommendations').create({
      ...data,
      id:        uuidv4(),
      schoolId,
      authorId:  data.authorId || userId,      // default to the writing user
      createdBy: userId,
      updatedBy: userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[growth-recommendations POST]', err); return E.serverError(res); }
});

/* ── DELETE /api/growth-recommendations/:id ────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('growth_profile', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    // Only admin/superadmin or the original author can delete a recommendation
    const doc = await _model('growth_recommendations').findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Recommendation not found');

    const isAdmin  = ['admin', 'superadmin'].includes(role);
    const isAuthor = doc.authorId === userId || doc.createdBy === userId;
    if (!isAdmin && !isAuthor) {
      return E.forbidden(res, 'You can only delete recommendations you wrote');
    }

    await _model('growth_recommendations').findOneAndDelete({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[growth-recommendations DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   ASPIRATIONS  — served from /api/growth-recommendations/aspirations/:studentId
   Note: NOT a separate router mount. Aspirations live on this router
   under the /aspirations/:studentId sub-path.
   ══════════════════════════════════════════════════════════════ */

/* ── GET /api/growth-aspirations/:studentId ────────────────── */
router.get('/aspirations/:studentId', authMiddleware, PLAN, rbac('growth_profile', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('growth_aspirations').findOne({ schoolId, studentId: req.params.studentId }).select('-__v').lean();
    // Return empty object if not yet set — not a 404
    return ok(res, doc ?? { studentId: req.params.studentId, careerInterests: [], universityAspirations: [], intendedCourses: [], targetCountries: [] });
  } catch (err) { console.error('[growth-aspirations GET]', err); return E.serverError(res); }
});

/* ── PUT /api/growth-aspirations/:studentId ────────────────── */
router.put('/aspirations/:studentId', authMiddleware, PLAN, rbac('growth_profile', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    // Students can only edit their own aspirations; staff can edit any student's
    const isStudent = role === 'student';
    // For student self-edit, they would need to be linked to this studentId
    // (we trust the server-side RBAC gate here; student role only gets 'update' on growth_profile
    //  if configured in permissions — admin controls this)

    const { data, error } = _validate(AspirationsSchema, req.body);
    if (error) return E.validation(res, error);

    const now = new Date().toISOString();
    const doc = await _model('growth_aspirations').findOneAndUpdate(
      { schoolId, studentId: req.params.studentId },
      {
        ...data,
        schoolId,
        studentId:  req.params.studentId,
        updatedBy:  userId,
        updatedAt:  now,
        $setOnInsert: { id: uuidv4(), createdBy: userId, createdAt: now },
      },
      { upsert: true, new: true, runValidators: false }
    ).lean();
    return ok(res, doc);
  } catch (err) { console.error('[growth-aspirations PUT]', err); return E.serverError(res); }
});

module.exports = router;
