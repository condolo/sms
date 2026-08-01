/* ============================================================
   Msingi — /api/medical  (Medical Centre — Module 1, milestones 3-4)
   Sub-routes:
     /api/medical/visits — clinic visit log (the student's medical timeline)
     /api/medical/alerts — critical-condition flags only (milestone 4)

   Plan: core | RBAC: medical:{view,record,delete,alerts,reports}
   (see server/config/moduleRegistry.js)

   Design notes:
   - Every visit is its own immutable record — "never overwrite" per the
     module spec. No PUT/edit route exists on purpose; a data-entry
     mistake is corrected by soft-deleting the wrong visit (DELETE,
     medical:delete) and logging a new one, same posture growth-records.js
     already established for Growth Profile history (Governance Spec §2).
   - Soft-delete only (deletedAt/deletedBy) — the record is retained
     forever and excluded from default reads, never destroyed. Matches
     the "permanent medical history" requirement.
   - studentName is denormalized onto the visit at creation time (same
     convention as category/itemLabel in behaviour.js, and the studentName
     fix applied there this session) — resolved server-side from the
     student record if the caller doesn't supply one, so this can never
     regress into showing a raw studentId in the timeline UI.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine         = require('../utils/scopeEngine');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const AuditService = require('../services/audit');
const { notifyGuardiansForStudents } = require('../utils/notify-students');

const router  = express.Router();
const PLAN    = planGate('medical');
const MODGATE = moduleGate('medical');

/* ── Validation ─────────────────────────────────────────────── */
const VisitSchema = z.object({
  studentId:       z.string().min(1),
  studentName:     z.string().max(200).optional(), // resolved server-side if omitted — see _resolveStudentName
  date:            z.string().optional(),           // ISO date; defaults to today
  time:            z.string().max(10).optional(),   // "HH:MM"
  complaint:       z.string().min(1).max(1000),
  observation:     z.string().max(2000).optional(),
  actionTaken:     z.string().max(2000).optional(),
  medicationGiven: z.string().max(1000).optional(),
  returnedToClass: z.boolean().default(false),
  sentHome:        z.boolean().default(false),
  referred:        z.boolean().default(false),
  referredTo:      z.string().max(300).optional(),  // where referred, if referred=true
  notes:           z.string().max(2000).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

async function _resolveStudentName(ctx, schoolId, studentId) {
  const student = await tenantModel('students', ctx).findOne({ id: studentId, schoolId }).select('firstName lastName').lean();
  return student ? `${student.firstName} ${student.lastName}`.trim() : null;
}

/* ══════════════════════════════════════════════════════════════
   CLINIC VISITS
   ══════════════════════════════════════════════════════════════ */

/* GET /api/medical/visits — the student's medical timeline (or the
   whole clinic's, filtered) */
router.get('/visits', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'view'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId, deletedAt: { $exists: false } };
    const _sid = strParam(req.query.studentId);
    if (_sid) filter.studentId = _sid;

    const _df = strParam(req.query.dateFrom);
    const _dt = strParam(req.query.dateTo);
    if (_df || _dt) {
      filter.date = {};
      if (_df) filter.date.$gte = _df;
      if (_dt) filter.date.$lte = _dt;
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ studentName: rx }, { complaint: rx }];
    }

    const Visits = tenantModel('medical_visits', tenantContext(req));
    const [docs, total] = await Promise.all([
      Visits.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Visits.countDocuments(filter),
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[medical/visits GET]', err); return E.serverError(res); }
});

/* GET /api/medical/visits/:id */
router.get('/visits/:id', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'view'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('medical_visits', tenantContext(req))
      .findOne({ id: req.params.id, schoolId, deletedAt: { $exists: false } }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Visit not found');
    return ok(res, doc);
  } catch (err) { console.error('[medical/visits GET/:id]', err); return E.serverError(res); }
});

/* POST /api/medical/visits — log a new visit (never edited afterward) */
router.post('/visits', authMiddleware, PLAN, MODGATE, rbac('medical', 'create', 'record'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(VisitSchema, req.body);
    if (error) return E.validation(res, error);

    if (data.referred && !data.referredTo) {
      return E.badRequest(res, 'referredTo is required when referred is true');
    }

    const ctx = tenantContext(req);
    if (!data.studentName) {
      data.studentName = await _resolveStudentName(ctx, schoolId, data.studentId);
    }

    const doc = await tenantModel('medical_visits', ctx).create({
      ...data,
      id:         uuidv4(),
      schoolId,
      date:       data.date || new Date().toISOString().slice(0, 10),
      recordedBy: userId,
      createdBy:  userId,
      updatedBy:  userId,
    });
    const plain = doc.toObject ? doc.toObject() : doc;

    AuditService.log({
      action: 'medical.visit_logged', actor: req.jwtUser, schoolId,
      target: { type: 'student', id: data.studentId, label: data.studentName },
      details: { visitId: plain.id, sentHome: data.sentHome, referred: data.referred }, req,
    });

    notifyGuardiansForStudents({
      ctx, schoolId, eventKey: 'medical_visit_logged',
      items: [{
        studentId: data.studentId,
        inAppSubject: `Clinic visit logged for ${data.studentName || 'your child'}`,
        inAppBody:    data.complaint,
      }],
    }).catch(err => console.error('[medical/visits notify]', err));

    return created(res, plain);
  } catch (err) { console.error('[medical/visits POST]', err); return E.serverError(res); }
});

/* DELETE /api/medical/visits/:id — soft-delete only (correct a
   data-entry mistake by removing the wrong record and logging a new
   one; the original is retained, never destroyed). */
router.delete('/visits/:id', authMiddleware, PLAN, MODGATE, rbac('medical', 'delete', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await tenantModel('medical_visits', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId, deletedAt: { $exists: false } },
      { deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Visit not found');

    AuditService.log({
      action: 'medical.visit_deleted', actor: req.jwtUser, schoolId,
      target: { type: 'student', id: doc.studentId, label: doc.studentName }, req,
    });

    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[medical/visits DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   ALERTS — critical-condition flags only, never the full profile
   ══════════════════════════════════════════════════════════════

   The 'alerts' RBAC subKey (rbac('medical','read','alerts')) is what
   lets a teacher — who has no top-level 'medical' grant — see this
   endpoint at all (see repairPermissions.js/onboard.js: teacher gets
   ONLY medical__alerts, never the base 'medical' key). Beyond that
   permission gate, scopeMiddleware/ScopeEngine narrow results to the
   requester's own classes exactly like the main student roster does —
   a teacher sees alerts for their own students, not the whole school.

   The response is hand-built field-by-field from the query result
   rather than passed through — even a future .select() mistake widening
   the query can't leak bloodGroup/doctor/consent/notes through this
   route, because those fields are never referenced when building
   `alerts` below. */
router.get('/alerts', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'alerts'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = {
      schoolId,
      $or: [
        { 'medical.severeAllergy': true },
        { 'medical.hasAsthma': true },
        { 'medical.hasEpilepsy': true },
        { 'medical.otherCriticalAlert': { $exists: true, $ne: '' } },
      ],
    };

    // Same class-based scoping the main student roster (GET /api/students)
    // applies — a teacher only sees alerts for students in their own
    // classes, school-level roles see everyone.
    ScopeEngine.applyToFilter(req, 'students', filter);
    if (ScopeEngine.hasNoAssignments(req, 'students')) return ok(res, []);

    const docs = await tenantModel('students', tenantContext(req))
      .find(filter)
      .select('id firstName lastName classId className medical.severeAllergy medical.hasAsthma medical.hasEpilepsy medical.otherCriticalAlert')
      .sort({ lastName: 1, firstName: 1 })
      .limit(500)
      .lean();

    const alerts = docs.map(s => ({
      studentId:   s.id,
      studentName: `${s.firstName} ${s.lastName}`,
      classId:     s.classId ?? null,
      className:   s.className ?? null,
      severeAllergy:      !!s.medical?.severeAllergy,
      hasAsthma:          !!s.medical?.hasAsthma,
      hasEpilepsy:        !!s.medical?.hasEpilepsy,
      otherCriticalAlert: s.medical?.otherCriticalAlert || null,
    }));

    return ok(res, alerts);
  } catch (err) { console.error('[medical/alerts GET]', err); return E.serverError(res); }
});

module.exports = router;
