/* ============================================================
   InnoLearn — /api/admissions  (Admissions Pipeline)
   Manages applications from enquiry through to enrolment.
   Plan: premium | RBAC: admissions:{read,create,update,delete}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('admissions');

/* ── Pipeline stage ordering ────────────────────────────────── */
const STAGE_ORDER = ['enquiry', 'application', 'assessment', 'interview', 'offer', 'acceptance', 'enrolled', 'withdrawn', 'rejected'];

/* ── Validation ─────────────────────────────────────────────── */
const ApplicationSchema = z.object({
  // Applicant details
  firstName:      z.string().min(1).max(100).trim(),
  lastName:       z.string().min(1).max(100).trim(),
  middleName:     z.string().max(100).trim().optional(),
  dateOfBirth:    z.string().optional(),
  gender:         z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),

  // Admission details
  applyingForYear:   z.string().optional(),     // "Year 7", "Grade 3"
  applyingForClass:  z.string().optional(),     // classId
  keyStageId:        z.string().optional(),
  academicYearId:    z.string().optional(),
  intakeTerm:        z.string().optional(),

  // Parent / guardian
  parentName:        z.string().max(200).trim().optional(),
  parentEmail:       z.string().email().optional().or(z.literal('')),
  parentPhone:       z.string().max(30).optional(),
  parentAddress:     z.string().max(500).optional(),
  parentRelationship: z.string().max(50).optional(),

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
  specialNeeds:   z.boolean().default(false),
  specialNeedsDetails: z.string().max(1000).optional(),
  documents:      z.array(z.object({ name: z.string(), url: z.string().optional() })).optional(),
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

/* ── GET /api/admissions ─ Paginated pipeline ───────────────── */
router.get('/', authMiddleware, PLAN, rbac('admissions', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    if (req.query.stage)        filter.stage        = req.query.stage;
    if (req.query.priority)     filter.priority     = req.query.priority;
    if (req.query.keyStageId)   filter.keyStageId   = req.query.keyStageId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.assignedTo)   filter.assignedTo   = req.query.assignedTo;
    if (req.query.sibling === 'true') filter.sibling = true;

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx },
        { parentName: rx }, { parentEmail: rx },
        { applicationRef: rx }
      ];
    }

    const Apps = _model('admissions');
    const [docs, total] = await Promise.all([
      Apps.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Apps.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[admissions GET]', err); return E.serverError(res); }
});

/* ── GET /api/admissions/stats ─ Pipeline overview ─────────── */
router.get('/stats', authMiddleware, PLAN, rbac('admissions', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;

    const Apps = _model('admissions');
    const pipeline = await Apps.aggregate([
      { $match: filter },
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
router.get('/:id', authMiddleware, PLAN, rbac('admissions', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('admissions').findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Application not found');
    return ok(res, doc);
  } catch (err) { console.error('[admissions GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/admissions ─ Create application ──────────────── */
router.post('/', authMiddleware, PLAN, rbac('admissions', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ApplicationSchema, req.body);
    if (error) return E.validation(res, error);

    // Generate a unique application reference: ADM-APP-{year}-{random 6}
    const year = new Date().getFullYear();
    const ref  = `APP-${year}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const doc = await _model('admissions').create({
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
router.put('/:id', authMiddleware, PLAN, rbac('admissions', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ApplicationSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id; delete data.applicationRef;

    const Apps    = _model('admissions');
    const existing = await Apps.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Application not found');

    const update = { ...data, updatedBy: userId };

    // If stage changed, append to history
    if (data.stage && data.stage !== existing.stage) {
      update.$push = {
        stageHistory: { stage: data.stage, date: new Date().toISOString(), changedBy: userId, notes: data.notes || '' }
      };
    }

    const doc = await Apps.findOneAndUpdate(
      { id: req.params.id, schoolId },
      update,
      { new: true, runValidators: false }
    ).lean();
    return ok(res, doc);
  } catch (err) { console.error('[admissions PUT/:id]', err); return E.serverError(res); }
});

/* ── PATCH /api/admissions/:id/stage ─ Quick stage change ───── */
router.patch('/:id/stage', authMiddleware, PLAN, rbac('admissions', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(StageChangeSchema, req.body);
    if (error) return E.validation(res, error);

    const Apps = _model('admissions');
    const doc  = await Apps.findOneAndUpdate(
      { id: req.params.id, schoolId },
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

/* ── DELETE /api/admissions/:id ─ Withdraw application ───────── */
router.delete('/:id', authMiddleware, PLAN, rbac('admissions', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await _model('admissions').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { stage: 'withdrawn', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Application not found');
    return ok(res, { id: req.params.id, withdrawn: true });
  } catch (err) { console.error('[admissions DELETE/:id]', err); return E.serverError(res); }
});

module.exports = router;
