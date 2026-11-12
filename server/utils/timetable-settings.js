/* ============================================================
   Msingi — school-wide timetable settings (v5.265.0, rules v5.267.0).

   Stored on the school document as schools.timetableSettings:
     workingDays   the days lessons can be placed on, in week order.
                   Default Monday–Friday. A school with Saturday
                   classes adds 'saturday'.
     rules         how a good timetable looks (v5.267.0). Used by the
                   automatic timetable generator, and two of them
                   (max lessons a day, teacher availability) are also
                   reported as warnings on the draft. They never block
                   editing by hand.
   Read by the editor (which day columns to show), by add / edit /
   bulk save and by spreadsheet import (a lesson can only go on a
   working day).
   ============================================================ */
'use strict';

const { _model } = require('./model');

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DEFAULT_WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/* Each rule: on/off, plus a value where it has one. */
const DEFAULT_RULES = Object.freeze({
  // A teacher teaches at most this many lessons on one day.
  maxTeacherLessonsPerDay: { on: true, value: 6 },
  // A class has a subject at most this many times on one day (a double lesson counts once).
  maxSubjectPerDay:        { on: true, value: 1 },
  // Keep a teacher's lessons on a day together, with few free periods in between.
  avoidTeacherGaps:        { on: true },
  // Spread a subject's lessons across the week rather than on consecutive days.
  spreadAcrossWeek:        { on: true },
  // Put these subjects in the morning where possible.
  coreSubjectsMorning:     { on: false, subjectIds: [] },
  // Use each teacher's preferred room (from their teaching assignment) when it's free.
  usePreferredRooms:       { on: true },
});

/** Keep only real day names, once each, in week order. Empty → the default. */
function normaliseDays(days) {
  const set = new Set((Array.isArray(days) ? days : []).map(d => String(d).toLowerCase()));
  const out = ALL_DAYS.filter(d => set.has(d));
  return out.length ? out : [...DEFAULT_WORKING_DAYS];
}

/** Stored rules merged over the defaults; unknown keys dropped, values clamped. */
function normaliseRules(stored) {
  const src = stored && typeof stored === 'object' ? stored : {};
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_RULES)) {
    const s = src[key] && typeof src[key] === 'object' ? src[key] : {};
    const rule = { on: typeof s.on === 'boolean' ? s.on : def.on };
    if ('value' in def) {
      const n = Number(s.value);
      rule.value = Number.isInteger(n) && n >= 1 && n <= 20 ? n : def.value;
    }
    if ('subjectIds' in def) {
      rule.subjectIds = Array.isArray(s.subjectIds) ? [...new Set(s.subjectIds.map(String))].slice(0, 50) : [];
    }
    out[key] = rule;
  }
  return out;
}

async function getTimetableSettings(schoolId) {
  let s = {};
  try {
    const school = await _model('schools').findOne({ id: schoolId }).select('timetableSettings').lean();
    s = school?.timetableSettings ?? {};
  } catch (err) {
    console.error('[timetable-settings] read failed, using defaults:', err.message);
  }
  return { workingDays: normaliseDays(s.workingDays), rules: normaliseRules(s.rules) };
}

async function setWorkingDays(schoolId, days) {
  const workingDays = normaliseDays(days);
  await _model('schools').updateOne({ id: schoolId }, { $set: { 'timetableSettings.workingDays': workingDays } });
  return { workingDays };
}

/** Merge a partial rules object over what is stored, then save the whole set. */
async function setRules(schoolId, partial) {
  const { rules: current } = await getTimetableSettings(schoolId);
  const merged = { ...current };
  for (const [key, val] of Object.entries(partial || {})) {
    if (key in DEFAULT_RULES && val && typeof val === 'object') merged[key] = { ...current[key], ...val };
  }
  const rules = normaliseRules(merged);
  await _model('schools').updateOne({ id: schoolId }, { $set: { 'timetableSettings.rules': rules } });
  return { rules };
}

function dayLabel(day) {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : '';
}

/** The message shown when a lesson is put on a day the school doesn't teach. */
function notWorkingDayMsg(day) {
  return `${dayLabel(day)} isn't one of the school's working days. Add it under Timetable → Days & rules first.`;
}

module.exports = {
  ALL_DAYS, DEFAULT_WORKING_DAYS, DEFAULT_RULES,
  normaliseDays, normaliseRules, getTimetableSettings, setWorkingDays, setRules, notWorkingDayMsg, dayLabel,
};
