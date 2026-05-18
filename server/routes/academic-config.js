/* ============================================================
   InnoLearn — /api/academic-config
   School-level academic configuration:
     - Grading schema (grade bands per curriculum)
     - Assessment type weighting (CAT %, Midterm %, Final %)
     - Ranking settings (enable/disable, method, scope)
     - Report card settings (template, signatures, comments)
   Plan: standard | RBAC: settings:{read,create,update}
   ============================================================ */
const express = require('express');
const { z }   = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, E }          = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Default configurations (used when a school hasn't configured yet) ── */
const DEFAULT_GRADING_SCHEMA = [
  { grade: 'A',  minScore: 80, maxScore: 100, points: 4.0, descriptor: 'Excellent',      remarks: 'Outstanding performance' },
  { grade: 'B+', minScore: 75, maxScore: 79,  points: 3.5, descriptor: 'Very Good',       remarks: 'Above average performance' },
  { grade: 'B',  minScore: 65, maxScore: 74,  points: 3.0, descriptor: 'Good',            remarks: 'Good performance' },
  { grade: 'C+', minScore: 60, maxScore: 64,  points: 2.5, descriptor: 'Above Average',   remarks: 'Satisfactory performance' },
  { grade: 'C',  minScore: 50, maxScore: 59,  points: 2.0, descriptor: 'Average',         remarks: 'Average performance' },
  { grade: 'D+', minScore: 45, maxScore: 49,  points: 1.5, descriptor: 'Below Average',   remarks: 'Needs improvement' },
  { grade: 'D',  minScore: 40, maxScore: 44,  points: 1.0, descriptor: 'Poor',            remarks: 'Poor performance — intervention required' },
  { grade: 'E',  minScore: 0,  maxScore: 39,  points: 0.0, descriptor: 'Fail',            remarks: 'Did not meet the minimum standard' },
];

// Default assessment weights — sum must equal 100
const DEFAULT_ASSESSMENT_WEIGHTS = [
  { assessmentType: 'classwork',  label: 'Classwork / CAT',     weight: 20 },
  { assessmentType: 'midterm',    label: 'Mid-Term Exam',       weight: 30 },
  { assessmentType: 'final',      label: 'End-Term Exam',       weight: 50 },
];

const DEFAULT_RANKING_CONFIG = {
  enabled:           true,
  scope:             ['class', 'stream', 'overall'],  // which ranking levels to show
  method:            'standard',   // 'standard' (1,2,2,4) | 'dense' (1,2,2,3)
  showOnReportCard:  true,
  showBestPerSubject: true,
};

const DEFAULT_REPORT_CONFIG = {
  templateId:          'tabular',        // 'tabular' | 'card' | custom
  showAttendanceSummary: true,
  showRank:            true,
  showGPA:             true,
  showClassAverage:    true,
  showDeviation:       true,
  showComments:        true,
  principalSignatureLabel: 'Principal',
  classTeacherSignatureLabel: 'Class Teacher',
  footerNote:          'This report card is computer-generated and is valid without a handwritten signature.',
};

/* ── Validation ─────────────────────────────────────────────── */
const GradeBandSchema = z.object({
  grade:      z.string().min(1).max(5),
  minScore:   z.number().min(0).max(100),
  maxScore:   z.number().min(0).max(100),
  points:     z.number().min(0).max(10).optional(),
  descriptor: z.string().max(50).optional(),
  remarks:    z.string().max(200).optional(),
});

const AssessmentWeightSchema = z.object({
  assessmentType: z.enum(['classwork', 'homework', 'project', 'test', 'midterm', 'final', 'coursework', 'oral', 'practical', 'other']),
  label:          z.string().min(1).max(100),
  weight:         z.number().min(0).max(100),
});

const ConfigSchema = z.object({
  // Grading
  gradingSchema:       z.array(GradeBandSchema).min(1).max(20).optional(),
  gradingType:         z.enum(['percentage', 'gpa', 'competency', 'descriptors', 'cambridge', 'ib']).optional(),
  passMark:            z.number().min(0).max(100).optional(),

  // Assessment weighting
  assessmentWeights:   z.array(AssessmentWeightSchema).optional(),
  weightingEnabled:    z.boolean().optional(),

  // Ranking
  rankingEnabled:      z.boolean().optional(),
  rankingScope:        z.array(z.enum(['class', 'stream', 'overall'])).optional(),
  rankingMethod:       z.enum(['standard', 'dense']).optional(),
  showRankOnReport:    z.boolean().optional(),
  showBestPerSubject:  z.boolean().optional(),
  // Ranking subject strategy — which subjects count toward rank
  //   'all'              → all subjects averaged (default)
  //   'best_n'           → best N subjects by score (e.g. KCSE best 7 of 8)
  //   'compulsory_only'  → only subjects marked compulsory
  rankingSubjectStrategy: z.enum(['all', 'best_n', 'compulsory_only']).optional(),
  rankingN:            z.number().int().min(1).max(20).optional(),  // used with 'best_n'
  compulsorySubjects:  z.array(z.string()).max(30).optional(),      // subjectIds for 'compulsory_only'

  // Mark states behaviour
  absentCountsAsZero:  z.boolean().optional(),  // default: false (correct behaviour)
  incompleteBlocksApproval: z.boolean().optional(), // default: true

  // Report
  templateId:          z.string().max(50).optional(),
  showAttendanceSummary: z.boolean().optional(),
  showGPA:             z.boolean().optional(),
  showDeviation:       z.boolean().optional(),
  showClassAverage:    z.boolean().optional(),
  principalSignatureLabel:     z.string().max(100).optional(),
  classTeacherSignatureLabel:  z.string().max(100).optional(),
  footerNote:          z.string().max(500).optional(),

  // Subject assignment enforcement
  subjectAssignmentEnforced: z.boolean().optional(), // if true, only assigned teacher can enter marks

  // archivedAcademicYears is intentionally NOT in this schema.
  // It is read-only from the client's perspective — only writable via POST /archive-year.
  // Any client that sends it in a PUT body will have it silently stripped by Zod.
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── Build full config merging saved + defaults ─────────────── */
function _mergeConfig(saved) {
  return {
    gradingSchema:         saved?.gradingSchema         ?? DEFAULT_GRADING_SCHEMA,
    gradingType:           saved?.gradingType           ?? 'percentage',
    passMark:              saved?.passMark              ?? 40,
    assessmentWeights:     saved?.assessmentWeights     ?? DEFAULT_ASSESSMENT_WEIGHTS,
    weightingEnabled:      saved?.weightingEnabled      ?? true,
    rankingEnabled:        saved?.rankingEnabled        ?? DEFAULT_RANKING_CONFIG.enabled,
    rankingScope:          saved?.rankingScope          ?? DEFAULT_RANKING_CONFIG.scope,
    rankingMethod:         saved?.rankingMethod         ?? DEFAULT_RANKING_CONFIG.method,
    showRankOnReport:      saved?.showRankOnReport      ?? DEFAULT_RANKING_CONFIG.showOnReportCard,
    showBestPerSubject:    saved?.showBestPerSubject     ?? DEFAULT_RANKING_CONFIG.showBestPerSubject,
    absentCountsAsZero:    saved?.absentCountsAsZero    ?? false,
    incompleteBlocksApproval: saved?.incompleteBlocksApproval ?? true,
    templateId:            saved?.templateId            ?? DEFAULT_REPORT_CONFIG.templateId,
    showAttendanceSummary: saved?.showAttendanceSummary ?? DEFAULT_REPORT_CONFIG.showAttendanceSummary,
    showGPA:               saved?.showGPA               ?? DEFAULT_REPORT_CONFIG.showGPA,
    showDeviation:         saved?.showDeviation         ?? DEFAULT_REPORT_CONFIG.showDeviation,
    showClassAverage:      saved?.showClassAverage      ?? DEFAULT_REPORT_CONFIG.showClassAverage,
    principalSignatureLabel:    saved?.principalSignatureLabel     ?? DEFAULT_REPORT_CONFIG.principalSignatureLabel,
    classTeacherSignatureLabel: saved?.classTeacherSignatureLabel  ?? DEFAULT_REPORT_CONFIG.classTeacherSignatureLabel,
    footerNote:            saved?.footerNote            ?? DEFAULT_REPORT_CONFIG.footerNote,
    rankingSubjectStrategy: saved?.rankingSubjectStrategy ?? 'all',
    rankingN:              saved?.rankingN              ?? 7,
    compulsorySubjects:    saved?.compulsorySubjects    ?? [],
    subjectAssignmentEnforced: saved?.subjectAssignmentEnforced ?? false,
    // Archived years — read-only list; used by frontend to disable UI controls
    // for year-scoped inputs (grade entry, exam results) for closed years.
    archivedAcademicYears: Array.isArray(saved?.archivedAcademicYears)
      ? saved.archivedAcademicYears
      : [],
  };
}

/* ═══════════════════════════════════════════════════════════════
   GET /api/academic-config — fetch current config (with defaults)
   ═══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, PLAN, rbac('settings', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const saved = await _model('academic_config').findOne({ schoolId }).lean();
    return ok(res, _mergeConfig(saved));
  } catch (err) { console.error('[academic-config GET]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   PUT /api/academic-config — save / update config (upsert)
   ═══════════════════════════════════════════════════════════════ */
router.put('/', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ConfigSchema, req.body);
    if (error) return E.validation(res, error);

    // Validate grading schema: bands must not overlap and must cover 0–100
    if (data.gradingSchema) {
      const sorted = [...data.gradingSchema].sort((a, b) => a.minScore - b.minScore);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].minScore > sorted[i].maxScore) {
          return E.badRequest(res, `Grade "${sorted[i].grade}": minScore (${sorted[i].minScore}) cannot exceed maxScore (${sorted[i].maxScore})`);
        }
        if (i > 0 && sorted[i].minScore <= sorted[i - 1].maxScore) {
          return E.badRequest(res, `Grade bands "${sorted[i - 1].grade}" and "${sorted[i].grade}" overlap — check your score ranges`);
        }
      }
    }

    // Validate assessment weights sum to 100 (within tolerance)
    if (data.assessmentWeights) {
      const total = data.assessmentWeights.reduce((s, w) => s + w.weight, 0);
      if (Math.abs(total - 100) > 0.01) {
        return E.badRequest(res, `Assessment weights must sum to 100 — current total: ${total}`);
      }
    }

    const doc = await _model('academic_config').findOneAndUpdate(
      { schoolId },
      { $set: { ...data, schoolId, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true, upsert: true, runValidators: false }
    ).lean();

    return ok(res, _mergeConfig(doc));
  } catch (err) { console.error('[academic-config PUT]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/academic-config/reset — reset to system defaults
   ═══════════════════════════════════════════════════════════════ */
router.post('/reset', authMiddleware, PLAN, rbac('settings', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    await _model('academic_config').deleteOne({ schoolId });
    console.log(`[ACADEMIC-CONFIG] Reset to defaults by ${userId} for school ${schoolId}`);
    return ok(res, _mergeConfig(null));
  } catch (err) { console.error('[academic-config RESET]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/academic-config/grade — resolve a score to grade band
   Query: ?score=74&subjectId=optional
   Useful for frontend previews and server-side grade assignment
   ═══════════════════════════════════════════════════════════════ */
router.get('/grade', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const score = parseFloat(req.query.score);
    if (isNaN(score)) return E.badRequest(res, 'score query param is required and must be a number');

    const saved = await _model('academic_config').findOne({ schoolId }).lean();
    const config = _mergeConfig(saved);
    const band = resolveGrade(score, config.gradingSchema);
    return ok(res, { score, ...band });
  } catch (err) { console.error('[academic-config/grade GET]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/academic-config/archive-year — archive an academic year
   Cascades: freezes all exams, locks all report snapshots, sets
   an archived flag on the academic_config for the year.

   Body: { academicYearId, reason }
   Admin only. Irreversible without direct DB intervention.
   ═══════════════════════════════════════════════════════════════ */
router.post('/archive-year', authMiddleware, PLAN, rbac('settings', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['admin', 'superadmin'].includes(role)) {
      return E.forbidden(res, 'Only admins can archive an academic year');
    }

    const { academicYearId, reason } = req.body;
    if (!academicYearId) return E.badRequest(res, 'academicYearId is required');
    if (!reason?.trim()) return E.badRequest(res, 'reason is required when archiving an academic year');

    const now = new Date().toISOString();
    const filter = { schoolId, academicYearId };

    // ── Step A: Resolve human-readable year label for audit trail ──
    // Best-effort — does not block archival if the year document is missing.
    let academicYearLabel = academicYearId;
    try {
      const yearDoc = await _model('academic_years').findOne({ schoolId, id: academicYearId }, { name: 1, year: 1 }).lean();
      if (yearDoc) academicYearLabel = yearDoc.name || yearDoc.year || academicYearId;
    } catch { /* non-fatal */ }

    // ── Step B: Data cascade (parallel, additive — no data deleted) ──
    // Runs first. The config write-blocking gate is written AFTER these
    // succeed so that the gate is never active without the cascade completing.
    const [examsResult, snapshotsResult, gradesResult] = await Promise.all([
      // Freeze all exams not already archived/cancelled
      _model('exams').updateMany(
        { ...filter, status: { $nin: ['archived', 'cancelled'] } },
        { $set: { status: 'archived', archivedAt: now, archivedBy: userId, archiveReason: reason } }
      ),
      // Lock all published report card snapshots for this year
      _model('report_card_snapshots').updateMany(
        { ...filter, status: 'published', superseded: { $ne: true } },
        { $set: { yearArchived: true, yearArchivedAt: now, yearArchivedBy: userId } }
      ),
      // Prevent new grade entries by marking grades as year-archived
      _model('grades').updateMany(
        { ...filter },
        { $set: { yearArchived: true, yearArchivedAt: now } }
      ),
    ]);

    // ── Step C: Activate the write-blocking gate (MUST follow Step B) ──
    // Sequenced after the cascade so the gate is only active once all
    // underlying data ops have committed. If this fails, the cascade data
    // is already marked archived but the server-side write block is not
    // active — the error is surfaced in the response for operator action.
    let writeBlockActive = false;
    let writeBlockError  = null;
    try {
      await _model('academic_config').findOneAndUpdate(
        { schoolId },
        {
          $addToSet: { archivedAcademicYears: academicYearId },
          $set: { updatedBy: userId, updatedAt: now },
        },
        { upsert: true, new: true, runValidators: false }
      );
      writeBlockActive = true;
    } catch (gateErr) {
      writeBlockError = gateErr.message;
      console.error(`[ACADEMIC-CONFIG] ⚠️  Write-blocking gate FAILED for year ${academicYearId}: ${gateErr.message}`);
    }

    // ── Step D: Audit log (includes cascade counts + label + gate status) ──
    await _model('mark_audit_log').create({
      action:             'ACADEMIC_YEAR_ARCHIVED',
      schoolId,
      academicYearId,
      academicYearLabel,
      editedBy:           userId,
      reason,
      timestamp:          now,
      writeBlockActive,
      writeBlockError:    writeBlockError || undefined,
      cascade: {
        examsArchived:    examsResult.modifiedCount,
        snapshotsLocked:  snapshotsResult.modifiedCount,
        gradesLocked:     gradesResult.modifiedCount,
      },
    });

    console.log(`[ACADEMIC-CONFIG] Year archived: "${academicYearLabel}" (${academicYearId}) by ${userId} — "${reason}" | gate:${writeBlockActive ? 'active' : 'FAILED'}`);

    const response = {
      academicYearId,
      academicYearLabel,
      archivedAt:       now,
      archivedBy:       userId,
      examsArchived:    examsResult.modifiedCount,
      snapshotsLocked:  snapshotsResult.modifiedCount,
      gradesLocked:     gradesResult.modifiedCount,
      writeBlockActive,
      message: writeBlockActive
        ? 'Academic year archived. All exams frozen, report cards locked, grade entries prevented. Write-blocking is now active for this year.'
        : 'Academic year archived — cascade completed, but the write-blocking gate could not be activated. Contact your platform operator.',
    };

    if (writeBlockError) response.writeBlockError = writeBlockError;
    return ok(res, response);
  } catch (err) { console.error('[academic-config/archive-year]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   School Profile — GET / PATCH
   Superadmin/admin can view and update top-level school settings:
   name, shortName, systemEmail, phone, address, logo, timezone, currency.
   systemEmail is what appears in school-level email notifications
   (2FA codes, password changes, message alerts, invites).
   ══════════════════════════════════════════════════════════════ */

// Allowed top-level school fields that admins may read/write
const SCHOOL_PROFILE_FIELDS = [
  'name', 'shortName', 'systemEmail', 'phone', 'address',
  'logoUrl', 'website', 'timezone', 'currency', 'adminName', 'adminEmail',
  'primaryColor', 'accentColor',
];

/* GET /api/academic-config/school-profile */
router.get('/school-profile', authMiddleware, async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!['superadmin', 'admin'].includes(role)) {
      return E.forbidden(res, 'Admin access required');
    }
    const School = _model('schools');
    const school = await School.findOne({ id: schoolId }).lean();
    if (!school) return E.notFound(res, 'School not found');

    const profile = {};
    SCHOOL_PROFILE_FIELDS.forEach(f => { profile[f] = school[f] ?? null; });
    profile.plan    = school.plan;
    profile.addOns  = school.addOns || [];
    profile.slug    = school.slug;
    return ok(res, profile);
  } catch (err) { console.error('[school-profile/get]', err); return E.serverError(res); }
});

/* PATCH /api/academic-config/school-profile */
router.patch('/school-profile', authMiddleware, async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!['superadmin', 'admin'].includes(role)) {
      return E.forbidden(res, 'Admin access required');
    }

    // Validate systemEmail if provided
    if (req.body.systemEmail !== undefined) {
      const em = req.body.systemEmail;
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        return E.badRequest(res, 'Invalid systemEmail address');
      }
    }

    // Whitelist updates — only allow permitted fields
    const update = {};
    SCHOOL_PROFILE_FIELDS.forEach(f => {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    });
    // Block read-only derived fields
    delete update.slug;
    delete update.plan;

    if (!Object.keys(update).length) {
      return E.badRequest(res, 'No valid fields to update');
    }

    const School = _model('schools');
    const school = await School.findOneAndUpdate(
      { id: schoolId },
      { $set: update },
      { new: true }
    ).lean();
    if (!school) return E.notFound(res, 'School not found');

    const profile = {};
    SCHOOL_PROFILE_FIELDS.forEach(f => { profile[f] = school[f] ?? null; });
    profile.plan   = school.plan;
    profile.addOns = school.addOns || [];
    profile.slug   = school.slug;

    console.log(`[SCHOOL-PROFILE] Updated by ${req.jwtUser.userId}: ${Object.keys(update).join(', ')}`);
    return ok(res, profile);
  } catch (err) { console.error('[school-profile/patch]', err); return E.serverError(res); }
});

/* ── Exported helper: resolve score → grade band ────────────── */
function resolveGrade(score, gradingSchema = DEFAULT_GRADING_SCHEMA) {
  const sorted = [...gradingSchema].sort((a, b) => b.minScore - a.minScore);
  const band   = sorted.find(g => score >= g.minScore && score <= g.maxScore);
  return band
    ? { grade: band.grade, points: band.points ?? null, descriptor: band.descriptor ?? null, remarks: band.remarks ?? null }
    : { grade: null, points: null, descriptor: null, remarks: null };
}

module.exports = router;
module.exports.resolveGrade          = resolveGrade;
module.exports.DEFAULT_GRADING_SCHEMA = DEFAULT_GRADING_SCHEMA;
module.exports.mergeConfig           = _mergeConfig;
