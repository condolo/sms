'use strict';

/* ═══════════════════════════════════════════════════════════════
   EXTRA-CURRICULAR — the activity catalogue and who is enrolled.

   activities          — name and amount per term (school-wide catalogue)
   activity_enrolments — a student enrolled in an activity for a date range

   Billing does not live here. finance.js's term billing reads active
   enrolments in active activities and writes them onto the student's term
   invoice (utils/term-billing.js). Students are chosen from the school's
   records (studentId), never typed, so billing always targets a real student.

   Gated by the finance module (billing is a finance function): reads need
   finance:read, changes need finance:create / finance:update.
   ═══════════════════════════════════════════════════════════════ */

const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { explicitSub }    = require('../middleware/explicit-sub');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const AuditService       = require('../services/audit');

const router = express.Router();
const PLAN   = planGate('extracurricular');
router.use(authMiddleware, PLAN, moduleGate('finance'));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ActivitySchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  amount:      z.coerce.number().min(0),
  description: z.string().max(300).trim().optional().default(''),
  status:      z.enum(['active', 'inactive']).optional().default('active'),
});

const EnrolmentSchema = z.object({
  studentId:  z.string().min(1),
  activityId: z.string().min(1),
  startDate:  z.string().regex(ISO_DATE),
  endDate:    z.string().regex(ISO_DATE).optional().nullable(),
});

const EnrolmentEndSchema = z.object({
  endDate: z.string().regex(ISO_DATE),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── Activities (catalogue) ───────────────────────────────────── */

router.get('/activities', rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const docs = await tenantModel('activities', tenantContext(req))
      .find({ schoolId }).sort({ name: 1 }).select('-__v').lean();
    return ok(res, docs);
  } catch (err) { console.error('[extracurricular/activities GET]', err); return E.serverError(res); }
});

router.post('/activities', explicitSub('finance', 'activities', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ActivitySchema, req.body);
    if (error) return E.validation(res, error);

    const Activities = tenantModel('activities', tenantContext(req));
    const dup = await Activities.findOne({ schoolId, name: data.name }).lean();
    if (dup) return E.conflict(res, `An activity named "${data.name}" already exists`);

    const doc = await Activities.create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    AuditService.log({ action: 'extracurricular.activity_created', actor: req.jwtUser, schoolId, target: { type: 'activity', id: doc.id, label: data.name }, details: { amount: data.amount, status: data.status }, req });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[extracurricular/activities POST]', err); return E.serverError(res); }
});

router.put('/activities/:id', explicitSub('finance', 'activities', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ActivitySchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const existing = await tenantModel('activities', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Activity not found');

    const doc = await tenantModel('activities', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true },
    ).lean();
    // An amount change applies from the next term billing run. Terms already
    // billed keep the amount they were invoiced at (invoice lines are copied).
    AuditService.log({ action: 'extracurricular.activity_updated', actor: req.jwtUser, schoolId, target: { type: 'activity', id: req.params.id, label: doc.name }, details: { changed: Object.keys(data) }, req });
    return ok(res, doc);
  } catch (err) { console.error('[extracurricular/activities PUT]', err); return E.serverError(res); }
});

/* ── Enrolments (which student is in which activity) ──────────── */

router.get('/enrolments', rbac('finance', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (typeof req.query.studentId === 'string' && req.query.studentId) filter.studentId = req.query.studentId;
    if (typeof req.query.activityId === 'string' && req.query.activityId) filter.activityId = req.query.activityId;
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    const docs = await tenantModel('activity_enrolments', tenantContext(req))
      .find(filter).sort({ studentName: 1 }).select('-__v').lean();
    return ok(res, docs);
  } catch (err) { console.error('[extracurricular/enrolments GET]', err); return E.serverError(res); }
});

router.post('/enrolments', explicitSub('finance', 'activities', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(EnrolmentSchema, req.body);
    if (error) return E.validation(res, error);
    if (data.endDate && data.endDate < data.startDate) {
      return E.validation(res, [{ field: 'endDate', message: 'End date cannot be before the start date' }]);
    }

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ id: data.studentId, schoolId }).select('firstName middleName lastName admissionNumber status').lean();
    if (!student) return E.notFound(res, 'Student not found in this school');
    if (student.status !== 'active') return E.badRequest(res, 'Only active students can be enrolled in an activity');

    const activity = await tenantModel('activities', tenantContext(req)).findOne({ id: data.activityId, schoolId }).lean();
    if (!activity) return E.notFound(res, 'Activity not found');
    if (activity.status !== 'active') return E.badRequest(res, `"${activity.name}" is not active`);

    // One open enrolment per student per activity. A second one would bill twice.
    const open = await tenantModel('activity_enrolments', tenantContext(req))
      .findOne({ schoolId, studentId: data.studentId, activityId: data.activityId, status: 'active' }).lean();
    if (open) return E.conflict(res, `This student is already enrolled in "${activity.name}"`);

    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
    const doc = await tenantModel('activity_enrolments', tenantContext(req)).create({
      id:            uuidv4(),
      schoolId,
      studentId:     data.studentId,
      studentName,
      admissionNumber: student.admissionNumber ?? null,
      activityId:    data.activityId,
      activityName:  activity.name,
      startDate:     data.startDate,
      endDate:       data.endDate ?? null,
      status:        'active',
      createdBy:     userId,
      updatedBy:     userId,
    });
    AuditService.log({ action: 'extracurricular.enrolled', actor: req.jwtUser, schoolId, target: { type: 'student', id: data.studentId, label: studentName }, details: { activityId: data.activityId, activityName: activity.name, startDate: data.startDate }, req });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[extracurricular/enrolments POST]', err); return E.serverError(res); }
});

/* POST /enrolments/bulk — one activity, the same dates, several students (usually
   one class). Each student gets their own enrolment record. Everything is checked
   before anything is written: the activity is active, every student is an active
   student of this school, and anyone already enrolled in this activity is skipped
   and reported, never duplicated. */
const BulkEnrolmentSchema = z.object({
  activityId: z.string().min(1),
  startDate:  z.string().regex(ISO_DATE),
  endDate:    z.string().regex(ISO_DATE).optional().nullable(),
  students:   z.array(z.object({ studentId: z.string().min(1) })).min(1).max(300),
});

router.post('/enrolments/bulk', explicitSub('finance', 'activities', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(BulkEnrolmentSchema, req.body);
    if (error) return E.validation(res, error);
    if (data.endDate && data.endDate < data.startDate) {
      return E.validation(res, [{ field: 'endDate', message: 'End date cannot be before the start date' }]);
    }
    const ctx = tenantContext(req);

    const activity = await tenantModel('activities', ctx).findOne({ id: data.activityId, schoolId }).lean();
    if (!activity) return E.notFound(res, 'Activity not found');
    if (activity.status !== 'active') return E.badRequest(res, `"${activity.name}" is not active`);

    const ids = [...new Set(data.students.map(s => s.studentId))];
    const found = await tenantModel('students', ctx)
      .find({ schoolId, id: { $in: ids }, status: 'active' })
      .select('id firstName middleName lastName admissionNumber').lean();
    const studentById = new Map(found.map(s => [s.id, s]));
    const missing = ids.filter(id => !studentById.has(id));
    if (missing.length) {
      return E.validation(res, [{ field: 'students', message: `Not active students in this school: ${missing.join(', ')}` }]);
    }

    const open = await tenantModel('activity_enrolments', ctx)
      .find({ schoolId, activityId: data.activityId, status: 'active', studentId: { $in: ids } })
      .select('studentId').lean();
    const alreadyIn = new Set(open.map(e => e.studentId));

    const skipped = [];
    const docs = [];
    for (const id of ids) {
      if (alreadyIn.has(id)) { skipped.push({ studentId: id, reason: `already enrolled in "${activity.name}"` }); continue; }
      const s = studentById.get(id);
      docs.push({
        id:              uuidv4(),
        schoolId,
        studentId:       id,
        studentName:     [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' '),
        admissionNumber: s.admissionNumber ?? null,
        activityId:      data.activityId,
        activityName:    activity.name,
        startDate:       data.startDate,
        endDate:         data.endDate ?? null,
        status:          'active',
        createdBy:       userId,
        updatedBy:       userId,
      });
    }
    if (docs.length) await tenantModel('activity_enrolments', ctx).insertMany(docs);

    AuditService.log({ action: 'extracurricular.enrolled_bulk', actor: req.jwtUser, schoolId, target: { type: 'activity', id: data.activityId, label: activity.name }, details: { created: docs.length, skipped: skipped.length, startDate: data.startDate }, req });
    return ok(res, { created: docs.length, skipped });
  } catch (err) { console.error('[extracurricular/enrolments/bulk POST]', err); return E.serverError(res); }
});

/* Ending an enrolment keeps the record (history for past terms). It is not deleted. */
router.put('/enrolments/:id/end', explicitSub('finance', 'activities', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(EnrolmentEndSchema, req.body);
    if (error) return E.validation(res, error);

    const existing = await tenantModel('activity_enrolments', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Enrolment not found');
    if (data.endDate < existing.startDate) return E.validation(res, [{ field: 'endDate', message: 'End date cannot be before the start date' }]);

    const doc = await tenantModel('activity_enrolments', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { endDate: data.endDate, status: 'ended', updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true },
    ).lean();
    AuditService.log({ action: 'extracurricular.ended', actor: req.jwtUser, schoolId, target: { type: 'student', id: existing.studentId, label: existing.studentName }, details: { activityName: existing.activityName, endDate: data.endDate }, req });
    return ok(res, doc);
  } catch (err) { console.error('[extracurricular/enrolments end PUT]', err); return E.serverError(res); }
});

module.exports = router;
