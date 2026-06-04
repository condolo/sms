/* ============================================================
   Msingi — /api/students  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   Paginated, scoped to schoolId from JWT.
   Server generates admission numbers via atomic counter.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }        = require('../middleware/auth');
const { rbac }                  = require('../middleware/rbac');
const { planGate }              = require('../middleware/plan');
const { _model }                = require('../utils/model');
const { nextAdmissionNumber }   = require('../utils/counters');
const { ok, created, fail, paginate, parsePagination, E } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');

const router = express.Router();
const PLAN   = planGate('students');

/* ── Validation schemas ─────────────────────────────────────── */
const StudentCreateSchema = z.object({
  firstName:      z.string().min(1).max(100).trim(),
  lastName:       z.string().min(1).max(100).trim(),
  middleName:     z.string().max(100).trim().optional(),
  dateOfBirth:    z.string().optional(),
  gender:         z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classId:        z.string().optional(),
  sectionId:      z.string().optional(),
  houseId:        z.string().optional(),
  keyStageId:     z.string().optional(),
  parentName:     z.string().max(200).trim().optional(),
  parentEmail:    z.string().email().optional().or(z.literal('')),
  parentPhone:    z.string().max(30).optional(),
  address:        z.string().max(500).optional(),
  medicalNotes:   z.string().max(2000).optional(),
  photo:          z.string().optional(),
  enrollmentDate: z.string().optional(),
  status:         z.enum(['active', 'inactive', 'suspended', 'graduated', 'transferred']).default('active'),
  customFields:   z.record(z.unknown()).optional(),
});

const StudentUpdateSchema = StudentCreateSchema.partial().omit({ status: true }).extend({
  status: z.enum(['active', 'inactive', 'suspended', 'graduated', 'transferred']).optional(),
});

function _validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  }
  return { data: result.data };
}

/* ── GET /api/students/stats ─ Aggregate overview for dashboard ─ */
router.get('/stats', authMiddleware, PLAN, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Students = _model('students');

    const [byStatus, byGender, byClass] = await Promise.all([
      Students.aggregate([
        { $match: { schoolId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Students.aggregate([
        { $match: { schoolId, status: 'active' } },
        { $group: { _id: '$gender', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Students.aggregate([
        { $match: { schoolId, status: 'active' } },
        { $group: { _id: '$classId', className: { $first: '$className' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
    ]);

    const total  = byStatus.reduce((a, s) => a + s.count, 0);
    const active = byStatus.find(s => s._id === 'active')?.count ?? 0;

    return ok(res, { total, active, byStatus, byGender, byClass });
  } catch (err) { console.error('[students GET /stats]', err); return E.serverError(res); }
});

/* ── GET /api/students ─ Paginated list ─────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };

    // Status filter — default hides withdrawn/graduated; pass ?status=all for everything
    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    } else if (!req.query.status) {
      filter.status = { $nin: ['withdrawn', 'graduated'] };
    }
    // (status=all → no status filter added)

    if (req.query.classId)  filter.classId  = req.query.classId;
    if (req.query.houseId)  filter.houseId  = req.query.houseId;
    if (req.query.keyStageId) filter.keyStageId = req.query.keyStageId;
    if (req.query.gender)   filter.gender   = req.query.gender;

    // Free-text search on name / admissionNumber
    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { middleName: rx },
        { admissionNumber: rx }, { parentEmail: rx }
      ];
    }

    const Students = _model('students');
    const [docs, total] = await Promise.all([
      Students.find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip(skip).limit(limit)
        .select('-__v')
        .lean(),
      Students.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[students GET]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/students/:id ─ Single student ─────────────────── */
router.get('/:id', authMiddleware, PLAN, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Students = _model('students');
    const doc = await Students.findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Student not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[students GET/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/students ─ Create student ────────────────────── */
router.post('/', authMiddleware, PLAN, rbac('students', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(StudentCreateSchema, req.body);
    if (error) return E.validation(res, error);

    // Server-generate the admission number atomically
    const admissionNumber = await nextAdmissionNumber(schoolId);

    const Students = _model('students');
    const doc = await Students.create({
      ...data,
      id:              uuidv4(),
      schoolId,
      admissionNumber,
      createdBy:       userId,
      updatedBy:       userId,
    });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    if (err.code === 11000) return E.conflict(res, 'A student with those details already exists');
    console.error('[students POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/students/:id ─ Update student ─────────────────── */
router.put('/:id', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(StudentUpdateSchema, req.body);
    if (error) return E.validation(res, error);

    // Immutable server-generated fields
    const clientVersion = data._v;
    delete data.admissionNumber;
    delete data.schoolId;
    delete data.id;
    delete data._v;

    const { doc, conflict } = await applyOptimisticLock(
      _model('students'),
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'This student record was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Student not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[students PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/students/:id ─ Soft-delete (status=inactive) ─ */
router.delete('/:id', authMiddleware, PLAN, rbac('students', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const Students = _model('students');

    // Soft delete — preserve the record but mark as inactive
    const doc = await Students.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();

    if (!doc) return E.notFound(res, 'Student not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[students DELETE/:id]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/students/bulk ─ Bulk create ──────────────────── */
router.post('/bulk', authMiddleware, PLAN, rbac('students', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { students } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return E.badRequest(res, 'students array is required');
    }
    if (students.length > 500) {
      return E.badRequest(res, 'Maximum 500 students per bulk import');
    }

    const results  = { created: 0, skipped: 0, errors: [] };
    const Students = _model('students');
    const toInsert = [];

    for (let i = 0; i < students.length; i++) {
      const { data, error } = _validate(StudentCreateSchema, students[i]);
      if (error) {
        results.errors.push({ row: i + 1, issues: error });
        results.skipped++;
        continue;
      }
      const admissionNumber = await nextAdmissionNumber(schoolId);
      toInsert.push({ ...data, id: uuidv4(), schoolId, admissionNumber, createdBy: userId, updatedBy: userId });
    }

    if (toInsert.length > 0) {
      await Students.insertMany(toInsert, { ordered: false });
      results.created = toInsert.length;
    }

    return ok(res, results, null, results.errors.length > 0 ? 207 : 201);
  } catch (err) {
    console.error('[students POST /bulk]', err);
    return E.serverError(res);
  }
});

/* ── PATCH /api/students/:id/deactivate ─────────────────────────
   Mark a student as withdrawn or graduated.
   Preserves all academic records. Excluded from next billing snapshot.
   Only admin / principal / deputy can deactivate.
   ──────────────────────────────────────────────────────────────── */
const DEACTIVATE_REASONS = ['withdrawn', 'transferred', 'graduated', 'expelled', 'deceased', 'other'];

router.patch('/:id/deactivate', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    // Restrict to admin-level roles
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can deactivate students.');

    const { reason = 'withdrawn', notes = '', effectiveDate, status } = req.body;
    // Determine final status from reason
    const finalStatus = status === 'graduated' || reason === 'graduated' ? 'graduated' : 'withdrawn';

    const Students = _model('students');
    const doc = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Student not found');
    if (doc.status === 'withdrawn' || doc.status === 'graduated') {
      return E.badRequest(res, `Student is already ${doc.status}.`);
    }

    const now = new Date().toISOString();
    await Students.updateOne(
      { id: req.params.id, schoolId },
      {
        $set: {
          status:          finalStatus,
          deactivatedAt:   effectiveDate || now,
          deactivatedBy:   userId,
          deactivationReason: reason,
          deactivationNotes:  notes,
          updatedAt:       now,
          updatedBy:       userId,
        },
      }
    );

    console.log(`[students] Deactivated ${req.params.id} (${doc.firstName} ${doc.lastName}) → ${finalStatus} by ${userId}`);
    return ok(res, { id: req.params.id, status: finalStatus, reason, deactivatedAt: effectiveDate || now });
  } catch (err) {
    console.error('[students PATCH/:id/deactivate]', err);
    return E.serverError(res);
  }
});

/* ── PATCH /api/students/:id/reactivate ─────────────────────────
   Restore a withdrawn/graduated student to active status.
   ──────────────────────────────────────────────────────────────── */
router.patch('/:id/reactivate', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can reactivate students.');

    const Students = _model('students');
    const doc = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Student not found');
    if (doc.status === 'active') return E.badRequest(res, 'Student is already active.');

    const now = new Date().toISOString();
    await Students.updateOne(
      { id: req.params.id, schoolId },
      {
        $set:   { status: 'active', updatedAt: now, updatedBy: userId },
        $unset: { deactivatedAt: '', deactivatedBy: '', deactivationReason: '', deactivationNotes: '' },
      }
    );

    console.log(`[students] Reactivated ${req.params.id} (${doc.firstName} ${doc.lastName}) by ${userId}`);
    return ok(res, { id: req.params.id, status: 'active' });
  } catch (err) {
    console.error('[students PATCH/:id/reactivate]', err);
    return E.serverError(res);
  }
});

module.exports = router;
