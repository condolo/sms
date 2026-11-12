/* ============================================================
   v5.265.0 — "Lessons to place" (server/utils/timetable-placement.js)
   Lessons per week from teaching assignments vs lessons on the draft.
   ============================================================ */
'use strict';

const { computePlacement } = require('../utils/timetable-placement');

const classes  = [{ id: 'c7', name: 'Year 7' }, { _id: { toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' }, name: 'Year 8' }];
const subjects = [{ id: 'maths', name: 'Mathematics' }, { id: 'eng', name: 'English' }];
const teachers = [{ id: 'tch_1', userId: 'u_1', firstName: 'Grace', lastName: 'Akinyi' }, { id: 'tch_2', firstName: 'Brian', lastName: 'Kamau' }];

const A = (o) => ({ classId: 'c7', subjectId: 'maths', subjectName: 'Mathematics', teacherId: 'u_1', teacherName: 'Grace Akinyi', periodsPerWeek: 5, ...o });
const L = (o) => ({ classId: 'c7', subject: 'Mathematics', subjectId: 'maths', teacherId: 'u_1', type: 'lesson', isActive: true, ...o });

test('counts placed vs needed and what is left', () => {
  const r = computePlacement({ assignments: [A()], slots: [L(), L(), L()], classes, subjects, teachers });
  expect(r.classes[0]).toMatchObject({ className: 'Year 7', subjectName: 'Mathematics', needed: 5, placed: 3, remaining: 2, status: 'short' });
  expect(r.summary).toMatchObject({ lessonsNeeded: 5, lessonsPlaced: 3, lessonsToPlace: 2, short: 1 });
});

test('a lesson saved by subject name only (no subjectId) still counts', () => {
  const r = computePlacement({ assignments: [A({ periodsPerWeek: 2 })], slots: [L({ subjectId: undefined, subject: 'mathematics ' }), L({ subjectId: undefined })], classes, subjects, teachers });
  expect(r.classes[0]).toMatchObject({ placed: 2, status: 'done' });
});

test('no lessons-per-week set → "no target", flagged in the summary', () => {
  const r = computePlacement({ assignments: [A({ periodsPerWeek: null })], slots: [L()], classes, subjects, teachers });
  expect(r.classes[0].status).toBe('no_target');
  expect(r.summary.noTarget).toBe(1);
});

test('more placed than needed → "over"', () => {
  const r = computePlacement({ assignments: [A({ periodsPerWeek: 1 })], slots: [L(), L()], classes, subjects, teachers });
  expect(r.classes[0].status).toBe('over');
  expect(r.summary.lessonsPlaced).toBe(1); // capped at what was needed
});

test('streams: a stream counts its own lessons and whole-class lessons, not another stream\'s', () => {
  const r = computePlacement({
    assignments: [A({ streamId: 's_i', streamName: '7i', periodsPerWeek: 3 }), A({ streamId: 's_ii', streamName: '7ii', teacherId: 'tch_2', teacherName: 'Brian Kamau', periodsPerWeek: 3 })],
    slots: [L({ streamId: 's_i' }), L({ streamId: 's_i' }), L({ streamId: 's_ii', teacherId: 'tch_2' }), L({ streamId: null })],
    classes, subjects, teachers,
  });
  const i  = r.classes.find(c => c.streamId === 's_i');
  const ii = r.classes.find(c => c.streamId === 's_ii');
  expect(i.placed).toBe(3);   // 2 own + 1 whole-class
  expect(ii.placed).toBe(2);  // 1 own + 1 whole-class
});

test('two teachers sharing one class + subject are added together', () => {
  const r = computePlacement({ assignments: [A({ periodsPerWeek: 3 }), A({ teacherId: 'tch_2', teacherName: 'Brian Kamau', periodsPerWeek: 2 })], slots: [], classes, subjects, teachers });
  expect(r.classes).toHaveLength(1);
  expect(r.classes[0]).toMatchObject({ needed: 5, teachers: ['Grace Akinyi', 'Brian Kamau'] });
});

test('class id forms: an assignment by _id string matches the class', () => {
  const r = computePlacement({ assignments: [A({ classId: 'aaaaaaaaaaaaaaaaaaaaaaaa', periodsPerWeek: 1 })], slots: [L({ classId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })], classes, subjects, teachers });
  expect(r.classes[0]).toMatchObject({ className: 'Year 8', placed: 1, status: 'done' });
});

test('teacher totals join the teacher\'s id forms (login id on the assignment, staff id on the lesson)', () => {
  const r = computePlacement({ assignments: [A({ periodsPerWeek: 4 })], slots: [L({ teacherId: 'tch_1' }), L({ teacherId: 'u_1' })], classes, subjects, teachers });
  expect(r.teachers).toHaveLength(1);
  expect(r.teachers[0]).toMatchObject({ teacherName: 'Grace Akinyi', needed: 4, placed: 2, remaining: 2 });
});

test('lessons no assignment asks for are listed; non-lessons (assembly) are ignored', () => {
  const r = computePlacement({ assignments: [A()], slots: [L({ subject: 'English', subjectId: 'eng' }), L({ type: 'assembly', subject: 'Assembly', subjectId: undefined })], classes, subjects, teachers });
  expect(r.unassigned).toEqual([expect.objectContaining({ className: 'Year 7', subjectName: 'English', placed: 1 })]);
  expect(r.summary.unassignedLessons).toBe(1);
});
