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
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }                  = require('../middleware/rbac');
const { planGate }              = require('../middleware/plan');
const { scopeMiddleware }       = require('../middleware/scopeMiddleware');
const ScopeEngine               = require('../utils/scopeEngine');
const { _model }                = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { nextFreeAdmissionNumber, reserveFreeAdmissionNumbers } = require('../utils/counters');
const { mergeStudentData } = require('../utils/student-merge');
const { ok, created, fail, paginate, parsePagination, E, strParam } = require('../utils/response');
const { applyOptimisticLock } = require('../utils/optimistic-lock');
const AuditService            = require('../services/audit');
const { provisionIdentityForUser } = require('../utils/provision-identities');

const router = express.Router();
const PLAN   = planGate('students');
const MODGATE = moduleGate('students');

/* Medical Centre milestone 1 — the Student Profile's "Medical" tab
   (client/src/pages/students/StudentProfile.jsx, MedicalTab) has always
   posted this shape via PUT /students/:id { medical: {...} }, but this
   schema never declared a `medical` field — Zod silently strips unknown
   keys, so every "Edit medical info" save was a no-op. This is the fix,
   not a new field addition. Deliberately a plain sub-object (not its own
   collection) to match the storage shape the existing UI already reads/
   writes — see the dependency audit's "fix in place" decision. */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown'];
const MedicalInfoSchema = z.object({
  bloodGroup:        z.enum(BLOOD_GROUPS).or(z.literal('')).optional(),
  allergies:         z.string().max(1000).optional(),
  conditions:        z.string().max(1000).optional(),
  disabilities:      z.string().max(1000).optional(),
  // Supersedes the legacy top-level `medicalNotes` (still accepted at
  // creation for a fast enrollment-time note; see the mirroring logic in
  // POST / below). This is the field the Medical tab shows/edits going
  // forward.
  notes:             z.string().max(2000).optional(),
  emergencyName:     z.string().max(200).optional(),
  emergencyPhone:    z.string().max(30).optional(),
  emergencyRelation: z.string().max(100).optional(),
  doctorName:        z.string().max(200).optional(),
  doctorPhone:       z.string().max(30).optional(),
  vaccinations:      z.string().max(1000).optional(),
  // Parent Medical Consent — recordedAt/recordedBy are deliberately NOT
  // part of this client-facing schema; PUT /:id stamps them itself only
  // when parentConsentGiven actually changes, same "server owns the
  // audit-trail metadata" posture as createdBy/updatedBy elsewhere.
  parentConsentGiven: z.boolean().optional(),
  parentConsentNotes: z.string().max(500).optional(),
  // Medical Centre milestone 4 — critical-condition flags that surface as
  // teacher-visible Alerts (GET /api/medical/alerts), distinct from and far
  // narrower than the full profile above. The three named examples from
  // the module spec get their own checkbox; anything else critical goes in
  // the free-text catch-all rather than an ever-growing boolean list.
  severeAllergy:      z.boolean().optional(),
  hasAsthma:          z.boolean().optional(),
  hasEpilepsy:        z.boolean().optional(),
  otherCriticalAlert: z.string().max(300).optional(),
});

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
  parentRelationship: z.string().max(50).optional(),
  // Mother / Father — 2026-09 field update. Declared here (not just
  // accepted implicitly) so bulk import's per-parent detail survives any
  // future edit through this same schema instead of being silently
  // stripped — zod drops unknown keys by default. See
  // server/utils/guardian-contact.js for the parentName/Email/Phone
  // derivation these feed; this schema itself does not derive anything,
  // it only accepts the raw values (import-export.js's _importStudents
  // does the derivation before these documents are ever built).
  motherName:      z.string().max(200).trim().optional(),
  motherEmail:     z.string().email().optional().or(z.literal('')),
  motherPhone:     z.string().max(30).optional(),
  motherIdNumber:  z.string().max(50).trim().optional(),
  fatherName:      z.string().max(200).trim().optional(),
  fatherEmail:     z.string().email().optional().or(z.literal('')),
  fatherPhone:     z.string().max(30).optional(),
  fatherIdNumber:  z.string().max(50).trim().optional(),
  primaryContact:  z.enum(['mother', 'father']).optional(),
  address:        z.string().max(500).optional(),
  medicalNotes:   z.string().max(2000).optional(), // legacy free-text field — see MedicalInfoSchema above for the Medical tab's actual shape
  medical:        MedicalInfoSchema.optional(),
  photo:          z.string().optional(),
  schoolEmail:    z.string().email().optional().or(z.literal('')),
  enrollmentDate: z.string().optional(),
  status:         z.enum(['active', 'inactive', 'suspended', 'graduated', 'transferred', 'withdrawn']).default('active'),
  // 2026-09 — flat-rate discount eligibility flags, resolved by
  // finance.js's _resolveAutoDiscounts() at invoice-generation time
  // against any active 'director'/'referral' discount_policies (the same
  // mechanism enrollmentDate feeds for sibling discounts).
  isDirectorFamily: z.boolean().optional(),
  isReferralFamily: z.boolean().optional(),
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
router.get('/stats', authMiddleware, PLAN, MODGATE, rbac('students', 'read'), async (req, res) => {
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

/* ── GET /api/students/duplicates ─ Find students sharing one admission
   number (2026-09) ──────────────────────────────────────────────────
   Detection only — never deletes anything on its own. v5.75.0 stopped
   NEW duplicates from being created, but did nothing for ones already
   sitting in the data (a manually-imported admission number the
   counter never learned about, handed out again later). Admission
   number is the same unambiguous "same person" signal already used by
   every other duplicate check in this codebase (v5.70.0's CSV-import
   check, v5.75.0's collision-safe counter) — a blank number is never
   treated as a group of its own. */
router.get('/duplicates', authMiddleware, PLAN, MODGATE, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Students = tenantModel('students', tenantContext(req));
    const Invoices = tenantModel('invoices', tenantContext(req));
    const Payments = tenantModel('payments', tenantContext(req));

    const groups = await Students.aggregate([
      { $match: { schoolId, admissionNumber: { $nin: [null, ''] } } },
      { $group: { _id: '$admissionNumber', count: { $sum: 1 }, docs: { $push: '$$ROOT' } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    if (groups.length === 0) {
      return ok(res, { groups: [], totalGroups: 0, totalDuplicateRecords: 0 });
    }

    // One pass to count linked invoices/payments for every student across
    // every group — used only to suggest which record to keep (the one
    // actually in use); the admin always makes the final call, never an
    // automatic deletion.
    const allIds = groups.flatMap(g => g.docs.map(d => d.id).filter(Boolean));
    const [invoiceCounts, paymentCounts] = await Promise.all([
      Invoices.aggregate([{ $match: { schoolId, studentId: { $in: allIds } } }, { $group: { _id: '$studentId', count: { $sum: 1 } } }]),
      Payments.aggregate([{ $match: { schoolId, studentId: { $in: allIds } } }, { $group: { _id: '$studentId', count: { $sum: 1 } } }]),
    ]);
    const invoiceCountById = Object.fromEntries(invoiceCounts.map(c => [c._id, c.count]));
    const paymentCountById = Object.fromEntries(paymentCounts.map(c => [c._id, c.count]));

    const groupList = groups.map(g => {
      const students = g.docs.map(d => {
        const id            = d.id ?? String(d._id);
        const invoiceCount  = invoiceCountById[id] ?? 0;
        const paymentCount  = paymentCountById[id] ?? 0;
        return {
          id, firstName: d.firstName, middleName: d.middleName, lastName: d.lastName,
          gender: d.gender, dateOfBirth: d.dateOfBirth,
          classId: d.classId, className: d.className,
          houseId: d.houseId, status: d.status,
          parentName: d.parentName, parentEmail: d.parentEmail,
          createdAt: d.createdAt,
          invoiceCount, paymentCount, linkedRecords: invoiceCount + paymentCount,
        };
      });

      // Suggests whichever record has more linked activity (invoices/
      // payments) — that's the one actually in use day to day. Ties go
      // to whichever was created first, since a later duplicate is more
      // likely to be the accidental re-entry. A suggestion only — never
      // acted on until the admin picks one via POST /duplicates/resolve.
      const recommended = [...students].sort((a, b) =>
        b.linkedRecords - a.linkedRecords ||
        new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
      )[0];
      const recommendedReason = recommended.linkedRecords > 0
        ? `Has ${recommended.linkedRecords} linked invoice/payment record${recommended.linkedRecords === 1 ? '' : 's'} — the others have none or fewer.`
        : 'Created first — none of these have any invoices or payments yet.';

      return {
        admissionNumber: g._id,
        count: g.count,
        students,
        recommendedKeepId: recommended.id,
        recommendedReason,
      };
    });

    return ok(res, {
      groups: groupList,
      totalGroups: groupList.length,
      totalDuplicateRecords: groupList.reduce((sum, g) => sum + g.count, 0),
    });
  } catch (err) {
    console.error('[students GET /duplicates]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/students/duplicates/resolve ─ Keep one, merge the rest
   of a duplicate-admission-number group into it (2026-09) ───────────
   Deliberately narrow: every id in `removeIds` must share the SAME
   admission number as `keepId` — this can only ever resolve a genuine
   duplicate group from GET /duplicates above, never touch an unrelated
   student by a mistaken or tampered id.

   MERGES, does not just delete (2026-09 audit — "how do you ensure the
   database is also aligned... no dead code after the delete"): the two
   records are the same real child, so their attendance, exam results,
   behaviour history, invoices/payments, and everything else with a
   studentId reference (see student-merge.js for the full list) is
   re-pointed onto the kept record BEFORE the removed one is deleted —
   never silently orphaned, never silently destroyed. See
   student-merge.js's own header for the one disclosed edge case this
   can't fully resolve on its own (a one-row-per-student collection can
   end up with two rows if both original records already had one). */
router.post('/duplicates/resolve', authMiddleware, PLAN, MODGATE, rbac('students', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { keepId, removeIds } = req.body;

    if (!keepId || typeof keepId !== 'string') return E.badRequest(res, 'keepId is required');
    if (!Array.isArray(removeIds) || removeIds.length === 0) return E.badRequest(res, 'removeIds array is required');
    if (removeIds.length > 50) return E.badRequest(res, 'Maximum 50 records per resolve. Split into smaller batches.');

    const ctx      = tenantContext(req);
    const Students = tenantModel('students', ctx);

    const keeper = await Students.findOne({ id: keepId, schoolId }).select('id admissionNumber firstName lastName').lean();
    if (!keeper) return E.notFound(res, 'The student to keep was not found');
    if (!keeper.admissionNumber) return E.badRequest(res, 'The student to keep has no admission number — nothing to resolve');

    const toRemove = await Students.find({
      id: { $in: removeIds }, schoolId, admissionNumber: keeper.admissionNumber,
    }).select('id _id firstName lastName').lean();

    if (toRemove.length === 0) {
      return E.badRequest(res, 'None of removeIds share an admission number with keepId — nothing was removed');
    }
    if (toRemove.length !== removeIds.length) {
      // Some requested ids didn't match — either a different admission
      // number (not part of THIS duplicate group) or don't exist at all.
      // Refuse the whole request rather than silently deleting a subset,
      // since the client's idea of the group no longer matches reality.
      return E.badRequest(res, `${removeIds.length - toRemove.length} of the given record(s) do not share this admission number — refresh and try again`);
    }

    const mergedCounts = {};
    for (const s of toRemove) {
      const counts = await mergeStudentData(schoolId, ctx, s, keeper.id);
      for (const [col, n] of Object.entries(counts)) mergedCounts[col] = (mergedCounts[col] ?? 0) + n;
    }

    const mongoIds = toRemove.map(s => s._id);
    await Students.deleteMany({ _id: { $in: mongoIds }, schoolId });

    AuditService.log({
      action: 'student.deleted',
      actor:  req.jwtUser,
      schoolId,
      target: { type: 'student', id: 'bulk', label: `${toRemove.length} duplicate student(s) merged into ${keeper.firstName ?? ''} ${keeper.lastName ?? ''} (admission number ${keeper.admissionNumber})`.trim() },
      details: {
        count: toRemove.length,
        kept: { id: keeper.id, name: `${keeper.firstName ?? ''} ${keeper.lastName ?? ''}`.trim() },
        removed: toRemove.map(s => ({ id: s.id ?? String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() })),
        admissionNumber: keeper.admissionNumber,
        mergedRecords: mergedCounts,
      },
      req,
    });

    console.log(`[students/duplicates/resolve] ${userId} kept ${keeper.id}, merged and removed ${toRemove.length} duplicate(s) of admission number ${keeper.admissionNumber} in school ${schoolId}`);
    return ok(res, { kept: keeper.id, removed: toRemove.length, mergedRecords: mergedCounts });
  } catch (err) {
    console.error('[students POST /duplicates/resolve]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/students/duplicates/resolve-bulk ─ Resolve several
   duplicate groups in one request (2026-09) ─────────────────────────
   Same per-group validation as POST /duplicates/resolve above — every
   removeId is re-checked against its own keepId's admission number —
   but applied independently per resolution, matching this codebase's
   established bulk-import convention (v5.70.0/v5.71.0/v5.74.0): one
   bad group is reported in `errors` and skipped, it never fails the
   whole batch. Same merge-then-delete treatment as the single-resolve
   route above (see student-merge.js) — every valid group's removed
   record(s) are re-pointed onto that group's own keeper before the
   final combined delete + ONE audit log entry for the whole batch. */
router.post('/duplicates/resolve-bulk', authMiddleware, PLAN, MODGATE, rbac('students', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { resolutions } = req.body;

    if (!Array.isArray(resolutions) || resolutions.length === 0) {
      return E.badRequest(res, 'resolutions array is required');
    }
    if (resolutions.length > 50) {
      return E.badRequest(res, 'Maximum 50 groups per request. Split into smaller batches.');
    }

    const ctx      = tenantContext(req);
    const Students = tenantModel('students', ctx);

    const results = { resolved: 0, removed: 0, errors: [] };
    const allMongoIds   = [];
    const auditGroups   = [];
    const mergedCounts  = {};

    for (let i = 0; i < resolutions.length; i++) {
      const row = i + 1;
      const { keepId, removeIds } = resolutions[i] || {};

      if (!keepId || typeof keepId !== 'string') {
        results.errors.push({ row, message: 'keepId is required' }); continue;
      }
      if (!Array.isArray(removeIds) || removeIds.length === 0) {
        results.errors.push({ row, keepId, message: 'removeIds array is required' }); continue;
      }

      const keeper = await Students.findOne({ id: keepId, schoolId }).select('id admissionNumber firstName lastName').lean();
      if (!keeper) {
        results.errors.push({ row, keepId, message: 'Student to keep was not found' }); continue;
      }
      if (!keeper.admissionNumber) {
        results.errors.push({ row, keepId, message: 'Student to keep has no admission number' }); continue;
      }

      const toRemove = await Students.find({
        id: { $in: removeIds }, schoolId, admissionNumber: keeper.admissionNumber,
      }).select('id _id firstName lastName').lean();

      if (toRemove.length !== removeIds.length) {
        // Same rule as the single-resolve route: refuse THIS group
        // rather than silently deleting a subset of it — every other
        // valid group in the batch still proceeds.
        results.errors.push({ row, keepId, message: `${removeIds.length - toRemove.length} of the given record(s) for this group do not share its admission number — group skipped` });
        continue;
      }

      for (const s of toRemove) {
        const counts = await mergeStudentData(schoolId, ctx, s, keeper.id);
        for (const [col, n] of Object.entries(counts)) mergedCounts[col] = (mergedCounts[col] ?? 0) + n;
      }

      allMongoIds.push(...toRemove.map(s => s._id));
      auditGroups.push({
        kept:            { id: keeper.id, name: `${keeper.firstName ?? ''} ${keeper.lastName ?? ''}`.trim() },
        removed:         toRemove.map(s => ({ id: s.id ?? String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() })),
        admissionNumber: keeper.admissionNumber,
      });
      results.resolved++;
      results.removed += toRemove.length;
    }

    if (allMongoIds.length > 0) {
      await Students.deleteMany({ _id: { $in: allMongoIds }, schoolId });

      AuditService.log({
        action: 'student.deleted',
        actor:  req.jwtUser,
        schoolId,
        target: { type: 'student', id: 'bulk', label: `${results.removed} duplicate student(s) merged across ${results.resolved} group(s)` },
        details: { count: results.removed, groups: auditGroups, mergedRecords: mergedCounts },
        req,
      });

      console.log(`[students/duplicates/resolve-bulk] ${userId} resolved ${results.resolved} group(s), removed ${results.removed} duplicate(s) in school ${schoolId}`);
    }

    return ok(res, { ...results, mergedRecords: mergedCounts }, null, results.errors.length > 0 ? 207 : 200);
  } catch (err) {
    console.error('[students POST /duplicates/resolve-bulk]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/students ─ Paginated list ─────────────────────── */
router.get('/', authMiddleware, PLAN, MODGATE, rbac('students', 'read'), scopeMiddleware, async (req, res) => {
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

    // Dashboard's "recently added" activity feed — filters by createdAt (a
    // record-creation timestamp), deliberately distinct from enrollmentDate
    // above (a nominal, sometimes-backdated academic date). "Students added
    // in the selected period" should reflect actual system activity, not a
    // manually-entered enrollment date that could predate the record itself.
    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo)   filter.createdAt.$lte = new Date(`${req.query.dateTo}T23:59:59.999Z`);
    }

    // Free-text search on name / admissionNumber / parent email (2026-09
    // fix — reported directly: a newly-enrolled student wasn't found by
    // search even though the school's total count included them).
    // firstName/lastName/middleName are separate fields, but a single
    // regex against "John Doe" can only ever match ONE field at a time —
    // "John Doe" never appears verbatim in a firstName ("John") or a
    // lastName ("Doe") alone, so a full-name search always returned zero
    // results, silently, no matter how exact the name was. Each word of
    // the search is now matched independently and ALL must be found
    // (possibly across different fields) — "John Doe" now requires one
    // field to contain "John" AND one to contain "Doe", which a single
    // name still satisfies trivially (only one word to match).
    if (req.query.search?.trim()) {
      const terms = req.query.search.trim().split(/\s+/)
        .map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      filter.$and = terms.map(rx => ({
        $or: [
          { firstName: rx }, { lastName: rx }, { middleName: rx },
          { admissionNumber: rx }, { parentEmail: rx },
        ],
      }));
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
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('students', 'read'), async (req, res) => {
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
router.post('/', authMiddleware, PLAN, MODGATE, rbac('students', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(StudentCreateSchema, req.body);
    if (error) return E.validation(res, error);

    const Students = tenantModel('students', tenantContext(req));

    // Use manually supplied number or auto-generate from school config.
    // Either way, checked against existing students first — nothing at
    // the DB layer stops a duplicate (students_admission is a lookup
    // index, not a unique one), and the counter alone can't be trusted:
    // a manually-supplied number (this field, or an existing student
    // imported with their real-world number) never advances it, so
    // auto-generation can otherwise walk straight into an already-used
    // number. See reserveFreeAdmissionNumbers' own comment for the full
    // story.
    const admCfg      = await _getAdmConfig(schoolId);
    const manualAdmNo = data.admissionNumber?.trim();
    let admissionNumber;
    if (manualAdmNo) {
      const taken = await Students.exists({ schoolId, admissionNumber: manualAdmNo });
      if (taken) return E.conflict(res, `Admission number '${manualAdmNo}' is already in use by another student.`);
      admissionNumber = manualAdmNo;
    } else {
      admissionNumber = await nextFreeAdmissionNumber(schoolId, admCfg,
        n => Students.exists({ schoolId, admissionNumber: n }));
    }
    delete data.admissionNumber;

    // Enrollment forms (StudentList.jsx's Add Student modal) still capture
    // the legacy top-level medicalNotes as a fast quick-entry field — mirror
    // it into the new medical.notes home so a nurse filling in the full
    // Medical tab later sees it already there, rather than two disconnected
    // "medical notes" fields drifting apart from day one.
    if (data.medicalNotes && !data.medical?.notes) {
      data.medical = { ...data.medical, notes: data.medicalNotes };
    }

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
router.put('/:id', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    const { data, error } = _validate(StudentUpdateSchema, req.body);
    if (error) return E.validation(res, error);

    // Immutable server-generated fields — admissionNumber is handled
    // separately below (it's editable, just never silently changed).
    const clientVersion = data._v;
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

    // Admission number — reported directly (2026-09): "how do you edit
    // admission number of a student, if the system picks automatically."
    // The Student Profile edit form has always HAD this field, but it
    // was silently discarded here on every save with no error at all —
    // a save appeared to succeed while the number never actually
    // changed. Now handled like any other manual override: checked
    // against every OTHER student in the school first (the same
    // collision guard POST / already applies), so an edit can't
    // silently create the exact kind of duplicate v5.75.0 stopped at
    // creation time.
    if (data.admissionNumber !== undefined) {
      const newAdmNo = data.admissionNumber.trim();
      if (!newAdmNo) return E.badRequest(res, 'Admission number cannot be blank');
      if (newAdmNo !== existing.admissionNumber) {
        // Excluded by _id (always present, unlike the UUID `id` field —
        // see the pre-migration-record comment above) so this can never
        // accidentally match the very record being edited.
        const taken = await Students.exists({ schoolId, admissionNumber: newAdmNo, _id: { $ne: existing._id } });
        if (taken) return E.conflict(res, `Admission number '${newAdmNo}' is already in use by another student.`);
        data.admissionNumber = newAdmNo;
      } else {
        delete data.admissionNumber; // unchanged — nothing to write
      }
    }

    // Parent Medical Consent — recordedAt/recordedBy are server-stamped,
    // never trusted from the client, and only refreshed when the consent
    // VALUE actually changes; an unrelated edit (e.g. updating allergies)
    // must not silently overwrite who/when consent was last recorded.
    const prevMedical = existing.medical || {};
    let consentChanged = false;
    if (data.medical && data.medical.parentConsentGiven !== undefined) {
      consentChanged = data.medical.parentConsentGiven !== prevMedical.parentConsentGiven;
      data.medical = {
        ...data.medical,
        parentConsentRecordedAt: consentChanged ? new Date().toISOString() : prevMedical.parentConsentRecordedAt,
        parentConsentRecordedBy: consentChanged ? userId : prevMedical.parentConsentRecordedBy,
      };
    }

    const { doc, conflict } = await applyOptimisticLock(
      Students,
      { _id: existing._id },
      { ...data, updatedBy: userId },
      clientVersion
    );

    if (conflict) return E.conflict(res, 'This student record was edited by someone else. Please refresh and try again.');
    if (!doc)     return E.notFound(res, 'Student not found');

    if (consentChanged) {
      AuditService.log({
        action: 'student.medical_consent_recorded', actor: req.jwtUser, schoolId,
        target: { type: 'student', id: doc.id ?? String(doc._id), label: `${doc.firstName} ${doc.lastName}` },
        details: { given: data.medical.parentConsentGiven }, req,
      });
    }

    if (data.medical) {
      AuditService.log({
        action: 'student.medical_updated', actor: req.jwtUser, schoolId,
        target: { type: 'student', id: doc.id ?? String(doc._id), label: `${doc.firstName} ${doc.lastName}` },
        req,
      });
    }

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
router.delete('/purge', authMiddleware, PLAN, MODGATE, rbac('students', 'delete'), async (req, res) => {
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
    }).select('id _id firstName lastName').lean();

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

    // Security Baseline Register, AUD-04 — this route deleted students (plus
    // their invoices and payments) permanently and irreversibly with only a
    // console.log, unlike the single-record DELETE /:id above, which calls
    // AuditService.log and is registered in ALERT_ACTIONS (webhook alerting)
    // for exactly this action. The webhook built specifically to catch
    // student deletions never fired for a bulk purge. Reuses the SAME
    // action name ('student.deleted') the single-delete route already uses
    // — not a new action — so the existing ALERT_ACTIONS lookup and any
    // downstream consumer that already filters by that action name picks
    // this up with no separate wiring. One combined entry for the whole
    // batch, not one per student, matching this codebase's existing
    // convention for bulk operations (e.g. finance.js's
    // 'finance.bulk_invoices_generated') rather than firing up to 200
    // separate webhook deliveries for one request.
    AuditService.log({
      action: 'student.deleted',
      actor:  req.jwtUser,
      schoolId,
      target: { type: 'student', id: 'bulk', label: `${found.length} student(s) (bulk purge)` },
      details: {
        count: found.length,
        requested: ids.length,
        students: found.map(s => ({ id: s.id ?? String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() })),
      },
      req,
    });

    console.log(`[students/purge] ${userId} permanently deleted ${found.length} student(s) in school ${schoolId}`);
    return ok(res, { deleted: found.length, requested: ids.length });
  } catch (err) {
    console.error('[students DELETE/purge]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/students/:id ─ Soft-delete (status=inactive) ─ */
router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('students', 'delete'), async (req, res) => {
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
router.post('/bulk', authMiddleware, PLAN, MODGATE, rbac('students', 'create'), async (req, res) => {
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

    // Every admission number handed out here — manual or auto-generated —
    // is checked against this so nothing collides with an existing
    // student. Kept in sync as rows are processed so two rows in the same
    // batch can't collide with each other either. See
    // reserveFreeAdmissionNumbers' comment for why the counter alone
    // can't be trusted to avoid this on its own.
    const existingAdmNos = new Set(
      (await Students.find({ schoolId }).select('admissionNumber').lean())
        .map(s => s.admissionNumber?.trim()).filter(Boolean)
    );

    // Validate all rows first; collect those needing auto-generated numbers
    const validated = [];
    for (let i = 0; i < students.length; i++) {
      const { data, error } = _validate(StudentCreateSchema, students[i]);
      if (error) { results.errors.push({ row: i + 1, issues: error }); results.skipped++; continue; }
      const manualNo = data.admissionNumber?.trim();
      if (manualNo && existingAdmNos.has(manualNo)) {
        results.errors.push({ row: i + 1, field: 'admissionNumber', message: `Admission number '${manualNo}' is already in use by another student.` });
        results.skipped++;
        continue;
      }
      if (manualNo) existingAdmNos.add(manualNo); // claim it so a later row in this same batch can't reuse it
      validated.push({ row: i + 1, data });
    }

    // Reserve a block of numbers for rows that don't supply their own
    const needsAuto  = validated.filter(v => !v.data.admissionNumber?.trim());
    const autoNos    = needsAuto.length
      ? await reserveFreeAdmissionNumbers(schoolId, needsAuto.length, admCfg, n => existingAdmNos.has(n))
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
router.post('/bulk-portal-accounts', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can grant portal access.');

    const { studentIds, all } = req.body;
    if (!all && (!Array.isArray(studentIds) || studentIds.length === 0)) {
      return E.badRequest(res, 'studentIds array is required (or pass { all: true } for every eligible student).');
    }
    if (Array.isArray(studentIds) && studentIds.length > 200) {
      return E.badRequest(res, 'Maximum 200 students per batch.');
    }

    const Students = tenantModel('students', tenantContext(req));
    const Users    = tenantModel('users', tenantContext(req));
    const Schools  = _model('schools');

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'student')) {
      return E.badRequest(res, 'Student portal requires the Student or Family tier. Upgrade your subscription to enable student logins.');
    }

    let docs;
    if (all) {
      // "Every eligible student" mode (2026-09) — for onboarding a school
      // whose students were just imported/enrolled: activates a portal
      // account for every one that doesn't already have one, in a single
      // action, instead of an admin manually checking students off page
      // by page. Pre-filtered to the same eligibility this route already
      // enforces per-row below (status, hasPortalAccount, admissionNumber)
      // so "all" never reports hundreds of "no admission number" errors
      // for students who were never eligible in the first place.
      docs = await Students.find({
        schoolId,
        status: { $nin: ['withdrawn', 'graduated', 'transferred'] },
        hasPortalAccount: { $ne: true },
        admissionNumber: { $exists: true, $nin: [null, ''] },
      }).lean();
      if (docs.length > 1000) {
        return E.badRequest(res, `${docs.length} students are eligible — "all" is capped at 1000 per request to keep this reliable. Run it again afterward to pick up any still-missing accounts, or select students in smaller batches instead.`);
      }
    } else {
      // Dual lookup — client may send UUID `id` or Mongo `_id` (pre-migration records)
      const mongoose = require('mongoose');
      const validObjectIds = studentIds.filter(id => mongoose.Types.ObjectId.isValid(id) && String(id).length === 24);
      docs = await Students.find({
        schoolId,
        $or: [
          { id: { $in: studentIds } },
          ...(validObjectIds.length ? [{ _id: { $in: validObjectIds } }] : []),
        ],
      }).lean();
    }
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
          const createdUser = await Users.create(bulkDoc);
          // C8/MR-001 Phase 0 (ADR-0003, Shadow) — non-blocking, self-healing.
          // No-op for the common case (no schoolEmail — student accounts log
          // in by username, Identity is meaningless without an email).
          try {
            await provisionIdentityForUser(createdUser);
          } catch (err) {
            console.error('[students] bulk-portal-accounts identity provisioning failed (will self-heal at next restart):', err.message);
          }
        }
        await Students.updateOne({ _id: student._id }, { $set: { hasPortalAccount: true, updatedAt: now } });
        credentials.push({ name, admissionNumber: student.admissionNumber, username, tempPassword, action: existing ? 'reset' : 'created' });
        created++;
      } catch (e) {
        errors.push({ studentId: studentDocId, message: e.message });
      }
    }));

    // Requested ids not found in DB count as skipped — meaningless in
    // "all" mode, where `docs` already IS the full eligible set.
    if (!all) skipped += Math.max(0, studentIds.length - docs.length);

    console.log(`[students] Bulk portal accounts: ${created} created, ${skipped} skipped, ${errors.length} errors — by ${userId}`);
    return ok(res, { created, skipped, errors, credentials, eligible: docs.length });
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
router.post('/:id/portal-account', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
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
        const createdUser = await Users.create(userDoc);
        // C8/MR-001 Phase 0 (ADR-0003, Shadow) — non-blocking, self-healing.
        try {
          await provisionIdentityForUser(createdUser);
        } catch (err) {
          console.error('[students] portal-account identity provisioning failed (will self-heal at next restart):', err.message);
        }
      } catch (createErr) {
        if (createErr.code === 11000) {
          if (createErr.keyPattern?.email && userDoc.email) {
            // Email already in use by another account — retry without email
            // (username login still works).
            const { email, ...noEmailDoc } = userDoc;
            await Users.create({ ...noEmailDoc, id: uuidv4() });
            // No identity hook here — the retry path exists precisely
            // because this account has no usable email (collided), so
            // provisionIdentityForUser would be a permanent no-op anyway.
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
router.delete('/:id/portal-account', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
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
   Sends welcome email with credentials.

   PER-PARENT ACCOUNTS (2026-09) — optional `req.body.guardian:
   'mother' | 'father'` selects WHICH parent's own name/email this
   call acts on:
     - omitted  → legacy behaviour, completely unchanged: uses the
       derived student.parentEmail/parentName (whichever parent is
       primaryContact, or the pre-split legacy fields), sets
       hasParentAccount. This is the path every existing caller and
       the pre-split UI already uses — nothing here breaks it.
     - 'mother' → uses student.motherEmail/motherName, sets
       hasMotherAccount.
     - 'father' → uses student.fatherEmail/fatherName, sets
       hasFatherAccount.
   Each is looked up/created by ITS OWN email, so a school can now
   give each parent their own fully independent login for the same
   child instead of one shared account — the real-world gap this
   whole 2026-09 guardian-email-mandatory change exists to close.

   SIBLING-AWARE either way: if an account already exists for that
   email — e.g. this parent has another child already enrolled — this
   call just $addToSet's the new student onto their existing
   studentIds/guardianOf instead of creating a duplicate account. That
   was already true for the legacy shared account; it now applies
   independently to Mother's and Father's own accounts too, so a
   parent with three children at the school still logs in once and
   sees all three, no matter which of their children's profiles the
   account was created from.
   ──────────────────────────────────────────────────────────────── */
router.post('/:id/parent-account', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const allowed = ['superadmin', 'admin', 'principal', 'deputy_principal'];
    if (!allowed.includes(role)) return E.forbidden(res, 'Only admin or principal can create parent portal accounts.');

    const guardian = req.body?.guardian;
    if (guardian !== undefined && guardian !== 'mother' && guardian !== 'father') {
      return E.badRequest(res, "guardian must be 'mother' or 'father' when provided.");
    }

    const Students = tenantModel('students', tenantContext(req));
    const Users    = tenantModel('users', tenantContext(req));
    const Schools  = _model('schools');

    let student = await Students.findOne({ id: req.params.id, schoolId }).lean();
    if (!student) {
      try { student = await Students.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
    }
    if (!student) return E.notFound(res, 'Student not found.');

    const rawEmail = guardian === 'mother' ? student.motherEmail
                    : guardian === 'father' ? student.fatherEmail
                    : student.parentEmail;
    const rawName  = guardian === 'mother' ? student.motherName
                    : guardian === 'father' ? student.fatherName
                    : student.parentName;
    if (!rawEmail) {
      const who = guardian === 'mother' ? "Mother's" : guardian === 'father' ? "Father's" : 'parent';
      return E.badRequest(res, `Student has no ${who} email on record. Add it first.`);
    }

    const school = await Schools.findOne({ id: schoolId }).lean();
    if (!_portalAllowed(school, 'parent')) {
      return E.badRequest(res, 'Parent portal requires the Family tier. Upgrade your subscription to enable parent logins.');
    }

    const studentDocId = student.id || String(student._id);
    const parentEmail = rawEmail.toLowerCase().trim();
    const parentName  = rawName || 'Parent';
    const now         = new Date().toISOString();
    const tempPassword = _genTempPassword();
    const hash        = await bcrypt.hash(tempPassword, 12);

    // Check if a parent account already exists for THIS email in this
    // school — sibling-aware for whichever guardian this call is for.
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
      const createdUser = await Users.create({
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
      // C8/MR-001 Phase 0 (ADR-0003, Shadow) — non-blocking, self-healing.
      try {
        await provisionIdentityForUser(createdUser);
      } catch (err) {
        console.error('[students] parent-account identity provisioning failed (will self-heal at next restart):', err.message);
      }
    }

    // Mark student as having this guardian's portal account. Legacy
    // hasParentAccount stays untouched by mother/father calls, and
    // vice versa — each flag tracks its own account independently.
    const flagField = guardian === 'mother' ? 'hasMotherAccount'
                     : guardian === 'father' ? 'hasFatherAccount'
                     : 'hasParentAccount';
    await Students.updateOne({ _id: student._id }, { $set: { [flagField]: true, updatedAt: now } });

    // Send welcome email to parent
    const emailUtil = require('../utils/email');
    await emailUtil.sendWelcomeCredentials({
      name:        parentName,
      email:       parentEmail,
      tempPassword,
      schoolName:  school.name,
      schoolEmail: school.systemEmail || '',
      role:        'Parent',
      slug:        school.slug,
    }).catch(err => console.error('[parent-account] Email send failed:', err.message));

    console.log(`[students] Parent account (${guardian || 'legacy'}) ${existing ? 'updated' : 'created'} for ${parentEmail} (student: ${studentDocId}) by ${userId}`);
    return ok(res, {
      email:     parentEmail,
      name:      parentName,
      studentId: studentDocId,
      guardian:  guardian || null,
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

router.patch('/:id/deactivate', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
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
router.patch('/:id/reactivate', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
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
router.post('/promote', authMiddleware, PLAN, MODGATE, rbac('students', 'update'), async (req, res) => {
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
