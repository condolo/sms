/* ============================================================
   Report-card order for portals (v5.278.0).

   Parent and student dashboards show "the latest report card" first and
   compare it with the one before. They sorted by publishedAt, so once a
   school publishes earlier years' report cards (after importing past
   results), a 2024 report published today would replace this term's.

   Order by period instead: academic year (by start date), then term
   number, then cycle order by publish time. A snapshot with no year is
   placed in the year whose dates contain its publish day.
   ============================================================ */
'use strict';

const { yearForDay } = require('./untagged-marks');
const { yearIdOf } = require('./class-history');

function sortReportsByPeriod(reports, years) {
  const startOf = new Map((years || []).map(y => [yearIdOf(y), String(y.startDate || '')]));
  const key = (r) => {
    const yid = r.academicYearId || yearForDay(years, r.publishedAt ? String(r.publishedAt).slice(0, 10) : null);
    return startOf.get(yid) || '';
  };
  return [...(reports || [])].sort((a, b) =>
    key(b).localeCompare(key(a))
    || (Number(b.termNumber) || 0) - (Number(a.termNumber) || 0)
    || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

module.exports = { sortReportsByPeriod };
