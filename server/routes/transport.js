/* ============================================================
   Msingi — Transport Module
   /api/transport

   Collections:
     transport_routes      — route definitions (bus runs)
     transport_assignments — student ↔ route assignments

   Plan:  standard | RBAC: MANAGE_ROLES for write; all auth
          users can read routes and their own assignments.
   ============================================================ */
const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('transport');

router.use(authMiddleware, PLAN);

/* ── Roles allowed to manage transport ─────────────────────── */
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'transport_officer']);

/* ── Validation schemas ──────────────────────────────────────── */
const RouteSchema = z.object({
  name:          z.string().min(1).max(200).trim(),
  origin:        z.string().max(200).trim().optional().default(''),
  destination:   z.string().max(200).trim().optional().default(''),
  stops:         z.array(z.string().max(200).trim()).optional().default([]),
  departureTime: z.string().max(10).trim().optional().default(''),   // e.g. "06:30"
  arrivalTime:   z.string().max(10).trim().optional().default(''),
  vehicleType:   z.enum(['bus', 'van', 'matatu', 'other']).optional().default('bus'),
  vehicleReg:    z.string().max(20).trim().optional().default(''),
  driverName:    z.string().max(200).trim().optional().default(''),
  driverPhone:   z.string().max(30).trim().optional().default(''),
  capacity:      z.coerce.number().int().min(1).optional().nullable(),
  feePerTerm:    z.coerce.number().min(0).optional().default(0),
  notes:         z.string().max(500).trim().optional().default(''),
});

const AssignmentSchema = z.object({
  routeId:      z.string().min(1),
  studentId:    z.string().min(1),
  studentName:  z.string().max(200).trim().optional().default(''),
  studentClass: z.string().max(100).trim().optional().default(''),
  pickupStop:   z.string().max(200).trim().optional().default(''),
  direction:    z.enum(['to_school', 'from_school', 'both']).optional().default('both'),
  startDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes:        z.string().max(300).trim().optional().default(''),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   ROUTES — bus/van route definitions
   ══════════════════════════════════════════════════════════════ */

/* GET /api/transport/routes */
router.get('/routes', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { q } = req.query;

    const filter = { schoolId };
    if (q) {
      const re = new RegExp(q.trim(), 'i');
      filter.$or = [{ name: re }, { origin: re }, { destination: re }, { vehicleReg: re }, { driverName: re }];
    }

    const [docs, total] = await Promise.all([
      tenantModel('transport_routes', tenantContext(req)).find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('transport_routes', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[transport/routes GET]', err);
    return E.serverError(res);
  }
});

/* GET /api/transport/routes/:id */
router.get('/routes/:id', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('transport_routes', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Route not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[transport/routes GET/:id]', err);
    return E.serverError(res);
  }
});

/* POST /api/transport/routes */
router.post('/routes', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    const { data, error } = _validate(RouteSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('transport_routes', tenantContext(req)).create({
      id:        uuidv4(),
      schoolId,
      ...data,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[transport/routes POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/transport/routes/:id */
router.put('/routes/:id', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    const existing = await tenantModel('transport_routes', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Route not found');

    const { data, error } = _validate(RouteSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('transport_routes', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[transport/routes PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/transport/routes/:id */
router.delete('/routes/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    /* Block deletion if active assignments reference this route */
    const activeAssignments = await tenantModel('transport_assignments', tenantContext(req)).countDocuments({
      schoolId, routeId: req.params.id, status: 'active',
    });
    if (activeAssignments > 0) {
      return E.badRequest(res, `Cannot delete — ${activeAssignments} student(s) are assigned to this route`);
    }

    const doc = await tenantModel('transport_routes', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Route not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[transport/routes DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ASSIGNMENTS — student ↔ route
   ══════════════════════════════════════════════════════════════ */

/* GET /api/transport/assignments */
router.get('/assignments', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { routeId, studentId, status } = req.query;

    const filter = { schoolId };
    /* Non-managers only see their own child's assignments (studentId = userId for parent portal) */
    if (!MANAGE_ROLES.has(role)) {
      filter.studentId = userId;
    } else {
      if (studentId) filter.studentId = studentId;
    }
    if (routeId) filter.routeId = routeId;
    if (status)  filter.status  = status;

    const [docs, total] = await Promise.all([
      tenantModel('transport_assignments', tenantContext(req)).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('transport_assignments', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[transport/assignments GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/transport/assignments — assign student to route */
router.post('/assignments', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    const { data, error } = _validate(AssignmentSchema, req.body);
    if (error) return E.validation(res, error);

    /* Validate route exists */
    const route = await tenantModel('transport_routes', tenantContext(req)).findOne({ id: data.routeId, schoolId }).lean();
    if (!route) return E.notFound(res, 'Route not found');

    /* Check student not already actively assigned to same route */
    const existing = await tenantModel('transport_assignments', tenantContext(req)).findOne({
      schoolId, routeId: data.routeId, studentId: data.studentId, status: 'active',
    }).lean();
    if (existing) return E.conflict(res, 'Student is already assigned to this route');

    /* Capacity check — soft warning; still allow if capacity not set */
    if (route.capacity) {
      const currentCount = await tenantModel('transport_assignments', tenantContext(req)).countDocuments({
        schoolId, routeId: data.routeId, status: 'active',
      });
      if (currentCount >= route.capacity) {
        return E.badRequest(res, `Route is at full capacity (${route.capacity} students)`);
      }
    }

    const now = new Date().toISOString();
    const doc = await tenantModel('transport_assignments', tenantContext(req)).create({
      id:           uuidv4(),
      schoolId,
      routeId:      data.routeId,
      routeName:    route.name,
      studentId:    data.studentId,
      studentName:  data.studentName,
      studentClass: data.studentClass,
      pickupStop:   data.pickupStop,
      direction:    data.direction,
      startDate:    data.startDate ?? now.slice(0, 10),
      endDate:      data.endDate   ?? null,
      notes:        data.notes,
      status:       'active',
      createdBy:    userId,
      createdAt:    now,
      updatedAt:    now,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[transport/assignments POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/transport/assignments/:id — update or deactivate */
router.patch('/assignments/:id', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    const existing = await tenantModel('transport_assignments', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');

    const allowed = ['pickupStop', 'direction', 'endDate', 'notes', 'status', 'studentName', 'studentClass'];
    const update  = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }
    update.updatedBy = userId;
    update.updatedAt = new Date().toISOString();

    const doc = await tenantModel('transport_assignments', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: update },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[transport/assignments PATCH]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/transport/assignments/:id */
router.delete('/assignments/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    const doc = await tenantModel('transport_assignments', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Assignment not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[transport/assignments DELETE]', err);
    return E.serverError(res);
  }
});

/* ── Summary ─────────────────────────────────────────────────── */
router.get('/summary', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Transport staff or Admin access required');

    const [routeCount, assignmentAgg] = await Promise.all([
      tenantModel('transport_routes', tenantContext(req)).countDocuments({ schoolId }),
      tenantModel('transport_assignments', tenantContext(req)).aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:      null,
            total:    { $sum: 1 },
            active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
        }},
      ]),
    ]);

    const aa = assignmentAgg[0] ?? { total: 0, active: 0, inactive: 0 };

    return ok(res, {
      totalRoutes:       routeCount,
      totalAssignments:  aa.total,
      activeAssignments: aa.active,
      inactiveAssignments: aa.inactive,
    });
  } catch (err) {
    console.error('[transport/summary GET]', err);
    return E.serverError(res);
  }
});

module.exports = router;
