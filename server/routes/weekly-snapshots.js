/* ============================================================
   Msingi — /api/weekly-snapshots  (staff-facing)

   Read-only surface over the `weekly_snapshots` collection written by
   weekly-snapshot-cron.js. Nothing here ever generates or edits a
   snapshot — this file only serves what the cron already wrote.

     GET /my-classes                     — roster picker (teacher: own
                                            class(es) via formTeacherId;
                                            other staff: every active class)
     GET /:studentId/weeks               — list of generated weeks for a student
     GET /:studentId/:weekStart          — one week's full snapshot
     GET /:studentId/:weekStart/pdf      — the same snapshot, rendered to PDF

   Parent/student self-service access does NOT go through this file —
   per the confirmed architecture, that's parent-portal.js/student-portal.js
   bypassing RBAC entirely (M6), same precedent as every other self-service
   data path in this app.

   Plan: standard | RBAC: weekly_snapshot:read
   ============================================================ */
'use strict';

const express = require('express');

const { authMiddleware }   = require('../middleware/auth');
const { rbac, hasPermission } = require('../middleware/rbac');
const { planGate }         = require('../middleware/plan');
const { moduleGate, isModuleEnabled } = require('../middleware/module-gate');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }             = require('../utils/response');
const { forbiddenForSelfServiceRole } = require('../utils/self-service-scope');

const router  = express.Router();
const PLAN    = planGate('weekly_snapshot');
const MODGATE = moduleGate('weekly_snapshot');

/* Which "extra" roles put someone outside the "plain teacher" narrowing —
   mirrors teaching-assignments.js's _effectiveRoles()/isTeacherOnly pattern. */
const BROAD_STAFF_ROLES = new Set(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy', 'section_head']);

function _effectiveRoles(req) {
  const role       = req.jwtUser?.role       ?? '';
  const roles      = req.jwtUser?.roles      ?? [];
  const extraRoles = req.jwtUser?.extraRoles ?? [];
  return new Set([role, ...roles, ...extraRoles]);
}

/* Strip the medical section unless it's genuinely visible to this
   caller. The cron always captures full medical detail (it can't know
   in advance who will view a given snapshot) — redaction happens here,
   at read time, based on the CURRENT module/permission state, not
   whatever was true when the snapshot was generated. */
async function _redactMedical(req, schoolId, sections) {
  const medicalOn = await isModuleEnabled(schoolId, 'medical');
  if (!medicalOn) return { ...sections, medical: [] };
  const canReadMedical = await hasPermission(req, 'medical', 'read');
  if (!canReadMedical) return { ...sections, medical: [] };
  return sections;
}

/* ── GET /api/weekly-snapshots/my-classes ──────────────────── */
router.get('/my-classes', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const eff = _effectiveRoles(req);
    const isTeacherOnly = eff.has('teacher') && ![...BROAD_STAFF_ROLES].some(r => eff.has(r));

    const filter = { schoolId, status: 'active' };
    if (isTeacherOnly) {
      filter.formTeacherId = req.jwtUser.userId ?? req.jwtUser.id;
    }

    const docs = await tenantModel('classes', tenantContext(req))
      .find(filter).sort({ name: 1 }).select('id name formTeacherId').lean();

    return ok(res, docs);
  } catch (err) {
    console.error('[weekly-snapshots GET /my-classes]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/weekly-snapshots/:studentId/weeks ─────────────── */
router.get('/:studentId/weeks', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId } = req.params;

    const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId })
      .select('id firstName lastName classId className').lean();
    if (!student) return E.notFound(res, 'Student not found');
    if (forbiddenForSelfServiceRole(req, student)) return E.forbidden(res, 'You can only view your own Weekly Snapshots.');

    const weeks = await tenantModel('weekly_snapshots', tenantContext(req))
      .find({ studentId }).sort({ weekStart: -1 })
      .select('weekStart weekEnd generatedAt').lean();

    return ok(res, { student, weeks });
  } catch (err) {
    console.error('[weekly-snapshots GET /:studentId/weeks]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/weekly-snapshots/:studentId/:weekStart ────────── */
router.get('/:studentId/:weekStart', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId, weekStart } = req.params;

    const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId })
      .select('id firstName lastName classId className admissionNumber photo').lean();
    if (!student) return E.notFound(res, 'Student not found');
    if (forbiddenForSelfServiceRole(req, student)) return E.forbidden(res, 'You can only view your own Weekly Snapshots.');

    const snapshot = await tenantModel('weekly_snapshots', tenantContext(req))
      .findOne({ studentId, weekStart }).lean();
    if (!snapshot) return E.notFound(res, 'No snapshot generated for that week');

    const sections = await _redactMedical(req, schoolId, snapshot.sections);
    return ok(res, { student, snapshot: { ...snapshot, sections } });
  } catch (err) {
    console.error('[weekly-snapshots GET /:studentId/:weekStart]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/weekly-snapshots/:studentId/:weekStart/pdf ────── */
router.get('/:studentId/:weekStart/pdf', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { studentId, weekStart } = req.params;

    const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId })
      .select('id firstName lastName classId className admissionNumber').lean();
    if (!student) return E.notFound(res, 'Student not found');
    if (forbiddenForSelfServiceRole(req, student)) return E.forbidden(res, 'You can only view your own Weekly Snapshots.');

    const snapshot = await tenantModel('weekly_snapshots', tenantContext(req))
      .findOne({ studentId, weekStart }).lean();
    if (!snapshot) return E.notFound(res, 'No snapshot generated for that week');

    const sections = await _redactMedical(req, schoolId, snapshot.sections);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    const pdfDoc  = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers = [];
    pdfDoc.on('data', chunk => buffers.push(chunk));
    pdfDoc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="weekly-snapshot-${student.id}-${weekStart}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    _buildSnapshotPDF(pdfDoc, snapshot, student, sections);
    pdfDoc.end();
  } catch (err) {
    console.error('[weekly-snapshots GET /:studentId/:weekStart/pdf]', err);
    return E.serverError(res);
  }
});

/* ── PDF rendering — renders from the STORED sections payload only,
   never live recomputation, so the PDF always matches what the reader
   sees on screen (and what was already emailed/notified). ──────── */
function _buildSnapshotPDF(doc, snapshot, student, sections) {
  const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ');

  doc.fontSize(18).text('Weekly Student Snapshot', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#555')
    .text(`${studentName}  ·  ${student.className || ''}`, { align: 'center' })
    .text(`Week of ${snapshot.weekStart} – ${snapshot.weekEnd}`, { align: 'center' });
  doc.fillColor('#000').moveDown(1);

  const section = (title, renderBody) => {
    doc.fontSize(13).fillColor('#1a1a1a').text(title, { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    renderBody();
    doc.fillColor('#000').moveDown(0.8);
  };

  section('Topics Covered', () => {
    if (!sections.topics.length) return doc.text('No topics recorded this week.');
    for (const t of sections.topics) {
      doc.text(`• ${t.subjectName}: ${t.topicTitle}${t.subtopicTitle ? ' — ' + t.subtopicTitle : ''}  (${t.coveredAt}, ${t.teacherName})`);
    }
  });

  section('Assignments & Scores', () => {
    if (!sections.assignments.length) return doc.text('No assessments recorded this week.');
    for (const a of sections.assignments) {
      doc.text(`• ${a.assessmentType} #${a.instance}: ${a.rawScore}/100${a.label ? ' (' + a.label + ')' : ''}`);
    }
  });

  section('Attendance', () => {
    const at = sections.attendance;
    doc.text(`Present: ${at.present}  ·  Absent: ${at.absent}  ·  Late: ${at.late}  ·  Authorised: ${at.authorisedAbsence}  ·  Total marked: ${at.total}`);
  });

  section('Behaviour', () => {
    if (!sections.behaviour.length) return doc.text('No behaviour records this week.');
    for (const b of sections.behaviour) {
      doc.text(`• [${b.type}] ${b.itemLabel} (${b.category}) — ${b.points > 0 ? '+' : ''}${b.points} pts, ${b.date}`);
    }
  });

  if (sections.medical) {
    section('Medical', () => {
      if (!sections.medical.length) return doc.text('No clinic visits this week.');
      for (const m of sections.medical) {
        doc.text(`• ${m.date}: ${m.complaint}${m.sentHome ? ' (sent home)' : ''}${m.referred ? ' (referred)' : ''}`);
      }
    });
  }

  section('Library', () => {
    if (!sections.library.length) return doc.text('No library activity this week.');
    for (const l of sections.library) {
      doc.text(`• "${l.bookTitle}" — issued ${l.issuedAt?.slice(0, 10) || '—'}, due ${l.dueDate}, status: ${l.status}`);
    }
  });

  section('Growth & Achievements', () => {
    if (!sections.growth.length) return doc.text('No new growth records this week.');
    for (const g of sections.growth) {
      doc.text(`• ${g.title}${g.category ? ' (' + g.category + ')' : ''}`);
    }
  });

  doc.moveDown(1).fontSize(8).fillColor('#999')
    .text(`Generated ${snapshot.generatedAt} · Timezone: ${snapshot.schoolTimezone}`, { align: 'center' });
}

module.exports = router;
