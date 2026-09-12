/* ============================================================
   Msingi — /api/admissions  (Admissions Pipeline)
   Manages applications from enquiry through to enrolment.
   Plan: premium | RBAC: admissions:{read,create,update,delete}
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const { resolvePrimaryContact, validateGuardianRequirement } = require('../utils/guardian-contact');
const { resolveRequiredFields, validateRequiredAdmissionFields } = require('../utils/admission-requirements');
const { reserveFreeAdmissionNumbers } = require('../utils/counters');
const { resolveAcademicPeriod }   = require('../utils/academic-period');
const { generateEnrollmentInvoices } = require('../utils/admission-billing');
const { linkExistingGuardians } = require('../utils/guardian-linking');
const AuditService = require('../services/audit');

const router = express.Router();
const PLAN   = planGate('admissions');
const MODGATE = moduleGate('admissions');

/* ── Pipeline stage ordering ────────────────────────────────── */
const STAGE_ORDER = ['enquiry', 'application', 'assessment', 'interview', 'offer', 'acceptance', 'enrolled', 'withdrawn', 'rejected'];

/* ── Validation ─────────────────────────────────────────────── */
const ApplicationSchema = z.object({
  // Applicant details
  firstName:      z.string().min(1).max(100).trim(),
  lastName:       z.string().min(1).max(100).trim(),
  middleName:     z.string().max(100).trim().optional(),
  // Required BY DEFAULT (2026-09 field update), but a per-school Settings
  // toggle (school.admissionConfig.requiredFields — see server/utils/
  // admission-requirements.js) — enforced manually in POST below, not by
  // Zod, since that check needs the school's own config, not a static
  // rule. Optional here so a school that has turned either off can still
  // save without it.
  dateOfBirth:    z.string().optional(),
  gender:         z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  allergies:      z.string().max(1000).optional(),

  // House — same denormalized id+name pattern as applyingForClass/Stream
  // below, so the display name survives without a lookup and stays
  // consistent if the house is later renamed in Settings.
  houseId:        z.string().nullish(),
  houseName:      z.string().nullish(),

  // Admission details
  applyingForYear:       z.string().optional(),          // academic year name, e.g. "2026-2027"
  applyingForClass:      z.string().nullish(),            // classId
  applyingForClassName:  z.string().nullish(),            // denormalized class name, for display without a lookup
  applyingForStream:     z.string().nullish(),            // streamId
  applyingForStreamName: z.string().nullish(),            // denormalized stream name, for display without a lookup
  keyStageId:        z.string().optional(),
  academicYearId:    z.string().optional(),
  intakeTerm:        z.string().optional(),

  // Parent / guardian — kept exactly as-is. parentName/Email/Phone are the
  // single "primary contact" this system has always used everywhere else
  // (parent portal login — students.js's POST /:id/parent-account uses
  // student.parentEmail as the login email — and birthday emails,
  // birthdays.js). NOT hand-typed on this form anymore; derived below
  // from whichever of Mother/Father is marked primaryContact, so those
  // two existing consumers keep working unchanged. Still independently
  // settable via a direct API call/import, for anything that doesn't go
  // through the Mother/Father split.
  parentName:        z.string().max(200).trim().optional(),
  parentEmail:       z.string().email().optional().or(z.literal('')),
  parentPhone:       z.string().max(30).optional(),
  parentAddress:     z.string().max(500).optional(),
  parentRelationship: z.string().max(50).optional(),

  // Mother / Father — 2026-09 field update. One of these two must be
  // provided (enforced below, not by zod, since it's an either/or rule
  // across two optional field groups). primaryContact selects which one
  // feeds the legacy parentName/Email/Phone fields above.
  motherName:        z.string().max(200).trim().optional(),
  motherEmail:       z.string().email().optional().or(z.literal('')),
  motherPhone:       z.string().max(30).optional(),
  motherIdNumber:    z.string().max(50).trim().optional(),
  fatherName:        z.string().max(200).trim().optional(),
  fatherEmail:       z.string().email().optional().or(z.literal('')),
  fatherPhone:       z.string().max(30).optional(),
  fatherIdNumber:    z.string().max(50).trim().optional(),
  primaryContact:    z.enum(['mother', 'father']).optional(), // which parent's info populates parentName/Email/Phone

  // Emergency contact — 2026-09 field update. Independent of Mother/
  // Father (may be a relative, neighbour, etc. — the same "not
  // necessarily a parent" convention students.js's MedicalInfoSchema
  // already uses for this exact concept).
  emergencyContactName:     z.string().max(200).trim().optional(),
  emergencyContactPhone:    z.string().max(30).optional(),
  emergencyContactRelation: z.string().max(100).optional(),

  // Previous school
  previousSchool:    z.string().max(200).optional(),
  previousYear:      z.string().max(50).optional(),

  // Application
  stage:          z.enum(['enquiry', 'application', 'assessment', 'interview', 'offer', 'acceptance', 'enrolled', 'withdrawn', 'rejected']).default('enquiry'),
  priority:       z.enum(['low', 'normal', 'high']).default('normal'),
  notes:          z.string().max(3000).optional(),
  assignedTo:     z.string().optional(),   // userId of admissions officer
  enquiryDate:    z.string().optional(),
  applicationDate: z.string().optional(),
  offerDate:      z.string().optional(),
  enrolmentDate:  z.string().optional(),

  // Flags
  sibling:        z.boolean().default(false),
  siblingStudentId: z.string().optional(),
  // 2026-09 — Director's/Referral fee-discount eligibility, set here
  // (rather than only after enrollment, on the Student record) so it's
  // known BEFORE the admission invoice is generated at enroll time —
  // see the billing-sequence fix in POST /:id/enroll below. Carried
  // verbatim onto the new Student record, mirroring every other
  // application field.
  isDirectorFamily: z.boolean().optional(),
  isReferralFamily: z.boolean().optional(),
  specialNeeds:   z.boolean().default(false),
  specialNeedsDetails: z.string().max(1000).optional(),
  documents:      z.array(z.object({ name: z.string(), url: z.string().optional() })).optional(),

  // System-managed — set only by POST /:id/enroll below, never accepted
  // as client input (stripped in PUT/POST just like id/schoolId/
  // applicationRef). Links this application to the real Student record
  // it produced, once enrolled.
  studentId:      z.string().nullish(),
});

const StageChangeSchema = z.object({
  stage:    z.enum(['enquiry', 'application', 'assessment', 'interview', 'offer', 'acceptance', 'enrolled', 'withdrawn', 'rejected']),
  notes:    z.string().max(1000).optional(),
  date:     z.string().optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* Resolve an application by its UUID `id`, falling back to the Mongo
   `_id` string for pre-migration records that never got one (2026-09 —
   confirmed live: a legacy application with no `id` field returned 404
   from every :id route, including POST /:id/enroll, even though the
   client already correctly falls back to `a.id ?? a._id` when linking
   to it — same dual-identifier pattern already used for
   students/classes/streams/users elsewhere in this codebase; see
   DEVELOPER_GUIDE.md's "Dual-Identifier Pattern" section). Every :id
   route below resolves through this once, then writes by `_id` (always
   present), never by the possibly-absent `id`. */
async function _findApplication(Apps, id, schoolId) {
  let doc = await Apps.findOne({ id, schoolId }).lean();
  if (!doc) {
    try { doc = await Apps.findOne({ _id: id, schoolId }).lean(); } catch (_) { /* not a valid ObjectId */ }
  }
  return doc;
}

/* ── GET /api/admissions ─ Paginated pipeline ───────────────── */
router.get('/', authMiddleware, PLAN, MODGATE, rbac('admissions', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _stage = strParam(req.query.stage);
    const _pri   = strParam(req.query.priority);
    const _ks    = strParam(req.query.keyStageId);
    const _ay    = strParam(req.query.academicYearId);
    const _at    = strParam(req.query.assignedTo);
    if (_stage) filter.stage          = _stage;
    if (_pri)   filter.priority       = _pri;
    if (_ks)    filter.keyStageId     = _ks;
    if (_ay)    filter.academicYearId = _ay;
    if (_at)    filter.assignedTo     = _at;
    if (req.query.sibling === 'true') filter.sibling = true;

    // A fully-enrolled application (stage 'enrolled' AND a linked
    // studentId) is now a real Student record — the Admissions board is
    // for applications still moving through the pipeline, not a second,
    // duplicate view of students who already exist there (requested
    // directly, 2026-09: "once moved to enroll, student should be
    // active not listed here under admission"). Hidden by default here,
    // never deleted — pass ?includeCompleted=true to see them (e.g. a
    // full historical export). An application AT 'enrolled' that's
    // still missing its studentId link (the exact bug this same session
    // found and fixed) is deliberately NOT hidden by this — it still
    // needs the Enroll Student action re-run, and hiding it would make
    // that broken state invisible again.
    if (req.query.includeCompleted !== 'true') {
      filter.$nor = [{ stage: 'enrolled', studentId: { $exists: true } }];
    }

    // Each word matched independently, ALL required (2026-09 fix — see
    // the identical bug/fix in students.js GET /): firstName and
    // lastName are separate fields, so a single regex built from "John
    // Doe" could never match either one alone — a full-name search
    // silently returned zero applications no matter how exactly the
    // name was typed.
    if (req.query.search?.trim()) {
      const terms = req.query.search.trim().split(/\s+/)
        .map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      filter.$and = terms.map(rx => ({
        $or: [
          { firstName: rx }, { lastName: rx },
          { parentName: rx }, { parentEmail: rx },
          { applicationRef: rx },
        ],
      }));
    }

    const Apps = tenantModel('admissions', tenantContext(req));
    const [docs, total] = await Promise.all([
      Apps.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Apps.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[admissions GET]', err); return E.serverError(res); }
});

/* ── GET /api/admissions/stats ─ Pipeline overview ─────────── */
router.get('/stats', authMiddleware, PLAN, MODGATE, rbac('admissions', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    const _ay2 = strParam(req.query.academicYearId);
    if (_ay2) filter.academicYearId = _ay2;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.enquiryDate = {};
      if (req.query.dateFrom) filter.enquiryDate.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.enquiryDate.$lte = req.query.dateTo;
    }

    // Same exclusion as GET / above, and for the same reason: the
    // Enrolled count on the board should reflect applications still
    // needing attention here, not every enrollment this school has ever
    // completed — those are real students now, counted in Students'
    // own totals instead.
    const excludeCompleted = req.query.includeCompleted !== 'true';

    const Apps = tenantModel('admissions', tenantContext(req));
    const pipeline = await Apps.aggregate([
      { $match: filter },
      ...(excludeCompleted ? [{ $match: { $nor: [{ stage: 'enrolled', studentId: { $exists: true } }] } }] : []),
      { $group: {
        _id:   '$stage',
        count: { $sum: 1 },
        high:  { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } }
      }},
      { $sort: { _id: 1 } }
    ]);

    // Build ordered summary
    const byStage = {};
    pipeline.forEach(s => { byStage[s._id] = { count: s.count, highPriority: s.high }; });
    const summary = STAGE_ORDER.map(stage => ({ stage, ...(byStage[stage] || { count: 0, highPriority: 0 }) }));
    const total   = pipeline.reduce((s, p) => s + p.count, 0);

    return ok(res, { total, byStage: summary });
  } catch (err) { console.error('[admissions/stats GET]', err); return E.serverError(res); }
});

/* ── GET /api/admissions/:id ──────────────────────────────────── */
router.get('/:id', authMiddleware, PLAN, MODGATE, rbac('admissions', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _findApplication(tenantModel('admissions', tenantContext(req)), req.params.id, schoolId);
    if (!doc) return E.notFound(res, 'Application not found');
    delete doc.__v;
    return ok(res, doc);
  } catch (err) { console.error('[admissions GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/admissions ─ Create application ──────────────── */
router.post('/', authMiddleware, PLAN, MODGATE, rbac('admissions', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ApplicationSchema, req.body);
    if (error) return E.validation(res, error);
    delete data.studentId; // system-managed — see POST /:id/enroll

    // Same rule as PATCH /:id/stage and PUT /:id below, and for the same
    // reason (2026-09 confirmed live bug, systemic across all three
    // write paths): a brand-new application can't be born "enrolled" —
    // that has no Student record, no admission number, nothing behind
    // it. Only POST /:id/enroll may ever set this stage.
    if (data.stage === 'enrolled') {
      return E.badRequest(res, 'A new application cannot be created directly at "Enrolled" — save it at an earlier stage, then use "Enroll Student" once it reaches Acceptance.');
    }

    // Fetched once, used for BOTH this school's required-field settings
    // and (below) the academic-year label for the application reference —
    // one query, not two.
    const schoolDoc      = await _model('schools').findOne({ id: schoolId }, { academicYear: 1, academicYearStartMonth: 1, admissionConfig: 1 }).lean();
    const requiredFields = resolveRequiredFields(schoolDoc?.admissionConfig);

    const fieldErrors = validateRequiredAdmissionFields(data, requiredFields);
    if (fieldErrors) return E.validation(res, fieldErrors);

    const guardianError = validateGuardianRequirement(data, requiredFields);
    if (guardianError) return E.validation(res, guardianError);
    Object.assign(data, resolvePrimaryContact(data));

    // Generate a unique application reference using school's configured academic year
    const yearLabel  = schoolDoc?.academicYear ?? String(new Date().getFullYear());
    // Extract leading 4-digit year from label ("2025/2026" → "2025", "2026" → "2026")
    const yearCode   = yearLabel.match(/\d{4}/)?.[0] ?? String(new Date().getFullYear());
    const ref        = `APP-${yearCode}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const doc = await tenantModel('admissions', tenantContext(req)).create({
      ...data,
      id:              uuidv4(),
      schoolId,
      applicationRef:  ref,
      enquiryDate:     data.enquiryDate || new Date().toISOString().slice(0, 10),
      stageHistory:    [{ stage: data.stage, date: new Date().toISOString(), changedBy: userId }],
      createdBy:       userId,
      updatedBy:       userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[admissions POST]', err); return E.serverError(res); }
});

/* ── PUT /api/admissions/:id ─ Update application ──────────── */
router.put('/:id', authMiddleware, PLAN, MODGATE, rbac('admissions', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ApplicationSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id; delete data.applicationRef; delete data.studentId;

    const Apps    = tenantModel('admissions', tenantContext(req));
    const existing = await _findApplication(Apps, req.params.id, schoolId);
    if (!existing) return E.notFound(res, 'Application not found');

    // Only re-validate/re-derive the guardian fields if THIS request
    // actually touches one of them — a partial update to something
    // unrelated (e.g. moving pipeline stage) must never re-run this
    // against a merged view and risk tripping the "at least one parent"
    // rule, or silently overwrite an already-correct parentName/Email/
    // Phone derived from a value that isn't even changing.
    const GUARDIAN_FIELDS = ['primaryContact', 'motherName', 'motherEmail', 'motherPhone', 'fatherName', 'fatherEmail', 'fatherPhone'];
    if (GUARDIAN_FIELDS.some(k => data[k] !== undefined)) {
      const merged = { ...existing, ...data };
      const schoolDoc      = await _model('schools').findOne({ id: schoolId }, { admissionConfig: 1 }).lean();
      const requiredFields = resolveRequiredFields(schoolDoc?.admissionConfig);
      const guardianError  = validateGuardianRequirement(merged, requiredFields);
      if (guardianError) return E.validation(res, guardianError);
      Object.assign(data, resolvePrimaryContact(merged));
    }

    // Same rule as PATCH /:id/stage below, and for the same reason
    // (2026-09 confirmed live bug): this generic update can also carry a
    // `stage` field, and setting it straight to 'enrolled' here has the
    // exact same effect — a stage flip with none of POST /:id/enroll's
    // actual work behind it.
    if (data.stage === 'enrolled' && existing.stage !== 'enrolled') {
      return E.badRequest(res, 'Use "Enroll Student" to move an applicant to Enrolled — it creates the actual student record, admission number, and invoice; a plain field update does not.');
    }

    const update = { ...data, updatedBy: userId };

    // If stage changed, append to history
    if (data.stage && data.stage !== existing.stage) {
      update.$push = {
        stageHistory: { stage: data.stage, date: new Date().toISOString(), changedBy: userId, notes: data.notes || '' }
      };
    }

    const doc = await Apps.findOneAndUpdate(
      { _id: existing._id, schoolId },
      update,
      { new: true, runValidators: false }
    ).lean();
    return ok(res, doc);
  } catch (err) { console.error('[admissions PUT/:id]', err); return E.serverError(res); }
});

/* ── PATCH /api/admissions/:id/stage ─ Quick stage change ───── */
router.patch('/:id/stage', authMiddleware, PLAN, MODGATE, rbac('admissions', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(StageChangeSchema, req.body);
    if (error) return E.validation(res, error);

    // Confirmed live-data bug (2026-09): this route set stage: 'enrolled'
    // directly, same as any other stage, with none of POST /:id/enroll's
    // actual work — no Student record, no admission number, no guardian
    // link, no invoice. Three real applicants ended up on the Enrolled
    // column with nothing behind them: unsearchable in Students, not
    // counted in its totals, no login, no way to bill them. "Enrolled"
    // is the one stage this quick-move endpoint must never set — moving
    // there always goes through the dedicated enroll endpoint, which
    // does the real work AND still updates stage. See "Enrolling an
    // applicant" in ADMISSIONS_GUIDE.md for why this was already meant
    // to require a deliberate, separate click.
    if (data.stage === 'enrolled') {
      return E.badRequest(res, 'Use "Enroll Student" to move an applicant to Enrolled — it creates the actual student record, admission number, and invoice; this quick stage-move does not.');
    }

    const Apps = tenantModel('admissions', tenantContext(req));
    const existing = await _findApplication(Apps, req.params.id, schoolId);
    if (!existing) return E.notFound(res, 'Application not found');

    const doc  = await Apps.findOneAndUpdate(
      { _id: existing._id, schoolId },
      {
        stage:      data.stage,
        updatedBy:  userId,
        $push: { stageHistory: { stage: data.stage, date: data.date || new Date().toISOString(), changedBy: userId, notes: data.notes || '' } }
      },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Application not found');
    return ok(res, doc);
  } catch (err) { console.error('[admissions PATCH/:id/stage]', err); return E.serverError(res); }
});

/* ── POST /api/admissions/:id/enroll ─ Convert applicant → Student ──
   2026-09 field update, Phase 3 — the previously-nonexistent
   application-to-enrollment flow. Before this route, staff manually
   retyped every field into a fresh Student record; nothing connected
   the two. This creates a REAL Student document from the application's
   own data, assigns the permanent admission number at this exact
   moment (per explicit confirmation: admission numbers are assigned
   only at enrollment, never on the application itself), and links the
   two records via studentId so the pipeline entry and the student stay
   traceably connected.

   An explicit action, not an automatic side effect of changing the
   stage dropdown — creating a permanent Student record with a real
   admission number is consequential enough to need its own deliberate
   click, separate from routine pipeline management.

   Requires BOTH admissions:update (this is still fundamentally an
   admissions-pipeline action) AND students:create (it also, literally,
   creates a student) — matching how every other cross-module action in
   this codebase is gated on the union of what it actually does, not
   just the module it's nominally filed under. */
router.post('/:id/enroll',
  authMiddleware, PLAN, MODGATE, moduleGate('students'),
  rbac('admissions', 'update'), rbac('students', 'create'),
  async (req, res) => {
    try {
      const { schoolId, userId } = req.jwtUser;
      const ctx = tenantContext(req);
      const Apps = tenantModel('admissions', ctx);

      const app = await _findApplication(Apps, req.params.id, schoolId);
      if (!app) return E.notFound(res, 'Application not found');

      // Idempotent — enrolling twice (a double-click, a retried request)
      // returns the SAME student it created the first time, never a
      // second, duplicate one.
      if (app.studentId) {
        const existing = await tenantModel('students', ctx).findOne({ id: app.studentId, schoolId }).lean();
        if (existing) {
          // Retrying an already-enrolled application is exactly the case
          // generateEnrollmentInvoices() is idempotent against — never a
          // duplicate invoice, but it DOES retry billing if the first
          // attempt failed non-fatally (see try/catch below) or a
          // qualifying fee structure was added after this student enrolled.
          // Billing sequence fix (2026-09): (re-)establish guardian
          // relationships BEFORE retrying billing, same ordering as the
          // fresh-enroll path below — a retry is exactly the case where
          // the guardian link may not have existed on the first attempt.
          try { await linkExistingGuardians(schoolId, ctx, existing); }
          catch (linkErr) { console.error('[admissions POST/:id/enroll — guardian link retry]', linkErr); }
          let invoicesDrafted = [];
          try { invoicesDrafted = await generateEnrollmentInvoices(schoolId, ctx, existing, userId, req); }
          catch (billingErr) { console.error('[admissions POST/:id/enroll — billing retry]', billingErr); }
          return ok(res, { student: existing, application: app, alreadyEnrolled: true, invoicesDrafted });
        }
        // studentId is set but the student record itself is gone (e.g.
        // manually deleted) — fall through and enroll again rather than
        // permanently 404 on this application.
      }

      const ENROLLABLE_STAGES = new Set(['acceptance', 'enrolled']);
      if (!ENROLLABLE_STAGES.has(app.stage)) {
        return E.badRequest(res, `Cannot enroll an application at stage "${app.stage}" — the offer must be accepted first.`);
      }

      // Fetched once, used for BOTH the required-field check below and
      // (further down) admission-number reservation — one query.
      const schoolDoc      = await _model('schools').findOne({ id: schoolId }, { admissionConfig: 1 }).lean();
      const requiredFields = resolveRequiredFields(schoolDoc?.admissionConfig);

      // Gender/DOB are required on NEW applications by default (2026-09
      // field update), but that's now a per-school Settings toggle — and
      // regardless of the school's current setting, this platform's
      // collections are schema-less (server/utils/model.js — strict:
      // false, nothing enforced at the DB layer), so an application
      // created under a stricter or looser configuration than the
      // school's CURRENT one can still be sitting here in any shape.
      // Without this guard, enroll would silently write an incomplete
      // Student record. Checked BEFORE reserving an admission number so
      // a rejected attempt never burns one.
      const missingRequired = [];
      if (requiredFields.dateOfBirth && !app.dateOfBirth) missingRequired.push('dateOfBirth');
      if (requiredFields.gender && !app.gender) missingRequired.push('gender');
      if (missingRequired.length) {
        return E.badRequest(res, `This application is missing required field(s): ${missingRequired.join(', ')}. Update the application (PUT) before enrolling.`);
      }

      // Checked against real existing students, not just handed out
      // blind — the counter alone can drift out of sync with a manually
      // supplied admission number (an existing student imported with
      // their real-world number) and later hand out one that's already
      // taken. See reserveFreeAdmissionNumbers' own comment for the full
      // story.
      const Students = tenantModel('students', ctx);
      const [admissionNumber] = await reserveFreeAdmissionNumbers(schoolId, 1, schoolDoc?.admissionConfig || {},
        n => Students.exists({ schoolId, admissionNumber: n }));

      // Use the application's own applyingForYear/academicYearId if it
      // recorded one; otherwise resolve the live current period — the
      // same default every other student-creation path in this codebase
      // uses (the regular Add Student form client-side, bulk import
      // server-side).
      const period = app.academicYearId
        ? { academicYearId: app.academicYearId, termId: null }
        : await resolveAcademicPeriod(schoolId, ctx, {});

      const now = new Date().toISOString();
      const studentDoc = {
        id:              uuidv4(),
        schoolId,
        admissionNumber,
        firstName:       app.firstName,
        lastName:        app.lastName,
        middleName:      app.middleName || undefined,
        dateOfBirth:     app.dateOfBirth,
        gender:          app.gender,
        classId:         app.applyingForClass      || undefined,
        className:       app.applyingForClassName  || undefined,
        streamId:        app.applyingForStream      || undefined,
        streamName:       app.applyingForStreamName || undefined,
        houseId:          app.houseId || undefined,
        enrollmentAcademicYearId: period.academicYearId || undefined,
        enrollmentTermId:         period.termId || undefined,
        // Mother/Father + derived primary-contact fields carry across
        // verbatim — the application already went through the same
        // guardian derivation (server/utils/guardian-contact.js) at
        // POST/PUT time, nothing to recompute here.
        parentName:      app.parentName || undefined,
        parentEmail:     app.parentEmail || undefined,
        parentPhone:     app.parentPhone || undefined,
        parentRelationship: app.parentRelationship || undefined,
        motherName:      app.motherName || undefined,
        motherEmail:     app.motherEmail || undefined,
        motherPhone:     app.motherPhone || undefined,
        motherIdNumber:  app.motherIdNumber || undefined,
        fatherName:      app.fatherName || undefined,
        fatherEmail:     app.fatherEmail || undefined,
        fatherPhone:     app.fatherPhone || undefined,
        fatherIdNumber:  app.fatherIdNumber || undefined,
        primaryContact:  app.primaryContact || undefined,
        address:         app.parentAddress || undefined,
        enrollmentDate:  now.slice(0, 10),
        status:          'active',
        // Billing sequence fix (2026-09) — carried across so
        // linkExistingGuardians() and generateEnrollmentInvoices() (both
        // called right after this record is created, below) see them
        // immediately: siblingStudentId is the strongest guardian-match
        // signal when staff recorded it; isDirectorFamily/isReferralFamily
        // establish flat-discount eligibility before the invoice is
        // calculated, instead of only being settable after the fact on
        // the Student record.
        siblingStudentId:  app.siblingStudentId || undefined,
        isDirectorFamily:  app.isDirectorFamily || undefined,
        isReferralFamily:  app.isReferralFamily || undefined,
        // Allergies/Emergency Contact — same medical.* nesting Phase 2
        // established for bulk import, matching the Student Profile's
        // own Medical tab shape exactly.
        ...((app.allergies || app.emergencyContactName || app.emergencyContactPhone || app.emergencyContactRelation) ? {
          medical: {
            ...(app.allergies ? { allergies: app.allergies } : {}),
            ...(app.emergencyContactName     ? { emergencyName:     app.emergencyContactName }     : {}),
            ...(app.emergencyContactPhone    ? { emergencyPhone:    app.emergencyContactPhone }    : {}),
            ...(app.emergencyContactRelation ? { emergencyRelation: app.emergencyContactRelation } : {}),
          },
        } : {}),
        createdBy: userId,
        updatedBy: userId,
      };

      const student = await Students.create(studentDoc);

      // Billing sequence fix (2026-09): establish family/discount data
      // BEFORE generating the admission invoice, not after — the whole
      // point being that generateEnrollmentInvoices() below can only
      // compute a correct sibling discount if the guardian relationship
      // already exists at the moment it runs. Both are best-effort and
      // never allowed to fail the enrollment itself, same treatment as
      // every other post-enroll side effect in this codebase (guardian
      // notification, etc.) — a family that can't be linked automatically
      // just gets an invoice at 0% discount, exactly what happened before
      // this fix, not a failed enrollment.
      try { await linkExistingGuardians(schoolId, ctx, student); }
      catch (linkErr) { console.error('[admissions POST/:id/enroll — guardian link]', linkErr); }

      // Surfaced in the response (invoicesDrafted) so the Admissions
      // Officer actually sees it happened, rather than it silently
      // sitting in Finance with no visible link back to this enrollment.
      let invoicesDrafted = [];
      try { invoicesDrafted = await generateEnrollmentInvoices(schoolId, ctx, student, userId, req); }
      catch (billingErr) { console.error('[admissions POST/:id/enroll — billing]', billingErr); }

      const stageUnchanged = app.stage === 'enrolled';
      const appUpdate = {
        studentId:  student.id ?? student._id,
        updatedBy:  userId,
        ...(stageUnchanged ? {} : {
          stage:        'enrolled',
          enrolmentDate: app.enrolmentDate || now,
        }),
      };
      if (!stageUnchanged) {
        appUpdate.$push = { stageHistory: { stage: 'enrolled', date: now, changedBy: userId, notes: `Enrolled — admission number ${admissionNumber}` } };
      }
      const updatedApp = await Apps.findOneAndUpdate({ _id: app._id, schoolId }, appUpdate, { new: true, runValidators: false }).lean();

      AuditService.log({
        action: 'admissions.enrolled', actor: req.jwtUser, schoolId,
        target: { type: 'student', id: studentDoc.id, label: `${studentDoc.firstName} ${studentDoc.lastName}` },
        details: { applicationId: app.id, applicationRef: app.applicationRef, admissionNumber },
        req,
      });

      return created(res, { student: student.toObject ? student.toObject() : student, application: updatedApp, invoicesDrafted });
    } catch (err) { console.error('[admissions POST/:id/enroll]', err); return E.serverError(res); }
  }
);

/* ── DELETE /api/admissions/:id ─ Withdraw application ───────── */
router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('admissions', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Apps     = tenantModel('admissions', tenantContext(req));
    const existing = await _findApplication(Apps, req.params.id, schoolId);
    if (!existing) return E.notFound(res, 'Application not found');
    const doc = await Apps.findOneAndUpdate(
      { _id: existing._id, schoolId },
      { stage: 'withdrawn', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Application not found');
    return ok(res, { id: existing.id ?? String(existing._id), withdrawn: true });
  } catch (err) { console.error('[admissions DELETE/:id]', err); return E.serverError(res); }
});

module.exports = router;
