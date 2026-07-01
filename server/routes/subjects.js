/* ============================================================
   Msingi — /api/subjects
   School-editable subject registry, grouped by department.
   Subjects feed into Grades, Exams, Timetable, Report Cards.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();

/* ── Validation ─────────────────────────────────────────────── */
const SubjectSchema = z.object({
  name:         z.string().min(1).max(100).trim(),
  code:         z.string().min(1).max(20).trim().toUpperCase(),
  shortName:    z.string().max(50).trim().optional(),
  departmentId: z.string().min(1),
  sections:     z.array(z.string().min(1)).optional().default(['all']),
  isCompulsory: z.boolean().optional().default(false),
  color:        z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  order:        z.number().int().min(0).optional().default(0),
  description:  z.string().max(500).optional(),
});

function _v(data) {
  const r = SubjectSchema.partial().required({ name: true, code: true, departmentId: true }).safeParse(data);
  return r.success ? { data: r.data } : { error: r.error.issues.map(i => i.message).join('; ') };
}

/* ── GET /api/subjects — list (optionally filtered) ────────── */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, isActive: { $ne: false } };
    if (req.query.departmentId) filter.departmentId = req.query.departmentId;
    if (req.query.section)      filter.sections     = req.query.section;
    if (req.query.isCompulsory) filter.isCompulsory = req.query.isCompulsory === 'true';

    const docs = await _model('subjects')
      .find(filter)
      .sort({ order: 1, name: 1 })
      .limit(500)
      .select('-__v')
      .lean();

    // ?withClassCurriculum=classId — attach whether each subject is in the class curriculum
    // Used by the curriculum editor to show "in curriculum / not in curriculum" state per subject.
    if (req.query.withClassCurriculum) {
      const classId = req.query.withClassCurriculum;
      // Fetch without .select() so the stored `id` UUID field is not filtered out.
      // (The schema uses id:false which makes Mongoose treat .select('id') as the
      //  disabled virtual, silently dropping the real stored id field from lean results.)
      const links = await _model('class_subjects')
        .find({ schoolId, classId, isActive: { $ne: false } })
        .lean();
      const linkMap = Object.fromEntries(links.map(l => [l.subjectId, l]));
      return ok(res, docs.map(d => ({
        ...d,
        inCurriculum:         !!linkMap[d.id],
        isCompulsoryForClass: linkMap[d.id]?.isCompulsoryForClass ?? false,
        // Prefer the stored UUID id; fall back to _id string for legacy docs
        classSubjectId:       linkMap[d.id]
          ? (linkMap[d.id].id ?? linkMap[d.id]._id?.toString() ?? null)
          : null,
      })));
    }

    return ok(res, docs);
  } catch (err) { console.error('[subjects GET /]', err); return E.serverError(res); }
});

/* ── GET /api/subjects/:id ─────────────────────────────────── */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('subjects').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Subject not found');
    return ok(res, doc);
  } catch (err) { console.error('[subjects GET /:id]', err); return E.serverError(res); }
});

/* ── POST /api/subjects — create ───────────────────────────── */
router.post('/', authMiddleware, rbac('subjects', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _v(req.body);
    if (error) return E.badRequest(res, error);

    // Verify department belongs to this school
    const dept = await _model('departments').findOne({ id: data.departmentId, schoolId }).lean();
    if (!dept) return E.badRequest(res, 'Department not found in this school');

    // Code uniqueness within school
    const dup = await _model('subjects').findOne({ schoolId, code: data.code }).lean();
    if (dup) return E.conflict(res, `Subject code '${data.code}' already exists`);

    const doc = await _model('subjects').create({
      ...data,
      id:           uuidv4(),
      schoolId,
      departmentId: data.departmentId,
      isActive:     true,
      createdBy:    userId,
      updatedBy:    userId,
    });
    return created(res, doc.toObject());
  } catch (err) { console.error('[subjects POST /]', err); return E.serverError(res); }
});

/* ── PUT /api/subjects/:id — update ────────────────────────── */
router.put('/:id', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _v(req.body);
    if (error) return E.badRequest(res, error);

    if (data.departmentId) {
      const dept = await _model('departments').findOne({ id: data.departmentId, schoolId }).lean();
      if (!dept) return E.badRequest(res, 'Department not found in this school');
    }

    if (data.code) {
      const conflict = await _model('subjects').findOne({
        schoolId, code: data.code, id: { $ne: req.params.id },
      }).lean();
      if (conflict) return E.conflict(res, `Subject code '${data.code}' already used`);
    }

    const doc = await _model('subjects').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true },
    );
    if (!doc) return E.notFound(res, 'Subject not found');
    return ok(res, doc.toObject());
  } catch (err) { console.error('[subjects PUT /:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/subjects/:id — soft-delete ────────────────── */
router.delete('/:id', authMiddleware, rbac('subjects', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await _model('subjects').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { isActive: false, updatedBy: userId },
      { new: true },
    );
    if (!doc) return E.notFound(res, 'Subject not found');
    return ok(res, { message: 'Subject deactivated' });
  } catch (err) { console.error('[subjects DELETE /:id]', err); return E.serverError(res); }
});

module.exports = router;
