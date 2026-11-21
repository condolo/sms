/* ============================================================
   Untagged marks — Markbook marks saved before the Markbook sent an
   academic year (stored with academicYearId: null).

   Every year-filtered read treats a null year as "applies to every year"
   (assessment.js / academic-calc.js _yearFilterPart), so once a school
   has more than one year of marks, an untagged mark from this year would
   also turn up in a PAST year's Markbook and report cards — exactly what
   the past-results import (v5.278.0) creates.

   This files each untagged mark under the year it was entered in: the
   academic year with the latest start date on or before the day the mark
   was created (createdAt, else the Mongo _id's timestamp). A mark from
   before every year is left as it is. Never touches a mark that already
   has a year. Used by the past-results import before it writes, and by
   scripts/backfill-assessment-marks-academic-year.js for every school.
   ============================================================ */
'use strict';

const { yearIdOf } = require('./class-history');

const UNTAGGED = { $or: [{ academicYearId: null }, { academicYearId: { $exists: false } }, { academicYearId: '' }] };

function _createdDay(m) {
  if (m.createdAt) {
    const d = new Date(m.createdAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (m._id && typeof m._id.getTimestamp === 'function') return m._id.getTimestamp().toISOString().slice(0, 10);
  if (m._id && /^[0-9a-f]{24}$/i.test(String(m._id))) {
    return new Date(parseInt(String(m._id).slice(0, 8), 16) * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function yearForDay(years, day) {
  if (!day) return null;
  const started = (years || [])
    .filter(y => y.startDate && String(y.startDate).slice(0, 10) <= day)
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  return started.length ? yearIdOf(started[0]) : null;
}

/**
 * @param Marks  a tenant model for assessment_marks
 * @param years  the school's academic_years documents
 * @returns { untagged, tagged, byYear: { [yearId]: n }, left }
 */
async function tagUntaggedMarks(Marks, schoolId, years, { dryRun = false } = {}) {
  const rows = await Marks.find({ schoolId, ...UNTAGGED }).select('_id id createdAt').lean();
  const byYear = {};
  const now = new Date().toISOString(); // academicYearFiledAt: traceable, and tells these apart from marks saved with a year
  const ops = [];
  let left = 0;
  for (const m of rows) {
    const yid = yearForDay(years, _createdDay(m));
    if (!yid) { left++; continue; }
    byYear[yid] = (byYear[yid] || 0) + 1;
    ops.push({ updateOne: { filter: { _id: m._id, ...UNTAGGED }, update: { $set: { academicYearId: yid, academicYearFiledAt: now } } } });
  }
  if (!dryRun) {
    for (let i = 0; i < ops.length; i += 1000) await Marks.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  }
  return { untagged: rows.length, tagged: ops.length, byYear, left };
}

module.exports = { tagUntaggedMarks, yearForDay, UNTAGGED };
