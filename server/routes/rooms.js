/* ============================================================
   Msingi — /api/rooms
   Physical room / venue registry, scoped per school.

   Consumers:
     - Timetable module (room view, slot editor dropdown)
     - Teaching assignments (preferredRoomId FK)

   RBAC: any authenticated user can list rooms (read).
         admin, deputy, principal, timetabler can create/edit/delete.

   Double-booking: ALLOWED — timetable conflict detection warns but
   never blocks. This route does not enforce scheduling constraints.
   ============================================================ */
'use strict';

const express        = require('express');
const { z }         = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();
// Writes gated on the 'rooms' sub-key under 'timetable' (already declared
// in server/config/moduleRegistry.js's timetable subs — "Manage Rooms").
// admin/superadmin/principal/deputy_principal/timetabler already hold real
// timetable:RCUD grants server-side (repairPermissions.js/onboard.js), the
// exact same 5 roles the old hardcoded MANAGE_ROLES set named — so this
// reproduces current behavior exactly while making it Settings-editable.

/* ── Validation ─────────────────────────────────────────────── */
const RoomSchema = z.object({
  name:     z.string().min(1).max(100).trim(),
  code:     z.string().max(20).trim().optional(),
  type:     z.enum(['classroom', 'lab', 'hall', 'sports', 'library', 'other']).default('classroom'),
  capacity: z.number().int().min(1).max(2000).optional(),
  notes:    z.string().max(500).optional(),
});

/* ── GET /api/rooms ─────────────────────────────────────────── */
router.get('/', authMiddleware, async (req, res) => { // rbac: intentionally open to every authenticated user — see header comment
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId, isActive: { $ne: false } };
    if (req.query.type) filter.type = req.query.type;

    const docs = await tenantModel('rooms', tenantContext(req))
      .find(filter)
      .sort({ name: 1 })
      .lean();

    return ok(res, docs);
  } catch (err) {
    console.error('[rooms GET /]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/rooms/:id ─────────────────────────────────────── */
router.get('/:id', authMiddleware, async (req, res) => { // rbac: intentionally open, same as GET /
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('rooms', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Room not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[rooms GET /:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/rooms ─────────────────────────────────────────── */
router.post('/', authMiddleware, rbac('timetable', 'create', 'rooms'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const result = RoomSchema.safeParse(req.body);
    if (!result.success) return E.validation(res, result.error.issues);

    const { data } = result;

    // Duplicate name guard within school
    const existing = await tenantModel('rooms', tenantContext(req)).findOne({
      schoolId, name: data.name, isActive: { $ne: false },
    }).lean();
    if (existing) return E.conflict(res, `Room "${data.name}" already exists in this school`);

    const doc = await tenantModel('rooms', tenantContext(req)).create({
      ...data,
      id:        uuidv4(),
      schoolId,
      isActive:  true,
      createdBy: userId,
      updatedBy: userId,
    });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[rooms POST /]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/rooms/:id ─────────────────────────────────────── */
router.put('/:id', authMiddleware, rbac('timetable', 'update', 'rooms'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const result = RoomSchema.partial().safeParse(req.body);
    if (!result.success) return E.validation(res, result.error.issues);

    // Name uniqueness check on rename
    if (result.data.name) {
      const conflict = await tenantModel('rooms', tenantContext(req)).findOne({
        schoolId, name: result.data.name, id: { $ne: req.params.id }, isActive: { $ne: false },
      }).lean();
      if (conflict) return E.conflict(res, `Room "${result.data.name}" already exists in this school`);
    }

    const doc = await tenantModel('rooms', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...result.data, updatedBy: userId },
      { new: true, runValidators: false },
    ).lean();

    if (!doc) return E.notFound(res, 'Room not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[rooms PUT /:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/rooms/:id — soft delete ───────────────────── */
router.delete('/:id', authMiddleware, rbac('timetable', 'delete', 'rooms'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await tenantModel('rooms', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { isActive: false, deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true },
    ).lean();

    if (!doc) return E.notFound(res, 'Room not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[rooms DELETE /:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
