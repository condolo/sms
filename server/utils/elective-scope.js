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

module.exports = { isElective, enrolledStudentIds, canTeachElective, electiveMarkProblem };
