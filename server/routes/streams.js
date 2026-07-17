/* ============================================================
   Msingi — /api/streams
   Streams are teaching groups within a year-group class.
   Section is inherited (denormalized) from the parent class.
   Plan gate: shares 'classes' gate.
   ============================================================ */
const express  = require('express');
const { z }    = require('zod');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');

const router = express.Router();
const PLAN   = planGate('classes');

/* ── Validation ─────────────────────────────────────────────── */
const StreamSchema = z.object({
  classId:       z.string().min(1),
  name:          z.string().min(1).max(50).trim(),  // "A", "B", "East", "Red", etc.
  formTeacherId: z.string().optional(),
  room:          z.string().max(50).optional(),
  capacity:      z.number().int().min(1).max(500).optional(),
  status:        z.enum(['active', 'inactive']).default('active'),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/streams ─ List (filter by classId / status) ────── */
router.get('/', authMiddleware, PLAN, rbac('classes', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.classId) filter.classId = req.query.classId;
    if (req.query.status)  filter.status  = req.query.status;

    const Streams = tenantModel('streams', tenantContext(req));
    const [docs, total] = await Promise.all([
      Streams.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Streams.countDocuments(filter),
    ]);

    // Enrich with teacher names
    const teacherIds = [...new Set(docs.map(d => d.formTeacherId).filter(Boolean))];
    let teacherMap = {};
    if (teacherIds.length) {
      const Teachers = tenantModel('teachers', tenantContext(req));
      const ts = await Teachers.find({ id: { $in: teacherIds }, schoolId })
        .select('id firstName lastName title').lean();
      for (const t of ts) {
        teacherMap[t.id] = `${t.title ? t.title + ' ' : ''}${t.firstName} ${t.lastName}`.trim();
      }
    }

    // Student counts per stream (active only)
    const streamIds = docs.map(d => d.id || d._id?.toString()).filter(Boolean);
    const Students  = tenantModel('students', tenantContext(req));
    const counts = await Students.aggregate([
      { $match: { schoolId, streamId: { $in: streamIds }, status: { $nin: ['withdrawn', 'graduated'] } } },
      { $group: { _id: '$streamId', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const c of counts) countMap[c._id] = c.count;

    const enriched = docs.map(d => {
      const sid = d.id || d._id?.toString();
      return {
        ...d,
        id:           sid,
        teacherName:  teacherMap[d.formTeacherId] ?? null,
        studentCount: countMap[sid] ?? 0,
      };
    });

    return ok(res, enriched, paginate(page, limit, total));
  } catch (err) {
    console.error('[streams GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/streams/:id ────────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('classes', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Streams  = tenantModel('streams', tenantContext(req));
    const paramId  = req.params.id;
    let doc = await Streams.findOne({ id: paramId, schoolId }).select('-__v').lean();
    if (!doc && /^[a-f\d]{24}$/i.test(paramId)) {
      try { doc = await Streams.findOne({ _id: new mongoose.Types.ObjectId(paramId), schoolId }).select('-__v').lean(); } catch { /* ignore */ }
    }
    if (!doc) return E.notFound(res, 'Stream not found');
    if (!doc.id) doc = { ...doc, id: doc._id?.toString() };
    return ok(res, doc);
  } catch (err) {
    console.error('[streams GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/streams/:id/students ─ Students in this stream ─── */
router.get('/:id/students', authMiddleware, PLAN, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const Streams  = tenantModel('streams', tenantContext(req));
    const paramId  = req.params.id;
    let stream = await Streams.findOne({ id: paramId, schoolId }).lean();
    if (!stream && /^[a-f\d]{24}$/i.test(paramId)) {
      try { stream = await Streams.findOne({ _id: new mongoose.Types.ObjectId(paramId), schoolId }).lean(); } catch { /* ignore */ }
    }
    if (!stream) return E.notFound(res, 'Stream not found');

    const Students = tenantModel('students', tenantContext(req));
    // Match students stored under ANY identifier form of this stream —
    // UUID `id` or Mongo `_id` string (pre-migration / imported records)
    const streamIdForms = [...new Set([stream.id, String(stream._id), req.params.id].filter(Boolean))];
    const filter   = { schoolId, streamId: { $in: streamIdForms } };
    if (req.query.status) filter.status = req.query.status;

    const [docs, total] = await Promise.all([
      Students.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Students.countDocuments(filter),
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[streams/:id/students GET]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/streams ───────────────────────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('classes', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(StreamSchema, req.body);
    if (error) return E.validation(res, error);

    // Verify parent class belongs to this school (UUID id field, then _id fallback)
    const Classes = tenantModel('classes', tenantContext(req));
    let cls = await Classes.findOne({ id: data.classId, schoolId }).lean();
    if (!cls && /^[a-f\d]{24}$/i.test(data.classId)) {
      try { cls = await Classes.findOne({ _id: new mongoose.Types.ObjectId(data.classId), schoolId }).lean(); } catch { /* ignore */ }
    }
    if (!cls) return E.notFound(res, 'Parent class not found');

    // Canonical classId: prefer the stored UUID id field; fall back to _id string
    const resolvedClassId = cls.id || cls._id?.toString();

    // Prevent duplicate stream name within the same class
    const Streams = tenantModel('streams', tenantContext(req));
    const dup = await Streams.findOne({ classId: resolvedClassId, schoolId, name: data.name }).lean();
    if (dup) return E.conflict(res, `Stream '${data.name}' already exists in this class`);

    const doc = await Streams.create({
      ...data,
      classId:    resolvedClassId,
      id:         uuidv4(),
      schoolId,
      sectionKey: cls.sectionKey ?? null,  // inherited from parent class
      className:  cls.name,                // denormalized for fast lookups
      createdBy:  userId,
      updatedBy:  userId,
    });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[streams POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/streams/:id ────────────────────────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('classes', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    // classId is immutable after creation
    const { data, error } = _validate(StreamSchema.omit({ classId: true }).partial(), req.body);
    if (error) return E.validation(res, error);

    const clientVersion = data._v;
    delete data.schoolId; delete data.id; delete data._v;

    const paramId = req.params.id;
    const isOid   = /^[a-f\d]{24}$/i.test(paramId);
    const putFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    const { doc, conflict } = await applyOptimisticLock(
      tenantModel('streams', tenantContext(req)),
      putFilter,
      { ...data, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'Stream was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Stream not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[streams PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/streams/:id ─ Soft-delete ───────────────────── */
router.delete('/:id', authMiddleware, PLAN, rbac('classes', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    // Block if stream has active students
    const Students    = tenantModel('students', tenantContext(req));
    const activeCount = await Students.countDocuments({ streamId: req.params.id, schoolId, status: 'active' });
    if (activeCount > 0) {
      return E.conflict(res, `Cannot delete stream with ${activeCount} active student${activeCount !== 1 ? 's' : ''}. Reassign students first.`);
    }

    const Streams  = tenantModel('streams', tenantContext(req));
    const paramId  = req.params.id;
    const isOid    = /^[a-f\d]{24}$/i.test(paramId);
    const delFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    const doc = await Streams.findOneAndUpdate(
      delFilter,
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();

    if (!doc) return E.notFound(res, 'Stream not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[streams DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
