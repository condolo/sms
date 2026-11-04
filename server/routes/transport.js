/* ============================================================
   Msingi — Transport Module
   /api/transport

   Collections:
     transport_routes      — route definitions (bus runs)
     transport_assignments — student ↔ route assignments
     transport_vehicles    — the fleet (registration, type, capacity,
                             insurance/inspection dates, status)
     transport_drivers     — the people who drive it (licence, expiry, status)

   A route may point at a fleet vehicle and a driver (`vehicleId` / `driverId`).
   When it does, the server copies the display fields onto the route
   (vehicleReg, vehicleType, capacity, driverName, driverPhone) and keeps them
   in step when the vehicle or driver is edited. That denormalisation is
   deliberate: the parent and student portal cards read the route alone, and a
   portal read should never depend on a second collection being reachable.

   Plan:  standard | RBAC: rbac('transport', action, subKey) — 'manage' for
          route/vehicle/driver writes, 'assign' for assignment writes, 'delete'
          for deletes.
   ============================================================ */
const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac, hasPermission } = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const AuditService = require('../services/audit');

const router = express.Router();
const PLAN   = planGate('transport');

router.use(authMiddleware, PLAN, moduleGate('transport'));

/* ── Validation schemas ──────────────────────────────────────── */
const RouteSchema = z.object({
  name:          z.string().min(1).max(200).trim(),
  origin:        z.string().max(200).trim().optional().default(''),
  destination:   z.string().max(200).trim().optional().default(''),
  stops:         z.array(z.string().max(200).trim()).optional().default([]),
  departureTime: z.string().max(10).trim().optional().default(''),   // e.g. "06:30"
  arrivalTime:   z.string().max(10).trim().optional().default(''),
  // The fleet vehicle and driver this run uses. When either is given, the
  // server fills the display fields below from the record — a client cannot
  // name its own bus. Both are optional so a school with nothing registered
  // yet can still describe a run in words.
  vehicleId:     z.string().max(60).trim().optional().default(''),
  driverId:      z.string().max(60).trim().optional().default(''),
  vehicleType:   z.enum(['bus', 'van', 'matatu', 'other']).optional().default('bus'),
  vehicleReg:    z.string().max(20).trim().optional().default(''),
  driverName:    z.string().max(200).trim().optional().default(''),
  driverPhone:   z.string().max(30).trim().optional().default(''),
  capacity:      z.coerce.number().int().min(1).optional().nullable(),
  feePerTerm:    z.coerce.number().min(0).optional().default(0),
  // One-way and two-way fares for this route. A student is billed the fare for
  // the fare type given on their assignment (see AssignmentSchema.fareType).
  // A route with no fare for a type cannot bill students who chose that type.
  fares:         z.array(z.object({
                   fareType: z.enum(['one_way', 'two_way']),
                   amount:   z.coerce.number().min(0),
                 })).optional().default([])
                 .refine(f => new Set(f.map(x => x.fareType)).size === f.length, { message: 'Each fare type can only be set once per route' }),
  notes:         z.string().max(500).trim().optional().default(''),
});

const AssignmentSchema = z.object({
  routeId:      z.string().min(1),
  studentId:    z.string().min(1),
  studentName:  z.string().max(200).trim().optional().default(''),
  studentClass: z.string().max(100).trim().optional().default(''),
  pickupStop:   z.string().max(200).trim().optional().default(''),
  direction:    z.enum(['to_school', 'from_school', 'both']).optional().default('both'),
  // Which of the route's fares this student pays. Required for a new
  // assignment; billing charges exactly this fare, never a guess.
  fareType:     z.enum(['one_way', 'two_way']),
  startDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes:        z.string().max(300).trim().optional().default(''),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* A date the office may not know yet arrives as '' from a date input, and must
   not be stored as an empty string — a blank is "not on file", and only null
   says that unambiguously to every reader. */
const _dateField = z.union([z.literal(''), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional();
const _dateOrNull = (v) => (v ? v : null);

/* ── Fleet: the vehicles a school runs ────────────────────────── */
const VehicleSchema = z.object({
  registration:     z.string().min(1).max(20).trim(),
  vehicleType:      z.enum(['bus', 'van', 'matatu', 'other']).optional().default('bus'),
  make:             z.string().max(60).trim().optional().default(''),
  model:            z.string().max(60).trim().optional().default(''),
  year:             z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  capacity:         z.coerce.number().int().min(1).max(200).optional().nullable(),
  ownership:        z.enum(['owned', 'hired']).optional().default('owned'),
  status:           z.enum(['active', 'maintenance', 'retired']).optional().default('active'),
  insuranceExpiry:  _dateField,
  inspectionExpiry: _dateField,
  notes:            z.string().max(300).trim().optional().default(''),
});

/* ── Drivers ──────────────────────────────────────────────────── */
const DriverSchema = z.object({
  name:          z.string().min(1).max(200).trim(),
  phone:         z.string().max(30).trim().optional().default(''),
  licenceNumber: z.string().max(40).trim().optional().default(''),
  licenceExpiry: _dateField,
  status:        z.enum(['active', 'suspended', 'left']).optional().default('active'),
  notes:         z.string().max(300).trim().optional().default(''),
});

/* ══════════════════════════════════════════════════════════════
   FLEET — the vehicles
   ══════════════════════════════════════════════════════════════ */

/* Which routes each vehicle/driver is on, in one read for the whole page —
   a per-row lookup would be one query per vehicle. */
async function _routeLinksFor(req) {
  const { schoolId } = req.jwtUser;
  const rows = await tenantModel('transport_routes', tenantContext(req))
    .find({ schoolId }).select('id name vehicleId driverId').lean().catch(() => []);
  const byVehicle = new Map();
  const byDriver  = new Map();
  for (const r of rows) {
    const ref = { id: r.id, name: r.name };
    if (r.vehicleId) byVehicle.set(r.vehicleId, [...(byVehicle.get(r.vehicleId) ?? []), ref]);
    if (r.driverId)  byDriver.set(r.driverId,  [...(byDriver.get(r.driverId)  ?? []), ref]);
  }
  return { byVehicle, byDriver };
}

/* GET /api/transport/vehicles */
router.get('/vehicles', rbac('transport', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { q, status } = req.query;

    const filter = { schoolId };
    if (status) filter.status = status;
    if (q) {
      const re = new RegExp(q.trim(), 'i');
      filter.$or = [{ registration: re }, { make: re }, { model: re }, { notes: re }];
    }

    const Vehicles = tenantModel('transport_vehicles', tenantContext(req));
    const [docs, total, links] = await Promise.all([
      Vehicles.find(filter).sort({ registration: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Vehicles.countDocuments(filter),
      _routeLinksFor(req),
    ]);

    return ok(res, docs.map(v => ({ ...v, routes: links.byVehicle.get(v.id) ?? [] })), paginate(page, limit, total));
  } catch (err) {
    console.error('[transport/vehicles GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/transport/vehicles */
router.post('/vehicles', rbac('transport', 'create', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(VehicleSchema, req.body);
    if (error) return E.validation(res, error);

    const Vehicles = tenantModel('transport_vehicles', tenantContext(req));
    const clash = await Vehicles.findOne({ schoolId, registration: data.registration }).lean();
    if (clash) return E.conflict(res, `${data.registration} is already on the fleet`);

    const doc = await Vehicles.create({
      id: uuidv4(),
      schoolId,
      ...data,
      insuranceExpiry:  _dateOrNull(data.insuranceExpiry),
      inspectionExpiry: _dateOrNull(data.inspectionExpiry),
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const saved = doc.toObject ? doc.toObject() : doc;
    AuditService.log({ action: 'transport.vehicle_created', actor: req.jwtUser, schoolId, target: { type: 'vehicle', id: saved.id, label: saved.registration }, req });
    return created(res, { ...saved, routes: [] });
  } catch (err) {
    console.error('[transport/vehicles POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/transport/vehicles/:id
   Editing a vehicle also refreshes the copy of it that every route carries, so
   a corrected plate or a bigger bus reaches the parent portal immediately
   instead of at the next route edit. */
router.put('/vehicles/:id', rbac('transport', 'update', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(VehicleSchema, req.body);
    if (error) return E.validation(res, error);

    const Vehicles = tenantModel('transport_vehicles', tenantContext(req));
    const existing = await Vehicles.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Vehicle not found');

    const clash = await Vehicles.findOne({ schoolId, registration: data.registration, id: { $ne: req.params.id } }).lean();
    if (clash) return E.conflict(res, `${data.registration} is already on the fleet`);

    const doc = await Vehicles.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: {
        ...data,
        insuranceExpiry:  _dateOrNull(data.insuranceExpiry),
        inspectionExpiry: _dateOrNull(data.inspectionExpiry),
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      } },
      { new: true },
    ).lean();

    await tenantModel('transport_routes', tenantContext(req)).updateMany(
      { schoolId, vehicleId: req.params.id },
      { $set: {
        vehicleReg:  doc.registration,
        vehicleType: doc.vehicleType,
        capacity:    doc.capacity ?? null,
        updatedAt:   new Date().toISOString(),
      } },
    ).catch(err => console.error('[transport/vehicles PUT] route sync failed:', err.message));

    AuditService.log({ action: 'transport.vehicle_updated', actor: req.jwtUser, schoolId, target: { type: 'vehicle', id: doc.id, label: doc.registration }, req });
    return ok(res, doc);
  } catch (err) {
    console.error('[transport/vehicles PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/transport/vehicles/:id */
router.delete('/vehicles/:id', rbac('transport', 'delete', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const onRoutes = await tenantModel('transport_routes', tenantContext(req))
      .countDocuments({ schoolId, vehicleId: req.params.id });
    if (onRoutes > 0) {
      return E.badRequest(res, `Cannot delete — this vehicle is on ${onRoutes} route${onRoutes === 1 ? '' : 's'}. Take it off them first.`);
    }
    const doc = await tenantModel('transport_vehicles', tenantContext(req))
      .findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Vehicle not found');

    AuditService.log({ action: 'transport.vehicle_deleted', actor: req.jwtUser, schoolId, target: { type: 'vehicle', id: doc.id, label: doc.registration }, req });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[transport/vehicles DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   DRIVERS
   ══════════════════════════════════════════════════════════════ */

/* GET /api/transport/drivers */
router.get('/drivers', rbac('transport', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { q, status } = req.query;

    const filter = { schoolId };
    if (status) filter.status = status;
    if (q) {
      const re = new RegExp(q.trim(), 'i');
      filter.$or = [{ name: re }, { phone: re }, { licenceNumber: re }];
    }

    const Drivers = tenantModel('transport_drivers', tenantContext(req));
    const [docs, total, links] = await Promise.all([
      Drivers.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Drivers.countDocuments(filter),
      _routeLinksFor(req),
    ]);

    return ok(res, docs.map(d => ({ ...d, routes: links.byDriver.get(d.id) ?? [] })), paginate(page, limit, total));
  } catch (err) {
    console.error('[transport/drivers GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/transport/drivers */
router.post('/drivers', rbac('transport', 'create', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(DriverSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('transport_drivers', tenantContext(req)).create({
      id: uuidv4(),
      schoolId,
      ...data,
      licenceExpiry: _dateOrNull(data.licenceExpiry),
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const saved = doc.toObject ? doc.toObject() : doc;
    AuditService.log({ action: 'transport.driver_created', actor: req.jwtUser, schoolId, target: { type: 'driver', id: saved.id, label: saved.name }, req });
    return created(res, { ...saved, routes: [] });
  } catch (err) {
    console.error('[transport/drivers POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/transport/drivers/:id — also refreshes the copy on every route it drives. */
router.put('/drivers/:id', rbac('transport', 'update', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(DriverSchema, req.body);
    if (error) return E.validation(res, error);

    const Drivers = tenantModel('transport_drivers', tenantContext(req));
    const existing = await Drivers.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Driver not found');

    const doc = await Drivers.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, licenceExpiry: _dateOrNull(data.licenceExpiry), updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true },
    ).lean();

    await tenantModel('transport_routes', tenantContext(req)).updateMany(
      { schoolId, driverId: req.params.id },
      { $set: { driverName: doc.name, driverPhone: doc.phone ?? '', updatedAt: new Date().toISOString() } },
    ).catch(err => console.error('[transport/drivers PUT] route sync failed:', err.message));

    AuditService.log({ action: 'transport.driver_updated', actor: req.jwtUser, schoolId, target: { type: 'driver', id: doc.id, label: doc.name }, req });
    return ok(res, doc);
  } catch (err) {
    console.error('[transport/drivers PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/transport/drivers/:id */
router.delete('/drivers/:id', rbac('transport', 'delete', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const onRoutes = await tenantModel('transport_routes', tenantContext(req))
      .countDocuments({ schoolId, driverId: req.params.id });
    if (onRoutes > 0) {
      return E.badRequest(res, `Cannot delete — this driver is on ${onRoutes} route${onRoutes === 1 ? '' : 's'}. Take them off first.`);
    }
    const doc = await tenantModel('transport_drivers', tenantContext(req))
      .findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Driver not found');

    AuditService.log({ action: 'transport.driver_deleted', actor: req.jwtUser, schoolId, target: { type: 'driver', id: doc.id, label: doc.name }, req });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[transport/drivers DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ROUTES — bus/van route definitions
   ══════════════════════════════════════════════════════════════ */

/* GET /api/transport/routes */
router.get('/routes', rbac('transport', 'read'), async (req, res) => {
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
router.get('/routes/:id', rbac('transport', 'read'), async (req, res) => {
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

/* Resolve the vehicle/driver a route points at into the fields every reader
   (portals included) already expects. Returns the merged route data, or an
   error response payload when an id does not belong to this school. */
async function _resolveRouteLinks(req, data) {
  const { schoolId } = req.jwtUser;
  const out = { ...data };

  if (data.vehicleId) {
    const vehicle = await tenantModel('transport_vehicles', tenantContext(req))
      .findOne({ id: data.vehicleId, schoolId }).lean();
    if (!vehicle) return { error: { status: 400, message: 'That vehicle is not on this school\'s fleet.' } };
    out.vehicleReg  = vehicle.registration;
    out.vehicleType = vehicle.vehicleType;
    out.capacity    = vehicle.capacity ?? null;
  } else {
    out.capacity = data.capacity ?? null;
  }

  if (data.driverId) {
    const driver = await tenantModel('transport_drivers', tenantContext(req))
      .findOne({ id: data.driverId, schoolId }).lean();
    if (!driver) return { error: { status: 400, message: 'That driver is not on this school\'s list.' } };
    out.driverName  = driver.name;
    out.driverPhone = driver.phone ?? '';
  }

  return { data: out };
}

/* POST /api/transport/routes */
router.post('/routes', rbac('transport', 'create', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(RouteSchema, req.body);
    if (error) return E.validation(res, error);

    const linked = await _resolveRouteLinks(req, data);
    if (linked.error) return res.status(linked.error.status).json({ error: linked.error.message });

    const doc = await tenantModel('transport_routes', tenantContext(req)).create({
      id:        uuidv4(),
      schoolId,
      ...linked.data,
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
router.put('/routes/:id', rbac('transport', 'update', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const existing = await tenantModel('transport_routes', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Route not found');

    const { data, error } = _validate(RouteSchema, req.body);
    if (error) return E.validation(res, error);

    const linked = await _resolveRouteLinks(req, data);
    if (linked.error) return res.status(linked.error.status).json({ error: linked.error.message });

    const doc = await tenantModel('transport_routes', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...linked.data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[transport/routes PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/transport/routes/:id */
router.delete('/routes/:id', rbac('transport', 'delete', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

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
router.get('/assignments', rbac('transport', 'read'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { routeId, studentId, status } = req.query;

    const filter = { schoolId };
    /* Only callers with assignment-management access see everyone's
       assignment; everyone else is scoped to their own (a narrowing, not
       a gate — rbac() above already establishes baseline transport:read). */
    const canManage = await hasPermission(req, 'transport', 'update', 'assign');
    if (!canManage) {
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
router.post('/assignments', rbac('transport', 'create', 'assign'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

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
      fareType:     data.fareType,
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

/* POST /api/transport/assignments/bulk — one route, fare and pickup for several
   students (usually of one class). Each student still gets their OWN assignment
   record, so billing and changes stay per student. Everything is checked before
   anything is written: the route and its fare, that every student is an active
   student of this school, duplicates, and remaining seats. A student already on
   this route is skipped and reported, never duplicated. */
const BulkAssignmentSchema = z.object({
  routeId:    z.string().min(1),
  fareType:   z.enum(['one_way', 'two_way']),
  direction:  z.enum(['to_school', 'from_school', 'both']).optional().default('both'),
  pickupStop: z.string().max(200).trim().optional().default(''),
  startDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes:      z.string().max(300).trim().optional().default(''),
  students:   z.array(z.object({
                studentId:    z.string().min(1),
                studentName:  z.string().max(200).trim().optional().default(''),
                studentClass: z.string().max(100).trim().optional().default(''),
              })).min(1).max(200),
});

router.post('/assignments/bulk', rbac('transport', 'create', 'assign'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkAssignmentSchema, req.body);
    if (error) return E.validation(res, error);
    const ctx = tenantContext(req);

    const route = await tenantModel('transport_routes', ctx).findOne({ id: data.routeId, schoolId }).lean();
    if (!route) return E.notFound(res, 'Route not found');
    if (!(route.fares ?? []).some(f => f.fareType === data.fareType)) {
      return E.badRequest(res, `This route has no ${data.fareType === 'one_way' ? 'one-way' : 'two-way'} fare. Set it on the route first.`);
    }

    const ids = [...new Set(data.students.map(s => s.studentId))];
    const found = await tenantModel('students', ctx).find({ schoolId, id: { $in: ids }, status: 'active' }).select('id').lean();
    const foundIds = new Set(found.map(s => s.id));
    const missing = ids.filter(id => !foundIds.has(id));
    if (missing.length) {
      return E.validation(res, [{ field: 'students', message: `Not active students in this school: ${missing.join(', ')}` }]);
    }

    const Assignments = tenantModel('transport_assignments', ctx);
    const active = await Assignments.find({ schoolId, routeId: data.routeId, status: 'active' }).select('studentId').lean();
    const alreadyOn = new Set(active.map(a => a.studentId));

    const seen = new Set();
    const toCreate = [];
    const skipped = [];
    for (const s of data.students) {
      if (seen.has(s.studentId)) { skipped.push({ studentId: s.studentId, reason: 'listed more than once' }); continue; }
      seen.add(s.studentId);
      if (alreadyOn.has(s.studentId)) { skipped.push({ studentId: s.studentId, reason: 'already on this route' }); continue; }
      toCreate.push(s);
    }

    if (route.capacity) {
      const seatsLeft = Math.max(route.capacity - active.length, 0);
      if (toCreate.length > seatsLeft) {
        return E.badRequest(res, `Only ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on this route (capacity ${route.capacity}), but ${toCreate.length} student${toCreate.length === 1 ? ' is' : 's are'} to be added.`);
      }
    }

    const now = new Date().toISOString();
    const docs = toCreate.map(s => ({
      id:           uuidv4(),
      schoolId,
      routeId:      data.routeId,
      routeName:    route.name,
      studentId:    s.studentId,
      studentName:  s.studentName,
      studentClass: s.studentClass,
      pickupStop:   data.pickupStop,
      direction:    data.direction,
      fareType:     data.fareType,
      startDate:    data.startDate ?? now.slice(0, 10),
      endDate:      data.endDate   ?? null,
      notes:        data.notes,
      status:       'active',
      createdBy:    userId,
      createdAt:    now,
      updatedAt:    now,
    }));
    if (docs.length) await Assignments.insertMany(docs);

    AuditService.log({ action: 'transport.assignments_bulk_created', actor: req.jwtUser, schoolId, target: { type: 'route', id: data.routeId, label: route.name }, details: { fareType: data.fareType, created: docs.length, skipped: skipped.length }, req });
    return ok(res, { created: docs.length, skipped });
  } catch (err) {
    console.error('[transport/assignments/bulk POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/transport/assignments/:id — update or deactivate */
router.patch('/assignments/:id', rbac('transport', 'update', 'assign'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

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
router.delete('/assignments/:id', rbac('transport', 'delete', 'assign'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const doc = await tenantModel('transport_assignments', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Assignment not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[transport/assignments DELETE]', err);
    return E.serverError(res);
  }
});

/* ── Summary ─────────────────────────────────────────────────── */
router.get('/summary', rbac('transport', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;

    const [routeCount, vehicleCount, driverCount, assignmentAgg] = await Promise.all([
      tenantModel('transport_routes', tenantContext(req)).countDocuments({ schoolId }),
      tenantModel('transport_vehicles', tenantContext(req)).countDocuments({ schoolId }),
      tenantModel('transport_drivers', tenantContext(req)).countDocuments({ schoolId }),
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
      totalVehicles:     vehicleCount,
      totalDrivers:      driverCount,
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
