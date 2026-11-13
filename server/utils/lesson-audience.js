/* ============================================================
   Msingi — who a timetable lesson is for, and who teaches it (v5.270.0)

   One place for the rules every lesson reader needs (portals, teacher
   views, cover, reminders, warnings, clash checks, the generator):

   Audience of a lesson (in its class):
     streamIds: [s1, s2]   streams taught together (combined), else
     streamId:  s1         one stream, else
     neither               the whole class
   "Neither" is matched as streamId null OR missing — generated lessons
   store null; older ones leave it out. (Before v5.270.0 the portals
   matched only "missing", so whole-class lessons saved with null were
   invisible to students in classes with streams.)

   Teachers of a lesson: teacherId plus coTeacherIds (co-teaching).

   Option (elective) lessons: a class's elective subject is shown to a
   student only if they are enrolled in it (student_subjects).
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

/** The streams a lesson is for, or null for the whole class. */
function lessonStreams(l) {
  if (Array.isArray(l?.streamIds) && l.streamIds.length) return l.streamIds.map(String);
  return l?.streamId ? [String(l.streamId)] : null;
}

/** All teacher ids on a lesson (main teacher first). */
function lessonTeacherIds(l) {
  return [...new Set([l?.teacherId, ...(Array.isArray(l?.coTeacherIds) ? l.coTeacherIds : [])].filter(Boolean).map(String))];
}

/** Do two lessons of the same class share any students' time (ignoring electives)? */
function audiencesOverlap(a, b) {
  const sa = lessonStreams(a);
  const sb = lessonStreams(b);
  if (!sa || !sb) return true;
  return sa.some(s => sb.includes(s));
}

/** A whole-class lesson: no stream, no combined streams. */
const WHOLE_CLASS = {
  $and: [
    { $or: [{ streamId: null }, { streamId: '' }] },
    { $or: [{ streamIds: { $exists: false } }, { streamIds: null }, { streamIds: { $size: 0 } }] },
  ],
};

/** `$or` array: lessons a student of this stream attends (whole-class, own stream, or combined incl. own stream). */
function studentStreamOr(streamId) {
  return streamId ? [{ streamId }, { streamIds: streamId }, WHOLE_CLASS] : [WHOLE_CLASS];
}

/** Filter clause: lessons any of these teacher ids teaches (main or co-teacher). */
function teacherLessonClause(teacherIds) {
  const ids = [...new Set((teacherIds || []).filter(Boolean).map(String))];
  return { $or: [{ teacherId: { $in: ids } }, { coTeacherIds: { $in: ids } }] };
}

/**
 * Drop option lessons the student doesn't take. A lesson whose subject is an
 * elective of the student's class is kept only if the student is enrolled in
 * it. Everything else is kept.
 */
async function filterElectivesForStudent(ctx, schoolId, student, lessons) {
  if (!lessons.length || !student?.classId) return lessons;
  const classForms = [...new Set([student.classId].filter(Boolean).map(String))];
  const electives = await tenantModel('class_subjects', ctx)
    .find({ schoolId, classId: { $in: classForms }, isCompulsoryForClass: false }).select('subjectId').lean();
  if (!electives.length) return lessons;
  const electiveIds = new Set(electives.map(e => String(e.subjectId)));
  if (!lessons.some(l => l.subjectId && electiveIds.has(String(l.subjectId)))) return lessons;
  const studentId = student.id || String(student._id);
  const mine = await tenantModel('student_subjects', ctx)
    .find({ schoolId, studentId, subjectId: { $in: [...electiveIds] } }).select('subjectId').lean();
  const takes = new Set(mine.map(m => String(m.subjectId)));
  return lessons.filter(l => !l.subjectId || !electiveIds.has(String(l.subjectId)) || takes.has(String(l.subjectId)));
}

module.exports = {
  lessonStreams, lessonTeacherIds, audiencesOverlap,
  WHOLE_CLASS, studentStreamOr, teacherLessonClause, filterElectivesForStudent,
};
