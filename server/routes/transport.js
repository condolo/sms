/* ============================================================
   Msingi — Transport Module
   /api/transport

   Collections:
     transport_routes      — route definitions (bus runs)
     transport_assignments — student ↔ route assignments

   Plan:  standard | RBAC: rbac('transport', action, subKey) — 'manage' for
          route writes, 'assign' for assignment writes, 'delete' for route
          deletes. Every role with transport:read (the school-wide default)
          can browse routes and their own assignment; only a role with
          assignment-management access sees every student's assignment.
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

/* POST /api/transport/routes */
router.post('/routes', rbac('transport', 'create', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(RouteSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('transport_routes', tenantContext(req)).create({
      id:        uuidv4(),
      schoolId,
      ...data,
      occupied:  0, // server-maintained seat counter — see POST/PATCH /assignments and DELETE below
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

    const ctx    = tenantContext(req);
    const Routes = tenantModel('transport_routes', ctx);

    /* Validate route exists */
    const route = await Routes.findOne({ id: data.routeId, schoolId }).lean();
    if (!route) return E.notFound(res, 'Route not found');

    /* Check student not already actively assigned to same route */
    const existing = await tenantModel('transport_assignments', ctx).findOne({
      schoolId, routeId: data.routeId, studentId: data.studentId, status: 'active',
    }).lean();
    if (existing) return E.conflict(res, 'Student is already assigned to this route');

    // Claim a seat FIRST, atomically, and check the result — this guard is
    // what actually prevents two concurrent assigns of the last seat from
    // both succeeding. Before this fix, capacity was checked via a plain
    // countDocuments() read and the assignment was then created
    // unconditionally — two racing requests could both pass the check and
    // both create an 'active' assignment, overfilling the route with no
    // trace of the conflict. `$expr` compares `occupied` and `capacity` as
    // fields of the same document (both change together, nothing to race
    // against); `$ifNull` covers an older seeded route's unset `occupied`
    // defaulting to 0 (a one-time backfill sets every existing route's
    // `occupied` to its real current count before this guard ships, so
    // that default is never actually relied on for a route with existing
    // passengers). A route with no capacity set keeps the prior "always
    // allow" behavior but still tracks `occupied` for bookkeeping.
    const claim = route.capacity
      ? await Routes.updateOne(
          { id: data.routeId, schoolId, $expr: { $lt: [{ $ifNull: ['$occupied', 0] }, '$capacity'] } },
          { $inc: { occupied: 1 } }
        )
      : await Routes.updateOne({ id: data.routeId, schoolId }, { $inc: { occupied: 1 } });
    if (claim.matchedCount === 0) {
      return E.badRequest(res, `Route is at full capacity (${route.capacity} students)`);
    }

    const now = new Date().toISOString();
    let doc;
    try {
      doc = await tenantModel('transport_assignments', ctx).create({
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
    } catch (createErr) {
      // The seat was already claimed above but the assignment record
      // failed to write — give the seat back rather than leave `occupied`
      // inflated with no assignment to account for it.
      await Routes.updateOne({ id: data.routeId, schoolId }, { $inc: { occupied: -1 } });
      throw createErr;
    }
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
    const Routes = tenantModel('transport_routes', ctx);

    const route = await Routes.findOne({ id: data.routeId, schoolId }).lean();
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

    if (toCreate.length === 0) {
      return ok(res, { created: 0, skipped });
    }

    // Claim all `n` seats at once, atomically, and check the result — the
    // $expr guard compares occupied+n against capacity as a single
    // document condition, so this request (or a single /assignments call,
    // or another concurrent bulk call) racing for the same remaining seats
    // can't all succeed. The `active.length`-based check that used to be
    // the only gate here is kept below, but only as a fast pre-check for a
    // friendly "Only N seats left" message in the common (non-racing)
    // case — this $expr claim is what actually enforces it.
    const n = toCreate.length;
    if (route.capacity) {
      const preCheckSeatsLeft = Math.max(route.capacity - active.length, 0);
      if (n > preCheckSeatsLeft) {
        return E.badRequest(res, `Only ${preCheckSeatsLeft} seat${preCheckSeatsLeft === 1 ? '' : 's'} left on this route (capacity ${route.capacity}), but ${n} student${n === 1 ? ' is' : 's are'} to be added.`);
      }
    }
    const claim = route.capacity
      ? await Routes.updateOne(
          { id: data.routeId, schoolId, $expr: { $lte: [{ $add: [{ $ifNull: ['$occupied', 0] }, n] }, '$capacity'] } },
          { $inc: { occupied: n } }
        )
      : await Routes.updateOne({ id: data.routeId, schoolId }, { $inc: { occupied: n } });
    if (claim.matchedCount === 0) {
      // Occupied moved since the active.length snapshot above (another
      // request claimed seats in between) — re-derive the real number
      // left for an accurate message rather than repeating the stale one.
      const nowOccupied = (await Routes.findOne({ id: data.routeId, schoolId }).select('occupied').lean())?.occupied ?? active.length;
      const seatsLeft = Math.max(route.capacity - nowOccupied, 0);
      return E.badRequest(res, `Only ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on this route (capacity ${route.capacity}), but ${n} student${n === 1 ? ' is' : 's are'} to be added.`);
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
    try {
      await Assignments.insertMany(docs);
    } catch (insertErr) {
      // The seats were already claimed above but the batch failed to
      // write — give all `n` seats back rather than leave `occupied`
      // inflated with no assignments behind them. Same whole-batch
      // compensation style POST /assignments above and inventory.js/
      // library.js use for their own ledger-write failures.
      await Routes.updateOne({ id: data.routeId, schoolId }, { $inc: { occupied: -n } });
      throw insertErr;
    }

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
    const ctx = tenantContext(req);

    const existing = await tenantModel('transport_assignments', ctx).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Assignment not found');

    const allowed = ['pickupStop', 'direction', 'endDate', 'notes', 'status', 'studentName', 'studentClass'];
    const update  = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    // Not reachable from the client UI today (only assignBulk/remove are
    // wired up there), but this is still a live, authenticated API route
    // that accepts an arbitrary `status`, including re-activating a
    // closed assignment — without the same seat bookkeeping POST
    // /assignments and DELETE below do, that would both silently bypass
    // capacity on reactivation and desync `occupied` on deactivation.
    const wasActive    = existing.status === 'active';
    const willBeActive = update.status !== undefined ? update.status === 'active' : wasActive;
    const Routes = tenantModel('transport_routes', ctx);
    if (!wasActive && willBeActive) {
      const route = await Routes.findOne({ id: existing.routeId, schoolId }).lean();
      const claim = route?.capacity
        ? await Routes.updateOne(
            { id: existing.routeId, schoolId, $expr: { $lt: [{ $ifNull: ['$occupied', 0] }, '$capacity'] } },
            { $inc: { occupied: 1 } }
          )
        : await Routes.updateOne({ id: existing.routeId, schoolId }, { $inc: { occupied: 1 } });
      if (claim.matchedCount === 0) {
        return E.badRequest(res, `Route is at full capacity (${route?.capacity} students)`);
      }
    } else if (wasActive && !willBeActive) {
      await Routes.updateOne(
        { id: existing.routeId, schoolId, occupied: { $gt: 0 } },
        { $inc: { occupied: -1 } }
      );
    }

    update.updatedBy = userId;
    update.updatedAt = new Date().toISOString();

    const doc = await tenantModel('transport_assignments', ctx).findOneAndUpdate(
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
    const ctx = tenantContext(req);

    const doc = await tenantModel('transport_assignments', ctx).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Assignment not found');

    // Free the seat this assignment held — only if it was actually active
    // (an already-inactive assignment was never counted in `occupied`).
    // Guarded against going negative, same posture as library.js's
    // `copies: {$gt: 0}` guard.
    if (doc.status === 'active') {
      await tenantModel('transport_routes', ctx).updateOne(
        { id: doc.routeId, schoolId, occupied: { $gt: 0 } },
        { $inc: { occupied: -1 } }
      );
    }

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
