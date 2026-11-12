/* ============================================================
   Msingi — timetable clash checks, shared by every write path.

   Used by routes/timetable.js (add / edit / bulk save) and by
   routes/import-export.js (spreadsheet import). Before v5.265.0
   only add and edit ran these checks, so a bulk save or an import
   could write a teacher into two classes at once without a word.

   A clash is:
     1. the same class (or the same stream, or a whole-class lesson
        against any stream) twice in one period — unless both are
        electives of that class that no student takes together (an
        option block; utils/elective-groups.js canShareSlot, v5.269.1);
     2. the same teacher in two lessons whose clock times overlap,
        across sections (Primary P3 09:30–10:30 vs Secondary P2
        09:30–11:00 is a clash even though the period keys differ);
     3. the same room (by id or by name) in two overlapping lessons.
   Old lessons without stored times fall back to period-key equality.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');
const { loadElectiveInfo, canShareSlot } = require('./elective-groups');

/** True if two HH:MM ranges overlap (touching ends do not overlap). */
function timesOverlap(start1, end1, start2, end2) {
  if (!start1 || !end1 || !start2 || !end2) return false;
  return start1 < end2 && end1 > start2;
}

function _slotId(s) { return s.id || String(s._id); }

function _sameAudience(a, b) {
  return !a.streamId || !b.streamId || a.streamId === b.streamId;
}

function _overlaps(a, b) {
  return (a.startTime && b.startTime)
    ? timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)
    : String(a.period) === String(b.period);
}

function _roomKey(s) {
  if (s.roomId) return `id:${s.roomId}`;
  const n = (s.room || '').trim().toLowerCase();
  return n ? `name:${n}` : null;
}

/**
 * Check one lesson against what is already saved.
 * @param {string} schoolId
 * @param {object} data      the lesson being written (day, period, classId, streamId,
 *                           teacherId, room, roomId, startTime, endTime, academicYearId)
 * @param {string|string[]|null} exclude  id(s) of saved lessons to ignore: the lesson
 *                           being edited, or lessons a bulk save is about to replace
 * @returns {Promise<string|null>} a message describing the first clash, or null
 */
async function checkConflicts(schoolId, data, exclude = null) {
  const Timetable = tenantModel('timetable', { schoolId });
  const excluded = new Set([].concat(exclude || []).filter(Boolean).map(String));
  // Year-scoped: a lesson from another academic year is never a live clash.
  const base = { schoolId, day: data.day, isActive: true, academicYearId: data.academicYearId ?? null };
  const keep = (s) => !excluded.has(_slotId(s));

  // 1. Class / stream — except two electives no student takes both of
  //    (an option block, utils/elective-groups.js). Enrolment is loaded only
  //    when there is a candidate clash, so ordinary saves cost nothing extra.
  const classSlots = (await Timetable.find({ ...base, classId: data.classId, period: data.period }).lean()).filter(keep);
  let classCandidates = classSlots.filter(s => _sameAudience(data, s));
  if (classCandidates.length && data.subjectId && classCandidates.some(s => s.subjectId)) {
    const info = await loadElectiveInfo({ schoolId }, schoolId, [data.classId]);
    classCandidates = classCandidates.filter(s => !canShareSlot(info, data.classId, data.subjectId, s.subjectId));
  }
  const classConflict = classCandidates[0];
  if (classConflict) {
    return `Slot already exists for this ${data.streamId && classConflict.streamId ? 'stream' : 'class'} on ${data.day} period ${data.period}.`;
  }

  // 2. Teacher
  if (data.teacherId) {
    const teacherSlots = (await Timetable.find({ ...base, teacherId: data.teacherId }).lean()).filter(keep);
    for (const s of teacherSlots) {
      if (_overlaps(data, s)) {
        const when = (data.startTime && s.startTime)
          ? `${data.startTime}–${data.endTime} overlaps with ${s.startTime}–${s.endTime}`
          : `${data.day} period ${data.period}`;
        return `Teacher is already scheduled in another class at ${when}.`;
      }
    }
  }

  // 3. Room — by id or by name, so a linked and an unlinked spelling of the same room still collide.
  const roomFilters = [];
  if (data.roomId) roomFilters.push({ roomId: data.roomId });
  if (data.room && data.room.trim()) {
    const roomRe = new RegExp(`^${data.room.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    roomFilters.push({ room: roomRe });
  }
  if (roomFilters.length) {
    const roomSlots = (await Timetable.find({ ...base, $or: roomFilters }).lean()).filter(keep);
    const seen = new Set();
    for (const s of roomSlots) {
      const sid = _slotId(s);
      if (seen.has(sid)) continue;
      seen.add(sid);
      if (_overlaps(data, s)) {
        const when = (data.startTime && s.startTime) ? `${data.startTime}–${data.endTime}` : `${data.day} period ${data.period}`;
        return `Room "${data.room || s.room}" is already occupied at ${when}.`;
      }
    }
  }

  return null;
}

/**
 * Clashes between lessons inside one batch (before any of them is saved).
 * Same three rules as checkConflicts. Returns [{ index, otherIndex, message }].
 */
function batchConflicts(slots, electiveInfo = null) {
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = slots[i], b = slots[j];
      if (a.day !== b.day || (a.academicYearId ?? null) !== (b.academicYearId ?? null)) continue;
      let why = null;
      if (a.classId === b.classId && String(a.period) === String(b.period) && _sameAudience(a, b)
        && !(electiveInfo && canShareSlot(electiveInfo, a.classId, a.subjectId, b.subjectId))) why = 'the same class';
      else if (_overlaps(a, b)) {
        if (a.teacherId && a.teacherId === b.teacherId) why = 'the same teacher';
        else if (_roomKey(a) && _roomKey(a) === _roomKey(b)) why = 'the same room';
      }
      if (why) out.push({ index: i, otherIndex: j, message: `${a.day} period ${a.period}: ${why} is in two lessons in this batch.` });
    }
  }
  return out;
}

module.exports = { timesOverlap, checkConflicts, batchConflicts };
