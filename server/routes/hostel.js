/* ============================================================
   Msingi — Hostel Module
   /api/hostel

   Collections:
     hostels             — hostel / boarding house records
     hostel_rooms        — individual room records (NOT 'rooms'
                           which is owned by timetable/scheduling)
     hostel_assignments  — student ↔ room assignments

   Plan:  premium | RBAC: MANAGE_ROLES for write; all auth
          users can read hostels/rooms and their own assignment.
   ============================================================ */
const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('hostel');

router.use(authMiddleware, PLAN);

/* ── Roles allowed to manage the hostel ────────────────────── */
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'hostel_master']);

/* ── Validation schemas ──────────────────────────────────────── */
const HostelSchema = z.object({
  name:      z.string().min(1).max(200).trim(),
  gender:    z.enum(['male', 'female', 'mixed']).optional().default('mixed'),
  type:      z.enum(['day', 'boarding', 'both']).optional().default('boarding'),
  capacity:  z.coerce.number().int().min(1).optional().nullable(),
  warden:    z.string().max(200).trim().optional().default(''),
  phone:     z.string().max(30).trim().optional().default(''),
  location:  z.string().max(200).trim().optional().default(''),
  feePerTerm: z.coerce.number().min(0).optional().default(0),
  notes:     z.string().max(500).trim().optional().default(''),
});

const RoomSchema = z.object({
  hostelId:    z.string().min(1),
  roomNumber:  z.string().min(1).max(50).trim(),
  floor:       z.string().max(50).trim().optional().default(''),
  type:        z.enum(['dormitory', 'private', 'semi-private']).optional().default('dormitory'),
  capacity:    z.coerce.number().int().min(1).default(1),
  gender:      z.enum(['male', 'female', 'mixed']).optional().default('mixed'),
  notes:       z.string().max(300).trim().optional().default(''),
});

const AssignmentSchema = z.object({
  hostelId:     z.string().min(1),
  roomId:       z.string().min(1),
  studentId:    z.string().min(1),
  studentName:  z.string().max(200).trim().optional().default(''),
  studentClass: z.string().max(100).trim().optional().default(''),
  bedNumber:    z.string().max(20).trim().optional().default(''),
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
   HOSTELS — boarding house records
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hostel/hostels */
router.get('/hostels', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { gender } = req.query;

    const filter = { schoolId };
    if (gender) filter.gender = gender;

    const [docs, total] = await Promise.all([
      tenantModel('hostels', tenantContext(req)).find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('hostels', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hostel/hostels GET]', err);
    return E.serverError(res);
  }
});

/* GET /api/hostel/hostels/:id */
router.get('/hostels/:id', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('hostels', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Hostel not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[hostel/hostels GET/:id]', err);
    return E.serverError(res);
  }
});

/* POST /api/hostel/hostels */
router.post('/hostels', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const { data, error } = _validate(HostelSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('hostels', tenantContext(req)).create({
      id:        uuidv4(),
      schoolId,
      ...data,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[hostel/hostels POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/hostel/hostels/:id */
router.put('/hostels/:id', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const existing = await tenantModel('hostels', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Hostel not found');

    const { data, error } = _validate(HostelSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('hostels', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[hostel/hostels PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/hostel/hostels/:id */
router.delete('/hostels/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    /* Block if rooms or active assignments exist */
    const [roomCount, assignCount] = await Promise.all([
      tenantModel('hostel_rooms', tenantContext(req)).countDocuments({ schoolId, hostelId: req.params.id }),
      tenantModel('hostel_assignments', tenantContext(req)).countDocuments({ schoolId, hostelId: req.params.id, status: 'active' }),
    ]);
    if (roomCount > 0)   return E.badRequest(res, `Cannot delete — hostel still has ${roomCount} room(s). Remove rooms first.`);
    if (assignCount > 0) return E.badRequest(res, `Cannot delete — ${assignCount} student(s) are currently assigned`);

    const doc = await tenantModel('hostels', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Hostel not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[hostel/hostels DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ROOMS — hostel_rooms (NOT the timetable 'rooms' collection)
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hostel/rooms */
router.get('/rooms', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { hostelId, gender, type } = req.query;

    const filter = { schoolId };
    if (hostelId) filter.hostelId = hostelId;
    if (gender)   filter.gender   = gender;
    if (type)     filter.type     = type;

    const [docs, total] = await Promise.all([
      tenantModel('hostel_rooms', tenantContext(req)).find(filter).sort({ hostelId: 1, roomNumber: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('hostel_rooms', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hostel/rooms GET]', err);
    return E.serverError(res);
  }
});

/* GET /api/hostel/rooms/:id */
router.get('/rooms/:id', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('hostel_rooms', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Room not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[hostel/rooms GET/:id]', err);
    return E.serverError(res);
  }
});

/* POST /api/hostel/rooms */
router.post('/rooms', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const { data, error } = _validate(RoomSchema, req.body);
    if (error) return E.validation(res, error);

    /* Validate hostel exists */
    const hostel = await tenantModel('hostels', tenantContext(req)).findOne({ id: data.hostelId, schoolId }).lean();
    if (!hostel) return E.notFound(res, 'Hostel not found');

    /* Check room number unique within hostel */
    const dup = await tenantModel('hostel_rooms', tenantContext(req)).findOne({ schoolId, hostelId: data.hostelId, roomNumber: data.roomNumber }).lean();
    if (dup) return E.conflict(res, `Room "${data.roomNumber}" already exists in this hostel`);

    const now = new Date().toISOString();
    const doc = await tenantModel('hostel_rooms', tenantContext(req)).create({
      id:          uuidv4(),
      schoolId,
      hostelName:  hostel.name,
      ...data,
      occupied:    0,      // no students assigned yet
      createdBy:   userId,
      createdAt:   now,
      updatedAt:   now,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[hostel/rooms POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/hostel/rooms/:id */
router.put('/rooms/:id', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const existing = await tenantModel('hostel_rooms', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Room not found');

    const { data, error } = _validate(RoomSchema, req.body);
    if (error) return E.validation(res, error);

    /* Block if room number changed and conflicts */
    if (data.roomNumber !== existing.roomNumber) {
      const dup = await tenantModel('hostel_rooms', tenantContext(req)).findOne({
        schoolId, hostelId: existing.hostelId, roomNumber: data.roomNumber,
      }).lean();
      if (dup) return E.conflict(res, `Room "${data.roomNumber}" already exists in this hostel`);
    }

    /* Recalculate occupied count stays as-is (managed by assignment endpoints) */
    const doc = await tenantModel('hostel_rooms', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[hostel/rooms PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/hostel/rooms/:id */
router.delete('/rooms/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const activeOccupants = await tenantModel('hostel_assignments', tenantContext(req)).countDocuments({
      schoolId, roomId: req.params.id, status: 'active',
    });
    if (activeOccupants > 0) {
      return E.badRequest(res, `Cannot delete — ${activeOccupants} student(s) are currently in this room`);
    }

    const doc = await tenantModel('hostel_rooms', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Room not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[hostel/rooms DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ASSIGNMENTS — student ↔ room
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hostel/assignments */
router.get('/assignments', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { hostelId, roomId, studentId, status } = req.query;

    const filter = { schoolId };
    if (!MANAGE_ROLES.has(role)) {
      filter.studentId = userId;
    } else {
      if (studentId) filter.studentId = studentId;
    }
    if (hostelId) filter.hostelId = hostelId;
    if (roomId)   filter.roomId   = roomId;
    if (status)   filter.status   = status;

    const [docs, total] = await Promise.all([
      tenantModel('hostel_assignments', tenantContext(req)).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('hostel_assignments', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[hostel/assignments GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/hostel/assignments — assign student to room */
router.post('/assignments', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const { data, error } = _validate(AssignmentSchema, req.body);
    if (error) return E.validation(res, error);

    /* Validate room exists */
    const room = await tenantModel('hostel_rooms', tenantContext(req)).findOne({ id: data.roomId, schoolId }).lean();
    if (!room) return E.notFound(res, 'Room not found');

    /* Check student not already actively assigned in this school */
    const existingAssignment = await tenantModel('hostel_assignments', tenantContext(req)).findOne({
      schoolId, studentId: data.studentId, status: 'active',
    }).lean();
    if (existingAssignment) {
      return E.conflict(res, 'Student already has an active hostel assignment. Remove previous assignment first.');
    }

    /* Capacity check */
    const currentOccupied = await tenantModel('hostel_assignments', tenantContext(req)).countDocuments({
      schoolId, roomId: data.roomId, status: 'active',
    });
    if (currentOccupied >= (room.capacity ?? 1)) {
      return E.badRequest(res, `Room is full (capacity: ${room.capacity ?? 1})`);
    }

    const now = new Date().toISOString();
    const [assignment] = await Promise.all([
      tenantModel('hostel_assignments', tenantContext(req)).create({
        id:           uuidv4(),
        schoolId,
        hostelId:     data.hostelId,
        hostelName:   room.hostelName ?? '',
        roomId:       data.roomId,
        roomNumber:   room.roomNumber,
        studentId:    data.studentId,
        studentName:  data.studentName,
        studentClass: data.studentClass,
        bedNumber:    data.bedNumber,
        startDate:    data.startDate ?? now.slice(0, 10),
        endDate:      data.endDate   ?? null,
        notes:        data.notes,
        status:       'active',
        createdBy:    userId,
        createdAt:    now,
        updatedAt:    now,
      }),
      /* Increment occupied count */
      tenantModel('hostel_rooms', tenantContext(req)).updateOne(
        { id: data.roomId, schoolId },
        { $inc: { occupied: 1 } }
      ),
    ]);
    return created(res, assignment.toObject ? assignment.toObject() : assignment);
  } catch (err) {
    console.error('[hostel/assignments POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/hostel/assignments/:id/discharge — move student out */
router.patch('/assignments/:id/discharge', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const assignment = await tenantModel('hostel_assignments', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found');
    if (assignment.status !== 'active') return E.badRequest(res, 'Assignment is not currently active');

    const now = new Date().toISOString();
    const [updated] = await Promise.all([
      tenantModel('hostel_assignments', tenantContext(req)).findOneAndUpdate(
        { id: req.params.id, schoolId },
        { $set: {
            status:       'discharged',
            endDate:      now.slice(0, 10),
            dischargedAt: now,
            notes:        req.body?.notes ?? assignment.notes,
            updatedBy:    userId,
            updatedAt:    now,
          }
        },
        { new: true }
      ).lean(),
      /* Decrement occupied count, floor at 0 */
      tenantModel('hostel_rooms', tenantContext(req)).updateOne(
        { id: assignment.roomId, schoolId, occupied: { $gt: 0 } },
        { $inc: { occupied: -1 } }
      ),
    ]);
    return ok(res, updated);
  } catch (err) {
    console.error('[hostel/assignments PATCH discharge]', err);
    return E.serverError(res);
  }
});

/* ── Summary ─────────────────────────────────────────────────── */
router.get('/summary', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Hostel staff or Admin access required');

    const [hostelCount, roomAgg, assignAgg] = await Promise.all([
      tenantModel('hostels', tenantContext(req)).countDocuments({ schoolId }),
      tenantModel('hostel_rooms', tenantContext(req)).aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:      null,
            totalRooms:    { $sum: 1 },
            totalCapacity: { $sum: '$capacity' },
            totalOccupied: { $sum: '$occupied' },
        }},
      ]),
      tenantModel('hostel_assignments', tenantContext(req)).aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:         null,
            active:      { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            discharged:  { $sum: { $cond: [{ $eq: ['$status', 'discharged'] }, 1, 0] } },
        }},
      ]),
    ]);

    const ra = roomAgg[0]   ?? { totalRooms: 0, totalCapacity: 0, totalOccupied: 0 };
    const aa = assignAgg[0] ?? { active: 0, discharged: 0 };

    return ok(res, {
      totalHostels:    hostelCount,
      totalRooms:      ra.totalRooms,
      totalCapacity:   ra.totalCapacity,
      occupiedBeds:    ra.totalOccupied,
      availableBeds:   Math.max(0, (ra.totalCapacity ?? 0) - (ra.totalOccupied ?? 0)),
      activeResidents: aa.active,
      dischargedTotal: aa.discharged,
    });
  } catch (err) {
    console.error('[hostel/summary GET]', err);
    return E.serverError(res);
  }
});

module.exports = router;
