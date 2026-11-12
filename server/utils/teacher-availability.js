/* ============================================================
   Msingi — teacher availability (v5.268.0)

   When a teacher can't teach: e.g. part-time, "not Fridays", "not
   before 10:00 on Mondays". Stored per teacher in the
   `teacher_availability` collection:
     { id, schoolId, teacherId, blocks: [{ day, start, end }], note }
   `teacherId` is the staff record's own id (teachers.id, or String(_id)
   for a record without one). Blocks are clock times, not period
   numbers, so one entry is right for every section's bell schedule
   (Primary P3 and Secondary P2 can cover the same 09:30).

   Read by the timetable generator (Phase 3) and reported as a warning
   on the draft when a lesson already sits in a blocked time. It never
   blocks editing by hand.
   ============================================================ */
'use strict';

const { ALL_DAYS, dayLabel } = require('./timetable-settings');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_BLOCKS = 100;

/** Valid, de-duplicated blocks in week/time order — or { error }. */
function normaliseBlocks(blocks) {
  if (!Array.isArray(blocks)) return { error: 'blocks must be a list.' };
  if (blocks.length > MAX_BLOCKS) return { error: `At most ${MAX_BLOCKS} unavailable times per teacher.` };
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    const day = String(b?.day || '').toLowerCase();
    const start = String(b?.start || '');
    const end = String(b?.end || '');
    if (!ALL_DAYS.includes(day)) return { error: `"${b?.day}" is not a day.` };
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { error: 'Times must be HH:MM.' };
    if (start >= end) return { error: `${dayLabel(day)} ${start}–${end}: the end must be after the start.` };
    const key = `${day}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day, start, end });
  }
  out.sort((a, b) => ALL_DAYS.indexOf(a.day) - ALL_DAYS.indexOf(b.day) || a.start.localeCompare(b.start));
  return { blocks: out };
}

/** Every id form a lesson's teacherId may hold for this staff record → its key. */
function teacherKeyMap(teachers) {
  const map = new Map();
  for (const t of teachers) {
    const key = t.id || String(t._id);
    for (const f of [t.id, t.userId, t._id && String(t._id)].filter(Boolean)) map.set(String(f), key);
  }
  return map;
}

function teacherNameMap(teachers) {
  return new Map(teachers.map(t => [t.id || String(t._id), [t.title, t.firstName, t.lastName].filter(Boolean).join(' ')]));
}

const isLesson = s => !s.type || s.type === 'lesson';
const isWholeDay = b => b.start <= '00:00' && b.end >= '23:59';

/**
 * Lessons placed in a time their teacher marked unavailable.
 * @returns {string[]} one readable warning per lesson
 */
function unavailableWarnings(slots, availabilityDocs, teachers) {
  const keyOf = teacherKeyMap(teachers);
  const names = teacherNameMap(teachers);
  const blocksBy = new Map(availabilityDocs.map(a => [String(a.teacherId), a.blocks || []]));
  const out = [];
  for (const s of slots) {
    if (!isLesson(s) || !s.teacherId) continue;
    const key = keyOf.get(String(s.teacherId)) || String(s.teacherId);
    const timed = !!(s.startTime && s.endTime);
    // A lesson saved without clock times (old data) can only be judged against a whole-day block.
    const hit = (blocksBy.get(key) || []).find(b => b.day === s.day && (timed
      ? s.startTime < b.end && s.endTime > b.start
      : isWholeDay(b)));
    if (hit) {
      const when = isWholeDay(hit) ? 'all day' : `${hit.start}–${hit.end}`;
      const at = timed ? `${s.startTime}–${s.endTime}` : `period ${s.period}`;
      out.push(`${names.get(key) || s.teacherName || 'A teacher'} is unavailable ${dayLabel(s.day)} ${when} but has ${s.subject || 'a lesson'} at ${at}`);
    }
  }
  return out;
}

/**
 * Teachers with more lessons on one day than the school's limit.
 * @returns {string[]}
 */
function overloadWarnings(slots, teachers, max) {
  if (!max) return [];
  const keyOf = teacherKeyMap(teachers);
  const names = teacherNameMap(teachers);
  const count = new Map();
  for (const s of slots) {
    if (!isLesson(s) || !s.teacherId) continue;
    const key = keyOf.get(String(s.teacherId)) || String(s.teacherId);
    const k = `${key}|${s.day}`;
    count.set(k, (count.get(k) || 0) + 1);
  }
  const out = [];
  for (const [k, n] of count) {
    if (n <= max) continue;
    const [key, day] = k.split('|');
    out.push(`${names.get(key) || 'A teacher'} has ${n} lessons on ${dayLabel(day)} (limit ${max})`);
  }
  return out.sort();
}

module.exports = { normaliseBlocks, unavailableWarnings, overloadWarnings, teacherKeyMap, MAX_BLOCKS };
