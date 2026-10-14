/* ============================================================
   Msingi — Elective groups (Markbook, Comments, Submissions)

   A subject that is not compulsory for a class (class_subjects.
   isCompulsoryForClass === false) is an elective. Its students can come
   from every stream of the class, so the group is not a stream:

     • Roster    = the class's students enrolled in that subject
                   (student_subjects), across all streams.
     • Teaching  = any teaching_assignments row for the teacher, class and
                   subject, whatever stream it names. The group spans streams.
     • Marks and subject comments are only written for enrolled students.
     • Submissions are per class and subject, with no stream
                   (streamId null), and cover only the enrolled students.

   Compulsory subjects keep the stream rule unchanged (see subject-scope.js).
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');
const { isManagement } = require('./subject-scope');

/** True when this subject is an elective for this class. */
async function isElective(req, classId, subjectId) {
  const { schoolId } = req.jwtUser;
  const row = await tenantModel('class_subjects', tenantContext(req))
    .findOne({ schoolId, classId, subjectId }).select('isCompulsoryForClass').lean();
  return !!row && row.isCompulsoryForClass === false;
}

/* Reported directly (2026-10-15): logged in as admin, picking a class then
   a subject that the class's curriculum never offered, the roster still
   loaded (the whole class) and marks could be entered for it — "I can
   enter marks for a subject no student is enrolled for." Root cause:
   `isElective` above returns false both for a genuinely compulsory
   subject AND for a subject with NO class_subjects row at all — every
   caller branches on that boolean and falls into the "compulsory,
   whole-class, no enrollment check" path either way, so a subject never
   added to this class's curriculum was silently treated exactly like one
   that was. Worse for an admin/management caller specifically: `canWriteSubject`
   /`canTeachElective` bypass ALL checks for management roles (by design —
   they don't need a teaching_assignments row), so nothing else in the
   write path ever asked "does this class even teach this subject at
   all?" This is a curriculum-integrity question, not a who's-assigned
   question, so it applies to every role, management included. */

/** True when this subject has ANY class_subjects link for this class —
 * compulsory or elective, doesn't matter which. False means the class's
 * curriculum never added this subject at all. */
async function isInCurriculum(req, classId, subjectId) {
  const { schoolId } = req.jwtUser;
  const row = await tenantModel('class_subjects', tenantContext(req))
    .findOne({ schoolId, classId, subjectId }).select('id').lean();
  return !!row;
}

/** Same check for a batch of distinct {classId, subjectId} pairs in one
 * query. Returns the subset of `pairs` that have NO class_subjects link —
 * i.e. the subject was never added to that class's curriculum. */
async function pairsNotInCurriculum(req, pairs) {
  if (pairs.length === 0) return [];
  const { schoolId } = req.jwtUser;
  const linked = await tenantModel('class_subjects', tenantContext(req))
    .find({
      schoolId,
      $or: pairs.map(({ classId, subjectId }) => ({ classId, subjectId })),
    })
    .select('classId subjectId').lean();
  const linkedKeys = new Set(linked.map(l => `${l.classId}::${l.subjectId}`));
  return pairs.filter(p => !linkedKeys.has(`${p.classId}::${p.subjectId}`));
}

/** Student ids enrolled in this subject, across all classes and streams. */
async function enrolledStudentIds(req, subjectId) {
  const { schoolId } = req.jwtUser;
  const rows = await tenantModel('student_subjects', tenantContext(req))
    .find({ schoolId, subjectId }).select('studentId').lean();
  return new Set(rows.map(r => r.studentId));
}

/**
 * Whether the caller may write marks or comments for an elective. Management
 * keeps its bypass. Anyone else needs a teaching assignment for this class and
 * subject, in any stream, since the group spans streams.
 */
async function canTeachElective(req, classId, subjectId) {
  if (isManagement(req)) return true;
  const { schoolId, userId } = req.jwtUser;
  const doc = await tenantModel('teaching_assignments', tenantContext(req))
    .findOne({ schoolId, teacherId: userId, classId, subjectId }).select('id').lean();
  return !!doc;
}

/**
 * Checks the marks in a batch that belong to elective subjects. Returns an
 * error message, or null when every elective mark is allowed. Compulsory marks
 * are not checked here; the stream rule still applies to them.
 *
 * @param {{classId:string, subjectId:string, studentId:string}[]} marks
 */
async function electiveMarkProblem(req, marks) {
  const pairs = [...new Map(marks.map(m => [`${m.classId}::${m.subjectId}`, { classId: m.classId, subjectId: m.subjectId }])).values()];
  for (const { classId, subjectId } of pairs) {
    if (!(await isElective(req, classId, subjectId))) continue;
    if (!(await canTeachElective(req, classId, subjectId))) {
      return `You are not assigned to teach ${subjectId} in this class.`;
    }
    const enrolled = await enrolledStudentIds(req, subjectId);
    const outsiders = [...new Set(marks
      .filter(m => m.classId === classId && m.subjectId === subjectId && !enrolled.has(m.studentId))
      .map(m => m.studentId))];
    if (outsiders.length) {
      return `${outsiders.length} student${outsiders.length === 1 ? '' : 's'} not enrolled in this elective — enrol them in the subject first.`;
    }
  }
  return null;
}

module.exports = { isElective, isInCurriculum, pairsNotInCurriculum, enrolledStudentIds, canTeachElective, electiveMarkProblem };
