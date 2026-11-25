/* utils/allocation.js (v5.273.0) — Timetable → Subject allocation. */
'use strict';

const { computeAllocation } = require('../utils/allocation');

const classes = [{ id: 'c7', name: 'Year 7', sectionKey: 'secondary' }, { id: 'c8', name: 'Year 8', sectionKey: 'secondary' }];
const streams = [{ id: 's7a', classId: 'c7', name: '7A', status: 'active' }, { id: 's7b', classId: 'c7', name: '7B', status: 'active' }, { id: 'sold', classId: 'c7', name: 'Old', status: 'inactive' }];
const subjects = [{ id: 'mat', name: 'Maths', departmentId: 'd_m' }, { id: 'art', name: 'Art', departmentId: 'd_a' }, { id: 'eng', name: 'English', departmentId: 'd_l' }];
const classSubjects = [
  { classId: 'c7', subjectId: 'mat', isCompulsoryForClass: true },   // streamed class → one row per stream
  { classId: 'c7', subjectId: 'art', isCompulsoryForClass: false },  // optional → one whole-class row
  { classId: 'c8', subjectId: 'eng', isCompulsoryForClass: true },   // no streams → one row
  { classId: 'c8', subjectId: 'mat', isCompulsoryForClass: true, isActive: false },
];
const teachers = [
  { id: 't1', userId: 'u1', firstName: 'Agnes', lastName: 'K', status: 'active', subjects: ['mat'] },
  { id: 't2', userId: 'u2', firstName: 'Ben', lastName: 'O', status: 'active', subjects: ['eng'] },
  { id: 't3', firstName: 'Cleo', lastName: 'N', status: 'active' },                 // no login, no classes
  { id: 't4', userId: 'u4', firstName: 'Dan', lastName: 'L', status: 'inactive' },
];
const lesson = (classId, subjectId, teacherId, extra = {}) => ({ classId, subjectId, teacherId, day: 'monday', isActive: true, ...extra });

function run(over = {}) {
  return computeAllocation({
    classes, streams, classSubjects, subjects, teachers,
    assignments: [
      { id: 'a1', classId: 'c7', streamId: 's7a', subjectId: 'mat', teacherId: 'u1', periodsPerWeek: 5 },
      { id: 'a2', classId: 'c8', subjectId: 'eng', teacherId: 'u2' },                          // no lessons/week
      ...(over.assignments || []),
    ],
    slots: over.slots || [lesson('c7', 'mat', 'u1', { streamId: 's7a' }), lesson('c7', 'mat', 'u1', { streamId: 's7a' })],
  });
}

describe('rows: one per curriculum entry', () => {
  test('a compulsory subject in a streamed class has one row per active stream; an optional one is whole-class', () => {
    const r = run();
    const keys = r.rows.map(x => `${x.className}|${x.streamName || '-'}|${x.subjectName}`);
    expect(keys).toEqual(['Year 7|-|Art', 'Year 7|7A|Maths', 'Year 7|7B|Maths', 'Year 8|-|English']);
  });

  test('statuses: no teacher, no lessons/week, still to place', () => {
    const r = run();
    const by = Object.fromEntries(r.rows.map(x => [`${x.streamName || x.className}|${x.subjectName}`, x]));
    expect(by['7B|Maths'].status).toBe('no_teacher');
    expect(by['Year 7|Art'].status).toBe('no_teacher');
    expect(by['Year 8|English'].status).toBe('no_target');
    expect(by['7A|Maths']).toMatchObject({ status: 'short', needed: 5, placed: 2 });
    expect(r.summary).toMatchObject({ rows: 4, noTeacher: 2, noTarget: 1, short: 1 });
  });

  test('lessons already on the timetable for a subject with no teacher are still counted', () => {
    const r = run({ slots: [lesson('c7', 'art', 'u9')] });
    expect(r.rows.find(x => x.subjectName === 'Art')).toMatchObject({ status: 'no_teacher', placed: 1 });
  });

  test('an assignment outside the curriculum is shown and flagged, never hidden', () => {
    const r = run({ assignments: [{ id: 'a9', classId: 'c8', subjectId: 'art', teacherId: 'u2', periodsPerWeek: 2 }] });
    const row = r.rows.find(x => x.className === 'Year 8' && x.subjectName === 'Art');
    expect(row).toMatchObject({ inCurriculum: false, note: 'not_in_curriculum' });
    expect(r.summary.outsideCurriculum).toBe(1);
  });

  test('a whole-class row left over for a streamed compulsory subject is shown and flagged', () => {
    const r = run({ assignments: [{ id: 'a8', classId: 'c7', subjectId: 'mat', teacherId: 'u1', periodsPerWeek: 5 }] });
    expect(r.rows.find(x => x.className === 'Year 7' && !x.streamId && x.subjectName === 'Maths').note).toBe('whole_class_row_for_streamed_subject');
  });

  test('that leftover row sits just above the stream row to use, and says where it can move (v5.282.0)', () => {
    const r = run({ assignments: [{ id: 'a8', classId: 'c7', subjectId: 'mat', teacherId: 'u2', periodsPerWeek: 5 }] });
    expect(r.rows.map(x => `${x.className}|${x.streamName || '-'}|${x.subjectName}`)).toEqual([
      'Year 7|-|Art', 'Year 7|-|Maths', 'Year 7|7A|Maths', 'Year 7|7B|Maths', 'Year 8|-|English',
    ]);
    const left = r.rows[1];
    expect(left.moveTo).toEqual([
      { id: 's7a', name: '7A', teachers: [{ key: 't1', name: 'Agnes K' }] },
      { id: 's7b', name: '7B', teachers: [] },
    ]);
    expect(r.rows.filter(x => x !== left).every(x => x.moveTo === undefined)).toBe(true);
    expect(r.summary.needsStream).toBe(1);
  });

  test('two teachers taught together count one set of lessons', () => {
    const r = run({ assignments: [
      { id: 'b1', classId: 'c7', streamId: 's7b', subjectId: 'mat', teacherId: 'u1', periodsPerWeek: 4, lessonGroupId: 'g1' },
      { id: 'b2', classId: 'c7', streamId: 's7b', subjectId: 'mat', teacherId: 'u2', periodsPerWeek: 4, lessonGroupId: 'g1' },
    ] });
    expect(r.rows.find(x => x.streamName === '7B')).toMatchObject({ needed: 4, taughtTogether: true });
  });
});

describe('teachers: every active teacher, including those with no classes', () => {
  test('lists teachers with no classes (with or without a login) and leaves out inactive ones', () => {
    const r = run();
    const names = r.teachers.map(t => t.name);
    expect(names).toContain('Cleo N');
    expect(names).not.toContain('Dan L');
    expect(r.teachers.find(t => t.name === 'Cleo N')).toMatchObject({ status: 'no_classes', assignments: 0 });
    expect(r.teachers.find(t => t.name === 'Agnes K')).toMatchObject({ assignments: 1, needed: 5, placed: 2, classes: ['Year 7 7A'], subjects: ['Maths'] });
    expect(r.summary).toMatchObject({ teachers: 3, teachersWithNoClasses: 1 });
  });
});

describe('teachers on leave or no longer current (v5.274.0)', () => {
  test('rows allocated to someone on leave or inactive are flagged; on-leave teachers stay in the panel', () => {
    const r = computeAllocation({
      classes, streams, classSubjects, subjects,
      teachers: [...teachers, { id: 't5', userId: 'u5', firstName: 'Dorothy', lastName: 'C', status: 'on_leave' }],
      assignments: [
        { id: 'x1', classId: 'c8', subjectId: 'eng', teacherId: 'u5', periodsPerWeek: 4 },
        { id: 'x2', classId: 'c7', streamId: 's7b', subjectId: 'mat', teacherId: 'u4', periodsPerWeek: 4 },   // Dan: inactive
      ],
      slots: [],
    });
    const eng = r.rows.find(x => x.className === 'Year 8' && x.subjectName === 'English');
    expect(eng).toMatchObject({ teacherOnLeave: true, teacherNotCurrent: false });
    expect(eng.assignments[0].teacherStatus).toBe('on_leave');
    expect(r.rows.find(x => x.streamName === '7B').teacherNotCurrent).toBe(true);
    expect(r.teachers.find(t => t.name === 'Dorothy C')).toMatchObject({ staffStatus: 'on_leave', assignments: 1 });
    expect(r.teachers.map(t => t.name)).not.toContain('Dan L');
    expect(r.summary).toMatchObject({ rowsTeacherOnLeave: 1, rowsTeacherNotCurrent: 1 });
  });
});
