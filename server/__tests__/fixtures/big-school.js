/* ============================================================
   A realistic, full secondary-school timetable problem for the generator
   (solver.js shape), v5.269.2. Used by the solver test to measure how
   completely it fills a school, not just a handful of classes.

   Default: 24 classes, 5 days × 8 periods (break after periods 2 and 5,
   so doubles start only at P1, P3, P4, P6, P7). Each class: 10 subjects,
   36 lessons a week (6,5,5,4,4,3,3,3,2,1); Maths and Sciences have one
   double; Chemistry needs one of 4 labs (cap 40) — 24 classes × 3 Chem
   lessons = 72 lab periods of 160. Each teacher teaches one subject to 3
   classes (80 teachers, ≤ 18 lessons a week); 10 of them can't teach on
   Friday afternoons. Classes are 35–45 students.
   ============================================================ */
'use strict';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const BELL = [
  ['1', '08:00', '08:40'], ['2', '08:40', '09:20'],                  // break
  ['3', '09:40', '10:20'], ['4', '10:20', '11:00'], ['5', '11:00', '11:40'],   // lunch
  ['6', '12:40', '13:20'], ['7', '13:20', '14:00'], ['8', '14:00', '14:40'],
];
const BREAK_AFTER = new Set(['2', '5']);
const SUBJECTS = [
  { id: 'eng', n: 6 }, { id: 'math', n: 5, dbl: 1 }, { id: 'kis', n: 5 }, { id: 'bio', n: 4, dbl: 1 },
  { id: 'phy', n: 4, dbl: 1 }, { id: 'chem', n: 3, lab: true }, { id: 'his', n: 3 }, { id: 'geo', n: 3 },
  { id: 'cre', n: 2 }, { id: 'pe', n: 1 },
];

function audience(classId) {
  const slots = [];
  for (const day of DAYS) BELL.forEach(([p, s, e], pos) => slots.push({ i: slots.length, day, periodKey: p, start: s, end: e, dayPos: pos, dayLen: BELL.length }));
  const doubleStarts = slots.filter(s => s.dayPos < BELL.length - 1 && !BREAK_AFTER.has(s.periodKey)).map(s => s.i);
  return { classId, streamId: null, label: classId, slots, doubleStarts };
}

function buildBigSchool({ classes = 24, normaliseRules, classesPerTeacher = 3 } = {}) {
  const audiences = {};
  const units = [];
  let uid = 0;
  for (let c = 0; c < classes; c++) {
    const cid = `C${c + 1}`;
    audiences[`${cid}|`] = audience(cid);
    const size = 35 + (c % 11);
    for (const s of SUBJECTS) {
      const teacherKey = `T_${s.id}_${Math.floor(c / classesPerTeacher)}`;
      const doubles = s.dbl || 0;
      const base = { audKey: `${cid}|`, classId: cid, streamId: null, groupId: null, subjectId: s.id, teacherKey, requiredRoomType: s.lab ? 'lab' : null, preferredRoomId: null, homeRoomId: null, classSize: size, isCore: s.id === 'math' || s.id === 'eng' };
      for (let d = 0; d < doubles; d++) units.push({ id: `u${++uid}`, ...base, length: 2 });
      for (let k = 0; k < s.n - 2 * doubles; k++) units.push({ id: `u${++uid}`, ...base, length: 1 });
    }
  }
  const unavailable = {};
  const teachers = [...new Set(units.map(u => u.teacherKey))];
  teachers.slice(0, 10).forEach(t => { unavailable[t] = [{ day: 'friday', start: '12:00', end: '23:59' }]; });
  const rooms = [1, 2, 3, 4].map(n => ({ id: `lab${n}`, name: `Lab ${n}`, type: 'lab', capacity: 40 }))
    .concat([1, 2].map(n => ({ id: `lab_big${n}`, name: `Big lab ${n}`, type: 'lab', capacity: 50 })));
  return { days: DAYS, audiences, units, fixed: [], unavailable, rooms, rules: normaliseRules({}), groups: {} };
}

module.exports = { buildBigSchool, DAYS, BELL };
