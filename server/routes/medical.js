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
const { _model } = require('../utils/model');
const { resolveTeacher } = require('../utils/resolveTeacher');
const { canMedical, needMedical, medicalSettings, DEFAULT_SETTINGS } = require('../utils/medical-access');

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
  // Never sent to a parent, a Weekly Snapshot or an alert (v5.285.0).
  clinicNotes:     z.string().max(2000).optional(),
});

const SettingsSchema = z.object(Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k => [k, z.boolean().optional()]))).strict();

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

/* The name behind a login, as the staff record writes it. */
async function _staffName(ctx, schoolId, userId, email) {
  if (!userId) return '';
  const staff = await resolveTeacher(userId, email, schoolId, 'title firstName lastName').catch(() => null);
  const name = [staff?.title, staff?.firstName, staff?.lastName].filter(Boolean).join(' ');
  if (name) return name;
  const user = await tenantModel('users', ctx).findOne({ id: userId, schoolId }).select('name').lean().catch(() => null);
  return user?.name || '';
}

/* Opening a visit's details is written to the Audit Log, once per person
   and visit in 10 minutes. */
const VIEW_AUDIT_MS = 10 * 60 * 1000;
const _viewed = new Map();
function _auditView(req, doc) {
  const { schoolId, userId } = req.jwtUser;
  const key = `${schoolId}|${userId}|${doc.id}`;
  const now = Date.now();
  if (now - (_viewed.get(key) || 0) < VIEW_AUDIT_MS) return;
  if (_viewed.size > 5000) _viewed.clear();
  _viewed.set(key, now);
  AuditService.log({
    action: 'medical.visit_viewed', actor: req.jwtUser, schoolId,
    target: { type: 'student', id: doc.studentId, label: doc.studentName },
    details: { visitId: doc.id, visitDate: doc.date }, req,
  });
}

async function _settings(schoolId) {
  return medicalSettings(await _model('schools').findOne({ id: schoolId }, { medicalSettings: 1 }).lean());
}

/* GET /api/medical/access — what this person may do here, so the screen
   shows exactly what the routes allow. */
router.get('/access', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: returns the caller's own rights only
  try {
    const check = (sub, action) => canMedical(req, sub, action);
    const [visits, record, remove, alerts, reports, notesRead, notesWrite, settings] = await Promise.all([
      check('view', 'read'), check('record', 'create'), check('delete', 'delete'), check('alerts', 'read'), check('reports', 'read'),
      check('clinic_notes', 'read'), check('clinic_notes', 'create'), check('settings', 'update'),
    ]);
    return ok(res, { visits, record, remove, alerts, reports, clinicNotes: { read: notesRead, write: notesWrite }, settings });
  } catch (err) { console.error('[medical/access GET]', err); return E.serverError(res); }
});

/* GET/PUT /api/medical/settings — the school's own choices. */
router.get('/settings', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: canMedical below (visits or settings)
  try {
    const may = await canMedical(req, 'settings', 'update') || await canMedical(req, 'view', 'read') || await canMedical(req, 'record', 'create');
    if (!may) return E.forbidden(res);
    return ok(res, await _settings(req.jwtUser.schoolId));
  } catch (err) { console.error('[medical/settings GET]', err); return E.serverError(res); }
});

router.put('/settings', authMiddleware, PLAN, MODGATE, rbac('medical', 'update', 'settings'), needMedical('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SettingsSchema, req.body);
    if (error) return E.validation(res, error);
    const before = await _settings(schoolId);
    const next = { ...before, ...data };
    await _model('schools').updateOne({ id: schoolId }, { $set: { medicalSettings: { ...next, updatedBy: userId, updatedAt: new Date().toISOString() } } });
    AuditService.log({
      action: 'medical.settings_changed', actor: req.jwtUser, schoolId,
      target: { type: 'school', id: schoolId, label: 'Medical Centre settings' }, details: { before, after: next }, req,
    });
    return ok(res, next);
  } catch (err) { console.error('[medical/settings PUT]', err); return E.serverError(res); }
});

/* GET /api/medical/visits — the student's medical timeline (or the
   whole clinic's, filtered) */
router.get('/visits', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'view'), needMedical('view', 'read'), async (req, res) => {
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

    const search = strParam(req.query.search);
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ studentName: rx }, { complaint: rx }];
    }

    const Visits = tenantModel('medical_visits', tenantContext(req));
    const [docs, total] = await Promise.all([
      Visits.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v -clinicNotes').lean(),
      Visits.countDocuments(filter),
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[medical/visits GET]', err); return E.serverError(res); }
});

/* GET /api/medical/students?q= — the student picker for a new visit.
   Gated on medical read (not the students module) so a nurse account does
   not need the whole student register just to record a visit. */
router.get('/students', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'view'), needMedical('view', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const q = (req.query.q || '').toString().trim();
    const filter = { schoolId, status: { $ne: 'inactive' } };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { admissionNumber: rx },
        { name: rx },
      ];
    }
    const docs = await tenantModel('students', tenantContext(req))
      .find(filter)
      .select('id firstName lastName name admissionNumber classId className streamId')
      .sort({ lastName: 1, firstName: 1 })
      .limit(25)
      .lean();
    return ok(res, docs.map(s => ({
      id: s.id,
      name: s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || s.admissionNumber || 'Student',
      admissionNumber: s.admissionNumber || null,
      classId: s.classId || null,
      className: s.className || null,
    })));
  } catch (err) {
    console.error('[medical/students GET]', err);
    return E.serverError(res);
  }
});

/* GET /api/medical/visits/:id */
router.get('/visits/:id', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'view'), needMedical('view', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    const doc = await tenantModel('medical_visits', ctx)
      .findOne({ id: req.params.id, schoolId, deletedAt: { $exists: false } }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Visit not found');
    if (!(await canMedical(req, 'clinic_notes', 'read'))) delete doc.clinicNotes;
    const recordedByName = doc.recordedByName || await _staffName(ctx, schoolId, doc.recordedBy);
    _auditView(req, doc);
    return ok(res, { ...doc, recordedByName: recordedByName || null });
  } catch (err) { console.error('[medical/visits GET/:id]', err); return E.serverError(res); }
});

/* POST /api/medical/visits — log a new visit (never edited afterward) */
router.post('/visits', authMiddleware, PLAN, MODGATE, rbac('medical', 'create', 'record'), needMedical('record', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(VisitSchema, req.body);
    if (error) return E.validation(res, error);

    if (data.referred && !data.referredTo) {
      return E.badRequest(res, 'referredTo is required when referred is true');
    }

    const ctx = tenantContext(req);
    if (data.clinicNotes && !(await canMedical(req, 'clinic_notes', 'create'))) {
      return E.forbidden(res, 'Needs Edit on Medical Centre → Clinic-only Notes.');
    }
    if (!data.studentName) {
      data.studentName = await _resolveStudentName(ctx, schoolId, data.studentId);
    }

    const doc = await tenantModel('medical_visits', ctx).create({
      ...data,
      id:         uuidv4(),
      schoolId,
      date:       data.date || new Date().toISOString().slice(0, 10),
      recordedBy: userId,
      recordedByName: await _staffName(ctx, schoolId, userId, req.jwtUser.email),
      createdBy:  userId,
      updatedBy:  userId,
    });
    const plain = doc.toObject ? doc.toObject() : doc;

    AuditService.log({
      action: 'medical.visit_logged', actor: req.jwtUser, schoolId,
      target: { type: 'student', id: data.studentId, label: data.studentName },
      details: { visitId: plain.id, sentHome: data.sentHome, referred: data.referred }, req,
    });

    // An alert can show on a locked phone: the complaint is in it only if the school chose so.
    const { alertShowsComplaint } = await _settings(schoolId).catch(() => DEFAULT_SETTINGS);
    notifyGuardiansForStudents({
      ctx, schoolId, eventKey: 'medical_visit_logged',
      items: [{
        studentId: data.studentId,
        inAppSubject: `Clinic visit logged for ${data.studentName || 'your child'}`,
        inAppBody:    alertShowsComplaint ? data.complaint : 'Open Clinic Visits in Msingi to read the details.',
      }],
    }).catch(err => console.error('[medical/visits notify]', err));

    return created(res, plain);
  } catch (err) { console.error('[medical/visits POST]', err); return E.serverError(res); }
});

/* DELETE /api/medical/visits/:id — soft-delete only (correct a
   data-entry mistake by removing the wrong record and logging a new
   one; the original is retained, never destroyed). */
router.delete('/visits/:id', authMiddleware, PLAN, MODGATE, rbac('medical', 'delete', 'delete'), needMedical('delete', 'delete'), async (req, res) => {
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
router.get('/alerts', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'alerts'), needMedical('alerts', 'read'), scopeMiddleware, async (req, res) => {
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
    if (ScopeEngine.hasNoAssignments(req, 'students')) return ok(res, [], { noAssignments: true });

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

/* ══════════════════════════════════════════════════════════════
   REPORTS — simple operational counts, no advanced analytics per
   the module spec. Visits Today/This Month are always the real
   today/this-month regardless of dateFrom/dateTo; those two params
   only widen or narrow the window "Common Conditions" and "Frequent
   Visitors" are computed over (defaults to the current month).
   ══════════════════════════════════════════════════════════════ */
router.get('/reports', authMiddleware, PLAN, MODGATE, rbac('medical', 'read', 'reports'), needMedical('reports', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Visits = tenantModel('medical_visits', tenantContext(req));

    const today      = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    const periodFrom = strParam(req.query.dateFrom) || monthStart;
    const periodTo   = strParam(req.query.dateTo)   || today;

    const baseFilter = { schoolId, deletedAt: { $exists: false } };
    const periodMatch = { deletedAt: { $exists: false }, date: { $gte: periodFrom, $lte: periodTo } };

    const [visitsToday, visitsThisMonth, commonConditions, frequentVisitors] = await Promise.all([
      Visits.countDocuments({ ...baseFilter, date: today }),
      Visits.countDocuments({ ...baseFilter, date: { $gte: monthStart, $lte: today } }),
      Visits.aggregate([
        { $match: periodMatch },
        { $group: { _id: '$complaint', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, complaint: '$_id', count: 1 } },
      ]),
      Visits.aggregate([
        { $match: periodMatch },
        { $group: { _id: '$studentId', studentName: { $first: '$studentName' }, visitCount: { $sum: 1 } } },
        { $sort: { visitCount: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, studentId: '$_id', studentName: 1, visitCount: 1 } },
      ]),
    ]);

    return ok(res, { visitsToday, visitsThisMonth, commonConditions, frequentVisitors, periodFrom, periodTo });
  } catch (err) { console.error('[medical/reports GET]', err); return E.serverError(res); }
});

module.exports = router;
