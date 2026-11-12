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
      if (a.classId && a.classId === b.classId) {
        if (p.__roster) {
          // Independent of the solver's own rule: who is actually in each lesson.
          const who = (x) => {
            if (x.groupId) return new Set(p.__roster.groups[x.groupId] || Object.keys(p.__roster.students));
            return new Set(Object.entries(p.__roster.students).filter(([, st]) => !x.streamId || st === x.streamId).map(([s]) => s));
          };
          const wa = who(a);
          if ([...who(b)].some(s => wa.has(s))) throw new Error(`student clash ${a.classId} ${a.day} ${a.start}`);
        } else if (!a.streamId || !b.streamId || a.streamId === b.streamId) throw new Error(`class clash ${a.classId} ${a.day} ${a.start}`);
      }
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

/* ── Elective (option) groups, v5.269.1 ─────────────────────────────
   Class A: streams s1 (students a1–a3) and s2 (b1–b3). Physics takes
   a1, b1; History takes a2, b2; Art takes a1 (also in Physics). */
function electiveProblem(over = {}) {
  const roster = {
    students: { a1: 's1', a2: 's1', a3: 's1', b1: 's2', b2: 's2', b3: 's2' },
    groups: { 'A|g:phy|TP': ['a1', 'b1'], 'A|g:his|TH': ['a2', 'b2'], 'A|g:art|TA': ['a1'] },
  };
  const g = (gid) => ({ ...audience('A'), groupId: gid, label: gid });
  return problem({
    audiences: {
      'A|': audience('A'),
      'A|s1': audience('A', 's1'), 'A|s2': audience('A', 's2'),
      'A|g:phy|TP': g('A|g:phy|TP'), 'A|g:his|TH': g('A|g:his|TH'), 'A|g:art|TA': g('A|g:art|TA'),
    },
    groups: {
      'A|g:phy|TP': { streams: ['s1', 's2'], shareWith: ['A|g:his|TH'] },
      'A|g:his|TH': { streams: ['s1', 's2'], shareWith: ['A|g:phy|TP', 'A|g:art|TA'] },
      'A|g:art|TA': { streams: ['s1'], shareWith: ['A|g:his|TH'] },
    },
    __roster: roster,
    ...over,
  });
}
const optionUnits = (gid, subjectId, teacherKey, n) => many(n, { audKey: gid, classId: 'A', streamId: null, groupId: gid, subjectId, teacherKey });

test('options no student shares run in the same periods, which is what makes a full week fit', () => {
  // 12 whole-class + 8 Physics + 8 History = 28 one after another, but the class has 20 periods.
  const p = electiveProblem({
    units: [
      ...many(12, { audKey: 'A|', classId: 'A', subjectId: 'core', teacherKey: 'TC' }),
      ...optionUnits('A|g:phy|TP', 'phy', 'TP', 8),
      ...optionUnits('A|g:his|TH', 'his', 'TH', 8),
    ],
  });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
});

test('options that share a student never overlap; a group never overlaps a whole-class lesson', () => {
  const p = electiveProblem({
    units: [
      ...many(4, { audKey: 'A|', classId: 'A', subjectId: 'core', teacherKey: 'TC' }),
      ...optionUnits('A|g:phy|TP', 'phy', 'TP', 6),
      ...optionUnits('A|g:art|TA', 'art', 'TA', 6),   // a1 takes both
    ],
  });
  const r = solve(p, { budgetMs: 1000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);   // the roster checker throws on any a1 double-booking
});

test('an option whose students are all in s1 can run alongside an s2-only lesson, never an s1 one', () => {
  const p = electiveProblem({
    units: [
      ...optionUnits('A|g:art|TA', 'art', 'TA', 10),
      ...many(10, { audKey: 'A|s2', classId: 'A', streamId: 's2', subjectId: 'x2', teacherKey: 'T2' }),
      ...many(10, { audKey: 'A|s1', classId: 'A', streamId: 's1', subjectId: 'x1', teacherKey: 'T1' }),
    ],
  });
  const r = solve(p, { budgetMs: 2000 });
  expect(r.unplaced).toEqual([]);   // s1: 10 + 10 = 20 periods exactly; Art must sit beside s2's lessons
  assertValid(p, r);
});

test('an option with unknown enrolment is kept apart from everything in the class', () => {
  const p = electiveProblem({
    groups: { 'A|g:phy|TP': { streams: null, shareWith: [] } },
    __roster: { students: { a1: 's1', b1: 's2' }, groups: {} },   // unknown → treated as everyone
    units: [
      ...optionUnits('A|g:phy|TP', 'phy', 'TP', 5),
      ...many(15, { audKey: 'A|s2', classId: 'A', streamId: 's2', subjectId: 'x2', teacherKey: 'T2' }),
    ],
  });
  const r = solve(p, { budgetMs: 1000 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);
});

test('audienceClash: unknown or missing group info always clashes', () => {
  const { audienceClash } = require('../utils/timetable-generator/solver')._internals;
  const p = { groups: { G1: { streams: ['s1'], shareWith: ['G2'] }, G2: { streams: ['s2'], shareWith: ['G1'] } } };
  expect(audienceClash(p, { groupId: 'G1' }, { groupId: 'G2' })).toBe(false);
  expect(audienceClash(p, { groupId: 'G1' }, { groupId: 'G3' })).toBe(true);      // G3 unknown
  expect(audienceClash(p, { groupId: 'G1' }, { groupId: 'G1' })).toBe(true);      // same group
  expect(audienceClash(p, { groupId: 'G1' }, { streamId: null })).toBe(true);     // whole class
  expect(audienceClash(p, { groupId: 'G1' }, { streamId: 's2' })).toBe(false);
  expect(audienceClash(p, { groupId: 'G1' }, { streamId: 's1' })).toBe(true);
  expect(audienceClash({ groups: {} }, { groupId: 'GX' }, { streamId: 's2' })).toBe(true);
});

/* ── A full school, v5.269.2 ────────────────────────────────────────
   24 and 36 classes × 36 lessons a week (864 / 1,296), doubles, a lab
   subject, teachers at up to 30 of 40 periods, some unavailable on
   Friday afternoons (fixtures/big-school.js). Measured on a dev machine:
   one pass places everything in well under a second, so these use a
   capped number of passes rather than a time budget — they don't depend
   on how fast the CI machine is. */
describe('a full school', () => {
  const { buildBigSchool } = require('./fixtures/big-school');
  // minOver: the soft 6-a-day teacher limit MUST be bent this many times. With 5 classes,
  // T_eng_0 teaches 30 lessons and can't teach Friday afternoon (Friday holds at most 5),
  // so the other four days carry 25: at least one day of 7. The solver should hit exactly that.
  test.each([[24, 5, 1], [36, 3, 0]])('%i classes (each teacher with %i classes): every lesson placed, no hard rule broken, daily-limit bent only where forced (%i)', (classes, classesPerTeacher, minOver) => {
    const p = buildBigSchool({ classes, normaliseRules, classesPerTeacher });
    const r = solve(p, { budgetMs: 60000, maxRuns: 5 });
    expect(r.unplaced).toEqual([]);
    expect(r.placements.reduce((s, x) => s + x.segments.length, 0)).toBe(classes * 36);
    expect(r.violations.teacherOverDay).toBe(minOver);
    assertValid(p, r);
  });
});

test('home room: used when free, never double-booked — two options side by side, one gets it (v5.269.2)', () => {
  const room = { id: 'home', name: 'Room A', type: 'classroom', capacity: null };
  const p = electiveProblem({
    rooms: [room],
    units: [
      ...many(12, { audKey: 'A|', classId: 'A', subjectId: 'core', teacherKey: 'TC', homeRoomId: 'home' }),
      ...optionUnits('A|g:phy|TP', 'phy', 'TP', 8).map(u => ({ ...u, homeRoomId: 'home' })),
      ...optionUnits('A|g:his|TH', 'his', 'TH', 8).map(u => ({ ...u, homeRoomId: 'home' })),
    ],
  });
  const r = solve(p, { budgetMs: 1500 });
  expect(r.unplaced).toEqual([]);
  assertValid(p, r);                                   // includes: no room twice at once
  const core = r.placements.filter(pl => p.units.find(u => u.id === pl.unitId).subjectId === 'core');
  expect(core.every(pl => pl.roomId === 'home')).toBe(true);
  const roomless = r.placements.filter(pl => !pl.roomId).length;
  // 12 core lessons fill 12 of 20 periods, so the 16 option lessons pair up in the other 8:
  // each pair has one room, so exactly 8 option lessons go roomless and 8 get the room.
  expect(roomless).toBe(8);
});
