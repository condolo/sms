'use strict';

/* Pure decision logic for a Google Classroom grade entering the Markbook.
   The webhook (routes/elearning.js) does the I/O; this decides whether a grade
   may be written, and where.

   A grade is written only when every link is deterministic:
   - the coursework names a configured Markbook assessment window (its
     assessment_schedule entry), which supplies assessment type, term, instance
     and academic year. Nothing is inferred from "current period" and no
     instance is created on the fly;
   - the course has a class and subject;
   - the Google account resolves to a real student record in that same class.

   Anything else is skipped with a reason, for admin resolution. A grade is
   never written over a locked schedule, a locked mark, or a submission under
   review — the same rules a teacher typing the mark faces. */

function planClassroomMark({ assignedGrade, maxScore, schedule, courseLink, studentRec, locks }) {
  if (!schedule) return { action: 'skip', reason: 'no_markbook_target' };
  if (!courseLink?.classId || !courseLink?.subjectId) return { action: 'skip', reason: 'no_course_link' };
  if (!studentRec) return { action: 'skip', reason: 'unmapped_student' };
  if (studentRec.classId !== courseLink.classId) return { action: 'skip', reason: 'student_not_in_course_class' };
  if (assignedGrade == null || !Number.isFinite(Number(assignedGrade))) return { action: 'skip', reason: 'no_grade' };
  if (!(Number(maxScore) > 0)) return { action: 'skip', reason: 'no_max_score' };
  if (locks.scheduleLocked) return { action: 'skip', reason: 'schedule_locked' };
  if (locks.markLocked) return { action: 'skip', reason: 'mark_locked' };
  if (locks.underReview) return { action: 'skip', reason: 'under_review' };

  const pct = (Number(assignedGrade) / Number(maxScore)) * 100;
  const rawScore = Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
  return { action: 'upsert', rawScore, markState: 'present' };
}

module.exports = { planClassroomMark };
