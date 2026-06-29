/* ============================================================
   Msingi — /api/students  (Resource Route)
   Server-side RBAC + plan gating + Zod validation
   Paginated, scoped to schoolId from JWT.
   Server generates admission numbers via atomic counter.
   ============================================================ */
const express  = require('express');
const { z }    = require('zod');
const { v4: uuidv4 } = require('uuid');
const bcrypt   = require('bcryptjs');

const { authMiddleware }        = require('../middleware/auth');
const { rbac }                  = require('../middleware/rbac');
const { planGate }              = require('../middleware/plan');
const { scopeMiddleware }       = require('../middleware/scopeMiddleware');
const ScopeEngine               = require('../utils/scopeEngine');
const { _model }                = require('../utils/model');
const { nextAdmissionNumber, reserveAdmissionNumbers } = require('../utils/counters');
const { ok, created, fail, paginate, parsePagination, E, strParam } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');

const router = express.Router();
const PLAN   = planGate('students');

/* ── Validation schemas ─────────────────────────────────────── */
const StudentCreateSchema = z.object({
  admissionNumber: z.string().max(50).trim().optional(), // manual override; server auto-generates if omitted
  firstName:      z.string().min(1).max(100).trim(),
  lastName:       z.string().min(1).max(100).trim(),
  middleName:     z.string().max(100).trim().optional(),
  dateOfBirth:    z.string().optional(),
  gender:         z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classId:        z.string().optional(),
  streamId:       z.string().optional(),
  sectionId:      z.string().optional(),
  houseId:        z.string().optional(),
  keyStageId:     z.string().optional(),
  parentName:     z.string().max(200).trim().optional(),
  parentEmail:    z.string().email().optional().or(z.literal('')),
  parentPhone:    z.string().max(30).optional(),
  address:        z.string().max(500).optional(),
  medicalNotes:   z.string().max(2000).optional(),
  photo:          z.string().optional(),
  schoolEmail:    z.string().email().optional().or(z.literal('')),
  enrollmentDate: z.string().optional(),
  status:         z.enum(['active', 'inactive', 'suspended', 'graduated', 'transferred', 'withdrawn']).default('active'),
  customFields:   z.record(z.unknown()).optional(),
});

const StudentUpdateSchema = StudentCreateSchema.partial().omit({ status: true }).extend({
  status: z.enum(['active', 'inactive', 'suspended', 'graduated', 'transferred', 'withdrawn']).optional(),
});

function _validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  }
  return { data: result.data };
}

async function _getAdmConfig(schoolId) {
  const doc = await _model('schools').findOne({ id: schoolId }, { admissionConfig: 1 }).lean();
  return doc?.admissionConfig || {};
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

    // Resolve class names for entries that were imported without a denormalised className
    const unresolved = byClass.filter(c => c._id && !c.className);
    if (unresolved.length) {
      const mongoose = require('mongoose');
      const ids      = unresolved.map(c => c._id);
      const Classes  = _model('classes');
      const classDocs = await Classes.find({
        schoolId,
        $or: [
          { id:  { $in: ids } },
          ...(ids.some(id => id?.length === 24)
            ? [{ _id: { $in: ids.filter(id => id?.length === 24).map(id => { try { return new mongoose.Types.ObjectId(id); } catch { return null; } }).filter(Boolean) } }]
            : []),
        ],
      }).select('id _id name').lean();

      const nameById = {};
      for (const c of classDocs) nameById[c.id || c._id.toString()] = c.name;
      for (const entry of byClass) {
        if (entry._id && !entry.className) entry.className = nameById[entry._id] ?? entry._id;
      }
    }

    const total  = byStatus.reduce((a, s) => a + s.count, 0);
    const active = byStatus.find(s => s._id === 'active')?.count ?? 0;

    return ok(res, { total, active, byStatus, byGender, byClass });
  } catch (err) { console.error('[students GET /stats]', err); return E.serverError(res); }
});

/* ── GET /api/students ─ Paginated list ─────────────────────── */
router.get('/', authMiddleware, PLAN, rbac('students', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };

    // Status filter — default hides withdrawn/graduated; pass ?status=all for everything
    const statusParam = strParam(req.query.status);
    if (statusParam && statusParam !== 'all') {
      filter.status = statusParam;
    } else if (!statusParam) {
      filter.status = { $nin: ['withdrawn', 'graduated', 'transferred'] };
    }
    // (status=all → no status filter added)

    // strParam() guards against NoSQL operator injection (?classId[$ne]=x etc.)
    const classId       = strParam(req.query.classId);
    const streamId      = strParam(req.query.streamId);
    const sectionKey    = strParam(req.query.sectionKey);
    const enrollmentYear = strParam(req.query.enrollmentYear);
    const houseId       = strParam(req.query.houseId);
    const keyStageId    = strParam(req.query.keyStageId);
    const gender        = strParam(req.query.gender);

    if (streamId)   filter.streamId   = streamId;
    if (houseId)    filter.houseId    = houseId;
    if (keyStageId) filter.keyStageId = keyStageId;
    if (gender)     filter.gender     = gender;

    // Section filter — resolve sectionKey → list of classIds, then filter students
    if (sectionKey) {
      const sectionClassIds = await _model('classes')
        .find({ schoolId, sectionKey })
        .select('id').lean()
        .then(docs => docs.map(d => d.id).filter(Boolean));

      if (sectionClassIds.length === 0) {
        // No classes in this section → return empty immediately
        return ok(res, [], paginate(1, limit, 0));
      }
      // If classId is also set, honour it only if it belongs to the section
      if (classId) {
        filter.classId = sectionClassIds.includes(classId) ? classId : '__no_match__';
      } else {
        filter.classId = { $in: sectionClassIds };
      }
    } else if (classId) {
      filter.classId = classId;
    }

    // Enrolment year — ISO date strings sort lexicographically so range works
    if (enrollmentYear && /^\d{4}$/.test(enrollmentYear)) {
      filter.enrollmentDate = {
        $gte: `${enrollmentYear}-01-01`,
        $lte: `${enrollmentYear}-12-31`,
      };
    }

    // Free-text search on name / admissionNumber
    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { middleName: rx },
        { admissionNumber: rx }, { parentEmail: rx }
      ];
    }

    // Enforce data access scope (teachers see only their assigned classes)
    ScopeEngine.applyToFilter(req, 'students', filter);
    if (ScopeEngine.hasNoAssignments(req, 'students')) {
      return ok(res, [], { ...paginate(page, limit, 0), noAssignments: true });
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

    // Primary lookup by custom uuid `id` field
    let doc = await Students.findOne({ id: req.params.id, schoolId }).select('-__v').lean();

    // Fallback: some records (pre-migration) may only have MongoDB _id
    if (!doc) {
      try {
        doc = await Students.findOne({ _id: req.params.id, schoolId }).select('-__v').lean();
      } catch (_) { /* invalid ObjectId format — ignore, fall through to 404 */ }
    }

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

    // Use manually supplied number or auto-generate from school config
    const admCfg         = await _getAdmConfig(schoolId);
    const manualAdmNo    = data.admissionNumber?.trim();
    const admissionNumber = manualAdmNo || await nextAdmissionNumber(schoolId, admCfg);
    delete data.admissionNumber;

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

/* ── DELETE /api/students/purge ─ Hard-delete (admin/superadmin only) ─
   Permanently removes student records and cascades to invoices + payments.
   Route MUST stay above /:id so Express doesn't treat 'purge' as an id.
   ──────────────────────────────────────────────────────────────────── */
router.delete('/purge', authMiddleware, PLAN, rbac('students', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return E.badRequest(res, 'ids array is required');
    }
    if (ids.length > 200) {
      return E.badRequest(res, 'Maximum 200 records per purge. Split into smaller batches.');
    }

    const Students = _model('students');
    const Invoices = _model('invoices');
    const Payments = _model('payments');

    // Separate valid ObjectIds from UUID strings so we can do a dual lookup.
    // This handles both records created via the API (custom uuid `id` field) and
    // any records that might only have a MongoDB _id.
    const mongoose = require('mongoose');
    const validObjectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id) && id.length === 24);

    const found = await Students.find({
      schoolId,
      $or: [
        { id: { $in: ids } },
        ...(validObjectIds.length ? [{ _id: { $in: validObjectIds } }] : []),
      ],
    }).select('id _id').lean();

    if (found.length === 0) {
      console.warn(`[students/purge] No students found. schoolId=${schoolId} requested ids=${JSON.stringify(ids.slice(0, 5))}`);
      return E.notFound(res, 'No matching students found in this school');
    }

    // Use MongoDB _id for deletion (always reliable); custom id for finance cascade
    const mongoIds  = found.map(s => s._id);
    const customIds = found.map(s => s.id).filter(Boolean);

    await Promise.all([
      Students.deleteMany({ _id: { $in: mongoIds }, schoolId }),
      ...(customIds.length ? [
        Invoices.deleteMany({ studentId: { $in: customIds }, schoolId }),
        Payments.deleteMany({ studentId: { $in: customIds }, schoolId }),
      ] : []),
    ]);

    console.log(`[students/purge] ${userId} permanently deleted ${found.length} student(s) in school ${schoolId}`);
    return ok(res, { deleted: found.length, requested: ids.length });
  } catch (err) {
    console.error('[students DELETE/purge]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/students/:id ─ Soft-delete (status=inactive) ─ */
router.delete('/:id', authMiddleware, PLAN, rbac('students', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const Students = _model('students');
    const patch = { status: 'inactive', deletedAt: new Date().toISOString(), deletedBy: userId };

    // Primary lookup by custom uuid `id` field
    let doc = await Students.findOneAndUpdate(
      { id: req.params.id, schoolId }, patch, { new: true }
    ).lean();

    // Fallback: some records (pre-migration) may only have MongoDB _id
    if (!doc) {
      try {
        doc = await Students.findOneAndUpdate(
          { _id: req.params.id, schoolId }, patch, { new: true }
        ).lean();
      } catch (_) { /* invalid ObjectId format — ignore */ }
    }

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
    const admCfg   = await _getAdmConfig(schoolId);

    // Validate all rows first; collect those needing auto-generated numbers
    const validated = [];
    for (let i = 0; i < students.length; i++) {
      const { data, error } = _validate(StudentCreateSchema, students[i]);
      if (error) { results.errors.push({ row: i + 1, issues: error }); results.skipped++; continue; }
      validated.push({ row: i + 1, data });
    }

    // Reserve a block of numbers for rows that don't supply their own
    const needsAuto  = validated.filter(v => !v.data.admissionNumber?.trim());
    const autoNos    = needsAuto.length
      ? await reserveAdmissionNumbers(schoolId, needsAuto.length, admCfg)
      : [];
    let autoIdx = 0;

    for (const { data } of validated) {
      const manualNo        = data.admissionNumber?.trim();
      const admissionNumber = manualNo || autoNos[autoIdx++];
      delete data.admissionNumber;
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

/* ── POST /api/students/bulk-portal-accounts ────────────────────
   Grant student portal access to multiple students at once.
   Skips withdrawn/graduated and those whose plan doesn't allow it.
   Returns { created, skipped, errors } summary.
   ──────────────────────────────────────────────────────────────── */
router.post('/bulk-portal-accounts', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can grant portal access.');

    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return E.badRequest(res, 'studentIds array is required.');
    }
    if (studentIds.length > 200) return E.badRequest(res, 'Maximum 200 students per batch.');

    const Students = _model('students');
    const Users    = _model('users');
    const Schools  = _model('schools');

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'student')) {
      return E.badRequest(res, 'Student portal requires the Student or Family tier. Upgrade your subscription to enable student logins.');
    }

    const docs = await Students.find({ id: { $in: studentIds }, schoolId }).lean();
    const now  = new Date().toISOString();

    let created = 0, skipped = 0;
    const errors = [];

    await Promise.all(docs.map(async student => {
      try {
        if (['withdrawn', 'graduated', 'transferred'].includes(student.status)) {
          skipped++;
          return;
        }
        if (student.hasPortalAccount) {
          skipped++;
          return;
        }
        const tempPassword = _genTempPassword();
        const hash = await bcrypt.hash(tempPassword, 10);
        const username = student.admissionNumber.toLowerCase();
        const name     = `${student.firstName} ${student.lastName}`;

        const existing = await Users.findOne({ studentId: student.id, schoolId }).lean();
        if (existing) {
          await Users.updateOne({ id: existing.id }, {
            $set: { password: hash, mustChangePassword: true, isActive: true, updatedAt: now, updatedBy: userId },
          });
        } else {
          await Users.create({
            id: uuidv4(), schoolId, role: 'student', name, username,
            email: student.schoolEmail || null,
            password: hash, studentId: student.id,
            isActive: true, mustChangePassword: true,
            createdAt: now, updatedAt: now, createdBy: userId,
          });
        }
        await Students.updateOne({ id: student.id }, { $set: { hasPortalAccount: true, updatedAt: now } });
        created++;
      } catch (e) {
        errors.push({ studentId: student.id, message: e.message });
      }
    }));

    // studentIds not found in DB count as skipped
    skipped += studentIds.length - docs.length;

    console.log(`[students] Bulk portal accounts: ${created} created, ${skipped} skipped, ${errors.length} errors — by ${userId}`);
    return ok(res, { created, skipped, errors });
  } catch (err) {
    console.error('[students POST/bulk-portal-accounts]', err);
    return E.serverError(res);
  }
});

/* ── Local temp-password generator (mirrors auth.js) ─────────── */
function _genTempPassword() {
  const crypto = require('crypto');
  const alpha  = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums   = '23456789';
  let chars = '';
  // CSPRNG — crypto.randomInt, never Math.random()
  for (let i = 0; i < 8; i++) chars += alpha[crypto.randomInt(alpha.length)];
  chars += nums[crypto.randomInt(nums.length)] + nums[crypto.randomInt(nums.length)] + '!';
  // Fisher-Yates shuffle with CSPRNG
  const arr = chars.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/* ── Portal tier check helper ───────────────────────────────────
   Returns true if the school's plan supports the requested portal tier.
   During bootstrap (enterprise plan) all portals are always allowed. */
function _portalAllowed(school, portalType) {
  const plan = school?.plan || 'enterprise';
  const legacyToTier = { core: 'base', standard: 'student', premium: 'family' };
  const tier = legacyToTier[plan] || plan;
  if (tier === 'enterprise') return true;
  if (portalType === 'student') return ['student', 'family'].includes(tier);
  if (portalType === 'parent')  return tier === 'family';
  return false;
}

/* ── POST /api/students/:id/portal-account ───────────────────────
   Create or reset a student's portal login account.
   Restricted to admin / principal / deputy.
   Returns { username, tempPassword } — shown once, admin gives to student.
   ──────────────────────────────────────────────────────────────── */
router.post('/:id/portal-account', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can create student portal accounts.');

    const Students = _model('students');
    const Users    = _model('users');
    const Schools  = _model('schools');

    const student = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!student) return E.notFound(res, 'Student not found.');
    if (['withdrawn', 'graduated', 'transferred'].includes(student.status)) {
      return E.badRequest(res, `Cannot create portal account for a ${student.status} student.`);
    }

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'student')) {
      return E.badRequest(res, 'Student portal requires the Student or Family tier. Upgrade your subscription to enable student logins.');
    }

    if (!student.admissionNumber) {
      return E.badRequest(res, 'This student has no admission number. Assign one before creating a portal account.');
    }

    // Generate temp password — shown once to admin
    const tempPassword = _genTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    const username  = student.admissionNumber.toLowerCase();
    const name      = `${student.firstName} ${student.lastName}`;
    const now       = new Date().toISOString();

    // Upsert: find any existing account for this student.
    // The $or catches:
    //   a) accounts created with studentId properly set (primary path)
    //   b) accounts created before studentId was consistently stored (username fallback)
    // Without the username fallback, Users.create() would throw E11000 on the
    // unique { schoolId, username } index, producing an opaque 500.
    const existing = await Users.findOne({
      schoolId,
      $or: [{ studentId: student.id }, { username }],
    }).lean();

    if (existing) {
      // Update password and back-fill studentId if it was missing.
      await Users.updateOne({ id: existing.id }, {
        $set: {
          password:           hash,
          mustChangePassword: true,
          isActive:           true,
          studentId:          student.id,
          updatedAt:          now,
          updatedBy:          userId,
        },
      });
    } else {
      // No existing account — create fresh.
      const userDoc = {
        id:                 uuidv4(),
        schoolId,
        role:               'student',
        name,
        username,
        // schoolEmail as the login email; auth accepts email OR username
        email:              student.schoolEmail || null,
        password:           hash,
        studentId:          student.id,
        isActive:           true,
        mustChangePassword: true,
        createdAt:          now,
        updatedAt:          now,
        createdBy:          userId,
      };
      try {
        await Users.create(userDoc);
      } catch (createErr) {
        // Rare case: schoolEmail already in use by another account in this school.
        // Fall back to username-only login (no email on the account).
        if (createErr.code === 11000 && createErr.keyPattern?.email) {
          await Users.create({ ...userDoc, id: uuidv4(), email: null });
        } else {
          throw createErr;
        }
      }
    }

    // Mark student record as having a portal account
    await Students.updateOne({ id: student.id }, { $set: { hasPortalAccount: true, updatedAt: now } });

    console.log(`[students] Portal account ${existing ? 'reset' : 'created'} for student ${student.id} (${name}) by ${userId}`);
    return ok(res, { username, tempPassword, name, studentId: student.id, action: existing ? 'reset' : 'created' });
  } catch (err) {
    console.error('[students POST/:id/portal-account]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/students/:id/portal-account — deactivate student login ── */
router.delete('/:id/portal-account', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can manage student portal accounts.');

    const Users = _model('users');
    const result = await Users.updateOne(
      { studentId: req.params.id, schoolId, role: 'student' },
      { $set: { isActive: false, updatedAt: new Date().toISOString() } }
    );
    if (result.matchedCount === 0) return E.notFound(res, 'No portal account found for this student.');
    return ok(res, { deactivated: true });
  } catch (err) {
    console.error('[students DELETE/:id/portal-account]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/students/:id/parent-account ───────────────────────
   Create or reset a parent portal login account.
   Uses student.parentEmail as the login email.
   If a parent account already exists for this email, adds this student to their studentIds.
   Sends welcome email with credentials.
   ──────────────────────────────────────────────────────────────── */
router.post('/:id/parent-account', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can create parent portal accounts.');

    const Students = _model('students');
    const Users    = _model('users');
    const Schools  = _model('schools');

    const student = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!student) return E.notFound(res, 'Student not found.');
    if (!student.parentEmail) return E.badRequest(res, 'Student has no parent email on record. Add a parent email first.');

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'parent')) {
      return E.badRequest(res, 'Parent portal requires the Family tier. Upgrade your subscription to enable parent logins.');
    }

    const parentEmail = student.parentEmail.toLowerCase().trim();
    const parentName  = student.parentName || 'Parent';
    const now         = new Date().toISOString();
    const tempPassword = _genTempPassword();
    const hash        = await bcrypt.hash(tempPassword, 12);

    // Check if parent account already exists for this email in this school
    let existing = await Users.findOne({ email: parentEmail, schoolId, role: 'parent' }).lean();

    if (existing) {
      // Add this student to their children if not already there
      const currentIds = Array.isArray(existing.studentIds) ? existing.studentIds : [];
      if (!currentIds.includes(student.id)) {
        await Users.updateOne({ id: existing.id }, {
          $addToSet: { studentIds: student.id, guardianOf: student.id },
          $set: { updatedAt: now },
        });
      }
      // Reset password and send new credentials
      await Users.updateOne({ id: existing.id }, {
        $set: { password: hash, isActive: true, updatedAt: now },
      });
    } else {
      await Users.create({
        id:         uuidv4(),
        schoolId,
        role:       'parent',
        name:       parentName,
        email:      parentEmail,
        password:   hash,
        studentIds: [student.id],
        guardianOf: [student.id],
        isActive:   true,
        mustChangePassword: false,
        createdAt:  now,
        updatedAt:  now,
        createdBy:  userId,
      });
    }

    // Mark student as having a parent portal account
    await Students.updateOne({ id: student.id }, { $set: { hasParentAccount: true, updatedAt: now } });

    // Send welcome email to parent
    const emailUtil = require('../utils/email');
    await emailUtil.sendWelcomeCredentials({
      name:        parentName,
      email:       parentEmail,
      tempPassword,
      schoolName:  school.name,
      schoolEmail: school.systemEmail || '',
      role:        'Parent',
      loginUrl:    `https://msingi.io/platform`,
    }).catch(err => console.error('[parent-account] Email send failed:', err.message));

    console.log(`[students] Parent account ${existing ? 'updated' : 'created'} for ${parentEmail} (student: ${student.id}) by ${userId}`);
    return ok(res, {
      email:     parentEmail,
      name:      parentName,
      studentId: student.id,
      action:    existing ? 'updated' : 'created',
      emailSent: true,
    });
  } catch (err) {
    console.error('[students POST/:id/parent-account]', err);
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
    // Determine final status — graduated and transferred keep their own status values
    const finalStatus = (status === 'graduated' || reason === 'graduated')
      ? 'graduated'
      : (status === 'transferred' || reason === 'transferred')
        ? 'transferred'
        : 'withdrawn';

    const Students = _model('students');
    const doc = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Student not found');
    if (['withdrawn', 'graduated', 'transferred'].includes(doc.status)) {
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

/* ── POST /api/students/promote ──────────────────────────────────
   Bulk year-end promotion. Admin-only.

   Body:
     dryRun: boolean  — true = preview only, no DB writes
     promotions: [
       { fromClassId: string, toClassId: string | null }
       // toClassId null means "graduate this class"
     ]

   Active students in fromClassId are:
     - promoted  → classId + className updated to toClassId
     - graduated → status set to 'graduated', portal deactivated
   Skips: withdrawn, graduated, transferred, suspended.
   ──────────────────────────────────────────────────────────────── */
router.post('/promote', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;

    const { dryRun = false, promotions } = req.body;
    if (!Array.isArray(promotions) || promotions.length === 0) {
      return E.badRequest(res, 'promotions array is required.');
    }

    const SKIP_STATUSES = new Set(['withdrawn', 'graduated', 'transferred', 'suspended']);

    const Students = _model('students');
    const Classes  = _model('classes');

    // Load all target classes up-front to validate toClassIds and get names
    const toClassIds = promotions.map(p => p.toClassId).filter(Boolean);
    const fromClassIds = promotions.map(p => p.fromClassId).filter(Boolean);
    const allClassIds = [...new Set([...toClassIds, ...fromClassIds])];

    const classDocs = await Classes.find({ schoolId, id: { $in: allClassIds } }, { id: 1, name: 1 }).lean();
    const classMap  = Object.fromEntries(classDocs.map(c => [c.id, c.name]));

    // Validate: every fromClassId must exist
    for (const p of promotions) {
      if (!classMap[p.fromClassId]) {
        return E.badRequest(res, `Class not found: ${p.fromClassId}`);
      }
      if (p.toClassId && !classMap[p.toClassId]) {
        return E.badRequest(res, `Target class not found: ${p.toClassId}`);
      }
    }

    const now = new Date().toISOString();
    let totalPromoted = 0;
    let totalGraduated = 0;
    let totalSkipped = 0;
    const summary = [];

    for (const p of promotions) {
      const { fromClassId, toClassId } = p;
      const fromName = classMap[fromClassId];
      const isGraduate = !toClassId;
      const toName = toClassId ? classMap[toClassId] : null;

      // Find eligible students in this class
      const eligible = await Students.find(
        { schoolId, classId: fromClassId, status: { $nin: [...SKIP_STATUSES] } },
        { id: 1, firstName: 1, lastName: 1, status: 1, classId: 1, streamId: 1 }
      ).lean();

      const skipped = await Students.countDocuments({
        schoolId, classId: fromClassId, status: { $in: [...SKIP_STATUSES] }
      });
      totalSkipped += skipped;

      if (!dryRun && eligible.length > 0) {
        const eligibleIds = eligible.map(s => s.id);

        if (isGraduate) {
          // Mark as graduated
          await Students.updateMany(
            { schoolId, id: { $in: eligibleIds } },
            {
              $set: {
                status:             'graduated',
                deactivatedAt:      now,
                deactivatedBy:      userId,
                deactivationReason: 'graduated',
                promotedAt:         now,
                promotedBy:         userId,
                promotedFrom:       fromClassId,
                promotedFromName:   fromName,
                updatedAt:          now,
                updatedBy:          userId,
              }
            }
          );
          // Deactivate portal accounts for graduated students
          await _model('users').updateMany(
            { schoolId, studentId: { $in: eligibleIds }, role: 'student' },
            { $set: { isActive: false, updatedAt: now } }
          );
          totalGraduated += eligible.length;
        } else {
          // Promote to next class; clear stream (re-assigned in new class)
          await Students.updateMany(
            { schoolId, id: { $in: eligibleIds } },
            {
              $set: {
                classId:          toClassId,
                className:        toName,
                streamId:         null,
                streamName:       null,
                promotedAt:       now,
                promotedBy:       userId,
                promotedFrom:     fromClassId,
                promotedFromName: fromName,
                updatedAt:        now,
                updatedBy:        userId,
              }
            }
          );
          totalPromoted += eligible.length;
        }
      } else if (dryRun) {
        if (isGraduate) totalGraduated += eligible.length;
        else totalPromoted += eligible.length;
      }

      summary.push({
        fromClassId,
        fromClassName: fromName,
        toClassId:     toClassId ?? null,
        toClassName:   toName,
        action:        isGraduate ? 'graduate' : 'promote',
        count:         eligible.length,
        skipped,
      });
    }

    if (!dryRun) {
      console.log(`[students/promote] ${userId}: promoted ${totalPromoted}, graduated ${totalGraduated}, skipped ${totalSkipped}`);
    }

    return ok(res, {
      dryRun,
      summary,
      totals: { promoted: totalPromoted, graduated: totalGraduated, skipped: totalSkipped },
      ...(dryRun ? {} : { promotedBy: userId, promotedAt: now }),
    });
  } catch (err) {
    console.error('[students POST /promote]', err);
    return E.serverError(res);
  }
});

module.exports = router;
