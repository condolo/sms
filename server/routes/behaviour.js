/* ============================================================
   InnoLearn — /api/behaviour  (Behaviour & Pastoral)
   Sub-routes:
     /api/behaviour/incidents   — incident log
     /api/behaviour/appeals     — appeal log
     /api/behaviour/categories  — school behaviour categories (CRUD)
   Plan: standard | RBAC: behaviour:{read,create,update,delete}
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
const PLAN   = planGate('behaviour');

/* ── Validation schemas ─────────────────────────────────────── */
const IncidentSchema = z.object({
  studentId:    z.string().min(1),
  classId:      z.string().optional(),
  reportedBy:   z.string().optional(),          // userId of reporter; overridden by JWT
  categoryId:   z.string().optional(),
  type:         z.enum(['merit', 'demerit', 'neutral']).default('demerit'),
  severity:     z.enum(['low', 'medium', 'high', 'critical']).optional(),
  title:        z.string().min(1).max(200),
  description:  z.string().max(3000).optional(),
  points:       z.number().int().min(-100).max(100).default(0),
  date:         z.string().optional(),          // ISO date; defaults to today
  location:     z.string().max(100).optional(),
  witnesses:    z.array(z.string()).optional(),  // userIds
  action:       z.string().max(1000).optional(), // action taken
  detention:    z.boolean().default(false),
  detentionDate: z.string().optional(),
  parentNotified: z.boolean().default(false),
  status:       z.enum(['open', 'resolved', 'escalated', 'appealed']).default('open'),
});

const AppealSchema = z.object({
  incidentId:   z.string().min(1),
  studentId:    z.string().min(1),
  reason:       z.string().min(1).max(3000),
  submittedBy:  z.string().optional(),
  outcome:      z.enum(['pending', 'upheld', 'overturned', 'partial']).default('pending'),
  reviewedBy:   z.string().optional(),
  reviewNotes:  z.string().max(3000).optional(),
  reviewedAt:   z.string().optional(),
});

const CategorySchema = z.object({
  name:         z.string().min(1).max(100).trim(),
  type:         z.enum(['merit', 'demerit', 'neutral']).default('demerit'),
  defaultPoints: z.number().int().min(-100).max(100).default(0),
  description:  z.string().max(500).optional(),
  colour:       z.string().optional(),
  isActive:     z.boolean().default(true),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   INCIDENTS
   ══════════════════════════════════════════════════════════════ */

router.get('/incidents', authMiddleware, PLAN, rbac('behaviour', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.studentId)  filter.studentId  = req.query.studentId;
    if (req.query.classId)    filter.classId    = req.query.classId;
    if (req.query.type)       filter.type       = req.query.type;
    if (req.query.status)     filter.status     = req.query.status;
    if (req.query.severity)   filter.severity   = req.query.severity;
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.detention === 'true') filter.detention = true;

    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { description: rx }];
    }

    const Incidents = _model('behaviour_incidents');
    const [docs, total] = await Promise.all([
      Incidents.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Incidents.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[behaviour/incidents GET]', err); return E.serverError(res); }
});

router.get('/incidents/summary', authMiddleware, PLAN, rbac('behaviour', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.classId)   filter.classId   = req.query.classId;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    }

    const Incidents = _model('behaviour_incidents');
    const summary = await Incidents.aggregate([
      { $match: filter },
      { $group: {
        _id:      '$studentId',
        merits:   { $sum: { $cond: [{ $eq: ['$type', 'merit'] }, 1, 0] } },
        demerits: { $sum: { $cond: [{ $eq: ['$type', 'demerit'] }, 1, 0] } },
        points:   { $sum: '$points' },
        total:    { $sum: 1 },
      }},
      { $sort: { points: -1 } }
    ]);
    return ok(res, summary);
  } catch (err) { console.error('[behaviour/incidents/summary]', err); return E.serverError(res); }
});

router.get('/incidents/:id', authMiddleware, PLAN, rbac('behaviour', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('behaviour_incidents').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Incident not found');
    return ok(res, doc);
  } catch (err) { console.error('[behaviour/incidents GET/:id]', err); return E.serverError(res); }
});

router.post('/incidents', authMiddleware, PLAN, rbac('behaviour', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(IncidentSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await _model('behaviour_incidents').create({
      ...data,
      id:          uuidv4(),
      schoolId,
      reportedBy:  userId,
      date:        data.date || new Date().toISOString().slice(0, 10),
      createdBy:   userId,
      updatedBy:   userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[behaviour/incidents POST]', err); return E.serverError(res); }
});

router.put('/incidents/:id', authMiddleware, PLAN, rbac('behaviour', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(IncidentSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const doc = await _model('behaviour_incidents').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Incident not found');
    return ok(res, doc);
  } catch (err) { console.error('[behaviour/incidents PUT/:id]', err); return E.serverError(res); }
});

router.delete('/incidents/:id', authMiddleware, PLAN, rbac('behaviour', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await _model('behaviour_incidents').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'resolved', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Incident not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[behaviour/incidents DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   APPEALS
   ══════════════════════════════════════════════════════════════ */

router.get('/appeals', authMiddleware, PLAN, rbac('behaviour', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { schoolId };
    if (req.query.studentId)  filter.studentId  = req.query.studentId;
    if (req.query.incidentId) filter.incidentId = req.query.incidentId;
    if (req.query.outcome)    filter.outcome    = req.query.outcome;

    const Appeals = _model('behaviour_appeals');
    const [docs, total] = await Promise.all([
      Appeals.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Appeals.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[behaviour/appeals GET]', err); return E.serverError(res); }
});

router.post('/appeals', authMiddleware, PLAN, rbac('behaviour', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AppealSchema, req.body);
    if (error) return E.validation(res, error);

    // Verify incident exists and belongs to this school
    const incident = await _model('behaviour_incidents').findOne({ id: data.incidentId, schoolId }).lean();
    if (!incident) return E.notFound(res, 'Incident not found');

    const doc = await _model('behaviour_appeals').create({
      ...data,
      id:          uuidv4(),
      schoolId,
      submittedBy: userId,
      createdBy:   userId,
      updatedBy:   userId,
    });

    // Mark incident as appealed
    await _model('behaviour_incidents').updateOne({ id: data.incidentId }, { status: 'appealed' });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[behaviour/appeals POST]', err); return E.serverError(res); }
});

router.put('/appeals/:id', authMiddleware, PLAN, rbac('behaviour', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AppealSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const doc = await _model('behaviour_appeals').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, reviewedBy: userId, reviewedAt: new Date().toISOString(), updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Appeal not found');

    // If outcome resolved, update incident status
    if (data.outcome && data.outcome !== 'pending') {
      const newStatus = data.outcome === 'overturned' ? 'resolved' : 'resolved';
      await _model('behaviour_incidents').updateOne({ id: doc.incidentId }, { status: newStatus });
    }

    return ok(res, doc);
  } catch (err) { console.error('[behaviour/appeals PUT/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   CATEGORIES  (school-defined behaviour categories)
   ══════════════════════════════════════════════════════════════ */

router.get('/categories', authMiddleware, PLAN, rbac('behaviour', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.type)     filter.type     = req.query.type;
    if (req.query.isActive) filter.isActive = req.query.isActive === 'true';

    const docs = await _model('behaviour_categories').find(filter).sort({ type: 1, name: 1 }).select('-__v').lean();
    return ok(res, docs);
  } catch (err) { console.error('[behaviour/categories GET]', err); return E.serverError(res); }
});

router.post('/categories', authMiddleware, PLAN, rbac('behaviour', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CategorySchema, req.body);
    if (error) return E.validation(res, error);

    const dup = await _model('behaviour_categories').findOne({ schoolId, name: data.name }).lean();
    if (dup) return E.conflict(res, `Category '${data.name}' already exists`);

    const doc = await _model('behaviour_categories').create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[behaviour/categories POST]', err); return E.serverError(res); }
});

router.put('/categories/:id', authMiddleware, PLAN, rbac('behaviour', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CategorySchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const doc = await _model('behaviour_categories').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Category not found');
    return ok(res, doc);
  } catch (err) { console.error('[behaviour/categories PUT/:id]', err); return E.serverError(res); }
});

router.delete('/categories/:id', authMiddleware, PLAN, rbac('behaviour', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('behaviour_categories').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Category not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[behaviour/categories DELETE/:id]', err); return E.serverError(res); }
});

module.exports = router;
