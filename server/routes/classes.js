/* ============================================================
   Msingi — /api/classes  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   ============================================================ */
const express  = require('express');
const { z }    = require('zod');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine         = require('../utils/scopeEngine');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');

const router = express.Router();
const PLAN   = planGate('classes');
const MODGATE = moduleGate('classes');

/* ── Validation ─────────────────────────────────────────────── */
const ClassSchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  sectionKey:  z.string().max(50).optional(),  // references sections.key
  description: z.string().max(500).optional(),
  status:      z.enum(['active', 'inactive']).default('active'),
  order:       z.number().int().min(0).max(999).optional(), // promotion sequence — lower = earlier
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/classes ────────────────────────────────────────── */
// Deliberately UNSCOPED by default — this list feeds 21 different client
// surfaces (Dashboard, Finance fee structures, Subjects catalog, Library,
// Admissions, etc.), most of which have a legitimate reason to see every
// class in the school regardless of the caller's own teaching/assigned
// scope (e.g. building a fee structure needs to reference every class,
// not just the classes the current staff member personally teaches).
// Blanket-restricting this endpoint would be a broad, cross-cutting policy
// change disguised as a bugfix — see scopeEngine.js's isClassInScope for
// the related write-side story.
//
// `?assignedOnly=true` is the narrow, opt-in exception: a caller that
// specifically wants "just the classes I can act on" (currently only
// AttendancePage.jsx's class picker — the write routes it feeds, POST
// /attendance and POST /attendance/bulk, already enforce this
// authoritatively server-side; this narrows the dropdown itself so a
// scoped user isn't shown classes they'd be rejected for picking) can ask
// for it explicitly. Every other consumer that never passes the flag sees
// exactly the same unrestricted list it always has — zero behavior change.
router.get(
  '/', authMiddleware, PLAN, MODGATE, rbac('classes', 'read'),
  (req, res, next) => (req.query.assignedOnly === 'true' ? scopeMiddleware(req, res, next) : next()),
  async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.status)      filter.status     = req.query.status;
    if (req.query.sectionKey)  filter.sectionKey = req.query.sectionKey;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }

    if (req.query.assignedOnly === 'true') {
      ScopeEngine.applyToFilter(req, 'classes', filter);
      if (ScopeEngine.hasNoAssignments(req, 'classes')) {
        return ok(res, [], { ...paginate(page, limit, 0), noAssignments: true });
      }
    }

    const Classes = tenantModel('classes', tenantContext(req));
    const [docs, total] = await Promise.all([
      Classes.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Classes.countDocuments(filter),
    ]);

    // Normalize: ensure every class has an id (UUID or _id hex fallback)
    // so that classId references stored on child records always match.
    const normalised = docs.map(d => ({ ...d, id: d.id || d._id?.toString() }));

    // Enrich with stream count + total student count per class
    const classIds = normalised.map(d => d.id).filter(Boolean);
    const Streams  = tenantModel('streams', tenantContext(req));
    const Students = tenantModel('students', tenantContext(req));

    const [streamCounts, studentCounts] = await Promise.all([
      Streams.aggregate([
        { $match: { classId: { $in: classIds }, schoolId, status: 'active' } },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]),
      Students.aggregate([
        { $match: { classId: { $in: classIds }, schoolId, status: { $nin: ['withdrawn', 'graduated'] } } },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]),
    ]);

    const streamCountMap  = {};
    const studentCountMap = {};
    for (const r of streamCounts)  streamCountMap[r._id]  = r.count;
    for (const r of studentCounts) studentCountMap[r._id] = r.count;

    const enriched = normalised.map(d => ({
      ...d,
      streamCount:  streamCountMap[d.id]  ?? 0,
      studentCount: studentCountMap[d.id] ?? 0,
    }));

    return ok(res, enriched, paginate(page, limit, total));
  } catch (err) {
    console.error('[classes GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/classes/:id ────────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('classes', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Classes = tenantModel('classes', tenantContext(req));
    const paramId = req.params.id;

    // Primary lookup by custom UUID id field
    let doc = await Classes.findOne({ id: paramId, schoolId }).select('-__v').lean();

    // Fallback: if not found and the param looks like a MongoDB ObjectId, try _id
    if (!doc && /^[a-f\d]{24}$/i.test(paramId)) {
      try {
        doc = await Classes.findOne({ _id: new mongoose.Types.ObjectId(paramId), schoolId }).select('-__v').lean();
      } catch { /* invalid ObjectId — leave doc as null */ }
    }

    if (!doc) return E.notFound(res, 'Class not found');
    // Ensure id is always present so client can pass it to child-resource endpoints
    if (!doc.id) doc = { ...doc, id: doc._id?.toString() };
    return ok(res, doc);
  } catch (err) {
    console.error('[classes GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/classes/:id/students ─ Students in a class ─────── */
router.get('/:id/students', authMiddleware, PLAN, MODGATE, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    // Verify the class belongs to this school (try custom id, then _id fallback)
    const Classes = tenantModel('classes', tenantContext(req));
    const pId     = req.params.id;
    let cls       = await Classes.findOne({ id: pId, schoolId }).lean();
    if (!cls && /^[a-f\d]{24}$/i.test(pId)) {
      try { cls = await Classes.findOne({ _id: new mongoose.Types.ObjectId(pId), schoolId }).lean(); } catch { /* ignore */ }
    }
    if (!cls) return E.notFound(res, 'Class not found');

    const Students = tenantModel('students', tenantContext(req));
    // Match students stored under ANY identifier form of this class —
    // UUID `id` or Mongo `_id` string (pre-migration / imported records)
    const classIdForms = [...new Set([cls.id, String(cls._id), req.params.id].filter(Boolean))];
    const filter   = { schoolId, classId: { $in: classIdForms } };
    if (req.query.status) filter.status = req.query.status;

    const [docs, total] = await Promise.all([
      Students.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Students.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[classes/:id/students GET]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/classes ───────────────────────────────────────── */
router.post('/', authMiddleware, PLAN, MODGATE, rbac('classes', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ClassSchema, req.body);
    if (error) return E.validation(res, error);

    const Classes = tenantModel('classes', tenantContext(req));
    const dup = await Classes.findOne({ schoolId, name: data.name }).lean();
    if (dup) return E.conflict(res, `A class named '${data.name}' already exists`);

    const doc = await Classes.create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[classes POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/classes/:id ────────────────────────────────────── */
router.put('/:id', authMiddleware, PLAN, MODGATE, rbac('classes', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ClassSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const clientVersion = data._v;
    delete data.schoolId; delete data.id; delete data._v;

    const paramId = req.params.id;
    const isOid   = /^[a-f\d]{24}$/i.test(paramId);
    const putFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    const { doc, conflict } = await applyOptimisticLock(
      tenantModel('classes', tenantContext(req)),
      putFilter,
      { ...data, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'This class record was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Class not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[classes PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/classes/:id ─ Soft-delete ───────────────────── */
router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('classes', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const paramId = req.params.id;
    const isOid   = /^[a-f\d]{24}$/i.test(paramId);
    const delFilter = isOid
      ? { $or: [{ id: paramId }, { _id: new mongoose.Types.ObjectId(paramId) }], schoolId }
      : { id: paramId, schoolId };

    // Block if class still has active streams
    const Streams     = tenantModel('streams', tenantContext(req));
    const streamCount = await Streams.countDocuments({ classId: paramId, schoolId, status: 'active' });
    if (streamCount > 0) {
      return E.conflict(res, `Cannot delete class with ${streamCount} active stream${streamCount !== 1 ? 's' : ''}. Remove all streams first.`);
    }

    const Classes = tenantModel('classes', tenantContext(req));
    const doc = await Classes.findOneAndUpdate(
      delFilter,
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Class not found');
    return ok(res, { id: paramId, deleted: true });
  } catch (err) {
    console.error('[classes DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
