/* ============================================================
   Msingi — Report comment rights (Markbook comments)

   Rules, as decided 2026-10-11 (revised from 2026-10-05):

   • Subject teacher comment (per student, per subject, per term):
     same rights as marks — the caller needs a teaching_assignments row
     for {class, subject, stream} (canWriteSubject). Management roles keep
     the bypass they have for marks. Does NOT apply to a Kindergarten/
     competency-band class (resolveRcTemplate(schoolId, classId) truthy) —
     decided 2026-10-13: KG report cards show only the class teacher's
     remark, never a per-subject one (_computeKgReportSections in
     report-cards.js never reads subjectComments), so the write route
     (PUT /draft-comments/:studentId/subject/:subjectId) rejects it
     outright for a KG class rather than accepting data nothing ever
     displays.

   • Class teacher remark (per student, per term):
     only the stream's form teacher (streams.formTeacherId), and only for
     the streams they are assigned. Assigning someone a stream as form
     teacher gives them that stream's remarks — not the whole class.
     Management roles keep the bypass.

   • Principal remark: admin / superadmin only (same as the snapshot route).

   • Lock: none. A subject's comment used to lock together with that
     subject's mark submission (submitted/approved/locked) — reported
     directly as unworkable: a teacher must be able to submit marks then
     write the comment afterward, or write the comment first and submit
     marks later, in either order, without one blocking the other.
     Removed entirely (commentLockState, 2026-10-05, is gone) rather than
     narrowed, per that explicit instruction — nothing about marks status,
     submission state, or the assessment-schedule lock blocks a comment
     write any more. The only remaining freeze is report publish itself:
     once published, the snapshot is immutable regardless of later draft
     edits (a later re-publish picks up the new text, same as always).

   • Read: management sees everything. Anyone else sees the full draft
     for streams they form-tutor, and for every other stream only the
     subject comments of the subjects they teach in that stream.
     Nothing else (no class/principal remark, no ratings) leaks out.
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');
const { resolveHomeroomStreamIds } = require('./scopeEngine');
const { isManagement } = require('./subject-scope');
const { hasPermission } = require('../middleware/rbac');

/* Reported directly: a role (e.g. exams_officer) explicitly granted full
   report_cards access via Settings' Role Permissions editor — "assigned
   full access to exam and report card" — still saw every draft comment
   filtered out, because this file's bypass only ever checked a hardcoded
   MANAGEMENT_ROLES list (subject-scope.js), completely independent of
   what the school actually granted. Someone outside that list with zero
   rows in teaching_assignments (not a classroom teacher at all, like an
   exams officer) fell through to the per-subject-taught filter below,
   which found nothing to show them — not "fewer comments", literally
   every doc dropped. Checking the real report_cards grant here means a
   role an admin has genuinely given full report-card access reads
   comments like management does, without widening MANAGEMENT_ROLES
   itself (which also gates assessment-mark-entry bypasses elsewhere —
   out of scope for this fix). */
async function _hasElevatedReportCardAccess(req) {
  return isManagement(req) || (await hasPermission(req, 'report_cards', 'update'));
}

/** The student's class and stream — the unit every comment right is scoped to. */
async function studentPlacement(req, studentId) {
  const { schoolId } = req.jwtUser;
  const s = await tenantModel('students', tenantContext(req))
    .findOne({ schoolId, id: studentId }).select('id classId streamId').lean();
  return s ? { classId: s.classId ?? null, streamId: s.streamId ?? null } : null;
}

/** Whether the caller may write the class teacher remark for a student in this stream. */
async function canWriteClassRemark(req, streamId) {
  if (await _hasElevatedReportCardAccess(req)) return true;
  if (!streamId) return false;
  const formStreamIds = await resolveHomeroomStreamIds(req);
  return formStreamIds.includes(streamId);
}

/**
 * Filters a list of draft comment docs down to what this caller may read.
 * Management gets everything. Form tutors get the full doc for their own
 * streams. For any other stream the caller gets only the subject comments
 * of the subjects they teach there, nothing else.
 */
async function scopeDraftCommentsForCaller(req, docs) {
  if (await _hasElevatedReportCardAccess(req)) return docs;
  const { schoolId, userId } = req.jwtUser;
  const formStreamIds = new Set(await resolveHomeroomStreamIds(req));

  const studentIds = [...new Set(docs.map(d => d.studentId))];
  const students = studentIds.length
    ? await tenantModel('students', tenantContext(req))
        .find({ schoolId, id: { $in: studentIds } }).select('id streamId').lean()
    : [];
  const streamByStudent = Object.fromEntries(students.map(s => [s.id, s.streamId ?? null]));

  const classIds = [...new Set(docs.map(d => d.classId).filter(Boolean))];
  const assignments = classIds.length
    ? await tenantModel('teaching_assignments', tenantContext(req))
        .find({ schoolId, teacherId: userId, classId: { $in: classIds } })
        .select('classId subjectId streamId').lean()
    : [];

  const electiveRows = classIds.length
    ? await tenantModel('class_subjects', tenantContext(req))
        .find({ schoolId, classId: { $in: classIds }, isCompulsoryForClass: false }).select('classId subjectId').lean()
    : [];
  const electiveKeys = new Set(electiveRows.map(r => `${r.classId}::${r.subjectId}`));

  const out = [];
  for (const doc of docs) {
    const streamId = streamByStudent[doc.studentId] ?? null;
    if (streamId && formStreamIds.has(streamId)) { out.push(doc); continue; }

    const subjectComments = {};
    for (const [subjectId, text] of Object.entries(doc.subjectComments || {})) {
      // An elective is one group across streams: an assignment in any stream counts.
      const elective = electiveKeys.has(`${doc.classId}::${subjectId}`);
      const taught = assignments.some(a =>
        a.classId === doc.classId && a.subjectId === subjectId &&
        (elective || !a.streamId || (streamId && a.streamId === streamId)));
      if (taught) subjectComments[subjectId] = text;
    }
    if (Object.keys(subjectComments).length === 0) continue;
    out.push({
      schoolId: doc.schoolId, studentId: doc.studentId, classId: doc.classId,
      termNumber: doc.termNumber, subjectComments,
    });
  }
  return out;
}

module.exports = {
  studentPlacement, canWriteClassRemark, scopeDraftCommentsForCaller,
};
