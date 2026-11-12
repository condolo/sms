/* ============================================================
   Msingi — timetable generator: the solver (v5.268.0)

   Pure: no database, no Express. prepare.js builds the problem from a
   school's data; this places lessons; the route stores and applies the
   result. Runs in a worker thread (worker.js) so a big school never
   blocks the server.

   Problem (all times "HH:MM", days lower-case):
     days       ['monday', …]                     the working days, in order
     audiences  { [audKey]: { classId, streamId, label,
                  slots: [{ i, day, periodKey, start, end, dayPos, dayLen }],
                  doubleStarts: [slot i …] } }   i = index into slots; a double
                                                    starts at i and uses i+1
     units      [{ id, audKey, classId, streamId, subjectId, subjectName,
                  teacherKey, length: 1|2, requiredRoomType, preferredRoomId,
                  classSize, isCore }]
     fixed      [{ day, start, end, classId, streamId, teacherKey, roomId,
                  audKey, subjectId }]           lessons that stay put: locked
                                                    ones and every lesson outside
                                                    the scope
     unavailable { [teacherKey]: [{ day, start, end }] }
     rooms      [{ id, name, type, capacity }]
     rules      utils/timetable-settings.js DEFAULT_RULES shape

   Hard (never broken — the unit is left unplaced instead):
     a class/stream in one place at a time (a whole-class lesson blocks
     every stream), a teacher in one place at a time and never in a time
     they marked unavailable, a room once at a time, a subject needing a
     room type gets a free room of that type big enough for the class, a
     double uses two back-to-back periods with no break between.
   Soft (scored, lower is better): lessons a teacher teaches a day,
     times a subject comes up in a day, gaps in a teacher's day, spread
     across the week, core subjects in the morning, preferred rooms.

   Method: most-constrained-first greedy placement scored by the soft
   rules, a one-step repair (move one already-placed lesson) when a unit
   has nowhere to go, repeated with shuffled tie-breaks until the time
   budget runs out; the best run wins (fewest unplaced, then lowest score).
   ============================================================ */
'use strict';

const PENALTY = {
  teacherOverDay: 60,   // per lesson over the teacher's daily limit
  subjectOverDay: 50,   // per extra time a subject comes up in a day
  teacherGap:     3,    // a lesson not next to the teacher's other lessons that day
  adjacentDay:    4,    // same subject on the day before/after
  coreAfternoon:  4,    // a core subject in the second half of the day
  preferredRoom:  1,    // preferred room wanted but taken
};

/* Small seeded RNG (mulberry32) so a seed reproduces a run exactly. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlaps = (s1, e1, s2, e2) => s1 < e2 && e1 > s2;

/** Busy-time index: key → day → [{ start, end, ref, streamId? }]. */
class Busy {
  constructor() { this.map = new Map(); }
  _list(key, day) {
    let byDay = this.map.get(key);
    if (!byDay) { byDay = new Map(); this.map.set(key, byDay); }
    let l = byDay.get(day);
    if (!l) { l = []; byDay.set(day, l); }
    return l;
  }
  add(key, day, entry) { this._list(key, day).push(entry); }
  remove(key, day, ref) {
    const l = this._list(key, day);
    const i = l.findIndex(x => x.ref === ref);
    if (i !== -1) l.splice(i, 1);
  }
  /** Entries on that key/day overlapping start–end (optionally filtered). */
  clashes(key, day, start, end, filter) {
    const byDay = this.map.get(key);
    const l = byDay && byDay.get(day);
    if (!l) return [];
    return l.filter(x => overlaps(start, end, x.start, x.end) && (!filter || filter(x)));
  }
}

/** A class lesson clashes when both are the same audience or either is whole-class. */
const sameAudience = (streamA, streamB) => !streamA || !streamB || streamA === streamB;

function buildState(problem) {
  const st = {
    classBusy: new Busy(), teacherBusy: new Busy(), roomBusy: new Busy(),
    teacherDay: new Map(),   // `${tk}|${day}` → count of lessons
    subjDay: new Map(),      // `${audKey}|${subjectId}|${day}` → times
    placed: new Map(),       // unitId → placement
  };
  for (const [fi, f] of problem.fixed.entries()) {
    const ref = `fixed:${fi}`;
    if (f.classId) st.classBusy.add(f.classId, f.day, { start: f.start, end: f.end, streamId: f.streamId || null, ref });
    if (f.teacherKey) {
      st.teacherBusy.add(f.teacherKey, f.day, { start: f.start, end: f.end, ref });
      const k = `${f.teacherKey}|${f.day}`;
      st.teacherDay.set(k, (st.teacherDay.get(k) || 0) + 1);
    }
    if (f.roomId) st.roomBusy.add(f.roomId, f.day, { start: f.start, end: f.end, ref });
    if (f.audKey && f.subjectId) {
      const k = `${f.audKey}|${f.subjectId}|${f.day}`;
      st.subjDay.set(k, (st.subjDay.get(k) || 0) + 1);
    }
  }
  return st;
}

/** Every slot (or slot pair) a unit could start at, for its audience. */
function startsFor(problem, unit) {
  const aud = problem.audiences[unit.audKey];
  if (!aud) return [];
  return unit.length === 2 ? aud.doubleStarts : aud.slots.map(s => s.i);
}

function segmentsAt(aud, startIdx, length) {
  const segs = [aud.slots[startIdx]];
  if (length === 2) segs.push(aud.slots[startIdx + 1]);
  return segs;
}

/**
 * Why a unit can't start at this slot, or null if it can (with the room it would use).
 * Returns { ok: true, room, blockers } or { ok: false, reason, blockers }.
 * `blockers` are the refs of movable placed units in the way (for repair).
 */
function check(problem, st, unit, startIdx) {
  const aud = problem.audiences[unit.audKey];
  const segs = segmentsAt(aud, startIdx, unit.length);
  const day = segs[0].day;
  const start = segs[0].start;
  const end = segs[segs.length - 1].end;
  const blockers = new Set();
  let hardFixed = null;

  const note = (list, reason) => {
    for (const x of list) {
      if (String(x.ref).startsWith('fixed:')) hardFixed = hardFixed || reason;
      else blockers.add(x.ref);
    }
  };

  note(st.classBusy.clashes(unit.classId, day, start, end, x => sameAudience(unit.streamId, x.streamId)), 'class');
  const un = (problem.unavailable[unit.teacherKey] || []).find(b => b.day === day && overlaps(start, end, b.start, b.end));
  if (un) return { ok: false, reason: 'unavailable', blockers: [] };
  if (unit.teacherKey) note(st.teacherBusy.clashes(unit.teacherKey, day, start, end), 'teacher');

  // Room: a required type must be found; otherwise the preferred room if free, else none.
  let room = null;
  let roomReason = null;
  if (unit.requiredRoomType) {
    const fits = problem.rooms.filter(r => r.type === unit.requiredRoomType && (!r.capacity || !unit.classSize || r.capacity >= unit.classSize));
    if (!fits.length) roomReason = 'no_room_type';
    else {
      const ordered = unit.preferredRoomId ? [...fits].sort((a, b) => (b.id === unit.preferredRoomId) - (a.id === unit.preferredRoomId)) : fits;
      room = ordered.find(r => !st.roomBusy.clashes(r.id, day, start, end).length) || null;
      if (!room) {
        roomReason = 'room';
        // Rooms taken only by movable lessons can be freed by repair.
        for (const r of ordered) {
          const c = st.roomBusy.clashes(r.id, day, start, end);
          if (c.every(x => !String(x.ref).startsWith('fixed:'))) { for (const x of c) blockers.add(x.ref); break; }
        }
      }
    }
  } else if (unit.preferredRoomId && problem.rules.usePreferredRooms?.on) {
    const pref = problem.rooms.find(r => r.id === unit.preferredRoomId);
    if (pref && !st.roomBusy.clashes(pref.id, day, start, end).length) room = pref;
  }

  if (hardFixed) return { ok: false, reason: hardFixed, blockers: [] };
  if (roomReason === 'no_room_type') return { ok: false, reason: 'no_room_type', blockers: [] };
  if (blockers.size || roomReason) return { ok: false, reason: blockers.size ? 'movable' : roomReason, blockers: [...blockers] };
  return { ok: true, room, day, start, end, segs };
}

/** Soft-rule cost of placing the unit at a feasible spot. */
function cost(problem, st, unit, at) {
  const r = problem.rules;
  const { day, start, end, segs } = at;
  let c = 0;
  if (r.maxTeacherLessonsPerDay?.on && unit.teacherKey) {
    const n = (st.teacherDay.get(`${unit.teacherKey}|${day}`) || 0) + unit.length;
    if (n > r.maxTeacherLessonsPerDay.value) c += PENALTY.teacherOverDay * (n - r.maxTeacherLessonsPerDay.value);
  }
  if (r.maxSubjectPerDay?.on) {
    const n = (st.subjDay.get(`${unit.audKey}|${unit.subjectId}|${day}`) || 0) + 1;
    if (n > r.maxSubjectPerDay.value) c += PENALTY.subjectOverDay * (n - r.maxSubjectPerDay.value);
  }
  if (r.avoidTeacherGaps?.on && unit.teacherKey) {
    const same = st.teacherBusy.clashes(unit.teacherKey, day, '00:00', '23:59');
    if (same.length && !same.some(x => x.end === start || x.start === end)) c += PENALTY.teacherGap;
  }
  if (r.spreadAcrossWeek?.on) {
    const di = problem.days.indexOf(day);
    for (const d of [problem.days[di - 1], problem.days[di + 1]]) {
      if (d && st.subjDay.get(`${unit.audKey}|${unit.subjectId}|${d}`)) c += PENALTY.adjacentDay;
    }
  }
  if (r.coreSubjectsMorning?.on && unit.isCore && segs[0].dayPos >= segs[0].dayLen / 2) c += PENALTY.coreAfternoon;
  if (!unit.requiredRoomType && unit.preferredRoomId && r.usePreferredRooms?.on && (!at.room || at.room.id !== unit.preferredRoomId)) {
    c += PENALTY.preferredRoom;
  }
  return c;
}

function place(st, unit, at) {
  const ref = unit.id;
  st.classBusy.add(unit.classId, at.day, { start: at.start, end: at.end, streamId: unit.streamId || null, ref });
  if (unit.teacherKey) {
    st.teacherBusy.add(unit.teacherKey, at.day, { start: at.start, end: at.end, ref });
    const k = `${unit.teacherKey}|${at.day}`;
    st.teacherDay.set(k, (st.teacherDay.get(k) || 0) + unit.length);
  }
  if (at.room) st.roomBusy.add(at.room.id, at.day, { start: at.start, end: at.end, ref });
  const sk = `${unit.audKey}|${unit.subjectId}|${at.day}`;
  st.subjDay.set(sk, (st.subjDay.get(sk) || 0) + 1);
  st.placed.set(unit.id, at);
}

function unplace(st, unit) {
  const at = st.placed.get(unit.id);
  if (!at) return null;
  st.classBusy.remove(unit.classId, at.day, unit.id);
  if (unit.teacherKey) {
    st.teacherBusy.remove(unit.teacherKey, at.day, unit.id);
    const k = `${unit.teacherKey}|${at.day}`;
    st.teacherDay.set(k, (st.teacherDay.get(k) || 0) - unit.length);
  }
  if (at.room) st.roomBusy.remove(at.room.id, at.day, unit.id);
  const sk = `${unit.audKey}|${unit.subjectId}|${at.day}`;
  st.subjDay.set(sk, (st.subjDay.get(sk) || 0) - 1);
  st.placed.delete(unit.id);
  return at;
}

/** Best feasible spot for the unit, or { reasons } tallying why none worked. */
function bestSpot(problem, st, unit, random) {
  let best = null;
  const reasons = {};
  const movable = [];
  for (const i of startsFor(problem, unit)) {
    const at = check(problem, st, unit, i);
    if (!at.ok) {
      reasons[at.reason] = (reasons[at.reason] || 0) + 1;
      if (at.reason === 'movable' && at.blockers.length === 1) movable.push({ i, blocker: at.blockers[0] });
      continue;
    }
    const c = cost(problem, st, unit, at) + random() * 0.5;
    if (!best || c < best.c) best = { at, c };
  }
  return { best, reasons, movable };
}

const REASON_TEXT = {
  class:        'the class has no free period left that fits',
  teacher:      'the teacher is already teaching whenever the class is free',
  unavailable:  'the teacher is marked unavailable whenever the class is free',
  room:         'no room of the type it needs is free at any time that fits',
  no_room_type: 'no room of the type this subject needs is registered (Timetable → Rooms)',
  movable:      'every time that fits is already taken by other lessons',
  double:       'the class has no two back-to-back periods without a break between them',
};

function reasonFor(problem, unit, reasons) {
  // No room of the type at all is the real cause, whatever else was in the way.
  if (unit.requiredRoomType && !problem.rooms.some(r => r.type === unit.requiredRoomType)) return REASON_TEXT.no_room_type;
  if (unit.length === 2 && !(problem.audiences[unit.audKey]?.doubleStarts || []).length) return REASON_TEXT.double;
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  return top ? REASON_TEXT[top[0]] : 'no period fits';
}

/** Order: doubles, room-type subjects and the busiest teachers/classes first. */
function difficultyOrder(problem, random) {
  const teacherLoad = new Map();
  const audLoad = new Map();
  for (const u of problem.units) {
    if (u.teacherKey) teacherLoad.set(u.teacherKey, (teacherLoad.get(u.teacherKey) || 0) + u.length);
    audLoad.set(u.audKey, (audLoad.get(u.audKey) || 0) + u.length);
  }
  const score = (u) => {
    const aud = problem.audiences[u.audKey];
    const slots = aud ? aud.slots.length || 1 : 1;
    const unavailable = (problem.unavailable[u.teacherKey] || []).length;
    return (u.length === 2 ? 1000 : 0)
      + (u.requiredRoomType ? 500 : 0)
      + 100 * ((teacherLoad.get(u.teacherKey) || 0) / slots)
      + 50 * ((audLoad.get(u.audKey) || 0) / slots)
      + 10 * unavailable
      + random() * 20;
  };
  return problem.units.map(u => ({ u, s: score(u) })).sort((a, b) => b.s - a.s).map(x => x.u);
}

/** One full greedy pass with repair. */
function runOnce(problem, seed) {
  const random = rng(seed);
  const st = buildState(problem);
  const unitById = new Map(problem.units.map(u => [u.id, u]));
  const unplaced = [];
  for (const unit of difficultyOrder(problem, random)) {
    const { best, reasons, movable } = bestSpot(problem, st, unit, random);
    if (best) { place(st, unit, best.at); continue; }
    // Repair: move one lesson that's in the way somewhere else.
    let repaired = false;
    for (const { i, blocker } of movable.slice(0, 30)) {
      const other = unitById.get(blocker);
      if (!other) continue;
      const otherAt = unplace(st, other);
      const at = check(problem, st, unit, i);
      if (at.ok) {
        place(st, unit, at);
        const again = bestSpot(problem, st, other, random);
        if (again.best) { place(st, other, again.best.at); repaired = true; break; }
        unplace(st, unit);
      }
      place(st, other, otherAt);
    }
    if (!repaired) unplaced.push({ unitId: unit.id, reason: reasonFor(problem, unit, reasons) });
  }
  return { st, unplaced };
}

/** Totals of soft-rule breaks in a finished state, for the result screen. */
function evaluate(problem, st) {
  const r = problem.rules;
  const v = { teacherOverDay: 0, subjectOverDay: 0, coreAfternoon: 0, teacherGaps: 0 };
  const unitById = new Map(problem.units.map(u => [u.id, u]));
  // Only days the generated lessons touch: an overload that was already on
  // the timetable (fixed lessons alone) is not this run's doing.
  const touchedTeacherDays = new Set();
  const touchedSubjectDays = new Set();
  for (const [unitId, at] of st.placed) {
    const u = unitById.get(unitId);
    if (u.teacherKey) touchedTeacherDays.add(`${u.teacherKey}|${at.day}`);
    touchedSubjectDays.add(`${u.audKey}|${u.subjectId}|${at.day}`);
  }
  if (r.maxTeacherLessonsPerDay?.on) {
    for (const [k, n] of st.teacherDay) if (touchedTeacherDays.has(k) && n > r.maxTeacherLessonsPerDay.value) v.teacherOverDay += n - r.maxTeacherLessonsPerDay.value;
  }
  if (r.maxSubjectPerDay?.on) {
    for (const [k, n] of st.subjDay) if (touchedSubjectDays.has(k) && n > r.maxSubjectPerDay.value) v.subjectOverDay += n - r.maxSubjectPerDay.value;
  }
  let score = 0;
  for (const [unitId, at] of st.placed) {
    const u = unitById.get(unitId);
    if (r.coreSubjectsMorning?.on && u.isCore && at.segs[0].dayPos >= at.segs[0].dayLen / 2) v.coreAfternoon += 1;
  }
  // Gaps: free time between a teacher's first and last lesson of a day, in lessons-worth.
  for (const [tk, byDay] of st.teacherBusy.map) {
    for (const list of byDay.values()) {
      const own = list.filter(x => !String(x.ref).startsWith('fixed:')).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < own.length; i++) if (own[i].start > own[i - 1].end) v.teacherGaps += 1;
    }
  }
  score = v.teacherOverDay * PENALTY.teacherOverDay + v.subjectOverDay * PENALTY.subjectOverDay
    + v.coreAfternoon * PENALTY.coreAfternoon + v.teacherGaps * PENALTY.teacherGap;
  return { violations: v, score };
}

/**
 * Solve. options: { budgetMs = 8000, maxRuns = 200, seed = 1 }.
 * Returns { placements: [{ unitId, day, segments: [{periodKey,start,end}], roomId, roomName }],
 *           unplaced: [{ unitId, reason }], violations, score, runs, durationMs }.
 */
function solve(problem, options = {}) {
  const budgetMs = options.budgetMs ?? 8000;
  const maxRuns = options.maxRuns ?? 200;
  const t0 = Date.now();
  let best = null;
  let runs = 0;
  for (let k = 0; k < maxRuns; k++) {
    const { st, unplaced } = runOnce(problem, (options.seed ?? 1) + k * 7919);
    const ev = evaluate(problem, st);
    runs += 1;
    if (!best || unplaced.length < best.unplaced.length || (unplaced.length === best.unplaced.length && ev.score < best.ev.score)) {
      best = { st, unplaced, ev };
    }
    if (best.unplaced.length === 0 && best.ev.score === 0) break;
    if (Date.now() - t0 >= budgetMs) break;
  }
  const placements = [...best.st.placed].map(([unitId, at]) => ({
    unitId,
    day: at.day,
    segments: at.segs.map(s => ({ periodKey: s.periodKey, start: s.start, end: s.end })),
    roomId: at.room?.id || null,
    roomName: at.room?.name || null,
  }));
  return { placements, unplaced: best.unplaced, violations: best.ev.violations, score: best.ev.score, runs, durationMs: Date.now() - t0 };
}

module.exports = { solve, PENALTY, REASON_TEXT, _internals: { rng, Busy, check, cost, evaluate, sameAudience } };
