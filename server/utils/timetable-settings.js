/* ============================================================
   Msingi — school-wide timetable settings (v5.265.0).

   Stored on the school document as schools.timetableSettings:
     workingDays   the days lessons can be placed on, in week order.
                   Default Monday–Friday. A school with Saturday
                   classes adds 'saturday'.
   Read by the editor (which day columns to show), by add / edit /
   bulk save and by spreadsheet import (a lesson can only go on a
   working day).
   ============================================================ */
'use strict';

const { _model } = require('./model');

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DEFAULT_WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/** Keep only real day names, once each, in week order. Empty → the default. */
function normaliseDays(days) {
  const set = new Set((Array.isArray(days) ? days : []).map(d => String(d).toLowerCase()));
  const out = ALL_DAYS.filter(d => set.has(d));
  return out.length ? out : [...DEFAULT_WORKING_DAYS];
}

async function getTimetableSettings(schoolId) {
  let s = {};
  try {
    const school = await _model('schools').findOne({ id: schoolId }).select('timetableSettings').lean();
    s = school?.timetableSettings ?? {};
  } catch (err) {
    console.error('[timetable-settings] read failed, using Monday–Friday:', err.message);
  }
  return { workingDays: normaliseDays(s.workingDays) };
}

async function setWorkingDays(schoolId, days) {
  const workingDays = normaliseDays(days);
  await _model('schools').updateOne({ id: schoolId }, { $set: { 'timetableSettings.workingDays': workingDays } });
  return { workingDays };
}

function dayLabel(day) {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : '';
}

/** The message shown when a lesson is put on a day the school doesn't teach. */
function notWorkingDayMsg(day) {
  return `${dayLabel(day)} isn't one of the school's working days. Add it under Timetable → Days first.`;
}

module.exports = { ALL_DAYS, DEFAULT_WORKING_DAYS, normaliseDays, getTimetableSettings, setWorkingDays, notWorkingDayMsg };
