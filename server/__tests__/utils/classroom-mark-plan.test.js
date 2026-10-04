/* ============================================================
   server/utils/classroom-mark-plan.js — pure decision logic for a
   Google Classroom grade landing in the Markbook (Phase 5).
   ============================================================ */
'use strict';

const { CLASSROOM_ASSESSMENT_TYPE, classroomInstanceFor, planClassroomMark } = require('../../utils/classroom-mark-plan');

const OPEN = { scheduleLocked: false, markLocked: false, underReview: false };

describe('classroomInstanceFor — one HW instance per distinct coursework', () => {
  test('a coursework already mapped keeps its instance', () => {
    expect(classroomInstanceFor('cw_a', new Map([['cw_a', 2], ['cw_b', 1]]))).toBe(2);
  });
  test('a new coursework takes the next instance number', () => {
    expect(classroomInstanceFor('cw_c', new Map([['cw_a', 1], ['cw_b', 2]]))).toBe(3);
  });
  test('the first coursework in a term is instance 1', () => {
    expect(classroomInstanceFor('cw_a', new Map())).toBe(1);
  });
});

describe('planClassroomMark', () => {
  test('a graded coursework becomes a present HW mark, converted to a percentage', () => {
    expect(planClassroomMark({ assignedGrade: 8, maxScore: 10, instance: 1, locks: OPEN })).toEqual({
      action: 'upsert', assessmentType: CLASSROOM_ASSESSMENT_TYPE, instance: 1, rawScore: 80, markState: 'present',
    });
  });

  test('the assessment type is HW', () => {
    expect(CLASSROOM_ASSESSMENT_TYPE).toBe('HW');
  });

  test('no grade yet → skipped, nothing written', () => {
    expect(planClassroomMark({ assignedGrade: undefined, maxScore: 10, instance: 1, locks: OPEN })).toEqual({ action: 'skip', reason: 'no_grade' });
  });

  test('no usable max score → skipped rather than dividing by zero', () => {
    expect(planClassroomMark({ assignedGrade: 5, maxScore: 0, instance: 1, locks: OPEN })).toEqual({ action: 'skip', reason: 'no_max_score' });
    expect(planClassroomMark({ assignedGrade: 5, maxScore: undefined, instance: 1, locks: OPEN })).toEqual({ action: 'skip', reason: 'no_max_score' });
  });

  test('a locked schedule window blocks the write, the same way a teacher typing the mark is blocked', () => {
    expect(planClassroomMark({ assignedGrade: 5, maxScore: 10, instance: 1, locks: { ...OPEN, scheduleLocked: true } }))
      .toEqual({ action: 'skip', reason: 'schedule_locked' });
  });

  test('a locked mark blocks the write', () => {
    expect(planClassroomMark({ assignedGrade: 5, maxScore: 10, instance: 1, locks: { ...OPEN, markLocked: true } }))
      .toEqual({ action: 'skip', reason: 'mark_locked' });
  });

  test('a submission under review blocks the write', () => {
    expect(planClassroomMark({ assignedGrade: 5, maxScore: 10, instance: 1, locks: { ...OPEN, underReview: true } }))
      .toEqual({ action: 'skip', reason: 'under_review' });
  });

  test('a grade above max is clamped to 100, never stored out of range', () => {
    expect(planClassroomMark({ assignedGrade: 12, maxScore: 10, instance: 1, locks: OPEN }).rawScore).toBe(100);
  });
});
