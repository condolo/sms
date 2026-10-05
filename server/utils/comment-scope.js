/* ============================================================
   Msingi — Report comment rights (Markbook comments)

   Rules, as decided 2026-10-05:

   • Subject teacher comment (per student, per subject, per term):
     same rights as marks — the caller needs a teaching_assignments row
     for {class, subject, stream} (canWriteSubject). Management roles keep
     the bypass they have for marks.

   • Class teacher remark (per student, per term):
     only the stream's form teacher (streams.formTeacherId), and only for
     the streams they are assigned. Assigning someone a stream as form
     teacher gives them that stream's remarks — not the whole class.
     Management roles keep the bypass.

   • Principal remark: admin / superadmin only (same as the snapshot route).

   • Lock: a subject's comments lock together with that subject's mark
     submission for the class and term (submitted, approved or locked).
     Management roles can still edit a locked comment, and every such
     edit is audited, so the override is visible rather than silent.

   • Read: management sees everything. Anyone else sees the full draft
     for streams they form-tutor, and for every other stream only the
     subject comments of the subjects they teach in that stream.
     Nothing else (no class/principal remark, no ratings) leaks out.
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');
const { resolveHomeroomStreamIds } = require('./scopeEngine');
const { isManagement } = require('./subject-scope');

const LOCKING_SUBMISSION_STATUSES = ['submitted', 'approved', 'locked'];

/** The student's class and stream — the unit every comment right is scoped to. */
async function studentPlacement(req, studentId) {
  const { schoolId } = req.jwtUser;
  const s = await tenantModel('students', tenantContext(req))
    .findOne({ schoolId, id: studentId }).select('id classId streamId').lean();
  return s ? { classId: s.classId ?? null, streamId: s.streamId ?? null } : null;
}

/** Whether the caller may write the class teacher remark for a student in this stream. */
async function canWriteClassRemark(req, streamId) {
  if (isManagement(req)) return true;
  if (!streamId) return false;
  const formStreamIds = await resolveHomeroomStreamIds(req);
  return formStreamIds.includes(streamId);
}

/**
 * Locked when a mark submission for this class, subject, term and the
 * student's stream is submitted, approved or locked. A legacy whole-class
 * submission (no streamId) also locks it. Returns { locked, status }, where
 * status is the most advanced matching status, for the error message.
 */
async function commentLockState(req, classId, subjectId, termNumber, streamId) {
  const { schoolId } = req.jwtUser;
  const subs = await tenantModel('mark_submissions', tenantContext(req))
    .find({
      schoolId, classId, subjectId, termNumber: Number(termNumber),
      status: { $in: LOCKING_SUBMISSION_STATUSES },
      streamId: { $in: [streamId ?? null, null] },
    })
    .select('status').lean();
  if (subs.length === 0) return { locked: false, status: null };
  const rank = { submitted: 1, approved: 2, locked: 3 };
  const status = subs.reduce((best, s) => (rank[s.status] > rank[best] ? s.status : best), subs[0].status);
  return { locked: true, status };
}

/**
 * Filters a list of draft comment docs down to what this caller may read.
 * Management gets everything. Form tutors get the full doc for their own
 * streams. For any other stream the caller gets only the subject comments
 * of the subjects they teach there, nothing else.
 */
async function scopeDraftCommentsForCaller(req, docs) {
  if (isManagement(req)) return docs;
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
  studentPlacement, canWriteClassRemark, commentLockState, scopeDraftCommentsForCaller,
  LOCKING_SUBMISSION_STATUSES,
};
