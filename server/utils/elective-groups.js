/* ============================================================
   Msingi — elective (option) groups on the timetable (v5.269.1)

   An elective is a subject with class_subjects.isCompulsoryForClass ===
   false for a class (see utils/elective-scope.js). Its students come from
   any stream of the class and are recorded in student_subjects. Two
   electives of the same class can be taught AT THE SAME TIME — an "option
   block", e.g. Form 3 Physics | History | Business — but only when no
   student takes both.

   The one rule used by the clash checks (utils/timetable-conflicts.js)
   and the generator (utils/timetable-generator/):

     canShareSlot(info, classId, subjectA, subjectB) is true only when
       - both subjects are electives for that class,
       - they are different subjects,
       - each has at least one student of that class enrolled, and
       - no student of that class is enrolled in both.

   Anything unknown (no subjectId, no enrolment recorded, a subject not in
   the class's curriculum) is NOT shareable: the lessons clash, exactly as
   they did before electives were understood. Never guess in the
   direction that could put a student in two places.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

/**
 * Elective data for some classes.
 * @param {object} ctx       tenant context
 * @param {string} schoolId
 * @param {string[]} classIds  any id forms; rows are keyed by the form given
 * @returns {Promise<{ classes: Map<string, { electives: Set<string>, enrolled: Map<string, Set<string>>, streamOf: Map<string, string|null> }> }>}
 */
async function loadElectiveInfo(ctx, schoolId, classIds) {
  const ids = [...new Set((classIds || []).filter(Boolean).map(String))];
  const classes = new Map();
  if (!ids.length) return { classes };
  for (const id of ids) classes.set(id, { electives: new Set(), enrolled: new Map(), streamOf: new Map() });

  const links = await tenantModel('class_subjects', ctx)
    .find({ schoolId, classId: { $in: ids }, isCompulsoryForClass: false })
    .select('classId subjectId').lean();
  if (!links.length) return { classes };
  for (const l of links) classes.get(String(l.classId))?.electives.add(String(l.subjectId));

  const students = await tenantModel('students', ctx)
    .find({ schoolId, classId: { $in: ids }, status: 'active' })
    .select('id classId streamId').lean();
  const classOfStudent = new Map();
  for (const s of students) {
    const sid = s.id || String(s._id);
    classOfStudent.set(sid, String(s.classId));
    classes.get(String(s.classId))?.streamOf.set(sid, s.streamId || null);
  }
  const subjectIds = [...new Set(links.map(l => String(l.subjectId)))];
  const enrol = students.length
    ? await tenantModel('student_subjects', ctx)
      .find({ schoolId, subjectId: { $in: subjectIds }, studentId: { $in: [...classOfStudent.keys()] } })
      .select('studentId subjectId').lean()
    : [];
  for (const e of enrol) {
    const cls = classes.get(classOfStudent.get(String(e.studentId)));
    if (!cls || !cls.electives.has(String(e.subjectId))) continue;
    const key = String(e.subjectId);
    if (!cls.enrolled.has(key)) cls.enrolled.set(key, new Set());
    cls.enrolled.get(key).add(String(e.studentId));
  }
  return { classes };
}

function isElectiveFor(info, classId, subjectId) {
  return !!subjectId && !!info?.classes.get(String(classId))?.electives.has(String(subjectId));
}

/** Enrolled students of this class in this elective (empty set if none recorded). */
function enrolledIn(info, classId, subjectId) {
  return info?.classes.get(String(classId))?.enrolled.get(String(subjectId)) || new Set();
}

/** See header: may two lessons of these subjects run at once in this class? */
function canShareSlot(info, classId, subjectA, subjectB) {
  if (!subjectA || !subjectB || String(subjectA) === String(subjectB)) return false;
  if (!isElectiveFor(info, classId, subjectA) || !isElectiveFor(info, classId, subjectB)) return false;
  const a = enrolledIn(info, classId, subjectA);
  const b = enrolledIn(info, classId, subjectB);
  if (!a.size || !b.size) return false;
  for (const s of a) if (b.has(s)) return false;
  return true;
}

/** Streams the students of an elective are in; null when unknown (no enrolment) or when any student has no stream. */
function streamsOfElective(info, classId, subjectId) {
  const cls = info?.classes.get(String(classId));
  const members = enrolledIn(info, classId, subjectId);
  if (!cls || !members.size) return null;
  const out = new Set();
  for (const s of members) {
    const st = cls.streamOf.get(s);
    if (!st) return null;
    out.add(st);
  }
  return [...out];
}

module.exports = { loadElectiveInfo, isElectiveFor, enrolledIn, canShareSlot, streamsOfElective };
