/* ============================================================
   v5.269.0 — timetable generator solver (server/utils/timetable-generator/solver.js)
   Hard rules are never broken; soft rules are followed where possible.
   ============================================================ */
'use strict';

const { solve } = require('../utils/timetable-generator/solver');
const { DEFAULT_RULES, normaliseRules } = require('../utils/timetable-settings');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
// 4 lessons a day: P1 08–09, P2 09–10, break, P3 10:30–11:30, P4 11:30–12:30
const BELL = [['1', '08:00', '09:00'], ['2', '09:00', '10:00'], ['3', '10:30', '11:30'], ['4', '11:30', '12:30']];
const BREAK_AFTER = new Set(['2']);   // no double across P2→P3

function audience(classId, streamId = null, days = DAYS) {
  const slots = [];
  for (const day of days) BELL.forEach(([p, s, e], pos) => slots.push({ i: slots.length, day, periodKey: p, start: s, end: e, dayPos: pos, dayLen: BELL.length }));
  const doubleStarts = slots.filter(s => s.dayPos < BELL.length - 1 && !BREAK_AFTER.has(s.periodKey)).map(s => s.i);
  return { classId, streamId, label: classId + (streamId ? ` ${streamId}` : ''), slots, doubleStarts };
}

let uid = 0;
const unit = (o) => ({ id: `u${++uid}`, length: 1, requiredRoomType: null, preferredRoomId: null, classSize: null, isCore: false, ...o });
const many = (n, o) => Array.from({ length: n }, () => unit(o));

function problem(over = {}) {
  return {
    days: DAYS,
    audiences: { 'A|': audience('A'), 'B|': audience('B') },
    units: [],
    fixed: [],
    unavailable: {},
    rooms: [],
    rules: normaliseRules({}),
    ...over,
  };
}

/* Independent checker: no hard rule broken. */
function assertValid(p, result) {
  const byId = new Map(p.units.map(u => [u.id, u]));
  const items = [
    ...result.placements.map(pl => { const u = byId.get(pl.unitId); return { ...u, day: pl.day, start: pl.segments[0].start, end: pl.segments[pl.segments.length - 1].end, roomId: pl.roomId }; }),
    ...p.fixed.map(f => ({ ...f, fixed: true })),
  ];
  const ov = (a, b) => a.day === b.day && a.start < b.end && a.end > b.start;
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = items[i], b = items[j];
      if (!ov(a, b)) continue;
      if (a.classId && a.classId === b.classId && (!a.streamId || !b.streamId || a.streamId === b.streamId)) throw new Error(`class clash ${a.classId} ${a.day} ${a.start}`);
      if (a.teacherKey && a.teacherKey === b.teacherKey) throw new Error(`teacher clash ${a.teacherKey} ${a.day} ${a.start}`);
      if (a.roomId && a.roomId === b.roomId) throw new Error(`room clash ${a.roomId} ${a.day} ${a.start}`);
    }
  }
  for (const pl of result.placements) {
    const u = byId.get(pl.unitId);
    for (const b of p.unavailable[u.teacherKey] || []) {
      if (b.day === pl.day && pl.segments[0].start < b.end && pl.segments[pl.segments.length - 1].end > b.start) throw new Error('placed in unavailable time');
    }
    if (u.length === 2) {
      expect(pl.segments).toHaveLength(2);
      expect(pl.segments[0].end <= pl.segments[1].start).toBe(true);
      expect(BREAK_AFTER.has(pl.segments[0].periodKey)).toBe(false);
    }
    if (u.requiredRoomType) {
      const room = p.rooms.find(r => r.id === pl.roomId);
      expect(room?.type).toBe(u.requiredRoomType);
    }
  }
}

beforeEach(() => { uid = 0; });

test('places every lesson of two classes sharing a teacher, with no clashes', () => {
  const p = problem({ units: [...many(10, { audKey: 'A|', classId: 'A', subjectId: 'math', teacherKey: 'T1' }), ...many(8, { audKey: 'B|', classId: 'B', subjectId: 'math', teacherKey: 'T1' })] });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  expect(r.placements).toHaveLength(18);
  assertValid(p, r);
});

test('lessons kept outside the scope (fixed) are never double-booked', () => {
  // T1 already teaches another class every Monday and Tuesday morning.
  const fixed = [];
  for (const day of ['monday', 'tuesday']) for (const [, s, e] of BELL) fixed.push({ day, start: s, end: e, classId: 'Z', teacherKey: 'T1' });
  const p = problem({ fixed, units: many(12, { audKey: 'A|', classId: 'A', subjectId: 'eng', teacherKey: 'T1' }) });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
  expect(r.placements.every(pl => !['monday', 'tuesday'].includes(pl.day))).toBe(true);
});

test('teacher unavailable times are kept free', () => {
  const p = problem({
    unavailable: { T1: [{ day: 'friday', start: '00:00', end: '23:59' }, { day: 'monday', start: '08:00', end: '10:00' }] },
    units: many(6, { audKey: 'A|', classId: 'A', subjectId: 'kis', teacherKey: 'T1' }),
  });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
});

test('double lessons use two back-to-back periods and never straddle a break', () => {
  const p = problem({ units: [...many(3, { audKey: 'A|', classId: 'A', subjectId: 'chem', teacherKey: 'T2', length: 2 }), ...many(6, { audKey: 'A|', classId: 'A', subjectId: 'eng', teacherKey: 'T3' })] });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
});

test('a subject needing a lab only goes in a free lab big enough for the class', () => {
  const p = problem({
    rooms: [{ id: 'lab1', name: 'Lab 1', type: 'lab', capacity: 30 }, { id: 'lab_small', name: 'Small lab', type: 'lab', capacity: 10 }, { id: 'r1', name: 'Room 1', type: 'classroom' }],
    units: [
      ...many(4, { audKey: 'A|', classId: 'A', subjectId: 'chem', teacherKey: 'T2', requiredRoomType: 'lab', classSize: 25 }),
      ...many(4, { audKey: 'B|', classId: 'B', subjectId: 'chem', teacherKey: 'T4', requiredRoomType: 'lab', classSize: 25 }),
    ],
  });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
  expect(r.placements.every(pl => pl.roomId === 'lab1')).toBe(true);   // the small lab is too small
});

test('no lab registered: the lessons are left unplaced with a clear reason', () => {
  const p = problem({ units: many(2, { audKey: 'A|', classId: 'A', subjectId: 'chem', teacherKey: 'T2', requiredRoomType: 'lab' }) });
  const r = solve(p, { budgetMs: 500 });
  expect(r.placements).toEqual([]);
  expect(r.unplaced).toHaveLength(2);
  expect(r.unplaced[0].reason).toMatch(/no room of the type this subject needs is registered/);
});

test('more lessons than the class has periods: the extra ones are unplaced, the rest valid', () => {
  const p = problem({ units: many(22, { audKey: 'A|', classId: 'A', subjectId: 'x', teacherKey: 'T1' }) });   // 20 periods a week
  const r = solve(p, { budgetMs: 1000 });
  expect(r.placements).toHaveLength(20);
  expect(r.unplaced).toHaveLength(2);
  assertValid(p, r);
});

test('streams: different streams can have lessons at the same time; a whole-class lesson blocks both', () => {
  const p = problem({
    audiences: { 'C|s1': audience('C', 's1'), 'C|s2': audience('C', 's2'), 'C|': audience('C') },
    units: [
      ...many(10, { audKey: 'C|s1', classId: 'C', streamId: 's1', subjectId: 'math', teacherKey: 'T1' }),
      ...many(10, { audKey: 'C|s2', classId: 'C', streamId: 's2', subjectId: 'math', teacherKey: 'T2' }),
      ...many(10, { audKey: 'C|', classId: 'C', streamId: null, subjectId: 'pe', teacherKey: 'T3' }),
    ],
  });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
});

test('soft rules: a subject at most once a day and teachers within their daily limit when there is room', () => {
  const p = problem({
    rules: normaliseRules({ maxTeacherLessonsPerDay: { on: true, value: 2 } }),
    units: [...many(5, { audKey: 'A|', classId: 'A', subjectId: 'math', teacherKey: 'T1' }), ...many(5, { audKey: 'B|', classId: 'B', subjectId: 'math', teacherKey: 'T1' })],
  });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  expect(r.violations.subjectOverDay).toBe(0);
  expect(r.violations.teacherOverDay).toBe(0);
});

test('the same seed gives the same timetable', () => {
  const p = problem({ units: [...many(8, { audKey: 'A|', classId: 'A', subjectId: 'math', teacherKey: 'T1' }), ...many(8, { audKey: 'B|', classId: 'B', subjectId: 'eng', teacherKey: 'T1' })] });
  const a = solve(p, { budgetMs: 10000, maxRuns: 3, seed: 42 });
  const b = solve(p, { budgetMs: 10000, maxRuns: 3, seed: 42 });
  expect(a.placements).toEqual(b.placements);
});

test('a realistic section (6 classes, 8 subjects, shared teachers, doubles, labs) fills completely and validly', () => {
  const classes = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
  const audiences = Object.fromEntries(classes.map(c => [`${c}|`, audience(c)]));
  const rooms = [{ id: 'lab1', name: 'Lab 1', type: 'lab' }, { id: 'lab2', name: 'Lab 2', type: 'lab' }];
  // 20 periods a class: math 4, eng 4, kis 3, chem 2 (1 double, lab), bio 2 (lab), hist 2, geo 2, pe 1
  const plan = [['math', 4, 1], ['eng', 4, 1], ['kis', 3, 1], ['chem', 1, 2, 'lab'], ['bio', 2, 1, 'lab'], ['hist', 2, 1], ['geo', 2, 1], ['pe', 1, 1]];
  // Teachers shared across pairs of classes.
  const units = [];
  classes.forEach((c, ci) => {
    for (const [subj, n, len, roomType] of plan) {
      units.push(...many(n, { audKey: `${c}|`, classId: c, subjectId: subj, teacherKey: `${subj}_T${Math.floor(ci / 2)}`, length: len, requiredRoomType: roomType || null }));
    }
  });
  const p = problem({ audiences, rooms, units });
  const r = solve(p, { budgetMs: 4000 });
  assertValid(p, r);
  expect(r.unplaced).toEqual([]);
  expect(r.placements).toHaveLength(units.length);
});

test('no lab registered: that is the reason even when the class is also nearly full', () => {
  // 19 of the class's 20 periods already taken by fixed lessons — the old
  // reason tally said "no free period", hiding the real cause (no lab).
  const fixed = audience('A').slots.slice(0, 19).map(s => ({ day: s.day, start: s.start, end: s.end, classId: 'A', streamId: null, teacherKey: 'TX', roomId: null, audKey: 'A|', subjectId: 'other' }));
  const p = problem({ fixed, units: many(1, { audKey: 'A|', classId: 'A', subjectId: 'chem', teacherKey: 'T2', requiredRoomType: 'lab' }) });
  const r = solve(p, { budgetMs: 300 });
  expect(r.unplaced[0].reason).toMatch(/no room of the type this subject needs is registered/);
});

test('rule breaks count only days the generated lessons touch, not overloads already on the timetable', () => {
  // T9 already teaches 8 lessons on Monday in other classes (limit 6): not this run's doing.
  const monday = audience('A').slots.filter(s => s.day === 'monday');
  const fixed = [...monday, ...monday].map((s, i) => ({ day: 'monday', start: s.start, end: s.end, classId: `Z${i}`, streamId: null, teacherKey: 'T9', roomId: null, audKey: null, subjectId: null }));
  const p = problem({ fixed, units: many(1, { audKey: 'B|', classId: 'B', subjectId: 'x', teacherKey: 'T1' }) });
  const r = solve(p, { budgetMs: 300 });
  expect(r.placements).toHaveLength(1);
  expect(r.violations.teacherOverDay).toBe(0);
});
