/* ============================================================
   InnoLearn — /api/report-cards  (v3 — production hardened)

   Endpoints:
     POST /generate              — live preview (not persisted)
     POST /publish               — versioned batch snapshot (admin only)
     GET  /publish-batches       — audit trail of publish runs
     GET  /                      — list snapshots
     GET  /:id                   — full snapshot detail
     PUT  /:id/comments          — save comments (role-gated)
     GET  /:id/pdf               — single PDF (DRAFT watermark if not published)
     GET  /bulk-pdf              — class-wide merged PDF (cursor-streamed)

   Data integrity:
     - Calculations delegated to server/utils/academic-calc.js (single source)
     - Publish is interrupt-safe (publish_batches collection)
     - Snapshots are versioned (superseded never deleted)
     - Moderation guard enforced; bypass requires reason + audit
     - Parent/student role: blocked from superseded snapshots
     - Bulk PDF uses cursor — no full collection load into RAM

   Plan: standard | RBAC: grades:{read,create,update}
   ============================================================ */
const express   = require('express');
const { z }     = require('zod');
const { v4: uuidv4 } = require('uuid');
const mongoose  = require('mongoose');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');
const { mergeConfig }    = require('./academic-config');
const { isYearArchived } = require('../utils/archival');
const {
  aggregateGrades,
  aggregateExamResults,
  computeFinalScores,
  attendanceSummary,
  attachDeviations,
} = require('../utils/academic-calc');

const router = express.Router();
const PLAN   = planGate('grades');

/* ── Config loader ──────────────────────────────────────────── */
async function _loadConfig(schoolId) {
  const saved = await _model('academic_config').findOne({ schoolId }).lean();
  return mergeConfig(saved);
}

/* ── Restricted roles (parents/students see only current versions) ── */
const RESTRICTED_ROLES = ['parent', 'student', 'guardian'];

/* ── Validation ─────────────────────────────────────────────── */
const GenerateSchema = z.object({
  classId:        z.string().min(1),
  termId:         z.string().optional(),
  academicYearId: z.string().optional(),
  studentId:      z.string().optional(),
});

const PublishSchema = z.object({
  classId:         z.string().min(1),
  termId:          z.string().optional(),
  academicYearId:  z.string().optional(),
  className:       z.string().max(100).optional(),
  termName:        z.string().max(100).optional(),
  academicYear:    z.string().max(50).optional(),
  schoolName:      z.string().max(200).optional(),
  skipModerationCheck: z.boolean().default(false),
  // Required when skipModerationCheck is true
  skipReason:      z.string().max(500).optional(),
});

const CommentSchema = z.object({
  subjectComments:    z.record(z.string().max(500)).optional(),
  classTeacherRemark: z.string().max(1000).optional(),
  principalRemark:    z.string().max(1000).optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   POST /generate  — live preview (not persisted)
   ══════════════════════════════════════════════════════════════ */
router.post('/generate', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { data, error } = _validate(GenerateSchema, req.body);
    if (error) return E.validation(res, error);

    const { classId, termId, academicYearId, studentId } = data;
    const config = await _loadConfig(schoolId);

    const [gradesData, { data: examData }] = await Promise.all([
      aggregateGrades(schoolId, classId, termId, academicYearId, studentId),
      aggregateExamResults(schoolId, classId, termId, academicYearId, studentId),
    ]);

    const allReports = computeFinalScores(gradesData, examData, config.assessmentWeights, config.gradingSchema);

    // Attach class deviations (requires full class data)
    if (!studentId) attachDeviations(allReports);

    // Provisional class rankings
    const classInput = Object.values(allReports).map(r => ({
      studentId:  r.studentId,
      totalScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
    }));
    const classRanks = rankStudents(classInput, config.rankingMethod);

    const targets = studentId
      ? (allReports[studentId] ? { [studentId]: allReports[studentId] } : {})
      : allReports;

    const students = Object.values(targets).map(r => ({
      ...r,
      rankingScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
      rankings: config.rankingEnabled ? mergeRankings(r.studentId, { class: classRanks }) : {},
    }));

    return ok(res, {
      generated: students.length,
      config: {
        gradingType: config.gradingType, passMark: config.passMark,
        rankingEnabled: config.rankingEnabled, rankingSubjectStrategy: config.rankingSubjectStrategy,
        assessmentWeights: config.assessmentWeights,
      },
      students,
    });
  } catch (err) { console.error('[report-cards/generate]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   POST /publish  — interrupt-safe versioned batch snapshot
   ══════════════════════════════════════════════════════════════ */
router.post('/publish', authMiddleware, PLAN, rbac('grades', 'create'), async (req, res) => {
  const { schoolId, userId, role } = req.jwtUser;
  if (!['admin', 'superadmin'].includes(role)) return E.forbidden(res, 'Only admins can publish report cards');

  const { data, error } = _validate(PublishSchema, req.body);
  if (error) return E.validation(res, error);

  // skipModerationCheck requires an explicit reason (mandatory)
  if (data.skipModerationCheck && !data.skipReason?.trim()) {
    return E.badRequest(res, 'skipReason is required when skipModerationCheck is true — document why the moderation check is being bypassed');
  }

  const { classId, termId, academicYearId, className, termName, academicYear, schoolName, skipModerationCheck, skipReason } = data;
  const now     = new Date().toISOString();
  const batchId = uuidv4();

  // ── Step 1: Create batch record (interrupt-safe anchor) ──────
  const Batches = _model('publish_batches');
  await Batches.create({
    id: batchId, schoolId, classId,
    termId: termId || null, academicYearId: academicYearId || null,
    status: 'running', startedBy: userId, startedAt: now,
    studentCount: 0, successCount: 0, failedStudents: [],
    moderationBypassed: skipModerationCheck,
    moderationBypassReason: skipReason || null,
  });

  try {
    // ── Step 1b: Block publish for archived academic years ───
    if (academicYearId && await isYearArchived(schoolId, academicYearId)) {
      await Batches.updateOne({ id: batchId }, {
        status: 'failed',
        failureReason: `Academic year "${academicYearId}" is archived — publishing is not permitted for closed years.`,
        completedAt: now,
      });
      return E.badRequest(res, `Academic year "${academicYearId}" has been archived — report card publishing is not permitted for closed years.`);
    }

    const config = await _loadConfig(schoolId);

    // ── Step 2: Moderation guard ─────────────────────────────
    const { data: examData, examStatuses } = await aggregateExamResults(schoolId, classId, termId, academicYearId);

    if (skipModerationCheck) {
      // Write audit entry for the bypass — this is mandatory, non-negotiable
      await _model('mark_audit_log').create({
        action:    'MODERATION_BYPASS',
        batchId,
        schoolId,  classId,
        termId:    termId || null,
        editedBy:  userId,
        reason:    skipReason,
        timestamp: now,
        examStatusAtBypass: examStatuses.map(e => ({ id: e.id, title: e.title, status: e.status })),
      });
      console.warn(`[REPORT-CARDS] ⚠️  Moderation check BYPASSED — batch ${batchId} by ${userId}: "${skipReason}"`);
    } else {
      const APPROVED_STATES = ['approved', 'locked', 'published', 'archived'];
      const unmoderated = examStatuses.filter(e => !APPROVED_STATES.includes(e.status));
      if (unmoderated.length > 0) {
        await Batches.updateOne({ id: batchId }, {
          status: 'failed',
          failureReason: `${unmoderated.length} exam(s) not yet approved`,
          unmoderatedExams: unmoderated.map(e => ({ id: e.id, title: e.title, status: e.status })),
          completedAt: now,
        });
        return E.badRequest(res, [
          `${unmoderated.length} exam(s) for this class/term are not yet approved:`,
          ...unmoderated.map(e => `  • "${e.title}" (${e.status})`),
          'Approve all exams first — or pass skipModerationCheck: true with a documented skipReason.'
        ].join('\n'));
      }
    }

    // ── Step 3: Aggregate grades + compute scores ────────────
    const gradesData = await aggregateGrades(schoolId, classId, termId, academicYearId);
    const allReports = computeFinalScores(gradesData, examData, config.assessmentWeights, config.gradingSchema);
    attachDeviations(allReports);

    if (Object.keys(allReports).length === 0) {
      await Batches.updateOne({ id: batchId }, { status: 'failed', failureReason: 'No graded results found', completedAt: now });
      return E.badRequest(res, 'No graded results found for this class/term — nothing to publish');
    }

    // ── Step 4: Rankings ─────────────────────────────────────
    const classInput = Object.values(allReports).map(r => ({
      studentId:  r.studentId,
      totalScore: computeRankingScore(r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects).rankingScore,
    }));
    const classRanks  = rankStudents(classInput, config.rankingMethod);
    const subjectBest = config.showBestPerSubject
      ? bestPerSubject(Object.values(allReports).map(r => ({ studentId: r.studentId, subjects: r.subjects })))
      : {};

    // ── Step 5: Load existing live snapshots (for versioning) ─
    const existingSnaps = await _model('report_card_snapshots').find({
      schoolId, classId,
      termId: termId || null, academicYearId: academicYearId || null,
      superseded: { $ne: true },
    }).lean();
    const existingMap = Object.fromEntries(existingSnaps.map(s => [s.studentId, s]));

    // ── Step 6: Denormalise student info ─────────────────────
    const studentIds = Object.keys(allReports);
    const students   = await _model('students').find({ schoolId,
      $or: [
        { id: { $in: studentIds } },
        { _id: { $in: studentIds.filter(s => /^[0-9a-f]{24}$/i.test(s)) } }
      ]
    }).lean();
    const studentMap = Object.fromEntries(students.map(s => [s.id || s._id.toString(), s]));

    // ── Step 7: Build new snapshots ──────────────────────────
    const newSnaps     = [];
    const supersedeOps = [];
    const partialFails = [];

    for (const r of Object.values(allReports)) {
      try {
        const stu  = studentMap[r.studentId] || {};
        const prev = existingMap[r.studentId];
        const newId = uuidv4();

        const { rankingScore, subjectsUsed } = computeRankingScore(
          r.subjects, config.rankingSubjectStrategy, config.rankingN, config.compulsorySubjects
        );

        const snap = {
          id:             newId,
          version:        prev ? (prev.version || 1) + 1 : 1,
          supersedesId:   prev?.id || null,
          schoolId,
          studentId:      r.studentId,
          studentName:    [stu.firstName, stu.lastName].filter(Boolean).join(' ') || r.studentId,
          admissionNo:    stu.admissionNumber || stu.admissionNo || '',
          classId,        className:   className   || '',
          termId:         termId         || null,  termName:    termName    || '',
          academicYearId: academicYearId || null,  academicYear: academicYear || '',
          schoolName:     schoolName || '',

          // Immutable config snapshot
          gradingSchema:          config.gradingSchema,
          assessmentWeights:      config.assessmentWeights,
          passMark:               config.passMark,
          gradingType:            config.gradingType,
          rankingSubjectStrategy: config.rankingSubjectStrategy,
          rankingN:               config.rankingN,

          // Results
          subjects:     r.subjects,
          totalScore:   r.totalScore,
          averageScore: r.averageScore,
          gpa:          r.gpa,
          subjectCount: r.subjectCount,
          rankingScore,
          rankingSubjectsUsed: subjectsUsed,

          rankings: config.rankingEnabled
            ? mergeRankings(r.studentId, { class: classRanks })
            : {},

          subjectBest: Object.fromEntries(
            Object.entries(subjectBest).map(([sub, winnerId]) => [sub, winnerId === r.studentId])
          ),

          // Carry forward comments from previous version
          comments: prev?.comments || { subjectComments: {}, classTeacherRemark: '', principalRemark: '' },

          attendanceSummary: null,
          financialBlock:    false,
          status:            'published',
          publishedAt:       now,
          publishedBy:       userId,
          batchId,
          superseded:        false,
          moderationBypassed: skipModerationCheck,
          updatedAt:         now,
          updatedBy:         userId,
        };

        newSnaps.push(snap);

        if (prev) {
          supersedeOps.push({
            updateOne: {
              filter: { id: prev.id },
              update: { $set: { superseded: true, supersededAt: now, supersededBy: newId } },
            }
          });
        }
      } catch (snapErr) {
        partialFails.push({ studentId: r.studentId, error: snapErr.message });
      }
    }

    // ── Step 8: Persist (transaction-wrapped when replica set available) ──
    const Snaps = _model('report_card_snapshots');
    const insertOps = newSnaps.map(s => ({ insertOne: { document: s } }));

    let session = null;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await Snaps.bulkWrite(insertOps, { ordered: false, session });
        if (supersedeOps.length) {
          await Snaps.bulkWrite(supersedeOps, { ordered: false, session });
        }
      });
    } catch (txErr) {
      // Code 20 = "Transaction numbers are only allowed on a replica set member or mongos"
      // Standalone MongoDB (dev/test) doesn't support transactions — fall back to non-transactional writes
      if (txErr.code === 20 || txErr.codeName === 'IllegalOperation' || txErr.message?.includes('Transaction')) {
        console.warn('[REPORT-CARDS] Transactions not available (standalone MongoDB) — falling back to non-transactional writes');
        await Snaps.bulkWrite(insertOps, { ordered: false });
        if (supersedeOps.length) {
          await Snaps.bulkWrite(supersedeOps, { ordered: false });
        }
      } else {
        throw txErr;  // Re-throw unexpected errors
      }
    } finally {
      if (session) await session.endSession().catch(() => {});
    }

    // ── Step 9: Mark batch complete (or partial) ─────────────
    const finalStatus = partialFails.length > 0 ? 'partial' : 'completed';
    await Batches.updateOne({ id: batchId }, {
      status:       finalStatus,
      completedAt:  now,
      studentCount: newSnaps.length + partialFails.length,
      successCount: newSnaps.length,
      failedStudents: partialFails,
      newVersions: newSnaps.map(s => ({ snapshotId: s.id, studentId: s.studentId, version: s.version })),
    });

    const response = {
      batchId,
      status:      finalStatus,
      published:   newSnaps.length,
      versioned:   supersedeOps.length,
      failed:      partialFails.length,
      classId,     termId,
      publishedAt: now,
    };

    // Surface bypass warning in response
    if (skipModerationCheck) {
      response.warnings = [`⚠️ Moderation check was bypassed. Reason: "${skipReason}". This action has been logged.`];
    }
    if (partialFails.length) {
      response.warnings = [...(response.warnings || []),
        `${partialFails.length} student(s) failed to snapshot — check publish-batches/${batchId} for details`];
    }

    console.log(`[REPORT-CARDS] Batch ${batchId}: ${newSnaps.length} published (${finalStatus}) by ${userId}`);
    return ok(res, response, null, 201);

  } catch (err) {
    await _model('publish_batches').updateOne({ id: batchId }, {
      status: 'failed', failureReason: err.message, completedAt: new Date().toISOString()
    }).catch(() => {});
    console.error('[report-cards/publish]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /publish-batches
   ══════════════════════════════════════════════════════════════ */
router.get('/publish-batches', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { schoolId };
    if (req.query.classId) filter.classId = req.query.classId;
    if (req.query.termId)  filter.termId  = req.query.termId;
    if (req.query.status)  filter.status  = req.query.status;

    const [docs, total] = await Promise.all([
      _model('publish_batches').find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit)
        .select('-newVersions -__v').lean(),
      _model('publish_batches').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[publish-batches GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /  — list snapshots
   ══════════════════════════════════════════════════════════════ */
router.get('/', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    // Restricted roles can never see superseded versions
    const showHistory = req.query.history === '1' && !RESTRICTED_ROLES.includes(role);
    const filter = { schoolId };
    if (!showHistory) filter.superseded = { $ne: true };

    if (req.query.classId)        filter.classId        = req.query.classId;
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;
    if (req.query.studentId)      filter.studentId      = req.query.studentId;
    if (req.query.status)         filter.status         = req.query.status;

    const [docs, total] = await Promise.all([
      _model('report_card_snapshots').find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit)
        .select('-gradingSchema -assessmentWeights -subjects -__v').lean(),
      _model('report_card_snapshots').countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[report-cards GET]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /:id  — full snapshot
   ══════════════════════════════════════════════════════════════ */
router.get('/:id', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role, userId, guardianOf } = req.jwtUser;
    const doc = await _model('report_card_snapshots')
      .findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Report card snapshot not found');

    // Parents/students cannot access superseded snapshots
    if (doc.superseded && RESTRICTED_ROLES.includes(role)) {
      return E.forbidden(res, 'This report card has been superseded. Please access the latest version.');
    }

    // Guardian/parent: can only view their own linked children's report cards
    if (['parent', 'guardian'].includes(role)) {
      const linkedStudents = Array.isArray(guardianOf) ? guardianOf : [];
      if (!linkedStudents.includes(doc.studentId)) {
        // Log the access attempt for compliance (GDPR/POPIA: failed access to student records)
        _model('mark_audit_log').create({
          action:       'GUARDIAN_ACCESS_DENIED',
          schoolId,
          requestedBy:  userId,
          requestedRole: role,
          targetStudentId: doc.studentId,
          snapshotId:   req.params.id,
          route:        'GET /api/report-cards/:id',
          timestamp:    new Date().toISOString(),
        }).catch(e => console.error('[report-cards] guardian audit log failed:', e.message));
        return E.forbidden(res, 'You are not authorised to view this student\'s report card.');
      }
    }

    return ok(res, doc);
  } catch (err) { console.error('[report-cards GET/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   PUT /:id/comments
   ══════════════════════════════════════════════════════════════ */
router.put('/:id/comments', authMiddleware, PLAN, rbac('grades', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { data, error } = _validate(CommentSchema, req.body);
    if (error) return E.validation(res, error);

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');
    if (snap.superseded) return E.badRequest(res, 'Cannot edit a superseded report card. Use the current version.');

    const now    = new Date().toISOString();
    const merged = { ...(snap.comments || {}) };

    if (data.subjectComments) {
      merged.subjectComments = { ...(merged.subjectComments || {}), ...data.subjectComments };
    }
    if (data.classTeacherRemark != null) {
      merged.classTeacherRemark    = data.classTeacherRemark;
      merged.classTeacherCommentBy = userId;
      merged.classTeacherCommentAt = now;
    }
    if (data.principalRemark != null) {
      if (!['admin', 'superadmin'].includes(role)) return E.forbidden(res, 'Only admins can set the principal remark');
      merged.principalRemark   = data.principalRemark;
      merged.principalRemarkBy = userId;
      merged.principalRemarkAt = now;
    }

    const doc = await _model('report_card_snapshots').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { comments: merged, updatedBy: userId, updatedAt: now } },
      { new: true, runValidators: false }
    ).lean();

    return ok(res, { id: req.params.id, comments: doc.comments });
  } catch (err) { console.error('[report-cards/:id/comments PUT]', err); return E.serverError(res); }
});

/* ── PDF builder (shared between single and bulk) ───────────── */
function _buildPDFPage(doc, snap, config, attendance, isFirstPage) {
  if (!isFirstPage) doc.addPage();

  const PAGE_WIDTH = doc.page.width - 80;
  const GRAY = '#555555', DARK = '#1a1a2e', ACCENT = '#2563eb', LIGHT_GRAY = '#f3f4f6', BORDER = '#d1d5db';
  const COL_GAP = 5;
  const isDraft = snap.status !== 'published' || snap.superseded;

  /* DRAFT WATERMARK */
  if (isDraft) {
    doc.save()
       .translate(doc.page.width / 2, doc.page.height / 2)
       .rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(snap.superseded ? 'SUPERSEDED' : 'DRAFT', -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  /* HEADER */
  doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
  doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
     .text(snap.schoolName || 'School Management System', 50, 52, { width: PAGE_WIDTH - 20 });
  doc.fontSize(9).font('Helvetica')
     .text('ACADEMIC REPORT CARD' + (isDraft ? '   [DRAFT — NOT OFFICIAL]' : ''), 50, 75, { width: PAGE_WIDTH - 20 });
  doc.fillColor(DARK);

  /* STUDENT INFO */
  const infoTop = 115;
  doc.rect(40, infoTop, PAGE_WIDTH, 70).fill(LIGHT_GRAY).stroke(BORDER);
  const c1 = 50, c2 = 280;
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('STUDENT NAME', c1, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(snap.studentName || '—', c1, infoTop + 19, { width: 200 });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ADMISSION NO.', c2, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(snap.admissionNo || '—', c2, infoTop + 19);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('CLASS', c1, infoTop + 42);
  doc.fillColor(DARK).fontSize(10).font('Helvetica').text(snap.className || '—', c1, infoTop + 52);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('TERM / ACADEMIC YEAR', c2, infoTop + 42);
  doc.fillColor(DARK).fontSize(10).font('Helvetica')
     .text([snap.termName, snap.academicYear].filter(Boolean).join(' — ') || '—', c2, infoTop + 52);

  /* VERSION BADGE */
  if (snap.version > 1 || snap.superseded) {
    doc.fillColor(snap.superseded ? '#dc2626' : '#059669').fontSize(8).font('Helvetica-Bold')
       .text(`v${snap.version}${snap.superseded ? ' (Superseded)' : ''}`, PAGE_WIDTH - 40, infoTop + 8, { width: 70, align: 'right' });
  }

  /* MODERATION BYPASS WARNING */
  if (snap.moderationBypassed) {
    const warnY = infoTop + 72;
    doc.rect(40, warnY, PAGE_WIDTH, 14).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(7.5).font('Helvetica-Bold')
       .text('⚠ Published with moderation check bypassed', 44, warnY + 3, { width: PAGE_WIDTH - 8 });
  }

  /* RESULTS TABLE */
  const tableTop  = infoTop + (snap.moderationBypassed ? 88 : 88);
  const colWidths = [175, 52, 52, 58, 42, 48, 88];
  const colLabels = ['Subject', 'Classwork\n(%)', 'Mid-Term\n(%)', 'End-Term\n(%)', 'Score', 'Grade', 'Remarks'];
  const colX = []; let cx = 40;
  for (const w of colWidths) { colX.push(cx); cx += w + COL_GAP; }

  doc.rect(40, tableTop, PAGE_WIDTH, 22).fill(ACCENT);
  doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
  colLabels.forEach((label, i) => {
    doc.text(label, colX[i] + 3, tableTop + 5, { width: colWidths[i] - 3, align: 'center' });
  });

  const weights    = snap.assessmentWeights || config.assessmentWeights;
  const caTypes    = weights.filter(w => !['midterm', 'final'].includes(w.assessmentType)).map(w => w.assessmentType);
  const midTypes   = ['midterm'];
  const finalTypes = ['final'];

  function _pick(breakdown, types) {
    const vals = types.map(t => breakdown?.[t]).filter(v => v != null);
    return vals.length ? (vals.reduce((s, n) => s + n, 0) / vals.length).toFixed(1) : '—';
  }

  let rowY = tableTop + 22;
  const passMark = snap.passMark ?? config.passMark ?? 40;

  Object.entries(snap.subjects || {}).forEach(([subjectId, sub], idx) => {
    const rowH  = 18;
    doc.rect(40, rowY, PAGE_WIDTH, rowH).fill(idx % 2 === 0 ? 'white' : LIGHT_GRAY);

    const failed = sub.finalScore != null && sub.finalScore < passMark;
    const isBest = snap.subjectBest?.[subjectId];
    const isUsed = snap.rankingSubjectsUsed?.includes(subjectId);

    doc.fillColor(failed ? '#dc2626' : DARK).fontSize(8.5).font('Helvetica');
    doc.text(
      (isBest ? '★ ' : '') + subjectId + (isUsed && snap.rankingSubjectStrategy !== 'all' ? ' ●' : ''),
      colX[0] + 3, rowY + 5, { width: colWidths[0] - 3 }
    );
    doc.text(_pick(sub.breakdown, caTypes),    colX[1] + 3, rowY + 5, { width: colWidths[1] - 3, align: 'center' });
    doc.text(_pick(sub.breakdown, midTypes),   colX[2] + 3, rowY + 5, { width: colWidths[2] - 3, align: 'center' });
    doc.text(_pick(sub.breakdown, finalTypes), colX[3] + 3, rowY + 5, { width: colWidths[3] - 3, align: 'center' });
    doc.text(sub.finalScore?.toFixed(1) ?? '—', colX[4] + 3, rowY + 5, { width: colWidths[4] - 3, align: 'center' });
    doc.font('Helvetica-Bold').fillColor(sub.grade ? (failed ? '#dc2626' : ACCENT) : GRAY)
       .text(sub.grade || '—', colX[5] + 3, rowY + 5, { width: colWidths[5] - 3, align: 'center' });
    doc.font('Helvetica').fillColor(GRAY).fontSize(7.5)
       .text(sub.remarks || sub.descriptor || '', colX[6] + 3, rowY + 5, { width: colWidths[6] - 3 });
    rowY += rowH;
  });

  doc.rect(40, tableTop, PAGE_WIDTH, rowY - tableTop).stroke(BORDER);

  if (snap.rankingSubjectStrategy && snap.rankingSubjectStrategy !== 'all') {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(`● Subjects counted toward rank (${snap.rankingSubjectStrategy === 'best_n' ? `Best ${snap.rankingN}` : 'Compulsory only'})`, 40, rowY + 3, { width: PAGE_WIDTH });
    rowY += 12;
  }

  /* SUMMARY */
  rowY += 6;
  doc.rect(40, rowY, PAGE_WIDTH, 28).fill('#eff6ff').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
  doc.text(`Total Score: ${snap.totalScore?.toFixed(1) ?? '—'}`, 50, rowY + 5);
  doc.text(`Average: ${snap.averageScore?.toFixed(1) ?? '—'}%`, 160, rowY + 5);
  if (config.showGPA) doc.text(`GPA: ${snap.gpa?.toFixed(2) ?? '—'}`, 265, rowY + 5);
  if (config.rankingEnabled && snap.rankings?.class) {
    const r = snap.rankings.class;
    doc.fillColor(ACCENT).text(`Class Rank: ${r.rank} / ${r.outOf}`, 355, rowY + 5);
  }
  rowY += 28;

  /* ATTENDANCE */
  if (config.showAttendanceSummary && attendance) {
    rowY += 8;
    doc.rect(40, rowY, PAGE_WIDTH, 26).fill(LIGHT_GRAY).stroke(BORDER);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ATTENDANCE', 50, rowY + 4);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(`Present: ${attendance.daysPresent}   Absent: ${attendance.daysAbsent}   Total Days: ${attendance.totalSchoolDays}` +
             (attendance.percentage != null ? `   Attendance: ${attendance.percentage}%` : ''),
             50, rowY + 14, { width: PAGE_WIDTH - 20 });
    rowY += 26;
  }

  /* COMMENTS */
  const comments = snap.comments || {};
  rowY += 12;
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("CLASS TEACHER'S REMARK:", 40, rowY);
  rowY += 12;
  doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
     .text(comments.classTeacherRemark || '— No remark entered —', 46, rowY + 9, { width: PAGE_WIDTH - 12 });
  rowY += 38;

  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("PRINCIPAL'S COMMENT:", 40, rowY);
  rowY += 12;
  doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
     .text(comments.principalRemark || '— No comment entered —', 46, rowY + 9, { width: PAGE_WIDTH - 12 });
  rowY += 42;

  /* SIGNATURES */
  const sigY = rowY + 8;
  const sigW = (PAGE_WIDTH - 20) / 2;
  doc.moveTo(40, sigY + 20).lineTo(40 + sigW - 10, sigY + 20).stroke(DARK);
  doc.moveTo(40 + sigW + 10, sigY + 20).lineTo(40 + PAGE_WIDTH, sigY + 20).stroke(DARK);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica')
     .text(config.classTeacherSignatureLabel || 'Class Teacher', 40, sigY + 24, { width: sigW })
     .text(config.principalSignatureLabel    || 'Principal',      40 + sigW + 10, sigY + 24, { width: sigW });

  /* FOOTER */
  const footerY = doc.page.height - 55;
  doc.rect(40, footerY, PAGE_WIDTH, 0.5).fill(BORDER);
  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
     .text(config.footerNote || 'This report card is computer-generated.', 40, footerY + 6, { width: PAGE_WIDTH, align: 'center' })
     .text(`Generated: ${new Date().toUTCString()}  |  v${snap.version || 1}  |  Batch: ${snap.batchId || '—'}`, 40, footerY + 18, { width: PAGE_WIDTH, align: 'center' });
}

/* ══════════════════════════════════════════════════════════════
   GET /:id/pdf  — single student PDF
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/pdf', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role, guardianOf, userId } = req.jwtUser;

    const snap = await _model('report_card_snapshots').findOne({ id: req.params.id, schoolId }).lean();
    if (!snap) return E.notFound(res, 'Report card snapshot not found');

    if (snap.superseded && RESTRICTED_ROLES.includes(role)) {
      return E.forbidden(res, 'This report card has been superseded. Please download the latest version.');
    }

    // Guardian/parent: can only download their own linked children's PDFs
    if (['parent', 'guardian'].includes(role)) {
      const linkedStudents = Array.isArray(guardianOf) ? guardianOf : [];
      if (!linkedStudents.includes(snap.studentId)) {
        _model('mark_audit_log').create({
          action:       'GUARDIAN_ACCESS_DENIED',
          schoolId,
          requestedBy:  userId,
          requestedRole: role,
          targetStudentId: snap.studentId,
          snapshotId:   req.params.id,
          route:        'GET /api/report-cards/:id/pdf',
          timestamp:    new Date().toISOString(),
        }).catch(e => console.error('[report-cards/pdf] guardian audit log failed:', e.message));
        return E.forbidden(res, 'You are not authorised to download this student\'s report card.');
      }
    }

    if (snap.financialBlock && req.query.force !== '1' && !['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: 'Download blocked — outstanding fee balance.', financialBlock: true });
    }

    let attData = snap.attendanceSummary;
    if (!attData) {
      attData = await attendanceSummary(schoolId, snap.studentId, snap.classId, snap.termId, snap.academicYearId);
    }
    const config = await _loadConfig(schoolId);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    const doc     = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="report-${snap.studentId}-v${snap.version || 1}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    _buildPDFPage(doc, snap, config, attData, true);
    doc.end();
  } catch (err) { console.error('[report-cards/:id/pdf]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   GET /bulk-pdf  — cursor-streamed class PDF (no giant buffer)
   ══════════════════════════════════════════════════════════════ */
router.get('/bulk-pdf', authMiddleware, PLAN, rbac('grades', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!req.query.classId) return E.badRequest(res, 'classId query parameter is required');

    const filter = {
      schoolId, classId: req.query.classId,
      superseded: { $ne: true }, status: 'published',
    };
    if (req.query.termId)         filter.termId         = req.query.termId;
    if (req.query.academicYearId) filter.academicYearId = req.query.academicYearId;

    const config = await _loadConfig(schoolId);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    // Count first so we can return 404 before sending any headers
    const total = await _model('report_card_snapshots').countDocuments(filter);
    if (total === 0) return E.notFound(res, 'No published report cards found for this class/term');

    // Start streaming response now — headers sent before cursor begins
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-cards-class-${req.query.classId}.pdf"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    const pdfDoc  = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });
    pdfDoc.pipe(res);  // stream directly to response — no giant buffer accumulation

    // Use Mongoose cursor — loads CHUNK_SIZE documents at a time, not all at once
    const CHUNK_SIZE = 10;
    const cursor = _model('report_card_snapshots')
      .find(filter)
      .sort({ studentName: 1 })
      .batchSize(CHUNK_SIZE)
      .cursor();

    let isFirst  = true;
    let chunkBuf = [];

    const processChunk = async (chunk) => {
      const attResults = await Promise.all(
        chunk.map(s => s.attendanceSummary
          ? Promise.resolve(s.attendanceSummary)
          : attendanceSummary(schoolId, s.studentId, s.classId, s.termId, s.academicYearId)
        )
      );
      chunk.forEach((snap, i) => {
        const isAdmin = ['admin', 'superadmin'].includes(role);
        if (snap.financialBlock && req.query.force !== '1' && !isAdmin) return; // skip blocked
        pdfDoc.addPage();
        _buildPDFPage(pdfDoc, snap, config, attResults[i], false);
        isFirst = false;
      });
    };

    // Iterate cursor, accumulate chunks, process when chunk is full
    for await (const snap of cursor) {
      chunkBuf.push(snap);
      if (chunkBuf.length >= CHUNK_SIZE) {
        await processChunk(chunkBuf);
        chunkBuf = [];
      }
    }
    if (chunkBuf.length > 0) await processChunk(chunkBuf);

    pdfDoc.end();
  } catch (err) {
    console.error('[report-cards/bulk-pdf]', err);
    // Headers may already be sent — can't send JSON error; just end the response
    if (!res.headersSent) return E.serverError(res);
    res.end();
  }
});

module.exports = router;
