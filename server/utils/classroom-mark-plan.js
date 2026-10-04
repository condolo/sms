'use strict';

/* Pure decision logic for a Google Classroom grade landing in the Markbook.
   The webhook (routes/elearning.js) does the I/O; this decides what to write.
   Classroom work is recorded as a homework (HW) instance: one instance per
   distinct coursework within (class, subject, term, year). A grade is never
   written over a locked schedule, a locked mark, or a submission under review
   — the same rules a teacher typing the mark would hit. */

const CLASSROOM_ASSESSMENT_TYPE = 'HW';

function classroomInstanceFor(courseWorkId, instanceByCourseWork) {
  if (instanceByCourseWork.has(courseWorkId)) return instanceByCourseWork.get(courseWorkId);
  const used = [...instanceByCourseWork.values()];
  return (used.length ? Math.max(...used) : 0) + 1;
}

function planClassroomMark({ assignedGrade, maxScore, instance, locks }) {
  if (assignedGrade == null || !Number.isFinite(Number(assignedGrade))) return { action: 'skip', reason: 'no_grade' };
  if (!(Number(maxScore) > 0)) return { action: 'skip', reason: 'no_max_score' };
  if (locks.scheduleLocked) return { action: 'skip', reason: 'schedule_locked' };
  if (locks.markLocked) return { action: 'skip', reason: 'mark_locked' };
  if (locks.underReview) return { action: 'skip', reason: 'under_review' };
  const pct = (Number(assignedGrade) / Number(maxScore)) * 100;
  const rawScore = Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
  return {
    action: 'upsert',
    assessmentType: CLASSROOM_ASSESSMENT_TYPE,
    instance,
    rawScore,
    markState: 'present',
  };
}

module.exports = { CLASSROOM_ASSESSMENT_TYPE, classroomInstanceFor, planClassroomMark };
