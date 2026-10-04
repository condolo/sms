/* ============================================================
   server/utils/classroom-mark-plan.js — a Classroom grade may only enter
   the Markbook through a deterministic, explicit mapping (no guessing).
   ============================================================ */
'use strict';

const { planClassroomMark } = require('../../utils/classroom-mark-plan');

const SCHEDULE = { id: 'sched_1', assessmentType: 'HW', termNumber: 1, instance: 2, academicYearId: 'ay_1', isLocked: false };
const COURSE   = { classId: 'cls_1', subjectId: 'sub_eng' };
const STUDENT  = { id: 'stu_1', classId: 'cls_1', streamId: 'strm_red' };
const OPEN     = { scheduleLocked: false, markLocked: false, underReview: false };
const BASE     = { assignedGrade: 8, maxScore: 10, schedule: SCHEDULE, courseLink: COURSE, studentRec: STUDENT, locks: OPEN };

describe('planClassroomMark — written only through a deterministic mapping', () => {
  test('a fully mapped, open, graded coursework is written as a percentage', () => {
    expect(planClassroomMark(BASE)).toEqual({ action: 'upsert', rawScore: 80, markState: 'present' });
  });

  test('no explicit Markbook target → skipped, never auto-created', () => {
    expect(planClassroomMark({ ...BASE, schedule: null })).toEqual({ action: 'skip', reason: 'no_markbook_target' });
  });

  test('a course without a class or subject → skipped', () => {
    expect(planClassroomMark({ ...BASE, courseLink: { classId: 'cls_1' } })).toEqual({ action: 'skip', reason: 'no_course_link' });
  });

  test('no student record resolved → skipped, the grade is never guessed onto someone', () => {
    expect(planClassroomMark({ ...BASE, studentRec: null })).toEqual({ action: 'skip', reason: 'unmapped_student' });
  });

  test('a student in a different class than the course → skipped (stream/class safety)', () => {
    expect(planClassroomMark({ ...BASE, studentRec: { ...STUDENT, classId: 'cls_9' } })).toEqual({ action: 'skip', reason: 'student_not_in_course_class' });
  });

  test('no grade yet → skipped', () => {
    expect(planClassroomMark({ ...BASE, assignedGrade: undefined })).toEqual({ action: 'skip', reason: 'no_grade' });
  });

  test('no usable max score → skipped rather than dividing by zero', () => {
    expect(planClassroomMark({ ...BASE, maxScore: 0 })).toEqual({ action: 'skip', reason: 'no_max_score' });
  });

  test('a locked schedule window blocks the write', () => {
    expect(planClassroomMark({ ...BASE, locks: { ...OPEN, scheduleLocked: true } })).toEqual({ action: 'skip', reason: 'schedule_locked' });
  });

  test('a locked mark blocks the write', () => {
    expect(planClassroomMark({ ...BASE, locks: { ...OPEN, markLocked: true } })).toEqual({ action: 'skip', reason: 'mark_locked' });
  });

  test('a submission under review blocks the write', () => {
    expect(planClassroomMark({ ...BASE, locks: { ...OPEN, underReview: true } })).toEqual({ action: 'skip', reason: 'under_review' });
  });

  test('a grade above max is clamped to 100', () => {
    expect(planClassroomMark({ ...BASE, assignedGrade: 12 }).rawScore).toBe(100);
  });
});
