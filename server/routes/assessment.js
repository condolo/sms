/* ============================================================
   Msingi — /api/assessment
   Structured CA / HW / MT / ET assessment system.

   Sub-routes:
     /config          — weights, template, instances (admin)
     /schedule        — date ranges per assessment (admin)
     /marks           — mark entry & retrieval (teachers)
     /report          — computed report card data
     /reminders       — upcoming/overdue assessment alerts
   ============================================================ */

'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { z }    = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');
const email              = require('../utils/email');
const {
  validateWeights,
  aggregateMarks,
  buildSubjectReport,
} = require('../utils/grade-calc');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Constants ──────────────────────────────────────────────── */

const ASSESSMENT_TYPES  = ['CA', 'HW', 'MT', 'ET'];
const TERM_NUMBERS      = [1, 2, 3];
const TEMPLATES         = ['detailed', 'summary'];

const DEFAULT_WEIGHTS   = { CA: 20, HW: 10, MT: 30, ET: 40 };
const DEFAULT_INSTANCES = { CA: 2, HW: 2 };   // MT and ET always have 1 instance

/* ── Helpers ─────────────────────────────────────────────────── */

function _ok(res, data, meta)    { return ok(res, data, meta); }
function _err(res, msg, code=400){ return res.status(code).json({ error: msg }); }

/** Fetch or create the assessment config doc for a school/year */
async function _getConfig(schoolId, academicYearId) {
  const Config = _model('assessment_config');
  let doc = await Config.findOne({ schoolId, academicYearId }).lean();
  if (!doc) {
    doc = {
      id:             uuidv4(),
      schoolId,
      academicYearId,
      weights:        { ...DEFAULT_WEIGHTS },
      instances:      { ...DEFAULT_INSTANCES },
      reportTemplate: 'detailed',
    };
    await Config.create(doc);
  }
  return doc;
}

/** Build label from type + instance, e.g. "CA 1", "MT", "ET" */
function _label(type, instance) {
  return ['MT', 'ET'].includes(type) ? type : `${type} ${instance}`;
}

/* ══════════════════════════════════════════════════════════════
   CONFIG  —  GET / PATCH /api/assessment/config
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/config
 * Returns the school's assessment configuration (weights, template, instances).
 * Falls back to defaults if not yet configured.
 */
router.get('/config', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId } = req.query;
    const doc = await _getConfig(schoolId, academicYearId || null);
    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/config GET]', err);
    return E.serverError(res);
  }
});

/**
 * PATCH /api/assessment/config
 * Update weights, template, and/or instance counts.
 *
 * Body (all optional):
 *   weights:        { CA, HW, MT, ET }  — must sum to 100
 *   reportTemplate: 'detailed' | 'summary'
 *   instances:      { CA: number, HW: number }  — min 1, max 10
 *   academicYearId: string
 */
router.patch('/config', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId, weights, reportTemplate, instances } = req.body;

    const update = {};

    // ── Validate weights ──
    if (weights) {
      const w = {};
      for (const t of ASSESSMENT_TYPES) {
        const val = Number(weights[t]);
        if (isNaN(val) || val < 0) {
          return _err(res, `Weight for "${t}" must be a non-negative number`);
        }
        w[t] = val;
      }
      const { valid, total } = validateWeights(w);
      if (!valid) {
        return _err(res, `Assessment weights must sum to 100%. Current total: ${total}%`);
      }
      update.weights = w;
    }

    // ── Validate template ──
    if (reportTemplate !== undefined) {
      if (!TEMPLATES.includes(reportTemplate)) {
        return _err(res, `reportTemplate must be one of: ${TEMPLATES.join(', ')}`);
      }
      update.reportTemplate = reportTemplate;
    }

    // ── Validate instances (CA/HW only) ──
    if (instances) {
      const inst = {};
      for (const t of ['CA', 'HW']) {
        if (instances[t] !== undefined) {
          const n = Number(instances[t]);
          if (!Number.isInteger(n) || n < 1 || n > 10) {
            return _err(res, `instances.${t} must be an integer between 1 and 10`);
          }
          inst[t] = n;
        }
      }
      update.instances = inst;
    }

    if (Object.keys(update).length === 0) {
      return _err(res, 'No valid fields to update');
    }

    const Config = _model('assessment_config');
    const doc = await Config.findOneAndUpdate(
      { schoolId, academicYearId: academicYearId || null },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/config PATCH]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   SCHEDULE  —  GET / PUT /api/assessment/schedule
   ══════════════════════════════════════════════════════════════ */

const ScheduleEntrySchema = z.object({
  termNumber:     z.number().int().min(1).max(3),
  assessmentType: z.enum(ASSESSMENT_TYPES),
  instance:       z.number().int().min(1).max(10).default(1),
  label:          z.string().max(100).optional(),
  dateFrom:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  dateTo:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  academicYearId: z.string().optional(),
});

/**
 * GET /api/assessment/schedule
 * Returns all assessment date ranges for the school.
 */
router.get('/schedule', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);

    const docs = await _model('assessment_schedule').find(filter)
      .sort({ termNumber: 1, assessmentType: 1, instance: 1 }).limit(200).lean();
    return _ok(res, docs);
  } catch (err) {
    console.error('[assessment/schedule GET]', err);
    return E.serverError(res);
  }
});

/**
 * PUT /api/assessment/schedule
 * Upsert a single schedule entry.
 * Body: ScheduleEntrySchema
 */
router.put('/schedule', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const parsed = ScheduleEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = parsed.data;

    if (d.dateFrom > d.dateTo) {
      return _err(res, 'dateFrom must be on or before dateTo');
    }

    const label = d.label || _label(d.assessmentType, d.instance);

    const doc = await _model('assessment_schedule').findOneAndUpdate(
      {
        schoolId,
        academicYearId: d.academicYearId || null,
        termNumber:     d.termNumber,
        assessmentType: d.assessmentType,
        instance:       d.instance,
      },
      {
        $set: { dateFrom: d.dateFrom, dateTo: d.dateTo, label },
        $setOnInsert: { id: uuidv4(), schoolId, academicYearId: d.academicYearId || null },
      },
      { new: true, upsert: true }
    ).lean();

    return _ok(res, doc);
  } catch (err) {
    console.error('[assessment/schedule PUT]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/schedule/:id
 */
router.delete('/schedule/:id', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('assessment_schedule').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Schedule entry not found');
    return _ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[assessment/schedule DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   MARKS  —  /api/assessment/marks
   ══════════════════════════════════════════════════════════════ */

const MarkSchema = z.object({
  studentId:      z.string().min(1),
  subjectId:      z.string().min(1),
  classId:        z.string().min(1),
  academicYearId: z.string().optional(),
  termNumber:     z.number().int().min(1).max(3),
  assessmentType: z.enum(ASSESSMENT_TYPES),
  instance:       z.number().int().min(1).max(10).default(1),
  rawScore:       z.number().min(0).max(100),
  label:          z.string().max(100).optional(),
  isPublished:    z.boolean().default(true),
});

const BulkMarkSchema = z.object({
  marks: z.array(MarkSchema).min(1).max(1000),
});

/**
 * GET /api/assessment/marks
 * List marks with flexible filters.
 *
 * Query params: studentId, subjectId, classId, termNumber,
 *               academicYearId, assessmentType, isPublished
 */
router.get('/marks', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };

    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.subjectId)      filter.subjectId      = req.query.subjectId;
    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termNumber)     filter.termNumber     = Number(req.query.termNumber);
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.assessmentType) filter.assessmentType = req.query.assessmentType.toUpperCase();
    if (req.query.isPublished !== undefined) {
      filter.isPublished = req.query.isPublished === 'true';
    }

    const docs = await _model('assessment_marks').find(filter)
      .sort({ termNumber: 1, assessmentType: 1, instance: 1 }).limit(5000).lean();
    return _ok(res, docs);
  } catch (err) {
    console.error('[assessment/marks GET]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/marks
 * Enter or update a single mark (upsert by student+subject+term+type+instance).
 */
router.post('/marks', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const parsed = MarkSchema.safeParse(req.body);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const d = parsed.data;

    // Enforce that only admin/superadmin can add MT and ET
    // (teachers add CA and HW by default; MT/ET require elevated permission)
    const role = req.jwtUser.role;
    const canAddExams = ['admin', 'superadmin', 'deputy_principal'].includes(role);
    if (['MT', 'ET'].includes(d.assessmentType) && !canAddExams) {
      // Check if admin has explicitly granted this teacher exam entry permission
      const config = await _getConfig(schoolId, d.academicYearId || null);
      const teacherCanEnterExams = config.teacherExamEntry === true;
      if (!teacherCanEnterExams) {
        return _err(res, 'MT and ET marks can only be entered by admin or deputy. Contact your admin to enable teacher exam entry.', 403);
      }
    }

    const label = d.label || _label(d.assessmentType, d.instance);

    const doc = await _model('assessment_marks').findOneAndUpdate(
      {
        schoolId,
        studentId:      d.studentId,
        subjectId:      d.subjectId,
        termNumber:     d.termNumber,
        assessmentType: d.assessmentType,
        instance:       d.instance,
        academicYearId: d.academicYearId || null,
      },
      {
        $set: {
          rawScore:    d.rawScore,
          classId:     d.classId,
          label,
          isPublished: d.isPublished,
          updatedBy:   userId,
        },
        $setOnInsert: {
          id:        uuidv4(),
          schoolId,
          createdBy: userId,
        },
      },
      { new: true, upsert: true }
    ).lean();

    return created(res, doc);
  } catch (err) {
    console.error('[assessment/marks POST]', err);
    return E.serverError(res);
  }
});

/**
 * POST /api/assessment/marks/bulk
 * Bulk upsert marks — used for class-wide mark entry.
 * Body: { marks: [...] }
 */
router.post('/marks/bulk', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const parsed = BulkMarkSchema.safeParse(req.body);
    if (!parsed.success) {
      return _err(res, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const { marks } = parsed.data;

    // Enforce that only admin/deputy_principal can bulk-enter MT and ET
    const role = req.jwtUser.role;
    const canAddExams = ['admin', 'superadmin', 'deputy_principal'].includes(role);
    const hasExamTypes = marks.some(d => ['MT', 'ET'].includes(d.assessmentType));
    if (hasExamTypes && !canAddExams) {
      const config = await _getConfig(req.jwtUser.schoolId, marks[0]?.academicYearId || null);
      if (!config.teacherExamEntry) {
        return _err(res, 'MT and ET marks can only be entered by admin or deputy. Contact your admin to enable teacher exam entry.', 403);
      }
    }

    const Marks = _model('assessment_marks');
    const ops = marks.map(d => ({
      updateOne: {
        filter: {
          schoolId,
          studentId:      d.studentId,
          subjectId:      d.subjectId,
          termNumber:     d.termNumber,
          assessmentType: d.assessmentType,
          instance:       d.instance,
          academicYearId: d.academicYearId || null,
        },
        update: {
          $set: {
            rawScore:    d.rawScore,
            classId:     d.classId,
            label:       d.label || _label(d.assessmentType, d.instance),
            isPublished: d.isPublished !== false,
            updatedBy:   userId,
          },
          $setOnInsert: {
            id:        uuidv4(),
            schoolId,
            createdBy: userId,
          },
        },
        upsert: true,
      },
    }));

    const result = await Marks.bulkWrite(ops, { ordered: false });
    return _ok(res, {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      total:    marks.length,
    }, null, 201);
  } catch (err) {
    console.error('[assessment/marks/bulk POST]', err);
    return E.serverError(res);
  }
});

/**
 * DELETE /api/assessment/marks/:id
 */
router.delete('/marks/:id', authMiddleware, PLAN, rbac('grades', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('assessment_marks').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Mark not found');
    return _ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[assessment/marks DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   REPORT CARD  —  GET /api/assessment/report
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/report
 * Compute a full structured report card for a student or an entire class.
 *
 * Query params (one required):
 *   studentId     — single student report
 *   classId       — class-wide report (all students in class)
 *   academicYearId — filter to academic year
 *   termNumber     — 1|2|3 → returns only that term's data
 *                    omit  → returns all 3 terms
 *   half           — 'true' → return half-term totals (CA+HW+MT only)
 *
 * Response structure (per student, per subject):
 *   terms: {
 *     1: { typeAvgs, breakdown, halfTermTotal, termTotal, finalGrade, etRunningAvg, etRef }
 *     2: { ... etRef: { ET1 } }
 *     3: { ... etRef: { ET1, ET2 } }
 *   }
 *   summaryAverage: number  (Template B — avg of T1+T2+T3 totals)
 */
router.get('/report', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId, classId, academicYearId, termNumber, half } = req.query;

    if (!studentId && !classId) {
      return _err(res, 'studentId or classId is required');
    }

    // Load config (weights, template)
    const config  = await _getConfig(schoolId, academicYearId || null);
    const weights = config.weights || DEFAULT_WEIGHTS;

    // Fetch all published marks
    const marksFilter = { schoolId, isPublished: true };
    if (studentId)      marksFilter.studentId      = studentId;
    if (classId)        marksFilter.classId        = classId;
    if (academicYearId) marksFilter.academicYearId = academicYearId;
    if (termNumber)     marksFilter.termNumber     = Number(termNumber);

    // Safety ceiling: 10,000 marks = ~50 students × 14 subjects × 4 types × 3-4 instances
    // Bounded further by the classId/termNumber filters applied above
    const allMarks = await _model('assessment_marks').find(marksFilter).limit(10000).lean();

    // Group marks by studentId → subjectId
    const byStudentSubject = {};
    for (const m of allMarks) {
      const key = `${m.studentId}__${m.subjectId}`;
      byStudentSubject[key] = byStudentSubject[key] || {
        studentId: m.studentId,
        subjectId: m.subjectId,
        classId:   m.classId,
        marks:     [],
      };
      byStudentSubject[key].marks.push(m);
    }

    // Compute report per student per subject
    const reportsByStudent = {};
    for (const { studentId: sid, subjectId, classId: cid, marks } of Object.values(byStudentSubject)) {
      reportsByStudent[sid] = reportsByStudent[sid] || { studentId: sid, classId: cid, subjects: {} };
      reportsByStudent[sid].subjects[subjectId] = buildSubjectReport({ marks, weights });
    }

    // If half-term mode, strip ET from results and highlight halfTermTotal
    const isHalf = half === 'true';
    if (isHalf) {
      for (const student of Object.values(reportsByStudent)) {
        for (const subReport of Object.values(student.subjects)) {
          for (const term of Object.values(subReport.terms)) {
            delete term.finalGrade;
            delete term.etRunningAvg;
            // halfTermTotal is the key metric
          }
        }
      }
    }

    // Attach config so frontend knows template and weights used
    const result = {
      config: {
        weights,
        reportTemplate: config.reportTemplate,
        instances:      config.instances || DEFAULT_INSTANCES,
      },
      students: Object.values(reportsByStudent),
    };

    // If single student, unwrap for convenience
    if (studentId) {
      return _ok(res, {
        ...result,
        student: reportsByStudent[studentId] || { studentId, subjects: {} },
      });
    }

    return _ok(res, result);
  } catch (err) {
    console.error('[assessment/report GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   REMINDERS  —  GET /api/assessment/reminders
   ══════════════════════════════════════════════════════════════ */

/**
 * GET /api/assessment/reminders
 * Returns upcoming and overdue assessments for the calling teacher
 * (or all assessments if admin).
 *
 * An assessment is:
 *   - "upcoming"  if dateFrom is within the next 7 days (not yet open)
 *   - "open"      if today is between dateFrom and dateTo
 *   - "overdue"   if dateTo has passed and marks are incomplete
 *   - "completed" if dateTo has passed and marks are entered
 *
 * Query params:
 *   academicYearId
 *   classId        — scope to specific class
 *   subjectId      — scope to specific subject
 *   days           — days ahead to look for upcoming (default: 7)
 */
router.get('/reminders', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId, classId, subjectId } = req.query;
    const daysAhead = Number(req.query.days) || 7;

    const today      = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr   = today.toISOString().slice(0, 10);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    // Load schedule
    const schedFilter = { schoolId };
    if (academicYearId) schedFilter.academicYearId = academicYearId;

    const schedules = await _model('assessment_schedule').find(schedFilter).lean();

    // For each schedule entry, check if marks have been entered
    const reminders = [];

    for (const sched of schedules) {
      const status =
        sched.dateTo < todayStr   ? 'overdue' :
        sched.dateFrom <= todayStr ? 'open'    :
        sched.dateFrom <= futureDateStr ? 'upcoming' : null;

      if (!status) continue;

      // Count marks entered for this assessment
      const marksFilter = {
        schoolId,
        termNumber:     sched.termNumber,
        assessmentType: sched.assessmentType,
        instance:       sched.instance,
        academicYearId: sched.academicYearId || null,
      };
      if (classId)   marksFilter.classId   = classId;
      if (subjectId) marksFilter.subjectId = subjectId;

      const marksCount = await _model('assessment_marks').countDocuments(marksFilter);

      reminders.push({
        scheduleId:     sched.id,
        termNumber:     sched.termNumber,
        assessmentType: sched.assessmentType,
        instance:       sched.instance,
        label:          sched.label,
        dateFrom:       sched.dateFrom,
        dateTo:         sched.dateTo,
        status,
        marksEntered:   marksCount,
        academicYearId: sched.academicYearId,
      });
    }

    // Sort: overdue first, then open, then upcoming
    const ORDER = { overdue: 0, open: 1, upcoming: 2 };
    reminders.sort((a, b) =>
      (ORDER[a.status] - ORDER[b.status]) ||
      (a.dateFrom > b.dateFrom ? 1 : -1)
    );

    return _ok(res, reminders);
  } catch (err) {
    console.error('[assessment/reminders GET]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   SEND REMINDERS  —  POST /api/assessment/reminders/notify
   Trigger email + in-app notifications for overdue/open assessments.
   Typically called by a cron job but can also be triggered manually by admin.
   ══════════════════════════════════════════════════════════════ */

router.post('/reminders/notify', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { academicYearId } = req.body;

    const today     = new Date().toISOString().slice(0, 10);
    const upcoming  = new Date();
    upcoming.setDate(upcoming.getDate() + 3);
    const upcomingStr = upcoming.toISOString().slice(0, 10);

    // Schedules that are open, overdue, or opening within 3 days
    const schedules = await _model('assessment_schedule').find({
      schoolId,
      ...(academicYearId ? { academicYearId } : {}),
      dateFrom: { $lte: upcomingStr },
    }).lean();

    if (!schedules.length) return _ok(res, { sent: 0, message: 'No assessments in reminder window' });

    // Load school info for email branding
    const school = await _model('schools').findOne({ id: schoolId }).lean();

    // Load all teachers for this school
    const teachers = await _model('users').find({ schoolId, role: 'teacher' }).limit(200).lean();

    let notified = 0;
    for (const sched of schedules) {
      const status =
        sched.dateTo < today    ? 'overdue'  :
        sched.dateFrom <= today ? 'open'     : 'upcoming';

      const statusMsg = {
        upcoming: `📅 Upcoming: ${sched.label} opens on ${sched.dateFrom}`,
        open:     `✏️  Open now: ${sched.label} — marks due by ${sched.dateTo}`,
        overdue:  `⚠️  Overdue: ${sched.label} closed on ${sched.dateTo} — please enter marks immediately`,
      }[status];

      // Create in-app notifications
      for (const teacher of teachers) {
        await _model('notifications').create({
          id:        uuidv4(),
          schoolId,
          userId:    teacher.id,
          type:      'assessment_reminder',
          title:     `Assessment Reminder — ${sched.label}`,
          body:      statusMsg,
          status,
          scheduleId: sched.id,
          read:       false,
          createdAt:  new Date().toISOString(),
        }).catch(() => {}); // non-fatal

        // Send email if teacher has email
        if (teacher.email && email.sendAssessmentReminder) {
          await email.sendAssessmentReminder({
            name:        teacher.name,
            email:       teacher.email,
            assessment:  sched.label,
            termNumber:  sched.termNumber,
            dateFrom:    sched.dateFrom,
            dateTo:      sched.dateTo,
            status,
            schoolName:  school?.name || schoolId,
            schoolEmail: school?.systemEmail || '',
          }).catch(e => console.error('[assessment/reminders/notify] email failed:', e.message));
        }
        notified++;
      }
    }

    return _ok(res, { sent: notified, assessments: schedules.length });
  } catch (err) {
    console.error('[assessment/reminders/notify POST]', err);
    return E.serverError(res);
  }
});

/* ── Class mark-entry summary ───────────────────────────────── */

/**
 * GET /api/assessment/marks/summary
 * Returns for each student in a class: which assessments have marks entered.
 * Useful for showing the teacher a completion grid.
 *
 * Query: classId (required), subjectId, termNumber, academicYearId
 */
router.get('/marks/summary', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId, termNumber, academicYearId } = req.query;

    if (!classId) return _err(res, 'classId is required');

    const filter = { schoolId, classId };
    if (subjectId)      filter.subjectId      = subjectId;
    if (termNumber)     filter.termNumber     = Number(termNumber);
    if (academicYearId) filter.academicYearId = academicYearId;

    // classId is required (enforced above) — bounded to one class, safe ceiling
    const marks = await _model('assessment_marks').find(filter).limit(5000).lean();

    // Group by studentId → assessmentType+instance → rawScore
    const grid = {};
    for (const m of marks) {
      grid[m.studentId] = grid[m.studentId] || {};
      const key = `${m.assessmentType}${m.instance}`;
      grid[m.studentId][key] = m.rawScore;
    }

    return _ok(res, grid);
  } catch (err) {
    console.error('[assessment/marks/summary GET]', err);
    return E.serverError(res);
  }
});

module.exports = router;
