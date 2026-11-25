/* ============================================================
   Msingi — /api/weekly-snapshots  (staff-facing)

   Read-only surface over the `weekly_snapshots` collection written by
   weekly-snapshot-cron.js — plus one deliberate admin write to rebuild a
   week after a data correction (POST /regenerate, see its own comment).

     GET  /my-classes                     — roster picker (teacher: own
                                             class(es) via formTeacherId;
                                             other staff: every active class)
     GET  /:studentId/weeks               — list of generated weeks for a student
     GET  /:studentId/:weekStart          — one week's full snapshot
     GET  /:studentId/:weekStart/pdf      — the same snapshot, rendered to PDF
     POST /regenerate                     — rebuild one week (admin, no notifications)

   Parent/student self-service access does NOT go through this file —
   per the confirmed architecture, that's parent-portal.js/student-portal.js
   bypassing RBAC entirely (M6), same precedent as every other self-service
   data path in this app.

   Plan: standard | RBAC: weekly_snapshot:read
   ============================================================ */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }   = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine = require('../utils/scopeEngine');
const { canMedical } = require('../utils/medical-access');
const { planGate }         = require('../middleware/plan');
const { moduleGate, isModuleEnabled } = require('../middleware/module-gate');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }             = require('../utils/response');
const { forbiddenForSelfServiceRole } = require('../utils/self-service-scope');
const { resolveHomeroomStreamIds } = require('../utils/scopeEngine');
const { buildSnapshotsForSchool, fetchActiveRoster } = require('../utils/weekly-snapshot-aggregate');
const { _model } = require('../utils/model');

const router  = express.Router();
const PLAN    = planGate('weekly_snapshot');
const MODGATE = moduleGate('weekly_snapshot');

/* Which "extra" roles put someone outside the "plain teacher" narrowing —
   mirrors teaching-assignments.js's _effectiveRoles()/isTeacherOnly pattern. */
// 'acting_deputy'/'head_of_school' are teacher.extraRoles responsibility
// tags (see server/config/staffResponsibilities.js), not real account
// roles — listed explicitly alongside the real role keys so a teacher
// tagged with that responsibility keeps the same broad snapshot
// visibility as before those tag values were renamed off of the exact
// strings SYSTEM_ROLES uses.
const BROAD_STAFF_ROLES = new Set(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy', 'section_head', 'acting_deputy', 'head_of_school']);

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
  // View Clinic Visits, not the combined grant: Alerts alone is not enough (v5.285.0).
  if (!(await canMedical(req, 'view', 'read'))) return { ...sections, medical: [] };
  return sections;
}

/* ══════════════════════════════════════════════════════════════
   Shared read logic — the ONE place that looks up a student, checks
   self-service ownership, and reads weekly_snapshots. Called by this
   file's own staff-facing routes below AND by parent-portal.js /
   student-portal.js's self-service routes (M6), so the two access
   paths (RBAC-gated staff vs. RBAC-bypassed parent/student) never risk
   drifting into two independent implementations of the same read.
   Each returns { error: 'not_found' | 'forbidden' } on failure so the
   caller's route handler decides the exact E.* response — these
   helpers never touch `res` directly (except streamSnapshotPdf, which
   owns the whole PDF response by necessity).
   ══════════════════════════════════════════════════════════════ */
/* A teacher opens only their own students' snapshots (v5.285.0): their own
   classes (data visibility in Settings) or a class they are form teacher in,
   the classes /my-classes lists. It listed only those but opened any student.
   The portals call the same helpers for their own child and are not affected. */
async function _teacherMaySee(req, student) {
  const eff = _effectiveRoles(req);
  if (!eff.has('teacher') || [...BROAD_STAFF_ROLES].some(r => eff.has(r))) return true;
  if (['parent', 'guardian', 'student'].includes(req.jwtUser?.role)) return true;   // checked above
  const { schoolId } = req.jwtUser;
  if (!req.scope) return true;   // this teacher's role sees the whole school
  const filter = { schoolId, id: student.id };
  ScopeEngine.applyToFilter(req, 'students', filter);
  if (await tenantModel('students', tenantContext(req)).findOne(filter).select('id').lean()) return true;
  const homeroom = await resolveHomeroomStreamIds(req);
  if (!homeroom.length || !student.classId) return false;
  return !!(await tenantModel('streams', tenantContext(req)).findOne({ schoolId, id: { $in: homeroom }, classId: student.classId }).select('id').lean());
}

async function _findAuthorizedStudent(req, studentId, selectFields) {
  const { schoolId } = req.jwtUser;
  const student = await tenantModel('students', tenantContext(req)).findOne({ id: studentId, schoolId })
    .select(selectFields).lean();
  if (!student) return { error: 'not_found' };
  if (forbiddenForSelfServiceRole(req, student)) return { error: 'forbidden' };
  if (!(await _teacherMaySee(req, student))) return { error: 'forbidden' };
  return { student };
}

async function getWeeksForStudent(req, studentId) {
  const { student, error } = await _findAuthorizedStudent(req, studentId, 'id firstName lastName classId className');
  if (error) return { error };

  const weeks = await tenantModel('weekly_snapshots', tenantContext(req))
    .find({ studentId }).sort({ weekStart: -1 })
    .select('weekStart weekEnd generatedAt').lean();

  return { student, weeks };
}

async function getSnapshotDetail(req, studentId, weekStart) {
  const { student, error } = await _findAuthorizedStudent(req, studentId, 'id firstName lastName classId className admissionNumber photo');
  if (error) return { error };

  const { schoolId } = req.jwtUser;
  const snapshot = await tenantModel('weekly_snapshots', tenantContext(req)).findOne({ studentId, weekStart }).lean();
  if (!snapshot) return { error: 'not_found' };

  const sections = await _redactMedical(req, schoolId, snapshot.sections);
  return { student, snapshot: { ...snapshot, sections } };
}

async function streamSnapshotPdf(req, res, studentId, weekStart) {
  const result = await getSnapshotDetail(req, studentId, weekStart);
  if (result.error === 'not_found') return E.notFound(res, 'No snapshot generated for that week');
  if (result.error === 'forbidden') return E.forbidden(res, 'You can only view Weekly Snapshots of your own students.');
  const { student, snapshot } = result;

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

  _buildSnapshotPDF(pdfDoc, snapshot, student, snapshot.sections);
  pdfDoc.end();
}

/* ── GET /api/weekly-snapshots/my-classes ──────────────────── */
router.get('/my-classes', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const eff = _effectiveRoles(req);
    const isTeacherOnly = eff.has('teacher') && ![...BROAD_STAFF_ROLES].some(r => eff.has(r));

    const filter = { schoolId, status: 'active' };
    if (isTeacherOnly) {
      // Form/assistant teacher lives on the STREAM (resolveHomeroomStreamIds
      // already covers both, by the real teachers-collection id, not the
      // userId this filter used to compare formTeacherId against directly
      // — classes.formTeacherId is also a legacy, never-written field, so
      // this fell through to zero classes for every teacher before this
      // fix, fixed while adding assistant/co-homeroom support 2026-10-29).
      const homeroomStreamIds = await resolveHomeroomStreamIds(req);
      if (!homeroomStreamIds.length) return ok(res, []);
      const homeroomStreams = await tenantModel('streams', tenantContext(req))
        .find({ schoolId, id: { $in: homeroomStreamIds } }).select('classId').lean();
      const classIds = [...new Set(homeroomStreams.map(s => s.classId).filter(Boolean))];
      filter.id = { $in: classIds };
    }

    const docs = await tenantModel('classes', tenantContext(req))
      .find(filter).sort({ name: 1 }).select('id name').lean();

    return ok(res, docs);
  } catch (err) {
    console.error('[weekly-snapshots GET /my-classes]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/weekly-snapshots/:studentId/weeks ─────────────── */
router.get('/:studentId/weeks', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const result = await getWeeksForStudent(req, req.params.studentId);
    if (result.error === 'not_found') return E.notFound(res, 'Student not found');
    if (result.error === 'forbidden') return E.forbidden(res, 'You can only view Weekly Snapshots of your own students.');
    return ok(res, result);
  } catch (err) {
    console.error('[weekly-snapshots GET /:studentId/weeks]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/weekly-snapshots/:studentId/:weekStart ────────── */
router.get('/:studentId/:weekStart', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), scopeMiddleware, async (req, res) => {
  try {
    const result = await getSnapshotDetail(req, req.params.studentId, req.params.weekStart);
    if (result.error === 'not_found') return E.notFound(res, 'No snapshot generated for that week');
    if (result.error === 'forbidden') return E.forbidden(res, 'You can only view Weekly Snapshots of your own students.');
    return ok(res, result);
  } catch (err) {
    console.error('[weekly-snapshots GET /:studentId/:weekStart]', err);
    return E.serverError(res);
  }
});

/* ── GET /api/weekly-snapshots/:studentId/:weekStart/pdf ────── */
router.get('/:studentId/:weekStart/pdf', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'read'), scopeMiddleware, async (req, res) => {
  try {
    await streamSnapshotPdf(req, res, req.params.studentId, req.params.weekStart);
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

/* ══════════════════════════════════════════════════════════════
   POST /api/weekly-snapshots/regenerate
   Rebuild one week's frozen snapshots after a data correction (a
   mis-grouped lesson-coverage row, a mark filed late, a class change).

   The cron only fills students with no snapshot yet (`already-generated`
   otherwise), so a frozen week can never pick up corrected source data.
   This is the one write on an otherwise read-only surface: gated by
   weekly_snapshot:create (admin/management), deleting only the rows it is
   about to rebuild. It deliberately does NOT re-send guardian
   notifications — a correction, not a new week.

   Body/query: { weekStart?: 'YYYY-MM-DD', classId?: string }
   ══════════════════════════════════════════════════════════════ */
router.post('/regenerate', authMiddleware, PLAN, MODGATE, rbac('weekly_snapshot', 'create'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const classId = String(req.body?.classId ?? req.query.classId ?? '').trim() || null;

    const asked = String(req.body?.weekStart ?? req.query.weekStart ?? '').trim();
    if (asked && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
      return E.validation(res, [{ field: 'weekStart', message: 'weekStart must be YYYY-MM-DD.' }]);
    }

    const school = await _model('schools').findOne({ id: schoolId }).select('id timezone').lean();
    if (!school) return E.notFound(res, 'School not found.');

    const timezone = school.timezone || 'Africa/Nairobi';
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    const weekStart = asked || _mondayOf(todayLocal);
    const weekEnd = _addDaysToDateStr(weekStart, 6);

    const ctx = { schoolId };
    const all = await fetchActiveRoster(ctx);
    const roster = classId ? all.filter(s => s.classId === classId) : all;
    if (!roster.length) {
      return ok(res, { weekStart, weekEnd, generated: 0, replaced: 0, message: 'No active students to snapshot.' });
    }

    const sectionsByStudent = await buildSnapshotsForSchool(ctx, weekStart, weekEnd, timezone, roster);
    const Snapshots = tenantModel('weekly_snapshots', ctx);
    const filter = { schoolId, weekStart, ...(classId ? { classId } : {}) };
    const { deletedCount } = await Snapshots.deleteMany(filter);

    const generatedAt = new Date().toISOString();
    let generated = 0;
    for (const s of roster) {
      try {
        await Snapshots.create({
          id: uuidv4(), schoolId, studentId: s.id,
          classId: s.classId ?? null, className: s.className ?? null,
          weekStart, weekEnd, generatedAt, schoolTimezone: timezone,
          sections: sectionsByStudent.get(s.id) ?? _emptySnapshotSections(),
          notified: { emailSentAt: null, inAppSentAt: null, emailError: null },
        });
        generated++;
      } catch (err) {
        console.error(`[weekly-snapshots regenerate] student ${s.id}:`, err.message);
      }
    }
    return ok(res, { weekStart, weekEnd, generated, replaced: deletedCount ?? 0 });
  } catch (err) {
    console.error('[weekly-snapshots POST /regenerate]', err);
    return E.serverError(res);
  }
});

function _mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const delta = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}

function _addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function _emptySnapshotSections() {
  return {
    topics: [], assignments: [],
    attendance: { present: 0, absent: 0, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0, total: 0, records: [] },
    behaviour: [], medical: [], library: [], growth: [],
  };
}

// Exposed for parent-portal.js / student-portal.js's self-service routes
// (M6) — see the header comment on _findAuthorizedStudent above for why
// this is a shared implementation rather than two independent copies.
// Same convention as onboard.js's router._defaultPerms attachment.
router._helpers = { getWeeksForStudent, getSnapshotDetail, streamSnapshotPdf };
module.exports = router;
// test-only access — Role Architecture Audit 2026-08.
module.exports._effectiveRoles = _effectiveRoles;
