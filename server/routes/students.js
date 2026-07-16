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
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { nextAdmissionNumber, reserveAdmissionNumbers } = require('../utils/counters');
const { ok, created, fail, paginate, parsePagination, E, strParam } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');
const AuditService            = require('../services/audit');

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
  // Association fields — nullable so they can be explicitly cleared (e.g. removing from a stream)
  classId:        z.string().nullish(),
  className:      z.string().nullish(),
  streamId:       z.string().nullish(),
  streamName:     z.string().nullish(),
  sectionId:      z.string().nullish(),
  houseId:        z.string().nullish(),
  keyStageId:     z.string().nullish(),
  // Intake year/term — which academic year/term this student was enrolled in.
  // Defaulted client-side from the live-resolved current period (see
  // client/src/hooks/useCurrentAcademicPeriod.js) but always overridable.
  enrollmentAcademicYearId: z.string().nullish(),
  enrollmentTermId:         z.string().nullish(),
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

/* ── Identifier-form resolver ───────────────────────────────────
   Student docs reference classes/streams by whichever identifier was
   current when they were written: UUID `id` (post-migration) or Mongo
   `_id` string (pre-migration / imports). A filter that compares one
   form misses docs written under the other. Given one form, return
   EVERY form the entity is known by so filters can $in-match all. */
async function _entityIdForms(col, schoolId, value) {
  const mongoose = require('mongoose');
  const or = [{ id: value }];
  if (mongoose.Types.ObjectId.isValid(value) && String(value).length === 24) {
    or.push({ _id: value });
  }
  let doc = null;
  // Helper has schoolId (not req), so build the tenant context inline.
  try { doc = await tenantModel(col, { schoolId }).findOne({ schoolId, $or: or }).select('id').lean(); } catch (_) {}
  const forms = new Set([value]);
  if (doc?.id)  forms.add(doc.id);
  if (doc?._id) forms.add(String(doc._id));
  return [...forms];
}

/* ── GET /api/students/stats ─ Aggregate overview for dashboard ─ */
router.get('/stats', authMiddleware, PLAN, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Students = tenantModel('students', tenantContext(req));

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
      const Classes  = tenantModel('classes', tenantContext(req));
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

    // Stream/class references may be stored on student docs as either the UUID
    // `id` or the Mongo `_id` string (pre-migration / imported records), so
    // every filter matches ALL identifier forms of the selected entity.
    if (streamId)   filter.streamId   = { $in: await _entityIdForms('streams', schoolId, streamId) };
    if (houseId)    filter.houseId    = houseId;
    if (keyStageId) filter.keyStageId = keyStageId;
    if (gender)     filter.gender     = gender;

    // Section filter — resolve sectionKey → list of classIds, then filter students
    if (sectionKey) {
      // Include BOTH identifier forms of every class in the section — and note
      // `_id` is always present, so classes without a UUID are not dropped.
      const sectionClassIds = await tenantModel('classes', tenantContext(req))
        .find({ schoolId, sectionKey })
        .select('id').lean()
        .then(docs => docs.flatMap(d => [d.id, String(d._id)].filter(Boolean)));

      if (sectionClassIds.length === 0) {
        // No classes in this section → return empty immediately
        return ok(res, [], paginate(1, limit, 0));
      }
      // If classId is also set, honour it only if it belongs to the section
      if (classId) {
        const classForms = await _entityIdForms('classes', schoolId, classId);
        const within = classForms.filter(f => sectionClassIds.includes(f));
        filter.classId = within.length ? { $in: within } : '__no_match__';
      } else {
        filter.classId = { $in: sectionClassIds };
      }
    } else if (classId) {
      filter.classId = { $in: await _entityIdForms('classes', schoolId, classId) };
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

    const Students = tenantModel('students', tenantContext(req));
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
    const Students = tenantModel('students', tenantContext(req));

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

    const Students = tenantModel('students', tenantContext(req));
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

    // Resolve the student first so we can target by _id (always present),
    // which handles pre-migration records that have no UUID `id` field.
    const Students = tenantModel('students', tenantContext(req));
    let existing = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) {
      try { existing = await Students.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
    }
    if (!existing) return E.notFound(res, 'Student not found');

    const { doc, conflict } = await applyOptimisticLock(
      Students,
      { _id: existing._id },
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

    const Students = tenantModel('students', tenantContext(req));
    const Invoices = tenantModel('invoices', tenantContext(req));
    const Payments = tenantModel('payments', tenantContext(req));

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

    const Students = tenantModel('students', tenantContext(req));
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
    AuditService.log({ action: 'student.deleted', actor: req.jwtUser, schoolId, target: { type: 'student', id: req.params.id, label: `${doc.firstName} ${doc.lastName}` }, req });
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
    const Students = tenantModel('students', tenantContext(req));
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
   Returns { created, skipped, errors, credentials } — credentials
   is the ONE-TIME plaintext temp password list (admin downloads it
   as a CSV to print and distribute; never stored or shown again).
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

    const Students = tenantModel('students', tenantContext(req));
    const Users    = tenantModel('users', tenantContext(req));
    const Schools  = _model('schools');

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'student')) {
      return E.badRequest(res, 'Student portal requires the Student or Family tier. Upgrade your subscription to enable student logins.');
    }

    // Dual lookup — client may send UUID `id` or Mongo `_id` (pre-migration records)
    const mongoose = require('mongoose');
    const validObjectIds = studentIds.filter(id => mongoose.Types.ObjectId.isValid(id) && String(id).length === 24);
    const docs = await Students.find({
      schoolId,
      $or: [
        { id: { $in: studentIds } },
        ...(validObjectIds.length ? [{ _id: { $in: validObjectIds } }] : []),
      ],
    }).lean();
    const now  = new Date().toISOString();

    let created = 0, skipped = 0;
    const errors      = [];
    const credentials = [];  // one-time plaintext list returned to the admin

    await Promise.all(docs.map(async student => {
      const studentDocId = student.id || String(student._id);
      try {
        if (['withdrawn', 'graduated', 'transferred'].includes(student.status)) {
          skipped++;
          return;
        }
        if (student.hasPortalAccount) {
          skipped++;
          return;
        }
        if (!student.admissionNumber) {
          errors.push({ studentId: studentDocId, message: `${student.firstName} ${student.lastName}: no admission number — assign one first.` });
          return;
        }
        const tempPassword = _genTempPassword();
        const hash = await bcrypt.hash(tempPassword, 10);
        const username = student.admissionNumber.toLowerCase();
        const name     = `${student.firstName} ${student.lastName}`;

        // Match by studentId OR username — covers accounts orphaned by re-import
        const existing = await Users.findOne({ schoolId, $or: [{ studentId: studentDocId }, { username }] }).lean();
        if (existing) {
          await Users.updateOne({ _id: existing._id }, {
            $set: { password: hash, mustChangePassword: true, isActive: true, studentId: studentDocId, updatedAt: now, updatedBy: userId },
          });
        } else {
          const bulkDoc = {
            id: uuidv4(), schoolId, role: 'student', name, username,
            password: hash, studentId: studentDocId,
            isActive: true, mustChangePassword: true,
            createdAt: now, updatedAt: now, createdBy: userId,
          };
          // Omit email when absent — email: null collides on the unique (schoolId, email) index
          if (student.schoolEmail) bulkDoc.email = student.schoolEmail.toLowerCase();
          await Users.create(bulkDoc);
        }
        await Students.updateOne({ _id: student._id }, { $set: { hasPortalAccount: true, updatedAt: now } });
        credentials.push({ name, admissionNumber: student.admissionNumber, username, tempPassword, action: existing ? 'reset' : 'created' });
        created++;
      } catch (e) {
        errors.push({ studentId: studentDocId, message: e.message });
      }
    }));

    // studentIds not found in DB count as skipped
    skipped += Math.max(0, studentIds.length - docs.length);

    console.log(`[students] Bulk portal accounts: ${created} created, ${skipped} skipped, ${errors.length} errors — by ${userId}`);
    return ok(res, { created, skipped, errors, credentials });
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

    const Students = tenantModel('students', tenantContext(req));
    const Users    = tenantModel('users', tenantContext(req));
    const Schools  = _model('schools');

    let student = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!student) {
      try { student = await Students.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
    }
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

    const studentDocId = student.id || String(student._id);
    const tempPassword = _genTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    const username  = student.admissionNumber.toLowerCase();
    const name      = `${student.firstName} ${student.lastName}`;
    const now       = new Date().toISOString();

    // Broad lookup: covers studentId match, username match, and schoolEmail match.
    // This ensures we never hit a duplicate-key conflict when the account already
    // exists but was created under a different studentId (e.g. after re-import).
    const emailFilter = student.schoolEmail
      ? [{ email: student.schoolEmail.toLowerCase() }]
      : [];
    const existing = await Users.findOne({
      schoolId,
      $or: [{ studentId: studentDocId }, { username }, ...emailFilter],
    }).lean();

    if (existing) {
      // Account already exists — reset password and back-fill studentId.
      await Users.updateOne({ _id: existing._id }, {
        $set: {
          password:           hash,
          mustChangePassword: true,
          isActive:           true,
          studentId:          studentDocId,
          updatedAt:          now,
          updatedBy:          userId,
        },
      });
    } else {
      // Omit `email` entirely when the student has no school email — never
      // store email: null, which collides on the unique (schoolId, email)
      // index for the second email-less account in a school.
      const userDoc = {
        id:                 uuidv4(),
        schoolId,
        role:               'student',
        name,
        username,
        password:           hash,
        studentId:          studentDocId,
        isActive:           true,
        mustChangePassword: true,
        createdAt:          now,
        updatedAt:          now,
        createdBy:          userId,
      };
      if (student.schoolEmail) userDoc.email = student.schoolEmail.toLowerCase();
      try {
        await Users.create(userDoc);
      } catch (createErr) {
        if (createErr.code === 11000) {
          if (createErr.keyPattern?.email && userDoc.email) {
            // Email already in use by another account — retry without email
            // (username login still works).
            const { email, ...noEmailDoc } = userDoc;
            await Users.create({ ...noEmailDoc, id: uuidv4() });
          } else if (createErr.keyPattern?.username) {
            // Username conflict — another account exists with this username.
            // Find it and reset instead of failing.
            const conflicting = await Users.findOne({ schoolId, username }).lean();
            if (conflicting) {
              await Users.updateOne({ _id: conflicting._id }, {
                $set: { password: hash, mustChangePassword: true, isActive: true, studentId: studentDocId, updatedAt: now, updatedBy: userId },
              });
            } else {
              throw createErr;
            }
          } else {
            throw createErr;
          }
        } else {
          throw createErr;
        }
      }
    }

    // Mark student record as having a portal account
    await Students.updateOne({ _id: student._id }, { $set: { hasPortalAccount: true, updatedAt: now } });

    console.log(`[students] Portal account ${existing ? 'reset' : 'created'} for student ${studentDocId} (${name}) by ${userId}`);
    return ok(res, { username, tempPassword, name, studentId: studentDocId, action: existing ? 'reset' : 'created' });
  } catch (err) {
    console.error('[students POST/:id/portal-account]', err);
    if (err.code === 11000) {
      // Surface duplicate-key conflicts clearly instead of an opaque 500 —
      // tells the admin WHICH constraint blocked the account.
      const field = Object.keys(err.keyPattern || {}).filter(k => k !== 'schoolId').join(', ') || 'account';
      return E.conflict(res, `An account with this ${field} already exists in your school. If this student was re-imported, the old account may still exist — contact support or check Users.`);
    }
    return E.serverError(res, 'Could not create the portal account. Please try again — if it persists, contact support.');
  }
});

/* ── DELETE /api/students/:id/portal-account — deactivate student login ── */
router.delete('/:id/portal-account', authMiddleware, PLAN, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can manage student portal accounts.');

    const Users = tenantModel('users', tenantContext(req));
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

    const Students = tenantModel('students', tenantContext(req));
    const Users    = tenantModel('users', tenantContext(req));
    const Schools  = _model('schools');

    let student = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!student) {
      try { student = await Students.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
    }
    if (!student) return E.notFound(res, 'Student not found.');
    if (!student.parentEmail) return E.badRequest(res, 'Student has no parent email on record. Add a parent email first.');

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'parent')) {
      return E.badRequest(res, 'Parent portal requires the Family tier. Upgrade your subscription to enable parent logins.');
    }

    const studentDocId = student.id || String(student._id);
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
      if (!currentIds.includes(studentDocId)) {
        await Users.updateOne({ _id: existing._id }, {
          $addToSet: { studentIds: studentDocId, guardianOf: studentDocId },
          $set: { updatedAt: now },
        });
      }
      // Reset password and send new credentials
      await Users.updateOne({ _id: existing._id }, {
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
        studentIds: [studentDocId],
        guardianOf: [studentDocId],
        isActive:   true,
        mustChangePassword: false,
        createdAt:  now,
        updatedAt:  now,
        createdBy:  userId,
      });
    }

    // Mark student as having a parent portal account
    await Students.updateOne({ _id: student._id }, { $set: { hasParentAccount: true, updatedAt: now } });

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

    console.log(`[students] Parent account ${existing ? 'updated' : 'created'} for ${parentEmail} (student: ${studentDocId}) by ${userId}`);
    return ok(res, {
      email:     parentEmail,
      name:      parentName,
      studentId: studentDocId,
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

    const Students = tenantModel('students', tenantContext(req));
    let doc = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) {
      try { doc = await Students.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
    }
    if (!doc) return E.notFound(res, 'Student not found');
    if (['withdrawn', 'graduated', 'transferred'].includes(doc.status)) {
      return E.badRequest(res, `Student is already ${doc.status}.`);
    }

    // Use the stored uuid id field when available; fall back to _id string for pre-migration records
    const studentId = doc.id || String(doc._id);
    const now = new Date().toISOString();
    await Students.updateOne(
      { _id: doc._id },
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

    console.log(`[students] Deactivated ${studentId} (${doc.firstName} ${doc.lastName}) → ${finalStatus} by ${userId}`);
    AuditService.log({ action: 'student.deactivated', actor: req.jwtUser, schoolId, target: { type: 'student', id: studentId, label: `${doc.firstName} ${doc.lastName}` }, details: { status: finalStatus, reason }, req });
    return ok(res, { id: studentId, status: finalStatus, reason, deactivatedAt: effectiveDate || now });
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

    const Students = tenantModel('students', tenantContext(req));
    let doc = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) {
      try { doc = await Students.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
    }
    if (!doc) return E.notFound(res, 'Student not found');
    if (doc.status === 'active') return E.badRequest(res, 'Student is already active.');

    const studentId = doc.id || String(doc._id);
    const now = new Date().toISOString();
    await Students.updateOne(
      { _id: doc._id },
      {
        $set:   { status: 'active', updatedAt: now, updatedBy: userId },
        $unset: { deactivatedAt: '', deactivatedBy: '', deactivationReason: '', deactivationNotes: '' },
      }
    );

    console.log(`[students] Reactivated ${studentId} (${doc.firstName} ${doc.lastName}) by ${userId}`);
    return ok(res, { id: studentId, status: 'active' });
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

    const Students = tenantModel('students', tenantContext(req));
    const Classes  = tenantModel('classes', tenantContext(req));

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
          await tenantModel('users', tenantContext(req)).updateMany(
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
